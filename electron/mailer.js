const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const settings   = require('./settings');
const db         = require('./db');
const teamSync   = require('./teamSync');

// Per-campaign stop requests — a module-level bool would let concurrent sends
// (e.g. auto-resume firing while another campaign is mid-send) cancel each other.
const stopRequested = new Set();

function stopSending(campaign_id) {
  stopRequested.add(campaign_id);
  return { ok: true };
}

// ── Connection test ───────────────────────────────────────────────────────────
async function testConnection(cfg) {
  try {
    const s = cfg || settings.getAll();
    const transport = buildTransport(s);
    await transport.verify();
    transport.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildTransport(s) {
  return nodemailer.createTransport({
    host:   s.smtp_host,
    port:   Number(s.smtp_port),
    secure: s.smtp_secure,
    auth:   { user: s.smtp_user, pass: s.smtp_pass },
    pool:   true,
    maxConnections: 1,      // single connection — looks like a normal mail client
    maxMessages:    Infinity,
    tls: { rejectUnauthorized: false },  // needed for some self-hosted (Mailcow) certs
  });
}

// ── Unsubscribe URL ───────────────────────────────────────────────────────────
// One-click HTTP unsubscribe needs a publicly reachable server; this app runs
// on the sender's own machine, so a mailto: link is the only address that
// resolves for the recipient. Gmail/Outlook render this as a one-click button
// via the List-Unsubscribe header (RFC 2369) without needing List-Unsubscribe-Post,
// which only applies to https:// targets (RFC 8058).
function buildUnsubUrl(email, campaignId, cfg) {
  const unsubAddress = cfg.unsubscribe_email || cfg.reply_to || cfg.from_email;
  const subject = encodeURIComponent(`Unsubscribe: ${campaignId}`);
  const body    = encodeURIComponent(`Please unsubscribe ${email}`);
  return `mailto:${unsubAddress}?subject=${subject}&body=${body}`;
}

// ── Personalization ───────────────────────────────────────────────────────────
function personalize(str, sub, unsubUrl) {
  if (!str) return '';
  const displayName = sub.name || sub.first_name || sub.email.split('@')[0];
  let out = str
    .replace(/\{\{name\}\}/gi,        displayName)
    .replace(/\{\{first_name\}\}/gi,  sub.first_name || displayName)
    .replace(/\{\{last_name\}\}/gi,   sub.last_name  || '')
    .replace(/\{\{email\}\}/gi,       sub.email)
    .replace(/\{\{company\}\}/gi,     sub.company    || '')
    .replace(/\{\{unsubscribe\}\}/gi, unsubUrl);

  // Custom CSV fields — any {{fieldname}} matching a key imported from the CSV.
  const custom = sub.custom_fields || {};
  for (const [key, val] of Object.entries(custom)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), val || '');
  }
  return out;
}

// ── Merge preview (no send) ───────────────────────────────────────────────────
// Renders subject + body for one subscriber, used by the campaign editor's "Preview Merge" panel.
function previewMerge(campaign, sub) {
  const unsubUrl = 'https://example.com/unsubscribe';
  return {
    subject: personalize(campaign.subject, sub, unsubUrl),
    html:    personalize(campaign.html,    sub, unsubUrl),
  };
}

// ── Deliverability: wrap HTML with proper email structure ─────────────────────
function wrapHtml(innerHtml, fromName, unsubUrl) {
  const hasUnsub = innerHtml.toLowerCase().includes('unsubscribe');
  const footer = hasUnsub ? '' : `
    <tr><td style="padding:20px;text-align:center;font-size:11px;color:#888;border-top:1px solid #eee;">
      You received this email from <strong>${fromName}</strong>.<br>
      <a href="${unsubUrl}" style="color:#888;">Unsubscribe</a>
    </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title></title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center"
  style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;margin:20px auto;">
<tr><td style="padding:20px 30px;">${innerHtml}</td></tr>
${footer}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Unique Message-ID ─────────────────────────────────────────────────────────
function makeMessageId(fromEmail) {
  const rand   = crypto.randomBytes(16).toString('hex');
  const domain = fromEmail.split('@')[1] || 'mailwave.local';
  return `<${rand}@${domain}>`;
}

// ── Plain text fallback ───────────────────────────────────────────────────────
function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Next-day resume time calculator ──────────────────────────────────────────
function calcNextResumeTime(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(h, m, 0, 0);
  return tomorrow.toISOString();
}

// ── Main send ─────────────────────────────────────────────────────────────────
// With Team Sync on, a real send first claims the campaign's lock in the team
// repo so two teammates' machines never send the same campaign twice.
// run_key names this attempt (see teamSync.acquireSendLock); manual sends get a fresh one.
async function sendCampaign(opts, mainWindow, getPort) {
  if (opts.preview_to) return runCampaign(opts, mainWindow, getPort);
  const lock = await teamSync.acquireSendLock(opts.campaign_id, opts.run_key || `manual:${Date.now()}`);
  if (!lock.ok) return { ok: false, error: lock.error, teamLocked: true, retry: !!lock.retry, alreadyDone: !!lock.alreadyDone };
  let result;
  try {
    result = await runCampaign(opts, mainWindow, getPort);
  } finally {
    if (!lock.local) await teamSync.releaseSendLock(opts.campaign_id, result);
  }
  return result;
}

// Automatic runs (schedule, auto-resume) retry when the team repo was unreachable,
// instead of either skipping the send or risking a duplicate.
async function sendWithRetry(opts, mainWindow, getPort, attempt = 0) {
  const result = await sendCampaign(opts, mainWindow, getPort);
  if (result?.retry && attempt < 15) {
    console.log(`[Mailer] Campaign ${opts.campaign_id}: ${result.error} — retrying in 2 min`);
    setTimeout(() => sendWithRetry(opts, mainWindow, getPort, attempt + 1), 2 * 60 * 1000);
  }
  return result;
}

async function runCampaign({ campaign_id, preview_to, start_offset = 0 }, mainWindow, getPort) {
  stopRequested.delete(campaign_id);
  const cfg      = settings.getAll();
  const campaign = db.getCampaign(campaign_id);
  if (!campaign) return { ok: false, error: 'Campaign not found' };

  const fromEmail = campaign.from_email || cfg.from_email;
  const fromName  = campaign.from_name  || cfg.from_name;
  const replyTo   = campaign.reply_to   || cfg.reply_to || fromEmail;

  if (!fromEmail) return { ok: false, error: 'No From Email configured. Check Settings.' };
  if (!cfg.smtp_host) return { ok: false, error: 'SMTP not configured. Check Settings.' };

  // Full subscriber list (needed for total count & A/B split index)
  const allSubscribers = preview_to
    ? [{ id: null, email: preview_to, name: 'Preview', first_name: 'Preview', last_name: '', company: '' }]
    : db.getActiveSubscribersForCampaign(campaign.group_ids);

  if (!allSubscribers.length) return { ok: false, error: 'No active subscribers found for this campaign.' };

  // Working slice — starts from offset when resuming
  const subscribers = preview_to ? allSubscribers : allSubscribers.slice(start_offset);

  const transport   = buildTransport(cfg);
  const total       = allSubscribers.length;
  const batchSize   = cfg.batch_size        || 50;
  const batchDelay  = (cfg.batch_delay      || 60) * 1000;
  const emailDelay  = (cfg.per_email_delay  || 1)  * 1000;
  const dailyLimit  = cfg.daily_send_limit  || 300;

  if (!preview_to) db.updateCampaignProgress(campaign_id, start_offset, total, 'sending');

  let sent = 0, failed = 0;

  const notify = (extra = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('send:progress', {
        sent: start_offset + sent, failed, total, ...extra,
      });
    }
  };

  const pushNotif = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification:new', {});
    }
  };

  // A/B split — index is relative to the full list
  const isAB    = !preview_to && campaign.ab_subject_b && campaign.ab_subject_b.trim();
  const splitAt = isAB ? Math.floor(allSubscribers.length * (campaign.ab_split_pct || 50) / 100) : allSubscribers.length;

  for (let i = 0; i < subscribers.length; i++) {
    if (stopRequested.has(campaign_id)) {
      stopRequested.delete(campaign_id);
      if (!preview_to) db.updateCampaignProgress(campaign_id, start_offset + sent, total, 'stopped');
      notify({ stopped: true });
      transport.close();
      return { ok: true, sent, failed, stopped: true };
    }

    // ── Daily limit check ───────────────────────────────────────────────────
    if (!preview_to && dailyLimit > 0) {
      const todaySent = db.getTodaySentCount();
      if (todaySent >= dailyLimit) {
        const resumeOffset = start_offset + i;
        const resumeAt     = calcNextResumeTime(cfg.daily_resume_time || '09:00');
        const resumeLabel  = (cfg.daily_resume_time || '09:00');
        db.updateCampaignResume(campaign_id, resumeOffset, resumeAt);
        db.updateCampaignProgress(campaign_id, start_offset + sent, total, 'paused');
        db.addNotification(
          'limit_reached',
          'Daily Limit Reached',
          `"${campaign.name}" paused — ${start_offset + sent} of ${total} sent today. Will auto-resume at ${resumeLabel} tomorrow.`,
          campaign_id
        );
        pushNotif();
        notify({ paused: true, resumeAt });
        transport.close();
        stopRequested.delete(campaign_id);
        return { ok: true, sent, failed, paused: true, resumeAt };
      }
    }

    const globalIdx = start_offset + i;   // position in full subscriber list
    const sub       = subscribers[i];
    const unsubUrl  = buildUnsubUrl(sub.email, campaign_id, cfg);
    const msgId     = makeMessageId(fromEmail);

    const rawHtml   = personalize(campaign.html, sub, unsubUrl);
    const htmlBody  = wrapHtml(rawHtml, fromName, unsubUrl);
    const textBody  = personalize(campaign.text || htmlToText(campaign.html), sub, unsubUrl);

    const toDisplay = (sub.name || sub.first_name)
      ? `${(sub.name || `${sub.first_name} ${sub.last_name}`).trim()} <${sub.email}>`
      : sub.email;

    const variant     = isAB && globalIdx >= splitAt ? 'b' : 'a';
    const subjectLine = (isAB && variant === 'b') ? campaign.ab_subject_b : campaign.subject;
    const abTag       = isAB ? `campaign-${campaign_id}-${variant}` : `campaign-${campaign_id}`;

    const attachments = (campaign.attachments || []).map(a => ({
      filename: a.name,
      path:     a.path,
    })).filter(a => fs.existsSync(a.path));

    const mailOptions = {
      messageId: msgId,
      from:      `${fromName} <${fromEmail}>`,
      to:        toDisplay,
      replyTo,
      subject:   personalize(subjectLine, sub, unsubUrl),
      html:      htmlBody,
      text:      textBody,
      attachments,
      headers: {
        'List-Unsubscribe':      `<${unsubUrl}>`,
        'Precedence':            'bulk',
        'X-Mailer':              'MailWave/1.0',
        'X-Entity-Ref-ID':       crypto.randomUUID(),
        'X-Mailin-Tag':          preview_to ? 'mailwave-preview' : abTag,
      },
    };

    let lastError = '';
    try {
      await transport.sendMail(mailOptions);
      sent++;
      if (!preview_to) {
        db.logSend({ campaign_id, subscriber_id: sub.id, email: sub.email, name: sub.name || '', status: 'sent', error: '' });
      }
    } catch (err) {
      failed++;
      lastError = err.message;
      if (!preview_to) {
        db.logSend({ campaign_id, subscriber_id: sub.id, email: sub.email, name: sub.name || '', status: 'failed', error: err.message });
      }
    }

    if (preview_to && failed > 0) {
      transport.close();
      return { ok: false, error: lastError };
    }

    notify();
    if (emailDelay > 0) await sleep(emailDelay);

    // Batch pause — skip after the very last email
    if (!preview_to && (i + 1) % batchSize === 0 && i + 1 < subscribers.length) {
      notify({ batching: true, batchDelay: cfg.batch_delay });
      await sleep(batchDelay);
    }
  }

  if (!preview_to) {
    db.updateCampaignProgress(campaign_id, start_offset + sent, total, 'sent', new Date().toISOString());
    db.updateCampaignResume(campaign_id, 0, null);   // clear resume state
    db.addNotification(
      'campaign_done',
      'Campaign Complete',
      `"${campaign.name}" has finished — ${start_offset + sent} emails sent out of ${total}.`,
      campaign_id
    );
    pushNotif();
  }
  transport.close();
  notify({ done: true });
  stopRequested.delete(campaign_id);
  return { ok: true, sent: start_offset + sent, failed, total };
}

// ── Resume a paused campaign ──────────────────────────────────────────────────
async function resumeCampaign(campaign_id, mainWindow, getPort) {
  const campaign = db.getCampaign(campaign_id);
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (campaign.status !== 'paused') return { ok: false, error: 'Campaign is not paused' };
  return sendCampaign(
    { campaign_id, start_offset: campaign.resume_offset || 0, run_key: `resume:${campaign.resume_at || 'manual'}` },
    mainWindow, getPort
  );
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Stores { timer, send_at, name } per campaign_id
const scheduledJobs = new Map();

function scheduleCampaign({ campaign_id, send_at, run_key }, mainWindow, getPort) {
  const delay = new Date(send_at).getTime() - Date.now();
  if (delay <= 0) return { ok: false, error: 'Scheduled time is in the past' };
  if (scheduledJobs.has(campaign_id)) clearTimeout(scheduledJobs.get(campaign_id).timer);

  const campaign = db.getCampaign(campaign_id);
  const name     = campaign?.name || `Campaign ${campaign_id}`;

  // Persist scheduled_at in DB so the Dashboard can show today's agenda
  db.updateCampaignScheduledAt(campaign_id, send_at);

  const timer = setTimeout(async () => {
    scheduledJobs.delete(campaign_id);
    db.updateCampaignScheduledAt(campaign_id, null);
    await sendWithRetry({ campaign_id, run_key: run_key || `sched:${send_at}` }, mainWindow, getPort);
  }, delay);

  scheduledJobs.set(campaign_id, { timer, send_at, name });
  return { ok: true, send_at };
}

function cancelSchedule(campaign_id) {
  if (!scheduledJobs.has(campaign_id)) return { ok: false, error: 'No scheduled job found' };
  clearTimeout(scheduledJobs.get(campaign_id).timer);
  scheduledJobs.delete(campaign_id);
  db.updateCampaignScheduledAt(campaign_id, null);
  return { ok: true };
}

function listScheduled() {
  return Array.from(scheduledJobs.keys());
}

function listScheduledDetails() {
  return Array.from(scheduledJobs.entries()).map(([id, { send_at, name }]) => ({
    id, send_at, name,
  }));
}

// Align in-memory timers with scheduled_at in the DB — after a teammate
// schedules, reschedules or cancels a campaign and it arrives via Team Sync.
// Every device arms the timer; the send lock decides who actually sends.
function reconcileSchedules(mainWindow, getPort) {
  for (const c of db.listCampaigns()) {
    const job = scheduledJobs.get(c.id);
    const wanted = c.scheduled_at && c.status !== 'sent' && c.status !== 'sending';
    if (!wanted) {
      if (job) { clearTimeout(job.timer); scheduledJobs.delete(c.id); }
      continue;
    }
    if (job && job.send_at === c.scheduled_at) continue;
    if (new Date(c.scheduled_at).getTime() <= Date.now()) {
      if (job) { clearTimeout(job.timer); scheduledJobs.delete(c.id); }
      db.updateCampaignScheduledAt(c.id, null);
      sendWithRetry({ campaign_id: c.id, run_key: `sched:${c.scheduled_at}` }, mainWindow, getPort);
    } else {
      scheduleCampaign({ campaign_id: c.id, send_at: c.scheduled_at }, mainWindow, getPort);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  testConnection, sendCampaign, sendWithRetry, stopSending, reconcileSchedules,
  resumeCampaign, previewMerge,
  scheduleCampaign, cancelSchedule, listScheduled, listScheduledDetails,
};
