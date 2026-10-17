// Secrets (Team Sync token/key, AI API key) go through the OS keychain when
// available (safeStorage), so they aren't sitting in plain settings.json like
// smtp_pass does.
const { safeStorage } = require('electron');

function seal(value) {
  if (!value) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(value).toString('base64');
  return 'plain:' + value;
}

function unseal(value) {
  if (!value) return '';
  if (value.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')); } catch { return ''; }
  }
  return value.startsWith('plain:') ? value.slice(6) : value;
}

const keychainAvailable = () => safeStorage.isEncryptionAvailable();

module.exports = { seal, unseal, keychainAvailable };
