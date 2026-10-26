// Team Sync of the brand voice: shared, but never the AI key, and an empty
// voice on a new device never overwrites the team's.
const test = require('node:test');
const assert = require('node:assert');
const { stubModules, tempWorkspace, load } = require('./helpers');

stubModules({ './workspace': tempWorkspace() });
const settings = load('settings.js');
const store = load('teamStore.js');
let clock = 0;
const tick = () => ++clock;
const brandEvents = () => store.collectLocalChanges('devA', tick).events.filter(e => e.e === 'brand');

test('an empty brand voice is not pushed', () => {
  const c = store.collectLocalChanges('devA', tick);
  assert.ok(!c.events.some(e => e.e === 'brand'));
  c.commit();
});

test('a brand voice is pushed without the AI key', () => {
  settings.save({ ai_brand_about: 'Pharmacy in Chennai', ai_api_key: 'SECRET-KEY' });
  const c = store.collectLocalChanges('devA', tick);
  const ev = c.events.find(e => e.e === 'brand');
  assert.equal(ev.data.ai_brand_about, 'Pharmacy in Chennai');
  assert.ok(!JSON.stringify(c.events).includes('SECRET-KEY'));
  c.commit();
});

test("a teammate's voice is applied and not pushed back", () => {
  store.applyRemoteEvents([{ e: 'brand', op: 'put', uid: 'brand', ts: 100, dev: 'devB',
    data: { ai_brand_about: 'Team voice', ai_brand_tone: 'formal', ai_brand_avoid: '', ai_brand_signoff: 'Team' } }]);
  assert.equal(settings.getAll().ai_brand_about, 'Team voice');
  assert.equal(settings.getAll().ai_api_key, 'SECRET-KEY');
  assert.equal(brandEvents().length, 0);
});

test('clearing the voice syncs as a delete', () => {
  store.applyRemoteEvents([{ e: 'brand', op: 'del', uid: 'brand', ts: 200, dev: 'devB' }]);
  assert.equal(settings.getAll().ai_brand_about, '');
  assert.equal(settings.getAll().ai_brand_tone, 'friendly');
});
