const Database = require('better-sqlite3');
const path     = require('path');
const workspace = require('./workspace');

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
function listSubscribers({ search = '', status = 'all', group_id = null, page = 1, limit = 100 } = {}) {
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
  'email', 'e-mail', 'your email',
  'name', 'your full name', 'full name',
  'first_name', 'first name', 'firstname',
  'last_name', 'last name', 'lastname',
  'phone',
  'company', 'your qualification',
]);

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

function importSubscribers(rows, group_id = null) {
  let inserted = 0, updated = 0, skipped = 0;
  const upsert = db.prepare(`
    INSERT INTO subscribers (email, name, first_name, last_name, phone, company, status, custom_fields)
    VALUES (@email, @name, @first_name, @last_name, @phone, @company, 'active', @custom_fields)
    ON CONFLICT(email) DO UPDATE SET
      name       = COALESCE(NULLIF(@name,''), name),
      first_name = COALESCE(NULLIF(@first_name,''), first_name),
      last_name  = COALESCE(NULLIF(@last_name,''), last_name),
      phone      = COALESCE(NULLIF(@phone,''), phone),
      company    = COALESCE(NULLIF(@company,''), company),
      custom_fields = @custom_fields,
      updated_at = datetime('now')
  `);
  const assignStmt = group_id
    ? db.prepare('INSERT OR IGNORE INTO subscriber_groups (subscriber_id, group_id) VALUES (?, ?)')
    : null;

  const run = db.transaction(() => {
    for (const row of rows) {
      const emailVal = (row.email || row.Email || row['Your Email'] || row['E-mail'] || row['EMAIL'] || '').toLowerCase().trim()
      if (!emailVal || !emailVal.includes('@')) { skipped++; continue; }
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
  return { inserted, updated, skipped };
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
  };
  if (camp.id) {
    db.prepare(`
      UPDATE campaigns SET name=@name, subject=@subject, from_name=@from_name,
      from_email=@from_email, reply_to=@reply_to, html=@html, text=@text,
      group_ids=@group_ids, attachments=@attachments,
      ab_subject_b=@ab_subject_b, ab_split_pct=@ab_split_pct,
      updated_at=datetime('now') WHERE id=@id
    `).run(data);
    return { id: camp.id };
  }
  const r = db.prepare(`
    INSERT INTO campaigns (name, subject, from_name, from_email, reply_to, html, text, group_ids, attachments, ab_subject_b, ab_split_pct)
    VALUES (@name, @subject, @from_name, @from_email, @reply_to, @html, @text, @group_ids, @attachments, @ab_subject_b, @ab_split_pct)
  `).run(data);
  return { id: r.lastInsertRowid };
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
       group_ids, attachments, ab_subject_b, ab_split_pct)
    VALUES
      (@name, @subject, @from_name, @from_email, @reply_to, @html, @text,
       @group_ids, @attachments, @ab_subject_b, @ab_split_pct)
  `).run({
    ...orig,
    name:        `${orig.name} (Copy)`,
    attachments: orig.attachments  || '[]',
    ab_subject_b:orig.ab_subject_b || '',
    ab_split_pct:orig.ab_split_pct || 50,
    id: undefined,
  });
  return { id: r.lastInsertRowid };
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

function unsubscribeByEmail(email) {
  db.prepare(`UPDATE subscribers SET status='unsubscribed', updated_at=datetime('now') WHERE email=?`)
    .run(email.toLowerCase().trim());
  return { ok: true };
}

// ── Daily send tracking ───────────────────────────────────────────────────────
function getTodaySentCount() {
  return db.prepare(
    "SELECT COUNT(*) as c FROM send_history WHERE status='sent' AND origin_device IS NULL AND date(sent_at,'localtime')=date('now','localtime')"
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
    SELECT COALESCE(SUM(status = 'sent'), 0) AS sent, COALESCE(SUM(status != 'sent'), 0) AS failed
    FROM send_history WHERE campaign_id = ?
  `).get(campaign_id);
  const topErrors = db.prepare(`
    SELECT error, COUNT(*) AS count FROM send_history
    WHERE campaign_id = ? AND status != 'sent' AND error != ''
    GROUP BY error ORDER BY count DESC LIMIT 5
  `).all(campaign_id);
  return { ...counts, topErrors };
}

module.exports = {
  handle: db,   // raw connection for teamStore.js
  listSubscribers, addSubscriber, updateSubscriber, deleteSubscribers,
  importSubscribers, exportSubscribers, subscriberStats, listCustomFieldKeys,
  listGroups, addGroup, deleteGroup, assignGroup,
  listTemplates, saveTemplate, deleteTemplate,
  listCampaigns, getCampaign, saveCampaign, deleteCampaign, duplicateCampaign,
  listHistory, logSend, updateCampaignProgress,
  getActiveSubscribersForCampaign, unsubscribeByEmail,
  // Daily limit & resume
  getTodaySentCount, updateCampaignResume, updateCampaignScheduledAt,
  getPausedCampaigns, getPausedCampaignsToResume,
  // Notifications
  addNotification, listNotifications, markAllNotificationsRead, getUnreadNotificationCount,
  // AI
  logAiCall, aiUsageThisMonth, campaignSendSummary,
};
