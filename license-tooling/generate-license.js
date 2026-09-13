// Internal tool — run this yourself after a purchase (manually, or wired to a
// Lemon Squeezy/Paddle webhook later) to issue a Pro license token.
// Never ships inside the app; needs private_key.pem, which is gitignored.
//
// Usage: node generate-license.js <email> [years]

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const [, , email, yearsArg] = process.argv;

if (!email) {
  console.error('Usage: node generate-license.js <email> [years]');
  process.exit(1);
}

const years = Number(yearsArg) || 1;

const privateKeyPath = path.join(__dirname, 'private_key.pem');
if (!fs.existsSync(privateKeyPath)) {
  console.error(`Missing ${privateKeyPath} — run generate-keypair.js first.`);
  process.exit(1);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, 'utf8'));

const now     = new Date();
const expires = new Date(now.getTime() + years * 365 * 24 * 60 * 60 * 1000);

const payload = {
  email,
  plan:    'pro',
  issued:  now.toISOString(),
  expires: expires.toISOString(),
};

const payloadB64  = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signature   = crypto.sign(null, Buffer.from(payloadB64), privateKey);
const token       = `${payloadB64}.${signature.toString('base64url')}`;

console.log('License token for', email, `(expires ${payload.expires}):\n`);
console.log(token);
