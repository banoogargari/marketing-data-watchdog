// Conventions the checks rely on. Written down here so they are the single
// source of truth (and easy to change).

// Reporting period: Q3 2026.
export const PERIOD = { start: '2026-07-01', end: '2026-09-30', label: 'Q3 2026' };

// The approved list of channel names. Any utm_source not on this list is a
// "spelling" problem (check C2).
export const CHANNELS = ['linkedin', 'google_ads', 'email', 'webinar', 'organic', 'referral'];

// Known abbreviations/aliases, used to suggest which approved channel an
// unapproved value belongs to.
export const CHANNEL_ALIASES = {
  li: 'linkedin',
  lnkd: 'linkedin',
  google: 'google_ads',
  googleads: 'google_ads',
  adwords: 'google_ads',
  gads: 'google_ads',
  newsletter: 'email',
  webinars: 'webinar',
};

export const UNKNOWN = 'Unknown';

// Check C1: when is a rise in empty utm_source a "sudden" problem?
export const MISSING_SOURCE = {
  minRateAfter: 0.1, // at least 10% of new contacts empty after the change...
  minRatio: 3, // ...and at least 3x the rate before it
  minContactsBefore: 50,
  minContactsAfter: 40,
};
