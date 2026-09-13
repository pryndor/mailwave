const { sql } = require('./db');

// Every team-scoped endpoint requires `Authorization: Bearer <team api_token>` —
// same shape as the desktop app's automation_token, just per-team instead of per-machine.
async function authenticateTeam(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const rows = await sql`SELECT * FROM teams WHERE api_token = ${token}`;
  return rows[0] || null;
}

module.exports = { authenticateTeam };
