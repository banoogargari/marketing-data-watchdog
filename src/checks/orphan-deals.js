// C4 — Won deals not linked to any contact.
// Their ARR can't be traced to a channel. We suggest a likely contact from the
// deal's company, but a person must confirm it, so the ARR stays "Unknown".

import { wonInPeriod } from '../attribution.js';

export function checkOrphanDeals({ contacts, deals, period }) {
  const orphans = wonInPeriod(deals, period).filter((d) => !d.contact_id);
  const items = orphans.map((d) => {
    const candidates = contacts
      .filter((c) => d.company && c.company?.toLowerCase() === d.company.toLowerCase())
      .sort((a, b) => (b.utm_source ? 1 : 0) - (a.utm_source ? 1 : 0) || a.createdate.localeCompare(b.createdate));
    const s = candidates[0];
    return {
      deal_id: d.id,
      dealname: d.dealname,
      arr: d.amount,
      suggested_contact_id: s?.id ?? null,
      suggested_contact_email: s?.email ?? null,
      suggested_contact_source: s?.utm_source || null,
      candidates: candidates.length,
      needs_review: true,
    };
  });
  return {
    check: 'C4',
    name: 'Won deals with no contact',
    status: items.length ? 'issue' : 'ok',
    deal_ids: items.map((i) => i.deal_id),
    arr_affected: items.reduce((s, i) => s + i.arr, 0),
    items,
  };
}
