# MailWave

A local-first desktop app for sending bulk email newsletters through your own SMTP account — no monthly SaaS fee, no vendor lock-in, your subscriber data never leaves your machine.

Built with Electron + React. Runs on Linux (AppImage), Windows and Mac builds planned.

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

## Install

Download the latest AppImage from [Releases](../../releases), make it executable, and run:

```bash
chmod +x MailWave-*.AppImage
./MailWave-*.AppImage
```

## Build from source

Requires Node.js 18+.

```bash
git clone <this-repo>
cd mailwave
npm install
cd renderer && npm install && cd ..
npm run dev        # development mode
npm run build:app  # production AppImage (Linux)
```

## Configuration

On first launch, go to **Settings** and configure:
- SMTP host/port/credentials (your existing email provider)
- From name/email, reply-to, and unsubscribe email address
- Batch size, delay, and daily send limit

MailWave adds a `List-Unsubscribe` mailto link to every campaign automatically (Gmail/Outlook render this as a one-click button). When an unsubscribe request comes in by email, mark that subscriber as **Unsubscribed** in the Subscribers page.

## Compliance note

You are responsible for complying with CAN-SPAM, GDPR, or other applicable email regulations in your jurisdiction — including consent for the recipients on your list and honoring unsubscribe requests promptly.

## License

AGPL-3.0. See [LICENSE](LICENSE).
