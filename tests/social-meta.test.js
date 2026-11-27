// Facebook Pages and Instagram through a fake Graph API: sign-in turns Pages
// and linked Instagram accounts into separate accounts, Facebook text and
// photo posts, and Instagram's host-on-Facebook, container, publish flow.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubModules, tempWorkspace, load } = require('./helpers');

const secrets = { seal: (x) => x ? `sealed:${x}` : '', unseal: (x) => String(x || '').replace(/^sealed:/, '') };
stubModules({ './workspace': tempWorkspace({ social_meta_client_id: 'app', social_meta_client_secret: 'sealed:shh' }), '../secrets': secrets, './secrets': secrets });
load('db.js');
const social = load('social/index.js');
const meta   = load('social/meta.js');

const img = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mw-img-')), 'photo.png');
fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const calls = [];
let containerPolls = 0;
let failWith = null;
meta.deps.sleep = async () => {};
meta.deps.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const method = opts.method || 'GET';
  const body = opts.body instanceof FormData ? Object.fromEntries([...opts.body.keys()].map(k => [k, opts.body.get(k)]))
             : opts.body ? Object.fromEntries(new URLSearchParams(opts.body.toString())) : {};
  calls.push({ method, path: u.pathname.replace(/^\/v[\d.]+/, ''), query: Object.fromEntries(u.searchParams), body });
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  const p = calls.at(-1).path;
  if (failWith) return { ok: false, status: 400, json: async () => ({ error: failWith }) };
  if (p === '/oauth/access_token') return ok({ access_token: u.searchParams.get('grant_type') ? 'long-user' : 'short-user' });
  if (p === '/me/accounts') return ok({ data: [
    { id: 'P1', name: 'Clinic Page', access_token: 'page-tok-1', picture: { data: { url: 'https://x/p1.jpg' } }, instagram_business_account: { id: 'IG1', username: 'clinic', profile_picture_url: 'https://x/ig.jpg' } },
    { id: 'P2', name: 'Second Page', access_token: 'page-tok-2' },
  ] });
  if (p === '/P1/feed') return ok({ id: 'P1_100' });
  if (p === '/P1/photos') return ok(body.published === 'false' ? { id: 'PH9' } : { id: 'PH1', post_id: 'P1_200' });
  if (p === '/PH9' && method === 'GET') return ok({ images: [{ width: 320, source: 'https://cdn/small.jpg' }, { width: 1080, source: 'https://cdn/big.jpg' }] });
  if (p === '/PH9' && method === 'DELETE') return ok({ success: true });
  if (p === '/IG1/media') return ok({ id: 'C1' });
  if (p === '/C1') return ok({ status_code: ++containerPolls < 3 ? 'IN_PROGRESS' : 'FINISHED' });
  if (p === '/IG1/media_publish') return ok({ id: 'M1' });
  if (p === '/M1') return ok({ permalink: 'https://www.instagram.com/p/abc/' });
  return { ok: false, status: 404, json: async () => ({ error: { message: 'unknown ' + p } }) };
};

// Stand-in for the browser round trip: hand back a code straight away.
const fakeOauth = { waitForCode: async ({ buildAuthUrl }) => { fakeOauth.url = buildAuthUrl('st'); return 'the-code'; } };

let accounts;
test('one Meta sign-in adds each Page and its linked Instagram account', async () => {
  const result = await meta.connect({ clientId: 'app', clientSecret: 'shh', oauth: fakeOauth, openUrl: () => {} });
  const scope = new URL(fakeOauth.url).searchParams.get('scope');
  assert.match(scope, /pages_manage_posts/); assert.match(scope, /instagram_content_publish/);
  assert.equal(calls.find(c => c.path === '/oauth/access_token' && c.query.code).query.code, 'the-code');
  assert.equal(calls.find(c => c.query.grant_type === 'fb_exchange_token').query.fb_exchange_token, 'short-user');
  assert.deepEqual(result.map(a => [a.platform, a.account_id, a.name, a.token]), [
    ['facebook', 'P1', 'Clinic Page', 'page-tok-1'],
    ['instagram', 'IG1', '@clinic', 'page-tok-1'],
    ['facebook', 'P2', 'Second Page', 'page-tok-2'],
  ]);
  assert.equal(result[1].meta.page_id, 'P1');

  // Through the service: stored, tokens hidden, config split into providers and publishers.
  const store = load('social/store.js');
  accounts = result.map(a => store.upsertAccount(a));
  assert.equal(social.listAccounts().filter(a => a.token).length, 0);
  const cfg = social.getConfig();
  assert.deepEqual(cfg.providers.find(p => p.id === 'meta').platforms, ['facebook', 'instagram']);
  assert.equal(cfg.publishers.find(p => p.id === 'instagram').requiresImage, true);
});

test('Facebook text post attaches the link; photo post puts the link in the text', async () => {
  const fb = accounts.find(a => a.account_id === 'P1');
  calls.length = 0;
  let r = await social.publishNow(social.savePost({ text: 'Open day Saturday', link: 'https://example.org/open', account_ids: [fb.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  const feed = calls.find(c => c.path === '/P1/feed');
  assert.deepEqual([feed.body.message, feed.body.link, feed.body.access_token], ['Open day Saturday', 'https://example.org/open', 'page-tok-1']);
  assert.equal(r.post.targets[0].remote_url, 'https://www.facebook.com/P1_100');

  calls.length = 0;
  r = await social.publishNow(social.savePost({ text: 'With photo', link: 'https://example.org/open', image_path: img, account_ids: [fb.id] }).post.id);
  const photo = calls.find(c => c.path === '/P1/photos');
  assert.equal(photo.body.message, 'With photo\n\nhttps://example.org/open');
  assert.equal(photo.body.published, 'true');
  assert.ok(photo.body.source instanceof Blob);
  assert.equal(r.post.targets[0].remote_url, 'https://www.facebook.com/P1_200');
});

test('Instagram: hosts the image on the Page unpublished, waits for the container, publishes, cleans up', async () => {
  const ig = accounts.find(a => a.platform === 'instagram');
  calls.length = 0;
  const r = await social.publishNow(social.savePost({ text: 'Caption #health', image_path: img, account_ids: [ig.id] }).post.id);
  assert.equal(r.ok, true, r.error);
  const seq = calls.map(c => `${c.method} ${c.path}`);
  assert.deepEqual(seq.filter(x => !x.startsWith('GET /C1')), ['POST /P1/photos', 'GET /PH9', 'POST /IG1/media', 'POST /IG1/media_publish', 'GET /M1', 'DELETE /PH9']);
  assert.equal(calls[0].body.published, 'false');
  const container = calls.find(c => c.path === '/IG1/media');
  assert.deepEqual([container.body.image_url, container.body.caption], ['https://cdn/big.jpg', 'Caption #health']);
  assert.equal(seq.filter(x => x === 'GET /C1').length, 3, 'polled until FINISHED');
  assert.equal(r.post.targets[0].remote_url, 'https://www.instagram.com/p/abc/');
});

test('Instagram without an image, too many hashtags, and an expired token are caught', async () => {
  const ig = accounts.find(a => a.platform === 'instagram');
  let r = await social.publishNow(social.savePost({ text: 'no image', account_ids: [ig.id] }).post.id);
  assert.match(r.error, /needs an image|add an image/);
  r = await social.publishNow(social.savePost({ text: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), image_path: img, account_ids: [ig.id] }).post.id);
  assert.match(r.error, /30 hashtags/);

  const fb = accounts.find(a => a.account_id === 'P2');
  failWith = { code: 190, message: 'Error validating access token' };
  r = await social.publishNow(social.savePost({ text: 'x', account_ids: [fb.id] }).post.id);
  failWith = null;
  assert.equal(r.post.status, 'failed');
  assert.match(r.post.targets[0].error, /Reconnect/);
});

test('no Pages shared gives a clear message', async () => {
  const orig = meta.deps.fetch;
  meta.deps.fetch = async (url, opts) => url.includes('/me/accounts')
    ? { ok: true, status: 200, json: async () => ({ data: [] }) } : orig(url, opts);
  await assert.rejects(meta.connect({ clientId: 'a', clientSecret: 'b', oauth: fakeOauth, openUrl: () => {} }), /No Facebook Pages/);
  meta.deps.fetch = orig;
});
