// Team Sync — lets several MailWave installs share one dataset through a
// private GitHub repo, with no server of our own.
//
// Repo layout (everything except mailwave-team.json is AES-256-GCM encrypted
// with a key derived from the team passphrase, so GitHub only ever stores
// ciphertext):
//
//   mailwave-team.json              team name, KDF salt, key-check value
//   devices/<deviceId>/device.mwe   who this device is (name, GitHub login)
//   devices/<deviceId>/<seq>.mwe    change events, append-only, one file per push
//   locks/<campaignUid>.mwe         who is sending a campaign right now
//
// Each device only ever creates files in its own devices/ folder, so pushes
// never conflict. Everyone replays everyone else's events into local SQLite
// (last-writer-wins per record). The only shared-write files are locks, which
// use GitHub's sha compare-and-swap so exactly one device wins a send.
const crypto = require('crypto');
const os     = require('os');
const zlib   = require('zlib');
const { seal, unseal, keychainAvailable } = require('./secrets');
const settings = require('./settings');
const trial    = require('./trial');
const store    = require('./teamStore');
const github   = require('./github');

const TEAM_FILE     = 'mailwave-team.json';
const SYNC_INTERVAL = 60 * 1000;
const LOCK_LEASE_MS = 15 * 60 * 1000;   // renewed every sync while sending
const EVENTS_PER_CHUNK = 3000;
const TARBALL_THRESHOLD = 40;           // more unseen chunks than this → one tarball download
const KEY_CHECK = 'mailwave-team-key-check';

let timer = null;
let soonTimer = null;
let running = false;
let onRemoteChange = () => {};
const activeLocks = new Map();          // campaignUid → { sha, lock }
// Lock writes go one at a time: a renew and a release racing on the same sha
// would make one of them fail and leave the lock looking busy until it expires.
let lockChain = Promise.resolve();
const serial = (fn) => (lockChain = lockChain.then(fn, fn));

function cfg() {
  const s = settings.getAll();
  return {
    enabled:     !!s.team_enabled,
    token:       unseal(s.team_token),
    key:         s.team_key ? Buffer.from(unseal(s.team_key), 'base64') : null,
    login:       s.team_login || '',
    owner:       s.team_owner || '',
    repo:        s.team_repo || '',
    branch:      s.team_branch || 'main',
    teamName:    s.team_name || '',
    deviceId:    s.team_device_id || '',
    deviceName:  s.team_device_name || os.hostname(),
    lastSync:    s.team_last_sync || null,
    lastError:   s.team_last_error || '',
  };
}

function isActive() {
  const c = cfg();
  return c.enabled && !!c.token && !!c.key && !!c.repo && trial.teamAllowed();
}

// ── Crypto ────────────────────────────────────────────────────────────────────
function deriveKey(passphrase, saltB64) {
  return crypto.scryptSync(passphrase, Buffer.from(saltB64, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

// Layout: "MW1" | iv(12) | tag(16) | ciphertext
function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from('MW1'), iv, c.getAuthTag(), ct]);
}
function decrypt(key, buf) {
  if (buf.subarray(0, 3).toString() !== 'MW1') throw new Error('Unknown file format');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(3, 15));
  d.setAuthTag(buf.subarray(15, 31));
  return Buffer.concat([d.update(buf.subarray(31)), d.final()]);
}
const encJson = (key, obj) => encrypt(key, zlib.gzipSync(JSON.stringify(obj)));
const decJson = (key, buf) => JSON.parse(zlib.gunzipSync(decrypt(key, buf)).toString('utf8'));

// ── Logical clock ─────────────────────────────────────────────────────────────
// Wall-clock based but never goes backwards and never falls behind anything
// seen from teammates — so a later edit wins even if this laptop's clock is slow.
function makeTick() {
  let last = Number(store.getMeta('clock', 0));
  const tick = () => { last = Math.max(Date.now(), last + 1); return last; };
  tick.observe = (ts) => { if (ts > last) last = ts; };
  tick.save = () => store.setMeta('clock', last);
  return tick;
}

const gh = () => github.client(cfg().token);
const pad = (n) => String(n).padStart(9, '0');

// ── Setup flows (called from Settings UI) ─────────────────────────────────────
function requirePro() {
  if (!trial.teamAllowed()) {
    const err = new Error(trial.status().ended
      ? 'Your Team Sync trial has ended. Upgrade to Pro to keep syncing.'
      : 'Team Sync is a Pro feature. Start the free trial or upgrade to Pro.');
    err.proRequired = true;
    throw err;
  }
}

async function connect(token) {
  requirePro();
  const me = await github.client(token).me();
  settings.save({ team_token: seal(token), team_login: me.login });
  return { ok: true, login: me.login };
}

async function createTeam({ owner, repo, teamName, passphrase, deviceName }) {
  requirePro();
  if (!passphrase || passphrase.length < 10) throw new Error('Passphrase must be at least 10 characters.');
  const c = cfg();
  const api = gh();
  owner = owner || c.login;
  const created = await api.createRepo(owner, repo, owner.toLowerCase() !== c.login.toLowerCase());

  const salt = crypto.randomBytes(16).toString('base64');
  const key = deriveKey(passphrase, salt);
  const team = {
    format: 1, name: teamName || repo, created_by: c.login, created_at: new Date().toISOString(),
    kdf: { alg: 'scrypt', N: 1 << 15, r: 8, p: 1, salt },
    check: encrypt(key, Buffer.from(KEY_CHECK)).toString('base64'),
  };
  // No branch on the very first commit — GitHub creates the default branch from it.
  await api.putFile(owner, repo, TEAM_FILE, null, JSON.stringify(team, null, 2), 'Create MailWave team');
  return finishJoin({ owner, repo, branch: created.default_branch || 'main', key, teamName: team.name, deviceName });
}

async function joinTeam({ owner, repo, passphrase, deviceName }) {
  requirePro();
  const api = gh();
  const info = await api.getRepo(owner, repo);
  const file = await api.getFile(owner, repo, TEAM_FILE, info.default_branch);
  if (!file) throw new Error('This repo is not a MailWave team (mailwave-team.json missing).');
  const team = JSON.parse(file.content.toString('utf8'));
  const key = deriveKey(passphrase, team.kdf.salt);
  try {
    if (decrypt(key, Buffer.from(team.check, 'base64')).toString() !== KEY_CHECK) throw new Error();
  } catch {
    throw new Error('Wrong team passphrase.');
  }
  return finishJoin({ owner, repo, branch: info.default_branch, key, teamName: team.name, deviceName });
}

async function finishJoin({ owner, repo, branch, key, teamName, deviceName }) {
  const c = cfg();
  store.resetSyncState();
  const deviceId = crypto.randomUUID().slice(0, 8) + '-' + (c.login || 'user').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = deviceName || os.hostname();
  settings.save({
    team_enabled: true, team_owner: owner, team_repo: repo, team_branch: branch,
    team_name: teamName, team_key: seal(key.toString('base64')),
    team_device_id: deviceId, team_device_name: name, team_last_error: '', team_last_sync: null,
  });
  await gh().putFile(owner, repo, `devices/${deviceId}/device.mwe`, branch,
    encJson(key, { id: deviceId, name, login: c.login, joined_at: new Date().toISOString() }),
    `Add device ${name}`);
  start();
  const result = await syncNow();
  return { ok: true, ...result };
}

async function invite(username) {
  requirePro();
  const c = cfg();
  await gh().inviteCollaborator(c.owner, c.repo, username.trim());
  return { ok: true };
}

function leave() {
  stop();
  store.resetSyncState();
  activeLocks.clear();
  settings.save({
    team_enabled: false, team_owner: '', team_repo: '', team_branch: '', team_name: '',
    team_key: '', team_device_id: '', team_last_sync: null, team_last_error: '',
  });
  return { ok: true };
}

function disconnect() {
  leave();
  settings.save({ team_token: '', team_login: '' });
  return { ok: true };
}

// ── Sync cycle ────────────────────────────────────────────────────────────────
async function push(c, api, tick) {
  const { events, commit } = store.collectLocalChanges(c.deviceId, tick);
  if (!events.length) return 0;
  let seq = Number(store.getMeta('seq', 0));
  for (let i = 0; i < events.length; i += EVENTS_PER_CHUNK) {
    seq++;
    const chunk = { v: 1, dev: c.deviceId, seq, events: events.slice(i, i + EVENTS_PER_CHUNK) };
    await api.putFile(c.owner, c.repo, `devices/${c.deviceId}/${pad(seq)}.mwe`, c.branch,
      encJson(c.key, chunk), `${c.deviceName}: ${chunk.events.length} change(s)`);
    store.setMeta('seq', seq);
  }
  commit();
  return events.length;
}

async function pull(c, api, tick) {
  const etag = store.getMeta('tree_etag');
  const t = await api.getTree(c.owner, c.repo, c.branch, etag);
  if (t.notModified) return { events: 0, counts: null };

  // Collect unseen chunks per teammate device, in sequence order.
  const pending = [];
  const devices = new Map();
  for (const f of t.tree) {
    const m = f.type === 'blob' && f.path.match(/^devices\/([^/]+)\/(\d+|device)\.mwe$/);
    if (!m) continue;
    if (m[2] === 'device') { devices.set(m[1], f.sha); continue; }
    if (m[1] === c.deviceId) continue;
    const seq = Number(m[2]);
    if (seq > Number(store.getMeta(`cursor:${m[1]}`, 0))) pending.push({ dev: m[1], seq, path: f.path, sha: f.sha });
  }
  pending.sort((a, b) => (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : a.seq - b.seq));

  // Member directory (names shown in Settings, and on "X is already sending" messages).
  const known = JSON.parse(store.getMeta('devices', '{}'));
  for (const [dev, sha] of devices) {
    if (known[dev]?.sha === sha) continue;
    try { known[dev] = { sha, ...decJson(c.key, await api.getBlob(c.owner, c.repo, sha)) }; } catch {}
  }
  store.setMeta('devices', JSON.stringify(known));

  const tarball = pending.length > TARBALL_THRESHOLD ? await api.getTarball(c.owner, c.repo, c.branch) : null;
  const events = [];
  const cursors = {};
  const broken = new Set();
  for (const p of pending) {
    if (broken.has(p.dev)) continue;
    try {
      const buf = tarball ? tarball.get(p.path) : await api.getBlob(c.owner, c.repo, p.sha);
      if (!buf) throw new Error('missing from tarball');
      const chunk = decJson(c.key, buf);
      events.push(...chunk.events);
      cursors[p.dev] = p.seq;
    } catch (err) {
      // Keep cursors contiguous: stop at the first unreadable chunk for that device, retry next cycle.
      if (err.status === 0) throw err;
      console.error(`[TeamSync] chunk ${p.path}: ${err.message}`);
      broken.add(p.dev);
    }
  }

  let counts = null;
  if (events.length) {
    for (const e of events) tick.observe(e.ts);
    counts = store.applyRemoteEvents(events);
  }
  for (const [dev, seq] of Object.entries(cursors)) store.setMeta(`cursor:${dev}`, seq);
  if (!broken.size) store.setMeta('tree_etag', t.etag);
  return { events: events.length, counts };
}

async function syncNow() {
  if (!isActive()) return { ok: false, error: 'Team Sync is not active.' };
  if (running) return { ok: true, busy: true };
  running = true;
  const c = cfg();
  const api = gh();
  const tick = makeTick();
  try {
    const pushed = await push(c, api, tick);
    const pulled = await pull(c, api, tick);
    await renewLocks(c, api);
    tick.save();
    settings.save({ team_last_sync: new Date().toISOString(), team_last_error: '' });
    if (pulled.counts && (pulled.counts.applied || pulled.counts.history)) onRemoteChange(pulled.counts);
    return { ok: true, pushed, pulled: pulled.events };
  } catch (err) {
    tick.save();
    console.error('[TeamSync]', err.message);
    settings.save({ team_last_error: err.message });
    return { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

// Debounced push shortly after a local edit, instead of waiting for the next tick.
function syncSoon() {
  if (!isActive()) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => syncNow(), 3000);
}

function start() {
  stop();
  if (!cfg().enabled) return;
  timer = setInterval(() => syncNow(), SYNC_INTERVAL);
  setTimeout(() => syncNow(), 2000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ── Send locks ────────────────────────────────────────────────────────────────
// Every device arms timers for every scheduled campaign; whoever wins this
// lock sends, the rest skip. run_key identifies one send attempt
// ("sched:<time>", "resume:<time>", "manual:<ms>") so a finished run is never
// repeated by a teammate whose timer fires late.
function deviceLabel(dev) {
  const known = JSON.parse(store.getMeta('devices', '{}'));
  return known[dev] ? `${known[dev].name} (${known[dev].login})` : dev;
}

function acquireSendLock(campaign_id, runKey) {
  if (!isActive()) return Promise.resolve({ ok: true, local: true });
  return serial(() => acquireLock(campaign_id, runKey));
}

async function acquireLock(campaign_id, runKey) {
  const c = cfg();
  const api = gh();
  const uid = store.campaignUid(campaign_id);
  const path = `locks/${uid}.mwe`;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await api.getFile(c.owner, c.repo, path, c.branch);
      const L = cur ? decJson(c.key, cur.content) : null;
      if (L) {
        if (L.device !== c.deviceId && L.state === 'sending' && Date.parse(L.expires_at) > Date.now()) {
          return { ok: false, error: `${deviceLabel(L.device)} is already sending this campaign.` };
        }
        if (L.run_key === runKey && L.state === 'done') {
          return { ok: false, alreadyDone: true, error: `Already sent by ${deviceLabel(L.device)}.` };
        }
      }
      const lock = {
        campaign: uid, run_key: runKey, state: 'sending', device: c.deviceId,
        claimed_at: new Date().toISOString(), expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString(),
      };
      try {
        const put = await api.putFile(c.owner, c.repo, path, c.branch, encJson(c.key, lock),
          `${c.deviceName} sending campaign`, cur?.sha);
        activeLocks.set(uid, { sha: put.sha, lock });
        return { ok: true };
      } catch (err) {
        if (err.status === 409 || err.status === 422) continue;   // lost the race — re-read
        throw err;
      }
    }
    return { ok: false, error: 'Another teammate grabbed this campaign at the same moment.' };
  } catch (err) {
    // Fail closed: if GitHub is unreachable we can't prove nobody else is sending.
    return { ok: false, retry: true, error: `Team repo unreachable, send not started: ${err.message}` };
  }
}

function releaseSendLock(campaign_id, result) {
  return serial(() => releaseLock(campaign_id, result));
}

async function releaseLock(campaign_id, result) {
  const uid = store.campaignUid(campaign_id);
  const held = activeLocks.get(uid);
  if (!held || !isActive()) return;
  activeLocks.delete(uid);
  const state = result?.paused ? 'paused' : result?.stopped ? 'stopped' : result?.ok ? 'done' : 'failed';
  const c = cfg();
  try {
    await gh().putFile(c.owner, c.repo, `locks/${uid}.mwe`, c.branch,
      encJson(c.key, { ...held.lock, state, finished_at: new Date().toISOString() }),
      `${c.deviceName} ${state} campaign`, held.sha);
  } catch (err) {
    // Lease simply expires if this fails, so nothing is stuck forever.
    console.error('[TeamSync] release lock:', err.message);
  }
  syncSoon();
}

function renewLocks(c, api) {
  return serial(() => renewAll(c, api));
}

async function renewAll(c, api) {
  for (const [uid, held] of activeLocks) {
    const lock = { ...held.lock, expires_at: new Date(Date.now() + LOCK_LEASE_MS).toISOString() };
    try {
      const put = await api.putFile(c.owner, c.repo, `locks/${uid}.mwe`, c.branch, encJson(c.key, lock),
        `${c.deviceName} still sending`, held.sha);
      activeLocks.set(uid, { sha: put.sha, lock });
    } catch (err) {
      if (err.status === 409 || err.status === 422) {
        console.error(`[TeamSync] lost lock for ${uid} — lease expired and a teammate took over`);
        activeLocks.delete(uid);
      } else throw err;
    }
  }
}

// ── Status for the Settings page ──────────────────────────────────────────────
function status() {
  const c = cfg();
  const devices = JSON.parse(store.getMeta('devices', '{}'));
  return {
    pro:        require('./license').isPro(settings.getAll().license_key),
    allowed:    trial.teamAllowed(),
    trial:      trial.status(),
    connected:  !!c.token,
    login:      c.login,
    enabled:    c.enabled,
    active:     isActive(),
    owner:      c.owner,
    repo:       c.repo,
    teamName:   c.teamName,
    deviceId:   c.deviceId,
    deviceName: c.deviceName,
    lastSync:   c.lastSync,
    lastError:  c.lastError,
    members:    Object.entries(devices).map(([id, d]) => ({ id, name: d.name, login: d.login, joined_at: d.joined_at, me: id === c.deviceId })),
    hasDeviceFlow: github.hasDeviceFlow(),
    keychain:   keychainAvailable(),
  };
}

module.exports = {
  connect, createTeam, joinTeam, invite, leave, disconnect,
  start, stop, syncNow, syncSoon, status, isActive,
  acquireSendLock, releaseSendLock,
  setOnRemoteChange: (fn) => { onRemoteChange = fn; },
  // exposed for tests
  _crypto: { deriveKey, encrypt, decrypt, encJson, decJson },
};
