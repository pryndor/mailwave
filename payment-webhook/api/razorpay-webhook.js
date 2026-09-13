// Vercel serverless function (Node runtime). Receives Razorpay subscription
// webhooks, verifies the signature, signs a MailWave Pro license token, and
// emails it to the buyer. Stateless — no database, no stored customer list.
//
// Required environment variables (set in the Vercel project, never committed):
//   RAZORPAY_WEBHOOK_SECRET  — from Razorpay Dashboard > Webhooks
//   LICENSE_PRIVATE_KEY_PEM  — contents of license-tooling/private_key.pem
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL — your Zoho SMTP creds

const crypto     = require('crypto');
const nodemailer = require('nodemailer');

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
  const privateKey = crypto.createPrivateKey(process.env.LICENSE_PRIVATE_KEY_PEM);
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

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);

  const valid = verifySignature(rawBody, req.headers['x-razorpay-signature'], process.env.RAZORPAY_WEBHOOK_SECRET);
  if (!valid) return res.status(400).json({ error: 'invalid signature' });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  // Fires on the subscription's first successful charge and every renewal.
  if (event.event !== 'subscription.charged' && event.event !== 'subscription.activated') {
    return res.status(200).json({ ok: true, ignored: event.event });
  }

  const email = event.payload?.payment?.entity?.email
    || event.payload?.subscription?.entity?.notes?.email;

  if (!email) return res.status(400).json({ error: 'no customer email in webhook payload' });

  try {
    const { token, expires } = signLicense(email, 1);
    await emailLicense(email, token, expires);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('license issuance failed:', err);
    return res.status(500).json({ error: err.message });
  }
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;
