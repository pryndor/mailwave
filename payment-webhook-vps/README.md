# MailWave Pro webhook — Hetzner VPS version

Same job as `payment-webhook/` (Vercel) and `payment-webhook-cpanel/`
(GoDaddy Python) — this one reuses the exact same Node.js logic as the
Vercel version verbatim, just running as a standalone `server.js` process
behind Apache instead of a serverless function. No SMTP-blocking risk like
shared hosting can have, no PHP/Python rewrite needed, full control.

Meant for the same Hetzner box already running `ncloud.drugvigil.com`
(Apache, certbot-managed TLS — see the Nextcloud/LibreSign setup notes),
on a new subdomain, e.g. `webhook.drugvigil.com`.

## Setup

1. Install Node.js on the server if not already present (NodeSource repo or
   the distro's package manager — check `node --version` first).
2. Create `/var/www/webhook.drugvigil.com/`, upload `server.js`,
   `package.json`, and `license-tooling/private_key.pem` (**this directory
   should NOT be web-accessible for static files** — it's only reached via
   the Apache ProxyPass to the Node process, never serves the private key
   as a static file).
3. `cd /var/www/webhook.drugvigil.com && npm install --omit=dev`
4. Create `.env` from `.env.example`, fill in real values.
5. Copy `mailwave-webhook.service` to `/etc/systemd/system/`, then:
   ```
   systemctl daemon-reload
   systemctl enable --now mailwave-webhook
   systemctl status mailwave-webhook   # should show "listening on 127.0.0.1:8787"
   ```
6. Set up the Apache vhost — see `apache-webhook.drugvigil.com.conf` for
   the exact commands (enable proxy modules, enable the site, run certbot
   for the subdomain, then copy the ProxyPass lines into the certbot-
   generated `-le-ssl.conf` too since certbot doesn't carry them over
   automatically).
7. Razorpay Dashboard → Webhooks → URL `https://webhook.drugvigil.com/api/razorpay-webhook`,
   events `subscription.activated` + `subscription.charged`, secret
   matching `RAZORPAY_WEBHOOK_SECRET`.

## Test it

Razorpay Dashboard → your webhook → Test Webhook → send a
`subscription.charged` test event, then:
```
journalctl -u mailwave-webhook -f
```
to watch it process in real time, and confirm the test email arrives.

## Known limitations (same as the other two versions)

- No idempotency — a retried webhook delivery sends a duplicate (harmless) email.
- No cancellation handling — relies on the existing 30-day grace period in
  `electron/license.js` to let a lapsed subscription's token quietly expire.
- Email is the only identity check on who gets a license.

## If you'd rather not stand up yet another deployment

You mentioned a second Hetzner instance that already has a working
Razorpay integration from another project — if that app already has a
proven webhook-receiving setup, it's very likely less work to add one more
route to that existing, already-working server than to finish standing up
this one from scratch. Worth checking before deploying this.
