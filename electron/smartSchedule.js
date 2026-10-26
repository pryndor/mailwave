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
};

function countryToTimezone(country) {
  if (!country) return null;
  return COUNTRY_TZ[country.trim().toLowerCase()] || null;
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

// Groups a campaign's target subscribers by their {{timezone}} custom field,
// duplicates the campaign per timezone, and schedules each to fire at `local_time` (HH:MM)
// in that group's local zone. Subscribers with no timezone set fall into a "default" bucket
// scheduled using the sender machine's own local timezone.
function smartScheduleByTimezone({ campaign_id, local_time }, mainWindow, getPort) {
  if (!license.isPro(settings.getAll().license_key)) {
    return { ok: false, error: 'Smart Schedule is a Pro feature.', proRequired: true };
  }

  const campaign = db.getCampaign(campaign_id);
  if (!campaign) return { ok: false, error: 'Campaign not found' };

  const [hh, mm] = (local_time || '09:00').split(':').map(Number);
  const subs = db.getActiveSubscribersForCampaign(campaign.group_ids);
  if (!subs.length) return { ok: false, error: 'No active subscribers targeted by this campaign.' };

  const senderTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const buckets = new Map(); // timezone -> subscriber ids
  let unmapped = 0; // recipients that fell back to sender's own timezone (no usable timezone/country data)

  for (const s of subs) {
    const explicitTz = (s.custom_fields?.timezone || '').trim();
    const fromCountry = countryToTimezone(s.custom_fields?.country);
    const tz = explicitTz || fromCountry;
    if (!tz) unmapped++;
    const bucketKey = tz || senderTz;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push(s.id);
  }

  const results = [];
  for (const [tz, ids] of buckets) {
    let sendAt;
    try {
      sendAt = nextLocalTimeUtc(tz, hh, mm);
    } catch (err) {
      results.push({ timezone: tz, count: ids.length, error: `Invalid timezone: ${tz}` });
      continue;
    }

    const groupName = `__smart_tz__ ${tz} (${campaign.name} #${campaign_id})`;
    let group = db.listGroups().find(g => g.name === groupName);
    if (!group) group = { id: db.addGroup(groupName).id };
    db.assignGroup({ subscriber_ids: ids, group_id: group.id, action: 'add' });

    // id goes after the spread: campaign.id would otherwise win, and this save
    // would overwrite the original while the copy kept the original's groups,
    // sending every timezone's copy to the whole list.
    const dup = db.duplicateCampaign(campaign_id);
    db.saveCampaign({ ...campaign, id: dup.id, name: `${campaign.name} — ${tz}`, group_ids: [group.id] });

    const sched = mailer.scheduleCampaign({ campaign_id: dup.id, send_at: sendAt }, mainWindow, getPort);
    results.push({ timezone: tz, count: ids.length, send_at: sendAt, campaign_id: dup.id, ok: sched.ok, error: sched.error });
  }

  return { ok: true, buckets: results, unmapped };
}

module.exports = { smartScheduleByTimezone, nextLocalTimeUtc, countryToTimezone };
