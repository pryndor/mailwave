-- MailWave Team backend schema (Postgres — Neon).
-- One row per paying team; everything below is scoped to team_id so
-- multiple marketers share the same subscribers/campaigns instead of each
-- having their own local SQLite copy, which is what the desktop app can't do.

CREATE TABLE teams (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  api_token     TEXT NOT NULL UNIQUE,   -- bearer token, same pattern as the desktop app's automation_token
  smtp_host     TEXT,
  smtp_port     INTEGER,
  smtp_user     TEXT,
  smtp_pass_enc TEXT,                   -- AES-256-GCM ciphertext, base64 — never store plaintext
  from_name     TEXT,
  from_email    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscribers (
  id         SERIAL PRIMARY KEY,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT,
  status     TEXT NOT NULL DEFAULT 'active', -- active | unsubscribed | bounced
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, email)
);

CREATE TABLE campaigns (
  id           SERIAL PRIMARY KEY,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  html         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | sent | failed
  scheduled_at TIMESTAMPTZ,
  sent_count   INTEGER NOT NULL DEFAULT 0,   -- resumable across cron ticks, same idea as
  total_count  INTEGER NOT NULL DEFAULT 0,   -- the desktop app's start_offset/resume_offset
  sent_at      TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The cron sender scans this on every tick — keep it fast even with many teams.
CREATE INDEX idx_campaigns_due ON campaigns (status, scheduled_at);
