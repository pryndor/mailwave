# MailWave Pro — payment webhook

Standalone Vercel project (separate from the desktop app). Razorpay calls
this on every successful subscription charge; it verifies the request is
genuinely from Razorpay, signs a license token, and emails it to the buyer
through your existing Zoho SMTP account. No database — fully stateless.

## One-time setup

### 1. Razorpay Dashboard — create the annual Pro plan

1. Dashboard -> Subscriptions -> Plans -> Create Plan
2. Billing frequency: **Yearly**, amount: your Pro price (e.g. ₹3,499)
3. Save the Plan ID (`plan_xxx`)
4. Subscriptions -> Create Subscription (or use a **Subscription Link**,
   Dashboard -> Payment Links -> Subscription Link, so you get a shareable
   URL to put on your site/README with no checkout code to build)

### 2. Razorpay Dashboard — webhook

1. Dashboard -> Settings -> Webhooks -> Add New Webhook
2. URL: `https://<your-vercel-project>.vercel.app/api/razorpay-webhook`
   (you'll have this after step 3 below — come back and fill it in)
3. Active events: check `subscription.activated` and `subscription.charged`
4. Set a webhook secret (any strong random string) — save it, you'll need
   it in step 3

### 3. Deploy this folder to Vercel

```bash
cd payment-webhook
npx vercel        # first deploy, follow the prompts, keep it a separate project
npx vercel --prod
```

Then in the Vercel project dashboard -> Settings -> Environment Variables,
add everything from `.env.example`:

- `RAZORPAY_WEBHOOK_SECRET` — the secret you set in step 2
- `LICENSE_PRIVATE_KEY_PEM` — paste the **entire contents** of
  `license-tooling/private_key.pem` (multi-line PEM is fine)
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `FROM_EMAIL` —
  same Zoho credentials MailWave itself uses

Redeploy (`npx vercel --prod`) after adding env vars so the function picks
them up. Copy the deployed URL back into the Razorpay webhook config from
step 2.

## Test it

Razorpay Dashboard -> Webhooks -> your webhook -> **Test Webhook**, send a
`subscription.charged` test event. Check the Vercel function logs
(`npx vercel logs`) and confirm the test email arrived.

For a real end-to-end test, use Razorpay's test mode subscription link with
a test card before going live.

## Known limitations (fine for launch, revisit if volume grows)

- **No idempotency store.** If Razorpay retries a webhook delivery, the
  customer gets a duplicate email with a fresh (harmless, same-expiry-ish)
  token. Not a correctness bug, just a minor annoyance at scale.
- **Cancellations aren't handled.** A cancelled subscription simply stops
  generating `subscription.charged` events, so no new token is issued —
  the customer's current token still runs out at its own expiry + the
  30-day grace period in `electron/license.js`. There's no way to revoke
  early, which is the accepted tradeoff of fully offline verification.
- **Email is the only identity check.** Whoever's email Razorpay reports
  on the payment gets the license. Fine for an indie tool, not designed
  to stop deliberate abuse.
