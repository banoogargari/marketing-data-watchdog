// The tools Claude can call. Every number Claude sees comes from here, and
// every number it sees is remembered so the verifier can check that the
// report only uses numbers that really came from the data.

import { UNKNOWN } from '../config.js';
import { addDays } from '../lib/dates.js';

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const usd = (n) => `$${n.toLocaleString('en-US')}`;

export const TOOL_DEFINITIONS = [
  {
    name: 'run_checks',
    description:
      'Runs the five data checks (C1 missing source, C2 channel spelled several ways, C3 duplicate contacts, ' +
      'C4 won deals with no contact, C5 deal ARR vs. billed ARR) and returns a summary of each, plus which ' +
      'ARR-by-channel rows each problem affects. Start here.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_arr_by_channel',
    description:
      'Marketing-sourced ARR by channel for the period. view="reported" is what a dashboard shows today ' +
      '(grouped by the raw utm_source). view="after_fixes" applies the safe fixes (channel spelling map and ' +
      'duplicate merges). Missing sources and unlinked deals stay "Unknown" in both views.',
    input_schema: {
      type: 'object',
      properties: { view: { type: 'string', enum: ['reported', 'after_fixes'] } },
      required: ['view'],
    },
  },
  {
    name: 'get_check_details',
    description: 'The individual records behind one check (e.g. each duplicate pair, each billing mismatch).',
    input_schema: {
      type: 'object',
      properties: {
        check: { type: 'string', enum: ['C1', 'C2', 'C3', 'C4', 'C5'] },
        limit: { type: 'integer', description: 'Max items to return (default 20).' },
      },
      required: ['check'],
    },
  },
  {
    name: 'get_records',
    description: 'Look up contacts, deals or subscriptions by id to investigate a finding.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['contact', 'deal', 'subscription'] },
        ids: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      },
      required: ['kind', 'ids'],
    },
  },
  {
    name: 'empty_source_by_week',
    description:
      'For each week: how many contacts were created and what share arrived with an empty utm_source. ' +
      'Use it to see when a missing-source problem started.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'submit_findings',
    description:
      'Submit the final findings. They are checked automatically before the report is published: every ' +
      'check with an issue must be covered, every affected channel must be marked not trusted, and every ' +
      'number you write must appear in a tool result. If the check fails you get the reasons and can fix and resubmit.',
    input_schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One or two sentences: can the ARR-by-channel number be trusted, and what matters most.' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string', enum: ['C1', 'C2', 'C3', 'C4', 'C5'] },
              title: { type: 'string', description: 'Short title, e.g. "linkedin spelled 3 ways".' },
              what_happened: { type: 'string', description: 'What is broken and, if you found it, since when and the likely cause.' },
              impact: { type: 'string', description: 'What this does to ARR by channel, in plain words.' },
              recommended_action: { type: 'string', description: 'What a person should do. Fixes are never applied automatically.' },
              needs_human_review: { type: 'boolean' },
            },
            required: ['check', 'title', 'what_happened', 'impact', 'recommended_action', 'needs_human_review'],
          },
        },
        channel_trust: {
          type: 'array',
          description: 'One entry for every row of the ARR-by-channel report (both views).',
          items: {
            type: 'object',
            properties: {
              channel: { type: 'string' },
              trusted: { type: 'boolean' },
              reason: { type: 'string', description: 'Short reason, e.g. "affected by C2" or "no open issues".' },
            },
            required: ['channel', 'trusted', 'reason'],
          },
        },
      },
      required: ['headline', 'issues', 'channel_trust'],
    },
  },
];

export function makeToolHandlers({ data, results }) {
  const { contacts, deals, billing } = data;
  const { checks, arr, affected } = results;
  const seenNumbers = new Set();
  const remember = (value) => {
    JSON.stringify(value, (k, v) => {
      if (typeof v === 'number') seenNumbers.add(v);
      if (typeof v === 'string') for (const m of v.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) seenNumbers.add(Number(m[0].replace(/,/g, '')));
      return v;
    });
    return value;
  };

  const summary = {
    C1: () => ({
      contacts_without_source: checks.C1.contacts_without_source,
      sudden_change: checks.C1.change
        ? { start_date: checks.C1.change.start_date, empty_rate_before: pct(checks.C1.change.rate_before), empty_rate_after: pct(checks.C1.change.rate_after), contacts_without_source_since: checks.C1.contacts_without_source_since_change }
        : null,
    }),
    C2: () => ({ variants: checks.C2.items.map(({ variant, suggested_channel, contacts: n, arr: a }) => ({ variant, suggested_channel, contacts: n, arr: a })), unmapped: checks.C2.unmapped }),
    C3: () => ({ duplicate_records: checks.C3.duplicate_count, duplicates_holding_won_deals: checks.C3.items.filter((i) => i.deal_ids.length).length }),
    C4: () => ({ deals_without_contact: checks.C4.deal_ids.length }),
    C5: () => ({
      deals_checked: checks.C5.deals_checked,
      mismatches: checks.C5.mismatches.length,
      total_deal_arr_above_billed: checks.C5.arr_affected,
      won_deals_with_no_subscription: checks.C5.unbilled.length,
      paying_customers_with_no_deal: checks.C5.unmatched_subscriptions.length,
      not_checkable_because_no_contact: checks.C5.not_checkable_deal_ids.length,
    }),
  };

  const handlers = {
    run_checks: () => ({
      period: results.period,
      checks: Object.values(checks).map((c) => ({
        check: c.check, name: c.name, status: c.status,
        deals_affected: c.deal_ids.length, arr_affected: c.arr_affected,
        ...summary[c.check](),
      })),
      affected_channels: affected,
      note: 'arr_affected for C5 is the total by which deal ARR exceeds billed ARR; for the others it is the won ARR that is misattributed.',
    }),
    get_arr_by_channel: ({ view }) => ({ view, ...arr[view] }),
    get_check_details: ({ check, limit = 20 }) => {
      const c = checks[check];
      if (!c) throw new Error(`unknown check ${check}`);
      if (check === 'C5') {
        return {
          check,
          mismatches: c.mismatches.slice(0, limit),
          won_deals_with_no_subscription: c.unbilled.slice(0, limit),
          paying_customers_with_no_deal: c.unmatched_subscriptions.slice(0, limit),
        };
      }
      return { check, total_items: c.items.length, items: c.items.slice(0, limit) };
    },
    get_records: ({ kind, ids }) => {
      const source = { contact: contacts, deal: deals, subscription: billing }[kind];
      const key = kind === 'subscription' ? 'subscription_id' : 'id';
      const want = new Set(ids.slice(0, 20));
      return { kind, records: source.filter((r) => want.has(r[key])) };
    },
    empty_source_by_week: () => {
      const weeks = new Map();
      for (const c of contacts) {
        const d = new Date(`${c.createdate}T00:00:00Z`);
        const monday = addDays(c.createdate, -((d.getUTCDay() + 6) % 7));
        const w = weeks.get(monday) ?? { week_start: monday, new_contacts: 0, empty_source: 0 };
        w.new_contacts += 1;
        if (!c.utm_source) w.empty_source += 1;
        weeks.set(monday, w);
      }
      return {
        weeks: [...weeks.values()].sort((a, b) => a.week_start.localeCompare(b.week_start))
          .map((w) => ({ ...w, empty_share: pct(w.empty_source / w.new_contacts) })),
      };
    },
  };

  return {
    seenNumbers,
    call(name, input) {
      const h = handlers[name];
      if (!h) throw new Error(`unknown tool ${name}`);
      return remember(h(input ?? {}));
    },
  };
}

export { usd, UNKNOWN };
