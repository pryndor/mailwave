// Neon's HTTP driver — no connection pooling to manage, well suited to
// short-lived serverless function invocations (each request is one HTTP
// call to Neon, not a held TCP connection).
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

module.exports = { sql };
