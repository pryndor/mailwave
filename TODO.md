# MailWave: TODO

Last revised 2026-11-27. Everything open, in priority order. Detailed lists:
[AI_TODO.md](AI_TODO.md) (AI features) and [TEAM_SYNC.md](TEAM_SYNC.md) ("Not done yet").

## Current state

- **Every feature is free.** Paid plans are switched off with `PAID_PLANS_ENABLED = false` in
  `electron/license.js`. The License section and "Upgrade to Pro" buttons are hidden, and
  `isPro()` returns true for everyone. Reason: the server that ran the Razorpay webhook (which emailed
  license keys) was shut down on 2026-11-15, so nothing can deliver a key right now.
- **Social posting started (2026-11-27).** Social page, scheduling, AI writer and LinkedIn
  (personal profile) are built and tested against a fake LinkedIn API. Code: `electron/social/`,
  `renderer/src/pages/Social.jsx`, tests in `tests/social.test.js`.

## P0. Urgent: do these yourself, in Razorpay and on your computer

- [ ] **Razorpay dashboard:** deactivate the old payment link (older builds of the app still
  open it; see `UPGRADE_URL` in `electron/main.js`) and remove the webhook that pointed at the
  old server.
- [ ] **Check Razorpay for payments since 2026-11-15** and for active subscriptions. Send those
  buyers keys by hand (`node license-tooling/generate-license.js buyer@email.com 1`) or refund.
- [ ] **Back up `license-tooling/private_key.pem`** somewhere outside this computer (password
  manager or encrypted drive). It's the only copy: if this disk dies, no new license keys.

## P1. Social marketing (in progress, one platform at a time)

Done:
- [x] Base: Social page (posts list, composer, accounts), posts and accounts in SQLite, tokens
  sealed in the OS keychain, schedule that survives restarts (missed if >6 h late), per-account
  status, retry only where missing, never auto-retry a post interrupted mid-publish.
- [x] AI writer: posts from a brief, adapt main text per platform, email campaign → posts.
- [x] **LinkedIn** personal profile: OAuth sign-in through the user's own developer app, text,
  one image or link card, 60-day token expiry warning.

Next, in order:
- [ ] **Live test LinkedIn** with a real developer app (only tested against a fake API so far).
  Check: sign-in, text post, image post, link card, parentheses/@ in text, `LinkedIn-Version`
  header `202610` still accepted (bump yearly in `electron/social/linkedin.js`).
- [ ] **Facebook Pages + Instagram Business** (one Meta app, Graph API). Page token from user
  token; Instagram needs an image or video and a Business account linked to the Page. Publishing
  for other people's Pages needs Meta App Review (`pages_manage_posts`,
  `instagram_content_publish`); app admins can post to their own Pages in development mode.
- [ ] **X (Twitter)**: OAuth 2.0 with PKCE, `tweet.write users.read offline.access`, refresh
  tokens. Check current API pricing/limits for posting before building.
- [ ] **Bluesky** (app password, no developer app) and **Mastodon** (access token per server).
- [ ] **Threads** (Meta, reuses the Meta app).
- [ ] **Google Business Profile** (local businesses: posts, offers, events). API access needs a
  Google request form approval.
- [ ] **Pinterest**, then TikTok and YouTube (video-first, later).
- [ ] LinkedIn **Company Pages** (Community Management API, needs LinkedIn review).
- [ ] Features: multiple images, video, first comment, calendar view, post analytics (likes,
  comments, reach) where APIs allow, reusable post templates, hashtag sets, Team Sync for social
  posts (accounts stay per device), Automation API endpoints for social posts.

## P2. Release (free version)

- [ ] Live-test LinkedIn (above), then bump `package.json` version (now 1.2.0): "all features
  free, social posting (LinkedIn)".
- [ ] Tag `v*` so `.github/workflows/build.yml` builds Linux, Windows and Mac.
- [ ] Click through the built app: no License section; Smart Schedule, AI review and reports,
  Team Sync, Automation API, FTP/SFTP sync and Social all work without a key.

## P3. AI features (details in AI_TODO.md)

1. Test with Ollama offline and with no key.
2. Streaming, so long drafts appear as they're written.
3. Dashboard insight card.
4. Image alt text generator.
5. In-app help assistant.
6. Cost per feature in Settings.
7. Ask your data.
8. Later or blocked: template generator (needs an HTML template mode), engagement scoring and
   send-time advice (need per-subscriber open data), personalised lines (need the privacy toggle).

## P4. Team Sync (details in TEAM_SYNC.md)

1. Live test against real github.com with two profiles.
2. "Sign in with GitHub" button: register an OAuth App and set `GITHUB_CLIENT_ID`.
3. Compaction / snapshots of event files.
4. Encrypted attachment upload.
5. Remote stop, live refresh on editing pages, passphrase rotation, roles, per-field merge.

## P5. Turning paid plans back on (later)

1. Host the webhook again: `payment-webhook-vps/` on another server, or
   port `server.js` to a serverless function with the private key as a secret.
2. Point a Razorpay webhook at it (`subscription.activated` + `subscription.charged`), send a
   test event.
3. Set `PAID_PLANS_ENABLED = true`, restore the "Free and Pro" section in README.md (kept in an
   HTML comment), decide which social features are Pro, ship a release.
4. Optional: server-issued trial token so the Team Sync trial can't be reset (TEAM_SYNC.md gap 11).
