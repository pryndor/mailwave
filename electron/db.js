const Database = require('better-sqlite3');
const path     = require('path');
const workspace = require('./workspace');
const contactChecks = require('./contactChecks');
const smtpErrors    = require('./smtpErrors');

const dbPath = path.join(workspace.dataDir(), 'mailwave.db');
const db = new Database(dbPath);

// Enable WAL for performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations — safe to run on every start
try { db.exec(`ALTER TABLE campaigns ADD COLUMN attachments    TEXT    NOT NULL DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_subject_b   TEXT    NOT NULL DEFAULT ''`);  } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_split_pct   INTEGER NOT NULL DEFAULT 50`);  } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN resume_offset  INTEGER NOT NULL DEFAULT 0`);   } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN resume_at      TEXT`);                          } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN scheduled_at   TEXT`);                          } catch {}
try { db.exec(`ALTER TABLE subscribers ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}'`);   } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN preview_text   TEXT    NOT NULL DEFAULT ''`);  } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN test_sent_at   TEXT`);                          } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_mode        TEXT    NOT NULL DEFAULT 'split'`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_test_pct    INTEGER NOT NULL DEFAULT 20`);  } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_wait_hours  INTEGER NOT NULL DEFAULT 4`);   } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_metric      TEXT    NOT NULL DEFAULT 'opens'`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN ab_winner      TEXT    NOT NULL DEFAULT ''`);  } catch {}


// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE,
    name        TEXT    DEFAULT '',
    first_name  TEXT    DEFAULT '',
    last_name   TEXT    DEFAULT '',
    phone       TEXT    DEFAULT '',
    company     TEXT    DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'active',  -- active | unsubscribed | bounced
    custom_fields TEXT  NOT NULL DEFAULT '{}',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriber_groups (
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    group_id      INTEGER NOT NULL REFERENCES groups(id)      ON DELETE CASCADE,
    PRIMARY KEY (subscriber_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    subject    TEXT NOT NULL DEFAULT '',
    html       TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    subject       TEXT NOT NULL DEFAULT '',
    from_name     TEXT NOT NULL DEFAULT '',
    from_email    TEXT NOT NULL DEFAULT '',
    reply_to      TEXT NOT NULL DEFAULT '',
    html          TEXT NOT NULL DEFAULT '',
    text          TEXT NOT NULL DEFAULT '',
    group_ids     TEXT NOT NULL DEFAULT '[]',
    status        TEXT NOT NULL DEFAULT 'draft',  -- draft | sending | sent | stopped
    attachments   TEXT NOT NULL DEFAULT '[]',     -- JSON array of {name, path}
    ab_subject_b  TEXT NOT NULL DEFAULT '',
    ab_split_pct  INTEGER NOT NULL DEFAULT 50,
    preview_text  TEXT NOT NULL DEFAULT '',      -- inbox preview line (preheader)
    test_sent_at  TEXT,                          -- last successful test email, this machine only
    ab_mode       TEXT NOT NULL DEFAULT 'split', -- split: A to first %, B to rest | winner: test both, send the winner
    ab_test_pct   INTEGER NOT NULL DEFAULT 20,   -- winner mode: share of the list in the test
    ab_wait_hours INTEGER NOT NULL DEFAULT 4,    -- winner mode: wait before picking
    ab_metric     TEXT NOT NULL DEFAULT 'opens', -- winner mode: opens | clicks (Brevo stats)
    ab_winner     TEXT NOT NULL DEFAULT '',      -- winner mode: '' until picked, then 'a' | 'b'
    resume_offset INTEGER NOT NULL DEFAULT 0,
    resume_at     TEXT,
    scheduled_at  TEXT,
    sent_count    INTEGER NOT NULL DEFAULT 0,
    total_count   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS send_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id   INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    subscriber_id INTEGER REFERENCES subscribers(id) ON DELETE SET NULL,
    email         TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'sent',  -- sent | failed | bounced
    error         TEXT DEFAULT '',
    sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,  -- limit_reached | campaign_paused | campaign_resumed | campaign_done | daily_summary | campaign_reminder
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    campaign_id INTEGER,
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Team sync columns/tables ─────────────────────────────────────────────────
// uid = stable cross-device id (local integer ids differ per machine).
// origin_device = which teammate's machine logged a send; NULL = this machine.
// Runs after the schema block so fresh installs get the columns too.
for (const t of ['subscribers', 'groups', 'templates', 'campaigns', 'send_history']) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN uid TEXT`); } catch {}
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_uid ON ${t}(uid) WHERE uid IS NOT NULL`);
}
try { db.exec(`ALTER TABLE send_history ADD COLUMN origin_device TEXT`); } catch {}
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    entity TEXT    NOT NULL,
    uid    TEXT    NOT NULL,
    hash   TEXT    NOT NULL,           -- hash of last synced version, or 'deleted'
    ts     INTEGER NOT NULL,           -- logical clock of last write (last-writer-wins)
    dev    TEXT    NOT NULL,
    PRIMARY KEY (entity, uid)
  );
  CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── AI call log (metadata only — no prompt or output content is stored) ───────
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    feature       TEXT    NOT NULL,
    model         TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    ms            INTEGER NOT NULL DEFAULT 0,
    ok            INTEGER NOT NULL DEFAULT 1,
    error         TEXT    DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Subscribers ───────────────────────────────────────────────────────────────
// Structured subscriber filter (from the Smart filter, electron/ai.js
// subscriberFilter). Every value is bound as a parameter and every column or
// field name is checked against a fixed list or the known custom keys: nothing
// from the model ever becomes SQL text.
//   { status, groups: [names], groups_mode: 'any'|'none', email_domains: [..],
//     conditions: [{ field, op: equals|contains|starts_with|empty|not_empty, value }],
//     added_after, added_before (YYYY-MM-DD),
//     emailed: { mode: 'never'|'ever'|'campaign'|'not_campaign'|'within_days'|'not_within_days', campaign, days } }
const FILTER_COLUMNS = new Set(['email', 'name', 'first_name', 'last_name', 'phone', 'company']);

function filterSql(filter = {}) {
  const where = [];
  const params = [];
  if (['active', 'unsubscribed', 'bounced'].includes(filter.status)) { where.push('s.status = ?'); params.push(filter.status); }

  const groupNames = (filter.groups || []).map(String).filter(Boolean);
  if (groupNames.length) {
    const ph = groupNames.map(() => '?').join(',');
    const sub = `SELECT 1 FROM subscriber_groups sg JOIN groups g ON g.id = sg.group_id WHERE sg.subscriber_id = s.id AND lower(g.name) IN (${ph})`;
    where.push(filter.groups_mode === 'none' ? `NOT EXISTS (${sub})` : `EXISTS (${sub})`);
    params.push(...groupNames.map(n => n.toLowerCase()));
  }

  const domains = (filter.email_domains || []).map(d => String(d).toLowerCase().replace(/^@/, '').trim()).filter(Boolean);
  if (domains.length) {
    where.push(`(${domains.map(() => "lower(s.email) LIKE ? ESCAPE '\\'").join(' OR ')})`);
    params.push(...domains.map(d => `%@${d.replace(/[\\%_]/g, '\\$&')}`));
  }

  const customKeys = new Set(listCustomFieldKeys());
  for (const c of filter.conditions || []) {
    const field = String(c.field || '').toLowerCase();
    let expr;
    if (FILTER_COLUMNS.has(field)) expr = `COALESCE(s.${field}, '')`;
    else if (customKeys.has(field)) { expr = `COALESCE(json_extract(s.custom_fields, ?), '')`; params.push(`$."${field}"`); }
    else continue;   // unknown field: ignored (the UI shows the filter as applied)
    const value = String(c.value ?? '').toLowerCase();
    const like = value.replace(/[\\%_]/g, '\\$&');
    switch (c.op) {
      case 'equals':      where.push(`lower(${expr}) = ?`); params.push(value); break;
      case 'contains':    where.push(`lower(${expr}) LIKE ? ESCAPE '\\'`); params.push(`%${like}%`); break;
      case 'starts_with': where.push(`lower(${expr}) LIKE ? ESCAPE '\\'`); params.push(`${like}%`); break;
      case 'empty':       where.push(`${expr} = ''`); break;
      case 'not_empty':   where.push(`${expr} != ''`); break;
      default: if (expr.includes('?')) params.pop();
    }
  }

  const date = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null;
  if (date(filter.added_after))  { where.push(`date(s.created_at) >= ?`); params.push(filter.added_after); }
  if (date(filter.added_before)) { where.push(`date(s.created_at) <= ?`); params.push(filter.added_before); }

  // Send history matches by address, so teammates' synced sends count too.
  const e = filter.emailed || {};
  const sent = (extra) => `EXISTS (SELECT 1 FROM send_history h WHERE lower(h.email) = lower(s.email) AND h.status = 'sent'${extra})`;
  const campaignIds = () => {
    const name = String(e.campaign || '').toLowerCase();
    return db.prepare(`SELECT id FROM campaigns WHERE lower(name) = ? OR lower(subject) = ? OR lower(name) LIKE ?`)
      .all(name, name, `%${name}%`).map(r => r.id);
  };
  const days = Math.max(1, Math.min(3650, Number(e.days) || 30));
  switch (e.mode) {
    case 'never': where.push(`NOT ${sent('')}`); break;
    case 'ever':  where.push(sent('')); break;
    case 'within_days':     where.push(sent(` AND h.sent_at >= datetime('now', ?)`)); params.push(`-${days} days`); break;
    case 'not_within_days': where.push(`NOT ${sent(` AND h.sent_at >= datetime('now', ?)`)}`); params.push(`-${days} days`); break;
    case 'campaign':
    case 'not_campaign': {
      const ids = e.campaign ? campaignIds() : [];
      const inner = ids.length ? sent(` AND h.campaign_id IN (${ids.map(() => '?').join(',')})`) : '0';
      where.push(e.mode === 'campaign' ? inner : `NOT ${inner}`);
      params.push(...ids);
      break;
    }
  }
  return { where: where.length ? where.join(' AND ') : '1=1', params };
}

function listSubscribers({ search = '', status = 'all', group_id = null, page = 1, limit = 100, filter = null } = {}) {
  const offset = (page - 1) * limit;
  let where = '1=1';
  const params = [];

  if (status !== 'all') { where += ' AND s.status = ?'; params.push(status); }
  if (search) {
    where += ' AND (s.email LIKE ? OR s.name LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.company LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q, q);
  }
  if (group_id) {
    where += ' AND EXISTS (SELECT 1 FROM subscriber_groups sg WHERE sg.subscriber_id = s.id AND sg.group_id = ?)';
    params.push(group_id);
  }
  if (filter) {
    const f = filterSql(filter);
    where += ` AND (${f.where})`;
    params.push(...f.params);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM subscribers s WHERE ${where}`).get(...params).c;
  const rows  = db.prepare(
    `SELECT s.*, GROUP_CONCAT(g.name) as groups
     FROM subscribers s
     LEFT JOIN subscriber_groups sg ON sg.subscriber_id = s.id
     LEFT JOIN groups g ON g.id = sg.group_id
     WHERE ${where}
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset).map(r => ({ ...r, custom_fields: JSON.parse(r.custom_fields || '{}') }));

  return { rows, total, page, limit };
}

// Every subscriber id matching a filter: for "Save as group".
function subscriberIdsForFilter(filter) {
  const f = filterSql(filter);
  return db.prepare(`SELECT s.id FROM subscribers s WHERE ${f.where}`).all(...f.params).map(r => r.id);
}

function addSubscriber(sub) {
  const stmt = db.prepare(`
    INSERT INTO subscribers (email, name, first_name, last_name, phone, company, status, custom_fields)
    VALUES (@email, @name, @first_name, @last_name, @phone, @company, @status, @custom_fields)
  `);
  const result = stmt.run({
    email: sub.email.toLowerCase().trim(),
    name: sub.name || '',
    first_name: sub.first_name || '',
    last_name: sub.last_name || '',
    phone: sub.phone || '',
    company: sub.company || '',
    status: sub.status || 'active',
    custom_fields: JSON.stringify(sub.custom_fields || {}),
  });
  return { id: result.lastInsertRowid };
}

function updateSubscriber(sub) {
  db.prepare(`
    UPDATE subscribers
    SET email=@email, name=@name, first_name=@first_name, last_name=@last_name,
        phone=@phone, company=@company, status=@status,
        custom_fields=@custom_fields,
        updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...sub, custom_fields: JSON.stringify(sub.custom_fields || {}) });
  return { ok: true };
}

function deleteSubscribers(ids) {
  const stmt = db.prepare('DELETE FROM subscribers WHERE id = ?');
  const deleteMany = db.transaction((idList) => {
    for (const id of idList) stmt.run(id);
  });
  deleteMany(ids);
  return { deleted: ids.length };
}

// Header names already mapped to fixed subscriber columns — anything else becomes a custom merge field.
const KNOWN_HEADERS = new Set([
  'email', 'e-mail', 'your email', 'email address',
  'name', 'your full name', 'full name',
  'first_name', 'first name', 'firstname',
  'last_name', 'last name', 'lastname',
  'phone',
  'company', 'your qualification',
  'status', 'subscription status', 'subscriber status', 'member status', 'subscription_status', 'state',
]);
const STATUS_HEADERS = ['status', 'subscription status', 'subscriber status', 'member status', 'subscription_status', 'state'];

function normalizeFieldKey(header) {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function extractCustomFields(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    if (KNOWN_HEADERS.has(key.trim().toLowerCase())) continue;
    if (val === undefined || val === null || String(val).trim() === '') continue;
    const fieldKey = normalizeFieldKey(key);
    if (fieldKey) out[fieldKey] = String(val).trim();
  }
  return out;
}

// Exports from Mailchimp, beehiiv, Substack, Kit, MailerLite and the like
// carry each reader's status. Someone who unsubscribed or bounced there must
// not start getting emails here, so those statuses come across as they are.
function importedStatus(row) {
  const key = Object.keys(row).find(k => STATUS_HEADERS.includes(k.trim().toLowerCase()));
  const val = key ? String(row[key] || '').trim().toLowerCase() : '';
  if (!val) return 'active';
  if (/bounce|cleaned|invalid|undeliverable/.test(val)) return 'bounced';
  if (/unsub|opted.?out|inactive|complain|spam|abuse|blocked|suppressed/.test(val)) return 'unsubscribed';
  return 'active';
}

function rowEmail(row) {
  const key = Object.keys(row).find(k => ['email', 'e-mail', 'your email', 'email address'].includes(k.trim().toLowerCase()));
  return key ? String(row[key] || '') : '';
}

// The addresses and domains in an import, so the caller can look up which
// domains can't receive mail (async DNS) before the synchronous import runs.
function importDomains(rows) {
  const domains = new Set();
  for (const row of rows) {
    const email = contactChecks.normalizeEmail(rowEmail(row));
    if (email) domains.add(email.split('@')[1]);
  }
  return [...domains];
}

// clean: leave out invalid, misspelled, spam-trap and throwaway addresses,
// in-file duplicates and domains in deadDomains. skipRole: role addresses too.
// Without clean, only addresses that aren't addresses at all are skipped.
function importSubscribers(rows, group_id = null, { clean = true, skipRole = false, deadDomains = new Set() } = {}) {
  let inserted = 0, updated = 0, skipped = 0, suppressed = 0;
  const dropped = contactChecks.emptyDropped();
  const examples = [];
  const upsert = db.prepare(`
    INSERT INTO subscribers (email, name, first_name, last_name, phone, company, status, custom_fields)
    VALUES (@email, @name, @first_name, @last_name, @phone, @company, @status, @custom_fields)
    ON CONFLICT(email) DO UPDATE SET
      name       = COALESCE(NULLIF(@name,''), name),
      first_name = COALESCE(NULLIF(@first_name,''), first_name),
      last_name  = COALESCE(NULLIF(@last_name,''), last_name),
      phone      = COALESCE(NULLIF(@phone,''), phone),
      company    = COALESCE(NULLIF(@company,''), company),
      status     = CASE WHEN @status != 'active' THEN @status ELSE status END,
      custom_fields = @custom_fields,
      updated_at = datetime('now')
  `);
  const assignStmt = group_id
    ? db.prepare('INSERT OR IGNORE INTO subscriber_groups (subscriber_id, group_id) VALUES (?, ?)')
    : null;
  const seen = new Set();
  const drop = (reason, raw) => {
    dropped[reason]++;
    skipped++;
    if (examples.length < 20) examples.push({ email: raw, reason });
  };

  const run = db.transaction(() => {
    for (const row of rows) {
      const raw = rowEmail(row).trim();
      const emailVal = contactChecks.normalizeEmail(raw);
      if (!emailVal) {
        if (raw) drop('invalid', raw); else skipped++;
        continue;
      }
      if (seen.has(emailVal)) { drop('duplicate', raw); continue; }
      seen.add(emailVal);
      if (clean) {
        const reason = contactChecks.getDropReason(emailVal, { skipRole })
          || (deadDomains.has(emailVal.split('@')[1]) ? 'noMail' : null);
        if (reason) { drop(reason, raw); continue; }
      }
      const status = importedStatus(row);
      if (status !== 'active') suppressed++;
      const existing = db.prepare('SELECT id, custom_fields FROM subscribers WHERE email = ?').get(emailVal);
      const newCustom = extractCustomFields(row);
      const mergedCustom = existing
        ? { ...JSON.parse(existing.custom_fields || '{}'), ...newCustom }
        : newCustom;
      const res = upsert.run({
        email: emailVal,
        name:       row.name       || row.Name       || row['Your Full Name'] || row['Full Name'] || '',
        first_name: row.first_name || row['First Name'] || row.FirstName || '',
        last_name:  row.last_name  || row['Last Name']  || row.LastName  || '',
        phone:      row.phone      || row.Phone      || '',
        company:    row.company    || row.Company    || row['Your Qualification'] || '',
        status,
        custom_fields: JSON.stringify(mergedCustom),
      });
      const subId = existing ? existing.id : res.lastInsertRowid;
      if (existing) updated++; else inserted++;
      // Assign to group if provided
      if (assignStmt && subId) {
        assignStmt.run(subId, group_id);
      }
    }
  });
  run();
  return { inserted, updated, skipped, suppressed, dropped, examples };
}

// Distinct custom field keys across all subscribers — powers the merge-tag picker in the UI.
function listCustomFieldKeys() {
  const rows = db.prepare(`SELECT custom_fields FROM subscribers WHERE custom_fields != '{}'`).all();
  const keys = new Set();
  for (const r of rows) {
    try {
      Object.keys(JSON.parse(r.custom_fields || '{}')).forEach(k => keys.add(k));
    } catch {}
  }
  return [...keys].sort();
}

function exportSubscribers() {
  const rows = db.prepare(`
    SELECT s.email, s.name, s.first_name, s.last_name, s.phone, s.company,
           s.status, s.created_at, s.custom_fields,
           GROUP_CONCAT(g.name) as groups
    FROM subscribers s
    LEFT JOIN subscriber_groups sg ON sg.subscriber_id = s.id
    LEFT JOIN groups g ON g.id = sg.group_id
    WHERE s.status = 'active'
    GROUP BY s.id
    ORDER BY s.email
  `).all();
  // Flatten custom fields into top-level CSV columns on export
  return rows.map(r => {
    const { custom_fields, ...rest } = r;
    let custom = {};
    try { custom = JSON.parse(custom_fields || '{}'); } catch {}
    return { ...rest, ...custom };
  });
}

function subscriberStats() {
  return {
    total:        db.prepare("SELECT COUNT(*) as c FROM subscribers").get().c,
    active:       db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status='active'").get().c,
    unsubscribed: db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status='unsubscribed'").get().c,
    bounced:      db.prepare("SELECT COUNT(*) as c FROM subscribers WHERE status='bounced'").get().c,
  };
}

// ── Groups ────────────────────────────────────────────────────────────────────
function listGroups() {
  return db.prepare(`
    SELECT g.*, COUNT(sg.subscriber_id) as count
    FROM groups g
    LEFT JOIN subscriber_groups sg ON sg.group_id = g.id
    LEFT JOIN subscribers s ON s.id = sg.subscriber_id AND s.status = 'active'
    GROUP BY g.id
    ORDER BY g.name
  `).all();
}

function addGroup(name) {
  const result = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name.trim());
  return { id: result.lastInsertRowid };
}

function deleteGroup(id) {
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  return { ok: true };
}

function assignGroup({ subscriber_ids, group_id, action }) {
  const insert = db.prepare('INSERT OR IGNORE INTO subscriber_groups (subscriber_id, group_id) VALUES (?, ?)');
  const remove = db.prepare('DELETE FROM subscriber_groups WHERE subscriber_id = ? AND group_id = ?');
  const run = db.transaction(() => {
    for (const sid of subscriber_ids) {
      if (action === 'add') insert.run(sid, group_id);
      else remove.run(sid, group_id);
    }
  });
  run();
  return { ok: true };
}

// ── Templates ─────────────────────────────────────────────────────────────────
function listTemplates() {
  return db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all();
}

function saveTemplate(tpl) {
  if (tpl.id) {
    db.prepare(`
      UPDATE templates SET name=@name, subject=@subject, html=@html, text=@text,
      updated_at=datetime('now') WHERE id=@id
    `).run(tpl);
    return { id: tpl.id };
  }
  const r = db.prepare(`
    INSERT INTO templates (name, subject, html, text) VALUES (@name, @subject, @html, @text)
  `).run(tpl);
  return { id: r.lastInsertRowid };
}

function deleteTemplate(id) {
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  return { ok: true };
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
function listCampaigns() {
  return db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all().map(normalizeCampaign);
}

function getCampaign(id) {
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  return camp ? normalizeCampaign(camp) : null;
}

function saveCampaign(camp) {
  const data = {
    ...camp,
    group_ids:    JSON.stringify(camp.group_ids   || []),
    attachments:  JSON.stringify(camp.attachments || []),
    ab_subject_b: camp.ab_subject_b || '',
    ab_split_pct: camp.ab_split_pct || 50,
    preview_text: camp.preview_text || '',
    ...abSettings(camp),
  };
  if (camp.id) {
    db.prepare(`
      UPDATE campaigns SET name=@name, subject=@subject, from_name=@from_name,
      from_email=@from_email, reply_to=@reply_to, html=@html, text=@text,
      group_ids=@group_ids, attachments=@attachments,
      ab_subject_b=@ab_subject_b, ab_split_pct=@ab_split_pct, preview_text=@preview_text,
      ab_mode=@ab_mode, ab_test_pct=@ab_test_pct, ab_wait_hours=@ab_wait_hours, ab_metric=@ab_metric,
      updated_at=datetime('now') WHERE id=@id
    `).run(data);
    return { id: camp.id };
  }
  const r = db.prepare(`
    INSERT INTO campaigns (name, subject, from_name, from_email, reply_to, html, text, group_ids, attachments, ab_subject_b, ab_split_pct, preview_text,
      ab_mode, ab_test_pct, ab_wait_hours, ab_metric)
    VALUES (@name, @subject, @from_name, @from_email, @reply_to, @html, @text, @group_ids, @attachments, @ab_subject_b, @ab_split_pct, @preview_text,
      @ab_mode, @ab_test_pct, @ab_wait_hours, @ab_metric)
  `).run(data);
  return { id: r.lastInsertRowid };
}

// A/B winner-mode settings, clamped to sane values.
function abSettings(c) {
  return {
    ab_mode:       c.ab_mode === 'winner' ? 'winner' : 'split',
    ab_test_pct:   Math.min(50, Math.max(5, Number(c.ab_test_pct) || 20)),
    ab_wait_hours: Math.min(72, Math.max(1, Number(c.ab_wait_hours) || 4)),
    ab_metric:     c.ab_metric === 'clicks' ? 'clicks' : 'opens',
  };
}

function setAbWinner(id, winner) {
  db.prepare('UPDATE campaigns SET ab_winner = ? WHERE id = ?').run(winner || '', id);
}

function deleteCampaign(id) {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  return { ok: true };
}

function normalizeCampaign(c) {
  return {
    ...c,
    group_ids:     JSON.parse(c.group_ids   || '[]'),
    attachments:   JSON.parse(c.attachments || '[]'),
    ab_subject_b:  c.ab_subject_b  || '',
    ab_split_pct:  c.ab_split_pct  || 50,
    preview_text:  c.preview_text  || '',
    test_sent_at:  c.test_sent_at  || null,
    ...abSettings(c),
    ab_winner:     c.ab_winner     || '',
    resume_offset: c.resume_offset || 0,
    resume_at:     c.resume_at     || null,
    scheduled_at:  c.scheduled_at  || null,
  };
}

function duplicateCampaign(id) {
  const orig = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!orig) return { ok: false, error: 'Not found' };
  const r = db.prepare(`
    INSERT INTO campaigns
      (name, subject, from_name, from_email, reply_to, html, text,
       group_ids, attachments, ab_subject_b, ab_split_pct, preview_text,
       ab_mode, ab_test_pct, ab_wait_hours, ab_metric)
    VALUES
      (@name, @subject, @from_name, @from_email, @reply_to, @html, @text,
       @group_ids, @attachments, @ab_subject_b, @ab_split_pct, @preview_text,
       @ab_mode, @ab_test_pct, @ab_wait_hours, @ab_metric)
  `).run({
    ...orig,
    name:        `${orig.name} (Copy)`,
    attachments: orig.attachments  || '[]',
    ab_subject_b:orig.ab_subject_b || '',
    ab_split_pct:orig.ab_split_pct || 50,
    preview_text:orig.preview_text || '',
    ...abSettings(orig),
    id: undefined,
  });
  return { id: r.lastInsertRowid };
}

// Campaign uid = the id teammates share (local integer ids differ per
// machine). Team Sync assigns it on first sync; sending assigns it earlier if
// needed, because the Brevo stats tag is built from it.
function ensureCampaignUid(id) {
  const row = db.prepare('SELECT uid FROM campaigns WHERE id = ?').get(id);
  if (!row) return null;
  if (row.uid) return row.uid;
  const uid = require('crypto').randomUUID();
  db.prepare('UPDATE campaigns SET uid = ? WHERE id = ? AND uid IS NULL').run(uid, id);
  return db.prepare('SELECT uid FROM campaigns WHERE id = ?').get(id).uid;
}

function campaignSentHere(id) {
  return !!db.prepare('SELECT 1 FROM send_history WHERE campaign_id = ? AND origin_device IS NULL LIMIT 1').get(id);
}

// ── Send history ──────────────────────────────────────────────────────────────
function logSend({ campaign_id, subscriber_id, email, name, status, error }) {
  db.prepare(`
    INSERT INTO send_history (campaign_id, subscriber_id, email, name, status, error)
    VALUES (@campaign_id, @subscriber_id, @email, @name, @status, @error)
  `).run({ campaign_id, subscriber_id: subscriber_id || null, email, name, status, error: error || '' });
}

function updateCampaignProgress(id, sent_count, total_count, status, sent_at = null) {
  db.prepare(`
    UPDATE campaigns SET sent_count=@sent_count, total_count=@total_count,
    status=@status, sent_at=@sent_at, updated_at=datetime('now') WHERE id=@id
  `).run({ id, sent_count, total_count, status, sent_at });
}

function listHistory({ campaign_id = null, page = 1, limit = 100 } = {}) {
  const offset = (page - 1) * limit;
  let where = '1=1';
  const params = [];
  if (campaign_id) { where += ' AND h.campaign_id = ?'; params.push(campaign_id); }
  const total = db.prepare(`SELECT COUNT(*) as c FROM send_history h WHERE ${where}`).get(...params).c;
  const rows  = db.prepare(`
    SELECT h.*, c.name as campaign_name
    FROM send_history h
    LEFT JOIN campaigns c ON c.id = h.campaign_id
    WHERE ${where}
    ORDER BY h.sent_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return { rows, total, page, limit };
}

// ── Subscriber lookup for sending ─────────────────────────────────────────────
function getActiveSubscribersForCampaign(group_ids) {
  const rows = (group_ids && group_ids.length > 0)
    ? (() => {
        const placeholders = group_ids.map(() => '?').join(',');
        return db.prepare(`
          SELECT DISTINCT s.id, s.email, s.name, s.first_name, s.last_name, s.company, s.custom_fields
          FROM subscribers s
          JOIN subscriber_groups sg ON sg.subscriber_id = s.id
          WHERE s.status = 'active' AND sg.group_id IN (${placeholders})
          ORDER BY s.email
        `).all(...group_ids);
      })()
    : db.prepare(`
        SELECT id, email, name, first_name, last_name, company, custom_fields
        FROM subscribers WHERE status = 'active' ORDER BY email
      `).all();
  return rows.map(r => ({ ...r, custom_fields: JSON.parse(r.custom_fields || '{}') }));
}

// Addresses this campaign already reached on any teammate's machine — a resume skips them.
function campaignReachedEmails(campaign_id) {
  const rows = db.prepare(`SELECT DISTINCT lower(email) AS email FROM send_history WHERE campaign_id = ? AND status IN ('sent', 'bounced')`).all(campaign_id);
  return new Set(rows.map(r => r.email));
}

// The SMTP server said the address doesn't exist: it's never emailed again.
function markSubscriberBounced(id) {
  if (!id) return;
  db.prepare(`UPDATE subscribers SET status='bounced', updated_at=datetime('now') WHERE id=? AND status='active'`).run(id);
}

function markTestSent(campaign_id) {
  db.prepare(`UPDATE campaigns SET test_sent_at = datetime('now') WHERE id = ?`).run(campaign_id);
}

// ── Daily send tracking ───────────────────────────────────────────────────────
// Counts this device's sends by default (each person sends through their own
// SMTP account). teamWide also counts teammates' sends synced in by Team
// Sync, for teams that share one sending account and so one daily quota.
function getTodaySentCount(teamWide = false) {
  return db.prepare(
    `SELECT COUNT(*) as c FROM send_history WHERE status='sent' ${teamWide ? '' : 'AND origin_device IS NULL'} AND date(sent_at,'localtime')=date('now','localtime')`
  ).get().c;
}

function updateCampaignResume(id, resume_offset, resume_at) {
  db.prepare('UPDATE campaigns SET resume_offset=?, resume_at=? WHERE id=?')
    .run(resume_offset, resume_at, id);
}

function updateCampaignScheduledAt(id, scheduled_at) {
  db.prepare('UPDATE campaigns SET scheduled_at=? WHERE id=?').run(scheduled_at, id);
}

function getPausedCampaigns() {
  return db.prepare("SELECT * FROM campaigns WHERE status='paused' ORDER BY created_at DESC")
    .all().map(normalizeCampaign);
}

function getPausedCampaignsToResume() {
  // Returns paused campaigns whose resume_at has passed
  return db.prepare(
    "SELECT * FROM campaigns WHERE status='paused' AND resume_at IS NOT NULL AND datetime(resume_at) <= datetime('now')"
  ).all().map(normalizeCampaign);
}

// ── Notifications ─────────────────────────────────────────────────────────────
function addNotification(type, title, body, campaign_id = null) {
  db.prepare(
    'INSERT INTO notifications (type, title, body, campaign_id) VALUES (?, ?, ?, ?)'
  ).run(type, title, body, campaign_id);
  // Keep only last 200 notifications
  db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 200)').run();
}

function listNotifications(limit = 60) {
  return db.prepare(`
    SELECT n.*, c.name as campaign_name
    FROM notifications n
    LEFT JOIN campaigns c ON c.id = n.campaign_id
    ORDER BY n.created_at DESC LIMIT ?
  `).all(limit);
}

function markAllNotificationsRead() {
  db.prepare('UPDATE notifications SET read=1').run();
  return { ok: true };
}

function getUnreadNotificationCount() {
  return db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read=0').get().c;
}

// ── AI ────────────────────────────────────────────────────────────────────────
function logAiCall({ feature, model, input_tokens = 0, output_tokens = 0, ms = 0, ok = true, error = '' }) {
  db.prepare(`
    INSERT INTO ai_log (feature, model, input_tokens, output_tokens, ms, ok, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(feature, model, input_tokens, output_tokens, ms, ok ? 1 : 0, error || '');
}

function aiUsageThisMonth() {
  return db.prepare(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(input_tokens), 0)  AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(ok = 0), 0)        AS failed
    FROM ai_log WHERE created_at >= strftime('%Y-%m-01', 'now')
  `).get();
}

// Aggregate send results for one campaign — counts and error messages only,
// no addresses, so it's safe to hand to the AI follow-up writer.
function campaignSendSummary(campaign_id) {
  const counts = db.prepare(`
    SELECT COALESCE(SUM(status = 'sent'), 0) AS sent, COALESCE(SUM(status = 'bounced'), 0) AS bounced,
           COALESCE(SUM(status != 'sent'), 0) AS failed
    FROM send_history WHERE campaign_id = ?
  `).get(campaign_id);
  const topErrors = db.prepare(`
    SELECT error, COUNT(*) AS count FROM send_history
    WHERE campaign_id = ? AND status != 'sent' AND error != ''
    GROUP BY error ORDER BY count DESC LIMIT 5
  `).all(campaign_id);
  return { ...counts, topErrors };
}

// A campaign's failed sends grouped by cause (smtpErrors.js), with fixes.
function campaignFailureGroups(campaign_id) {
  const rows = db.prepare(`
    SELECT error, COUNT(*) AS count FROM send_history
    WHERE campaign_id = ? AND status != 'sent'
    GROUP BY error
  `).all(campaign_id);
  return smtpErrors.groupFailures(rows);
}

// The account's other sent campaigns, newest first, as the baseline a report
// compares against. Counts only: no addresses.
function recentCampaignStats(exclude_id, limit = 10) {
  return db.prepare(`
    SELECT c.id, c.name, c.subject, c.sent_at,
           COALESCE(SUM(h.status = 'sent'), 0)    AS sent,
           COALESCE(SUM(h.status = 'bounced'), 0) AS bounced,
           COALESCE(SUM(h.status = 'failed'), 0)  AS failed
    FROM campaigns c JOIN send_history h ON h.campaign_id = c.id
    WHERE c.id != ?
    GROUP BY c.id
    ORDER BY MAX(h.sent_at) DESC
    LIMIT ?
  `).all(exclude_id, limit);
}

module.exports = {
  handle: db,   // raw connection for teamStore.js
  listSubscribers, subscriberIdsForFilter, addSubscriber, updateSubscriber, deleteSubscribers,
  importSubscribers, importDomains, exportSubscribers, subscriberStats, listCustomFieldKeys,
  listGroups, addGroup, deleteGroup, assignGroup,
  listTemplates, saveTemplate, deleteTemplate,
  listCampaigns, getCampaign, saveCampaign, deleteCampaign, duplicateCampaign,
  ensureCampaignUid, campaignSentHere,
  listHistory, logSend, updateCampaignProgress,
  getActiveSubscribersForCampaign,
  campaignReachedEmails, markSubscriberBounced, markTestSent, setAbWinner,
  // Daily limit & resume
  getTodaySentCount, updateCampaignResume, updateCampaignScheduledAt,
  getPausedCampaigns, getPausedCampaignsToResume,
  // Notifications
  addNotification, listNotifications, markAllNotificationsRead, getUnreadNotificationCount,
  // AI
  logAiCall, aiUsageThisMonth, campaignSendSummary, campaignFailureGroups, recentCampaignStats,
};
