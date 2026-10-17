// Team sync ⇄ SQLite bridge. Turns local rows into portable records keyed by
// uid (not the per-machine integer id), detects what changed since the last
// sync by hashing, and applies teammates' events with last-writer-wins.
//
// Change detection is state-based (diff against sync_state) rather than hooking
// every write in db.js, so existing code paths — imports, mailer progress,
// smart schedule — are all picked up without modification.
const crypto = require('crypto');
const { handle: db } = require('./db');

// Apply order inside one batch: referenced entities first.
const ENTITIES = ['group', 'template', 'subscriber', 'campaign', 'cstate'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashRecord = (rec) => sha(JSON.stringify(rec)).slice(0, 40);
const sortedObj = (o) => Object.fromEntries(Object.keys(o || {}).sort().map(k => [k, o[k]]));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ── uid backfill ──────────────────────────────────────────────────────────────
// Subscribers/groups get deterministic uids from their natural key, so two
// teammates importing the same email independently converge on one record.
function ensureUids() {
  const run = db.transaction(() => {
    const setSub = db.prepare('UPDATE subscribers SET uid=? WHERE id=?');
    for (const r of db.prepare('SELECT id, email FROM subscribers WHERE uid IS NULL').all()) {
      const uid = 's' + sha(r.email.toLowerCase().trim()).slice(0, 31);
      // A remote record may already hold this uid under an older email — leave that one alone.
      if (!db.prepare('SELECT 1 FROM subscribers WHERE uid=?').get(uid)) setSub.run(uid, r.id);
      else setSub.run('s' + crypto.randomUUID().replace(/-/g, ''), r.id);
    }
    const setGroup = db.prepare('UPDATE groups SET uid=? WHERE id=?');
    for (const r of db.prepare('SELECT id, name FROM groups WHERE uid IS NULL').all()) {
      const uid = 'g' + sha(r.name).slice(0, 31);
      setGroup.run(db.prepare('SELECT 1 FROM groups WHERE uid=?').get(uid) ? 'g' + crypto.randomUUID().replace(/-/g, '') : uid, r.id);
    }
    for (const t of ['templates', 'campaigns']) {
      const set = db.prepare(`UPDATE ${t} SET uid=? WHERE id=?`);
      for (const r of db.prepare(`SELECT id FROM ${t} WHERE uid IS NULL`).all()) set.run(crypto.randomUUID(), r.id);
    }
  });
  run();
}

// ── Export: local rows → portable records ─────────────────────────────────────
function groupUidMap() {
  return new Map(db.prepare('SELECT id, uid FROM groups').all().map(g => [g.id, g.uid]));
}

function exportEntity(entity, onlyUid = null) {
  const where = onlyUid ? ' WHERE uid = ?' : '';
  const args = onlyUid ? [onlyUid] : [];
  const out = new Map();

  if (entity === 'group') {
    for (const r of db.prepare(`SELECT uid, name FROM groups${where}`).all(...args)) out.set(r.uid, { name: r.name });
  }

  if (entity === 'template') {
    for (const r of db.prepare(`SELECT uid, name, subject, html, text FROM templates${where}`).all(...args)) {
      out.set(r.uid, { name: r.name, subject: r.subject, html: r.html, text: r.text });
    }
  }

  if (entity === 'subscriber') {
    const rows = db.prepare(`SELECT * FROM subscribers${where}`).all(...args);
    const memberships = new Map();
    const memSql = onlyUid
      ? db.prepare('SELECT sg.subscriber_id, g.uid FROM subscriber_groups sg JOIN groups g ON g.id = sg.group_id JOIN subscribers s ON s.id = sg.subscriber_id WHERE s.uid = ?').all(onlyUid)
      : db.prepare('SELECT sg.subscriber_id, g.uid FROM subscriber_groups sg JOIN groups g ON g.id = sg.group_id').all();
    for (const m of memSql) {
      if (!memberships.has(m.subscriber_id)) memberships.set(m.subscriber_id, []);
      memberships.get(m.subscriber_id).push(m.uid);
    }
    for (const r of rows) {
      out.set(r.uid, {
        email: r.email, name: r.name, first_name: r.first_name, last_name: r.last_name,
        phone: r.phone, company: r.company, status: r.status,
        custom_fields: sortedObj(parse(r.custom_fields, {})),
        groups: (memberships.get(r.id) || []).sort(),
        created_at: r.created_at,
      });
    }
  }

  // Campaign content and campaign send-state are separate entities so live
  // progress updates (every sync while sending) don't re-upload the whole HTML.
  if (entity === 'campaign' || entity === 'cstate') {
    const gmap = groupUidMap();
    for (const r of db.prepare(`SELECT * FROM campaigns${where}`).all(...args)) {
      out.set(r.uid, entity === 'campaign'
        ? {
            name: r.name, subject: r.subject, from_name: r.from_name, from_email: r.from_email,
            reply_to: r.reply_to, html: r.html, text: r.text,
            groups: parse(r.group_ids, []).map(id => gmap.get(id)).filter(Boolean).sort(),
            attachments: parse(r.attachments, []),
            ab_subject_b: r.ab_subject_b || '', ab_split_pct: r.ab_split_pct || 50,
            created_at: r.created_at,
          }
        : {
            status: r.status, sent_count: r.sent_count, total_count: r.total_count,
            sent_at: r.sent_at || null, scheduled_at: r.scheduled_at || null,
            resume_offset: r.resume_offset || 0, resume_at: r.resume_at || null,
          });
    }
  }
  return out;
}

// ── Collect local changes (push side) ─────────────────────────────────────────
// Returns events plus a commit() that records them as synced — called only
// after the upload succeeded, so a failed push is simply retried next cycle.
function collectLocalChanges(dev, tick) {
  ensureUids();
  const events = [];
  const stateWrites = [];
  const getState = db.prepare('SELECT uid, hash FROM sync_state WHERE entity = ?');

  for (const entity of ENTITIES) {
    const current = exportEntity(entity);
    const known = new Map(getState.all(entity).map(s => [s.uid, s.hash]));
    for (const [uid, rec] of current) {
      const h = hashRecord(rec);
      if (known.get(uid) === h) continue;
      const ts = tick();
      events.push({ e: entity, op: 'put', uid, ts, dev, data: rec });
      stateWrites.push([entity, uid, h, ts, dev]);
    }
    for (const [uid, h] of known) {
      if (h === 'deleted' || current.has(uid)) continue;
      const ts = tick();
      events.push({ e: entity, op: 'del', uid, ts, dev });
      stateWrites.push([entity, uid, 'deleted', ts, dev]);
    }
  }

  // Send history is append-only: every local row without a uid is new.
  const newHistory = db.prepare(`
    SELECT h.id, h.email, h.name, h.status, h.error, h.sent_at, c.uid AS campaign_uid
    FROM send_history h JOIN campaigns c ON c.id = h.campaign_id
    WHERE h.uid IS NULL AND h.origin_device IS NULL
  `).all();
  const historyUids = [];
  for (const h of newHistory) {
    const uid = crypto.randomUUID();
    historyUids.push([uid, h.id]);
    events.push({
      e: 'history', op: 'add', uid, ts: tick(), dev,
      data: { campaign: h.campaign_uid, email: h.email, name: h.name, status: h.status, error: h.error, sent_at: h.sent_at },
    });
  }

  const commit = db.transaction(() => {
    const upsert = db.prepare('INSERT OR REPLACE INTO sync_state (entity, uid, hash, ts, dev) VALUES (?, ?, ?, ?, ?)');
    for (const w of stateWrites) upsert.run(...w);
    const setUid = db.prepare('UPDATE send_history SET uid = ? WHERE id = ?');
    for (const [uid, id] of historyUids) setUid.run(uid, id);
  });

  return { events, commit };
}

// ── Apply remote events (pull side) ───────────────────────────────────────────
function localIdByUid(table, uid) {
  return db.prepare(`SELECT id FROM ${table} WHERE uid = ?`).get(uid)?.id;
}

function groupIdsFromUids(uids) {
  return (uids || []).map(u => localIdByUid('groups', u)).filter(Boolean);
}

const applyPut = {
  group(uid, d) {
    const id = localIdByUid('groups', uid);
    if (id) { db.prepare('UPDATE groups SET name=? WHERE id=?').run(d.name, id); return; }
    // Same name created independently on both sides — adopt the remote uid.
    const byName = db.prepare('SELECT id FROM groups WHERE name=?').get(d.name);
    if (byName) db.prepare('UPDATE groups SET uid=? WHERE id=?').run(uid, byName.id);
    else db.prepare('INSERT INTO groups (name, uid) VALUES (?, ?)').run(d.name, uid);
  },

  template(uid, d) {
    const id = localIdByUid('templates', uid);
    if (id) db.prepare(`UPDATE templates SET name=?, subject=?, html=?, text=?, updated_at=datetime('now') WHERE id=?`).run(d.name, d.subject, d.html, d.text, id);
    else db.prepare('INSERT INTO templates (name, subject, html, text, uid) VALUES (?, ?, ?, ?, ?)').run(d.name, d.subject, d.html, d.text, uid);
  },

  subscriber(uid, d) {
    let row = db.prepare('SELECT id FROM subscribers WHERE uid=?').get(uid);
    const clash = db.prepare('SELECT id, uid FROM subscribers WHERE email=?').get(d.email);
    if (!row && clash) {
      db.prepare('UPDATE subscribers SET uid=? WHERE id=?').run(uid, clash.id);
      row = { id: clash.id };
    } else if (row && clash && clash.id !== row.id) {
      // Teammate renamed an email onto one that exists here — the winner absorbs it.
      db.prepare('DELETE FROM subscribers WHERE id=?').run(clash.id);
    }
    const vals = [d.email, d.name || '', d.first_name || '', d.last_name || '', d.phone || '', d.company || '', d.status || 'active', JSON.stringify(d.custom_fields || {})];
    let id = row?.id;
    if (id) {
      db.prepare(`UPDATE subscribers SET email=?, name=?, first_name=?, last_name=?, phone=?, company=?, status=?, custom_fields=?, updated_at=datetime('now') WHERE id=?`).run(...vals, id);
    } else {
      id = db.prepare(`INSERT INTO subscribers (email, name, first_name, last_name, phone, company, status, custom_fields, created_at, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`).run(...vals, d.created_at || null, uid).lastInsertRowid;
    }
    db.prepare('DELETE FROM subscriber_groups WHERE subscriber_id=?').run(id);
    const add = db.prepare('INSERT OR IGNORE INTO subscriber_groups (subscriber_id, group_id) VALUES (?, ?)');
    for (const gid of groupIdsFromUids(d.groups)) add.run(id, gid);
  },

  campaign(uid, d) {
    const vals = {
      name: d.name, subject: d.subject || '', from_name: d.from_name || '', from_email: d.from_email || '',
      reply_to: d.reply_to || '', html: d.html || '', text: d.text || '',
      group_ids: JSON.stringify(groupIdsFromUids(d.groups)),
      attachments: JSON.stringify(d.attachments || []),
      ab_subject_b: d.ab_subject_b || '', ab_split_pct: d.ab_split_pct || 50,
      created_at: d.created_at || null, uid,
    };
    const id = localIdByUid('campaigns', uid);
    if (id) {
      db.prepare(`UPDATE campaigns SET name=@name, subject=@subject, from_name=@from_name, from_email=@from_email,
        reply_to=@reply_to, html=@html, text=@text, group_ids=@group_ids, attachments=@attachments,
        ab_subject_b=@ab_subject_b, ab_split_pct=@ab_split_pct, updated_at=datetime('now') WHERE uid=@uid`).run(vals);
    } else {
      db.prepare(`INSERT INTO campaigns (name, subject, from_name, from_email, reply_to, html, text, group_ids,
        attachments, ab_subject_b, ab_split_pct, created_at, uid)
        VALUES (@name, @subject, @from_name, @from_email, @reply_to, @html, @text, @group_ids,
        @attachments, @ab_subject_b, @ab_split_pct, COALESCE(@created_at, datetime('now')), @uid)`).run(vals);
    }
  },

  cstate(uid, d) {
    // Returns false when the campaign itself hasn't arrived yet, so the state isn't marked synced.
    if (!localIdByUid('campaigns', uid)) return false;
    db.prepare(`UPDATE campaigns SET status=@status, sent_count=@sent_count, total_count=@total_count,
      sent_at=@sent_at, scheduled_at=@scheduled_at, resume_offset=@resume_offset, resume_at=@resume_at
      WHERE uid=@uid`).run({ ...d, uid });
  },
};

const TABLE = { group: 'groups', template: 'templates', subscriber: 'subscribers', campaign: 'campaigns' };

function applyRemoteEvents(events) {
  const counts = { applied: 0, skipped: 0, history: 0, campaigns: 0 };
  const order = (e) => e.e === 'history' ? ENTITIES.length : ENTITIES.indexOf(e.e);
  events.sort((a, b) => order(a) - order(b) || a.ts - b.ts || (a.dev < b.dev ? -1 : 1));

  const getState = db.prepare('SELECT ts, dev FROM sync_state WHERE entity=? AND uid=?');
  const setState = db.prepare('INSERT OR REPLACE INTO sync_state (entity, uid, hash, ts, dev) VALUES (?, ?, ?, ?, ?)');

  const run = db.transaction(() => {
    for (const ev of events) {
      if (ev.e === 'history') {
        if (db.prepare('SELECT 1 FROM send_history WHERE uid=?').get(ev.uid)) continue;
        const cid = localIdByUid('campaigns', ev.data.campaign);
        if (!cid) continue;
        const sid = db.prepare('SELECT id FROM subscribers WHERE email=?').get(ev.data.email)?.id || null;
        db.prepare(`INSERT INTO send_history (campaign_id, subscriber_id, email, name, status, error, sent_at, uid, origin_device)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cid, sid, ev.data.email, ev.data.name || '', ev.data.status, ev.data.error || '', ev.data.sent_at, ev.uid, ev.dev);
        counts.history++;
        continue;
      }
      if (!ENTITIES.includes(ev.e)) continue;

      // Last-writer-wins on (logical clock, device id).
      const st = getState.get(ev.e, ev.uid);
      if (st && (st.ts > ev.ts || (st.ts === ev.ts && st.dev >= ev.dev))) { counts.skipped++; continue; }

      if (ev.op === 'del') {
        if (ev.e !== 'cstate') db.prepare(`DELETE FROM ${TABLE[ev.e]} WHERE uid=?`).run(ev.uid);
        setState.run(ev.e, ev.uid, 'deleted', ev.ts, ev.dev);
      } else {
        if (applyPut[ev.e](ev.uid, ev.data) === false) continue;
        // Hash what's actually stored now (e.g. unknown group refs dropped), so the
        // next push doesn't mistake the applied record for a local edit.
        const rec = exportEntity(ev.e, ev.uid).get(ev.uid);
        setState.run(ev.e, ev.uid, rec ? hashRecord(rec) : 'deleted', ev.ts, ev.dev);
      }
      counts.applied++;
      if (ev.e === 'campaign' || ev.e === 'cstate') counts.campaigns++;
    }
  });
  run();
  return counts;
}

// ── Meta key/value ────────────────────────────────────────────────────────────
function getMeta(key, fallback = null) {
  const r = db.prepare('SELECT value FROM sync_meta WHERE key=?').get(key);
  return r ? r.value : fallback;
}
function setMeta(key, value) {
  db.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run(key, value == null ? null : String(value));
}

// Leaving a team: forget sync bookkeeping (data stays). Joining another team
// later then treats everything local as new and uploads it there.
function resetSyncState() {
  db.exec('DELETE FROM sync_state; DELETE FROM sync_meta;');
  db.prepare('UPDATE send_history SET uid = NULL WHERE origin_device IS NULL').run();
}

function campaignUid(campaign_id) {
  ensureUids();
  return db.prepare('SELECT uid FROM campaigns WHERE id=?').get(campaign_id)?.uid || null;
}

module.exports = {
  ensureUids, collectLocalChanges, applyRemoteEvents,
  getMeta, setMeta, resetSyncState, campaignUid,
};
