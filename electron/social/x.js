// X (Twitter): post to the user's own account through the X API v2.
//
// Needs an X developer app with OAuth 2.0 turned on (User authentication
// settings), "Read and write" permissions, and the callback URL below. X has
// no free posting tier: since 2026 every post is paid from the developer
// account's prepaid credits (pay-per-use), so the user pays X directly.
//
// Sign-in is OAuth 2.0 with PKCE. A "Native App" (public client) has no
// secret; a "Web App" (confidential client) has one and sends it as HTTP
// Basic auth. Both work. Access tokens last two hours, so `offline.access`
// gives a refresh token and index.js refreshes before publishing. X rotates
// refresh tokens: every refresh returns a new one, which must be saved.
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const AUTH_URL  = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API       = 'https://api.x.com/2';

// X matches callback URLs exactly and has rejected "localhost" in the past,
// so use the loopback IP (oauth.js listens on it).
const PORT          = 47619;
const CALLBACK_PATH = '/x/callback';
const REDIRECT_URI  = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;
const SCOPES        = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];

const MAX_CHARS       = 280;
const URL_LENGTH      = 23; // every link counts as a t.co link
const IMAGE_TYPES     = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Swappable in tests.
const deps = { fetch: (...a) => fetch(...a) };

class XError extends Error {
  constructor(message, { status, auth = false } = {}) { super(message); this.status = status; this.auth = auth; }
}

// ── Character counting ───────────────────────────────────────────────────────

// X's weighted length, close to twitter-text: links count as 23, most Latin,
// Greek, Cyrillic and punctuation characters as 1, everything else (CJK,
// emoji) as 2, out of 280.
const URL_RE = /https?:\/\/[^\s]+/gi;
function countChars(text) {
  const s = String(text || '');
  const urls = s.match(URL_RE) || [];
  let n = urls.length * URL_LENGTH;
  for (const ch of s.replace(URL_RE, '')) {
    const c = ch.codePointAt(0);
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

// X has no separate link field: the link goes in the text, where X turns it
// into a preview card.
function withLink(text, link) {
  if (!link || text.includes(link)) return text;
  return text ? `${text}\n\n${link}` : link;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
  const verifier = base64url(crypto.randomBytes(32));
  return { verifier, challenge: base64url(crypto.createHash('sha256').update(verifier).digest()) };
}

function buildAuthUrl(clientId, state, challenge) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, scope: SCOPES.join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

async function readError(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  const detail = body.error_description || body.detail || body.errors?.[0]?.message || body.title || body.error || '';
  if (res.status === 401) return new XError('X sign-in has expired or was revoked. Reconnect the account.', { status: 401, auth: true });
  if (res.status === 402) return new XError('Your X developer account is out of API credits. Add credits at console.x.com, then retry.', { status: 402 });
  if (res.status === 403) {
    if (/duplicate/i.test(detail)) return new XError('X refused this as a duplicate of a recent post. Change the text and retry.', { status: 403 });
    return new XError(`X refused this (403). Check the app has "Read and write" permission and your developer account has credits. ${detail}`.trim(), { status: 403 });
  }
  if (res.status === 429) return new XError('X rate limit reached. Try again later.', { status: 429 });
  return new XError(`X error ${res.status}${detail ? `: ${detail}` : ''}`, { status: res.status });
}

async function call(url, opts) {
  try { return await deps.fetch(url, opts); }
  catch { throw new XError('Could not reach X. Check your internet connection.'); }
}

// Token endpoint, for both the code exchange and refreshes.
async function tokenRequest({ clientId, clientSecret, params }) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
  const res = await call(TOKEN_URL, { method: 'POST', headers, body: new URLSearchParams({ ...params, client_id: clientId }) });
  if (!res.ok) throw await readError(res);
  const body = await res.json();
  return {
    token: body.access_token,
    refresh_token: body.refresh_token || '',
    expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  };
}

async function fetchProfile(token) {
  const res = await call(`${API}/users/me?user.fields=profile_image_url`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await readError(res);
  const { data: u = {} } = await res.json();
  return { account_id: u.id, name: u.username ? `@${u.username}` : (u.name || 'X account'), avatar: u.profile_image_url || '', meta: { username: u.username || '' } };
}

async function connect({ clientId, clientSecret, oauth, openUrl }) {
  if (!clientId) throw new XError('Add your X app\'s Client ID first.');
  const { verifier, challenge } = pkce();
  const code = await oauth.waitForCode({ port: PORT, path: CALLBACK_PATH, openUrl, buildAuthUrl: (state) => buildAuthUrl(clientId, state, challenge) });
  let tokens;
  try {
    tokens = await tokenRequest({ clientId, clientSecret, params: { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier } });
  } catch (err) {
    err.message = `X didn't accept the app credentials or the sign-in code. Check the Client ID${clientSecret ? ' and Client Secret' : ''} and that ${REDIRECT_URI} is a callback URL in the app. (${err.message})`;
    throw err;
  }
  const profile = await fetchProfile(tokens.token);
  return { platform: 'x', ...profile, ...tokens };
}

// Called by index.js when the access token is about to run out.
async function refresh({ account, clientId, clientSecret }) {
  if (!clientId) throw new XError('The X app\'s Client ID is missing. Add it on the Accounts tab.');
  try {
    const t = await tokenRequest({ clientId, clientSecret, params: { grant_type: 'refresh_token', refresh_token: account.refresh_token } });
    return { ...t, refresh_token: t.refresh_token || account.refresh_token };
  } catch (err) {
    if (err.status === 400 || err.status === 401) throw new XError('X sign-in has expired or was revoked. Reconnect the account on the Accounts tab.', { status: err.status, auth: true });
    throw err;
  }
}

// ── Publishing ───────────────────────────────────────────────────────────────

async function uploadImage(token, imagePath) {
  const type = IMAGE_TYPES[path.extname(imagePath).toLowerCase()];
  if (!type) throw new XError('X takes JPG, PNG, GIF or WEBP images.');
  let bytes;
  try { bytes = fs.readFileSync(imagePath); } catch { throw new XError(`Can't read the image file: ${imagePath}`); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new XError('The image is larger than 5 MB, X\'s limit.');

  const form = new FormData();
  form.set('media', new Blob([bytes], { type }), path.basename(imagePath));
  form.set('media_category', 'tweet_image');
  const res = await call(`${API}/media/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw await readError(res);
  const { data } = await res.json();
  if (!data?.id) throw new XError('X did not return an id for the uploaded image.');
  return data.id;
}

async function publish({ account, text, link, image_path }) {
  const body = { text: withLink(text, link) };
  if (image_path) body.media = { media_ids: [await uploadImage(account.token, image_path)] };
  const res = await call(`${API}/tweets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  const { data } = await res.json();
  const user = account.meta?.username;
  return { remote_id: data.id, remote_url: user ? `https://x.com/${user}/status/${data.id}` : `https://x.com/i/web/status/${data.id}` };
}

module.exports = {
  id: 'x', name: 'X (Twitter)', maxChars: MAX_CHARS, requiresImage: false, platforms: ['x'], secretOptional: true,
  REDIRECT_URI, SCOPES,
  connect, refresh, publish,
  // The text as it will be posted, and its length the way X counts it.
  postText: withLink, countChars,
  buildAuthUrl, pkce, XError, deps,
};
