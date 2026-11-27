// Bluesky: post to the user's account over the AT Protocol.
//
// No developer app: the user signs in with their handle and an *app
// password* (Settings → Privacy and security → App passwords), which can't
// change the account password or settings and can be revoked on its own.
// The app password is used once and never stored: the session's refresh JWT
// is kept instead (sealed like every token), and index.js renews the
// two-hour access JWT with it before publishing.
//
// Login goes to bsky.social (or a server the user names), and later calls go
// to the account's own PDS, read from the DID document the login returns.
//
// Links and #hashtags only become clickable with "facets" (byte ranges), so
// they're computed here. A link without an image becomes a preview card
// (title, description and thumbnail read from the page); with an image, the
// link is added to the text instead.
const fs   = require('fs');
const path = require('path');
const { URL_RE, withLink, countGraphemes } = require('./text');

const DEFAULT_SERVICE = 'https://bsky.social';
const MAX_CHARS       = 300;
const IMAGE_TYPES     = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 1000000; // Bluesky's limit per image
const CARD_TIMEOUT_MS = 8000;

// Swappable in tests.
const deps = { fetch: (...a) => fetch(...a) };

class BlueskyError extends Error {
  constructor(message, { status, auth = false } = {}) { super(message); this.status = status; this.auth = auth; }
}

function normalizeService(s) {
  const v = String(s || '').trim().replace(/\/+$/, '');
  if (!v) return DEFAULT_SERVICE;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

async function xrpc(service, method, { token, body, query, raw, contentType } = {}) {
  const url = new URL(`${service}/xrpc/${method}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) { payload = raw; headers['Content-Type'] = contentType; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await deps.fetch(url.toString(), { method: payload !== undefined || !query ? 'POST' : 'GET', headers, body: payload }); }
  catch { throw new BlueskyError('Could not reach Bluesky. Check your internet connection.'); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data.message || data.error || `HTTP ${res.status}`;
    if (data.error === 'ExpiredToken' || data.error === 'InvalidToken' || res.status === 401) {
      throw new BlueskyError('Bluesky sign-in has expired or the app password was revoked. Reconnect on the Accounts tab.', { status: res.status, auth: true });
    }
    if (res.status === 429) throw new BlueskyError('Bluesky rate limit reached. Try again later.', { status: 429 });
    throw new BlueskyError(`Bluesky error: ${msg}`, { status: res.status });
  }
  return data;
}

// Access JWTs carry their expiry; read it so index.js knows when to refresh.
function jwtExpiry(jwt) {
  try {
    const { exp } = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString());
    return exp ? new Date(exp * 1000).toISOString() : null;
  } catch { return null; }
}

function pdsFrom(didDoc, fallback) {
  const svc = (didDoc?.service || []).find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint ? String(svc.serviceEndpoint).replace(/\/+$/, '') : fallback;
}

function session(s, fallbackPds) {
  return {
    token: s.accessJwt,
    refresh_token: s.refreshJwt,
    expires_at: jwtExpiry(s.accessJwt) || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pds: pdsFrom(s.didDoc, fallbackPds),
  };
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

async function connect({ input = {} }) {
  const identifier = String(input.identifier || '').trim().replace(/^@/, '');
  const password = String(input.password || '').trim();
  if (!identifier || !password) throw new BlueskyError('Enter your Bluesky handle and an app password.');
  const service = normalizeService(input.service);
  let s;
  try {
    s = await xrpc(service, 'com.atproto.server.createSession', { body: { identifier, password } });
  } catch (err) {
    if (err.status === 401 || err.status === 400) {
      throw new BlueskyError('Bluesky didn\'t accept that handle and password. Use an app password (Settings → Privacy and security → App passwords), not your main password, and check the handle, e.g. yourname.bsky.social.', { status: err.status });
    }
    throw err;
  }
  const t = session(s, service);
  let avatar = '', displayName = '';
  try {
    const p = await xrpc(t.pds, 'app.bsky.actor.getProfile', { token: t.token, query: { actor: s.did } });
    avatar = p.avatar || ''; displayName = p.displayName || '';
  } catch {}
  return {
    platform: 'bluesky', account_id: s.did, name: `@${s.handle}`, avatar,
    token: t.token, refresh_token: t.refresh_token, expires_at: t.expires_at,
    meta: { handle: s.handle, pds: t.pds, display_name: displayName },
  };
}

async function refresh({ account }) {
  const pds = account.meta?.pds || DEFAULT_SERVICE;
  const s = await xrpc(pds, 'com.atproto.server.refreshSession', { token: account.refresh_token });
  const t = session(s, pds);
  return { token: t.token, refresh_token: t.refresh_token || account.refresh_token, expires_at: t.expires_at };
}

// ── Rich text ────────────────────────────────────────────────────────────────

// Byte ranges (UTF-8) of links and hashtags, as Bluesky facets.
function facets(text) {
  const out = [];
  const bytes = (i) => Buffer.byteLength(text.slice(0, i), 'utf8');
  for (const m of text.matchAll(URL_RE)) {
    const uri = m[0].replace(/[.,;:!?)\]'"]+$/, ''); // trailing punctuation isn't part of the link
    out.push({ index: { byteStart: bytes(m.index), byteEnd: bytes(m.index + uri.length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
  }
  for (const m of text.matchAll(/(^|\s)#([^\s#]*[^\d\s#.,;:!?)\]'"][^\s#]*)/g)) {
    const tag = m[2].replace(/[.,;:!?)\]'"]+$/, '');
    if (!tag || tag.length > 64) continue;
    const start = m.index + m[1].length;
    out.push({ index: { byteStart: bytes(start), byteEnd: bytes(start + 1 + tag.length) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag }] });
  }
  return out;
}

// ── Publishing ───────────────────────────────────────────────────────────────

async function uploadBlob(pds, token, bytes, type) {
  const r = await xrpc(pds, 'com.atproto.repo.uploadBlob', { token, raw: bytes, contentType: type });
  return r.blob;
}

function readImage(imagePath) {
  const type = IMAGE_TYPES[path.extname(imagePath).toLowerCase()];
  if (!type) throw new BlueskyError('Bluesky takes JPG, PNG, GIF or WEBP images.');
  let bytes;
  try { bytes = fs.readFileSync(imagePath); } catch { throw new BlueskyError(`Can't read the image file: ${imagePath}`); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new BlueskyError('The image is larger than 1 MB, Bluesky\'s limit. Save a smaller or more compressed copy.');
  return { bytes, type };
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function metaTag(html, names) {
  for (const n of names) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i'))
           || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, 'i'));
    if (m) return decode(m[1]);
  }
  return '';
}

// Preview card for a link. Best effort: if the page can't be read, the card
// just shows the address.
async function linkCard(link, pds, token) {
  const external = { uri: link, title: '', description: '' };
  try {
    const res = await deps.fetch(link, { signal: AbortSignal.timeout(CARD_TIMEOUT_MS), headers: { 'User-Agent': 'MailWave link preview' } });
    if (res.ok && /html/i.test(res.headers.get('content-type') || '')) {
      const html = (await res.text()).slice(0, 500000);
      external.title = metaTag(html, ['og:title', 'twitter:title']) || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
      external.description = metaTag(html, ['og:description', 'twitter:description', 'description']);
      const img = metaTag(html, ['og:image', 'twitter:image']);
      if (img) {
        const imgRes = await deps.fetch(new URL(img, link).toString(), { signal: AbortSignal.timeout(CARD_TIMEOUT_MS) });
        const type = (imgRes.headers.get('content-type') || '').split(';')[0];
        if (imgRes.ok && /^image\/(jpeg|png|gif|webp)$/.test(type)) {
          const bytes = Buffer.from(await imgRes.arrayBuffer());
          if (bytes.length <= MAX_IMAGE_BYTES) external.thumb = await uploadBlob(pds, token, bytes, type);
        }
      }
    }
  } catch (err) {
    if (err.auth) throw err;
  }
  if (!external.title) { try { external.title = new URL(link).hostname.replace(/^www\./, ''); } catch { external.title = link; } }
  return external;
}

// With an image, the link can't be a card, so it goes in the text.
function postText(text, link, { image } = {}) {
  return image ? withLink(text, link) : text;
}

async function publish({ account, text, link, image_path }) {
  const pds = account.meta?.pds || DEFAULT_SERVICE;
  const full = postText(text, link, { image: !!image_path });
  const record = { $type: 'app.bsky.feed.post', text: full, createdAt: new Date().toISOString() };
  const f = facets(full);
  if (f.length) record.facets = f;

  if (image_path) {
    const { bytes, type } = readImage(image_path);
    record.embed = { $type: 'app.bsky.embed.images', images: [{ image: await uploadBlob(pds, account.token, bytes, type), alt: '' }] };
  } else if (link) {
    record.embed = { $type: 'app.bsky.embed.external', external: await linkCard(link, pds, account.token) };
  }

  const r = await xrpc(pds, 'com.atproto.repo.createRecord', { token: account.token, body: { repo: account.account_id, collection: 'app.bsky.feed.post', record } });
  const rkey = String(r.uri || '').split('/').pop();
  const who = account.meta?.handle || account.account_id;
  return { remote_id: r.uri, remote_url: rkey ? `https://bsky.app/profile/${who}/post/${rkey}` : '' };
}

module.exports = {
  id: 'bluesky', name: 'Bluesky', maxChars: MAX_CHARS, requiresImage: false, platforms: ['bluesky'],
  // Signs in with a form instead of a developer app.
  form: [
    { key: 'identifier', label: 'Handle', placeholder: 'yourname.bsky.social' },
    { key: 'password', label: 'App password', placeholder: 'xxxx-xxxx-xxxx-xxxx', secret: true },
    { key: 'service', label: 'Hosting provider (optional)', placeholder: 'bsky.social' },
  ],
  connect, refresh, publish,
  postText, countChars: countGraphemes, counting: 'graphemes', linkInText: 'with-image',
  facets, jwtExpiry, BlueskyError, deps,
};
