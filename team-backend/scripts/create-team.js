// Internal admin tool — no public signup flow exists yet (that's UI scope,
// not built in this pass). Run this yourself to provision a new paying
// team, then hand them the printed api_token to use from their tooling.
//
// Usage: DATABASE_URL=... ENCRYPTION_KEY=... node create-team.js <team-name> <smtp-json>
// smtp-json example: '{"host":"smtp.zoho.in","port":465,"user":"x@co.com","pass":"...","from_name":"Acme","from_email":"news@co.com"}'

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { encrypt } = require('../lib/crypto');

const [, , name, smtpJson] = process.argv;

if (!name || !smtpJson) {
  console.error('Usage: node create-team.js <team-name> <smtp-json>');
  process.exit(1);
}

const smtp = JSON.parse(smtpJson);
const sql  = neon(process.env.DATABASE_URL);

async function main() {
  const apiToken = crypto.randomBytes(24).toString('hex');
  const [row] = await sql`
    INSERT INTO teams (name, api_token, smtp_host, smtp_port, smtp_user, smtp_pass_enc, from_name, from_email)
    VALUES (${name}, ${apiToken}, ${smtp.host}, ${smtp.port}, ${smtp.user}, ${encrypt(smtp.pass)}, ${smtp.from_name}, ${smtp.from_email})
    RETURNING id
  `;
  console.log(`Team "${name}" created (id ${row.id}).`);
  console.log('\nAPI token (give this to the team, used as Bearer auth on every request):\n');
  console.log(apiToken);
}

main().catch((err) => { console.error(err); process.exit(1); });
