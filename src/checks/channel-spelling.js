// C2 — Channel spelled several ways.
// Any utm_source that isn't on the approved channel list splits one channel's
// ARR across several rows. We suggest which approved channel it belongs to.

import { CHANNELS, CHANNEL_ALIASES } from '../config.js';
import { wonInPeriod } from '../attribution.js';

export function suggestChannel(raw) {
  const s = raw.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/\.(com|net|org|io|co)$/, '')
    .replace(/[\s.-]+/g, '_');
  if (CHANNELS.includes(s)) return s;
  const squashed = s.replace(/_/g, '');
  return CHANNEL_ALIASES[s] ?? CHANNEL_ALIASES[squashed] ?? CHANNELS.find((c) => c.replace(/_/g, '') === squashed) ?? null;
}

export function checkChannelSpelling({ contacts, deals, period }) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const won = wonInPeriod(deals, period);
  const values = new Map();
  for (const c of contacts) {
    if (!c.utm_source || CHANNELS.includes(c.utm_source)) continue;
    if (!values.has(c.utm_source)) values.set(c.utm_source, { variant: c.utm_source, contacts: 0, deal_ids: [], arr: 0 });
    values.get(c.utm_source).contacts += 1;
  }
  for (const d of won) {
    const v = values.get(d.contact_id && byId.get(d.contact_id)?.utm_source);
    if (v) { v.deal_ids.push(d.id); v.arr += d.amount; }
  }
  const items = [...values.values()]
    .map((v) => ({ ...v, suggested_channel: suggestChannel(v.variant) }))
    .sort((a, b) => b.arr - a.arr);
  const channelMap = Object.fromEntries(items.filter((i) => i.suggested_channel).map((i) => [i.variant, i.suggested_channel]));

  return {
    check: 'C2',
    name: 'Channel spelled several ways',
    status: items.length ? 'issue' : 'ok',
    deal_ids: items.flatMap((i) => i.deal_ids),
    arr_affected: items.reduce((s, i) => s + i.arr, 0),
    unmapped: items.filter((i) => !i.suggested_channel).map((i) => i.variant),
    items,
    channelMap,
  };
}
