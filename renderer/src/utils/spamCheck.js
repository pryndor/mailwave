// Simple rule-based spam score checker
// Returns { score: 0-100, issues: [], warnings: [] }
// Score 0 = clean, 100 = definitely spam

const SPAM_SUBJECT_WORDS = [
  'free', 'winner', 'won', 'prize', 'congratulations', 'urgent', 'act now',
  'limited time', 'click here', 'buy now', 'order now', 'special offer',
  'guarantee', '100%', 'no cost', 'no fee', 'earn money', 'make money',
  'extra income', 'work from home', 'cash', 'cheap', 'discount', 'save big',
  'risk free', 'no risk', 'unsubscribe', 'opt out', 'dear friend',
  'you have been selected', 'you are a winner',
]

const SPAM_BODY_WORDS = [
  'click here', 'buy now', 'order now', 'act now', 'limited time offer',
  'no obligation', 'you have been selected', 'winner', 'congratulations',
  'dear friend', 'once in a lifetime', 'incredible deal',
]

export function checkSpam(subject, html, text) {
  const issues   = []
  const warnings = []
  let score = 0

  const subjectLower = (subject || '').toLowerCase()
  const bodyText = html ? stripHtml(html).toLowerCase() : ''
  const plainText = (text || '').toLowerCase()

  // ── Subject checks ────────────────────────────────────────────────────────
  if (!subject || subject.trim().length === 0) {
    issues.push({ label: 'No subject line', severity: 'error' })
    score += 20
  }

  if (subject && subject.length > 70) {
    warnings.push({ label: `Subject too long (${subject.length} chars — keep under 70)`, severity: 'warn' })
    score += 5
  }

  if (subject && subject === subject.toUpperCase() && subject.length > 5) {
    issues.push({ label: 'Subject is ALL CAPS — major spam trigger', severity: 'error' })
    score += 20
  }

  const capsRatio = (subject || '').replace(/[^A-Z]/g, '').length / Math.max(1, (subject || '').replace(/[^a-zA-Z]/g, '').length)
  if (capsRatio > 0.4 && subject.length > 8) {
    warnings.push({ label: 'Subject has excessive capital letters', severity: 'warn' })
    score += 10
  }

  const exclCount = (subject || '').split('!').length - 1
  if (exclCount > 1) {
    issues.push({ label: `Too many exclamation marks in subject (${exclCount})`, severity: 'error' })
    score += 10
  }

  const subjectSpam = SPAM_SUBJECT_WORDS.filter(w => subjectLower.includes(w))
  if (subjectSpam.length > 0) {
    warnings.push({ label: `Spam words in subject: ${subjectSpam.slice(0,3).join(', ')}`, severity: 'warn' })
    score += subjectSpam.length * 8
  }

  // ── Body checks ───────────────────────────────────────────────────────────
  if (!html || stripHtml(html).trim().length < 20) {
    issues.push({ label: 'Email body is empty or too short', severity: 'error' })
    score += 20
  }

  // Plain text and unsubscribe link are both handled automatically by MailWave at send time:
  // — plain text is auto-generated from HTML if not provided
  // — unsubscribe footer is appended to every email automatically
  // So neither is flagged here.

  // Image to text ratio — too many images, no text = spam
  const imgCount  = (html || '').match(/<img/gi)?.length || 0
  const wordCount = bodyText.trim().split(/\s+/).length
  if (imgCount > 0 && wordCount < 20) {
    warnings.push({ label: 'Too many images, very little text — looks like spam', severity: 'warn' })
    score += 10
  }

  // URL shorteners
  const shorteners = ['bit.ly', 'tinyurl', 'goo.gl', 't.co', 'ow.ly', 'short.io']
  const hasShortener = shorteners.some(s => (html || '').includes(s))
  if (hasShortener) {
    issues.push({ label: 'URL shortener detected — use full URLs instead', severity: 'error' })
    score += 15
  }

  const bodySpam = SPAM_BODY_WORDS.filter(w => bodyText.includes(w))
  if (bodySpam.length > 2) {
    warnings.push({ label: `Spam phrases in body: ${bodySpam.slice(0,3).join(', ')}`, severity: 'warn' })
    score += bodySpam.length * 4
  }

  // ── Positive signals ──────────────────────────────────────────────────────
  if (wordCount > 100) score = Math.max(0, score - 5)  // decent content length

  return {
    score:    Math.min(100, Math.max(0, score)),
    issues,
    warnings,
    wordCount,
    imgCount,
  }
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
