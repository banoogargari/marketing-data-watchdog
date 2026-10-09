#!/usr/bin/env node
// Runs the agent on every scenario and grades it against the answer keys.
//
//   npm run eval                     real Claude, 3 runs per scenario (~$1-3)
//   npm run eval -- --runs 1         quicker
//   npm run eval -- --sim            scripted stand-in, free (tests the scorer itself)
//
// Writes evals/results.md (the table for the README) and evals/results.json.

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readdirSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadScenario } from '../src/sources/files.js';
import { runAgent } from '../src/agent.js';
import { makeSimClient } from '../src/sim-client.js';
import { UNKNOWN } from '../src/config.js';

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    scenario: { type: 'string', multiple: true },
    sim: { type: 'boolean', default: false },
    model: { type: 'string' },
  },
});
const runs = Number(args.runs);
const model = args.sim ? 'simulated' : args.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
if (!args.sim && !process.env.ANTHROPIC_API_KEY) {
  console.error('No ANTHROPIC_API_KEY in .env. Use --sim to test the scorer without one.');
  process.exit(1);
}
const scenarios = args.scenario ?? readdirSync(new URL('./scenarios/', import.meta.url)).sort();

/** Report rows the answer key says are affected (independent of the checks' own code). */
export function truthAffectedChannels(truth, data) {
  const contact = new Map(data.contacts.map((c) => [c.id, c]));
  const deal = new Map(data.deals.map((d) => [d.id, d]));
  const reportedRow = (id) => (deal.get(id)?.contact_id && contact.get(deal.get(id).contact_id)?.utm_source) || UNKNOWN;
  const s = new Set();
  if (truth.C1?.deal_ids.length) s.add(UNKNOWN);
  for (const v of truth.C2?.variants ?? []) if (v.deal_ids.length) { s.add(v.variant); s.add(v.channel); }
  for (const g of truth.C3?.groups ?? []) if (g.deal_id) { s.add(UNKNOWN); s.add(g.channel); }
  if (truth.C4?.deals.length) s.add(UNKNOWN);
  for (const m of truth.C5?.mismatches ?? []) s.add(reportedRow(m.deal_id));
  for (const id of truth.C5?.unbilled_deal_ids ?? []) s.add(reportedRow(id));
  return s;
}

const truthArr = (truth, check) => ({
  C1: () => truth.C1.arr,
  C2: () => truth.C2.variants.reduce((x, v) => x + v.arr, 0),
  C3: () => truth.C3.arr,
  C4: () => truth.C4.arr,
  C5: () => truth.C5.mismatches.reduce((x, m) => x + m.difference, 0),
}[check]());

function grade(run, truth, data) {
  const planted = new Set(truth.problems);
  const ok = run.verification.passed;
  const reported = new Set(ok ? run.findings.issues.map((i) => i.check) : []);
  const trust = new Map((ok ? run.findings.channel_trust : []).map((t) => [t.channel, t.trusted]));
  const affected = truthAffectedChannels(truth, data);
  const rows = [...new Set([...run.results.arr.reported.rows, ...run.results.arr.after_fixes.rows].map((r) => r.channel))];
  return {
    planted: planted.size,
    detected: [...planted].filter((c) => reported.has(c)).length,
    false_alarms: [...reported].filter((c) => !planted.has(c)).length,
    arr_exact: [...planted].filter((c) => run.results.checks[c].arr_affected === truthArr(truth, c)).length,
    wrongly_trusted: [...affected].filter((ch) => trust.get(ch) === true).length,
    cautious_on_clean: rows.filter((ch) => !affected.has(ch) && trust.get(ch) === false).length,
    passed_verification: ok,
    first_try: ok && run.submitAttempts === 1,
    turns: run.turns,
    cost_usd: run.usage.cost_usd,
    seconds: run.seconds,
  };
}

const all = [];
for (const name of scenarios) {
  const { truth, ...data } = loadScenario(name);
  for (let i = 1; i <= runs; i++) {
    const t0 = Date.now();
    process.stdout.write(`${name.padEnd(17)} run ${i}/${runs} … `);
    let g;
    try {
      const run = await runAgent({ client: args.sim ? makeSimClient() : new Anthropic(), model, data, period: truth.period });
      run.seconds = Math.round((Date.now() - t0) / 1000);
      g = grade(run, truth, data);
    } catch (err) {
      g = { error: String(err.message ?? err), planted: truth.problems.length, detected: 0, false_alarms: 0, arr_exact: 0, wrongly_trusted: 0, cautious_on_clean: 0, passed_verification: false, first_try: false, turns: 0, cost_usd: 0, seconds: 0 };
    }
    all.push({ scenario: name, run: i, ...g });
    console.log(g.error ? `ERROR ${g.error}` : `${g.detected}/${g.planted} found · ${g.false_alarms} false alarms · ${g.wrongly_trusted} wrongly trusted · ${g.passed_verification ? 'verified' : 'NOT verified'} · $${g.cost_usd}`);
  }
}

// ---- summary table --------------------------------------------------------
const sum = (rows, k) => rows.reduce((s, r) => s + (typeof r[k] === 'boolean' ? Number(r[k]) : r[k]), 0);
const lines = [
  `| Scenario | Problems found | False alarms | ARR impact exact | Affected channels shown as trusted | Passed verification (1st try) | Avg cost |`,
  `|---|---|---|---|---|---|---|`,
];
for (const name of scenarios) {
  const rs = all.filter((r) => r.scenario === name);
  lines.push(`| ${name} | ${sum(rs, 'detected')}/${sum(rs, 'planted')} | ${sum(rs, 'false_alarms')} | ${sum(rs, 'arr_exact')}/${sum(rs, 'planted')} | ${sum(rs, 'wrongly_trusted')} | ${sum(rs, 'passed_verification')}/${rs.length} (${sum(rs, 'first_try')}) | $${(sum(rs, 'cost_usd') / rs.length).toFixed(3)} |`);
}
const recall = sum(all, 'planted') ? sum(all, 'detected') / sum(all, 'planted') : 1;
lines.push(`| **All** | **${sum(all, 'detected')}/${sum(all, 'planted')} (${(recall * 100).toFixed(0)}%)** | **${sum(all, 'false_alarms')}** | **${sum(all, 'arr_exact')}/${sum(all, 'planted')}** | **${sum(all, 'wrongly_trusted')}** | **${sum(all, 'passed_verification')}/${all.length} (${sum(all, 'first_try')})** | **$${sum(all, 'cost_usd').toFixed(2)} total** |`);

const header = `Model: \`${model}\` · ${runs} run(s) per scenario · ${new Date().toISOString().slice(0, 10)}\n\n`;
writeFileSync(new URL('./results.md', import.meta.url), header + lines.join('\n') + '\n');
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ model, runs, results: all }, null, 2) + '\n');
console.log(`\n${header}${lines.join('\n')}\n\nSaved to evals/results.md`);
