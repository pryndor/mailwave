// Mirrors electron/mailer.js personalize(): {{key}} or {{key|fallback}}, where
// key is a built-in field or a custom CSV column. Anything else in {{...}} is
// sent exactly as written, so the pre-send checklist points it out.
const TAG_PATTERN   = /^\{\{\s*([a-z][a-z0-9_]{0,39})\s*(?:\|([^{}]{0,100}?))?\s*\}\}$/i
const ANY_TAG       = /\{\{[^{}]{0,200}\}\}/g
const ANY_TAG_FILL  = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*(?:\|([^{}]{0,100}?))?\s*\}\}/gi
export const BUILTIN_TAGS = ['name', 'first_name', 'last_name', 'email', 'company', 'unsubscribe']

// {{...}} in any of the values that won't be filled in: another platform's tag
// (*|FNAME|*-style tags aren't caught), a typo, or a tag the editor split with
// formatting, like {{<b>name</b>}}.
export function findBrokenMergeTags(values, customKeys = []) {
  const known = new Set([...BUILTIN_TAGS, ...customKeys.map(k => k.toLowerCase())])
  const broken = new Set()
  for (const value of values) {
    for (const [token] of String(value ?? '').matchAll(ANY_TAG)) {
      const match = TAG_PATTERN.exec(token)
      if (!match || !known.has(match[1].toLowerCase())) broken.add(token)
    }
  }
  return [...broken]
}

// What a subscriber with no name or field values sees: each tag's fallback, or
// a short stand-in. Used to measure the subject the way inboxes show it.
export function withSampleValues(value) {
  return String(value ?? '').replace(ANY_TAG_FILL, (_, key, fallback) => fallback?.trim() || (key.toLowerCase() === 'email' ? 'jane@example.com' : 'Jane'))
}

// Gmail clips a message whose HTML is over 102 KB and hides the rest (with the
// unsubscribe footer) behind "View entire message".
export const GMAIL_CLIP_BYTES = 102 * 1024

// Approximate size of the email MailWave sends: the body plus its wrapper,
// footer and preheader (about 3 KB).
export function estimateEmailBytes(html) {
  return new Blob([String(html ?? '')]).size + 3 * 1024
}
