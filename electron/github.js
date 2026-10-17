// Minimal GitHub REST client for Team Sync — no SDK dependency, uses the
// global fetch built into Electron's Node. Only the endpoints teamSync.js needs.
const zlib = require('zlib');

const API = 'https://api.github.com';

// OAuth App client id for the device-login flow. Empty = device flow hidden in
// the UI and users paste a fine-grained personal access token instead.
// Register at github.com/settings/developers → OAuth Apps, tick "Enable Device Flow".
const GITHUB_CLIENT_ID = '';

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function client(token) {
  async function request(method, path, { body, headers = {}, raw = false } = {}) {
    let res;
    try {
      res = await fetch(path.startsWith('http') ? path : API + path, {
        method,
        headers: {
          'Accept':               'application/vnd.github+json',
          'Authorization':        `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent':           'MailWave-TeamSync',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // Network down / DNS failure — callers treat status 0 as "retry later".
      throw new GitHubError(0, `Network error: ${err.message}`);
    }
    if (res.status === 304) return { status: 304, headers: res.headers, data: null };
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      throw new GitHubError(res.status, `GitHub ${res.status}: ${msg}`);
    }
    const data = raw
      ? Buffer.from(await res.arrayBuffer())
      : (res.status === 204 ? null : await res.json());
    return { status: res.status, headers: res.headers, data };
  }

  const enc = encodeURIComponent;

  return {
    request,

    async me() {
      return (await request('GET', '/user')).data;
    },

    async getRepo(owner, repo) {
      return (await request('GET', `/repos/${enc(owner)}/${enc(repo)}`)).data;
    },

    // Private repo under the user, or under an org when owner != the user's login.
    async createRepo(owner, repo, isOrg) {
      const path = isOrg ? `/orgs/${enc(owner)}/repos` : '/user/repos';
      return (await request('POST', path, {
        body: { name: repo, private: true, description: 'MailWave team data (encrypted)', has_issues: false, has_wiki: false },
      })).data;
    },

    async inviteCollaborator(owner, repo, username) {
      return (await request('PUT', `/repos/${enc(owner)}/${enc(repo)}/collaborators/${enc(username)}`, {
        body: { permission: 'push' },
      })).data;
    },

    // Whole file list in one call. etag lets an unchanged repo answer 304,
    // which GitHub doesn't count against the rate limit.
    async getTree(owner, repo, branch, etag) {
      try {
        const r = await request('GET', `/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(branch)}?recursive=1`, {
          headers: etag ? { 'If-None-Match': etag } : {},
        });
        if (r.status === 304) return { notModified: true, etag };
        return { tree: r.data.tree, truncated: r.data.truncated, etag: r.headers.get('etag') };
      } catch (err) {
        // 409 = empty repo (no commits yet), 404 = branch not created yet.
        if (err.status === 409 || err.status === 404) return { tree: [], etag: null };
        throw err;
      }
    },

    async getBlob(owner, repo, sha) {
      const r = await request('GET', `/repos/${enc(owner)}/${enc(repo)}/git/blobs/${sha}`);
      return Buffer.from(r.data.content, 'base64');
    },

    // Returns { sha, content: Buffer } or null when the file doesn't exist.
    async getFile(owner, repo, path, branch) {
      try {
        const r = await request('GET', `/repos/${enc(owner)}/${enc(repo)}/contents/${path}?ref=${enc(branch)}`, {
          headers: { 'Cache-Control': 'no-cache' },
        });
        return { sha: r.data.sha, content: Buffer.from(r.data.content || '', 'base64') };
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    // Create (sha omitted) or compare-and-swap update (sha = the version we read).
    // GitHub answers 409/422 when sha is stale or the file already exists — that's
    // the atomic primitive the send locks are built on.
    async putFile(owner, repo, path, branch, content, message, sha) {
      const body = { message, content: Buffer.from(content).toString('base64') };
      if (branch) body.branch = branch;
      if (sha) body.sha = sha;
      const r = await request('PUT', `/repos/${enc(owner)}/${enc(repo)}/contents/${path}`, { body });
      return { sha: r.data.content.sha };
    },

    // Whole repo in one request — used for first join instead of thousands of blob calls.
    async getTarball(owner, repo, branch) {
      const r = await request('GET', `/repos/${enc(owner)}/${enc(repo)}/tarball/${enc(branch)}`, { raw: true });
      return extractTarGz(r.data);
    },
  };
}

// ── Device-login flow (needs GITHUB_CLIENT_ID) ────────────────────────────────
async function startDeviceFlow() {
  if (!GITHUB_CLIENT_ID) throw new Error('Device login not configured — paste a personal access token instead.');
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo' }),
  });
  const data = await res.json();
  if (!data.device_code) throw new Error(data.error_description || 'Could not start GitHub login');
  return data; // { device_code, user_code, verification_uri, interval, expires_in }
}

// Resolves with the token once the user approves in the browser.
async function pollDeviceFlow(device_code, interval = 5, expires_in = 900) {
  const deadline = Date.now() + expires_in * 1000;
  let wait = interval;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, wait * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    if (data.error === 'slow_down') wait += 5;
    else if (data.error !== 'authorization_pending') throw new Error(data.error_description || data.error);
  }
  throw new Error('GitHub login timed out');
}

// ── Tiny tar.gz reader ────────────────────────────────────────────────────────
// GitHub tarballs are ustar with a pax global header and a single top-level
// "<owner>-<repo>-<sha>/" folder, which is stripped here. Returns Map path → Buffer.
function extractTarGz(gz) {
  const buf = zlib.gunzipSync(gz);
  const files = new Map();
  let off = 0;
  let paxPath = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const str = (s, e) => header.subarray(s, e).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 500);
    let name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      const m = data.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === 'g') continue;
    if (paxPath) { name = paxPath; paxPath = null; }
    if (type !== '0' && type !== '\0') continue;
    const rel = name.split('/').slice(1).join('/');
    if (rel) files.set(rel, Buffer.from(data));
  }
  return files;
}

module.exports = { client, startDeviceFlow, pollDeviceFlow, GitHubError, hasDeviceFlow: () => !!GITHUB_CLIENT_ID };
