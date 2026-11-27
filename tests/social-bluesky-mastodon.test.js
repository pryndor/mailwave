// Bluesky and Mastodon through fake servers: form sign-in (app password /
// server name), Bluesky facets, link cards and session refresh, Mastodon app
// registration, per-server limits, image processing and idempotency.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubModules, tempWorkspace, load } = require('./helpers');

const secrets = { seal: (x) => x ? `sealed:${x}` : '', unseal: (x) => String(x || '').replace(/^sealed:/, '') };
// Stand-in for the browser round trip: hand back a code straight away.
const fakeOauth = { waitForCode: async ({ buildAuthUrl }) => { fakeOauth.url = new URL(buildAuthUrl('st')); return 'mcode'; }, cancel: () => {} };
stubModules({ './workspace': tempWorkspace({}), '../secrets': secrets, './secrets': secrets, './oauth': fakeOauth });
load('db.js');
const social   = load('social/index.js');
const store    = load('social/store.js');
const bluesky  = load('social/bluesky.js');
const mastodon = load('social/mastodon.js');
const text     = load('social/text.js');

const img = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-img-')), 'photo.png');
fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const jwt = (expSecondsFromNow, tag) => ['h', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, tag })).toString('base64url'), 's'].join('.');

const calls = [];
const record = (url, opts = {}) => {
  const u = new URL(url);
  let body = {};
  if (opts.body instanceof FormData) body = Object.fromEntries([...opts.body.keys()].map(k => [k, opts.body.get(k)]));
  else if (Buffer.isBuffer(opts.body)) body = { bytes: opts.body.length };
  else if (typeof opts.body === 'string') body = JSON.parse(opts.body);
  const c = { host: u.host, method: opts.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), headers: opts.headers || {}, body };
  calls.push(c);
  return c;
};
const ok = (data, status = 200, headers = {}) => ({ ok: true, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, json: async () => data, text: async () => data, arrayBuffer: async () => new ArrayBuffer(10) });

// ── Fake Bluesky ─────────────────────────────────────────────────────────────
let refreshes = 0;
bluesky.deps.fetch = async (url, opts) => {
  const c = record(url, opts);
  if (c.host === 'example.org') return ok('<html><head><meta property="og:title" content="Open Day &amp; Camp"><meta property="og:description" content="Free checkups"><meta property="og:image" content="/card.jpg"></head></html>', 200, { 'content-type': 'text/html' });
  const m = c.path.replace('/xrpc/', '');
  if (m === 'com.atproto.server.createSession') {
    if (c.body.password !== 'app-pass') return { ok: false, status: 401, json: async () => ({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }) };
    return ok({ did: 'did:plc:abc', handle: 'clinic.bsky.social', accessJwt: jwt(7200, 'a1'), refreshJwt: 'r1', didDoc: { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example.net' }] } });
  }
  if (m === 'app.bsky.actor.getProfile') return ok({ avatar: 'https://cdn/av.jpg', displayName: 'Clinic' });
  if (m === 'com.atproto.server.refreshSession') { refreshes++; return ok({ did: 'did:plc:abc', handle: 'clinic.bsky.social', accessJwt: jwt(7200, 'a2'), refreshJwt: 'r2' }); }
  if (m === 'com.atproto.repo.uploadBlob') return ok({ blob: { $type: 'blob', ref: { $link: 'bafy' + calls.length }, mimeType: c.headers['Content-Type'], size: 4 } });
  if (m === 'com.atproto.repo.createRecord') return ok({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', cid: 'c' });
  return { ok: false, status: 404, json: async () => ({ message: 'unknown ' + m }) };
};
// The card image lives on example.org too; route it by path.
const bskyFetch = bluesky.deps.fetch;
bluesky.deps.fetch = async (url, opts) => new URL(url).pathname === '/card.jpg'
  ? (record(url, opts), ok(null, 200, { 'content-type': 'image/jpeg' })) : bskyFetch(url, opts);

// ── Fake Mastodon ────────────────────────────────────────────────────────────
let mediaPolls = 0;
mastodon.deps.sleep = async () => {};
mastodon.deps.fetch = async (url, opts) => {
  const c = record(url, opts);
  if (c.path === '/api/v1/apps') return ok({ client_id: 'mcid', client_secret: 'msecret' });
  if (c.path === '/oauth/token') return ok({ access_token: 'mtoken', token_type: 'Bearer' });
  if (c.path === '/api/v1/accounts/verify_credentials') return ok({ id: '77', username: 'clinic', avatar_static: 'https://cdn/m.png' });
  if (c.path === '/api/v2/instance') return ok({ configuration: { statuses: { max_characters: 1000, characters_reserved_per_url: 23 } } });
  if (c.path === '/api/v2/media') return ok({ id: 'MED1', url: null }, 202);
  if (c.path === '/api/v1/media/MED1') return ++mediaPolls < 2 ? ok({ id: 'MED1', url: null }, 206) : ok({ id: 'MED1', url: 'https://files/m.png' });
  if (c.path === '/api/v1/statuses') return ok({ id: '1100', url: 'https://social.example/@clinic/1100' });
  return { ok: false, status: 404, json: async () => ({ error: 'unknown ' + c.path }) };
};

social.deps.openUrl = () => {};

test('counting: Bluesky graphemes, Mastodon links and remote mentions', () => {
  assert.equal(text.countGraphemes('hi 👋🏽'), 4);
  assert.equal(text.countMastodon('hi @bob@example.social see https://example.org/very/long/path/indeed'), 'hi @bob see '.length + 23);
});

test('Bluesky facets cover links and hashtags with UTF-8 byte offsets', () => {
  const t = 'Café open! #health https://example.org/x. #2026 #ok';
  const f = bluesky.facets(t);
  const slice = (i) => Buffer.from(t).subarray(i.byteStart, i.byteEnd).toString();
  const link = f.find(x => x.features[0].uri);
  assert.equal(slice(link.index), 'https://example.org/x');
  assert.equal(link.features[0].uri, 'https://example.org/x');
  const tags = f.filter(x => x.features[0].tag).map(x => [x.features[0].tag, slice(x.index)]);
  assert.deepEqual(tags, [['health', '#health'], ['ok', '#ok']], 'number-only tags are not tags');
});

let bsky, masto;
test('Bluesky sign-in through the service', async () => {
  await assert.rejects(social.connect({ provider: 'bluesky', input: { identifier: 'clinic.bsky.social', password: 'main-pass' } }), /app password/);
  calls.length = 0;
  const r = await social.connect({ provider: 'bluesky', input: { identifier: '@clinic.bsky.social', password: 'app-pass' } });
  bsky = r.account;
  assert.equal(calls[0].host, 'bsky.social');
  assert.equal(calls[0].body.identifier, 'clinic.bsky.social');
  assert.equal(calls[1].host, 'pds.example.net', 'profile is read from the account\'s own PDS');
  assert.deepEqual([bsky.name, bsky.account_id, bsky.meta.pds, bsky.renews], ['@clinic.bsky.social', 'did:plc:abc', 'https://pds.example.net', true]);
  const withToken = store.getAccountWithToken(bsky.id);
  assert.equal(withToken.refresh_token, 'r1');
  assert.ok(Math.abs(new Date(withToken.expires_at) - (Date.now() + 7200000)) < 5000, 'expiry read from the JWT');
  assert.ok(!JSON.stringify(store.listAccounts()).includes('app-pass'), 'app password is not stored');
  assert.equal(social.getConfig().providers.find(p => p.id === 'bluesky').form.length, 3);
});

test('Bluesky: a link becomes a preview card with title, description and thumbnail', async () => {
  calls.length = 0;
  const r = await social.publishNow(social.savePost({ text: 'Open day #health', link: 'https://example.org/open', account_ids: [bsky.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  const rec = calls.find(c => c.path.endsWith('createRecord')).body;
  assert.equal(rec.repo, 'did:plc:abc');
  assert.equal(rec.record.text, 'Open day #health', 'link not added to the text when it is a card');
  assert.deepEqual(rec.record.facets.map(f => f.features[0].tag), ['health']);
  const ext = rec.record.embed.external;
  assert.deepEqual([rec.record.embed.$type, ext.uri, ext.title, ext.description], ['app.bsky.embed.external', 'https://example.org/open', 'Open Day & Camp', 'Free checkups']);
  assert.ok(ext.thumb?.ref, 'thumbnail uploaded as a blob');
  assert.equal(r.post.targets[0].remote_url, 'https://bsky.app/profile/clinic.bsky.social/post/3kxyz');
});

test('Bluesky: an image post puts the link in the text, and the session is refreshed when expired', async () => {
  store.updateTokens(bsky.id, { token: jwt(-10, 'old'), refresh_token: 'r1', expires_at: new Date(Date.now() - 10000).toISOString() });
  calls.length = 0;
  const r = await social.publishNow(social.savePost({ text: 'Photo', link: 'https://example.org/open', image_path: img, account_ids: [bsky.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  assert.equal(refreshes, 1);
  const refresh = calls.find(c => c.path.endsWith('refreshSession'));
  assert.equal(refresh.headers.Authorization, 'Bearer r1');
  const rec = calls.find(c => c.path.endsWith('createRecord'));
  assert.match(rec.headers.Authorization, /^Bearer /);
  assert.equal(rec.body.record.text, 'Photo\n\nhttps://example.org/open');
  assert.equal(rec.body.record.embed.$type, 'app.bsky.embed.images');
  assert.equal(rec.body.record.facets[0].features[0].uri, 'https://example.org/open');
  assert.equal(store.getAccountWithToken(bsky.id).refresh_token, 'r2');
});

test('Bluesky: over 300 graphemes is caught before publishing', async () => {
  const r = await social.publishNow(social.savePost({ text: 'é'.repeat(301), account_ids: [bsky.id] }).post.id);
  assert.match(r.error, /301 characters, the limit is 300/);
});

test('Mastodon: registers the app on the server, signs in, reads the server\'s limit', async () => {
  calls.length = 0;
  const r = await social.connect({ provider: 'mastodon', input: { server: 'https://Social.Example/' } });
  masto = r.account;
  assert.deepEqual(calls.map(c => `${c.host} ${c.path}`), [
    'social.example /api/v1/apps', 'social.example /oauth/token', 'social.example /api/v1/accounts/verify_credentials', 'social.example /api/v2/instance',
  ]);
  assert.equal(calls[0].body.redirect_uris, 'http://127.0.0.1:47621/mastodon/callback');
  assert.equal(fakeOauth.url.origin + fakeOauth.url.pathname, 'https://social.example/oauth/authorize');
  assert.deepEqual([fakeOauth.url.searchParams.get('client_id'), fakeOauth.url.searchParams.get('scope')], ['mcid', 'read:accounts write:statuses write:media']);
  assert.deepEqual([masto.name, masto.meta.max_chars, masto.renews, masto.expires_at], ['@clinic@social.example', 1000, false, null]);
  assert.equal(calls[1].body.client_secret, 'msecret');
});

test('Mastodon publish: link in the text, image processed before posting, idempotency key, server limit', async () => {
  calls.length = 0;
  const r = await social.publishNow(social.savePost({ text: 'Open day', link: 'https://example.org/open', image_path: img, account_ids: [masto.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  const paths = calls.map(c => c.path);
  assert.deepEqual(paths, ['/api/v2/media', '/api/v1/media/MED1', '/api/v1/media/MED1', '/api/v1/statuses']);
  const st = calls.at(-1);
  assert.deepEqual([st.body.status, st.body.media_ids, st.body.visibility], ['Open day\n\nhttps://example.org/open', ['MED1'], 'public']);
  assert.match(st.headers['Idempotency-Key'], /^[0-9a-f]{64}$/);
  assert.equal(st.headers.Authorization, 'Bearer mtoken');
  assert.equal(r.post.targets[0].remote_url, 'https://social.example/@clinic/1100');

  // 900 characters fits this server's 1000, 1001 doesn't.
  let v = social.validate(social.savePost({ text: 'a'.repeat(900), account_ids: [masto.id] }).post);
  assert.deepEqual(v, []);
  v = social.validate(social.savePost({ text: 'a'.repeat(1001), account_ids: [masto.id] }).post);
  assert.match(v.join(' '), /1001 characters, the limit is 1000/);
});

test('Mastodon: a bad server name is rejected before any request', async () => {
  calls.length = 0;
  await assert.rejects(social.connect({ provider: 'mastodon', input: { server: 'not a server' } }), /Enter your Mastodon server/);
  assert.equal(calls.length, 0);
  assert.equal(mastodon.normalizeServer('@me@Mastodon.Social'), 'mastodon.social');
});
