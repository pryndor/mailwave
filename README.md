# MailWave

A local-first desktop app for sending bulk email newsletters through your own SMTP account — no monthly SaaS fee, no vendor lock-in, your subscriber data never leaves your machine.

Built with Electron + React. Ships Linux (AppImage), Windows (NSIS installer), and Mac (dmg/zip) builds — Windows and Mac builds are unsigned for now, see [Install](#install).

## Why

Tools like Mailchimp or Brevo charge monthly per-subscriber fees and host your list on their servers. If you already have an SMTP account (Zoho, Gmail, your own mail server) and don't want another subscription, MailWave runs entirely on your machine and sends through the SMTP account you already pay for.

## Features

- Subscriber management — CSV import/export, groups, search, pagination
- Campaign editor (rich text) with merge fields (`{{name}}`, `{{first_name}}`, custom CSV columns)
- Batch sending with configurable rate limiting and daily send caps
- Scheduled sends (including timezone-aware "smart schedule")
- A/B subject line testing
- Send history and per-campaign progress
- Local automation bridge (bearer-token authenticated, localhost-only) for triggering campaigns from n8n or cron
- Optional Brevo API integration for account/credit stats
- Desktop notifications (daily summary, campaign reminders, limit reached)
- AI writing (optional, bring your own Anthropic API key): draft a campaign from a short brief, write a follow-up to a sent campaign, draft a reply to a message you received, suggest subject lines, and rewrite selected text. AI pre-send review (Pro) flags spam risk, mistakes, placeholder links and compliance issues
- Team Sync (Pro): several people share subscribers, campaigns, schedules and history through a private, end-to-end encrypted GitHub repo, with no server needed. Includes a free 7-day trial and a separate test workspace for trying it out. See [TEAM_SYNC.md](TEAM_SYNC.md)

## Install

Download the latest build for your platform from [Releases](../../releases).

**Linux:**
```bash
chmod +x MailWave-*.AppImage
./MailWave-*.AppImage
```

**Windows:** run the `.exe` installer. Unsigned build — Windows SmartScreen will warn on first run; click "More info" → "Run anyway".

**Mac:** open the `.dmg`. Unsigned/not notarized yet — Gatekeeper will block it as from an "unidentified developer". Right-click the app → Open, or run `xattr -cr /Applications/MailWave.app` once installed.

## Build from source

Requires Node.js 18+. Native modules (`better-sqlite3`) must be built on the OS you're targeting — you can't cross-compile a Mac build from Linux, for example.

```bash
git clone <this-repo>
cd mailwave
npm install
cd renderer && npm install && cd ..
npm run dev         # development mode
npm run build:linux # AppImage
npm run build:win   # NSIS installer (run on Windows)
npm run build:mac   # dmg + zip (run on macOS)
```

CI (`.github/workflows/build.yml`) builds all three platforms on their native runners and attaches them as a draft GitHub Release when you push a `v*` tag.

## Configuration

On first launch, go to **Settings** and configure:
- SMTP host/port/credentials (your existing email provider)
- From name/email, reply-to, and unsubscribe email address
- Batch size, delay, and daily send limit

MailWave adds a `List-Unsubscribe` mailto link to every campaign automatically (Gmail/Outlook render this as a one-click button). When an unsubscribe request comes in by email, mark that subscriber as **Unsubscribed** in the Subscribers page.

### AI features (optional)

Settings → **AI Writing & Review**: turn it on, paste an Anthropic API key (from console.anthropic.com), and optionally describe your brand voice. Usage is billed to your own Anthropic account; the Settings section shows this month's calls and tokens. Use the **Mock** provider to try the screens without a key.

What leaves your computer: the brief or text you write, the campaign subject and body, and for follow-ups the delivered/failed counts. Subscriber email addresses, names and custom field values are never sent. The key is stored encrypted with the OS keychain where available and is never synced through Team Sync. Only call metadata (feature, model, tokens, time) is logged locally, no email content. AI output is always shown to you first and can be undone; review results are advice and never block sending.

## Compliance note

You are responsible for complying with CAN-SPAM, GDPR, or other applicable email regulations in your jurisdiction — including consent for the recipients on your list and honoring unsubscribe requests promptly.

## License

AGPL-3.0. See [LICENSE](LICENSE).
