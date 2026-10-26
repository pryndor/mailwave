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
