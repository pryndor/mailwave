// Workspaces: the normal "main" data, plus an optional "test" workspace with
// its own database and settings. Users can try features like Team Sync without
// touching their real data.
//
//   <userData>/mailwave.db, settings.json            main (unchanged location)
//   <userData>/workspaces/test/mailwave.db, ...      test
//   <userData>/app-state.json                        which workspace is active + trial start
//
// db.js and settings.js read dataDir() once at load, so switching workspace
// relaunches the app instead of swapping open database handles.
const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

const root = () => app.getPath('userData');
const statePath = () => path.join(root(), 'app-state.json');
const testDir = () => path.join(root(), 'workspaces', 'test');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function testExists() {
  return fs.existsSync(path.join(testDir(), 'mailwave.db'));
}

// Fixed at first call for the life of the process — see header comment.
let active = null;
function current() {
  if (active) return active;
  active = readState().workspace === 'test' && testExists() ? 'test' : 'main';
  return active;
}

function dataDir() {
  if (current() === 'main') return root();
  fs.mkdirSync(testDir(), { recursive: true });
  return testDir();
}

function info() {
  const s = readState();
  return {
    current: current(),
    testExists: testExists(),
    testCreatedAt: s.test_created_at || null,
    testCopiedData: !!s.test_copied_data,
  };
}

// Only from the main workspace. copyData = snapshot of the current database;
// otherwise the test workspace starts empty. SMTP and license settings are
// copied either way so test sends work, but Team Sync settings never are, so
// the test workspace can't accidentally push into the real team.
async function createTest({ copyData }, liveDb) {
  if (current() !== 'main') throw new Error('Switch to the main workspace first.');
  if (testExists()) throw new Error('A test workspace already exists. Delete it first.');
  fs.mkdirSync(testDir(), { recursive: true });

  const mainSettings = path.join(root(), 'settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(mainSettings, 'utf8')); } catch {}
  settings = Object.fromEntries(Object.entries(settings).filter(([k]) => !k.startsWith('team_')));
  // The local automation API would clash with the main workspace's copy on the same token.
  settings.automation_enabled = false;
  fs.writeFileSync(path.join(testDir(), 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

  const dbPath = path.join(testDir(), 'mailwave.db');
  if (copyData) {
    await liveDb.backup(dbPath);
    // Rows copied from main carry main's team bookkeeping — clear it so the test
    // workspace treats everything as new if it joins a (test) team.
    const Database = require('better-sqlite3');
    const t = new Database(dbPath);
    for (const tbl of ['subscribers', 'groups', 'templates', 'campaigns', 'send_history']) {
      try { t.exec(`UPDATE ${tbl} SET uid = NULL`); } catch {}
    }
    try { t.exec('DELETE FROM sync_state; DELETE FROM sync_meta;'); } catch {}
    // Scheduled/paused sends belong to the real workspace — don't fire them again from the copy.
    try { t.exec(`UPDATE campaigns SET scheduled_at = NULL, resume_at = NULL WHERE status != 'sent'`); } catch {}
    t.close();
  } else {
    const Database = require('better-sqlite3');
    new Database(dbPath).close();   // schema is created by db.js on first open
  }

  writeState({ test_created_at: new Date().toISOString(), test_copied_data: !!copyData });
  return info();
}

function deleteTest() {
  if (current() !== 'main') throw new Error('Switch to the main workspace before deleting the test workspace.');
  fs.rmSync(testDir(), { recursive: true, force: true });
  writeState({ test_created_at: null, test_copied_data: false });
  return info();
}

// Persists the choice; the caller relaunches the app.
function setNext(name) {
  if (name === 'test' && !testExists()) throw new Error('No test workspace yet.');
  writeState({ workspace: name === 'test' ? 'test' : 'main' });
}

module.exports = { current, dataDir, info, createTest, deleteTest, setNext, readState, writeState };
