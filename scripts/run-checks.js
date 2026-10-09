// Runs the five checks on one scenario and prints a plain summary.
//   npm run checks -- everything
import { loadScenario } from '../src/sources/files.js';
import { runChecks } from '../src/checks/index.js';

const name = process.argv[2] ?? 'everything';
const { truth, ...data } = loadScenario(name);
const { checks, arr } = runChecks({ ...data, period: truth.period });
const $ = (n) => `$${n.toLocaleString('en-US')}`;

console.log(`\nScenario: ${name} — ${truth.description}\nPeriod: ${truth.period.label}\n`);
console.log('ARR by channel        reported     after fixes');
const after = Object.fromEntries(arr.after_fixes.rows.map((r) => [r.channel, r.arr]));
const channels = [...new Set([...arr.reported.rows.map((r) => r.channel), ...Object.keys(after)])];
for (const ch of channels) {
  const rep = arr.reported.rows.find((r) => r.channel === ch)?.arr ?? 0;
  console.log(`  ${ch.padEnd(18)} ${$(rep).padStart(10)}  ${$(after[ch] ?? 0).padStart(12)}`);
}
console.log(`  ${'TOTAL'.padEnd(18)} ${$(arr.reported.total).padStart(10)}  ${$(arr.after_fixes.total).padStart(12)}\n`);
for (const c of Object.values(checks)) {
  const extra = c.status === 'issue' ? `  deals: ${c.deal_ids.length}, ARR affected: ${$(c.arr_affected)}` : '';
  console.log(`${c.status === 'issue' ? '⚠️ ' : '✅'} ${c.check} ${c.name}${extra}`);
}
if (checks.C1.change) { const pct = (x) => `${(x * 100).toFixed(1)}%`; const ch = checks.C1.change; console.log(`   C1 change: empty source ${pct(ch.rate_before)} → ${pct(ch.rate_after)} of new contacts from ${ch.start_date}`); }
console.log();
