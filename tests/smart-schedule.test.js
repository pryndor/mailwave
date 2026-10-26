// Smart Schedule: one copy per timezone, each going only to that timezone's
// subscribers, and the original campaign left as it was.
const test = require('node:test');
const assert = require('node:assert');
const { stubModules, tempWorkspace, load } = require('./helpers');

const scheduled = [];
stubModules({
  './workspace': tempWorkspace(),
  './license': { isPro: () => true },
  './mailer': { scheduleCampaign: ({ campaign_id, send_at }) => { scheduled.push({ campaign_id, send_at }); return { ok: true, send_at }; } },
});
const db = load('db.js');
const { smartScheduleByTimezone } = load('smartSchedule.js');

test('each timezone copy goes only to its own subscribers', () => {
  db.importSubscribers([
    { email: 'a@x.com', Country: 'India' },
    { email: 'b@x.com', Country: 'IN' },
    { email: 'c@x.com', Country: 'United Kingdom' },
    { email: 'd@x.com', Timezone: 'America/Chicago', Country: 'India' },
    { email: 'e@x.com' },
  ], null, { clean: false });
  const g = db.addGroup('Everyone').id;
  db.assignGroup({ subscriber_ids: db.listSubscribers({ limit: 10 }).rows.map(s => s.id), group_id: g, action: 'add' });
  const { id } = db.saveCampaign({ name: 'June', subject: 'Hi', from_name: '', from_email: '', reply_to: '', html: '<p>x</p>', text: '', group_ids: [g] });

  const r = smartScheduleByTimezone({ campaign_id: id, local_time: '09:00' });
  assert.ok(r.ok);
  assert.equal(r.unmapped, 1, 'e@x.com has no timezone or country');

  const original = db.getCampaign(id);
  assert.equal(original.name, 'June', 'original keeps its name');
  assert.deepEqual(original.group_ids, [g], 'original keeps its groups');

  assert.equal(scheduled.length, r.buckets.length);
  const seen = new Map();
  for (const b of r.buckets) {
    assert.notEqual(b.campaign_id, id, 'a copy is scheduled, never the original');
    const copy = db.getCampaign(b.campaign_id);
    assert.ok(copy.name.startsWith('June — '));
    assert.equal(copy.group_ids.length, 1);
    assert.notEqual(copy.group_ids[0], g, 'copy targets its timezone group, not the whole list');
    const recipients = db.getActiveSubscribersForCampaign(copy.group_ids).map(s => s.email);
    assert.equal(recipients.length, b.count);
    for (const e of recipients) {
      assert.ok(!seen.has(e), `${e} is in two timezone copies`);
      seen.set(e, b.timezone);
    }
  }
  assert.equal(seen.size, 5, 'everyone gets exactly one copy');
  assert.equal(seen.get('a@x.com'), 'Asia/Kolkata');
  assert.equal(seen.get('b@x.com'), 'Asia/Kolkata');
  assert.equal(seen.get('c@x.com'), 'Europe/London');
  assert.equal(seen.get('d@x.com'), 'America/Chicago', 'timezone field wins over country');
});

const { resolveTimezone, countryToTimezone, previewSmartSchedule } = load('smartSchedule.js');
const SENDER = 'Asia/Kolkata';
const tzOf = (sub, opts = {}) => resolveTimezone({ email: 'x@example.com', custom_fields: {}, ...sub }, { senderTz: SENDER, ...opts });

test('country values in the forms people write them', () => {
  for (const [v, tz] of [
    ['India', 'Asia/Kolkata'], ['IN', 'Asia/Kolkata'], ['india ', 'Asia/Kolkata'], ['India (IN)', 'Asia/Kolkata'],
    ['Chennai, India', 'Asia/Kolkata'], ['U.S.A.', 'America/New_York'], ['United States of America', 'America/New_York'],
    ['The Netherlands', 'Europe/Amsterdam'], ['England', 'Europe/London'], ['Dubai, UAE', 'Asia/Dubai'], ['Sri Lanka', 'Asia/Colombo'],
  ]) assert.equal(countryToTimezone(v), tz, v);
  for (const v of ['', 'Tamil Nadu', 'South', 'Atlantis', null]) assert.equal(countryToTimezone(v), null, String(v));
});

test('timezone comes from timezone, then country-like columns, then email ending', () => {
  assert.deepEqual(tzOf({ custom_fields: { time_zone: 'Europe/Paris', country: 'India' } }), { tz: 'Europe/Paris', source: 'timezone' });
  assert.equal(tzOf({ custom_fields: { country_region: 'Germany' } }).tz, 'Europe/Berlin');
  assert.equal(tzOf({ custom_fields: { location: 'Lagos, Nigeria' } }).tz, 'Africa/Lagos');
  assert.equal(tzOf({ custom_fields: { region: 'Tamil Nadu', country_code: 'GB' } }).tz, 'Europe/London', 'unmappable region skipped');
  const bad = tzOf({ custom_fields: { timezone: 'IST', country: 'India' } });
  assert.deepEqual([bad.tz, bad.source, bad.invalid], ['Asia/Kolkata', 'country', 'IST'], 'invalid timezone falls through');
  assert.deepEqual(tzOf({ email: 'dr.rao@clinic.co.in' }), { tz: 'Asia/Kolkata', source: 'email', invalid: null });
  assert.equal(tzOf({ email: 'a@shop.de' }).tz, 'Europe/Berlin');
  assert.equal(tzOf({ email: 'a@startup.co' }).source, 'fallback', '.co is used worldwide');
  assert.equal(tzOf({ email: 'a@gmail.com' }).source, 'fallback');
  assert.equal(tzOf({ email: 'a@shop.de' }, { useEmailDomain: false }).source, 'fallback');
  assert.deepEqual(tzOf({ email: 'a@gmail.com' }), { tz: SENDER, source: 'fallback', invalid: null });
});

test('preview shows the plan and creates nothing', () => {
  db.importSubscribers([
    { email: 'p1@hospital.de' }, { email: 'p2@gmail.com', 'Country/Region': 'Germany' },
    { email: 'p3@gmail.com', Timezone: 'Not/AZone' }, { email: 'p4@gmail.com' },
  ], null, { clean: false });
  const g = db.addGroup('Preview').id;
  db.assignGroup({ subscriber_ids: ['p1', 'p2', 'p3', 'p4'].map(p => db.listSubscribers({ search: `${p}@` }).rows[0].id), group_id: g, action: 'add' });
  const { id } = db.saveCampaign({ name: 'P', subject: 's', from_name: '', from_email: '', reply_to: '', html: '<p>x</p>', text: '', group_ids: [g] });
  const campaignsBefore = db.listCampaigns().length;
  const groupsBefore = db.listGroups().length;

  const r = previewSmartSchedule({ campaign_id: id, local_time: '10:30' });
  assert.ok(r.ok);
  assert.equal(r.total, 4);
  assert.deepEqual(r.totals, { timezone: 0, country: 1, email: 1, fallback: 2 });
  assert.deepEqual(r.invalidTimezones, ['Not/AZone']);
  const berlin = r.buckets.find(b => b.timezone === 'Europe/Berlin');
  assert.equal(berlin.count, 2);
  assert.deepEqual(berlin.sources, { timezone: 0, country: 1, email: 1, fallback: 0 });
  assert.ok(new Date(berlin.send_at) > new Date());
  assert.ok(!('ids' in berlin), 'no subscriber ids leave the main process');
  assert.equal(db.listCampaigns().length, campaignsBefore);
  assert.equal(db.listGroups().length, groupsBefore);

  const off = previewSmartSchedule({ campaign_id: id, local_time: '10:30', use_email_domain: false });
  assert.deepEqual(off.totals, { timezone: 0, country: 1, email: 0, fallback: 3 });
});
