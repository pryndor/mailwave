// Standalone Node.js service: Razorpay calls it on each successful
// subscription charge; it verifies the request, signs a MailWave Pro license
// token and emails it to the buyer. Runs as a long-lived process behind Apache
// as a reverse proxy on a VPS, on its own subdomain. See README.md for the Apache
// vhost + systemd setup.
//
// Required environment variables (set via the systemd unit's EnvironmentFile,
// never committed):
//   RAZORPAY_WEBHOOK_SECRET  — from Razorpay Dashboard > Webhooks
//   LICENSE_PRIVATE_KEY_PATH — path to license-tooling/private_key.pem on the
//                              server (preferred), OR LICENSE_PRIVATE_KEY_PEM
//                              with the key contents inline as a fallback
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL — your Zoho SMTP creds
//   PORT — local port to listen on, defaults to 8787 (Apache proxies to this)

const http       = require('http');
const crypto     = require('crypto');
const fs         = require('fs');
const nodemailer = require('nodemailer');

// Reading the key from a file (LICENSE_PRIVATE_KEY_PATH) is preferred:
// systemd's EnvironmentFile doesn't cleanly support multi-line values, which a
// PEM is. LICENSE_PRIVATE_KEY_PEM (inline) still works as a fallback.
function loadPrivateKey() {
  if (process.env.LICENSE_PRIVATE_KEY_PATH) {
    return crypto.createPrivateKey(fs.readFileSync(process.env.LICENSE_PRIVATE_KEY_PATH, 'utf8'));
  }
  return crypto.createPrivateKey(process.env.LICENSE_PRIVATE_KEY_PEM);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signLicense(email, years = 1) {
  const privateKey = loadPrivateKey();
  const now        = new Date();
  const expires    = new Date(now.getTime() + years * 365 * 24 * 60 * 60 * 1000);
  const payload    = { email, plan: 'pro', issued: now.toISOString(), expires: expires.toISOString() };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature  = crypto.sign(null, Buffer.from(payloadB64), privateKey);
  return { token: `${payloadB64}.${signature.toString('base64url')}`, expires: payload.expires };
}

async function emailLicense(email, token, expiresISO) {
  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const expiresLabel = new Date(expiresISO).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  await transport.sendMail({
    from:    `MailWave <${process.env.FROM_EMAIL}>`,
    to:      email,
    subject: 'Your MailWave Pro license key',
    text: [
      'Thanks for subscribing to MailWave Pro!',
      '',
      `Your license key (valid until ${expiresLabel}):`,
      '',
      token,
      '',
      'To activate: open MailWave -> Settings -> License -> paste this key -> Activate.',
      '',
      'Keep this email -- you can re-activate with the same key on a new machine.',
      'Questions? Just reply to this email.',
    ].join('\n'),
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/razorpay-webhook') {
    return sendJson(res, 404, { error: 'not found' });
  }

  const rawBody = await readRawBody(req);

  const valid = verifySignature(rawBody, req.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET);
  if (!valid) return sendJson(res, 400, { error: 'invalid signature' });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON' });
  }

  // Fires on the subscription's first successful charge and every renewal.
  if (event.event !== 'subscription.charged' && event.event !== 'subscription.activated') {
    return sendJson(res, 200, { ok: true, ignored: event.event });
  }

  const email = event.payload?.payment?.entity?.email
    || event.payload?.subscription?.entity?.notes?.email;

  if (!email) return sendJson(res, 400, { error: 'no customer email in webhook payload' });

  try {
    const { token, expires } = signLicense(email, 1);
    await emailLicense(email, token, expires);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('license issuance failed:', err);
    return sendJson(res, 500, { error: err.message });
  }
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`license webhook listening on 127.0.0.1:${port}`);
});
