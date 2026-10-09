// Every check is tested against the answer key (ground truth) of every
// scenario: it must find exactly the planted problems, with exact dollar
// amounts, and find nothing in the clean scenario.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { loadScenario } from '../src/sources/files.js';
import { runChecks } from '../src/checks/index.js';
import { asObject } from '../src/attribution.js';
import { daysBetween } from '../src/lib/dates.js';

const SCENARIOS = readdirSync(new URL('../evals/scenarios/', import.meta.url));
const sorted = (xs) => [...xs].sort();

for (const name of SCENARIOS) {
  const { truth, ...data } = loadScenario(name);
  const { checks, arr } = runChecks({ ...data, period: truth.period });

  test(`${name}: only the planted checks report an issue`, () => {
    const flagged = Object.values(checks).filter((c) => c.status === 'issue').map((c) => c.check);
    assert.deepEqual(sorted(flagged), sorted(truth.problems));
  });

  test(`${name}: ARR by channel (reported and after fixes) matches the answer key`, () => {
    assert.deepEqual(asObject(arr.reported), truth.arr_by_channel.reported);
    assert.deepEqual(asObject(arr.after_fixes), truth.arr_by_channel.after_fixes);
    assert.equal(arr.reported.total, truth.total_arr);
    assert.equal(arr.after_fixes.total, truth.total_arr);
  });

  if (truth.C1) test(`${name}: C1 missing source`, () => {
    const c = checks.C1;
    assert.deepEqual(sorted(c.deal_ids), sorted(truth.C1.deal_ids));
    assert.equal(c.arr_affected, truth.C1.arr);
    assert.ok(c.change, 'a sudden change should be detected');
    assert.ok(Math.abs(daysBetween(truth.C1.start_date, c.change.start_date)) <= 7,
      `start ${c.change.start_date} should be within 7 days of ${truth.C1.start_date}`);
  });

  if (truth.C2) test(`${name}: C2 channel spelling`, () => {
    const got = Object.fromEntries(checks.C2.items.map((i) => [i.variant, i]));
    assert.deepEqual(sorted(Object.keys(got)), sorted(truth.C2.variants.map((v) => v.variant)));
    for (const v of truth.C2.variants) {
      assert.equal(got[v.variant].suggested_channel, v.channel, v.variant);
      assert.equal(got[v.variant].arr, v.arr, v.variant);
      assert.equal(got[v.variant].contacts, v.contacts, v.variant);
    }
  });

  if (truth.C3) test(`${name}: C3 duplicates`, () => {
    const got = checks.C3.items.map((i) => `${i.keep_id}>${i.duplicate_id}`);
    assert.deepEqual(sorted(got), sorted(truth.C3.groups.map((g) => `${g.keep}>${g.duplicate}`)));
    assert.equal(checks.C3.arr_affected, truth.C3.arr);
  });

  if (truth.C4) test(`${name}: C4 orphan deals`, () => {
    const got = Object.fromEntries(checks.C4.items.map((i) => [i.deal_id, i.suggested_contact_id]));
    assert.deepEqual(sorted(Object.keys(got)), sorted(truth.C4.deals.map((d) => d.deal_id)));
    for (const d of truth.C4.deals) assert.equal(got[d.deal_id], d.true_contact_id, d.deal_id);
    assert.equal(checks.C4.arr_affected, truth.C4.arr);
  });

  if (truth.C5) test(`${name}: C5 billing`, () => {
    const c = checks.C5;
    const strip = ({ deal_id, deal_arr, billed_arr, difference }) => ({ deal_id, deal_arr, billed_arr, difference });
    const byDeal = (a, b) => a.deal_id.localeCompare(b.deal_id);
    assert.deepEqual(c.mismatches.map(strip).sort(byDeal), [...truth.C5.mismatches].sort(byDeal));
    assert.deepEqual(sorted(c.unbilled.map((u) => u.deal_id)), sorted(truth.C5.unbilled_deal_ids));
    assert.deepEqual(sorted(c.unmatched_subscriptions.map((s) => s.subscription_id)), sorted(truth.C5.unmatched_subscription_ids));
  });
}
