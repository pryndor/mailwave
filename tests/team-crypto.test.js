// Team Sync encryption: what GitHub stores must be unreadable without the
// team passphrase, and any tampering must be detected.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { stubModules, tempWorkspace, load } = require('./helpers');

stubModules({ './workspace': tempWorkspace() });
const { _crypto: c } = load('teamSync.js');
const salt = crypto.randomBytes(16).toString('base64');
const key = c.deriveKey('correct horse battery staple', salt);

test('round trip, and the stored bytes reveal nothing', () => {
  const data = { subscribers: [{ email: 'secret.person@clinic.in', name: 'Priya' }] };
  const buf = c.encJson(key, data);
  assert.deepEqual(c.decJson(key, buf), data);
  assert.ok(!buf.toString('latin1').includes('secret.person'));
  assert.notDeepEqual(c.encJson(key, data), buf, 'a fresh IV each time');
});

test('the wrong passphrase cannot decrypt', () => {
  const buf = c.encJson(key, { a: 1 });
  const wrong = c.deriveKey('wrong passphrase', salt);
  assert.throws(() => c.decJson(wrong, buf));
});

test('tampered or foreign files are rejected', () => {
  const buf = c.encrypt(key, Buffer.from('hello'));
  const flipped = Buffer.from(buf);
  flipped[flipped.length - 1] ^= 1;
  assert.throws(() => c.decrypt(key, flipped), 'auth tag catches changed ciphertext');
  assert.throws(() => c.decrypt(key, Buffer.from('XX1' + 'x'.repeat(40))), /Unknown file format/);
});
