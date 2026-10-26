# MailWave

A desktop app for sending email newsletters through **your own SMTP account**: no monthly fee per subscriber, no vendor lock-in, and your subscriber list never leaves your computer.

Linux, Windows and Mac. Built with Electron and React. Licensed AGPL-3.0.

- [Why MailWave](#why-mailwave)
- [Free and Pro](#free-and-pro)
- [Install](#install)
- [Quick start](#quick-start)
- [Guide](#guide): [importing](#importing-subscribers) · [writing](#writing-a-campaign) · [sending safely](#sending-safely) · [scheduling](#scheduling) · [A/B tests](#ab-testing-subject-lines) · [history](#history-and-failures) · [AI](#ai-writing-and-review) · [Team Sync](#team-sync) · [Automation API](#automation-api) · [more](#more-features)
- [Privacy](#privacy) · [Compliance](#compliance) · [Build from source](#build-from-source) · [License](#license-and-credits)

## Why MailWave

Mailchimp, Brevo and similar services charge every month by list size and keep your list on their servers. If you already pay for an email account (Zoho, Gmail, Outlook, your own mail server) or a sending service (Brevo, SendGrid, Amazon SES), MailWave sends your newsletters through it from your own computer.

It's built for **lists of people who opted in**: newsletters, customer updates, announcements. It is not a cold-email tool, and it stops itself when a list looks bad.

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

**Smart Schedule** (Pro) sends at, say, 9:00 in each recipient's own timezone. It works out each person's timezone from, in order:
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

**History** lists every email sent. Pick a campaign to see why sends failed, grouped by cause (address doesn't exist, mailbox full, provider limit, login failed…), each with what to do. Pro adds an **AI campaign report**: how the campaign did compared with your previous ones, likely reasons for weak results, and next steps.

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
| Editor and checklist → **AI Review** (Pro) | Spam risk, mistakes, placeholder links, compliance and claims, subject score |
| History → **AI campaign report** (Pro) | How it did and what to do next |
| Subscribers → **Smart filter** | A filter from a plain-language request |

AI output always appears for you to check first and can be undone.

### Team Sync

Pro, with a free 7-day trial. Teammates share subscribers, groups, templates, campaigns, schedules, send history and the AI brand voice through a **private GitHub repository**, encrypted on each computer before upload, so GitHub only stores unreadable data. No server is needed. Passwords, API keys and the license are never shared. A separate **test workspace** lets you try it without touching your real data.

Setup and details: [TEAM_SYNC.md](TEAM_SYNC.md).

### Automation API

Pro. **Settings → Automation API:** turn it on to let n8n, cron scripts or your own tools control MailWave. It only accepts requests from your own computer (`127.0.0.1`), every request needs the access token shown there, and MailWave must be running.

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
- **Website subscriber sync** (Pro): pull a CSV of sign-ups from your website's server over FTP, FTPS or SFTP and import it, with the same cleaning.
- **Notifications:** a daily summary, reminders before scheduled sends, daily-limit and pause alerts, finished campaigns and A/B winners.
- **Workspaces:** switch between your real data and a separate test workspace.

## Privacy

Your data lives in a local database on your computer. Nothing is uploaded except:
- the emails you send, through your own SMTP provider;
- Team Sync data, end-to-end encrypted, to your team's private GitHub repo, if you use it;
- calls to your AI provider, if you turn AI on. These contain only the text you write, the campaign's content, field, group and campaign names, column headers with what their values look like, and counts. Subscriber addresses, names and field values are never sent, and the test suite checks this.

API keys and passwords are stored encrypted with your system's keychain where available. AI call metadata (feature, model, tokens, time) is logged locally, never the content.

## Compliance

You're responsible for following CAN-SPAM, GDPR and the other email laws that apply to you, including having consent from everyone on your list and acting on unsubscribe requests promptly. MailWave helps with unsubscribe headers, a postal address footer, bounce handling and automatic pauses, but it can't check consent for you.

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

The tests run under Electron's own Node, because `better-sqlite3` is built for it. They cover the send loop against a fake mail server, imports and filters on a real database, Smart Schedule, Team Sync, the Automation API, and the AI features against a fake provider.

CI (`.github/workflows/build.yml`) builds all three systems and attaches them to a draft GitHub Release when you push a `v*` tag.

**Project layout**

| Path | What's there |
|---|---|
| `electron/` | Main process: database (`db.js`), sending (`mailer.js`), AI (`ai*.js`), Team Sync, Automation API, Smart Schedule |
| `renderer/` | The interface (React + Vite) |
| `tests/` | Test suite (`node:test`) |
| `license-tooling/` | Scripts to make the signing key pair and issue Pro licenses |
| `payment-webhook-vps/` | Server that issues a license when a Razorpay payment arrives |

## License and credits

[AGPL-3.0](LICENSE). You may use, change and share MailWave; if you distribute a changed version, or run one as a service for others, you must publish its source under the same license.

List cleaning (`electron/contactChecks.js`) is adapted from [MailCheap](https://github.com/marclou/mailcheap), also AGPL-3.0.
