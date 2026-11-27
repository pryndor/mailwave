// Social posting: accounts and tokens, publishing to several accounts,
// scheduling (due, missed, crash recovery), LinkedIn request shape and the
// OAuth callback server. LinkedIn's API is faked; nothing leaves the machine.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { stubModules, tempWorkspace, load } = require('./helpers');

const secrets = { seal: (x) => x ? `sealed:${x}` : '', unseal: (x) => String(x || '').replace(/^sealed:/, '') };
stubModules({
  './workspace': tempWorkspace({ social_linkedin_client_id: 'cid', social_linkedin_client_secret: 'sealed:csecret' }),
  '../secrets': secrets,
  './secrets': secrets,
});
const db       = load('db.js');
const store    = load('social/store.js');
const social   = load('social/index.js');
const linkedin = load('social/linkedin.js');

// Fake LinkedIn: records requests, answers posts with an id header.
const requests = [];
let failPosts = false;
linkedin.deps.fetch = async (url, opts = {}) => {
  requests.push({ url, opts });
  const res = (status, body, headers = {}) => ({
    ok: status < 400, status, json: async () => body,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  });
  if (url.endsWith('/rest/posts')) return failPosts ? res(401, { message: 'expired' }) : res(201, {}, { 'x-restli-id': `urn:li:share:${requests.length}` });
  if (url.includes('accessToken')) return res(200, { access_token: 'tok-new', expires_in: 5184000 });
  if (url.includes('userinfo')) return res(200, { sub: 'abc', name: 'Jane Doe', picture: 'https://x/p.jpg' });
  return res(404, {});
};

const notes = [];
social.deps.notify = (title, body) => notes.push({ title, body });

const future = (ms) => new Date(Date.now() + ms).toISOString();
const later  = new Date(Date.now() + 90 * 86400000).toISOString();

test('tokens are sealed in the DB and never returned by listAccounts', () => {
  const acc = store.upsertAccount({ platform: 'linkedin', account_id: 'urn:li:person:abc', name: 'Jane', token: 'secret-token', expires_at: later });
  const raw = db.handle.prepare('SELECT token FROM social_accounts WHERE id = ?').get(acc.id);
  assert.equal(raw.token, 'sealed:secret-token');
  const listed = social.listAccounts()[0];
  assert.equal(listed.token, undefined);
  assert.equal(listed.refresh_token, undefined);
  assert.equal(store.getAccountWithToken(acc.id).token, 'secret-token');
  // Reconnecting updates the same row, so scheduled posts keep their target.
  const again = store.upsertAccount({ platform: 'linkedin', account_id: 'urn:li:person:abc', name: 'Jane D', token: 't2', expires_at: later });
  assert.equal(again.id, acc.id);
  assert.equal(social.listAccounts().length, 1);
});

test('app secret is sealed and not exposed by getConfig', () => {
  const c = social.getConfig().providers.find(p => p.id === 'linkedin');
  assert.equal(c.clientId, 'cid');
  assert.equal(c.hasSecret, true);
  assert.equal(c.clientSecret, undefined);
  social.saveAppConfig({ platform: 'linkedin', clientId: ' cid2 ', clientSecret: 'new' });
  const s = require('../electron/settings').getAll();
  assert.equal(s.social_linkedin_client_id, 'cid2');
  assert.equal(s.social_linkedin_client_secret, 'sealed:new');
  social.saveAppConfig({ platform: 'linkedin', clientId: 'cid' }); // secret omitted = kept
  assert.equal(require('../electron/settings').getAll().social_linkedin_client_secret, 'sealed:new');
});

test('validate catches empty, too long, expired and bad links', () => {
  const acc = social.listAccounts()[0];
  const { post } = social.savePost({ text: '', account_ids: [acc.id] });
  assert.match(social.validate(post).join(' '), /empty/);
  const long = social.savePost({ id: post.id, text: 'x'.repeat(3001), account_ids: [acc.id] }).post;
  assert.match(social.validate(long).join(' '), /3001 characters/);
  const variant = social.savePost({ id: post.id, text: 'x'.repeat(3001), variants: { linkedin: 'short' }, account_ids: [acc.id] }).post;
  assert.deepEqual(social.validate(variant), [], 'a platform version overrides the main text');
  const badLink = social.savePost({ id: post.id, text: 'hi', link: 'example.com', account_ids: [acc.id] }).post;
  assert.match(social.validate(badLink).join(' '), /http/);
  assert.match(social.validate(social.savePost({ id: post.id, text: 'hi', account_ids: [] }).post).join(' '), /at least one account/);
  social.deletePost(post.id);
});

test('publishNow sends an escaped LinkedIn post with a link card and records the URL', async () => {
  requests.length = 0;
  const acc = social.listAccounts()[0];
  const { post } = social.savePost({ text: 'Big news (really) @ our clinic #health', link: 'https://www.drugvigil.com/x', account_ids: [acc.id] });
  const r = await social.publishNow(post.id);
  assert.equal(r.ok, true, r.error);
  const req = requests.find(q => q.url.endsWith('/rest/posts'));
  const body = JSON.parse(req.opts.body);
  assert.equal(body.author, 'urn:li:person:abc');
  assert.equal(body.commentary, 'Big news \\(really\\) \\@ our clinic #health');
  assert.deepEqual(body.content, { article: { source: 'https://www.drugvigil.com/x', title: 'drugvigil.com' } });
  assert.equal(req.opts.headers.Authorization, 'Bearer t2');
  assert.match(req.opts.headers['LinkedIn-Version'], /^\d{6}$/);
  assert.equal(r.post.status, 'published');
  assert.match(r.post.targets[0].remote_url, /^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:share:/);
  // Publishing again does nothing new: the target is already published.
  requests.length = 0;
  await social.publishNow(post.id);
  assert.equal(requests.filter(q => q.url.endsWith('/rest/posts')).length, 0);
});

test('a failing account is recorded per target, the post shows failed', async () => {
  failPosts = true;
  const acc = social.listAccounts()[0];
  const { post } = social.savePost({ text: 'will fail', account_ids: [acc.id] });
  const r = await social.publishNow(post.id);
  failPosts = false;
  assert.equal(r.ok, false);
  assert.equal(r.post.status, 'failed');
  assert.match(r.post.targets[0].error, /Reconnect/);
  // Retry succeeds once the problem is fixed.
  const again = await social.publishNow(post.id);
  assert.equal(again.post.status, 'published');
});

test('schedule rejects past times; runDue publishes due posts once and holds very late ones', async () => {
  const acc = social.listAccounts()[0];
  const { post } = social.savePost({ text: 'scheduled one', account_ids: [acc.id] });
  assert.throws(() => social.schedule({ id: post.id, scheduled_at: future(-3600000) }), /passed/);
  assert.equal(social.schedule({ id: post.id, scheduled_at: future(60000) }).post.status, 'scheduled');
  assert.deepEqual(await social.runDue(new Date()), [], 'not due yet');
  const due = await social.runDue(new Date(Date.now() + 120000));
  assert.deepEqual(due, [{ id: post.id, ok: true }]);
  assert.deepEqual(await social.runDue(new Date(Date.now() + 240000)), [], 'never published twice');

  const { post: late } = social.savePost({ text: 'late one', account_ids: [acc.id] });
  social.schedule({ id: late.id, scheduled_at: future(60000) });
  const r = await social.runDue(new Date(Date.now() + 7 * 3600000));
  assert.deepEqual(r, [{ id: late.id, missed: true }]);
  assert.equal(store.getPost(late.id).status, 'missed');
  assert.match(notes.at(-1).title, /missed/);
});

test('expired account: scheduled post fails with a reconnect message, others still go out', async () => {
  const fresh = store.upsertAccount({ platform: 'linkedin', account_id: 'urn:li:person:zzz', name: 'Other', token: 'tz', expires_at: later });
  const old = store.upsertAccount({ platform: 'linkedin', account_id: 'urn:li:person:old', name: 'Old', token: 'to', expires_at: later });
  const { post } = social.savePost({ text: 'two accounts', account_ids: [fresh.id, old.id] });
  social.schedule({ id: post.id, scheduled_at: future(60000) });
  db.handle.prepare('UPDATE social_accounts SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), old.id);
  await social.runDue(new Date(Date.now() + 120000));
  const p = store.getPost(post.id);
  assert.equal(p.status, 'partial');
  assert.match(p.targets.find(t => t.account_id === old.id).error, /expired/);
  assert.equal(p.targets.find(t => t.account_id === fresh.id).status, 'published');
});

test('a post interrupted mid-publish is marked failed, never retried automatically', () => {
  const acc = social.listAccounts()[0];
  const { post } = social.savePost({ text: 'crash', account_ids: [acc.id] });
  store.claimPost(post.id);
  store.updateTarget(post.targets[0].id, { status: 'publishing' });
  social.init();
  const p = store.getPost(post.id);
  assert.equal(p.status, 'failed');
  assert.match(p.targets[0].error, /posted twice/);
});

test('editing keeps published targets and deleting an account removes its targets', () => {
  const [a, b] = social.listAccounts();
  const { post } = social.savePost({ text: 'edit me', account_ids: [a.id, b.id] });
  store.updateTarget(post.targets.find(t => t.account_id === a.id).id, { status: 'published' });
  const edited = social.savePost({ id: post.id, text: 'edited', account_ids: [] }).post;
  assert.deepEqual(edited.targets.map(t => t.account_id), [a.id], 'published target survives');
  social.deleteAccount(a.id);
  assert.equal(store.getPost(post.id).targets.length, 0);
});

test('LinkedIn connect: OAuth callback with matching state, token exchange, profile', async () => {
  const oauth = load('social/oauth.js');
  const port = 47616;
  let authUrl;
  const result = await linkedin.connect({
    clientId: 'cid', clientSecret: 'cs',
    oauth: { waitForCode: (o) => oauth.waitForCode({ ...o, port }) },
    openUrl: (url) => {
      authUrl = new URL(url);
      const state = authUrl.searchParams.get('state');
      // A forged callback is ignored; the real one completes the sign-in.
      http.get(`http://127.0.0.1:${port}/linkedin/callback?code=evil&state=wrong`, (res) => {
        res.resume();
        res.on('end', () => http.get(`http://127.0.0.1:${port}/linkedin/callback?code=good&state=${state}`, r => r.resume()));
      });
    },
  });
  assert.equal(authUrl.searchParams.get('scope'), 'openid profile w_member_social');
  assert.equal(authUrl.searchParams.get('redirect_uri'), linkedin.REDIRECT_URI);
  const tokenReq = requests.find(q => q.url.includes('accessToken'));
  assert.equal(new URLSearchParams(tokenReq.opts.body.toString()).get('code'), 'good');
  assert.equal(result.account_id, 'urn:li:person:abc');
  assert.equal(result.token, 'tok-new');
  assert.ok(new Date(result.expires_at) > new Date(Date.now() + 59 * 86400000));
});

test('escapeCommentary escapes every reserved character', () => {
  assert.equal(linkedin.escapeCommentary('a\\b|c{d}e@f[g]h(i)j<k>l*m_n~o'), 'a\\\\b\\|c\\{d\\}e\\@f\\[g\\]h\\(i\\)j\\<k\\>l\\*m\\_n\\~o');
});
