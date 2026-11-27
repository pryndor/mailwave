# MailWave

A desktop app for promoting your business by **email and social media** from your own computer. Send newsletters through your own SMTP account, and publish posts to your social accounts, now or on a schedule. No monthly fee per subscriber, no vendor lock-in, and your data never leaves your computer.

Linux, Windows and Mac. Built with Electron and React. Licensed AGPL-3.0.

- [Why MailWave](#why-mailwave)
- [Free](#free)
- [Install](#install)
- [Quick start](#quick-start)
- [Guide](#guide): [importing](#importing-subscribers) · [writing](#writing-a-campaign) · [sending safely](#sending-safely) · [scheduling](#scheduling) · [A/B tests](#ab-testing-subject-lines) · [history](#history-and-failures) · [social posts](#social-posts) · [AI](#ai-writing-and-review) · [Team Sync](#team-sync) · [Automation API](#automation-api) · [more](#more-features)
- [Privacy](#privacy) · [Compliance](#compliance) · [Build from source](#build-from-source) · [License](#license-and-credits)

## Why MailWave

Mailchimp, Brevo and similar services charge every month by list size and keep your list on their servers. Social schedulers such as Buffer or Hootsuite charge per account. If you already pay for an email account (Zoho, Gmail, Outlook, your own mail server) or a sending service (Brevo, SendGrid, Amazon SES), MailWave sends your newsletters through it from your own computer, and posts to your social accounts directly through each platform's official API.

It's built for **lists of people who opted in**: newsletters, customer updates, announcements. It is not a cold-email tool, and it stops itself when a list looks bad.

## Free

Every feature is free, with no license key, trial or account.

<!-- Paid plans are switched off for now (PAID_PLANS_ENABLED in electron/license.js).
     Restore this section when they are switched back on.

## Free and Pro

| | Free | Pro |
|---|:-:|:-:|
| Subscribers, groups, CSV import/export with list cleaning | ✅ | ✅ |
| Rich-text campaigns, templates, merge tags, preview text | ✅ | ✅ |
| Batch sending, daily limits, auto-pause and resume | ✅ | ✅ |
| Scheduling, A/B subject tests (including automatic winner) | ✅ | ✅ |
| Send history with failure causes | ✅ | ✅ |
| AI writing with your own API key | ✅ | ✅ |
| AI pre-send review and AI campaign reports | | ✅ |
| Smart Schedule (send at a set local time in each recipient's timezone) | | ✅ |
| Team Sync (share everything with teammates, end-to-end encrypted) | 7-day trial | ✅ |
| Automation API (n8n, scripts) | | ✅ |
| Website subscriber sync (FTP/SFTP) | | ✅ |

Get Pro from **Settings → License → Upgrade to Pro**. The license key arrives by email; paste it into the same section. Licenses are checked offline, so Pro keeps working without internet.
-->

## Install

Download the latest build for your system from [Releases](../../releases).

**Linux (AppImage)**
```bash
chmod +x MailWave-*.AppImage
./MailWave-*.AppImage
```

**Windows:** run the `.exe` installer. The build isn't code-signed yet, so SmartScreen warns on first run: click *More info → Run anyway*.

**Mac:** open the `.dmg`. The build isn't notarized yet, so Gatekeeper blocks it: right-click the app → *Open*, or run `xattr -cr /Applications/MailWave.app` once.

## Quick start

1. **Settings → Email Provider:** pick your provider (Zoho, Gmail, Outlook, Brevo, SendGrid, Amazon SES, Mailcow or custom). MailWave fills in the server and port.
2. **Settings → SMTP Connection:** enter your username and password, then click **Test Connection**. Gmail and Outlook need an *app password*, not your normal password.
3. **Settings → Sender Identity:** set your from name and address, a reply-to and unsubscribe address if different, and your **postal address**. US anti-spam law (CAN-SPAM) requires one, and MailWave adds it to every email's footer.
4. **Settings → Daily Sending Limit:** set the limit to your provider's daily sending limit or lower. MailWave pauses there and continues the next day by itself.
5. **Subscribers → Import CSV**, then **Campaigns → New Campaign**, write it, send yourself a **Preview**, and **Send**.
6. Optional: **Social → Accounts** to connect LinkedIn, then **New Post**. See [Social posts](#social-posts).

## Guide

### Importing subscribers

**Subscribers → Import CSV** takes a CSV from anywhere. Exports from Mailchimp, beehiiv, Substack, Kit, MailerLite and similar work as they are.

1. **Match columns.** You see every column with an example value and choose what it is: email, name, first or last name, phone, company, status, a custom field, or *don't import*. Common headers are matched for you, and the email column is found from its values if no header says "email". With AI turned on, **Guess with AI** handles unclear columns. It only sees the column names and what the values look like (e.g. "dates"), never the values.
2. **Clean the list** (on by default). These are left out:
   - invalid addresses;
   - misspelled domains (`gmial.com`, `yahoo.con`);
   - spam traps and throwaway inboxes;
   - duplicates within the file;
   - domains that can't receive email.

   Tick *Also leave out role addresses* to skip `info@`, `sales@` and similar. After the import you see how many were left out and why.
3. **Statuses are kept.** People marked unsubscribed or bounced in the export come in that way, and an import never turns an unsubscribed contact back to active.

Any column you keep as a custom field becomes a merge tag: a `City` column becomes `{{city}}`.

**Smart filter** (needs AI): type what you want, such as *"active subscribers in Chennai who never got a campaign"*, and the list filters to match. **Save as group** turns the result into a group you can send to. The AI only sees field, group and campaign names, and its answer is checked against them before anything runs.

### Writing a campaign

**Campaigns → New Campaign:**

- **Subject** and **preview text**: the preview text is the line inboxes show after the subject. Use it to add something the subject doesn't say.
- **Body:** a rich-text editor with links, lists, colours and a **Merge Tags** menu.
- **Merge tags:** `{{first_name}}`, `{{name}}`, `{{last_name}}`, `{{email}}`, `{{company}}` and any custom field. Add a fallback for people without a value: `Hi {{first_name|there}},`.
- **Plain text:** leave it empty and MailWave generates it from the HTML, or write your own.
- **Attachments**, **Send To** groups (none selected = all active subscribers), and **Load from Template**.
- **Preview Merge** shows the email filled in for a real subscriber.

### Sending safely

Before sending, the **pre-send checklist** checks:

- the subject, sender, body and recipients;
- a spam score;
- merge tags that won't be filled in;
- the email's size (Gmail cuts emails over 102 KB and hides the rest, including the unsubscribe link);
- the postal address;
- whether you sent yourself a test;
- placeholder and `http://` links, missing alt text, and vague link text.

While sending, MailWave goes in batches with a pause between them, then:

| What happens | What MailWave does |
|---|---|
| Daily limit reached | Pauses and continues at your resume time tomorrow |
| Address doesn't exist | Marks the subscriber **bounced** and never emails them again |
| Connection drops or the server says "try again later" | Retries after 30 s, 2 min and 5 min, then pauses and retries in 30 min |
| Your provider's sending quota is reached | Pauses until tomorrow |
| Login fails, or the provider flags your account | Pauses until you click **Resume** |
| 10 failures in a row, or more than 2% of addresses bounce | Pauses so you can check the list before it hurts your domain |

Every email has a `List-Unsubscribe` header, which Gmail and Outlook show as an unsubscribe button. It sends an email to your unsubscribe address. When one arrives, set that subscriber to **Unsubscribed**.

### Scheduling

On a campaign's send screen, click **Schedule for later** and pick a date and time. MailWave must be running at that time; it can start at login (**Settings → Startup**) and keeps running in the tray.

**Smart Schedule** sends at, say, 9:00 in each recipient's own timezone. It works out each person's timezone from, in order:
1. a `Timezone` column, using a full name such as `Asia/Kolkata`;
2. a `Country` column (also "Country/Region", "Location" and the like; values such as "India", "IN" or "Chennai, India" all work);
3. their email's country ending (`.in`, `.de`), which you can turn off.

Anyone else gets it at that time in your timezone. A preview shows how many people go to each timezone and why, before anything is scheduled. Smart Schedule makes one copy of the campaign per timezone; the original isn't sent.

### A/B testing subject lines

Fill in **Subject B** in the editor, then choose:
- **Fixed split:** the first part of the list gets A, the rest gets B.
- **Test, then send the winner:** both subjects go to a test slice (5–50% of the list). After a wait you choose (1–24 hours), the subject with the better open or click rate goes to everyone else automatically.

  This needs [Brevo](#more-features) stats, meaning you send through Brevo SMTP and have added a Brevo API key. Without stats, subject A is kept and the notification says why.

### History and failures

**History** lists every email sent. Pick a campaign to see why sends failed, grouped by cause (address doesn't exist, mailbox full, provider limit, login failed…), each with what to do. There is also an **AI campaign report**: how the campaign did compared with your previous ones, likely reasons for weak results, and next steps.

### Social posts

**Social** publishes posts to your social accounts: write once, choose the accounts, then **Publish now**, **Schedule** or **Save draft**.

| Platform | Status |
|---|---|
| LinkedIn (your personal profile) | ✅ Text, one image or a link preview |
| Facebook Pages | ✅ Text with a link preview, or one image |
| Instagram (Business or Creator account linked to a Facebook Page) | ✅ One image with a caption (Instagram doesn't allow text-only posts) |
| X (Twitter) | ✅ Text (a link goes in the text and shows as a card) or one image. X charges per post, see below |
| Bluesky, Mastodon, Threads, Google Business Profile, Pinterest | Planned, in that order |

- **One post, several platforms.** Each platform gets its own tab where you can write a different version; empty means it uses the main text. Character limits are checked before anything is sent.
- **AI writer** (needs AI turned on): write posts from a short description, fit your text to each platform's style, or turn an email campaign into posts that promote it.
- **Scheduling:** MailWave must be running at that time (it can sit in the tray). A post more than 6 hours late, because the app was closed, is held as *missed* for you to publish or reschedule instead of going out at the wrong time.
- **Status per account:** if one account fails, the others still get the post, and **Retry** sends it only where it's missing. If MailWave closes in the middle of publishing, the post is marked failed rather than retried by itself, so nothing is posted twice.

**Connecting LinkedIn.** MailWave connects through your own free LinkedIn developer app, the same way it sends email through your own SMTP account. Nothing goes through a third-party server. **Social → Accounts → LinkedIn → Show app setup** walks you through it:
1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps). LinkedIn asks you to link a Company Page; any page you admin works.
2. On **Products**, add **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** (both approved instantly).
3. On **Auth**, add `http://localhost:47615/linkedin/callback` as an authorized redirect URL.
4. Paste the **Client ID** and **Client Secret** into MailWave, save, and click **Connect**.

**Connecting Facebook and Instagram.** One sign-in through your own Meta developer app adds every Facebook Page you choose and the Instagram accounts linked to them. **Social → Accounts → Facebook & Instagram → Show app setup** has the steps:
1. Create an app at [developers.facebook.com/apps](https://developers.facebook.com/apps) with Facebook Login. Keep it in **Development** mode: as the app's admin you can post to your own Pages without Meta's App Review.
2. Add the permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, and for Instagram `instagram_basic`, `instagram_content_publish`.
3. Add `http://localhost:47617/meta/callback` to **Valid OAuth Redirect URIs**.
4. For Instagram, switch the account to Business or Creator and link it to your Page.
5. Paste the **App ID** and **App Secret** into MailWave, save, click **Connect**, and tick the Pages and Instagram accounts to share.

Instagram only accepts images from a web address, so MailWave uploads the image to your linked Facebook Page as an *unpublished* photo (not shown to anyone), gives Instagram that copy, and deletes it once the post is live. Page sign-ins don't expire on a timer, but stop working if you change your Facebook password or remove the app; MailWave then asks you to reconnect.

**Connecting X (Twitter).** X has no free posting tier: since 2026 each post is paid from prepaid credits on your own X developer account (at the time of writing about $0.015 per post, more for a post with a link; check [docs.x.com](https://docs.x.com) for current prices). MailWave adds nothing on top. **Social → Accounts → X (Twitter) → Show app setup** has the steps:
1. At [console.x.com](https://console.x.com), create a project and app with the X account you'll post from, and add credits.
2. In the app's **User authentication settings**, turn on **OAuth 2.0**, choose **Read and write**, and app type **Native App** (no secret needed) or Web App.
3. Add `http://127.0.0.1:47619/x/callback` as a callback URL (exactly that: `127.0.0.1`, not `localhost`).
4. Paste the **OAuth 2.0 Client ID** (and, for a Web App, the Client Secret) into MailWave, save, and click **Connect**.

X sign-ins last two hours, so MailWave keeps the refresh token X gives and renews the sign-in by itself before each post. The character counter counts the way X does: 280 characters, a link counts as 23, emoji and some scripts count double.

LinkedIn sign-ins last 60 days. MailWave warns you a week before one expires; click **Connect** again to renew it. Posting to Company Pages needs LinkedIn's Community Management API, which LinkedIn grants after review, so it isn't offered yet.

### AI writing and review

AI is optional. **Settings → AI Writing & Review:** turn it on and paste an API key from Anthropic (Claude), OpenAI, Google Gemini, Groq, xAI (Grok), Mistral, DeepSeek or OpenRouter. MailWave recognises the provider from the key. Under **Advanced** you can use a local model with [Ollama](https://ollama.com) (nothing leaves your computer), any OpenAI-compatible server, or pick specific models. Usage is billed by your provider; Settings shows this month's calls and tokens.

Set your **brand voice** once (what you do, tone, words to avoid, sign-off) and every AI feature uses it.

| Where | What it does |
|---|---|
| Editor → **Write with AI** | A full draft from a short brief, a follow-up to a sent campaign, or a reply to a message you received |
| Campaigns → **AI Sequence** | A 3–7 email welcome or nurture series, saved as draft campaigns |
| Subject / Preview text → **Suggest** | Subject line and preview text options |
| Editor toolbar → **AI Write** | Continue writing from the cursor, or rewrite a selection: shorter, friendlier, fix grammar, turn into button text… |
| Editor → **Translate** | The whole campaign in another language, keeping links and merge tags |
| Plain Text → **Write with AI** | A clean plain-text version |
| Editor and checklist → **AI Review** | Spam risk, mistakes, placeholder links, compliance and claims, subject score |
| History → **AI campaign report** | How it did and what to do next |
| Subscribers → **Smart filter** | A filter from a plain-language request |
| Social → **AI writer** | Social posts from a brief, an existing post or an email campaign, one version per platform |

AI output always appears for you to check first and can be undone.

### Team Sync

Teammates share subscribers, groups, templates, campaigns, schedules, send history and the AI brand voice (social posts and accounts stay on each computer for now) through a **private GitHub repository**, encrypted on each computer before upload, so GitHub only stores unreadable data. No server is needed. Passwords and API keys are never shared. A separate **test workspace** lets you try it without touching your real data.

Setup and details: [TEAM_SYNC.md](TEAM_SYNC.md).

### Automation API

**Settings → Automation API:** turn it on to let n8n, cron scripts or your own tools control MailWave. It only accepts requests from your own computer (`127.0.0.1`), every request needs the access token shown there, and MailWave must be running.

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8787/campaigns
```

| Endpoint | |
|---|---|
| `GET /health` | Check it's up |
| `GET /campaigns` · `GET /campaigns/:id` · `GET /campaigns/scheduled` | List and read campaigns |
| `POST /campaigns` · `DELETE /campaigns/:id` | Create or update (include `id`), delete |
| `POST /campaigns/:id/send` | Send now |
| `POST /campaigns/:id/schedule` `{ send_at }` · `POST /campaigns/:id/cancel-schedule` | Schedule, cancel |
| `GET /templates` · `POST /templates` | List, create or update templates |
| `GET /groups` | List groups |
| `GET /stats/daily` | Sent today, daily limit, paused and scheduled campaigns |
| `POST /ai/draft` `{ goal, …, save? }` | AI draft; with `"save": true` it's also saved as a draft campaign |
| `POST /ai/review` `{ campaign_id }` | AI pre-send review |
| `POST /ai/report` `{ campaign_id }` | AI campaign report |

### More features

- **Templates:** save a subject and body to reuse.
- **Brevo stats:** add a Brevo API key in Settings to see opens, clicks and bounces per campaign and your daily credits on the Dashboard (when you send through Brevo SMTP).
- **Website subscriber sync**: pull a CSV of sign-ups from your website's server over FTP, FTPS or SFTP and import it, with the same cleaning.
- **Notifications:** a daily summary, reminders before scheduled sends, daily-limit and pause alerts, finished campaigns and A/B winners.
- **Workspaces:** switch between your real data and a separate test workspace.
- **Update check:** once a day MailWave asks GitHub whether a newer version is out, and tells you with a notification and a banner. **Settings → Updates** shows your version, has **Check now**, and lets you turn automatic checks off. It only notifies; you download and install the new version yourself.

## Privacy

Your data lives in a local database on your computer. Nothing is uploaded except:
- the emails you send, through your own SMTP provider;
- social posts you publish, sent straight to that platform's API with your own sign-in;
- Team Sync data, end-to-end encrypted, to your team's private GitHub repo, if you use it;
- the daily update check, a request to GitHub asking for the newest version number (turn it off in Settings → Updates);
- calls to your AI provider, if you turn AI on. These contain only the text you write, the campaign's content, field, group and campaign names, column headers with what their values look like, and counts. Subscriber addresses, names and field values are never sent, and the test suite checks this.

API keys, social sign-in tokens and app secrets are stored encrypted with your system's keychain where available, and never reach the app's interface. AI call metadata (feature, model, tokens, time) is logged locally, never the content.

## Compliance

You're responsible for following CAN-SPAM, GDPR and the other email laws that apply to you, and each social platform's rules for automated posting, including having consent from everyone on your list and acting on unsubscribe requests promptly. MailWave helps with unsubscribe headers, a postal address footer, bounce handling and automatic pauses, but it can't check consent for you.

## Build from source

Requires Node.js 18 or later. Native modules (`better-sqlite3`) must be built on the system you target; a Mac build can't be made on Linux.

```bash
git clone https://github.com/pryndor/mailwave.git
cd mailwave
npm install
(cd renderer && npm install)
npm run dev          # development mode
npm test             # tests (npm test -- mailer runs only matching files)
npm run build:linux  # AppImage
npm run build:win    # NSIS installer (on Windows)
npm run build:mac    # dmg + zip (on macOS)
```

The tests run under Electron's own Node, because `better-sqlite3` is built for it. They cover the send loop against a fake mail server, imports and filters on a real database, Smart Schedule, Team Sync, the Automation API, social posting against fake LinkedIn, Facebook/Instagram and X APIs (including the sign-in callback), and the AI features against a fake provider.

CI (`.github/workflows/build.yml`) builds all three systems and attaches them to a draft GitHub Release when you push a `v*` tag. Users' apps are told about the release once you **publish** the draft (drafts and pre-releases are never announced).

**Project layout**

| Path | What's there |
|---|---|
| `electron/` | Main process: database (`db.js`), sending (`mailer.js`), AI (`ai*.js`), Team Sync, Automation API, Smart Schedule |
| `electron/social/` | Social posting: accounts and posts (`store.js`), scheduling (`index.js`), OAuth sign-in (`oauth.js`), one file per platform (`linkedin.js`, `meta.js` for Facebook and Instagram, `x.js`) |
| `renderer/` | The interface (React + Vite) |
| `tests/` | Test suite (`node:test`) |
| `license-tooling/` | Scripts to make the signing key pair and issue Pro licenses (paid plans are off for now) |
| `payment-webhook-vps/` | Server that issues a license when a Razorpay payment arrives (not deployed right now) |

## License and credits

[AGPL-3.0](LICENSE). You may use, change and share MailWave; if you distribute a changed version, or run one as a service for others, you must publish its source under the same license.

List cleaning (`electron/contactChecks.js`) is adapted from [MailCheap](https://github.com/marclou/mailcheap), also AGPL-3.0.
