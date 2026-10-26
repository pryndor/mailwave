// The send loop against a fake SMTP transport: personalisation, error
// handling (bounce, quota, retry, pauses, safety stops), resume and A/B.
const test = require('node:test');
const assert = require('node:assert');
const { stubModules, load } = require('./helpers');

const state = {};
let subs = [];
let behavior = () => null;          // (mail, n) => error to throw, or null
const baseCampaign = {
  id: 1, name: 'C', subject: 'Hi {{first_name|there}}\n!', preview_text: 'For {{first_name|you}} & co',
  html: '<p>Hello {{first_name|friend}}, {{city|your town}} {{FNAME}} {{name}}</p>', text: '',
  group_ids: [], attachments: [], ab_subject_b: '',
};
function reset(extra = {}) {
  Object.assign(state, {
    logs: [], bounced: [], notes: [], resume: null, status: null, sent: [], testSent: false,
    winner: undefined, reached: new Set(), brevoKey: '', brevo: {}, camp: {}, ...extra,
  });
}

stubModules({
  './settings': { getAll: () => ({
    smtp_host: 'h', smtp_port: 587, from_email: 'me@x.com', from_name: 'Me', batch_size: 1000, batch_delay: 0,
    per_email_delay: 0, daily_send_limit: 0, postal_address: '1 Main St\nTown', brevo_api_key: state.brevoKey,
  }) },
  './teamSync': { acquireSendLock: async () => ({ ok: true, local: true }), releaseSendLock: async () => {} },
  './brevo': { getCampaignMetricsFor: async (key, camp, variant) => state.brevo[variant] },
  './db': {
    getCampaign: () => ({ ...baseCampaign, ...state.camp }),
    getActiveSubscribersForCampaign: () => subs,
    listCustomFieldKeys: () => ['city'],
    ensureCampaignUid: () => 'u1',
    updateCampaignProgress: (id, s, t, status) => { state.status = status; },
    updateCampaignResume: (id, off, at) => { state.resume = { off, at }; },
    logSend: (r) => state.logs.push(r),
    markSubscriberBounced: (id) => state.bounced.push(id),
    markTestSent: () => { state.testSent = true; },
    addNotification: (type, title, body) => state.notes.push({ type, title, body }),
    getTodaySentCount: () => 0,
    campaignReachedEmails: () => state.reached,
    setAbWinner: (id, w) => { state.winner = w; },
    campaignSentHere: () => true,
  },
  nodemailer: { createTransport: () => ({
    sendMail: async (m) => { const e = behavior(m, state.sent.length); state.sent.push(m); if (e) throw e; },
    close() {}, verify: async () => {},
  }) },
});

// Retry waits and A/B waits shouldn't slow the suite down.
const realSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 1), ...a);
const origLog = console.log;
console.log = (...a) => { if (!String(a[0]).startsWith('[Mailer]')) origLog(...a); };

const mailer = load('mailer.js');
const mk = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, email: `a${i}@x.com`, name: '', first_name: i === 0 ? '' : `F${i}`, last_name: '', company: '',
  custom_fields: i === 1 ? { city: 'Paris' } : {},
}));
const err = (responseCode, response, code) => Object.assign(new Error(response), { responseCode, response, code });

test('personalisation, preview text, postal address, one-line subject', async () => {
  reset(); subs = mk(3); behavior = () => null;
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.equal(r.sent, 3);
  const [m0, m1] = state.sent;
  assert.equal(m0.subject, 'Hi there !');
  assert.equal(m1.subject, 'Hi F1 !');
  assert.match(m0.html, /Hello friend, your town \{\{FNAME\}\} a0/);
  assert.match(m1.html, /Hello F1, Paris/);
  assert.match(m0.html, /display:none[^>]*>For you &amp; co/);
  assert.match(m0.html, /1 Main St<br>Town/);
  assert.match(m0.text, /--\n1 Main St\nTown/);
});

test('merge values are HTML-escaped in the body', async () => {
  reset(); subs = [{ id: 1, email: 'x@x.com', first_name: '<script>x</script>', custom_fields: {} }]; behavior = () => null;
  await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(!state.sent[0].html.includes('<script>'));
  assert.match(state.sent[0].html, /&lt;script&gt;/);
});

test('hard bounce marks the subscriber and the send goes on', async () => {
  reset(); subs = mk(3);
  behavior = (m) => m.to.includes('a1@') ? err(550, '550 5.1.1 <a1@x.com>: Recipient address rejected: User unknown', 'EENVELOPE') : null;
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.deepEqual(state.bounced, [2]);
  assert.equal(r.bounced, 1); assert.equal(r.sent, 2); assert.equal(state.status, 'sent');
});

test('provider quota pauses until tomorrow without logging the recipient', async () => {
  reset(); subs = mk(5); behavior = (m, n) => n === 2 ? err(550, '550 5.4.5 Daily user sending quota exceeded', 'EMESSAGE') : null;
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(r.paused); assert.equal(state.status, 'paused');
  assert.equal(state.resume.off, 2); assert.ok(state.resume.at);
  assert.equal(state.logs.length, 2);
});

test('transient errors retry the same address', async () => {
  reset(); subs = mk(2); let fails = 0;
  behavior = (m) => (m.to.includes('a0@') && fails++ < 2) ? err(421, '421 4.7.0 Try again later') : null;
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.equal(r.sent, 2); assert.equal(state.status, 'sent');
});

test('persistent connection failure pauses with auto-resume', async () => {
  reset(); subs = mk(2); behavior = () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' });
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(r.paused); assert.ok(state.resume.at); assert.equal(state.logs.length, 0);
});

test('login failure pauses without auto-resume', async () => {
  reset(); subs = mk(2); behavior = () => err(535, '535 Authentication failed', 'EAUTH');
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(r.paused); assert.equal(state.resume.at, null);
});

test('10 failures in a row stop the send', async () => {
  reset(); subs = mk(20); behavior = () => err(554, '554 Message content rejected');
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(r.paused); assert.equal(state.logs.length, 10); assert.equal(state.resume.off, 10);
});

test('bounce rate over 2% stops the send', async () => {
  reset(); subs = mk(200); behavior = (m, n) => n % 10 === 0 ? err(550, '550 5.1.1 User unknown', 'EENVELOPE') : null;
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(r.paused); assert.match(state.notes.at(-1).title, /Bounce/);
});

test('resume skips addresses already reached instead of slicing', async () => {
  reset({ reached: new Set(['a1@x.com']) }); subs = mk(3); behavior = () => null;
  await mailer.sendCampaign({ campaign_id: 1, start_offset: 2, resume: true });
  assert.deepEqual(state.sent.map(m => m.to.match(/a\d/)[0]), ['a0', 'a2']);
});

test('preview send marks the test as sent', async () => {
  reset(); behavior = () => null;
  const r = await mailer.sendCampaign({ campaign_id: 1, preview_to: 'me@me.com' });
  assert.ok(r.ok); assert.ok(state.testSent);
});

const abCamp = { ab_subject_b: 'Subject B', ab_mode: 'winner', ab_test_pct: 20, ab_wait_hours: 4, ab_metric: 'opens', ab_winner: '' };

test('A/B winner: test group alternates A/B, then pauses for the wait', async () => {
  reset({ camp: abCamp }); subs = mk(20); behavior = () => null;
  const r = await mailer.sendCampaign({ campaign_id: 1 });
  assert.ok(r.paused); assert.equal(state.sent.length, 4); assert.equal(state.winner, '');
  assert.deepEqual(state.sent.map(m => m.subject.startsWith('Subject B') ? 'b' : 'a'), ['a', 'b', 'a', 'b']);
  assert.ok(new Date(state.resume.at) - Date.now() > 3.9 * 3600e3);
});

test('A/B winner: on resume the better open rate goes to everyone else', async () => {
  reset({
    camp: abCamp, brevoKey: 'k', reached: new Set(['a0@x.com', 'a1@x.com', 'a2@x.com', 'a3@x.com']),
    brevo: { a: { ok: true, requests: 2, opens: 0 }, b: { ok: true, requests: 2, opens: 1 } },
  });
  subs = mk(20); behavior = () => null;
  await mailer.sendCampaign({ campaign_id: 1, start_offset: 4, resume: true });
  assert.equal(state.winner, 'b'); assert.equal(state.sent.length, 16);
  assert.ok(state.sent.every(m => m.subject === 'Subject B' && m.headers['X-Mailin-Tag'].endsWith('-b')));
  assert.match(state.notes.find(n => n.type === 'ab_winner').body, /open rate A 0.0% vs B 50.0%/);
});

test('A/B winner: without Brevo stats subject A is kept', async () => {
  reset({ camp: abCamp, reached: new Set(['a0@x.com', 'a1@x.com', 'a2@x.com', 'a3@x.com']) });
  subs = mk(20); behavior = () => null;
  await mailer.sendCampaign({ campaign_id: 1, start_offset: 4, resume: true });
  assert.equal(state.winner, 'a');
  assert.ok(state.sent.every(m => m.subject.startsWith('Hi')));
});
