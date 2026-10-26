// CSV import: which column holds what. Rules recognise the usual headers from
// Mailchimp, beehiiv, Substack, Kit, Google Forms and the like; anything else
// becomes a custom merge field unless the user (or AI) says otherwise.
export const IMPORT_TARGETS = [
  { id: 'email',      label: 'Email' },
  { id: 'name',       label: 'Full name' },
  { id: 'first_name', label: 'First name' },
  { id: 'last_name',  label: 'Last name' },
  { id: 'phone',      label: 'Phone' },
  { id: 'company',    label: 'Company' },
  { id: 'status',     label: 'Status (unsubscribed/bounced)' },
  { id: 'custom',     label: 'Custom field (merge tag)' },
  { id: 'skip',       label: "Don't import" },
]

const norm = (h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const RULES = [
  ['email',      /^(e ?mail|email address|e mail address|your email|mail|subscriber email|email id)$/],
  ['first_name', /^(first ?name|firstname|given name|fname|forename)$/],
  ['last_name',  /^(last ?name|lastname|surname|family name|lname)$/],
  ['name',       /^(name|full ?name|your (full )?name|contact name|display name)$/],
  ['phone',      /^(phone|phone number|mobile|mobile number|cell|whatsapp|contact number|tel|telephone)$/],
  ['company',    /^(company|company name|organi[sz]ation|organi[sz]ation name|business|employer|your qualification)$/],
  ['status',     /^(status|subscription status|subscriber status|member status|state)$/],
  ['skip',       /^(id|uuid|subscriber id|member id|contact id|euid|leid|web id|ip|ip address|optin ip|confirm ip|user agent|unsubscribe url|row)$/],
]

// header → target, by the rules. Only the first column of each kind is taken
// as email/name/first/last; later look-alikes stay custom fields.
export function autoMapColumns(headers) {
  const used = new Set()
  const mapping = {}
  for (const h of headers) {
    const n = norm(h)
    const rule = RULES.find(([, re]) => re.test(n))
    let target = rule ? rule[0] : 'custom'
    if (['email', 'name', 'first_name', 'last_name', 'status'].includes(target)) {
      if (used.has(target)) target = 'custom'
      else used.add(target)
    }
    mapping[h] = target
  }
  // No header said "email": take the first column whose values are addresses.
  return mapping
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s().-]{7,}$/
const DATE_RE  = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/

// What a column's values look like, without the values themselves: what the
// AI mapper gets, so no subscriber data leaves the machine.
export function describeShape(values) {
  const v = values.map(x => String(x ?? '').trim()).filter(Boolean)
  if (!v.length) return 'empty'
  const share = (re) => v.filter(x => re.test(x)).length / v.length
  if (share(EMAIL_RE) > 0.8) return 'email addresses'
  if (share(DATE_RE) > 0.8) return 'dates'
  if (share(/^-?\d+(\.\d+)?$/) > 0.8) return v.some(x => x.length >= 8) ? 'long numbers (IDs or phone numbers)' : 'numbers'
  if (share(PHONE_RE) > 0.8) return 'phone numbers'
  const distinct = new Set(v.map(x => x.toLowerCase()))
  if (distinct.size <= 5 && v.length >= 5) return `one of a few repeated words (${distinct.size} distinct values)`
  const words = v.reduce((n, x) => n + x.split(/\s+/).length, 0) / v.length
  if (words <= 1.2) return 'single words'
  if (words <= 3.5) return 'a few words each (like names, places or titles)'
  return 'longer text'
}

// Email column found by its values when no header says so.
export function findEmailByValues(rows, headers, mapping) {
  if (Object.values(mapping).includes('email')) return mapping
  const sample = rows.slice(0, 50)
  const h = headers.find(h => describeShape(sample.map(r => r[h])) === 'email addresses')
  return h ? { ...mapping, [h]: 'email' } : mapping
}

// Rows renamed to what db.importSubscribers reads: fixed fields by their
// name, custom fields under their own header, skipped columns dropped.
export function applyMapping(rows, mapping) {
  return rows.map(row => {
    const out = {}
    for (const [h, target] of Object.entries(mapping)) {
      const val = row[h]
      if (target === 'skip' || val === undefined) continue
      if (target === 'custom') {
        // A custom column whose header is a fixed field's name (say a second
        // "Name") would be read as that field; keep it apart.
        const key = RULES.some(([t, re]) => t !== 'skip' && re.test(norm(h))) ? `${h} (extra)` : h
        out[key] = val
      } else if (out[target] === undefined || out[target] === '') {
        out[target] = val
      }
    }
    return out
  })
}
