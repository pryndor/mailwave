const { execFileSync } = require('child_process');

const SERVICE = 'mailwave.service';

// Returns true/false, or null if systemd/the unit isn't available (e.g. non-Linux, no systemd).
function isEnabled() {
  try {
    const out = execFileSync('systemctl', ['--user', 'is-enabled', SERVICE], { encoding: 'utf8' }).trim();
    return out === 'enabled';
  } catch (err) {
    const out = (err.stdout || '').toString().trim();
    if (out === 'disabled') return false;
    return null;
  }
}

function setEnabled(enabled) {
  try {
    execFileSync('systemctl', ['--user', enabled ? 'enable' : 'disable', SERVICE], { encoding: 'utf8' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { isEnabled, setEnabled };
