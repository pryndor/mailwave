const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./helpers');
const cc = load('contactChecks.js');

test('normalizeEmail accepts real addresses and rejects junk', () => {
  assert.equal(cc.normalizeEmail('  Jane.Doe+news@Example.COM '), 'jane.doe+news@example.com');
  for (const bad of ['', 'no-at', 'a@@b.com', 'a@b', 'a b@c.com', 'a@b.c0m', '"q"@x.com', 'a..b@x.com', null]) {
    assert.equal(cc.normalizeEmail(bad), null, String(bad));
  }
});

test('typo suggestions only for listed misspellings', () => {
  assert.equal(cc.getEmailSuggestion('jane@gmial.com'), 'jane@gmail.com');
  assert.equal(cc.getEmailSuggestion('jane@gmail.con'), 'jane@gmail.com');
  assert.equal(cc.getEmailSuggestion('jane@hotmial.con'), 'jane@hotmail.com');
  assert.equal(cc.getEmailSuggestion('jane@gmail.com'), null);
  assert.equal(cc.getEmailSuggestion('jane@gmall.de'), null);
});

test('drop reasons', () => {
  assert.equal(cc.getDropReason('spamtrap@x.com'), 'trap');
  assert.equal(cc.getDropReason('bob@gmial.com'), 'typo');
  assert.equal(cc.getDropReason('x@mailinator.com'), 'disposable');
  assert.equal(cc.getDropReason('x@sub.yopmail.com'), 'disposable');
  assert.equal(cc.getDropReason('info@acme.com'), null, 'role kept by default');
  assert.equal(cc.getDropReason('info+x@acme.com', { skipRole: true }), 'role');
  assert.equal(cc.getDropReason('jane@acme.com', { skipRole: true }), null);
});
