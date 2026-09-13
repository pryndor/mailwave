# MailWave Team backend (early, API-only — no UI yet)

Solves the two things the desktop app structurally can't: multiple people
sharing one subscriber list/campaign set (desktop app is one local SQLite
file per machine), and scheduled sends firing even when nobody's laptop is
on (desktop app's scheduler only runs while the Electron process is alive).

**Scope of this pass: the backend mechanism only.** Team management, a web
UI for marketers to actually use — none of that exists yet. Today this is a
REST API + a cron sender, reachable with a bearer token per team, same
shape as the desktop app's `automation_token`. A real UI is a separate,
larger follow-on project.

## Architecture

- **Neon Postgres** — shared database, one `teams` row per paying customer,
  `subscribers`/`campaigns` scoped by `team_id`.
- **Vercel serverless functions** — `/api/subscribers`, `/api/campaigns` for
  CRUD, both bearer-token authenticated per team.
- **Cron sender** (`/api/cron/send-due`) — the actual "anytime scheduling"
  fix. Runs on a timer, finds due campaigns across every team, sends a
  bounded batch (25 recipients, 5 campaigns per tick) so it never runs into
  serverless time limits regardless of list size — same resumable-batch
  idea as `sent_count`/`resume_offset` in the desktop app, just driven by
  cron ticks instead of a local `setInterval`.

## Important cost/limitation you need to know before committing to this

**Vercel's own Cron Jobs feature limits free/Hobby-plan schedules to once a
day** — useless for "anytime" scheduling. Two ways around it:

1. **Upgrade the Vercel project to Pro (~$20/mo)** — unlocks minute-level
   cron schedules, `vercel.json` here is already configured for `*/5 * * * *`.
2. **Free alternative (default, already wired up):** `.github/workflows/team-cron.yml`
   in the main repo pings `/api/cron/send-due` every 5 minutes via GitHub
   Actions instead of Vercel's own cron. Zero extra cost, but GitHub doesn't
   guarantee exact timing under load — a few minutes of jitter is normal.
   Set repo secrets `TEAM_BACKEND_URL` and `TEAM_CRON_SECRET` to use it.

Don't run both triggers thinking it's "more reliable" — that risks double
processing the same tick.

## Setup

1. Create a Neon Postgres project (free tier to start), run `schema.sql` against it.
2. `cd team-backend && npx vercel --prod` (separate Vercel project from the
   webhook and from the desktop app).
3. Set env vars from `.env.example` in the Vercel project settings.
4. Provision a team:
   ```bash
   DATABASE_URL=... ENCRYPTION_KEY=... node scripts/create-team.js "Acme Inc" \
     '{"host":"smtp.zoho.in","port":465,"user":"news@acme.com","pass":"...","from_name":"Acme","from_email":"news@acme.com"}'
   ```
   Give the printed `api_token` to the team.
5. Wire up the cron trigger (Vercel Pro cron, or the free GitHub Actions workflow above).

## Known limitations (real, not hidden)

- **No UI.** Everything here is API-only — a team currently needs to script
  against `/api/subscribers` and `/api/campaigns` themselves, or you build
  the web UI as the next project phase.
- **No auth beyond one shared team token.** No per-user login, no roles —
  anyone with the token can do anything for that team. Fine for a small
  paying team to start, not enterprise-grade.
- **No retry/dedup on cron ticks.** If a tick fails partway through sending
  a batch, already-sent recipients within that tick aren't tracked
  individually — a rare failure could mean a handful of duplicate or
  skipped sends in one batch. Acceptable for early customers, would need
  a proper job queue (e.g. per-recipient send log) to fully close this gap.
- **Real ongoing cost, unlike the desktop app.** Neon Postgres + Vercel
  (Pro if using their cron) are recurring bills, which is exactly the
  hosting cost the desktop app was built to avoid — justified only if
  Team-tier pricing covers it with margin.
