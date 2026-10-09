// Generates the test scenarios: fake HubSpot contacts and deals, fake Stripe
// billing, and a ground-truth answer key listing every planted problem.
//
//   npm run seed
//
// Output: evals/scenarios/<scenario>/{contacts,deals,billing,ground-truth}.json
// Everything is seeded, so the output is identical on every run.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../src/lib/rng.js';
import { addDays, daysBetween } from '../src/lib/dates.js';
import { PERIOD, UNKNOWN } from '../src/config.js';

const OUT_DIR = new URL('../evals/scenarios/', import.meta.url).pathname;
const BASE_SEED = 20261001;

const CHANNEL_WEIGHTS = [
  ['linkedin', 22], ['google_ads', 25], ['email', 18],
  ['webinar', 12], ['organic', 13], ['referral', 10],
];
const MEDIUM = {
  linkedin: 'paid_social', google_ads: 'cpc', email: 'email',
  webinar: 'event', organic: 'organic', referral: 'referral',
};
// ARR amounts are multiples of 1,200 so monthly plans are whole dollars.
const AMOUNTS = [6000, 9600, 12000, 18000, 24000, 30000, 36000, 48000];

const FIRST = ['Ava', 'Ben', 'Chloe', 'Daniel', 'Elena', 'Farid', 'Grace', 'Hiro', 'Isla', 'Jonah',
  'Kira', 'Leo', 'Maya', 'Nikhil', 'Olivia', 'Pedro', 'Quinn', 'Rosa', 'Sam', 'Tara',
  'Umar', 'Vera', 'Wes', 'Ximena', 'Yusuf', 'Zoe', 'Arash', 'Bianca', 'Chen', 'Dara'];
const LAST = ['Adams', 'Brooks', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Hassan', 'Ito', 'Johnson',
  'Khan', 'Lopez', 'Moreau', 'Nguyen', 'Okafor', 'Patel', 'Quint', 'Rossi', 'Silva', 'Tanaka',
  'Usman', 'Varga', 'Weber', 'Xu', 'Young', 'Zimmer', 'Rahimi', 'Kowalski', 'Novak', 'Berg'];
const CO_A = ['Blue', 'North', 'Bright', 'Iron', 'Cedar', 'Silver', 'Quantum', 'Harbor', 'Summit', 'Pixel',
  'Atlas', 'Nimbus', 'Coral', 'Granite', 'Echo', 'Lumen', 'Orbit', 'Prairie', 'Vector', 'Willow'];
const CO_B = ['Labs', 'Systems', 'Analytics', 'Health', 'Logistics', 'Robotics', 'Learning', 'Finance',
  'Cloud', 'Media', 'Foods', 'Energy', 'Works', 'Bio', 'Retail'];

// ---------------------------------------------------------------------------
// Base data: a clean, realistic B2B setup with no problems.
// ---------------------------------------------------------------------------
function buildBase() {
  const rng = makeRng(BASE_SEED);

  const companies = [];
  for (const a of CO_A) for (const b of CO_B) companies.push({ name: `${a} ${b}`, domain: `${a}${b}.com`.toLowerCase() });
  const shuffledCompanies = rng.shuffle(companies);

  const contacts = [];
  const deals = [];
  const billing = [];
  const trueChannel = {}; // deal id -> the channel that really sourced it
  let cId = 1000, dId = 5000, sId = 9000;

  const usedEmails = new Set();
  const newContact = (company, channel, createdate) => {
    let first, last, email;
    do {
      first = rng.pick(FIRST); last = rng.pick(LAST);
      email = `${first}.${last}@${company.domain}`.toLowerCase();
    } while (usedEmails.has(email));
    usedEmails.add(email);
    const c = {
      id: `c${++cId}`,
      email,
      firstname: first,
      lastname: last,
      company: company.name,
      createdate,
      utm_source: channel ?? '',
      utm_medium: channel ? MEDIUM[channel] : '',
      utm_campaign: channel ? `${channel}_${createdate.slice(0, 7).replace('-', '_')}` : '',
      lifecyclestage: 'lead',
    };
    contacts.push(c);
    return c;
  };

  const randomDate = (start, end) => addDays(start, rng.int(0, daysBetween(start, end)));

  // Deals: 70 won in Q3 (the reporting period), 40 won in Q2, 30 lost/open in Q3.
  const dealPlan = [
    ...Array(70).fill(['closedwon', PERIOD.start, PERIOD.end]),
    ...Array(40).fill(['closedwon', '2026-04-01', '2026-06-30']),
    ...Array(15).fill(['closedlost', PERIOD.start, PERIOD.end]),
    ...Array(15).fill(['contractsent', PERIOD.start, PERIOD.end]),
  ];
  let ci = 0;
  for (const [stage, start, end] of dealPlan) {
    const company = shuffledCompanies[ci++];
    const channel = rng.weighted(CHANNEL_WEIGHTS);
    const closedate = randomDate(start, end);
    const contact = newContact(company, channel, addDays(closedate, -rng.int(20, 120)));
    contact.lifecyclestage = stage === 'closedwon' ? 'customer' : 'opportunity';
    const deal = {
      id: `d${++dId}`,
      dealname: `${company.name} — New business`,
      company: company.name,
      amount: rng.pick(AMOUNTS),
      dealstage: stage,
      closedate,
      contact_id: contact.id,
    };
    deals.push(deal);
    trueChannel[deal.id] = channel;

    if (stage === 'closedwon') {
      const monthly = rng.next() < 0.5;
      billing.push({
        subscription_id: `sub_${++sId}`,
        // Most customers pay with the same email; some use a billing@ address.
        customer_email: rng.next() < 0.8 ? contact.email : `billing@${company.domain}`,
        amount: monthly ? deal.amount / 12 : deal.amount,
        interval: monthly ? 'month' : 'year',
        status: 'active',
        start_date: addDays(closedate, rng.int(0, 5)),
      });
    }
  }

  // Leads: contacts at other companies that never became deals.
  // About 2% arrive with no source: normal background noise, not a problem.
  while (ci < shuffledCompanies.length) {
    const company = shuffledCompanies[ci++];
    for (let k = rng.int(1, 3); k > 0; k--) {
      const channel = rng.next() < 0.02 ? null : rng.weighted(CHANNEL_WEIGHTS);
      newContact(company, channel, randomDate('2026-03-01', PERIOD.end));
    }
  }

  return { contacts, deals, billing, trueChannel };
}

// ---------------------------------------------------------------------------
// Planting problems. Each planter changes the data and returns its answer key.
// ---------------------------------------------------------------------------
function plant(base, cfg, seed) {
  const rng = makeRng(seed);
  const data = structuredClone(base);
  const { contacts, deals, billing, trueChannel } = data;
  const contactById = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const usedContacts = new Set();
  const truth = {};
  let nextContactId = 1000 + contacts.length + 500;
  let nextSubId = 9500;

  // Pool of Q3 won deals; each planted problem takes its own deals so problems
  // don't overlap and each one's ARR impact is unambiguous.
  let pool = rng.shuffle(deals.filter((d) => d.dealstage === 'closedwon' && d.closedate >= PERIOD.start));
  const take = (n, pred = () => true) => {
    const picked = [];
    pool = pool.filter((d) => {
      if (picked.length < n && pred(d)) { picked.push(d); return false; }
      return true;
    });
    if (picked.length < n) throw new Error(`not enough deals for ${n}`);
    picked.forEach((d) => usedContacts.add(d.contact_id));
    return picked;
  };
  const sum = (ds) => ds.reduce((s, d) => s + d.amount, 0);
  const leads = () => contacts.filter((c) => c.lifecyclestage === 'lead' && !usedContacts.has(c.id));

  // C2 — the same channel spelled several ways.
  if (cfg.spelling) {
    truth.C2 = { variants: [] };
    for (const [channel, variants] of Object.entries(cfg.spelling.variants)) {
      for (const variant of variants) {
        const ds = take(cfg.spelling.dealsPerVariant, (d) => trueChannel[d.id] === channel);
        ds.forEach((d) => { contactById[d.contact_id].utm_source = variant; });
        const ls = rng.shuffle(leads().filter((c) => c.utm_source === channel)).slice(0, cfg.spelling.leadsPerVariant);
        ls.forEach((c) => { c.utm_source = variant; usedContacts.add(c.id); });
        truth.C2.variants.push({
          variant, channel,
          contacts: ds.length + ls.length,
          deal_ids: ds.map((d) => d.id),
          arr: sum(ds),
        });
      }
    }
  }

  // C3 — duplicate contacts. Sales creates a second record (no source) and
  // puts the deal on it, so the deal's ARR falls into "Unknown".
  if (cfg.duplicates) {
    truth.C3 = { groups: [], deal_ids: [], arr: 0 };
    const variantEmail = (email, i) => {
      if (i % 2 === 0) return email.replace('@', '+sales@');
      const [local, domain] = email.split('@');
      const cap = (s) => s.replace(/(^|\.)([a-z])/g, (m) => m.toUpperCase());
      return `${cap(local)}@${cap(domain)}`;
    };
    const makeDup = (orig, i, createdate) => {
      const dup = {
        ...orig,
        id: `c${++nextContactId}`,
        email: variantEmail(orig.email, i),
        createdate,
        utm_source: '', utm_medium: '', utm_campaign: '',
      };
      contacts.push(dup);
      usedContacts.add(orig.id).add(dup.id);
      return dup;
    };
    take(cfg.duplicates.deals).forEach((d, i) => {
      const orig = contactById[d.contact_id];
      const dup = makeDup(orig, i, addDays(d.closedate, -rng.int(1, 10)));
      d.contact_id = dup.id;
      truth.C3.groups.push({ keep: orig.id, duplicate: dup.id, deal_id: d.id, channel: orig.utm_source, arr: d.amount });
      truth.C3.deal_ids.push(d.id);
      truth.C3.arr += d.amount;
    });
    rng.shuffle(leads().filter((c) => c.utm_source && c.createdate < '2026-09-01'))
      .slice(0, cfg.duplicates.leads)
      .forEach((orig, i) => {
        const dup = makeDup(orig, i, addDays(orig.createdate, rng.int(1, 25)));
        truth.C3.groups.push({ keep: orig.id, duplicate: dup.id, deal_id: null, channel: orig.utm_source, arr: 0 });
      });
  }

  // C4 — won deals not linked to any contact.
  if (cfg.orphans) {
    const ds = take(cfg.orphans.deals);
    truth.C4 = {
      deals: ds.map((d) => ({ deal_id: d.id, arr: d.amount, true_contact_id: d.contact_id })),
      arr: sum(ds),
    };
    ds.forEach((d) => { d.contact_id = null; });
  }

  // C5 — deal ARR doesn't match what Stripe bills.
  if (cfg.billing) {
    truth.C5 = { mismatches: [], unbilled_deal_ids: [], unmatched_subscription_ids: [] };
    const subFor = (d) => {
      const c = contactById[d.contact_id];
      const domain = c.email.split('@')[1];
      return billing.find((s) => s.customer_email === c.email || s.customer_email === `billing@${domain}`);
    };
    take(cfg.billing.mismatches, (d) => d.amount >= 9600).forEach((d) => {
      const sub = subFor(d);
      const delta = cfg.billing.delta ?? rng.pick([1200, 2400, 3600, 6000].filter((x) => x < d.amount));
      const billed = d.amount - delta;
      sub.amount = sub.interval === 'month' ? billed / 12 : billed;
      truth.C5.mismatches.push({ deal_id: d.id, deal_arr: d.amount, billed_arr: billed, difference: d.amount - billed });
    });
    take(cfg.billing.unbilled).forEach((d) => {
      billing.splice(billing.indexOf(subFor(d)), 1);
      truth.C5.unbilled_deal_ids.push(d.id);
    });
    rng.shuffle(leads()).slice(0, cfg.billing.selfServe).forEach((c) => {
      const sub = {
        subscription_id: `sub_${++nextSubId}`,
        customer_email: c.email,
        amount: rng.pick([100, 200, 300]),
        interval: 'month',
        status: 'active',
        start_date: addDays(PERIOD.start, rng.int(0, 80)),
      };
      billing.push(sub);
      usedContacts.add(c.id);
      truth.C5.unmatched_subscription_ids.push(sub.subscription_id);
    });
  }

  // C1 — utm_source stops arriving from a given date (e.g. a form broke).
  if (cfg.missing) {
    const start = cfg.missing.startDate;
    const ds = take(cfg.missing.deals, (d) => d.closedate >= addDays(start, 15));
    ds.forEach((d) => {
      const c = contactById[d.contact_id];
      c.createdate = addDays(start, rng.int(0, daysBetween(start, d.closedate) - 10));
    });
    const affected = [
      ...ds.map((d) => contactById[d.contact_id]),
      ...leads().filter((c) => c.createdate >= start && c.utm_source && rng.next() < cfg.missing.rate),
    ];
    affected.forEach((c) => { c.utm_source = ''; c.utm_medium = ''; c.utm_campaign = ''; usedContacts.add(c.id); });
    truth.C1 = {
      start_date: affected.map((c) => c.createdate).sort()[0],
      contacts: affected.length,
      deal_ids: ds.map((d) => d.id),
      arr: sum(ds),
    };
  }

  // Answer key for the ARR report itself.
  const wonInPeriod = deals.filter((d) => d.dealstage === 'closedwon' && d.closedate >= PERIOD.start && d.closedate <= PERIOD.end);
  const group = (keyOf) => {
    const out = {};
    for (const d of wonInPeriod) { const k = keyOf(d); out[k] = (out[k] ?? 0) + d.amount; }
    return out;
  };
  const lostForGood = new Set([...(truth.C1?.deal_ids ?? []), ...(truth.C4?.deals.map((x) => x.deal_id) ?? [])]);
  truth.arr_by_channel = {
    // What a dashboard grouping by the raw utm_source shows today.
    reported: group((d) => (d.contact_id && contactById[d.contact_id]?.utm_source) || UNKNOWN),
    // After applying the fixes that can be made safely (channel map + merges).
    // Missing sources and unlinked deals stay Unknown: they need a human.
    after_fixes: group((d) => (lostForGood.has(d.id) ? UNKNOWN : trueChannel[d.id])),
  };
  truth.total_arr = wonInPeriod.reduce((s, d) => s + d.amount, 0);

  delete data.trueChannel;
  return { data, truth };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const ALL = {
  missing: { startDate: '2026-08-14', deals: 5, rate: 0.35 },
  spelling: {
    variants: { linkedin: ['LinkedIn', 'li', 'linkedin.com'], google_ads: ['Google Ads', 'adwords'] },
    dealsPerVariant: 2,
    leadsPerVariant: 8,
  },
  duplicates: { deals: 6, leads: 6 },
  orphans: { deals: 4 },
  billing: { mismatches: 3, unbilled: 1, selfServe: 2 },
};

const SCENARIOS = {
  clean: { description: 'No planted problems. Tests for false alarms.', cfg: {} },
  'missing-source': { description: 'utm_source goes empty for 35% of new contacts from Aug 14.', cfg: { missing: ALL.missing } },
  'channel-spelling': { description: 'linkedin and google_ads each spelled several ways.', cfg: { spelling: ALL.spelling } },
  duplicates: { description: 'Duplicate contacts; deals sit on the copy that has no source.', cfg: { duplicates: ALL.duplicates } },
  'orphan-deals': { description: 'Won deals not linked to any contact.', cfg: { orphans: ALL.orphans } },
  'billing-gap': { description: 'Deal ARR differs from Stripe; a deal never billed; customers paying with no deal.', cfg: { billing: ALL.billing } },
  everything: { description: 'All of the above at once.', cfg: ALL },
  subtle: {
    description: 'Small versions of every problem, to test sensitivity.',
    cfg: {
      missing: { startDate: '2026-08-21', deals: 2, rate: 0.15 },
      spelling: { variants: { linkedin: ['Linkedin'] }, dealsPerVariant: 1, leadsPerVariant: 2 },
      duplicates: { deals: 2, leads: 0 },
      orphans: { deals: 1 },
      billing: { mismatches: 1, unbilled: 0, selfServe: 0, delta: 1200 },
    },
  },
};

function main() {
  const base = buildBase();
  rmSync(OUT_DIR, { recursive: true, force: true });
  Object.entries(SCENARIOS).forEach(([name, { description, cfg }], i) => {
    const { data, truth } = plant(base, cfg, BASE_SEED + 1 + i);
    const dir = join(OUT_DIR, name);
    mkdirSync(dir, { recursive: true });
    const write = (file, obj) => writeFileSync(join(dir, file), JSON.stringify(obj, null, 2) + '\n');
    write('contacts.json', data.contacts);
    write('deals.json', data.deals);
    write('billing.json', data.billing);
    write('ground-truth.json', { scenario: name, description, period: PERIOD, problems: Object.keys(truth).filter((k) => /^C\d$/.test(k)), ...truth });
    console.log(`${name.padEnd(17)} ${String(data.contacts.length).padStart(4)} contacts  ${data.deals.length} deals  ${data.billing.length} subscriptions  problems: ${Object.keys(truth).filter((k) => /^C\d$/.test(k)).join(', ') || 'none'}`);
  });
}

main();
