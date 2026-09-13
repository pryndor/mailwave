const { sql } = require('../lib/db');
const { authenticateTeam } = require('../lib/auth');

module.exports = async (req, res) => {
  const team = await authenticateTeam(req);
  if (!team) return res.status(401).json({ error: 'invalid or missing team token' });

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, name, subject, status, scheduled_at, sent_count, total_count, sent_at, error, created_at
      FROM campaigns WHERE team_id = ${team.id} ORDER BY created_at DESC
    `;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { name, subject, html, scheduled_at } = req.body || {};
    if (!name || !subject || !html) {
      return res.status(400).json({ error: 'name, subject, and html are required' });
    }

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM subscribers WHERE team_id = ${team.id} AND status = 'active'
    `;
    if (count === 0) return res.status(400).json({ error: 'no active subscribers for this team' });

    const status = scheduled_at ? 'scheduled' : 'draft';

    const [row] = await sql`
      INSERT INTO campaigns (team_id, name, subject, html, status, scheduled_at, total_count)
      VALUES (${team.id}, ${name}, ${subject}, ${html}, ${status}, ${scheduled_at || null}, ${count})
      RETURNING id, status, total_count
    `;
    return res.status(200).json({ ok: true, campaign: row });
  }

  return res.status(405).end();
};
