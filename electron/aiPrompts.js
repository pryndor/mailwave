// All AI system prompts and output schemas in one place. Bump PROMPT_VERSION
// when a prompt changes meaningfully, so ai_log rows can be compared over time.
const PROMPT_VERSION = 1;

const BUILTIN_TAGS = ['name', 'first_name', 'last_name', 'email', 'company', 'unsubscribe'];

const TONES = {
  friendly: 'warm, plain-spoken and approachable',
  formal:   'professional and courteous, no slang',
  clinical: 'precise and evidence-focused, like a note from a healthcare professional',
  playful:  'light and upbeat, with a little humour where it fits',
};

function brandVoice(cfg) {
  const lines = [];
  if (cfg.ai_brand_about?.trim())   lines.push(`About the sender: ${cfg.ai_brand_about.trim()}`);
  lines.push(`Tone: ${TONES[cfg.ai_brand_tone] || cfg.ai_brand_tone || TONES.friendly}.`);
  if (cfg.ai_brand_avoid?.trim())   lines.push(`Words and phrases to avoid: ${cfg.ai_brand_avoid.trim()}`);
  if (cfg.ai_brand_signoff?.trim()) lines.push(`Sign off emails as: ${cfg.ai_brand_signoff.trim()}`);
  return lines.join('\n');
}

// What the app does with the HTML afterwards, so the model writes to fit it.
function emailRules(customFields = []) {
  const tags = [...BUILTIN_TAGS, ...customFields].map(t => `{{${t}}}`).join(', ');
  return `How MailWave emails work:
- The body is edited in a simple rich-text editor that keeps only these HTML tags: <p>, <h1>-<h3>, <strong>, <em>, <u>, <a href>, <ul>, <ol>, <li>, <br>, <code>. Use only those. No tables, images, inline styles, <html>/<body> wrappers or CSS.
- Personalisation uses merge tags replaced per recipient at send time. Available tags: ${tags}. Use only these, spelled exactly; never invent new ones. Use {{first_name}} for greetings.
- MailWave adds the unsubscribe footer automatically, so don't write one.
- The plain-text version is shown by mail clients that can't render HTML: same content, no markup, links written out as "text (url)".
- Never invent facts, prices, dates, statistics or links. Where a specific detail is needed and wasn't given, write a clear placeholder in square brackets, like [event date] or [link], so the sender can spot it.`;
}

function writerSystem(cfg, customFields) {
  return `You write marketing and newsletter emails for small businesses using MailWave, a desktop bulk-email app. Emails should read like they were written by a thoughtful person at the company: clear, specific, and easy to scan, with one obvious call to action.

${brandVoice(cfg)}

${emailRules(customFields)}`;
}

function reviewerSystem(customFields) {
  return `You review email campaigns for a desktop bulk-email app before they are sent. Your review is advisory: the sender decides what to change. Be concrete and brief: point at the exact words or link, and say how to fix it. Don't pad the list; an email with no real problems should get few or no issues.

Look for:
- Spam and deliverability risks: spammy phrasing, ALL CAPS, excessive punctuation or exclamation marks, many links, link shorteners, very short body with a big CTA, missing sender context.
- Mistakes: typos, grammar, broken or placeholder links (example.com, "#", TODO, lorem ipsum, [square bracket placeholders]), inconsistent dates or weekdays, merge tags that look wrong.
- Clarity: is the purpose clear in the first lines, is there one clear call to action.
- Compliance basics (CAN-SPAM / GDPR): misleading subject lines, no way to identify the sender. The unsubscribe link is added automatically, so don't flag it as missing. If the email makes health, medical or drug claims, flag claims that look unsupported, overstated or missing a reasonable disclaimer.
- Accessibility: vague link text such as "click here", walls of text.
- The subject line: length (under about 60 characters is safest), clarity, curiosity, and whether it matches the body.

${emailRules(customFields)}`;
}

// ── Output schemas (structured outputs) ───────────────────────────────────────
const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Subject line' },
    html:    { type: 'string', description: 'Email body as HTML using only the allowed tags' },
    text:    { type: 'string', description: 'Plain-text version of the same body' },
    notes:   { type: 'string', description: 'One or two sentences for the sender: placeholders to fill in or assumptions made. Empty if none.' },
  },
  required: ['subject', 'html', 'text', 'notes'],
  additionalProperties: false,
};

const SUBJECTS_SCHEMA = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          reason:  { type: 'string', description: 'Why this might work, in under 15 words' },
        },
        required: ['subject', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['options'],
  additionalProperties: false,
};

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string', description: 'The rewritten text only' } },
  required: ['text'],
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score:         { type: 'integer', description: 'Overall readiness 0-100' },
    subject_score: { type: 'integer', description: 'Subject line quality 0-100' },
    spam_risk:     { type: 'string', enum: ['low', 'medium', 'high'] },
    readability:   { type: 'string', description: 'Reading level in a few words, e.g. "Easy (grade 7)"' },
    summary:       { type: 'string', description: 'Two sentences at most: overall verdict' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity:   { type: 'string', enum: ['critical', 'warning', 'info'] },
          category:   { type: 'string', enum: ['spam', 'deliverability', 'mistake', 'clarity', 'compliance', 'accessibility', 'tone', 'subject'] },
          message:    { type: 'string', description: 'What is wrong, quoting the exact text where useful' },
          suggestion: { type: 'string', description: 'How to fix it' },
        },
        required: ['severity', 'category', 'message', 'suggestion'],
        additionalProperties: false,
      },
    },
    better_subjects: { type: 'array', items: { type: 'string' }, description: 'Up to 3 improved subject lines' },
  },
  required: ['score', 'subject_score', 'spam_risk', 'readability', 'summary', 'issues', 'better_subjects'],
  additionalProperties: false,
};

const REWRITE_ACTIONS = {
  shorter:    'Make it shorter and tighter. Keep the meaning.',
  longer:     'Expand it a little with useful detail. Do not invent facts.',
  friendlier: 'Make it warmer and friendlier.',
  formal:     'Make it more formal and professional.',
  grammar:    'Fix spelling, grammar and punctuation only. Change nothing else.',
  simplify:   'Simplify it so it is easy to read: short sentences, plain words.',
  persuasive: 'Make it more persuasive, with a clearer benefit for the reader. Do not exaggerate.',
};

module.exports = {
  PROMPT_VERSION, BUILTIN_TAGS, TONES, REWRITE_ACTIONS,
  writerSystem, reviewerSystem,
  EMAIL_SCHEMA, SUBJECTS_SCHEMA, REWRITE_SCHEMA, REVIEW_SCHEMA,
};
