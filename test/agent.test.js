// The agent loop, verifier and report, end to end, with the scripted stand-in
// for Claude (no API key, no cost).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario } from '../src/sources/files.js';
import { runAgent } from '../src/agent.js';
import { makeSimClient } from '../src/sim-client.js';
import { renderHtml, renderMarkdown, fixFiles } from '../src/report.js';

const run = async (scenario, opts) => {
  const { truth, ...data } = loadScenario(scenario);
  return runAgent({ client: makeSimClient(opts), model: 'sim', data, period: truth.period });
};

test('everything: agent submits findings that pass verification', async () => {
  const r = await run('everything');
  assert.equal(r.verification.passed, true);
  assert.deepEqual(r.findings.issues.map((i) => i.check).sort(), ['C1', 'C2', 'C3', 'C4', 'C5']);
});

test('a wrong first answer is rejected, and the corrected one accepted', async () => {
  const r = await run('everything', { mistakeFirst: true });
  assert.equal(r.submitAttempts, 2);
  assert.equal(r.verification.passed, true);
});

test('clean: no issues, every channel trusted', async () => {
  const r = await run('clean');
  assert.equal(r.findings.issues.length, 0);
  assert.ok(r.findings.channel_trust.every((t) => t.trusted));
});

test('report renders and fix files are produced', async () => {
  const r = await run('everything');
  const meta = { source: 'test', generatedAt: 'now' };
  assert.match(renderHtml(r, meta), /Marketing-sourced ARR/);
  assert.match(renderMarkdown(r, meta), /\| Unknown \|/);
  assert.deepEqual(Object.keys(fixFiles(r.results)).sort(),
    ['billing-mismatches.csv', 'channel-map.csv', 'deal-contact-matches.csv', 'merge-list.csv', 'missing-source-deals.csv']);
});
