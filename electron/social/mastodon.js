// Mastodon: post to the user's account on any Mastodon server.
//
// No developer app to create by hand: the user types their server, MailWave
// registers itself there as an app (POST /api/v1/apps, which every server
// allows), then the usual browser sign-in returns a token. Mastodon tokens
// don't expire until the user revokes them.
//
// The character limit differs per server (500 by default), so it's read
// from the server at sign-in and kept with the account.
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { withLink, countMastodon } = require('./text');

const PORT          = 47621;
const CALLBACK_PATH = '/mastodon/callback';
const REDIRECT_URI  = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;
const SCOPES        = 'read:accounts write:statuses write:media';

const MAX_CHARS       = 500;
const IMAGE_TYPES     = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Swappable in tests.
const deps = { fetch: (...a) => fetch(...a), sleep: (ms) => new Promise(r => setTimeout(r, ms)) };

class MastodonError extends Error {
  constructor(message, { status, auth = false } = {}) { super(message); this.status = status; this.auth = auth; }
}

// "mastodon.social", "https://mastodon.social/", "@me@mastodon.social" → "mastodon.social"
function normalizeServer(s) {
  let v = String(s || '').trim().toLowerCase();
  if (/^@?[^@\s]+@[^@\s]+$/.test(v)) v = v.split('@').pop();
  v = v.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/.test(v)) throw new MastodonError('Enter your Mastodon server, for example mastodon.social.');
  return v;
}

async function api(server, method, endpoint, { token, json, form, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (json) { opts.body = JSON.stringify(json); opts.headers['Content-Type'] = 'application/json'; }
  if (form) opts.body = form;
  let res;
  try { res = await deps.fetch(`https://${server}${endpoint}`, opts); }
  catch { throw new MastodonError(`Could not reach ${server}. Check the server name and your internet connection.`); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data.error_description || data.error || `HTTP ${res.status}`;
    if (res.status === 401 || (res.status === 403 && /token|scope/i.test(msg))) {
      throw new MastodonError(`The ${server} sign-in was revoked or has expired. Reconnect on the Accounts tab.`, { status: res.status, auth: true });
    }
    if (res.status === 429) throw new MastodonError(`${server} rate limit reached. Try again later.`, { status: 429 });
    if (res.status === 422) throw new MastodonError(`${server} refused the post: ${msg}`, { status: 422 });
    throw new MastodonError(`${server} error ${res.status}: ${msg}`, { status: res.status });
  }
  return { data, status: res.status };
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

async function connect({ input = {}, oauth, openUrl }) {
  const server = normalizeServer(input.server);

  const { data: app } = await api(server, 'POST', '/api/v1/apps', {
    json: { client_name: 'MailWave', redirect_uris: REDIRECT_URI, scopes: SCOPES, website: 'https://github.com/pryndor/mailwave' },
  });
  const code = await oauth.waitForCode({
    port: PORT, path: CALLBACK_PATH, openUrl,
    buildAuthUrl: (state) => `https://${server}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: app.client_id, redirect_uri: REDIRECT_URI, scope: SCOPES, state })}`,
  });
  const { data: tok } = await api(server, 'POST', '/oauth/token', {
    json: { grant_type: 'authorization_code', code, client_id: app.client_id, client_secret: app.client_secret, redirect_uri: REDIRECT_URI, scope: SCOPES },
  });
  const { data: me } = await api(server, 'GET', '/api/v1/accounts/verify_credentials', { token: tok.access_token });

  // The server's own limits; older servers without /api/v2/instance use 500.
  let maxChars = MAX_CHARS, urlChars = 23;
  try {
    const { data: inst } = await api(server, 'GET', '/api/v2/instance');
    maxChars = inst.configuration?.statuses?.max_characters || maxChars;
    urlChars = inst.configuration?.statuses?.characters_reserved_per_url || urlChars;
  } catch {}

  return {
    platform: 'mastodon', account_id: `${me.id}@${server}`, name: `@${me.username}@${server}`, avatar: me.avatar_static || me.avatar || '',
    token: tok.access_token, refresh_token: '', expires_at: null,
    meta: { server, username: me.username, max_chars: maxChars, url_chars: urlChars },
  };
}

// ── Publishing ───────────────────────────────────────────────────────────────

async function uploadImage(server, token, imagePath) {
  const type = IMAGE_TYPES[path.extname(imagePath).toLowerCase()];
  if (!type) throw new MastodonError('Use a JPG, PNG, GIF or WEBP image.');
  let bytes;
  try { bytes = fs.readFileSync(imagePath); } catch { throw new MastodonError(`Can't read the image file: ${imagePath}`); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new MastodonError('The image is larger than 8 MB.');

  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), path.basename(imagePath));
  const { data, status } = await api(server, 'POST', '/api/v2/media', { token, form });
  // 202: the server is still processing the image; it can't be attached until it has a URL.
  if (status === 202 || !data.url) {
    for (let i = 0; ; i++) {
      await deps.sleep(1000);
      const { data: m, status: s } = await api(server, 'GET', `/api/v1/media/${data.id}`, { token });
      if (s === 200 && m.url) break;
      if (i >= 30) throw new MastodonError(`${server} took too long to process the image. Try again.`);
    }
  }
  return data.id;
}

async function publish({ account, text, link, image_path }) {
  const server = account.meta?.server;
  if (!server) throw new MastodonError('This Mastodon account is missing its server. Reconnect it on the Accounts tab.');
  const status = withLink(text, link);
  const body = { status, visibility: 'public' };
  if (image_path) body.media_ids = [await uploadImage(server, account.token, image_path)];
  // Mastodon remembers this key for an hour and won't post the same status
  // twice for it, which guards against a retry after a dropped connection.
  const key = crypto.createHash('sha256').update(`${account.account_id}\n${status}\n${image_path || ''}`).digest('hex');
  const { data } = await api(server, 'POST', '/api/v1/statuses', { token: account.token, json: body, headers: { 'Idempotency-Key': key } });
  return { remote_id: data.id, remote_url: data.url || '' };
}

module.exports = {
  id: 'mastodon', name: 'Mastodon', maxChars: MAX_CHARS, requiresImage: false, platforms: ['mastodon'],
  REDIRECT_URI,
  form: [{ key: 'server', label: 'Your server', placeholder: 'mastodon.social' }],
  connect, publish,
  postText: withLink,
  countChars: (text, account) => countMastodon(text, account?.meta?.url_chars || 23),
  limitFor: (account) => account?.meta?.max_chars || MAX_CHARS,
  counting: 'mastodon', linkInText: 'always',
  normalizeServer, MastodonError, deps,
};
