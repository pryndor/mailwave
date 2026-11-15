# MailWave: TODO

Last revised 2026-11-15. This is the overview. The detailed lists are in
[AI_TODO.md](AI_TODO.md) (AI features) and [TEAM_SYNC.md](TEAM_SYNC.md) ("Not done yet").

## Current state

- **Every feature is free.** Paid plans are switched off with `PAID_PLANS_ENABLED = false` in
  `electron/license.js`. The License section and all "Upgrade to Pro" buttons are hidden, and
  `isPro()` returns true for everyone.
- **Why:** the Razorpay webhook that emailed license keys ran on the meddra-learn server,
  which was deleted on 2026-11-15. Nothing can deliver a key to a buyer right now.
- The signing key is safe at `license-tooling/private_key.pem` (gitignored, local only).
  Licenses already issued still verify offline.

## 1. Urgent (outside the code)

- [ ] **Razorpay dashboard:** deactivate the payment link `https://rzp.io/rzp/hz68qyl` (older
  builds of the app still open it) and remove the webhook that pointed at
  `meddra-learn.drugvigil.com/mailwave/razorpay-webhook`.
- [ ] Check Razorpay for any MailWave payments or renewals since 2026-11-15, and for active
  subscriptions. Issue those buyers keys by hand
  (`node license-tooling/generate-license.js buyer@email.com 1`) or cancel and refund.
- [ ] Back up `license-tooling/private_key.pem` somewhere safe outside this computer
  (password manager or encrypted drive). The server copy is gone, so this is the only one.

## 2. Release (free version)

- [ ] Bump the version in `package.json` (currently 1.2.0) and note "all features free".
- [ ] Push and tag `v*` so `.github/workflows/build.yml` builds Linux, Windows and Mac.
- [ ] Click through the built app once: Settings shows no License section, and Smart Schedule,
  AI review, AI reports, Team Sync, Automation API and FTP/SFTP sync all work without a key.

## 3. Turning paid plans back on (later)

1. Host the webhook again. Choose one:
   - `payment-webhook-vps/` (ready-made Node service) on another server, such as the box
     that runs ncloud.drugvigil.com;
   - or port `payment-webhook-vps/server.js` to a serverless function (Cloudflare Workers,
     Vercel), with the private key stored as a secret.
2. Point a Razorpay webhook at it (`subscription.activated` + `subscription.charged`) and
   send a test event.
3. Set `PAID_PLANS_ENABLED = true` in `electron/license.js`, restore the "Free and Pro"
   section in README.md (it's kept in an HTML comment) and ship a release.
4. Optional: a server-issued trial token, so the Team Sync trial can't be reset
   (TEAM_SYNC.md gap 11).

## 4. AI features (details in AI_TODO.md)

1. Test with Ollama offline and with no key.
2. Streaming, so long drafts appear as they're written.
3. Dashboard insight card.
4. Image alt text generator.
5. In-app help assistant.
6. Cost per feature in Settings.
7. Ask your data.
8. Later or blocked: template generator (needs an HTML template mode), engagement scoring and
   send-time advice (need per-subscriber open data), personalised lines (need the privacy toggle).

## 5. Team Sync (details in TEAM_SYNC.md)

1. Live test against real github.com with two profiles.
2. "Sign in with GitHub" button: register an OAuth App and set `GITHUB_CLIENT_ID`.
3. Compaction / snapshots of event files.
4. Encrypted attachment upload.
5. Remote stop, live refresh on editing pages, passphrase rotation, roles, per-field merge.
