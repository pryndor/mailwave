# MailWave Pro webhook — GoDaddy cPanel version

Same job as `payment-webhook/` (the Vercel version): Razorpay calls this on
every successful subscription charge, it verifies the request is genuinely
from Razorpay, signs a license token, and emails it to the buyer. This
version runs on your existing GoDaddy cPanel hosting instead of Vercel —
Python via cPanel's "Setup Python App", since this plan doesn't have a
Node.js option (only Ruby/Python/Perl/PHP were available).

Verified cross-language compatible with `electron/license.js`: Ed25519 is
a deterministic standard (RFC 8032) — a token signed here with the same
private key verifies correctly in the desktop app, tested locally before
writing this.

## Setup

### 1. Create the Python app in cPanel

1. cPanel → Software → **Setup Python App** → Create Application
2. Python version: 3.9 or newer if offered
3. Application root: any folder, e.g. `license-webhook`
4. Application URL: a subdomain (recommended, e.g. `license.drugvigil.com`)
   or a path under your main domain
5. Click Create — cPanel generates a virtualenv and a starter
   `passenger_wsgi.py` in that folder

### 2. Upload this folder's files

Upload `app.py`, `passenger_wsgi.py` (overwrite cPanel's starter one with
this repo's version), and `requirements.txt` into the application root
cPanel created — via File Manager, or `git clone`/`scp` if you have SSH.

### 3. Install dependencies

cPanel's Python App page shows a command like:
```
source /home/<user>/virtualenv/license-webhook/3.9/bin/activate && cd /home/<user>/license-webhook
```
Run that (via cPanel's Terminal app, or SSH), then:
```
pip install -r requirements.txt
```

### 4. Environment variables

In the cPanel Python App page, under **Environment Variables**, add
everything from `.env.example`:

- `RAZORPAY_WEBHOOK_SECRET` — set when you create the webhook in Razorpay
- `LICENSE_PRIVATE_KEY_PEM` — paste the **entire contents** of
  `license-tooling/private_key.pem`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `FROM_EMAIL` —
  same Zoho credentials MailWave itself uses

Click **Restart** on the app after saving — cPanel/Passenger caches the
running process and won't pick up new env vars or code otherwise.

### 5. Razorpay Dashboard — webhook

Settings → Webhooks → Add New Webhook, URL:
`https://license.drugvigil.com/api/razorpay-webhook` (or your chosen
domain/path), events: `subscription.activated` and `subscription.charged`,
secret matching what you put in `RAZORPAY_WEBHOOK_SECRET`.

## Test it

Razorpay Dashboard → your webhook → **Test Webhook** → send a
`subscription.charged` test event. Check cPanel's error log for this app
(usually linked from the Python App page, or `~/logs/` in the app's
domain-mapped folder) if the test email doesn't arrive.

## Real risk to check before relying on this

**Some GoDaddy shared hosting plans block outbound SMTP** (port 25/465/587
to third-party mail servers) as an anti-spam measure — this would break
the email-sending step entirely, independent of whether the code is
correct. **Verify this works before going live**: trigger a test webhook
and confirm the email actually arrives. If outbound SMTP is blocked, the
options are asking GoDaddy support to allow it for your account, or
falling back to `payment-webhook/` (the Vercel version) for just the
email-sending step.

## Known limitations (same as the Vercel version)

- No idempotency — a retried webhook delivery sends a duplicate (harmless) email.
- No cancellation handling — a cancelled subscription just stops producing
  charge events; the customer's current token runs out at its own expiry
  plus the 30-day grace period already built into `electron/license.js`.
- Email is the only identity check — whoever's email Razorpay reports on
  the payment gets the license.
