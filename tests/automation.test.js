// The local Automation API: token required, localhost only, and a port that's
// already taken reports an error instead of crashing the app.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { stubModules, load } = require('./helpers');

let cfg = { automation_enabled: true, automation_port: 0, automation_token: 'tok123', license_key: 'k' };
stubModules({ './license': { isPro: () => true } });
const automation = load('automation-server.js');
const deps = {
  settings: { getAll: () => cfg, save: (d) => { cfg = { ...cfg, ...d }; } },
  db: { listCampaigns: () => [{ id: 1, name: 'June' }], listGroups: () => [], listTemplates: () => [] },
  mailer: { listScheduledDetails: () => [] },
  mainWindow: null,
};

function request(port, path, token) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

test('requests need the token', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  const freePort = blocker.address().port;
  blocker.close();
  cfg.automation_port = freePort;
  automation.start(deps);
  await automation.whenStarted();
  assert.ok(automation.isRunning());
  assert.equal((await request(freePort, '/health')).status, 401);
  assert.equal((await request(freePort, '/health', 'wrong')).status, 401);
  assert.deepEqual((await request(freePort, '/campaigns', 'tok123')).body, [{ id: 1, name: 'June' }]);
  automation.stop();
  assert.ok(!automation.isRunning());
});

test('a busy port is reported, not thrown', async () => {
  const blocker = http.createServer().listen(0, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  cfg.automation_port = blocker.address().port;
  automation.start(deps);
  await automation.whenStarted();
  assert.ok(!automation.isRunning());
  assert.match(automation.getLastError(), /already in use/);
  automation.stop();
  assert.equal(automation.getLastError(), '');
  blocker.close();
});

test('nothing starts when turned off or without Pro', async () => {
  cfg.automation_enabled = false;
  assert.equal(automation.start(deps), null);
  assert.ok(!automation.isRunning());
});
