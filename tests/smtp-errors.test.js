const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers');
const { classifySmtpError: c, groupFailures } = load('smtpErrors.js');

test('classifies nodemailer errors', () => {
  assert.equal(c({ code: 'EAUTH', responseCode: 535, response: '535 5.7.8 Authentication failed' }), 'auth');
  assert.equal(c({ code: 'EENVELOPE', responseCode: 550, response: '550 5.1.1 <x@y.com>: Recipient address rejected: User unknown' }), 'bounce');
  assert.equal(c({ code: 'EMESSAGE', responseCode: 550, response: '550 5.4.5 Daily user sending quota exceeded' }), 'quota');
  assert.equal(c({ code: 'EENVELOPE', responseCode: 552, response: '552 5.2.2 Mailbox full' }), 'mailbox_full');
  assert.equal(c({ responseCode: 452, response: '452 4.2.2 The email account is over quota' }), 'mailbox_full', 'recipient over quota is not our quota');
  assert.equal(c({ responseCode: 554, response: '554 5.7.1 Unusual sending activity detected' }), 'blocked');
  assert.equal(c({ code: 'ECONNECTION', message: 'connect ECONNREFUSED' }), 'transient');
  assert.equal(c({ responseCode: 421, response: '421 4.7.0 Try again later' }), 'transient');
  assert.equal(c({ responseCode: 554, response: '554 Message content rejected' }), 'failed');
});

test('classifies errors read back from history (message only)', () => {
  assert.equal(c({ message: '550 5.1.1 User unknown' }), 'bounce');
  assert.equal(c({ message: 'Invalid login: 535 Authentication failed' }), 'auth');
  assert.equal(c({ message: 'Connection timed out' }), 'transient');
});

test('groups failures by cause, largest first', () => {
  const g = groupFailures([
    { error: '550 5.1.1 User unknown', count: 3 },
    { error: '550 no such user here', count: 2 },
    { error: '552 mailbox full', count: 1 },
  ]);
  assert.deepEqual(g.map(x => [x.kind, x.count]), [['bounce', 5], ['mailbox_full', 1]]);
  assert.ok(g[0].fix && g[0].label && g[0].example);
});
