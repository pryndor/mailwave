// Update check: version comparison, GitHub responses, once-a-day auto check
// and one notification per new version. GitHub is faked.
const test = require('node:test');
const assert = require('node:assert');
const { stubModules, tempWorkspace, load } = require('./helpers');

stubModules({ './workspace': tempWorkspace() });
const settings = load('settings.js');
const updates  = load('updates.js');

let reply = { status: 200, body: { tag_name: 'v1.3.0', html_url: 'https://github.com/pryndor/mailwave/releases/tag/v1.3.0', body: 'Notes' } };
const requests = [];
updates.deps.fetch = async (url, opts) => {
  requests.push({ url, opts });
  if (reply.throw) throw new Error('offline');
  return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
};
updates.deps.currentVersion = () => '1.2.0';
const notified = [];
updates.deps.onAvailable = (info) => notified.push(info.latest);

test('compareVersions handles v-prefix, lengths and pre-releases', () => {
  assert.equal(updates.compareVersions('v1.10.0', '1.9.9'), 1);
  assert.equal(updates.compareVersions('1.2', '1.2.0'), 0);
  assert.equal(updates.compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(updates.compareVersions('1.3.0-beta.1', '1.3.0'), -1);
  assert.equal(updates.compareVersions('1.3.0', '1.3.0-beta.1'), 1);
});

test('check reports a newer release and sends no user data', async () => {
  const r = await updates.check();
  assert.equal(r.available, true);
  assert.equal(r.latest, '1.3.0');
  assert.equal(requests[0].url, 'https://api.github.com/repos/pryndor/mailwave/releases/latest');
  assert.deepEqual(Object.keys(requests[0].opts.headers).sort(), ['Accept', 'User-Agent']);
});

test('same or older version, no releases yet, drafts and errors', async () => {
  reply = { status: 200, body: { tag_name: 'v1.2.0' } };
  assert.equal((await updates.check()).available, false);
  reply = { status: 200, body: { tag_name: 'v9.0.0', prerelease: true } };
  assert.equal((await updates.check()).available, false, 'pre-releases are not offered');
  reply = { status: 404, body: {} };
  assert.deepEqual([(await updates.check()).ok, (await updates.check()).available], [true, false]);
  reply = { status: 403, body: {} };
  assert.match((await updates.check()).error, /rate limit/);
  reply = { throw: true };
  assert.match((await updates.check()).error, /internet/);
});

test('release links outside this repo are replaced with the releases page', () => {
  assert.equal(updates.safeReleaseUrl('https://evil.example/x'), updates.RELEASES_URL);
  assert.equal(updates.safeReleaseUrl('https://github.com/pryndor/mailwave/releases/tag/v2'), 'https://github.com/pryndor/mailwave/releases/tag/v2');
});

test('autoCheck runs at most daily, notifies once per version, respects the toggle', async () => {
  reply = { status: 200, body: { tag_name: 'v1.4.0', html_url: 'https://github.com/pryndor/mailwave/releases/tag/v1.4.0' } };
  settings.save({ update_last_check: '', update_notified_version: '' });
  const now = Date.now();
  await updates.autoCheck(now);
  assert.deepEqual(notified, ['1.4.0']);
  assert.equal(await updates.autoCheck(now + 3600000), null, 'checked less than a day ago');
  await updates.autoCheck(now + 25 * 3600000);
  assert.deepEqual(notified, ['1.4.0'], 'same version is not announced twice');
  settings.save({ update_auto_check: false, update_last_check: '' });
  assert.equal(await updates.autoCheck(now + 50 * 3600000), null);
});
