// Social posts and connected accounts, in the same SQLite file as the rest of
// MailWave. Access tokens are sealed with the OS keychain (secrets.js) and
// never leave the main process: listAccounts() strips them.
//
// A post is written once and published to one or more accounts ("targets").
// Each target keeps its own status, so one platform failing doesn't hide that
// the others went out. The post's status is derived from its targets.
const db = require('../db').handle;
const { seal, unseal } = require('../secrets');

db.exec(`
  CREATE TABLE IF NOT EXISTS social_accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    platform      TEXT NOT NULL,              -- linkedin | ...
    account_id    TEXT NOT NULL,              -- the platform's id (LinkedIn: person URN)
    name          TEXT NOT NULL DEFAULT '',
    avatar        TEXT NOT NULL DEFAULT '',
    token         TEXT NOT NULL DEFAULT '',   -- sealed access token
    refresh_token TEXT NOT NULL DEFAULT '',   -- sealed, when the platform issues one
    expires_at    TEXT,                       -- ISO time the access token stops working
    meta          TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (platform, account_id)
  );

  CREATE TABLE IF NOT EXISTS social_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    text         TEXT NOT NULL DEFAULT '',
    link         TEXT NOT NULL DEFAULT '',
    image_path   TEXT NOT NULL DEFAULT '',
    variants     TEXT NOT NULL DEFAULT '{}',  -- { platform: text } overrides of text
    status       TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | publishing | published | partial | failed | missed
    scheduled_at TEXT,                         -- ISO time, set while scheduled
    published_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS social_targets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      INTEGER NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    account_id   INTEGER NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | publishing | published | failed
    remote_id    TEXT NOT NULL DEFAULT '',
    remote_url   TEXT NOT NULL DEFAULT '',
    error        TEXT NOT NULL DEFAULT '',
    published_at TEXT,
    UNIQUE (post_id, account_id)
  );
`);

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

// ── Accounts ─────────────────────────────────────────────────────────────────

function publicAccount(row) {
  if (!row) return null;
  const { token, refresh_token, meta, ...rest } = row;
  // renews: the platform gave a refresh token, so a passed expires_at only
  // means the next publish renews the token first (X).
  const renews = !!refresh_token;
  return { ...rest, meta: parse(meta, {}), renews, expired: !renews && !!row.expires_at && new Date(row.expires_at) <= new Date() };
}

function listAccounts() {
  return db.prepare('SELECT * FROM social_accounts ORDER BY platform, name').all().map(publicAccount);
}

// For publishing only (main process): includes the unsealed token.
function getAccountWithToken(id) {
  const row = db.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id);
  if (!row) return null;
  return { ...publicAccount(row), token: unseal(row.token), refresh_token: unseal(row.refresh_token) };
}

// Connecting the same account again (e.g. after the token expired) updates it
// in place, so scheduled posts that target it keep working.
function upsertAccount({ platform, account_id, name = '', avatar = '', token, refresh_token = '', expires_at = null, meta = {} }) {
  db.prepare(`
    INSERT INTO social_accounts (platform, account_id, name, avatar, token, refresh_token, expires_at, meta)
    VALUES (@platform, @account_id, @name, @avatar, @token, @refresh_token, @expires_at, @meta)
    ON CONFLICT (platform, account_id) DO UPDATE SET
      name = excluded.name, avatar = excluded.avatar, token = excluded.token,
      refresh_token = excluded.refresh_token, expires_at = excluded.expires_at,
      meta = excluded.meta, updated_at = datetime('now')
  `).run({ platform, account_id, name, avatar, token: seal(token), refresh_token: seal(refresh_token), expires_at, meta: JSON.stringify(meta) });
  return publicAccount(db.prepare('SELECT * FROM social_accounts WHERE platform = ? AND account_id = ?').get(platform, account_id));
}

// After a refresh. X issues a new refresh token every time.
function updateTokens(id, { token, refresh_token, expires_at }) {
  db.prepare(`UPDATE social_accounts SET token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(seal(token), seal(refresh_token || ''), expires_at || null, id);
}

function deleteAccount(id) {
  db.prepare('DELETE FROM social_accounts WHERE id = ?').run(id);
  return { ok: true };
}

// ── Posts ────────────────────────────────────────────────────────────────────

const targetsStmt = () => db.prepare(`
  SELECT t.*, a.platform, a.name AS account_name
  FROM social_targets t JOIN social_accounts a ON a.id = t.account_id
  WHERE t.post_id = ? ORDER BY a.platform, a.name
`);

function hydrate(row) {
  if (!row) return null;
  return { ...row, variants: parse(row.variants, {}), targets: targetsStmt().all(row.id) };
}

function listPosts() {
  return db.prepare(`
    SELECT * FROM social_posts
    ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
             COALESCE(scheduled_at, published_at, updated_at) DESC
  `).all().map(hydrate);
}

function getPost(id) {
  return hydrate(db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id));
}

// Saves the content and the set of accounts. Targets that already went out
// are kept as they are; only unpublished ones are replaced.
const savePost = db.transaction(({ id, text = '', link = '', image_path = '', variants = {}, account_ids = [] }) => {
  const fields = { text, link, image_path, variants: JSON.stringify(variants || {}) };
  if (id) {
    const existing = db.prepare('SELECT status FROM social_posts WHERE id = ?').get(id);
    if (!existing) throw new Error('Post not found');
    if (existing.status === 'publishing') throw new Error('This post is being published right now.');
    db.prepare(`UPDATE social_posts SET text=@text, link=@link, image_path=@image_path, variants=@variants, updated_at=datetime('now') WHERE id=@id`)
      .run({ ...fields, id });
  } else {
    id = db.prepare('INSERT INTO social_posts (text, link, image_path, variants) VALUES (@text, @link, @image_path, @variants)').run(fields).lastInsertRowid;
  }
  const wanted = new Set(account_ids.map(Number));
  for (const t of db.prepare('SELECT id, account_id, status FROM social_targets WHERE post_id = ?').all(id)) {
    if (t.status !== 'published' && !wanted.has(t.account_id)) db.prepare('DELETE FROM social_targets WHERE id = ?').run(t.id);
  }
  const insert = db.prepare('INSERT OR IGNORE INTO social_targets (post_id, account_id) VALUES (?, ?)');
  for (const aid of wanted) insert.run(id, aid);
  return getPost(id);
});

function deletePost(id) {
  const p = db.prepare('SELECT status FROM social_posts WHERE id = ?').get(id);
  if (p?.status === 'publishing') return { ok: false, error: 'This post is being published right now.' };
  db.prepare('DELETE FROM social_posts WHERE id = ?').run(id);
  return { ok: true };
}

function setSchedule(id, scheduled_at) {
  db.prepare(`UPDATE social_posts SET status = ?, scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(scheduled_at ? 'scheduled' : 'draft', scheduled_at || null, id);
  return getPost(id);
}

function setPostStatus(id, status, extra = {}) {
  db.prepare(`UPDATE social_posts SET status = @status, published_at = COALESCE(@published_at, published_at), scheduled_at = CASE WHEN @status = 'scheduled' THEN scheduled_at ELSE NULL END, updated_at = datetime('now') WHERE id = @id`)
    .run({ id, status, published_at: extra.published_at || null });
}

function updateTarget(id, fields) {
  const cols = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE social_targets SET ${cols} WHERE id = @id`).run({ ...fields, id });
}

// Posts whose time has come. Claimed in the same transaction so a second
// scheduler tick can't pick the same post up while the first is publishing.
const claimDuePosts = db.transaction((nowIso) => {
  const due = db.prepare(`SELECT id, scheduled_at FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= ?`).all(nowIso);
  const claim = db.prepare(`UPDATE social_posts SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'`);
  return due.filter(p => claim.run(p.id).changes === 1);
});

// Claims a draft or failed post for "Publish now". Returns false if another
// publish already has it.
function claimPost(id) {
  return db.prepare(`UPDATE social_posts SET status = 'publishing', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('publishing')`).run(id).changes === 1;
}

// The app closed or crashed while publishing. We can't know whether the
// platform received the post, so never retry automatically (that could post
// twice): mark it failed and tell the user to check.
function recoverInterrupted() {
  const msg = 'MailWave closed while publishing. Check the platform before retrying, so it isn\'t posted twice.';
  const n = db.prepare(`UPDATE social_targets SET status = 'failed', error = ? WHERE status = 'publishing'`).run(msg).changes;
  const posts = db.prepare(`SELECT id FROM social_posts WHERE status = 'publishing'`).all();
  for (const p of posts) setPostStatus(p.id, derivedStatus(p.id));
  return n;
}

function derivedStatus(post_id) {
  const ts = db.prepare('SELECT status FROM social_targets WHERE post_id = ?').all(post_id).map(t => t.status);
  if (!ts.length) return 'draft';
  const ok = ts.filter(s => s === 'published').length;
  if (ok === ts.length) return 'published';
  if (ok > 0) return 'partial';
  return ts.some(s => s === 'failed') ? 'failed' : 'draft';
}

module.exports = {
  listAccounts, getAccountWithToken, upsertAccount, updateTokens, deleteAccount,
  listPosts, getPost, savePost, deletePost, setSchedule, setPostStatus, updateTarget,
  claimDuePosts, claimPost, recoverInterrupted, derivedStatus,
};
