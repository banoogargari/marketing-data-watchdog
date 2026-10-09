// C5 — Deal ARR vs. what Stripe actually bills.
// Matching: exact email first, then same company email domain ("needs review").
// Amounts are compared only AFTER matching, never used to match.

import { normalizeEmail, emailDomain } from '../lib/email.js';
import { wonInPeriod } from '../attribution.js';

export const billedArr = (sub) => (sub.interval === 'month' ? sub.amount * 12 : sub.amount);

export function checkBilling({ contacts, deals, billing, period, orphanSuggestions = {} }) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const active = billing.filter((s) => s.status === 'active');
  const findSub = (email) => {
    const exact = active.find((s) => normalizeEmail(s.customer_email) === normalizeEmail(email));
    if (exact) return { sub: exact, matched_by: 'email' };
    const domain = active.find((s) => emailDomain(s.customer_email) === emailDomain(email));
    return domain ? { sub: domain, matched_by: 'domain (needs review)' } : null;
  };

  const mismatches = [];
  const unbilled = [];
  const notCheckable = [];
  let matched = 0;
  for (const d of wonInPeriod(deals, period)) {
    const contact = d.contact_id && byId.get(d.contact_id);
    if (!contact) { notCheckable.push(d.id); continue; }
    const m = findSub(contact.email);
    if (!m) { unbilled.push({ deal_id: d.id, deal_arr: d.amount, contact_email: contact.email }); continue; }
    matched += 1;
    const billed = billedArr(m.sub);
    if (billed !== d.amount) {
      mismatches.push({
        deal_id: d.id, subscription_id: m.sub.subscription_id, matched_by: m.matched_by,
        deal_arr: d.amount, billed_arr: billed, difference: d.amount - billed,
      });
    }
  }

  // Paying customers with no won deal (any period). Contacts suggested for
  // unlinked deals (C4) count as linked, so they aren't reported twice.
  const linkedEmails = new Set();
  const linkedDomains = new Set();
  const link = (c) => { if (c) { linkedEmails.add(normalizeEmail(c.email)); linkedDomains.add(emailDomain(c.email)); } };
  deals.filter((d) => d.dealstage === 'closedwon').forEach((d) => link(byId.get(d.contact_id ?? orphanSuggestions[d.id])));
  const unmatchedSubs = active
    .filter((s) => !linkedEmails.has(normalizeEmail(s.customer_email)) && !linkedDomains.has(emailDomain(s.customer_email)))
    .map((s) => ({ subscription_id: s.subscription_id, customer_email: s.customer_email, billed_arr: billedArr(s), start_date: s.start_date }));

  const issues = mismatches.length + unbilled.length + unmatchedSubs.length;
  return {
    check: 'C5',
    name: 'Deal ARR vs. billed ARR',
    status: issues ? 'issue' : 'ok',
    deals_checked: matched,
    deal_ids: [...mismatches.map((m) => m.deal_id), ...unbilled.map((u) => u.deal_id)],
    arr_affected: mismatches.reduce((s, m) => s + m.difference, 0),
    mismatches,
    unbilled,
    unmatched_subscriptions: unmatchedSubs,
    not_checkable_deal_ids: notCheckable,
  };
}
