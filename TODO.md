# MailWave: TODO

Last revised 2026-11-27. Everything open, in priority order. Detailed lists:
[AI_TODO.md](AI_TODO.md) (AI features) and [TEAM_SYNC.md](TEAM_SYNC.md) ("Not done yet").

## Current state

- **Every feature is free.** Paid plans are switched off with `PAID_PLANS_ENABLED = false` in
  `electron/license.js`. The License section and "Upgrade to Pro" buttons are hidden, and
  `isPro()` returns true for everyone. Reason: the server that ran the Razorpay webhook (which emailed
  license keys) was shut down on 2026-11-15, so nothing can deliver a key right now.
- **Update check (2026-11-27).** Daily check of GitHub's latest release, notification + banner
  once per new version, Settings → Updates with Check now. Notify only (`electron/updates.js`).
  Later option: real auto-install with `electron-updater` (needs `latest*.yml` files in releases
  and, on Mac/Windows, code signing).
- **Social posting started (2026-11-27).** Social page, scheduling, AI writer, LinkedIn,
  Facebook Pages, Instagram and X are built and tested against fake APIs only. Code: `electron/social/`,
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
- [x] **Facebook Pages + Instagram Business/Creator** (2026-11-27): one Meta sign-in adds every
  shared Page and linked Instagram account. Facebook: text + link card, or one photo. Instagram:
  one image + caption, hosted via an unpublished Page photo (deleted after publishing), container
  status polling, 30-hashtag check. Graph API `v24.0` in `electron/social/meta.js`.
- [x] **X (Twitter)** (2026-11-27): OAuth 2.0 + PKCE through the user's own app (Native App
  without secret, or Web App with Basic auth), callback `http://127.0.0.1:47619/x/callback`,
  two-hour tokens refreshed before publishing (rotating refresh tokens saved, one refresh per
  account at a time), text with link in the text, one image via `POST /2/media/upload`, X-style
  character counting (links 23, wide characters 2), clear messages for 402 (no credits),
  duplicates and rate limits. X charges per post (pay-per-use since 2026). `electron/social/x.js`.

Next, in order:
- [ ] **Live test LinkedIn** with a real developer app (only tested against a fake API so far).
  Check: sign-in, text post, image post, link card, parentheses/@ in text, `LinkedIn-Version`
  header `202610` still accepted (bump yearly in `electron/social/linkedin.js`).
- [ ] **Live test X** with a real developer app and a few dollars of credits. Check: X accepts
  the `127.0.0.1` callback, Native App (no secret) sign-in, text post, link post, image upload via
  `/2/media/upload` multipart, refresh after 2 hours (scheduled post), 402 message when credits
  run out.
- [ ] **Live test Facebook + Instagram** with a real Meta app in development mode. Check: login
  dialog accepts the `scope` list (newer "Facebook Login for Business" apps may need a
  `config_id` instead), localhost redirect accepted, Page text/link/photo posts, Instagram image
  post via the unpublished-photo URL, the helper photo is deleted, PNG works for Instagram.
- [ ] Meta extras: Instagram carousels and Reels, Facebook multi-photo, first comment, App Review
  path for people who want MailWave to post for clients' Pages.
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
  free, social posting (LinkedIn, Facebook, Instagram, X)".
- [ ] Tag `v*` so `.github/workflows/build.yml` builds Linux, Windows and Mac, then **publish**
  the draft release with notes. Installed apps (1.3.0 and later) see it within a day through the
  update check; drafts and pre-releases are never announced.
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
