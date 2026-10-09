// C3 — Duplicate contacts.
// Two records for the same person (same email after normalizing case and
// +tags). When the deal sits on the copy without a source, its ARR shows up
// as "Unknown" instead of the channel that really sourced it.

import { normalizeEmail } from '../lib/email.js';
import { wonInPeriod } from '../attribution.js';

export function checkDuplicates({ contacts, deals, period }) {
  const groups = new Map();
  for (const c of contacts) {
    const key = normalizeEmail(c.email);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const won = wonInPeriod(deals, period);
  const merges = {}; // duplicate id -> id to keep
  const items = [];
  for (const [email, records] of groups) {
    if (records.length < 2) continue;
    // Keep the record that has a source; if several, the oldest one.
    const keep = [...records].sort((a, b) =>
      (b.utm_source ? 1 : 0) - (a.utm_source ? 1 : 0) || a.createdate.localeCompare(b.createdate))[0];
    for (const dup of records) {
      if (dup === keep) continue;
      merges[dup.id] = keep.id;
      const dupDeals = won.filter((d) => d.contact_id === dup.id);
      const arrMoved = dup.utm_source ? 0 : dupDeals.reduce((s, d) => s + d.amount, 0);
      items.push({
        email,
        keep_id: keep.id,
        duplicate_id: dup.id,
        duplicate_email: dup.email,
        keep_source: keep.utm_source || null,
        deal_ids: dupDeals.map((d) => d.id),
        arr_moved_from_unknown: arrMoved,
      });
    }
  }

  const dealIds = items.flatMap((i) => i.deal_ids);
  return {
    check: 'C3',
    name: 'Duplicate contacts',
    status: items.length ? 'issue' : 'ok',
    duplicate_count: items.length,
    deal_ids: dealIds,
    arr_affected: items.reduce((s, i) => s + i.arr_moved_from_unknown, 0),
    items,
    merges,
  };
}
