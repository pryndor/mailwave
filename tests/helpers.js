// Test helpers: a throwaway data directory per test file, and module stubs.
// node --test runs each file in its own process, so stubs never leak between files.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ELECTRON_DIR = path.join(__dirname, '..', 'electron');

// stubs: { './workspace': {...}, 'nodemailer': {...} } — matched by the
// require() string as written inside electron/*.js.
function stubModules(stubs) {
  const origLoad = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return origLoad.call(this, request, parent, ...rest);
  };
}

// A fresh workspace (SQLite DB + settings.json) for this test file.
function tempWorkspace(initialSettings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailwave-test-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(initialSettings));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return { dataDir: () => dir, dir };
}

const load = (name) => require(path.join(ELECTRON_DIR, name));

module.exports = { stubModules, tempWorkspace, load, ELECTRON_DIR };
