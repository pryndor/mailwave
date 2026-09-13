const { Notification } = require('electron');

/**
 * Send a native OS desktop notification.
 * Works on macOS, Windows, and Linux (requires libnotify on Linux).
 */
function sendNative(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (e) {
    console.error('[MailWave] Native notification error:', e.message);
  }
}

module.exports = { sendNative };
