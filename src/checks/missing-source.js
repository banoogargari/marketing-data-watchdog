// C1 — Missing source.
// Contacts whose utm_source is empty. Two questions:
//   1. How much won ARR sits on contacts with no source? (lands in "Unknown")
//   2. Did empty sources suddenly increase from some date? (e.g. a form broke)

import { MISSING_SOURCE } from '../config.js';
import { wonInPeriod } from '../attribution.js';

/** Find the date where the empty-source rate jumps the most. */
export function findChangePoint(contacts, opts = MISSING_SOURCE) {
  const sorted = [...contacts].sort((a, b) => a.createdate.localeCompare(b.createdate));
  const n = sorted.length;
  const emptyBefore = [0];
  sorted.forEach((c, i) => emptyBefore.push(emptyBefore[i] + (c.utm_source ? 0 : 1)));
  const totalEmpty = emptyBefore[n];

  let best = null;
  for (let i = opts.minContactsBefore; i <= n - opts.minContactsAfter; i++) {
    if (i > 0 && sorted[i].createdate === sorted[i - 1].createdate) continue; // split between days only
    const rb = emptyBefore[i] / i;
    const ra = (totalEmpty - emptyBefore[i]) / (n - i);
    const score = (ra - rb) * Math.sqrt((i * (n - i)) / n);
    if (!best || score > best.score) {
      best = { date: sorted[i].createdate, rate_before: rb, rate_after: ra, contacts_after: n - i, score };
    }
  }
  if (!best) return null;
  const sudden = best.rate_after >= opts.minRateAfter && best.rate_after >= opts.minRatio * best.rate_before;
  if (!sudden) return null;
  // Report the first empty-source contact on/after the change as the start date.
  const first = sorted.find((c) => c.createdate >= best.date && !c.utm_source);
  return {
    start_date: first?.createdate ?? best.date,
    rate_before: round(best.rate_before),
    rate_after: round(best.rate_after),
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

export function checkMissingSource({ contacts, deals, period, excludeContactIds = new Set() }) {
  // Duplicates are excluded: their missing source is explained by C3, and
  // merging fixes them.
  const considered = contacts.filter((c) => !excludeContactIds.has(c.id));
  const byId = new Map(considered.map((c) => [c.id, c]));

  const affectedDeals = wonInPeriod(deals, period).filter((d) => {
    const c = d.contact_id && byId.get(d.contact_id);
    return c && !c.utm_source;
  });
  const change = findChangePoint(considered);
  const emptyContacts = considered.filter((c) => !c.utm_source);

  return {
    check: 'C1',
    name: 'Missing source',
    status: affectedDeals.length || change ? 'issue' : 'ok',
    deal_ids: affectedDeals.map((d) => d.id),
    arr_affected: affectedDeals.reduce((s, d) => s + d.amount, 0),
    contacts_without_source: emptyContacts.length,
    contacts_without_source_since_change: change
      ? emptyContacts.filter((c) => c.createdate >= change.start_date).length
      : null,
    change,
    items: affectedDeals.map((d) => ({ deal_id: d.id, contact_id: d.contact_id, contact_created: byId.get(d.contact_id).createdate, arr: d.amount })),
  };
}
