// One-time setup script. Already run once for this project — re-running
// generates a NEW keypair, which invalidates every license token already
// issued to customers, since electron/license.js only trusts one public key.
// Only run this if you are deliberately rotating keys (and are prepared to
// re-issue every existing customer a new token signed with the new key).

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

fs.writeFileSync(path.join(__dirname, 'private_key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync(path.join(__dirname, 'public_key.pem'),  publicKey.export({ type: 'spki', format: 'pem' }));

console.log('Keypair written to license-tooling/.');
console.log('Copy public_key.pem into the PUBLIC_KEY_PEM constant in electron/license.js.');
