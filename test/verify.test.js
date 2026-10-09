import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbersInText, verifyFindings } from '../src/verify.js';

test('numbersInText ignores dates, ids and check names', () => {
  const got = numbersInText('Since Aug 14, 2026 (2026-08-14) C2 moved $54,000 across 6 deals in d5048, 42.9% in Q3 2026; ~$25K').map((n) => n.value);
  assert.deepEqual(got, [54000, 6, 42.9, 25000]);
});

const base = () => ({
  checks: { C1: { check: 'C1', status: 'ok' }, C2: { check: 'C2', status: 'issue' } },
  arr: { reported: { rows: [{ channel: 'linkedin' }, { channel: 'li' }] }, after_fixes: { rows: [{ channel: 'linkedin' }] } },
  affected: { linkedin: ['C2'], li: ['C2'] },
  seenNumbers: new Set([54000, 2]),
});
const good = () => ({
  headline: 'linkedin is understated by $54,000.',
  issues: [{ check: 'C2', title: 'li', what_happened: '2 deals', impact: '$54,000', recommended_action: 'map li', needs_human_review: false }],
  channel_trust: [{ channel: 'linkedin', trusted: false, reason: 'C2' }, { channel: 'li', trusted: false, reason: 'C2' }],
});

test('verifier passes correct findings', () => {
  assert.equal(verifyFindings({ ...base(), findings: good() }).passed, true);
});

test('V1: a missing or invented issue fails', () => {
  const f = good(); f.issues = [];
  assert.equal(verifyFindings({ ...base(), findings: f }).errors[0].rule, 'V1');
  const g = good(); g.issues.push({ ...g.issues[0], check: 'C1' });
  assert.equal(verifyFindings({ ...base(), findings: g }).errors[0].rule, 'V1');
});

test('V2: an affected channel marked trusted fails', () => {
  const f = good(); f.channel_trust[0].trusted = true;
  const r = verifyFindings({ ...base(), findings: f });
  assert.equal(r.passed, false);
  assert.match(r.errors[0].message, /linkedin/);
});

test('V3: a number not from a tool fails', () => {
  const f = good(); f.headline = 'linkedin is understated by $60,000.';
  const r = verifyFindings({ ...base(), findings: f });
  assert.equal(r.errors[0].rule, 'V3');
});
