// Vercel Cron target — this is what makes scheduling work regardless of
// whether any team member's laptop is on. Runs on a fixed interval (see
// vercel.json / the README for the free-tier cron-frequency caveat) and
// processes a bounded slice of work per tick so it never runs into the
// serverless function time limit, no matter how large a list gets —
// same resumable-batch idea as start_offset/resume_offset in the desktop
// app's mailer.js, just driven by cron ticks instead of a local setInterval.

const nodemailer = require('nodemailer');
const { sql }    = require('../../lib/db');
const { decrypt } = require('../../lib/crypto');

const CAMPAIGNS_PER_TICK  = 5;   // how many due campaigns to touch in one invocation
const RECIPIENTS_PER_TICK = 25;  // how many emails to send per campaign per invocation

function verifyCron(req) {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

async function sendBatch(team, campaign, subscribers) {
  const transport = nodemailer.createTransport({
    host:   team.smtp_host,
    port:   team.smtp_port,
    secure: team.smtp_port === 465,
    auth:   { user: team.smtp_user, pass: decrypt(team.smtp_pass_enc) },
  });

  let sent = 0;
  for (const sub of subscribers) {
    try {
      await transport.sendMail({
        from:    `${team.from_name || team.name} <${team.from_email}>`,
        to:      sub.email,
        subject: campaign.subject,
        html:    campaign.html,
      });
      sent++;
    } catch (err) {
      console.error(`send failed for campaign ${campaign.id} -> ${sub.email}:`, err.message);
      // Skip this recipient, keep going — a single bad address shouldn't stall the campaign.
    }
  }
  transport.close();
  return sent;
}

module.exports = async (req, res) => {
  if (!verifyCron(req)) return res.status(401).json({ error: 'unauthorized' });

  const due = await sql`
    SELECT * FROM campaigns
    WHERE (status = 'scheduled' AND scheduled_at <= now()) OR status = 'sending'
    ORDER BY scheduled_at ASC NULLS LAST
    LIMIT ${CAMPAIGNS_PER_TICK}
  `;

  const results = [];

  for (const campaign of due) {
    try {
      const [team] = await sql`SELECT * FROM teams WHERE id = ${campaign.team_id}`;
      if (!team || !team.smtp_host) {
        await sql`UPDATE campaigns SET status = 'failed', error = 'no SMTP configured for team' WHERE id = ${campaign.id}`;
        results.push({ id: campaign.id, error: 'no SMTP configured' });
        continue;
      }

      const subscribers = await sql`
        SELECT email FROM subscribers
        WHERE team_id = ${campaign.team_id} AND status = 'active'
        ORDER BY id ASC
        OFFSET ${campaign.sent_count} LIMIT ${RECIPIENTS_PER_TICK}
      `;

      if (subscribers.length === 0) {
        await sql`UPDATE campaigns SET status = 'sent', sent_at = now() WHERE id = ${campaign.id}`;
        results.push({ id: campaign.id, done: true });
        continue;
      }

      const sentNow = await sendBatch(team, campaign, subscribers);
      const newSentCount = campaign.sent_count + subscribers.length; // advance offset even past failed addresses

      const nowDone = newSentCount >= campaign.total_count;
      await sql`
        UPDATE campaigns
        SET sent_count = ${newSentCount},
            status     = ${nowDone ? 'sent' : 'sending'},
            sent_at    = ${nowDone ? new Date().toISOString() : null}
        WHERE id = ${campaign.id}
      `;
      results.push({ id: campaign.id, sentNow, newSentCount, done: nowDone });
    } catch (err) {
      console.error(`campaign ${campaign.id} tick failed:`, err);
      await sql`UPDATE campaigns SET status = 'failed', error = ${err.message} WHERE id = ${campaign.id}`;
      results.push({ id: campaign.id, error: err.message });
    }
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
};
