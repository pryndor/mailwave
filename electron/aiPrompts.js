// All AI system prompts and output schemas in one place.

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
- Personalisation uses merge tags replaced per recipient at send time. Available tags: ${tags}. Use only these, spelled exactly; never invent new ones. A tag can carry a fallback for subscribers without that field, written {{first_name|there}}; use one in greetings, e.g. "Hi {{first_name|there}},".
- The preview text (preheader) is the line inboxes show after the subject. It should add to the subject, not repeat it, in about 40-110 characters.
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
    subject:      { type: 'string', description: 'Subject line' },
    preview_text: { type: 'string', description: 'Preview text (preheader) shown after the subject in the inbox' },
    html:         { type: 'string', description: 'Email body as HTML using only the allowed tags' },
    text:         { type: 'string', description: 'Plain-text version of the same body' },
    notes:        { type: 'string', description: 'One or two sentences for the sender: placeholders to fill in or assumptions made. Empty if none.' },
  },
  required: ['subject', 'preview_text', 'html', 'text', 'notes'],
  additionalProperties: false,
};

const PREVIEW_TEXT_SCHEMA = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:   { type: 'string', description: 'Preview text, 40-110 characters' },
          reason: { type: 'string', description: 'Why it works with the subject, in under 15 words' },
        },
        required: ['text', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['options'],
  additionalProperties: false,
};

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    subject:      { type: 'string' },
    ab_subject_b: { type: 'string', description: 'Translated alternative subject, or empty if none was given' },
    preview_text: { type: 'string', description: 'Translated preview text, or empty if none was given' },
    html:         { type: 'string', description: 'Translated HTML body with the same tags, attributes and links' },
    text:         { type: 'string', description: 'Translated plain-text version, or empty if none was given' },
    notes:        { type: 'string', description: 'Anything the sender should check, such as terms left untranslated. Empty if none.' },
  },
  required: ['subject', 'ab_subject_b', 'preview_text', 'html', 'text', 'notes'],
  additionalProperties: false,
};

const SEQUENCE_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: 'Two sentences at most: how the series builds from email to email' },
    emails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day:          { type: 'integer', description: 'Days after the first email that this one goes out (0 for the first)' },
          purpose:      { type: 'string', description: 'What this email does in the series, under 12 words' },
          subject:      { type: 'string' },
          preview_text: { type: 'string' },
          html:         { type: 'string', description: 'Body as HTML using only the allowed tags' },
          text:         { type: 'string', description: 'Plain-text version of the body' },
        },
        required: ['day', 'purpose', 'subject', 'preview_text', 'html', 'text'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Placeholders to fill in or assumptions made. Empty if none.' },
  },
  required: ['plan', 'emails', 'notes'],
  additionalProperties: false,
};

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    headline:   { type: 'string', description: 'One sentence verdict on how the campaign did' },
    went_well:  { type: 'array', items: { type: 'string' }, description: 'Up to 3 points, each tied to a number from the data' },
    went_badly: { type: 'array', items: { type: 'string' }, description: 'Up to 3 points, each tied to a number from the data' },
    likely_causes: { type: 'array', items: { type: 'string' }, description: 'Up to 3 likely reasons for weak results, linked to subject, timing, length, audience or list quality. Empty if results were good.' },
    next_steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'A concrete thing to do in MailWave' },
          why:    { type: 'string', description: 'The number or finding behind it' },
        },
        required: ['action', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'went_well', 'went_badly', 'likely_causes', 'next_steps'],
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
  cta:        'Turn it into a short call to action for a button or link: 2 to 6 words, starting with a verb, saying what the reader gets (e.g. "Book your free slot"). No "click here".',
};

const FILTER_SCHEMA = {
  type: 'object',
  properties: {
    explanation:   { type: 'string', description: 'The filter in plain words, e.g. "Active subscribers in the Doctors group with city Chennai"' },
    status:        { type: 'string', enum: ['any', 'active', 'unsubscribed', 'bounced'] },
    groups:        { type: 'array', items: { type: 'string' }, description: 'Exact group names from the list given' },
    groups_mode:   { type: 'string', enum: ['any', 'none'], description: 'any = in at least one of the groups, none = in none of them' },
    email_domains: { type: 'array', items: { type: 'string' }, description: 'e.g. ["gmail.com"]' },
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'A field name from the list given' },
          op:    { type: 'string', enum: ['equals', 'contains', 'starts_with', 'empty', 'not_empty'] },
          value: { type: 'string', description: 'Empty for empty / not_empty' },
        },
        required: ['field', 'op', 'value'],
        additionalProperties: false,
      },
    },
    added_after:  { type: 'string', description: 'YYYY-MM-DD, or empty' },
    added_before: { type: 'string', description: 'YYYY-MM-DD, or empty' },
    emailed: {
      type: 'object',
      properties: {
        mode:     { type: 'string', enum: ['none', 'never', 'ever', 'campaign', 'not_campaign', 'within_days', 'not_within_days'] },
        campaign: { type: 'string', description: 'Campaign name from the list, for campaign / not_campaign' },
        days:     { type: 'integer', description: 'For within_days / not_within_days' },
      },
      required: ['mode', 'campaign', 'days'],
      additionalProperties: false,
    },
    unsupported: { type: 'string', description: 'Parts of the request this filter cannot express (e.g. opens or clicks), or empty' },
  },
  required: ['explanation', 'status', 'groups', 'groups_mode', 'email_domains', 'conditions', 'added_after', 'added_before', 'emailed', 'unsupported'],
  additionalProperties: false,
};

const IMPORT_TARGETS = ['email', 'name', 'first_name', 'last_name', 'phone', 'company', 'status', 'custom', 'skip'];

const COLUMN_MAP_SCHEMA = {
  type: 'object',
  properties: {
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          header: { type: 'string', description: 'The header exactly as given' },
          target: { type: 'string', enum: IMPORT_TARGETS },
        },
        required: ['header', 'target'],
        additionalProperties: false,
      },
    },
  },
  required: ['columns'],
  additionalProperties: false,
};

const CONTINUE_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string', description: 'Only the new text that continues the email' } },
  required: ['text'],
  additionalProperties: false,
};

// Social posts: one draft adapted to each platform's norms.
const SOCIAL_PLATFORM_GUIDE = {
  linkedin:  'LinkedIn (max 3000 characters): professional but human. Strong first line (only ~200 characters show before "see more"), short paragraphs with blank lines between them, a clear takeaway or question at the end, 3-5 relevant hashtags at the very end. No emoji walls.',
  facebook:  'Facebook Page (keep under 500 characters): conversational and friendly, a question or clear call to action, 0-2 hashtags.',
  instagram: 'Instagram caption (max 2200 characters): hook in the first line, short lines, a call to action (links in captions are not clickable, so say "link in bio" if a link matters), up to 10 relevant hashtags at the end.',
  x:         'X/Twitter (max 280 characters including any link, which counts as 23): punchy, one idea, 0-2 hashtags.',
  bluesky:   'Bluesky (max 300 characters): casual and direct, no hashtag stuffing.',
  threads:   'Threads (max 500 characters): conversational, like talking to followers, 0-1 hashtag.',
  mastodon:  'Mastodon (max 500 characters): plain and genuine, hashtags in CamelCase for accessibility.',
};

function socialSystem(cfg) {
  return `You write social media posts for small businesses using MailWave to promote their business, events and activities. Posts read like a real person at the company wrote them: specific, useful, never hypey or spammy.

${brandVoice(cfg)}

Rules:
- Plain text only: no HTML or Markdown (no **bold**, no # headings). Line breaks are fine.
- Never invent facts, prices, dates, statistics, names or links. Where a needed detail wasn't given, write a clear placeholder in square brackets, like [event date] or [link].
- Respect each platform's character limit strictly.`;
}

const SOCIAL_SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          text:     { type: 'string', description: 'The finished post text for this platform' },
        },
        required: ['platform', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
  additionalProperties: false,
};

function analystSystem() {
  return `You analyse the results of email campaigns sent with MailWave, a desktop bulk-email app that sends through the user's own SMTP account. Write for a small-business owner, not a marketer: plain words, short sentences, numbers from the data.

Rules:
- Only use the numbers given. Never invent rates, benchmarks or causes you can't tie to the data; say "not enough data" when that's the honest answer.
- Opens and clicks exist only when Brevo stats are given. Without them, judge delivery (sent, bounced, failed) and the content alone, and suggest connecting Brevo for open and click data.
- Compare with the sender's own past campaigns when they are given, not with industry averages.
- Next steps must be things the user can do in MailWave: resend with a new subject to a group, clean the list on import, change the send time or Smart Schedule, lower the daily limit, edit the subject or preview text, shorten the email, write a follow-up.`;
}

module.exports = {
  BUILTIN_TAGS, TONES, REWRITE_ACTIONS,
  writerSystem, reviewerSystem, analystSystem,
  EMAIL_SCHEMA, SUBJECTS_SCHEMA, REWRITE_SCHEMA, REVIEW_SCHEMA,
  PREVIEW_TEXT_SCHEMA, TRANSLATION_SCHEMA, SEQUENCE_SCHEMA, REPORT_SCHEMA,
  FILTER_SCHEMA, COLUMN_MAP_SCHEMA, CONTINUE_SCHEMA, IMPORT_TARGETS,
  socialSystem, SOCIAL_SCHEMA, SOCIAL_PLATFORM_GUIDE,
};
