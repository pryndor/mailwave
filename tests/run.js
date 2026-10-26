// Runs the test suite under Electron's own Node (ELECTRON_RUN_AS_NODE), since
// better-sqlite3 is built for Electron's ABI, not the system Node's.
//   npm test                 all tests
//   npm test -- mailer       only files whose name contains "mailer"
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const filter = process.argv[2] || '';
const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => /\.test\.(js|mjs)$/.test(f) && f.includes(filter))
  .map(f => path.join(dir, f));
if (!files.length) { console.error(`No test files match "${filter}"`); process.exit(1); }

const res = spawnSync(electron, ['--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(res.status ?? 1);
