// Turns a verified agent run into the report (HTML + Markdown) and the
// proposed-fix CSV files. All numbers in tables come from code; the agent
// supplies the explanations and the trust decisions.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UNKNOWN } from './config.js';

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Rows of the main table: every channel in either view, with trust. */
export function channelRows({ results, findings }) {
  const { arr, affected } = results;
  const rep = Object.fromEntries(arr.reported.rows.map((r) => [r.channel, r]));
  const aft = Object.fromEntries(arr.after_fixes.rows.map((r) => [r.channel, r]));
  const trust = new Map((findings?.channel_trust ?? []).map((t) => [t.channel, t]));
  const channels = [...new Set([...Object.keys(rep), ...Object.keys(aft)])]
    .sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || (aft[b]?.arr ?? 0) - (aft[a]?.arr ?? 0) || (rep[b]?.arr ?? 0) - (rep[a]?.arr ?? 0));
  return channels.map((channel) => ({
    channel,
    reported: rep[channel]?.arr ?? 0,
    after: aft[channel]?.arr ?? 0,
    trusted: trust.get(channel)?.trusted ?? !affected[channel],
    reason: trust.get(channel)?.reason ?? '',
    checks: affected[channel] ?? [],
  }));
}

export function issueList({ results, findings }) {
  const { checks } = results;
  return (findings?.issues ?? []).map((i, n) => ({
    n: n + 1,
    ...i,
    check_name: checks[i.check]?.name,
    deals: checks[i.check]?.deal_ids.length ?? 0,
    arr: checks[i.check]?.arr_affected ?? 0,
  }));
}

// ---------------------------------------------------------------------------
export function renderMarkdown(run, meta) {
  const rows = channelRows(run);
  const issues = issueList(run);
  const { total } = run.results.arr.reported;
  const out = [];
  out.push(`# Marketing-Sourced ARR: ${run.period.label}`, '');
  out.push(`> ${run.findings.headline}`, '');
  out.push(`| Channel | Reported ARR | After fixes | Trust |`, `|---|---:|---:|---|`);
  for (const r of rows) out.push(`| ${r.channel} | ${usd(r.reported)} | ${r.after ? usd(r.after) : '—'} | ${r.trusted ? '✅' : `⚠️ ${r.checks.join(', ')}`} |`);
  out.push(`| **Total** | **${usd(total)}** | **${usd(run.results.arr.after_fixes.total)}** | |`, '');
  if (issues.length) {
    out.push('## Issues', '');
    for (const i of issues) {
      out.push(`### ${i.n}. ${i.title}  \`${i.check}\``, '');
      out.push(`**Deals affected:** ${i.deals} · **ARR affected:** ${usd(i.arr)}${i.needs_human_review ? ' · **Needs review**' : ''}`, '');
      out.push(`- **What happened:** ${i.what_happened}`, `- **Impact:** ${i.impact}`, `- **Recommended action:** ${i.recommended_action}`, '');
    }
  } else {
    out.push('## Issues', '', 'No issues found. All channels can be trusted.', '');
  }
  out.push('---', `Generated ${meta.generatedAt} · ${meta.source} · model ${run.model} · verification ${run.verification.passed ? 'passed' : 'FAILED'} · ${run.turns} turns · $${run.usage.cost_usd}`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
export function renderHtml(run, meta) {
  const rows = channelRows(run);
  const issues = issueList(run);
  const { arr } = run.results;
  const maxArr = Math.max(...rows.map((r) => Math.max(r.reported, r.after)), 1);
  const untrusted = rows.filter((r) => !r.trusted).length;
  const bar = (v, cls) => `<span class="bar ${cls}" style="width:${((v / maxArr) * 100).toFixed(1)}%"></span>`;

  const tableRows = rows.map((r) => `
      <tr class="${r.trusted ? '' : 'warn'}">
        <th scope="row">${esc(r.channel)}</th>
        <td class="num">${usd(r.reported)}<div class="track">${bar(r.reported, 'b-rep')}</div></td>
        <td class="num">${r.after ? usd(r.after) : '<span class="muted">—</span>'}<div class="track">${bar(r.after, 'b-aft')}</div></td>
        <td>${r.trusted ? '<span class="pill ok">Trusted</span>' : `<span class="pill bad">Check ${r.checks.map((c) => `<a href="#${c}">${c}</a>`).join(' ')}</span>`}</td>
      </tr>`).join('');

  const issueCards = issues.length ? issues.map((i) => `
    <article class="issue" id="${i.check}">
      <header>
        <span class="tag">${i.check}</span>
        <h3>${esc(i.title)}</h3>
        ${i.needs_human_review ? '<span class="pill review">Needs review</span>' : ''}
      </header>
      <dl class="facts">
        <div><dt>Deals affected</dt><dd>${i.deals}</dd></div>
        <div><dt>${i.check === 'C5' ? 'Deal ARR above billed' : 'ARR affected'}</dt><dd>${usd(i.arr)}</dd></div>
      </dl>
      <p><strong>What happened.</strong> ${esc(i.what_happened)}</p>
      <p><strong>Impact.</strong> ${esc(i.impact)}</p>
      <p class="action"><strong>Recommended action.</strong> ${esc(i.recommended_action)}</p>
    </article>`).join('') : '<p class="clean">No issues found. Every channel can be trusted.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marketing-Sourced ARR — ${esc(run.period.label)}</title>
<style>
  :root {
    --bg: #f7f6f2; --card: #ffffff; --ink: #1d1d1b; --muted: #6b6a66; --line: #e4e2db;
    --ok: #1f7a4d; --ok-bg: #e3f3ea; --bad: #a3460b; --bad-bg: #fcebdc; --rev: #5b4bb7; --rev-bg: #ece9fb;
    --rep: #b8b5ab; --aft: #2f5fd0;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #151514; --card: #1e1e1c; --ink: #ecebe6; --muted: #a09f99; --line: #34332f;
      --ok: #6fd3a0; --ok-bg: #173526; --bad: #f2a56b; --bad-bg: #3a2414; --rev: #b3a8f5; --rev-bg: #2a2547;
      --rep: #5d5b55; --aft: #7aa2ff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 920px; margin: 0 auto; padding: 40px 16px 64px; }
  .eyebrow { color: var(--muted); font-size: 13px; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 6px; }
  h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; margin: 0 0 16px; letter-spacing: -.01em; }
  .headline { font-size: 18px; margin: 0 0 28px; max-width: 70ch; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .stat b { display: block; font-size: 24px; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--muted); font-size: 13px; }
  section { margin-top: 36px; }
  h2 { font-size: 20px; margin: 0 0 12px; }
  .table-wrap { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 560px; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  tbody th { font-weight: 600; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; }
  tr.warn th { color: var(--bad); }
  tfoot th, tfoot td { border-bottom: 0; font-weight: 700; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; width: 26%; }
  .track { height: 4px; margin-top: 6px; background: var(--line); border-radius: 2px; overflow: hidden; }
  .bar { display: block; height: 100%; border-radius: 2px; }
  .b-rep { background: var(--rep); } .b-aft { background: var(--aft); }
  .pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .pill.ok { color: var(--ok); background: var(--ok-bg); }
  .pill.bad { color: var(--bad); background: var(--bad-bg); }
  .pill.bad a { color: inherit; }
  .pill.review { color: var(--rev); background: var(--rev-bg); }
  .muted, .note { color: var(--muted); }
  .note { font-size: 14px; margin-top: 10px; }
  .issue { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; scroll-margin-top: 16px; }
  .issue header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; }
  .issue h3 { margin: 0; font-size: 17px; flex: 1 1 240px; }
  .tag { font: 600 12px ui-monospace, Menlo, monospace; background: var(--ink); color: var(--card); border-radius: 6px; padding: 2px 7px; }
  .facts { display: flex; gap: 28px; margin: 0 0 12px; }
  .facts dt { font-size: 12px; color: var(--muted); }
  .facts dd { margin: 0; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .issue p { margin: 8px 0; }
  .action { border-left: 3px solid var(--aft); padding-left: 12px; }
  .clean { background: var(--ok-bg); color: var(--ok); padding: 14px 16px; border-radius: 12px; }
  footer { margin-top: 40px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); padding-top: 14px; }
  footer code { font-size: 12px; }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Marketing data watchdog · ${esc(meta.source)}</p>
  <h1>Marketing-sourced ARR, ${esc(run.period.label)}</h1>
  <p class="headline">${esc(run.findings.headline)}</p>

  <div class="stats">
    <div class="stat"><b>${usd(arr.reported.total)}</b><span>Won ARR in period</span></div>
    <div class="stat"><b>${issues.length}</b><span>Issues found</span></div>
    <div class="stat"><b>${rows.length - untrusted} of ${rows.length}</b><span>Channel rows trusted</span></div>
    <div class="stat"><b>${run.verification.passed ? 'Passed' : 'Failed'}</b><span>Automatic verification</span></div>
  </div>

  <section>
    <h2>ARR by channel</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Channel</th><th>Reported today</th><th>After safe fixes</th><th>Trust</th></tr></thead>
        <tbody>${tableRows}
        </tbody>
        <tfoot><tr><th>Total</th><td class="num">${usd(arr.reported.total)}</td><td class="num">${usd(arr.after_fixes.total)}</td><td></td></tr></tfoot>
      </table>
    </div>
    <p class="note">"After safe fixes" applies the proposed channel-name map and duplicate merges. Missing sources and unlinked deals stay in Unknown until a person reviews them. Nothing has been changed in HubSpot.</p>
  </section>

  <section>
    <h2>Issues</h2>
    ${issueCards}
  </section>

  <footer>
    Generated ${esc(meta.generatedAt)} by an AI agent (${esc(run.model)}) from ${esc(meta.source)}.
    All dollar amounts and counts are computed by code; the agent explains them and decides trust, and its findings passed
    ${run.verification.passed ? 'every' : '<strong>not all</strong>'} automatic check${run.verification.passed ? '' : 's'} (${run.submitAttempts} submission${run.submitAttempts === 1 ? '' : 's'}).
    Proposed fixes are in <code>fixes/</code>.
  </footer>
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(Array.isArray(r[c]) ? r[c].join(' ') : r[c])).join(','))].join('\n') + '\n';
};

export function fixFiles({ checks }) {
  const files = {
    'channel-map.csv': checks.C2.items.map((i) => ({ current_value: i.variant, map_to: i.suggested_channel ?? 'NEEDS DECISION', contacts: i.contacts, won_deals: i.deal_ids.length, arr: i.arr })),
    'merge-list.csv': checks.C3.items.map((i) => ({ keep_contact_id: i.keep_id, merge_contact_id: i.duplicate_id, email: i.email, duplicate_email: i.duplicate_email, keep_source: i.keep_source ?? '', won_deals_on_duplicate: i.deal_ids, arr_moved_from_unknown: i.arr_moved_from_unknown })),
    'missing-source-deals.csv': checks.C1.items.map((i) => ({ deal_id: i.deal_id, contact_id: i.contact_id, contact_created: i.contact_created, arr: i.arr })),
    'deal-contact-matches.csv': checks.C4.items.map((i) => ({ deal_id: i.deal_id, dealname: i.dealname, arr: i.arr, suggested_contact_id: i.suggested_contact_id ?? '', suggested_contact_email: i.suggested_contact_email ?? '', suggested_contact_source: i.suggested_contact_source ?? '', needs_review: 'yes' })),
    'billing-mismatches.csv': [
      ...checks.C5.mismatches.map((m) => ({ type: 'deal ARR differs from billed', deal_id: m.deal_id, subscription_id: m.subscription_id, email: '', deal_arr: m.deal_arr, billed_arr: m.billed_arr, difference: m.difference, matched_by: m.matched_by })),
      ...checks.C5.unbilled.map((u) => ({ type: 'won deal with no subscription', deal_id: u.deal_id, subscription_id: '', email: u.contact_email, deal_arr: u.deal_arr, billed_arr: '', difference: '', matched_by: '' })),
      ...checks.C5.unmatched_subscriptions.map((s) => ({ type: 'paying customer with no deal', deal_id: '', subscription_id: s.subscription_id, email: s.customer_email, deal_arr: '', billed_arr: s.billed_arr, difference: '', matched_by: '' })),
    ],
  };
  return Object.fromEntries(Object.entries(files).filter(([, rows]) => rows.length).map(([name, rows]) => [name, csv(rows)]));
}

export function writeReport(run, { dir, source, generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }) {
  const meta = { source, generatedAt };
  mkdirSync(join(dir, 'fixes'), { recursive: true });
  writeFileSync(join(dir, 'report.html'), renderHtml(run, meta));
  writeFileSync(join(dir, 'report.md'), renderMarkdown(run, meta));
  const { results, ...rest } = run;
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({ ...rest, arr: results.arr, affected_channels: results.affected }, null, 2) + '\n');
  for (const [name, content] of Object.entries(fixFiles(results))) writeFileSync(join(dir, 'fixes', name), content);
  return dir;
}
