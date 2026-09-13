const { sql } = require('../lib/db');
const { authenticateTeam } = require('../lib/auth');

module.exports = async (req, res) => {
  const team = await authenticateTeam(req);
  if (!team) return res.status(401).json({ error: 'invalid or missing team token' });

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, email, name, status, created_at FROM subscribers
      WHERE team_id = ${team.id} ORDER BY created_at DESC
    `;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    // Body: { email, name } for one, or { rows: [{email, name}, ...] } to bulk import.
    const body = req.body || {};
    const incoming = Array.isArray(body.rows) ? body.rows : [body];

    let added = 0, skipped = 0;
    for (const r of incoming) {
      if (!r.email) { skipped++; continue; }
      await sql`
        INSERT INTO subscribers (team_id, email, name)
        VALUES (${team.id}, ${r.email.trim().toLowerCase()}, ${r.name || null})
        ON CONFLICT (team_id, email) DO NOTHING
      `;
      added++;
    }
    return res.status(200).json({ ok: true, added, skipped });
  }

  return res.status(405).end();
};
