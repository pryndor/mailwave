// What a failed SMTP send means. Used by the mailer to decide how the rest of
// the send goes on, and by History to group a campaign's failures into causes.
//   bounce       — the address doesn't exist: mark the subscriber bounced, go on
//   mailbox_full — the recipient's mailbox is full: skip them this time, go on
//   quota        — the provider's sending limit: pause until the daily resume time
//   blocked      — the provider flagged the account (spam, policy): pause until someone looks
//   auth         — the SMTP login stopped working: pause until someone looks
//   transient    — connection dropped or "try again later": wait and retry the same address
//   failed       — anything else about this one message: log it, go on
//
// Mailbox full is checked before quota: "over quota" from the recipient's
// server is about their storage, not the sender's limit.
const MAILBOX_FULL_PATTERN = /mailbox (?:is )?full|over ?quota|quota exceeded for (?:the )?(?:mailbox|recipient|user)|insufficient (?:system )?storage|5\.2\.2/i;
const QUOTA_PATTERN   = /quota|limit (?:exceeded|reached)|exceeded|too many (?:messages|emails|recipients)|sending rate|rate limit|daily (?:sending )?limit|5\.4\.5/i;
const BLOCKED_PATTERN = /unusual sending|suspicious|account (?:has been )?(?:blocked|suspended|disabled|locked)|sender (?:address )?(?:blocked|rejected)|spam|5\.7\.1 .*(?:policy|abuse)|relay access denied|not authori[sz]ed to send/i;
const BOUNCE_PATTERN  = /user unknown|unknown user|no such user|does not exist|doesn't exist|mailbox (?:unavailable|not found)|invalid (?:recipient|mailbox|address)|recipient (?:address )?rejected|address rejected|undeliverable|no mailbox|5\.1\.[0-6]/i;
const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH']);
const TRANSIENT_TEXT  = /ECONNECTION|ETIMEDOUT|ESOCKET|ECONNRESET|ECONNREFUSED|timed? ?out|connection (?:closed|lost|refused)|try again later/i;

// err: a nodemailer error, or { message } alone for an error read back from
// send_history (no code or response code; the SMTP reply is in the message).
function classifySmtpError(err) {
  const code     = err?.code || '';
  const text     = `${err?.response || ''} ${err?.message || ''}`;
  const response = Number(err?.responseCode) || Number((/^\s*([45]\d\d)\b/.exec(err?.response || err?.message || '') || [])[1]) || 0;
  if (code === 'EAUTH' || response === 535 || response === 534 || /authentication (?:failed|unsuccessful)|invalid login|535 /i.test(text)) return 'auth';
  if (MAILBOX_FULL_PATTERN.test(text)) return 'mailbox_full';
  if (QUOTA_PATTERN.test(text)) return 'quota';
  if (BLOCKED_PATTERN.test(text)) return 'blocked';
  if (TRANSIENT_CODES.has(code) || response === 421 || (response >= 400 && response < 500) || (!response && TRANSIENT_TEXT.test(text))) return 'transient';
  if (BOUNCE_PATTERN.test(text) || ([550, 551, 553].includes(response) && code === 'EENVELOPE')) return 'bounce';
  return 'failed';
}

// For History: what each cause means and what to do about it.
const CAUSES = {
  bounce:       { label: "Address doesn't exist",      fix: 'These subscribers were marked bounced and won\'t be emailed again. Turn on "Clean the list" when importing to catch more before sending.' },
  mailbox_full: { label: 'Recipient mailbox full',      fix: 'Nothing to change on your side. They stay active and will get your next campaign.' },
  quota:        { label: 'Your provider\'s sending limit', fix: 'Lower the daily limit in Settings → Sending to stay under your provider\'s quota, or ask the provider for a higher one.' },
  blocked:      { label: 'Provider refused to send',    fix: 'Your SMTP provider flagged the account. Log in to the provider and check for warnings before sending more.' },
  auth:         { label: 'SMTP login failed',           fix: 'Check the SMTP user and password in Settings, then test the connection. Some providers need an app password.' },
  transient:    { label: 'Server busy or unreachable',  fix: 'Usually temporary. Resume the campaign later; if it keeps happening, increase the delay between emails in Settings.' },
  failed:       { label: 'Other errors',                fix: 'Read the example error below. Content rejections usually mean a link, attachment or wording the server didn\'t accept.' },
};

// rows: [{ error, count }] → causes, largest first, each with one example error.
function groupFailures(rows) {
  const groups = new Map();
  for (const { error, count } of rows) {
    const kind = classifySmtpError({ message: error || '' });
    const g = groups.get(kind) || { kind, ...CAUSES[kind], count: 0, example: error || '' };
    g.count += count;
    groups.set(kind, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

module.exports = { classifySmtpError, groupFailures };
