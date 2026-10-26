const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const fs         = require('fs');
const settings   = require('./settings');
const db         = require('./db');
const teamSync   = require('./teamSync');
const { classifySmtpError } = require('./smtpErrors');
const brevo      = require('./brevo');

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
// {{first_name}} prints the subscriber's first name (or their display name),
// {{first_name|there}} prints "there" for a subscriber without one. Custom CSV
// fields work the same by key: {{city|your city}}. A known tag with no value
// and no fallback prints nothing; any other {{...}} goes out as written, which
// the pre-send checklist points out (renderer/src/utils/mergeTags.js).
const TAG_PATTERN  = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*(?:\|([^{}]{0,100}?))?\s*\}\}/gi;
const BUILTIN_TAGS = new Set(['name', 'first_name', 'last_name', 'email', 'company', 'unsubscribe']);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The rich editor stores a fallback as HTML text ("Tom &amp; Jerry"); read it
// back as text first so escaping doesn't double it.
function decodeEntities(str) {
  return String(str)
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function tagValue(key, sub, unsubUrl, hasFallback) {
  const fullName = (sub.name || `${sub.first_name || ''} ${sub.last_name || ''}`).trim();
  switch (key) {
    case 'name':        return fullName || (hasFallback ? '' : sub.email.split('@')[0]);
    case 'first_name':  return sub.first_name || (hasFallback ? '' : fullName || sub.email.split('@')[0]);
    case 'last_name':   return sub.last_name || '';
    case 'email':       return sub.email;
    case 'company':     return sub.company || '';
    case 'unsubscribe': return unsubUrl;
    default: {
      const custom = sub.custom_fields || {};
      return custom[key] != null ? String(custom[key]) : '';
    }
  }
}

// customKeys: every custom field key in the list, so a subscriber without a
// value for one gets its fallback instead of the raw {{tag}}.
function personalize(str, sub, unsubUrl, { isHtml = false, customKeys = [] } = {}) {
  if (!str) return '';
  const custom = new Set([...customKeys, ...Object.keys(sub.custom_fields || {})].map(k => k.toLowerCase()));
  return String(str).replace(TAG_PATTERN, (tag, rawKey, fallback) => {
    const key = rawKey.toLowerCase();
    if (!BUILTIN_TAGS.has(key) && !custom.has(key)) return tag;
    const hasFallback = fallback !== undefined;
    const value = tagValue(key, sub, unsubUrl, hasFallback).trim();
    const out = value || (hasFallback ? decodeEntities(fallback.trim()) : '');
    return isHtml ? escapeHtml(out) : out;
  });
}

// A subject is a header: whatever the values hold, it stays on one line.
function personalizeSubject(str, sub, unsubUrl, opts) {
  return personalize(str, sub, unsubUrl, opts).replace(/[\r\n]+/g, ' ').trim();
}

// ── Merge preview (no send) ───────────────────────────────────────────────────
// Renders subject + body for one subscriber, used by the campaign editor's "Preview Merge" panel.
function previewMerge(campaign, sub) {
  const unsubUrl   = 'https://example.com/unsubscribe';
  const customKeys = db.listCustomFieldKeys();
  return {
    subject:      personalizeSubject(campaign.subject, sub, unsubUrl, { customKeys }),
    preview_text: personalize(campaign.preview_text, sub, unsubUrl, { customKeys }),
    html:         personalize(campaign.html, sub, unsubUrl, { isHtml: true, customKeys }),
  };
}

// ── Deliverability: wrap HTML with proper email structure ─────────────────────
// previewText: the line inboxes show after the subject. Hidden in the body,
// then padded with invisible characters so the body text doesn't follow it.
// postalAddress: CAN-SPAM requires a physical address in every marketing email.
function wrapHtml(innerHtml, fromName, unsubUrl, { previewText = '', postalAddress = '', subject = '' } = {}) {
  const lower    = innerHtml.toLowerCase();
  const hasUnsub = lower.includes('unsubscribe');
  const address  = postalAddress.trim();
  const showAddress = address && !lower.includes(escapeHtml(address.split('\n')[0].trim()).toLowerCase());
  const footerLines = [
    ...(hasUnsub ? [] : [`You received this email from <strong>${escapeHtml(fromName || '')}</strong>.<br>
      <a href="${escapeHtml(unsubUrl)}" style="color:#888;">Unsubscribe</a>`]),
    ...(showAddress ? [escapeHtml(address).replace(/\r?\n/g, '<br>')] : []),
  ];
  const footer = footerLines.length ? `
    <tr><td style="padding:20px;text-align:center;font-size:11px;color:#888;border-top:1px solid #eee;">
      ${footerLines.join('<br><br>')}
    </td></tr>` : '';
  const preheader = previewText.trim() ? `
<div style="display:none;font-size:1px;color:#f4f4f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(previewText.trim())}${'&#847;&zwnj;&nbsp;'.repeat(90)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;">${preheader}
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

// ── SMTP error handling ──────────────────────────────────────────────────────
// classifySmtpError (electron/smtpErrors.js) says what a failure means.
// Waits before retrying the same address after a transient error. After the
// last one fails too, the campaign pauses and resumes by itself later.
const RETRY_DELAYS_MS  = [30 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];
const TRANSIENT_RESUME_MS = 30 * 60 * 1000;
// Safety stops, like hosted platforms' bounce limits: a list that rejects this
// much at send time has a problem worth looking at before it costs the domain.
const BOUNCE_STOP_RATE    = 0.02;
const BOUNCE_STOP_MIN     = 100;     // attempts before the rate counts
const FAILURE_STREAK_STOP = 10;      // failures in a row, of any kind

// ── A/B winner ────────────────────────────────────────────────────────────────
// Compares the two test variants' Brevo stats. Without Brevo stats (no key,
// or the sends didn't go through Brevo) there is nothing to compare, so
// subject A goes out and the reason says why.
async function pickAbWinner(campaign, cfg) {
  const metric = campaign.ab_metric === 'clicks' ? 'clicks' : 'opens';
  if (!cfg.brevo_api_key) return { winner: 'a', reason: 'no Brevo API key to read opens and clicks from, so subject A was kept' };
  const sentHere = db.campaignSentHere(campaign.id);
  const [a, b] = await Promise.all(['a', 'b'].map(v =>
    brevo.getCampaignMetricsFor(cfg.brevo_api_key, campaign, v, sentHere).catch(err => ({ ok: false, error: err.message }))));
  if (!a.ok || !b.ok) return { winner: 'a', reason: `Brevo stats unavailable (${a.error || b.error}), so subject A was kept` };
  if (!a.requests || !b.requests) return { winner: 'a', reason: 'Brevo has no stats for the test sends, so subject A was kept' };
  const rate = (m) => m[metric] / m.requests;
  const ra = rate(a), rb = rate(b);
  const pct = (r) => `${(r * 100).toFixed(1)}%`;
  return { winner: rb > ra ? 'b' : 'a', reason: `${metric === 'clicks' ? 'click' : 'open'} rate A ${pct(ra)} vs B ${pct(rb)}${ra === rb ? ', a tie keeps A' : ''}` };
}

// ── Main send ─────────────────────────────────────────────────────────────────
// With Team Sync on, a real send first claims the campaign's lock in the team
// repo so two teammates' machines never send the same campaign twice.
// run_key names this attempt (see teamSync.acquireSendLock); manual sends get a fresh one.
async function sendCampaign(opts, mainWindow) {
  if (opts.preview_to) return runCampaign(opts, mainWindow);
  const lock = await teamSync.acquireSendLock(opts.campaign_id, opts.run_key || `manual:${Date.now()}`);
  if (!lock.ok) return { ok: false, error: lock.error, teamLocked: true, retry: !!lock.retry, alreadyDone: !!lock.alreadyDone };
  let result;
  try {
    result = await runCampaign(opts, mainWindow);
  } finally {
    if (!lock.local) await teamSync.releaseSendLock(opts.campaign_id, result);
  }
  return result;
}

// Automatic runs (schedule, auto-resume) retry when the team repo was unreachable,
// instead of either skipping the send or risking a duplicate.
async function sendWithRetry(opts, mainWindow, attempt = 0) {
  const result = await sendCampaign(opts, mainWindow);
  if (result?.retry && attempt < 15) {
    console.log(`[Mailer] Campaign ${opts.campaign_id}: ${result.error} — retrying in 2 min`);
    setTimeout(() => sendWithRetry(opts, mainWindow, attempt + 1), 2 * 60 * 1000);
  }
  return result;
}

async function runCampaign({ campaign_id, preview_to, start_offset = 0, resume = false }, mainWindow) {
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

  // Working list. A resume skips everyone this campaign already reached (on
  // any teammate's machine) rather than slicing by position: subscribers who
  // bounced or unsubscribed since the pause would shift positions and make a
  // slice skip people. idx stays the position in the full list for the A/B split.
  const indexed = allSubscribers.map((sub, idx) => ({ sub, idx }));
  let subscribers;
  if (preview_to) subscribers = indexed;
  else if (resume) {
    const reached = db.campaignReachedEmails(campaign_id);
    subscribers = indexed.filter(({ sub }) => !reached.has(sub.email.toLowerCase()));
  } else subscribers = indexed.slice(start_offset);

  let transport     = buildTransport(cfg);
  const customKeys  = db.listCustomFieldKeys();
  const total       = allSubscribers.length;
  const batchSize   = cfg.batch_size        || 50;
  const batchDelay  = (cfg.batch_delay      || 60) * 1000;
  const emailDelay  = (cfg.per_email_delay  || 1)  * 1000;
  const dailyLimit  = cfg.daily_send_limit  || 300;
  // Brevo stats tag: the campaign's shared uid, so every teammate's Metrics
  // looks up the same tag (local ids differ per machine).
  const statsId     = preview_to ? null : db.ensureCampaignUid(campaign_id);

  if (!preview_to) db.updateCampaignProgress(campaign_id, start_offset, total, 'sending');

  let sent = 0, failed = 0, bounced = 0, failStreak = 0;

  // Pauses the campaign where it is. resumeAt: when it goes on by itself
  // (null = only when someone clicks Resume).
  const pause = (i, title, message, resumeAt = null) => {
    db.updateCampaignResume(campaign_id, start_offset + i, resumeAt);
    db.updateCampaignProgress(campaign_id, start_offset + sent, total, 'paused');
    db.addNotification('campaign_paused', title, `"${campaign.name}" paused — ${message}`, campaign_id);
    pushNotif();
    notify({ paused: true, resumeAt, reason: message });
    transport.close();
    stopRequested.delete(campaign_id);
    return { ok: true, sent, failed, bounced, paused: true, resumeAt, reason: message };
  };

  const notify = (extra = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('send:progress', {
        sent: start_offset + sent, failed, bounced, total, ...extra,
      });
    }
  };

  const pushNotif = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification:new', {});
    }
  };

  // A/B split — index is relative to the full list.
  //   split:  subject A to the first ab_split_pct%, B to the rest
  //   winner: the first ab_test_pct% is the test (A and B alternate), then the
  //           send pauses for ab_wait_hours; on resume the subject with the
  //           better Brevo open (or click) rate goes to everyone else.
  const isAB     = !preview_to && campaign.ab_subject_b && campaign.ab_subject_b.trim();
  const splitAt  = isAB ? Math.floor(allSubscribers.length * (campaign.ab_split_pct || 50) / 100) : allSubscribers.length;
  const isWinner = isAB && campaign.ab_mode === 'winner';
  const testSize = isWinner ? Math.min(total, Math.max(2, Math.round(total * campaign.ab_test_pct / 100))) : 0;
  let winner     = isWinner && resume ? campaign.ab_winner : '';
  if (isWinner && !resume) db.setAbWinner(campaign_id, '');
  if (isWinner && !winner && !subscribers.some(({ idx }) => idx < testSize)) {
    const pick = await pickAbWinner(campaign, cfg);
    winner = pick.winner;
    db.setAbWinner(campaign_id, winner);
    const winningSubject = winner === 'b' ? campaign.ab_subject_b : campaign.subject;
    db.addNotification('ab_winner', `A/B Test: Subject ${winner.toUpperCase()} Won`,
      `"${campaign.name}": "${winningSubject}" goes to the remaining ${total - testSize} subscribers (${pick.reason}).`, campaign_id);
    pushNotif();
  }
  const variantFor = (idx) => {
    if (!isAB) return 'a';
    if (!isWinner) return idx >= splitAt ? 'b' : 'a';
    if (idx < testSize) return idx % 2 === 0 ? 'a' : 'b';
    return winner || 'a';
  };

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
      const todaySent = db.getTodaySentCount(!!cfg.daily_limit_team_wide);
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
        notify({ paused: true, resumeAt, reason: `daily limit of ${dailyLimit} reached. Will auto-resume at ${resumeLabel} tomorrow.` });
        transport.close();
        stopRequested.delete(campaign_id);
        return { ok: true, sent, failed, paused: true, resumeAt };
      }
    }

    const { sub, idx: globalIdx } = subscribers[i];   // globalIdx: position in full subscriber list

    // Winner mode: the test is out, wait for opens before sending the rest.
    if (isWinner && !winner && globalIdx >= testSize) {
      const resumeAt = new Date(Date.now() + campaign.ab_wait_hours * 3600 * 1000).toISOString();
      const at = new Date(resumeAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      return pause(i, 'A/B Test Sent',
        `both subjects went to ${testSize} test subscribers. The winner by ${campaign.ab_metric} is picked ${at} and sent to the other ${total - testSize}.`, resumeAt);
    }

    const unsubUrl  = buildUnsubUrl(sub.email, campaign_id, cfg);
    const msgId     = makeMessageId(fromEmail);

    const variant     = variantFor(globalIdx);
    const subjectLine = (isAB && variant === 'b') ? campaign.ab_subject_b : campaign.subject;
    const abTag       = isAB ? `campaign-${statsId}-${variant}` : `campaign-${statsId}`;
    const subject     = personalizeSubject(subjectLine, sub, unsubUrl, { customKeys });

    const rawHtml   = personalize(campaign.html, sub, unsubUrl, { isHtml: true, customKeys });
    const htmlBody  = wrapHtml(rawHtml, fromName, unsubUrl, {
      subject,
      previewText:   personalize(campaign.preview_text, sub, unsubUrl, { customKeys }),
      postalAddress: cfg.postal_address || '',
    });
    let textBody = personalize(campaign.text || htmlToText(campaign.html), sub, unsubUrl, { customKeys });
    if (cfg.postal_address?.trim() && !textBody.includes(cfg.postal_address.trim().split('\n')[0])) {
      textBody += `\n\n--\n${cfg.postal_address.trim()}`;
    }

    const toDisplay = (sub.name || sub.first_name)
      ? `${(sub.name || `${sub.first_name} ${sub.last_name}`).trim()} <${sub.email}>`
      : sub.email;

    const attachments = (campaign.attachments || []).map(a => ({
      filename: a.name,
      path:     a.path,
    })).filter(a => fs.existsSync(a.path));

    const mailOptions = {
      messageId: msgId,
      from:      `${fromName} <${fromEmail}>`,
      to:        toDisplay,
      replyTo,
      subject,
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

    // Send, retrying the same address after transient errors (dropped
    // connection, "try again later") with growing waits.
    let error = null, kind = null;
    for (let attempt = 0; ; attempt++) {
      try {
        await transport.sendMail(mailOptions);
        error = null;
        break;
      } catch (err) {
        error = err;
        kind  = classifySmtpError(err);
        if (preview_to || kind !== 'transient' || attempt >= RETRY_DELAYS_MS.length) break;
        if (stopRequested.has(campaign_id)) break;
        const wait = RETRY_DELAYS_MS[attempt];
        console.log(`[Mailer] Campaign ${campaign_id}: ${err.message} — retrying ${sub.email} in ${wait / 1000}s`);
        notify({ retrying: true, retryIn: wait / 1000, error: err.message });
        // A dropped connection can leave the pool unusable; start a fresh one.
        transport.close();
        await sleep(wait);
        transport = buildTransport(cfg);
      }
    }

    if (preview_to) {
      transport.close();
      if (error) return { ok: false, error: error.message };
      db.markTestSent(campaign_id);
      notify({ done: true });
      return { ok: true, sent: 1, failed: 0, total: 1 };
    }

    const logRow = (status, msg = '') =>
      db.logSend({ campaign_id, subscriber_id: sub.id, email: sub.email, name: sub.name || '', status, error: msg });

    if (!error) {
      sent++;
      failStreak = 0;
      logRow('sent');
    } else if (kind === 'bounce') {
      // The address doesn't exist: never email it again.
      bounced++;
      failStreak = 0;
      logRow('bounced', error.message);
      db.markSubscriberBounced(sub.id);
    } else if (kind === 'failed' || kind === 'mailbox_full') {
      failed++;
      failStreak++;
      logRow('failed', error.message);
    } else {
      // Nothing about this address: the account or connection can't send
      // right now, so this one isn't logged and goes out on resume.
      // Stop clicked during a retry wait: redo this index so the stop check
      // at the top of the loop ends the send as stopped, not paused.
      if (stopRequested.has(campaign_id)) { i--; continue; }
      const reason = error.message.slice(0, 300);
      if (kind === 'quota') {
        const resumeAt = calcNextResumeTime(cfg.daily_resume_time || '09:00');
        return pause(i, 'Provider Sending Limit Reached',
          `your SMTP provider says the sending limit is reached (${reason}). Will auto-resume at ${cfg.daily_resume_time || '09:00'} tomorrow.`, resumeAt);
      }
      if (kind === 'transient') {
        const resumeAt = new Date(Date.now() + TRANSIENT_RESUME_MS).toISOString();
        return pause(i, 'Campaign Paused — Server Unavailable',
          `the SMTP server kept failing (${reason}). Will retry automatically in 30 minutes.`, resumeAt);
      }
      if (kind === 'auth') {
        return pause(i, 'Campaign Paused — SMTP Login Failed',
          `the SMTP server rejected the login (${reason}). Check Settings, then click Resume.`);
      }
      return pause(i, 'Campaign Paused — Provider Rejected Sending',
        `your SMTP provider refused to send (${reason}). Check your account with the provider before resuming.`);
    }

    // Safety stops: a burst of failures or a high bounce rate.
    if (failStreak >= FAILURE_STREAK_STOP) {
      return pause(i + 1, 'Campaign Paused — Repeated Failures',
        `${failStreak} emails in a row failed (last error: ${error.message.slice(0, 200)}). Check History, then click Resume.`);
    }
    const attempts = sent + failed + bounced;
    if (attempts >= BOUNCE_STOP_MIN && bounced / attempts > BOUNCE_STOP_RATE) {
      return pause(i + 1, 'Campaign Paused — High Bounce Rate',
        `${bounced} of ${attempts} addresses (${(bounced / attempts * 100).toFixed(1)}%) don't exist. Sending on would hurt your sender reputation; clean the list, then click Resume.`);
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
      `"${campaign.name}" has finished — ${start_offset + sent} emails sent out of ${total}${bounced ? `, ${bounced} bounced (marked as bounced)` : ''}.`,
      campaign_id
    );
    pushNotif();
  }
  transport.close();
  notify({ done: true });
  stopRequested.delete(campaign_id);
  return { ok: true, sent: start_offset + sent, failed, bounced, total };
}

// ── Resume a paused campaign ──────────────────────────────────────────────────
async function resumeCampaign(campaign_id, mainWindow) {
  const campaign = db.getCampaign(campaign_id);
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (campaign.status !== 'paused') return { ok: false, error: 'Campaign is not paused' };
  return sendCampaign(
    { campaign_id, start_offset: campaign.resume_offset || 0, resume: true, run_key: `resume:${campaign.resume_at || 'manual'}` },
    mainWindow
  );
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Stores { timer, send_at, name } per campaign_id
const scheduledJobs = new Map();

function scheduleCampaign({ campaign_id, send_at, run_key }, mainWindow) {
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
    await sendWithRetry({ campaign_id, run_key: run_key || `sched:${send_at}` }, mainWindow);
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

function listScheduledDetails() {
  return Array.from(scheduledJobs.entries()).map(([id, { send_at, name }]) => ({
    id, send_at, name,
  }));
}

// Align in-memory timers with scheduled_at in the DB — after a teammate
// schedules, reschedules or cancels a campaign and it arrives via Team Sync.
// Every device arms the timer; the send lock decides who actually sends.
function reconcileSchedules(mainWindow) {
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
      sendWithRetry({ campaign_id: c.id, run_key: `sched:${c.scheduled_at}` }, mainWindow);
    } else {
      scheduleCampaign({ campaign_id: c.id, send_at: c.scheduled_at }, mainWindow);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  testConnection, sendCampaign, stopSending, reconcileSchedules,
  resumeCampaign, previewMerge,
  scheduleCampaign, cancelSchedule, listScheduledDetails,
};
