import test from 'node:test'
import assert from 'node:assert'
import { autoMapColumns, describeShape, applyMapping, findEmailByValues } from '../renderer/src/utils/importMapping.js'

test('maps Mailchimp-style headers', () => {
  const m = autoMapColumns(['Email Address', 'First Name', 'Last Name', 'MEMBER_RATING', 'LEID', 'City', 'Name', 'Name'])
  assert.equal(m['Email Address'], 'email')
  assert.equal(m['First Name'], 'first_name')
  assert.equal(m.LEID, 'skip')
  assert.equal(m.City, 'custom')
  assert.equal(m.MEMBER_RATING, 'custom')
})

test('finds the email column by its values', () => {
  const rows = [{ Contact: 'b@y.com', Who: 'Bob' }, { Contact: 'c@y.com', Who: 'Cy' }]
  assert.equal(findEmailByValues(rows, ['Contact', 'Who'], autoMapColumns(['Contact', 'Who'])).Contact, 'email')
})

test('describes values without exposing them', () => {
  assert.equal(describeShape(['a@b.com', 'c@d.org']), 'email addresses')
  assert.equal(describeShape(['2024-01-02', '2024-03-04']), 'dates')
  assert.equal(describeShape(['+91 98400 12345', '044-2345 6789']), 'phone numbers')
  assert.equal(describeShape([]), 'empty')
  assert.ok(!describeShape(['Chennai', 'Mumbai']).includes('Chennai'))
})

test('applies the mapping, dropping skipped columns and keeping a second Name apart', () => {
  const rows = [{ Mail: 'a@x.com', 'Full Name': 'Ann Lee', Name: 'Nick', LEID: '7', City: 'Pune' }]
  const out = applyMapping(rows, { Mail: 'email', 'Full Name': 'name', Name: 'custom', LEID: 'skip', City: 'custom' })
  assert.deepEqual(out, [{ email: 'a@x.com', name: 'Ann Lee', 'Name (extra)': 'Nick', City: 'Pune' }])
})
