const { app } = require('electron');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const AUTOSTART_DIR  = path.join(os.homedir(), '.config', 'autostart');
const DESKTOP_FILE    = path.join(AUTOSTART_DIR, 'mailwave.desktop');

// AppImage sets this env var to the real .AppImage file path. process.execPath
// would otherwise point at the temporary FUSE mount, which changes every launch
// and would break the autostart entry.
function linuxExecPath() {
  return process.env.APPIMAGE || process.execPath;
}

function isEnabled() {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return app.getLoginItemSettings().openAtLogin;
  }
  if (process.platform === 'linux') {
    return fs.existsSync(DESKTOP_FILE);
  }
  return null;
}

function setEnabled(enabled) {
  try {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled });
      return { ok: true };
    }
    if (process.platform === 'linux') {
      if (enabled) {
        fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
        const entry = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=MailWave',
          `Exec="${linuxExecPath()}"`,
          'X-GNOME-Autostart-enabled=true',
          '',
        ].join('\n');
        fs.writeFileSync(DESKTOP_FILE, entry, 'utf8');
      } else if (fs.existsSync(DESKTOP_FILE)) {
        fs.unlinkSync(DESKTOP_FILE);
      }
      return { ok: true };
    }
    return { ok: false, error: `Run-at-startup not supported on ${process.platform}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { isEnabled, setEnabled };
