// X (Twitter) through a fake X API: PKCE sign-in for public and confidential
// clients, X's character counting, text/link/image posts, and the two-hour
// token being refreshed (and rotated) before publishing.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubModules, tempWorkspace, load } = require('./helpers');

const secrets = { seal: (x) => x ? `sealed:${x}` : '', unseal: (x) => String(x || '').replace(/^sealed:/, '') };
stubModules({ './workspace': tempWorkspace({ social_x_client_id: 'cid', social_x_client_secret: '' }), '../secrets': secrets, './secrets': secrets });
load('db.js');
const social = load('social/index.js');
const store  = load('social/store.js');
const x      = load('social/x.js');

const img = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-img-')), 'photo.jpg');
fs.writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff]));

const calls = [];
let failStatus = null;
let refreshCount = 0;
x.deps.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const body = opts.body instanceof FormData ? Object.fromEntries([...opts.body.keys()].map(k => [k, opts.body.get(k)]))
             : opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body)
             : opts.body ? JSON.parse(opts.body) : {};
  calls.push({ method: opts.method || 'GET', path: u.pathname, headers: opts.headers || {}, body });
  const ok = (data, status = 200) => ({ ok: true, status, json: async () => data });
  if (failStatus) return { ok: false, status: failStatus, json: async () => ({ title: 'Payment Required', detail: 'CreditsDepleted' }) };
  if (u.pathname === '/2/oauth2/token') {
    if (body.grant_type === 'refresh_token') { refreshCount++; return ok({ access_token: `access-${refreshCount + 1}`, refresh_token: `refresh-${refreshCount + 1}`, expires_in: 7200 }); }
    return ok({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 7200 });
  }
  if (u.pathname === '/2/users/me') return ok({ data: { id: '42', name: 'The Clinic', username: 'clinic', profile_image_url: 'https://x/pic.jpg' } });
  if (u.pathname === '/2/media/upload') return ok({ data: { id: '9001', media_key: '3_9001' } });
  if (u.pathname === '/2/tweets') return ok({ data: { id: '1234567890', text: body.text } }, 201);
  return { ok: false, status: 404, json: async () => ({ detail: 'unknown ' + u.pathname }) };
};

const fakeOauth = { waitForCode: async ({ buildAuthUrl }) => { fakeOauth.url = new URL(buildAuthUrl('st')); return 'the-code'; } };

test('X counts links as 23 and wide characters as 2', () => {
  assert.equal(x.countChars('hello'), 5);
  assert.equal(x.countChars('see https://example.org/a/very/long/path/that/goes/on?and=on'), 4 + 23);
  assert.equal(x.countChars('日本'), 4);
  assert.equal(x.countChars('hi 👋'), 5);
  assert.equal(x.postText('Open day', 'https://e.org'), 'Open day\n\nhttps://e.org');
  assert.equal(x.postText('Open day https://e.org', 'https://e.org'), 'Open day https://e.org');
});

let account;
test('public client sign-in: PKCE S256, client_id in the body, no Basic auth', async () => {
  const result = await x.connect({ clientId: 'cid', clientSecret: '', oauth: fakeOauth, openUrl: () => {} });
  const q = fakeOauth.url.searchParams;
  assert.equal(fakeOauth.url.origin + fakeOauth.url.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('scope'), /tweet\.write/); assert.match(q.get('scope'), /offline\.access/); assert.match(q.get('scope'), /media\.write/);
  assert.equal(q.get('redirect_uri'), 'http://127.0.0.1:47619/x/callback');

  const tok = calls.find(c => c.path === '/2/oauth2/token');
  assert.equal(tok.body.code, 'the-code');
  assert.equal(tok.body.client_id, 'cid');
  assert.equal(tok.headers.Authorization, undefined);
  const expected = crypto.createHash('sha256').update(tok.body.code_verifier).digest('base64url');
  assert.equal(q.get('code_challenge'), expected, 'challenge is SHA-256 of the verifier');

  assert.deepEqual([result.platform, result.account_id, result.name, result.token, result.refresh_token], ['x', '42', '@clinic', 'access-1', 'refresh-1']);
  account = store.upsertAccount(result);
  const listed = social.listAccounts().find(a => a.id === account.id);
  assert.equal(listed.renews, true);
  assert.equal(listed.expiring, false, 'a two-hour token that renews itself is not "expiring"');
  assert.equal(social.getConfig().providers.find(p => p.id === 'x').secretOptional, true);
});

test('confidential client sign-in sends the secret as HTTP Basic auth', async () => {
  calls.length = 0;
  await x.connect({ clientId: 'cid', clientSecret: 'shh', oauth: fakeOauth, openUrl: () => {} });
  const tok = calls.find(c => c.path === '/2/oauth2/token');
  assert.equal(tok.headers.Authorization, `Basic ${Buffer.from('cid:shh').toString('base64')}`);
});

test('text post puts the link in the text; image post uploads the image first', async () => {
  calls.length = 0;
  let r = await social.publishNow(social.savePost({ text: 'Open day Saturday', link: 'https://example.org/open', account_ids: [account.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  const tweet = calls.find(c => c.path === '/2/tweets');
  assert.equal(tweet.body.text, 'Open day Saturday\n\nhttps://example.org/open');
  assert.equal(tweet.headers.Authorization, 'Bearer access-1');
  assert.equal(r.post.targets[0].remote_url, 'https://x.com/clinic/status/1234567890');

  calls.length = 0;
  r = await social.publishNow(social.savePost({ text: 'With photo', image_path: img, account_ids: [account.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(calls.map(c => c.path), ['/2/media/upload', '/2/tweets']);
  assert.equal(calls[0].body.media_category, 'tweet_image');
  assert.ok(calls[0].body.media instanceof Blob);
  assert.deepEqual(calls[1].body.media, { media_ids: ['9001'] });
});

test('an expired access token is refreshed before publishing, and the rotated tokens are saved', async () => {
  store.updateTokens(account.id, { token: 'access-1', refresh_token: 'refresh-1', expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(social.listAccounts().find(a => a.id === account.id).expired, false, 'refreshable, so not expired');
  calls.length = 0;
  const r = await social.publishNow(social.savePost({ text: 'After refresh', account_ids: [account.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  const ref = calls.find(c => c.path === '/2/oauth2/token');
  assert.deepEqual([ref.body.grant_type, ref.body.refresh_token], ['refresh_token', 'refresh-1']);
  assert.equal(calls.find(c => c.path === '/2/tweets').headers.Authorization, 'Bearer access-2');
  const saved = store.getAccountWithToken(account.id);
  assert.deepEqual([saved.token, saved.refresh_token], ['access-2', 'refresh-2']);
  assert.ok(new Date(saved.expires_at) > new Date(Date.now() + 3600000));

  // Still fresh: no second refresh.
  calls.length = 0;
  await social.publishNow(social.savePost({ text: 'No refresh needed', account_ids: [account.id] }).post.id);
  assert.equal(calls.filter(c => c.path === '/2/oauth2/token').length, 0);
});

test('too long with the link, and out of credits, are reported clearly', async () => {
  const text = 'a'.repeat(260); // 260 + 2 newlines + 23 for the link = 285
  let r = await social.publishNow(social.savePost({ text, link: 'https://example.org', account_ids: [account.id] }).post.id);
  assert.match(r.error, /285 characters with the link, the limit is 280/);

  failStatus = 402;
  r = await social.publishNow(social.savePost({ text: 'x', account_ids: [account.id] }).post.id);
  failStatus = null;
  assert.equal(r.post.status, 'failed');
  assert.match(r.post.targets[0].error, /out of API credits/);
});
