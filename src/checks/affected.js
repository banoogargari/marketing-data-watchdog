// Which rows of the ARR-by-channel report each problem makes untrustworthy.
// Computed in code so the agent can't "forget" a channel: the verifier uses
// this to make sure every affected channel is marked ⚠️.

import { UNKNOWN } from '../config.js';

export function affectedChannels({ checks, contacts, deals }) {
  const out = {}; // channel -> Set(check ids)
  const add = (channel, check) => { (out[channel] ??= new Set()).add(check); };
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const reportedChannel = (dealId) => {
    const d = dealById.get(dealId);
    return (d?.contact_id && contactById.get(d.contact_id)?.utm_source) || UNKNOWN;
  };
  const { C1, C2, C3, C4, C5 } = checks;

  if (C1.deal_ids.length) add(UNKNOWN, 'C1');
  for (const i of C2.items) {
    if (!i.deal_ids.length) continue;
    add(i.variant, 'C2');
    if (i.suggested_channel) add(i.suggested_channel, 'C2');
  }
  for (const i of C3.items) {
    if (!i.arr_moved_from_unknown) continue;
    add(UNKNOWN, 'C3');
    if (i.keep_source) add(i.keep_source, 'C3');
  }
  if (C4.deal_ids.length) add(UNKNOWN, 'C4');
  for (const id of C5.deal_ids) add(reportedChannel(id), 'C5');

  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}
