import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail } from '../src/lib/email.js';
import { suggestChannel } from '../src/checks/channel-spelling.js';

test('normalizeEmail treats case, spaces and +tags as the same address', () => {
  assert.equal(normalizeEmail('  Jane.Doe+sales@Acme.COM '), 'jane.doe@acme.com');
  assert.equal(normalizeEmail(''), '');
});

test('suggestChannel maps common variants and leaves unknowns for a person', () => {
  for (const [raw, expected] of [
    ['LinkedIn', 'linkedin'], ['linkedin.com', 'linkedin'], ['li', 'linkedin'],
    ['Google Ads', 'google_ads'], ['adwords', 'google_ads'], ['www.linkedin.com', 'linkedin'],
    ['partner-program', null],
  ]) assert.equal(suggestChannel(raw), expected, raw);
});
