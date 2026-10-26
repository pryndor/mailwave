const db       = require('./db');
const mailer   = require('./mailer');
const settings = require('./settings');
const license  = require('./license');

// Country name/ISO-code → primary IANA timezone. Multi-zone countries (US, Russia, Brazil,
// Canada, Australia) are mapped to their most common business timezone — imprecise but a
// reasonable default. For exact per-recipient accuracy, supply a "timezone" CSV column instead.
const COUNTRY_TZ = {
  'united states': 'America/New_York', 'usa': 'America/New_York', 'us': 'America/New_York',
  'united kingdom': 'Europe/London', 'uk': 'Europe/London', 'gb': 'Europe/London',
  'canada': 'America/Toronto', 'ca': 'America/Toronto',
  'australia': 'Australia/Sydney', 'au': 'Australia/Sydney',
  'india': 'Asia/Kolkata', 'in': 'Asia/Kolkata',
  'germany': 'Europe/Berlin', 'de': 'Europe/Berlin',
  'france': 'Europe/Paris', 'fr': 'Europe/Paris',
  'italy': 'Europe/Rome', 'it': 'Europe/Rome',
  'spain': 'Europe/Madrid', 'es': 'Europe/Madrid',
  'netherlands': 'Europe/Amsterdam', 'nl': 'Europe/Amsterdam',
  'switzerland': 'Europe/Zurich', 'ch': 'Europe/Zurich',
  'ireland': 'Europe/Dublin', 'ie': 'Europe/Dublin',
  'belgium': 'Europe/Brussels', 'be': 'Europe/Brussels',
  'austria': 'Europe/Vienna', 'at': 'Europe/Vienna',
  'portugal': 'Europe/Lisbon', 'pt': 'Europe/Lisbon',
  'sweden': 'Europe/Stockholm', 'se': 'Europe/Stockholm',
  'norway': 'Europe/Oslo', 'no': 'Europe/Oslo',
  'denmark': 'Europe/Copenhagen', 'dk': 'Europe/Copenhagen',
  'finland': 'Europe/Helsinki', 'fi': 'Europe/Helsinki',
  'poland': 'Europe/Warsaw', 'pl': 'Europe/Warsaw',
  'russia': 'Europe/Moscow', 'ru': 'Europe/Moscow',
  'turkey': 'Europe/Istanbul', 'tr': 'Europe/Istanbul',
  'israel': 'Asia/Jerusalem', 'il': 'Asia/Jerusalem',
  'uae': 'Asia/Dubai', 'united arab emirates': 'Asia/Dubai', 'ae': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh', 'sa': 'Asia/Riyadh',
  'china': 'Asia/Shanghai', 'cn': 'Asia/Shanghai',
  'japan': 'Asia/Tokyo', 'jp': 'Asia/Tokyo',
  'south korea': 'Asia/Seoul', 'korea': 'Asia/Seoul', 'kr': 'Asia/Seoul',
  'singapore': 'Asia/Singapore', 'sg': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', 'hk': 'Asia/Hong_Kong',
  'taiwan': 'Asia/Taipei', 'tw': 'Asia/Taipei',
  'thailand': 'Asia/Bangkok', 'th': 'Asia/Bangkok',
  'indonesia': 'Asia/Jakarta', 'id': 'Asia/Jakarta',
  'malaysia': 'Asia/Kuala_Lumpur', 'my': 'Asia/Kuala_Lumpur',
  'philippines': 'Asia/Manila', 'ph': 'Asia/Manila',
  'vietnam': 'Asia/Ho_Chi_Minh', 'vn': 'Asia/Ho_Chi_Minh',
  'pakistan': 'Asia/Karachi', 'pk': 'Asia/Karachi',
  'bangladesh': 'Asia/Dhaka', 'bd': 'Asia/Dhaka',
  'new zealand': 'Pacific/Auckland', 'nz': 'Pacific/Auckland',
  'south africa': 'Africa/Johannesburg', 'za': 'Africa/Johannesburg',
  'nigeria': 'Africa/Lagos', 'ng': 'Africa/Lagos',
  'kenya': 'Africa/Nairobi', 'ke': 'Africa/Nairobi',
  'egypt': 'Africa/Cairo', 'eg': 'Africa/Cairo',
  'brazil': 'America/Sao_Paulo', 'br': 'America/Sao_Paulo',
  'mexico': 'America/Mexico_City', 'mx': 'America/Mexico_City',
  'argentina': 'America/Argentina/Buenos_Aires', 'ar': 'America/Argentina/Buenos_Aires',
  'chile': 'America/Santiago', 'cl': 'America/Santiago',
  'colombia': 'America/Bogota', 'co': 'America/Bogota',
  'peru': 'America/Lima', 'pe': 'America/Lima',
  'sri lanka': 'Asia/Colombo', 'lk': 'Asia/Colombo',
  'nepal': 'Asia/Kathmandu', 'np': 'Asia/Kathmandu',
  'qatar': 'Asia/Qatar', 'qa': 'Asia/Qatar',
  'kuwait': 'Asia/Kuwait', 'kw': 'Asia/Kuwait',
  'oman': 'Asia/Muscat', 'om': 'Asia/Muscat',
  'bahrain': 'Asia/Bahrain', 'bh': 'Asia/Bahrain',
  'jordan': 'Asia/Amman', 'jo': 'Asia/Amman',
  'lebanon': 'Asia/Beirut', 'lb': 'Asia/Beirut',
  'iran': 'Asia/Tehran', 'ir': 'Asia/Tehran',
  'iraq': 'Asia/Baghdad', 'iq': 'Asia/Baghdad',
  'greece': 'Europe/Athens', 'gr': 'Europe/Athens',
  'czech republic': 'Europe/Prague', 'czechia': 'Europe/Prague', 'cz': 'Europe/Prague',
  'hungary': 'Europe/Budapest', 'hu': 'Europe/Budapest',
  'romania': 'Europe/Bucharest', 'ro': 'Europe/Bucharest',
  'ukraine': 'Europe/Kyiv', 'ua': 'Europe/Kyiv',
  'morocco': 'Africa/Casablanca', 'ma': 'Africa/Casablanca',
  'ghana': 'Africa/Accra', 'gh': 'Africa/Accra',
  'ethiopia': 'Africa/Addis_Ababa', 'et': 'Africa/Addis_Ababa',
  'tanzania': 'Africa/Dar_es_Salaam', 'tz': 'Africa/Dar_es_Salaam',
  'uganda': 'Africa/Kampala', 'ug': 'Africa/Kampala',
};

// Other ways people write the same countries.
const COUNTRY_ALIASES = {
  'united states of america': 'usa', 'america': 'usa', 'u s a': 'usa', 'u s': 'usa',
  'england': 'uk', 'scotland': 'uk', 'wales': 'uk', 'northern ireland': 'uk', 'great britain': 'uk', 'britain': 'uk', 'u k': 'uk',
  'bharat': 'india', 'deutschland': 'germany', 'espana': 'spain', 'españa': 'spain', 'holland': 'netherlands',
  'emirates': 'uae', 'dubai': 'uae', 'ksa': 'saudi arabia', 'republic of korea': 'south korea',
  'peoples republic of china': 'china', 'prc': 'china', 'viet nam': 'vietnam', 'russian federation': 'russia',
};

const normCountry = (v) => String(v).toLowerCase().replace(/[.()'’]/g, ' ').replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();

// A country name or code → timezone. "Chennai, India" and "India (IN)" work
// too: each comma part is tried, last first.
function countryToTimezone(country) {
  if (!country) return null;
  const parts = String(country).split(/[,/|]/).map(normCountry).filter(Boolean).reverse();
  for (const p of [normCountry(country), ...parts]) {
    const key = COUNTRY_ALIASES[p] || p;
    if (COUNTRY_TZ[key]) return COUNTRY_TZ[key];
    const code = /\(([a-z]{2})\)$/.exec(String(country).toLowerCase().trim());
    if (code && COUNTRY_TZ[code[1]]) return COUNTRY_TZ[code[1]];
  }
  return null;
}

// Custom field keys (as imports store them: lowercase, non-letters → "_")
// that hold a timezone or a country. Tried in this order.
const TIMEZONE_KEYS = ['timezone', 'time_zone', 'tz', 'iana_timezone', 'timezone_name'];
const COUNTRY_KEYS  = ['country', 'country_region', 'country_or_region', 'country_name', 'country_code', 'nation', 'location', 'region'];

// Country-code domain endings, for subscribers with no timezone or country
// field: jane@clinic.co.in → India. Endings used worldwide by unrelated sites
// (.co is Colombia, but mostly "company") are left out.
const GENERIC_CCTLDS = new Set(['co']);

// Full IANA names only (Asia/Kolkata, UTC). Intl also takes old three-letter
// codes, but those are ambiguous: IST is India, Ireland or Israel.
function isValidTimezone(tz) {
  if (!/^(UTC|GMT|[A-Za-z]+\/[A-Za-z0-9_+\-/]+)$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function emailTimezone(email) {
  const tld = String(email || '').toLowerCase().split('.').pop();
  if (!/^[a-z]{2}$/.test(tld) || GENERIC_CCTLDS.has(tld)) return null;
  return COUNTRY_TZ[tld] || null;
}

// Where one subscriber's timezone comes from:
//   timezone — a timezone field (most exact)
//   country  — a country field
//   email    — the email's country ending (.in, .de), if useEmailDomain
//   fallback — none of these: the sender's own timezone
function resolveTimezone(sub, { useEmailDomain = true, senderTz } = {}) {
  const fields = sub.custom_fields || {};
  let invalid = null;
  for (const k of TIMEZONE_KEYS) {
    const v = String(fields[k] || '').trim();
    if (!v) continue;
    if (isValidTimezone(v)) return { tz: v, source: 'timezone' };
    invalid = v;
  }
  for (const k of COUNTRY_KEYS) {
    const tz = countryToTimezone(fields[k]);
    if (tz) return { tz, source: 'country', invalid };
  }
  if (useEmailDomain) {
    const tz = emailTimezone(sub.email);
    if (tz) return { tz, source: 'email', invalid };
  }
  return { tz: senderTz, source: 'fallback', invalid };
}

const SOURCES = ['timezone', 'country', 'email', 'fallback'];

// Subscribers grouped by timezone, with where each group's timezones came
// from, the next send time there, and the overall counts by source.
function planSmartSchedule(subs, { local_time = '09:00', useEmailDomain = true } = {}) {
  const [hh, mm] = local_time.split(':').map(Number);
  const senderTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const buckets = new Map();
  const totals = Object.fromEntries(SOURCES.map(k => [k, 0]));
  const invalidTimezones = new Set();
  for (const s of subs) {
    const r = resolveTimezone(s, { useEmailDomain, senderTz });
    if (r.invalid) invalidTimezones.add(r.invalid);
    totals[r.source]++;
    if (!buckets.has(r.tz)) buckets.set(r.tz, { timezone: r.tz, ids: [], sources: Object.fromEntries(SOURCES.map(k => [k, 0])) });
    const b = buckets.get(r.tz);
    b.ids.push(s.id);
    b.sources[r.source]++;
  }
  const list = [...buckets.values()]
    .map(b => ({ ...b, count: b.ids.length, send_at: nextLocalTimeUtc(b.timezone, hh, mm), isSender: b.timezone === senderTz }))
    .sort((a, b) => b.count - a.count);
  return { buckets: list, totals, senderTz, invalidTimezones: [...invalidTimezones].slice(0, 10) };
}

// Wall-clock time (hh:mm) in an IANA timezone → next matching UTC instant.
// If that time already passed today in that zone, rolls to tomorrow.
function nextLocalTimeUtc(timeZone, hh, mm) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(now).reduce((a, p) => { a[p.type] = p.value; return a }, {});
  // "Wall clock now" in that zone, read as if it were UTC — diff against real `now` gives the zone's current offset.
  const wallNowAsUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const offsetMs = wallNowAsUtc - now;

  let target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hh, mm, 0));
  target = new Date(target.getTime() - offsetMs);
  if (target <= now) target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  return target.toISOString();
}

function loadCampaignSubscribers(campaign_id) {
  const campaign = db.getCampaign(campaign_id);
  if (!campaign) return { error: 'Campaign not found' };
  const subs = db.getActiveSubscribersForCampaign(campaign.group_ids);
  if (!subs.length) return { error: 'No active subscribers targeted by this campaign.' };
  return { campaign, subs };
}

// What Smart Schedule would do, without creating or scheduling anything.
function previewSmartSchedule({ campaign_id, local_time, use_email_domain = true }) {
  const { campaign, subs, error } = loadCampaignSubscribers(campaign_id);
  if (error) return { ok: false, error };
  const plan = planSmartSchedule(subs, { local_time, useEmailDomain: use_email_domain });
  return {
    ok: true, total: subs.length, campaign_name: campaign.name,
    totals: plan.totals, senderTz: plan.senderTz, invalidTimezones: plan.invalidTimezones,
    buckets: plan.buckets.map(({ ids, ...b }) => b),
  };
}

// Splits a campaign into one scheduled copy per timezone, each going only to
// that timezone's subscribers at local_time (HH:MM) there. The original stays
// as it was. Subscribers with no timezone, country or country email ending go
// out at local_time in the sender's own timezone.
function smartScheduleByTimezone({ campaign_id, local_time, use_email_domain = true }, mainWindow, getPort) {
  if (!license.isPro(settings.getAll().license_key)) {
    return { ok: false, error: 'Smart Schedule is a Pro feature.', proRequired: true };
  }
  const { campaign, subs, error } = loadCampaignSubscribers(campaign_id);
  if (error) return { ok: false, error };
  const plan = planSmartSchedule(subs, { local_time: local_time || '09:00', useEmailDomain: use_email_domain });

  const results = [];
  for (const b of plan.buckets) {
    const groupName = `__smart_tz__ ${b.timezone} (${campaign.name} #${campaign_id})`;
    let group = db.listGroups().find(g => g.name === groupName);
    if (!group) group = { id: db.addGroup(groupName).id };
    db.assignGroup({ subscriber_ids: b.ids, group_id: group.id, action: 'add' });

    // id goes after the spread: campaign.id would otherwise win, and this save
    // would overwrite the original while the copy kept the original's groups,
    // sending every timezone's copy to the whole list.
    const dup = db.duplicateCampaign(campaign_id);
    db.saveCampaign({ ...campaign, id: dup.id, name: `${campaign.name} — ${b.timezone}`, group_ids: [group.id] });

    const sched = mailer.scheduleCampaign({ campaign_id: dup.id, send_at: b.send_at }, mainWindow, getPort);
    results.push({ timezone: b.timezone, count: b.count, sources: b.sources, send_at: b.send_at, campaign_id: dup.id, ok: sched.ok, error: sched.error });
  }

  return { ok: true, buckets: results, unmapped: plan.totals.fallback, totals: plan.totals };
}

module.exports = { smartScheduleByTimezone, previewSmartSchedule, planSmartSchedule, resolveTimezone, nextLocalTimeUtc, countryToTimezone };
