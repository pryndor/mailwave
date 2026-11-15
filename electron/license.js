const crypto = require('crypto');

// Public half of the Ed25519 keypair used to sign license tokens. The private
// key never ships with the app — it lives only in license-tooling/ (gitignored)
// and is used offline to issue tokens on purchase. Verification here needs no
// network call, so Pro features keep working with no internet connection.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA1wfP+aRRalqP9DDzmYU24/1eUvLmOGP9aJfx8TA66Ss=
-----END PUBLIC KEY-----`;

const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);

// ── Paid plans switch ────────────────────────────────────────────────────────
// false = every feature is unlocked for everyone, and the License section and
// all "Upgrade to Pro" buttons are hidden. This is the current setting: the
// Razorpay webhook that emailed license keys lived on the meddra-learn server,
// which was shut down on 2026-11-15, so nothing can deliver keys to buyers.
//
// To turn paid plans back on:
//   1. Host the webhook again (see payment-webhook-vps/README.md) and point the
//      Razorpay webhook at it.
//   2. Set this to true. Everything below (signed tokens, grace period, trial)
//      is unchanged and starts working again as before.
const PAID_PLANS_ENABLED = false;

// Renewal payment failed or lapsed: keep Pro features working for this many
// days past expiry rather than hard-locking a paying customer's app the
// moment a card fails or they're a day late renewing.
const GRACE_DAYS = 30;

function b64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

// Verifies signature + shape only. Does not evaluate expiry — see getStatus().
function parseToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let signature;
  try {
    signature = b64urlDecode(sigB64);
  } catch {
    return null;
  }

  const valid = crypto.verify(null, Buffer.from(payloadB64), publicKey, signature);
  if (!valid) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
    if (payload.plan !== 'pro' || !payload.email || !payload.expires) return null;
    return payload;
  } catch {
    return null;
  }
}

// Returns one of:
//   { plan: 'free' }
//   { plan: 'free', reason: 'invalid' | 'expired', ... }
//   { plan: 'pro', status: 'active' | 'grace', email, expires, daysLeft }
//   { plan: 'pro', status: 'all-free' }   (PAID_PLANS_ENABLED is false)
function getStatus(licenseKey) {
  if (!PAID_PLANS_ENABLED) return { plan: 'pro', status: 'all-free' };
  if (!licenseKey) return { plan: 'free' };

  const payload = parseToken(licenseKey);
  if (!payload) return { plan: 'free', reason: 'invalid' };

  const expires   = new Date(payload.expires);
  const graceEnds = new Date(expires.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  const now       = new Date();

  if (now <= expires) {
    const daysLeft = Math.ceil((expires - now) / (24 * 60 * 60 * 1000));
    return { plan: 'pro', status: 'active', email: payload.email, expires: payload.expires, daysLeft };
  }
  if (now <= graceEnds) {
    const daysLeft = Math.ceil((graceEnds - now) / (24 * 60 * 60 * 1000));
    return { plan: 'pro', status: 'grace', email: payload.email, expires: payload.expires, daysLeft };
  }
  return { plan: 'free', reason: 'expired', email: payload.email, expiredOn: payload.expires };
}

function isPro(licenseKey) {
  return getStatus(licenseKey).plan === 'pro';
}

module.exports = { getStatus, isPro, PAID_PLANS_ENABLED };
