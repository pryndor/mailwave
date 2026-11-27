// Update check: asks GitHub for the latest published release of MailWave and
// tells the user when it's newer than the running version. It only notifies;
// the user downloads and installs the new version themselves.
//
// One unauthenticated request to api.github.com, at most once a day when
// automatic checks are on (default), plus whenever the user clicks "Check
// now". Nothing about the user or their data is sent.
const settings = require('./settings');

const REPO         = 'pryndor/mailwave';
const API_URL      = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

// Swappable in tests. currentVersion comes from app.getVersion() in main.js.
const deps = {
  fetch: (...a) => fetch(...a),
  currentVersion: () => require('../package.json').version,
  onAvailable: () => {},   // (info) => notify the user
};

let lastResult = null;

// "v1.10.0" > "1.9.2"; pre-release suffixes ("1.3.0-beta.1") sort before
// the release itself.
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).trim().replace(/^v/i, '').split('-', 2);
    return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// Only ever open pages of this project's releases.
function safeReleaseUrl(url) {
  return typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/releases/`) ? url : RELEASES_URL;
}

async function check() {
  const current = deps.currentVersion();
  const base = { current, checked_at: new Date().toISOString(), releases_url: RELEASES_URL };
  let res;
  try {
    res = await deps.fetch(API_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MailWave-update-check' } });
  } catch {
    return (lastResult = { ...base, ok: false, error: 'Could not reach GitHub. Check your internet connection.' });
  }
  settings.save({ update_last_check: base.checked_at });

  if (res.status === 404) return (lastResult = { ...base, ok: true, available: false, latest: null });
  if (res.status === 403 || res.status === 429) return (lastResult = { ...base, ok: false, error: 'GitHub rate limit reached. Try again in an hour.' });
  if (!res.ok) return (lastResult = { ...base, ok: false, error: `GitHub returned an error (${res.status}).` });

  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/i, '');
  const available = !!latest && !r.draft && !r.prerelease && compareVersions(latest, current) > 0;
  return (lastResult = {
    ...base, ok: true, available, latest,
    name: r.name || `MailWave ${latest}`,
    url: safeReleaseUrl(r.html_url),
    published_at: r.published_at || null,
    notes: String(r.body || '').slice(0, 4000),
  });
}

// Called from the app's once-a-minute scheduler and at startup. Checks at
// most once a day and notifies once per new version.
async function autoCheck(now = Date.now()) {
  const cfg = settings.getAll();
  if (cfg.update_auto_check === false) return null;
  const last = cfg.update_last_check ? new Date(cfg.update_last_check).getTime() : 0;
  if (now - last < CHECK_EVERY_MS) return null;
  const r = await check();
  if (r.ok && r.available && settings.getAll().update_notified_version !== r.latest) {
    settings.save({ update_notified_version: r.latest });
    deps.onAvailable(r);
  }
  return r;
}

function status() {
  const cfg = settings.getAll();
  return { current: deps.currentVersion(), auto: cfg.update_auto_check !== false, last_check: cfg.update_last_check || null, result: lastResult, releases_url: RELEASES_URL };
}

function setAuto(enabled) {
  settings.save({ update_auto_check: !!enabled });
  return status();
}

module.exports = { check, autoCheck, status, setAuto, compareVersions, safeReleaseUrl, deps, RELEASES_URL };
