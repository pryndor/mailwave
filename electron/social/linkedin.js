// LinkedIn: post to the member's own profile.
//
// Needs a LinkedIn developer app (free, self-serve) with two products added:
// "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn". Those
// give the scopes `openid profile w_member_social`. Posting to a Company Page
// needs the Community Management API, which LinkedIn approves by review, so
// it isn't offered yet.
//
// Tokens last 60 days and self-serve apps get no refresh token, so the user
// reconnects when one expires; the Social page warns before that happens.
const fs   = require('fs');
const path = require('path');

const AUTH_URL     = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL    = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const API          = 'https://api.linkedin.com/rest';
// LinkedIn's versioned API needs a YYYYMM version header. Versions are
// supported for about a year, so this needs bumping roughly once a year.
const API_VERSION  = '202610';

const PORT          = 47615;
const CALLBACK_PATH = '/linkedin/callback';
const REDIRECT_URI  = `http://localhost:${PORT}${CALLBACK_PATH}`;
const SCOPES        = ['openid', 'profile', 'w_member_social'];

const MAX_CHARS  = 3000;
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Swappable in tests.
const deps = { fetch: (...a) => fetch(...a) };

class LinkedInError extends Error {
  constructor(message, { status, auth = false } = {}) { super(message); this.status = status; this.auth = auth; }
}

function buildAuthUrl(clientId, state) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, state, scope: SCOPES.join(' ') });
  return `${AUTH_URL}?${q}`;
}

async function readError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.error_description || body.message || body.error || '';
  } catch {}
  if (res.status === 401) return new LinkedInError('LinkedIn sign-in has expired or was revoked. Reconnect the account.', { status: 401, auth: true });
  if (res.status === 403) return new LinkedInError(`LinkedIn refused this (403). Check the app has the "Share on LinkedIn" product. ${detail}`.trim(), { status: 403 });
  if (res.status === 429) return new LinkedInError('LinkedIn rate limit reached. Try again later.', { status: 429 });
  return new LinkedInError(`LinkedIn error ${res.status}${detail ? `: ${detail}` : ''}`, { status: res.status });
}

async function exchangeCode({ clientId, clientSecret, code }) {
  const res = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    const err = await readError(res);
    if (res.status === 400 || res.status === 401) err.message = `LinkedIn didn't accept the app credentials or the sign-in code. Check the Client ID, Client Secret and that ${REDIRECT_URI} is an authorized redirect URL. (${err.message})`;
    throw err;
  }
  const body = await res.json();
  return {
    token: body.access_token,
    refresh_token: body.refresh_token || '',
    expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  };
}

async function fetchProfile(token) {
  const res = await deps.fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await readError(res);
  const p = await res.json();
  return { account_id: `urn:li:person:${p.sub}`, name: p.name || [p.given_name, p.family_name].filter(Boolean).join(' ') || 'LinkedIn member', avatar: p.picture || '' };
}

// Full sign-in: browser consent, code exchange, profile lookup.
async function connect({ clientId, clientSecret, oauth, openUrl }) {
  if (!clientId || !clientSecret) throw new LinkedInError('Add your LinkedIn app\'s Client ID and Client Secret first.');
  const code = await oauth.waitForCode({ port: PORT, path: CALLBACK_PATH, openUrl, buildAuthUrl: (state) => buildAuthUrl(clientId, state) });
  const tokens = await exchangeCode({ clientId, clientSecret, code });
  const profile = await fetchProfile(tokens.token);
  return { platform: 'linkedin', ...profile, ...tokens };
}

// Post text uses LinkedIn's "little text format", where these characters
// have meaning (mentions, hashtags-as-links, markup). Unescaped, they can
// make LinkedIn cut the post off, so escape them all. Plain #hashtags still
// work: LinkedIn turns them into hashtags itself.
function escapeCommentary(text) {
  return String(text).replace(/[\\|{}@[\]()<>*_~]/g, c => `\\${c}`);
}

const restHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'LinkedIn-Version': API_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
  'Content-Type': 'application/json',
});

async function uploadImage({ token, author, imagePath }) {
  const type = IMAGE_TYPES[path.extname(imagePath).toLowerCase()];
  if (!type) throw new LinkedInError('LinkedIn takes JPG, PNG or GIF images.');
  let bytes;
  try { bytes = fs.readFileSync(imagePath); } catch { throw new LinkedInError(`Can't read the image file: ${imagePath}`); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new LinkedInError('The image is larger than 8 MB.');

  const init = await deps.fetch(`${API}/images?action=initializeUpload`, {
    method: 'POST', headers: restHeaders(token),
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  if (!init.ok) throw await readError(init);
  const { value } = await init.json();

  const put = await deps.fetch(value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body: bytes });
  if (!put.ok) throw await readError(put);
  return value.image;
}

// Publishes one post. Returns { remote_id, remote_url }.
async function publish({ account, text, link, image_path }) {
  const author = account.account_id;
  const body = {
    author,
    commentary: escapeCommentary(text),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  // One attachment per post: an image wins over a link card. A link is then
  // still clickable in the text if the user included it there.
  if (image_path) {
    body.content = { media: { id: await uploadImage({ token: account.token, author, imagePath: image_path }) } };
  } else if (link) {
    body.content = { article: { source: link, title: linkTitle(link) } };
  }

  const res = await deps.fetch(`${API}/posts`, { method: 'POST', headers: restHeaders(account.token), body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res);
  const id = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
  return { remote_id: id, remote_url: id ? `https://www.linkedin.com/feed/update/${id}/` : '' };
}

// LinkedIn requires a title for link cards. It fetches the real page preview
// itself in most cases; this is only the fallback text.
function linkTitle(link) {
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return link; }
}

module.exports = {
  id: 'linkedin', name: 'LinkedIn', maxChars: MAX_CHARS,
  REDIRECT_URI, SCOPES, API_VERSION,
  connect, publish, escapeCommentary, buildAuthUrl, exchangeCode, fetchProfile, LinkedInError, deps,
};
