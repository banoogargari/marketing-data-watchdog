// Marketing-sourced ARR by channel: the number this whole project protects.
//
// ARR of a channel = sum of `amount` on deals won in the period, grouped by the
// utm_source of the contact the deal is linked to.

import { inPeriod } from './lib/dates.js';
import { UNKNOWN } from './config.js';

export const wonInPeriod = (deals, period) =>
  deals.filter((d) => d.dealstage === 'closedwon' && inPeriod(d.closedate, period));

/**
 * @param {object}   args
 * @param {object[]} args.deals
 * @param {object[]} args.contacts
 * @param {object}   args.period      { start, end }
 * @param {object}  [args.channelMap] raw utm_source -> approved channel (fix for C2)
 * @param {object}  [args.merges]     duplicate contact id -> contact id to keep (fix for C3)
 * @returns {{ rows: {channel:string, arr:number, deals:number}[], total:number }}
 */
export function arrByChannel({ deals, contacts, period, channelMap = {}, merges = {} }) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const totals = new Map();
  for (const deal of wonInPeriod(deals, period)) {
    const contactId = merges[deal.contact_id] ?? deal.contact_id;
    const raw = contactId ? byId.get(contactId)?.utm_source : '';
    const channel = raw ? channelMap[raw] ?? raw : UNKNOWN;
    const t = totals.get(channel) ?? { channel, arr: 0, deals: 0 };
    t.arr += deal.amount;
    t.deals += 1;
    totals.set(channel, t);
  }
  const rows = [...totals.values()].sort((a, b) => b.arr - a.arr);
  return { rows, total: rows.reduce((s, r) => s + r.arr, 0) };
}

export const asObject = ({ rows }) => Object.fromEntries(rows.map((r) => [r.channel, r.arr]));
