// Social posting: connect accounts, write a post once, publish it now or on a
// schedule to several accounts.
//
// A provider is how accounts are connected (one developer app, one sign-in):
//   { id, name, platforms, REDIRECT_URI, connect() } → one account or several
// A publisher posts to one kind of account:
//   { id, name, maxChars, requiresImage, publish() }
// LinkedIn and X are both; Meta is one provider for the facebook and
// instagram publishers. A platform whose tokens expire quickly (X: two hours)
// also has refresh(), and index.js renews the token before publishing.
//
// Scheduled posts live in SQLite, and runDue() is called by the app's
// once-a-minute scheduler, so a schedule survives restarts without timers.
const settings = require('../settings');
const { seal, unseal } = require('../secrets');
const store    = require('./store');
const oauth    = require('./oauth');

const linkedin = require('./linkedin');
const meta     = require('./meta');
const x        = require('./x');

const PROVIDERS  = { linkedin, meta, x };
const PLATFORMS  = { linkedin, facebook: meta.facebook, instagram: meta.instagram, x }; // publishers

// Platforms planned but not built yet, shown greyed out on the Accounts tab.
const COMING_SOON = [
  { id: 'bluesky',   name: 'Bluesky' },
  { id: 'threads',   name: 'Threads' },
  { id: 'mastodon',  name: 'Mastodon' },
  { id: 'google',    name: 'Google Business Profile' },
  { id: 'pinterest', name: 'Pinterest' },
];

// A post scheduled for a time that passed while the app was closed is still
// published if it's less than this late. Older ones are marked "missed"
// instead: a sale announcement going out two days late can do more harm than
// good, so the user decides.
const MISSED_AFTER_MS = 6 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 7;
// Renew a refreshable token when it has less than this left.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const deps = { openUrl: (url) => require('electron').shell.openExternal(url), notify: () => {} };

// ── App credentials (per platform, per device) ───────────────────────────────

function appConfig(provider) {
  const cfg = settings.getAll();
  return { clientId: cfg[`social_${provider}_client_id`] || '', clientSecret: unseal(cfg[`social_${provider}_client_secret`] || '') };
}

function getConfig() {
  return {
    providers: Object.values(PROVIDERS).map(p => {
      const c = appConfig(p.id);
      return { id: p.id, name: p.name, platforms: p.platforms, redirectUri: p.REDIRECT_URI, clientId: c.clientId, hasSecret: !!c.clientSecret, secretOptional: !!p.secretOptional };
    }),
    // countsLikeX: the renderer counts links as 23 and wide characters as 2.
    publishers: Object.values(PLATFORMS).map(p => ({ id: p.id, name: p.name, maxChars: p.maxChars, requiresImage: !!p.requiresImage, countsLikeX: !!p.countChars })),
    comingSoon: COMING_SOON,
  };
}

// clientSecret: undefined = keep, '' = clear, string = replace.
// `platform` is accepted as an older name for `provider`.
function saveAppConfig({ provider, platform, clientId, clientSecret } = {}) {
  const id = provider || platform;
  if (!PROVIDERS[id]) throw new Error('Unknown platform');
  const update = { [`social_${id}_client_id`]: String(clientId || '').trim() };
  if (clientSecret !== undefined) update[`social_${id}_client_secret`] = clientSecret ? seal(String(clientSecret).trim()) : '';
  settings.save(update);
  return { ok: true, ...getConfig() };
}

// ── Accounts ─────────────────────────────────────────────────────────────────

// Returns every account the sign-in gave access to (Meta: one per Page and
// per linked Instagram account).
async function connect(provider) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('This platform isn\'t supported yet.');
  const result = await p.connect({ ...appConfig(provider), oauth, openUrl: deps.openUrl });
  const accounts = (Array.isArray(result) ? result : [result]).map(a => store.upsertAccount(a));
  return { ok: true, accounts, account: accounts[0] };
}

function listAccounts() {
  const soon = Date.now() + EXPIRY_WARNING_DAYS * 86400000;
  return store.listAccounts().map(a => ({ ...a, expiring: !a.expired && !a.renews && !!a.expires_at && new Date(a.expires_at).getTime() < soon }));
}

// ── Posts ────────────────────────────────────────────────────────────────────

function textFor(post, platform) {
  const v = post.variants?.[platform];
  return (typeof v === 'string' && v.trim()) ? v : post.text;
}

// Length the way the platform counts it. X counts the link too, because it
// goes in the text.
function lengthFor(p, text, link) {
  return p.countChars ? p.countChars(p.postText(text, (link || '').trim())) : text.length;
}

// Problems that would make a publish fail, found before trying.
function validate(post, accounts = store.listAccounts()) {
  const problems = [];
  if (!post.targets?.length) problems.push('Choose at least one account.');
  for (const t of post.targets || []) {
    const acc = accounts.find(a => a.id === t.account_id);
    const p = PLATFORMS[t.platform];
    if (!acc || !p) { problems.push(`${t.account_name || 'An account'} is no longer connected.`); continue; }
    if (t.status === 'published') continue;
    const text = textFor(post, t.platform).trim();
    if (!text && !post.image_path) problems.push(`${p.name}: the post is empty.`);
    if (p.requiresImage && !post.image_path) problems.push(`${p.name}: add an image, it can't publish text-only posts.`);
    const len = lengthFor(p, text, post.link);
    if (len > p.maxChars) problems.push(`${p.name}: ${len} characters${p.countChars && post.link ? ' with the link' : ''}, the limit is ${p.maxChars}.`);
    if (p.maxHashtags && meta.countHashtags(text) > p.maxHashtags) problems.push(`${p.name}: more than ${p.maxHashtags} hashtags.`);
    if (acc.expired) problems.push(`${acc.name} (${p.name}): sign-in expired. Reconnect it on the Accounts tab.`);
  }
  if (post.link && !/^https?:\/\/\S+$/i.test(post.link.trim())) problems.push('The link must start with http:// or https://');
  return problems;
}

function savePost(data) {
  return { ok: true, post: store.savePost(data) };
}

function schedule({ id, scheduled_at }) {
  const post = store.getPost(id);
  if (!post) throw new Error('Post not found');
  const when = new Date(scheduled_at);
  if (isNaN(when)) throw new Error('Pick a date and time.');
  if (when.getTime() < Date.now() - 60000) throw new Error('That time has already passed.');
  const problems = validate(post);
  if (problems.length) return { ok: false, error: problems.join(' '), problems };
  return { ok: true, post: store.setSchedule(id, when.toISOString()) };
}

function unschedule(id) {
  return { ok: true, post: store.setSchedule(id, null) };
}

// Publishes every unpublished target of a post the caller has claimed
// (status 'publishing'). Targets run one after another; a failure on one
// doesn't stop the others.
async function publishClaimed(id) {
  const post = store.getPost(id);
  // Account problems (expired, too long) are recorded per target below, so
  // the other accounts still get the post.
  if (!post.targets.length) { store.setPostStatus(id, 'draft'); return { ok: false, error: 'Choose at least one account.' }; }

  for (const t of post.targets) {
    if (t.status === 'published') continue;
    const p = PLATFORMS[t.platform];
    const account = store.getAccountWithToken(t.account_id);
    const text = textFor(post, t.platform);
    if (!p || !account) { store.updateTarget(t.id, { status: 'failed', error: 'Account is no longer connected.' }); continue; }
    if (account.expired) { store.updateTarget(t.id, { status: 'failed', error: 'Sign-in expired. Reconnect the account, then retry.' }); continue; }
    const len = lengthFor(p, text, post.link);
    if (len > p.maxChars) { store.updateTarget(t.id, { status: 'failed', error: `Too long: ${len} of ${p.maxChars} characters.` }); continue; }

    store.updateTarget(t.id, { status: 'publishing', error: '' });
    try {
      await freshToken(p, account);
      const r = await p.publish({ account, text, link: post.link.trim(), image_path: post.image_path });
      store.updateTarget(t.id, { status: 'published', remote_id: r.remote_id || '', remote_url: r.remote_url || '', published_at: new Date().toISOString() });
    } catch (err) {
      store.updateTarget(t.id, { status: 'failed', error: err.message || String(err) });
    }
  }

  const status = store.derivedStatus(id);
  store.setPostStatus(id, status, { published_at: status === 'published' || status === 'partial' ? new Date().toISOString() : null });
  const done = store.getPost(id);
  return { ok: status === 'published', post: done, error: status === 'published' ? undefined : failureSummary(done) };
}

// Renews the access token in place when it's close to expiring. One refresh
// per account at a time: X rotates refresh tokens, so two refreshes racing
// with the same old token would leave one of them holding a dead one.
const refreshing = new Map();
async function freshToken(p, account) {
  if (!p.refresh || !account.refresh_token || !account.expires_at) return;
  if (new Date(account.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) return;
  if (!refreshing.has(account.id)) {
    const job = (async () => {
      const latest = store.getAccountWithToken(account.id); // another publish may have refreshed already
      if (latest.expires_at && new Date(latest.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) return latest;
      const tokens = await p.refresh({ account: latest, ...appConfig(providerOf(p.id)) });
      store.updateTokens(account.id, tokens);
      return { ...latest, ...tokens };
    })().finally(() => refreshing.delete(account.id));
    refreshing.set(account.id, job);
  }
  const fresh = await refreshing.get(account.id);
  Object.assign(account, { token: fresh.token, refresh_token: fresh.refresh_token, expires_at: fresh.expires_at });
}

const providerOf = (platform) => Object.values(PROVIDERS).find(p => p.platforms.includes(platform)).id;

function failureSummary(post) {
  return post.targets.filter(t => t.status === 'failed').map(t => `${t.account_name}: ${t.error}`).join(' ');
}

async function publishNow(id) {
  const post = store.getPost(id);
  if (!post) throw new Error('Post not found');
  const problems = validate(post);
  if (problems.length) return { ok: false, error: problems.join(' '), problems };
  if (!store.claimPost(id)) return { ok: false, error: 'This post is already being published.' };
  return publishClaimed(id);
}

// Called once a minute by the main scheduler.
async function runDue(now = new Date()) {
  const results = [];
  for (const { id, scheduled_at } of store.claimDuePosts(now.toISOString())) {
    if (now.getTime() - new Date(scheduled_at).getTime() > MISSED_AFTER_MS) {
      store.setPostStatus(id, 'missed');
      deps.notify('Social post missed', `A post scheduled for ${new Date(scheduled_at).toLocaleString()} wasn't published because MailWave was closed. Open Social to publish or reschedule it.`);
      results.push({ id, missed: true });
      continue;
    }
    const r = await publishClaimed(id);
    if (!r.ok) deps.notify('Social post failed', r.error || 'A scheduled post could not be published.');
    results.push({ id, ok: r.ok });
  }
  return results;
}

// At startup: clean up posts interrupted by a crash or quit.
function init() {
  store.recoverInterrupted();
}

module.exports = {
  PLATFORMS, PROVIDERS, deps, init,
  getConfig, saveAppConfig, connect, cancelConnect: oauth.cancel, listAccounts, deleteAccount: store.deleteAccount,
  listPosts: store.listPosts, savePost, deletePost: store.deletePost, schedule, unschedule, publishNow, runDue, validate, textFor,
};
