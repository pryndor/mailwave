// AI features against a fake provider: what is sent (prompts, privacy), what
// comes back (sanitised HTML, merge-tag and link checks) and plan gating.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { stubModules, tempWorkspace, load, ELECTRON_DIR } = require('./helpers');

const realProviders = require(path.join(ELECTRON_DIR, 'aiProviders.js'));
const calls = [];
let reply = {};                 // feature → object the fake model returns
let pro = true;
stubModules({
  './workspace': tempWorkspace({ ai_enabled: true, ai_provider: 'custom', ai_model_fast: 'f', ai_model_smart: 's', brevo_api_key: '' }),
  './license': { isPro: () => pro },
  './secrets': { seal: (x) => x, unseal: (x) => x },
  './aiProviders': {
    ...realProviders,
    chatCompat: async ({ system, user, schema }) => {
      calls.push({ system, user, schema });
      const feature = Object.keys(reply).find(f => reply[f].when(user)) || 'default';
      return { result: reply[feature]?.out ?? {}, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  },
});
const db = load('db.js');
const ai = load('ai.js');
const P = load('aiPrompts.js');
const on = (match, out) => ({ when: (u) => u.includes(match), out });
const lastCall = () => calls.at(-1);

// Strict structured outputs: every object lists all its properties as
// required and forbids extra ones, or providers reject the schema.
function assertStrict(schema, where) {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${where}: additionalProperties`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${where}: required`);
    for (const [k, v] of Object.entries(schema.properties)) assertStrict(v, `${where}.${k}`);
  }
  if (schema.type === 'array') assertStrict(schema.items, `${where}[]`);
}

test('every output schema is valid for strict structured outputs', () => {
  for (const [name, schema] of Object.entries(P).filter(([k]) => k.endsWith('_SCHEMA'))) assertStrict(schema, name);
});

test('writer prompt carries the rules the app depends on', () => {
  const sys = P.writerSystem({ ai_brand_about: 'A pharmacy', ai_brand_tone: 'clinical' }, ['city']);
  for (const must of ['{{first_name}}', '{{city}}', '{{first_name|there}}', 'unsubscribe footer automatically', 'Never invent facts', 'preview text', 'A pharmacy', 'evidence-focused']) {
    assert.ok(sys.includes(must), must);
  }
  assert.match(P.analystSystem(), /Only use the numbers given/);
});

test('draft output is sanitised and checked for tags and placeholders', async () => {
  reply = { d: on('Write a new email campaign', {
    subject: 'Hi {{first_name|there}}', preview_text: 'pv',
    html: '<p onclick="steal()">Hi {{fname}}</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="[link]">Book</a>',
    text: 't', notes: '',
  }) };
  const r = await ai.draft({ goal: 'launch' });
  assert.ok(r.ok);
  assert.ok(!/script|onclick|javascript:/i.test(r.html), r.html);
  assert.ok(r.warnings.some(w => w.includes('{{fname}}')), 'unknown tag flagged');
  assert.ok(!r.warnings.some(w => w.includes('first_name')), 'fallback tag accepted');
  assert.ok(r.warnings.some(w => w.includes('[link]')), 'placeholder flagged');
  assert.equal(r.preview_text, 'pv');
});

test('translation warns when links change', async () => {
  const html = '<p><a href="https://a.com/x">Book</a></p>';
  reply = { t: on('Translate this email', { subject: 'S', ab_subject_b: '', preview_text: '', html: '<p><a href="https://a.com/y">Buchen</a></p>', text: '', notes: '' }) };
  let r = await ai.translate({ language: 'German', subject: 's', html });
  assert.match(r.warnings[0], /Links changed/);
  reply.t.out.html = '<p><a href="https://a.com/x">Buchen</a></p>';
  r = await ai.translate({ language: 'German', subject: 's', html });
  assert.ok(!r.warnings.some(w => /Links changed/.test(w)));
  assert.match(lastCall().user, /into German/);
});

test('sequence: capped count, days kept, each email checked', async () => {
  const email = (day) => ({ day, purpose: 'p', subject: 's', preview_text: '', html: '<p>x {{bogus}}</p>', text: 'x' });
  reply = { s: on('Write a series', { plan: 'p', notes: '', emails: [0, 2, 5, 9].map(email) }) };
  const r = await ai.sequence({ goal: 'welcome', count: 3 });
  assert.equal(r.emails.length, 3);
  assert.deepEqual(r.emails.map(e => e.day), [0, 2, 5]);
  assert.ok(r.emails[0].warnings.some(w => w.includes('{{bogus}}')));
  await assert.rejects(ai.sequence({}), /Describe/);
});

test('Smart filter drops unknown fields and groups, and sends no subscriber data', async () => {
  db.importSubscribers([{ email: 'secret.person@clinic.in', City: 'Chennai', first_name: 'Priya' }], null, { clean: false });
  db.addGroup('Doctors');
  reply = { f: on('subscriber filter', {
    explanation: 'x', status: 'active', groups: ['Doctors', 'Nurses'], groups_mode: 'any', email_domains: [],
    conditions: [{ field: 'city', op: 'equals', value: 'Chennai' }, { field: 'specialty', op: 'equals', value: 'x' }],
    added_after: '', added_before: '', emailed: { mode: 'none', campaign: '', days: 0 }, unsupported: '',
  }) };
  const r = await ai.subscriberFilter({ query: 'doctors in chennai' });
  assert.deepEqual(r.filter.groups, ['Doctors']);
  assert.deepEqual(r.filter.conditions.map(c => c.field), ['city']);
  assert.match(r.unsupported, /group "Nurses".*field "specialty"/);
  assert.equal(r.filter.emailed, undefined);
  const sent = JSON.stringify(lastCall());
  assert.ok(sent.includes('city') && sent.includes('Doctors'));
  assert.ok(!/secret\.person|Priya/.test(sent), 'no subscriber values in the prompt');
});

test('column mapping keeps only real headers and known targets', async () => {
  reply = { m: on('Map these CSV columns', { columns: [
    { header: 'E-post', target: 'email' }, { header: 'Invented', target: 'name' }, { header: 'Ort', target: 'custom' },
  ] }) };
  const r = await ai.mapColumns({ columns: [{ header: 'E-post', shape: 'email addresses' }, { header: 'Ort', shape: 'single words' }] });
  assert.deepEqual(r.columns, [{ header: 'E-post', target: 'email' }, { header: 'Ort', target: 'custom' }]);
});

test('campaign report: aggregate numbers only, Pro only', async () => {
  const { id } = db.saveCampaign({ name: 'June', subject: 'Hello', from_name: '', from_email: '', reply_to: '', html: '<p>Body</p>', text: '' });
  db.logSend({ campaign_id: id, email: 'secret.person@clinic.in', name: 'Priya', status: 'sent' });
  db.logSend({ campaign_id: id, email: 'gone@clinic.in', name: 'Old', status: 'bounced', error: '550 5.1.1 User unknown <gone@clinic.in>' });
  reply = { r: on('Report on how this campaign did', { headline: 'h', went_well: [], went_badly: [], likely_causes: [], next_steps: [] }) };
  const r = await ai.report({ campaign_id: id });
  assert.deepEqual(r.stats, { attempted: 2, sent: 1, bounced: 1, failed: 0, brevo: null });
  const sent = JSON.stringify(lastCall());
  assert.ok(!/secret\.person|gone@clinic|Priya/.test(sent), 'no addresses, names or raw errors in the prompt');
  assert.match(sent, /Address doesn't exist: 1/);

  pro = false;
  await assert.rejects(ai.report({ campaign_id: id }), /Pro feature/);
  await assert.rejects(ai.review({ subject: 's', html: '<p>x</p>' }), /Pro feature/);
  pro = true;
});

test('turned off or empty input gives a clear error, not a call', async () => {
  const n = calls.length;
  await assert.rejects(ai.previewText({ html: '' }), /Write the email body first/);
  await assert.rejects(ai.continueWriting({ before: '  ' }), /Write the start/);
  await assert.rejects(ai.translate({ language: '', html: '<p>x</p>' }), /Choose the language/);
  assert.equal(calls.length, n);
});
