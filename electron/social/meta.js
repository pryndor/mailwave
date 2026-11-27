// Meta: Facebook Pages and Instagram professional accounts, both through the
// Graph API with one sign-in.
//
// Needs a Meta developer app (free) with Facebook Login. While the app is in
// development mode, its admins can post to their own Pages without Meta's
// App Review, which is the setup MailWave expects; serving other people's
// Pages would need App Review.
//
// One sign-in gives a long-lived user token, from which Meta issues a Page
// token per Page that doesn't expire on a timer (it stops working if the
// user changes their password or removes the app). Each Page becomes a
// "facebook" account, and each Instagram professional account linked to a
// Page becomes an "instagram" account that publishes with that Page's token.
//
// Instagram only accepts an image by public URL, never as an upload. So the
// image is first uploaded to the linked Facebook Page as an unpublished
// photo, Instagram is given Facebook's copy of it, and the unpublished photo
// is deleted once the post is live.
const fs   = require('fs');
const path = require('path');

const GRAPH_VERSION = 'v24.0'; // Graph API versions last about two years
const GRAPH   = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG  = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

const PORT          = 47617;
const CALLBACK_PATH = '/meta/callback';
const REDIRECT_URI  = `http://localhost:${PORT}${CALLBACK_PATH}`;
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management', 'instagram_basic', 'instagram_content_publish'];

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Swappable in tests.
const deps = { fetch: (...a) => fetch(...a), sleep: (ms) => new Promise(r => setTimeout(r, ms)) };

class MetaError extends Error {
  constructor(message, { code, auth = false } = {}) { super(message); this.code = code; this.auth = auth; }
}

function buildAuthUrl(clientId, state) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, state, response_type: 'code', scope: SCOPES.join(',') });
  return `${DIALOG}?${q}`;
}

function friendly(err = {}, status) {
  const { code, error_subcode: sub, message = '' } = err;
  if (code === 190 || status === 401) return new MetaError('Facebook sign-in has expired or was revoked. Reconnect on the Accounts tab.', { code, auth: true });
  if (code === 10 || code === 200 || (code >= 200 && code < 300)) return new MetaError(`Facebook refused this: the app is missing a permission or you aren't an admin of this Page. (${message})`, { code });
  if ([4, 17, 32, 613].includes(code)) return new MetaError('Facebook rate limit reached. Try again later.', { code });
  if (code === 9004 || sub === 2207052) return new MetaError('Instagram could not fetch the image. Try a different JPG or PNG.', { code });
  if (sub === 2207026 || code === 36003) return new MetaError('Instagram doesn\'t accept this image format or shape. Use a JPG or PNG with an aspect ratio between 4:5 and 1.91:1.', { code });
  return new MetaError(`Facebook error${code ? ` ${code}` : ''}: ${message || `HTTP ${status}`}`, { code });
}

// GET or POST to the Graph API. `params` go in the query string for GET and
// as a form body for POST; a FormData body is sent as is (file uploads).
async function graph(method, endpoint, params = {}, body = null) {
  const url = new URL(endpoint.startsWith('http') ? endpoint : `${GRAPH}${endpoint}`);
  const opts = { method };
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    opts.body = body || new URLSearchParams(params);
  }
  let res;
  try { res = await deps.fetch(url.toString(), opts); }
  catch { throw new MetaError('Could not reach Facebook. Check your internet connection.'); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.error) throw friendly(data.error, res.status);
  return data;
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

async function connect({ clientId, clientSecret, oauth, openUrl }) {
  if (!clientId || !clientSecret) throw new MetaError('Add your Meta app\'s App ID and App Secret first.');
  const code = await oauth.waitForCode({ port: PORT, path: CALLBACK_PATH, openUrl, buildAuthUrl: (state) => buildAuthUrl(clientId, state) });

  let short;
  try {
    short = await graph('GET', '/oauth/access_token', { client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT_URI, code });
  } catch (err) {
    err.message = `Facebook didn't accept the app credentials or the sign-in code. Check the App ID, App Secret and that ${REDIRECT_URI} is a valid OAuth redirect URI. (${err.message})`;
    throw err;
  }
  const long = await graph('GET', '/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: clientId, client_secret: clientSecret, fb_exchange_token: short.access_token });

  const pages = await graph('GET', '/me/accounts', {
    access_token: long.access_token, limit: '100',
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
  });
  const accounts = [];
  for (const p of pages.data || []) {
    if (!p.access_token) continue;
    accounts.push({ platform: 'facebook', account_id: p.id, name: p.name, avatar: p.picture?.data?.url || '', token: p.access_token, expires_at: null, meta: {} });
    const ig = p.instagram_business_account;
    if (ig?.id) {
      accounts.push({ platform: 'instagram', account_id: ig.id, name: ig.username ? `@${ig.username}` : `Instagram (${p.name})`, avatar: ig.profile_picture_url || '', token: p.access_token, expires_at: null, meta: { page_id: p.id, page_name: p.name } });
    }
  }
  if (!accounts.length) {
    throw new MetaError('No Facebook Pages were shared with MailWave. Connect again and tick the Pages (and Instagram accounts) you want to post to. MailWave can post to Pages, not personal profiles.');
  }
  return accounts;
}

// ── Publishing ───────────────────────────────────────────────────────────────

function imageBlob(imagePath) {
  const type = IMAGE_TYPES[path.extname(imagePath).toLowerCase()];
  if (!type) throw new MetaError('Use a JPG, PNG or GIF image.');
  let bytes;
  try { bytes = fs.readFileSync(imagePath); } catch { throw new MetaError(`Can't read the image file: ${imagePath}`); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new MetaError('The image is larger than 8 MB.');
  return new Blob([bytes], { type });
}

async function uploadPagePhoto({ pageId, token, imagePath, message = '', published = true }) {
  const form = new FormData();
  form.set('access_token', token);
  form.set('published', String(published));
  if (message) form.set('message', message);
  form.set('source', imageBlob(imagePath), path.basename(imagePath));
  return graph('POST', `/${pageId}/photos`, {}, form);
}

// The link is attached as a preview card on text posts. Photo posts can't
// have a card, so the link is added to the text if it isn't there already.
function withLink(text, link) {
  if (!link || text.includes(link)) return text;
  return text ? `${text}\n\n${link}` : link;
}

const facebook = {
  id: 'facebook', name: 'Facebook Page', maxChars: 63206, requiresImage: false,
  async publish({ account, text, link, image_path }) {
    if (image_path) {
      const r = await uploadPagePhoto({ pageId: account.account_id, token: account.token, imagePath: image_path, message: withLink(text, link) });
      const id = r.post_id || r.id;
      return { remote_id: id, remote_url: `https://www.facebook.com/${id}` };
    }
    const params = { access_token: account.token, message: text };
    if (link) params.link = link;
    const r = await graph('POST', `/${account.account_id}/feed`, params);
    return { remote_id: r.id, remote_url: `https://www.facebook.com/${r.id}` };
  },
};

const instagram = {
  id: 'instagram', name: 'Instagram', maxChars: 2200, requiresImage: true, maxHashtags: 30,
  async publish({ account, text, image_path }) {
    if (!image_path) throw new MetaError('Instagram posts need an image.');
    const pageId = account.meta?.page_id;
    if (!pageId) throw new MetaError('This Instagram account has no linked Facebook Page. Reconnect it on the Accounts tab.');

    // 1. Host the image on the linked Page, unpublished.
    const photo = await uploadPagePhoto({ pageId, token: account.token, imagePath: image_path, published: false });
    try {
      const info = await graph('GET', `/${photo.id}`, { access_token: account.token, fields: 'images' });
      const imageUrl = (info.images || []).sort((a, b) => b.width - a.width)[0]?.source;
      if (!imageUrl) throw new MetaError('Facebook did not return a link for the uploaded image.');

      // 2. Create the Instagram container, wait until Instagram has processed it.
      const container = await graph('POST', `/${account.account_id}/media`, { access_token: account.token, image_url: imageUrl, caption: text });
      for (let i = 0; ; i++) {
        const s = await graph('GET', `/${container.id}`, { access_token: account.token, fields: 'status_code' });
        if (s.status_code === 'FINISHED') break;
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new MetaError('Instagram could not process the image. Try a JPG with an aspect ratio between 4:5 and 1.91:1.');
        if (i >= 30) throw new MetaError('Instagram took too long to process the image. Try again.');
        await deps.sleep(2000);
      }

      // 3. Publish and look up the post's link.
      const media = await graph('POST', `/${account.account_id}/media_publish`, { access_token: account.token, creation_id: container.id });
      let url = '';
      try { url = (await graph('GET', `/${media.id}`, { access_token: account.token, fields: 'permalink' })).permalink || ''; } catch {}
      return { remote_id: media.id, remote_url: url };
    } finally {
      // The unpublished helper photo isn't needed once Instagram has its copy.
      graph('DELETE', `/${photo.id}`, { access_token: account.token }).catch(() => {});
    }
  },
};

function countHashtags(text) {
  return (String(text).match(/(^|\s)#[^\s#]+/g) || []).length;
}

module.exports = {
  // provider (sign-in) shape
  id: 'meta', name: 'Facebook & Instagram', platforms: ['facebook', 'instagram'],
  REDIRECT_URI, SCOPES, GRAPH_VERSION,
  connect,
  // publishers
  facebook, instagram,
  buildAuthUrl, withLink, countHashtags, MetaError, deps,
};
