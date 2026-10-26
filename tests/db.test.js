// Import cleaning, status mapping, the Smart filter's SQL builder and campaign fields, on a real SQLite file.
const test = require('node:test');
const assert = require('node:assert');
const { stubModules, tempWorkspace, load } = require('./helpers');

stubModules({ './workspace': tempWorkspace() });
const db = load('db.js');

test('import drops bad addresses and keeps statuses from exports', () => {
  db.addSubscriber({ email: 'old@acme.com', status: 'unsubscribed' });
  db.addSubscriber({ email: 'keep@acme.com' });
  const rows = [
    { Email: 'Jane@Gmail.com', 'First Name': 'Jane', City: 'Paris' },
    { Email: 'jane@gmail.com' },
    { Email: 'bob@gmial.com' },
    { Email: 'x@mailinator.com' },
    { Email: 'info@acme.com' },
    { Email: 'spamtrap@acme.com' },
    { Email: 'not-an-email' },
    { Email: 'u@dead.example' },
    { Email: 'old@acme.com', Status: 'subscribed' },
    { Email: 'keep@acme.com', Status: 'Unsubscribed' },
    { 'Email Address': 'gone@acme.com', 'Member Status': 'cleaned' },
  ];
  const r = db.importSubscribers(rows, null, { clean: true, skipRole: true, deadDomains: new Set(['dead.example']) });
  assert.deepEqual(r.dropped, { invalid: 1, typo: 1, trap: 1, role: 1, disposable: 1, duplicate: 1, noMail: 1 });
  assert.equal(r.inserted, 2); assert.equal(r.updated, 2); assert.equal(r.suppressed, 2);
  const all = Object.fromEntries(db.listSubscribers({ limit: 100 }).rows.map(s => [s.email, s]));
  assert.equal(all['old@acme.com'].status, 'unsubscribed', 'never reactivated');
  assert.equal(all['keep@acme.com'].status, 'unsubscribed', 'export status honoured');
  assert.equal(all['gone@acme.com'].status, 'bounced');
  assert.equal(all['jane@gmail.com'].custom_fields.city, 'Paris');
  assert.equal(all['jane@gmail.com'].custom_fields.status, undefined, 'status column is not a custom field');
});

test('Smart filter conditions, groups, domains, dates and send history', () => {
  db.importSubscribers([
    { email: 'f1@gmail.com', City: 'Chennai' },
    { email: 'f2@yahoo.com', City: 'Mumbai' },
    { email: 'f3@gmail.com', City: 'chennai', status: 'unsubscribed' },
    { email: "f4%_'@x.com", City: '' },
  ], null, { clean: false });
  const g = db.addGroup('Doctors').id;
  const id = (e) => db.listSubscribers({ search: e }).rows[0].id;
  db.assignGroup({ subscriber_ids: [id('f1@gmail.com'), id('f2@yahoo.com')], group_id: g, action: 'add' });
  const c = db.saveCampaign({ name: 'June Promo', subject: 'S', from_name: '', from_email: '', reply_to: '', html: '', text: '' });
  db.logSend({ campaign_id: c.id, email: 'f1@gmail.com', name: '', status: 'sent' });

  const q = (filter) => db.listSubscribers({ filter, limit: 100, search: 'f' }).rows.map(r => r.email).filter(e => e.startsWith('f')).sort();
  assert.deepEqual(q({ conditions: [{ field: 'city', op: 'equals', value: 'CHENNAI' }] }), ['f1@gmail.com', 'f3@gmail.com']);
  assert.deepEqual(q({ status: 'active', conditions: [{ field: 'city', op: 'equals', value: 'chennai' }] }), ['f1@gmail.com']);
  assert.deepEqual(q({ groups: ['doctors'] }), ['f1@gmail.com', 'f2@yahoo.com']);
  assert.deepEqual(q({ groups: ['Doctors'], groups_mode: 'none' }), ['f3@gmail.com', "f4%_'@x.com"]);
  assert.deepEqual(q({ email_domains: ['@gmail.com'] }), ['f1@gmail.com', 'f3@gmail.com']);
  assert.deepEqual(q({ emailed: { mode: 'campaign', campaign: 'june' } }), ['f1@gmail.com']);
  assert.deepEqual(q({ emailed: { mode: 'within_days', days: 7 } }), ['f1@gmail.com']);
  assert.equal(q({ emailed: { mode: 'never' } }).length, 3);
  assert.deepEqual(q({ conditions: [{ field: 'city', op: 'empty', value: '' }] }), ["f4%_'@x.com"]);
  assert.deepEqual(q({ conditions: [{ field: 'email', op: 'contains', value: '%_' }] }), ["f4%_'@x.com"], 'LIKE wildcards are literal');
  assert.deepEqual(q({ added_after: '2000-01-01', added_before: '2999-01-01' }).length, 4);
  assert.equal(db.subscriberIdsForFilter({ email_domains: ['yahoo.com'] }).length, 1);
});

test('Smart filter never turns model output into SQL', () => {
  const count = (filter) => db.listSubscribers({ filter, limit: 1000 }).total;
  const all = count({});
  assert.equal(count({ conditions: [{ field: 'email) OR 1=1 --', op: 'equals', value: 'x' }] }), all, 'unknown field ignored');
  assert.equal(count({ status: "active' OR 1=1 --" }), all, 'unknown status ignored');
  assert.equal(count({ conditions: [{ field: 'city', op: 'equals', value: "x' OR '1'='1" }] }), 0, 'value is bound');
  assert.equal(count({ groups: ["x') OR 1=1 --"] }), 0);
  assert.equal(count({ added_after: "2020-01-01' OR 1=1" }), all, 'malformed date ignored');
});

test('campaign fields: preview text, A/B winner settings (clamped), test sent, winner', () => {
  const { id } = db.saveCampaign({
    name: 'c', subject: 's', from_name: '', from_email: '', reply_to: '', html: '', text: '',
    preview_text: 'pv', ab_mode: 'winner', ab_test_pct: 90, ab_wait_hours: 0, ab_metric: 'clicks',
  });
  let c = db.getCampaign(id);
  assert.equal(c.preview_text, 'pv');
  assert.deepEqual([c.ab_mode, c.ab_test_pct, c.ab_wait_hours, c.ab_metric], ['winner', 50, 4, 'clicks']);
  db.setAbWinner(id, 'b'); db.markTestSent(id);
  c = db.getCampaign(id);
  assert.equal(c.ab_winner, 'b'); assert.ok(c.test_sent_at);
  const dup = db.getCampaign(db.duplicateCampaign(id).id);
  assert.equal(dup.preview_text, 'pv'); assert.equal(dup.ab_mode, 'winner'); assert.equal(dup.ab_winner, '', 'copy starts a new test');
});

test('bounced subscribers are skipped; resume knows who was reached', () => {
  const { id } = db.saveCampaign({ name: 'r', subject: 's', from_name: '', from_email: '', reply_to: '', html: '', text: '' });
  db.logSend({ campaign_id: id, email: 'Jane@gmail.com', name: '', status: 'sent' });
  db.logSend({ campaign_id: id, email: 'x@y.com', name: '', status: 'failed', error: 'e' });
  assert.deepEqual([...db.campaignReachedEmails(id)], ['jane@gmail.com']);
  const jane = db.listSubscribers({ search: 'jane@gmail.com' }).rows[0];
  db.markSubscriberBounced(jane.id);
  assert.ok(!db.getActiveSubscribersForCampaign([]).some(s => s.email === 'jane@gmail.com'));
});
