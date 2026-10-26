// Contact cleaning for imports and manual adds, adapted from MailCheap
// (github.com/marclou/mailcheap, AGPL-3.0, lib/import-checks.js,
// lib/email-typos.js, lib/disposable-domains.js, lib/validation.js).
// Addresses that bounce, catch typos or never belong to a person hurt the
// sending account's reputation, so they're left out before they're stored.
const dns = require('dns').promises;

const DROP_REASONS = {
  invalid:     'invalid address',
  typo:        'misspelled domain (gmial.com…)',
  trap:        'spam trap address',
  role:        'role address (info@, support@…)',
  disposable:  'throwaway inbox',
  duplicate:   'duplicate in the file',
  noMail:      "domain can't receive email",
};

// Dot-atom local part and hostname labels: rejects quoted strings, commas,
// display names and doubled dots. Domain endings are letters, or xn--.
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?)$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || email.indexOf('@') > 64) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

// Common misspellings of the big mailbox providers' domains. Only listed
// misspellings count, so a real domain that looks like one is never refused.
const MISSPELLINGS = {
  'gmail.com':      ['gmial.com', 'gmai.com', 'gmal.com', 'gmil.com', 'gmaill.com', 'gmaul.com', 'gnail.com', 'gamil.com', 'gmali.com',
                     'gmeil.com', 'gmsil.com', 'gmaio.com', 'gmaik.com', 'ggmail.com', 'gmmail.com', 'gmaiil.com', 'gmaail.com',
                     'gmail.co', 'gmail.cm', 'gmail.om'],
  'googlemail.com': ['googlemai.com', 'googlemial.com', 'googlemail.co'],
  'yahoo.com':      ['yaho.com', 'yahooo.com', 'yahho.com', 'yhoo.com', 'yhaoo.com', 'yaoo.com', 'yahool.com', 'uahoo.com',
                     'yahoo.co', 'yahoo.cm', 'yahoo.om'],
  'hotmail.com':    ['hotmial.com', 'hotmal.com', 'hotmai.com', 'hotmil.com', 'hotnail.com', 'hotmali.com', 'homail.com', 'hotamil.com',
                     'hotmaill.com', 'htomail.com', 'hormail.com', 'hoymail.com', 'hotmsil.com', 'hotmail.co', 'hotmail.cm', 'hotmail.om'],
  'outlook.com':    ['outlok.com', 'outllok.com', 'outlool.com', 'oulook.com', 'otlook.com', 'outook.com', 'putlook.com',
                     'outlook.co', 'outlook.cm'],
  'icloud.com':     ['iclod.com', 'icoud.com', 'icluod.com', 'iclould.com', 'icload.com', 'iclound.com', 'icloud.co', 'icloud.cm'],
};
const MEANT_DOMAINS = new Map(Object.entries(MISSPELLINGS).flatMap(([domain, typos]) => typos.map(t => [t, domain])));
const MEANT_ENDINGS = new Map([
  ['con', 'com'], ['cmo', 'com'], ['ocm', 'com'], ['vom', 'com'], ['xom', 'com'], ['cpm', 'com'], ['comm', 'com'], ['coom', 'com'],
  ['ner', 'net'], ['nte', 'net'], ['nett', 'net'],
  ['ogr', 'org'], ['rog', 'org'], ['orgg', 'org'],
]);

// The address it was most likely meant to be, or null: jane@gmial.con → jane@gmail.com.
function getEmailSuggestion(email) {
  const at = email.lastIndexOf('@');
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const ending = MEANT_ENDINGS.get(domain.slice(dot + 1));
  const fixed = ending ? `${domain.slice(0, dot)}.${ending}` : domain;
  const meant = MEANT_DOMAINS.get(fixed) || fixed;
  return meant === domain ? null : `${email.slice(0, at)}@${meant}`;
}

// Published on web pages to catch scrapers, never typed by a person signing up.
const TRAP_LOCAL_PART = /spam[._-]?trap|honey[._-]?pot/;

// Shared inboxes nobody signed up with personally; they complain and bounce more.
const ROLE_LOCAL_PARTS = new Set([
  'abuse', 'accounting', 'admin', 'administrator', 'billing', 'careers', 'compliance', 'contact', 'customerservice',
  'enquiries', 'feedback', 'hello', 'help', 'helpdesk', 'hostmaster', 'hr', 'info', 'inquiries', 'jobs', 'legal', 'mail',
  'mailer-daemon', 'marketing', 'media', 'newsletter', 'no-reply', 'noreply', 'office', 'postmaster', 'press', 'privacy',
  'root', 'sales', 'security', 'spam', 'support', 'team', 'webmaster',
]);

// Throwaway inbox services; subdomains of a listed domain match too.
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '10minutemail.co.uk', '10minutemail.com', '10minutemail.net', '10minutesmail.com',
  '20minutemail.com', '33mail.com', 'anonbox.net', 'anonymbox.com', 'armyspy.com', 'burnermail.io', 'byom.de',
  'cuvox.de', 'dayrep.com', 'deadaddress.com', 'despam.it', 'discard.email', 'discardmail.com', 'discardmail.de',
  'dispostable.com', 'dodgit.com', 'dropmail.me', 'e4ward.com', 'einrot.com', 'emailondeck.com', 'emailsensei.com',
  'emailtemporanea.net', 'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com', 'fleckens.hu', 'getairmail.com',
  'getnada.com', 'gishpuppy.com', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'gustr.com', 'harakirimail.com',
  'incognitomail.org', 'inboxbear.com', 'inboxkitten.com', 'jetable.org', 'jourrapide.com', 'kasmail.com',
  'mail-temp.com', 'mail.tm', 'mailcatch.com', 'maildrop.cc', 'mailexpire.com', 'mailforspam.com', 'mailinator.com',
  'mailinator.net', 'mailinator2.com', 'mailmoat.com', 'mailnesia.com', 'mailnull.com', 'mailsac.com',
  'mailtemp.info', 'meltmail.com', 'mintemail.com', 'moakt.com', 'mohmal.com', 'mt2015.com', 'mvrht.com',
  'mytemp.email', 'mytrashmail.com', 'nada.email', 'no-spam.ws', 'nowmymail.com', 'objectmail.com',
  'oneoffemail.com', 'rhyta.com', 'sharklasers.com', 'shieldemail.com', 'sneakemail.com', 'spam4.me', 'spambog.com',
  'spambox.us', 'spamex.com', 'spamgourmet.com', 'spamherelots.com', 'spaml.de', 'spammotel.com', 'superrito.com',
  'teleworm.us', 'temp-mail.io', 'temp-mail.org', 'tempail.com', 'tempinbox.com', 'tempmail.com', 'tempmail.net',
  'tempmail.plus', 'tempmailaddress.com', 'tempmailo.com', 'tempr.email', 'throwam.com', 'throwawaymail.com',
  'tmail.ws', 'tmpmail.net', 'tmpmail.org', 'trash-mail.com', 'trashmail.com', 'trashmail.de', 'trashmail.io',
  'trashmail.net', 'trbvm.com', 'wegwerfmail.de', 'wegwerfmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'zetmail.com',
]);

function isDisposableDomain(domain) {
  const labels = domain.split('.');
  return labels.some((_, i) => DISPOSABLE_DOMAINS.has(labels.slice(i).join('.')));
}

// Why a normalized address shouldn't be imported, or null. Role addresses are
// only dropped when asked: B2B lists often hold info@ contacts on purpose.
function getDropReason(email, { skipRole = false } = {}) {
  const [localPart, domain] = email.split('@');
  if (TRAP_LOCAL_PART.test(localPart)) return 'trap';
  if (getEmailSuggestion(email)) return 'typo';
  if (skipRole && ROLE_LOCAL_PARTS.has(localPart.split('+')[0])) return 'role';
  if (isDisposableDomain(domain)) return 'disposable';
  return null;
}

// Domains with no MX record and no A/AAAA record can't receive mail (RFC 5321
// §5.1 falls back to the A record). Only a definite "no such domain / no data"
// answer counts: a timeout or a DNS server error never drops anyone.
const mxCache = new Map();
async function domainAcceptsMail(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  const definite = (err) => err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA');
  let accepts = true;
  try {
    const mx = await dns.resolveMx(domain);
    // RFC 7505 null MX: "." means the domain explicitly accepts no mail.
    accepts = mx.some(r => r.exchange && r.exchange !== '.');
  } catch (err) {
    if (definite(err)) {
      try { await dns.resolve(domain, 'A'); }
      catch (e2) {
        if (definite(e2)) {
          try { await dns.resolve(domain, 'AAAA'); }
          catch (e3) { if (definite(e3)) accepts = false; }
        }
      }
    }
  }
  mxCache.set(domain, accepts);
  return accepts;
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

// The set of domains (from the list) that definitely can't receive email.
// Looked up a few at a time; a slow lookup counts as "accepts".
async function findDeadDomains(domains, { concurrency = 16, timeoutMs = 8000 } = {}) {
  const list = [...new Set(domains)];
  const dead = new Set();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const domain = list[next++];
      if (!(await withTimeout(domainAcceptsMail(domain), timeoutMs, true))) dead.add(domain);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return dead;
}

function emptyDropped() {
  return Object.fromEntries(Object.keys(DROP_REASONS).map(r => [r, 0]));
}

module.exports = {
  normalizeEmail, getEmailSuggestion, getDropReason, findDeadDomains, emptyDropped,
};
