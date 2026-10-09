// Runs all five checks in the right order (some use results of others) and
// returns the fixes that can be applied safely to compute "ARR after fixes".

import { checkDuplicates } from './duplicates.js';
import { checkMissingSource } from './missing-source.js';
import { checkChannelSpelling } from './channel-spelling.js';
import { checkOrphanDeals } from './orphan-deals.js';
import { checkBilling } from './billing.js';
import { arrByChannel } from '../attribution.js';

export function runChecks({ contacts, deals, billing, period }) {
  const C3 = checkDuplicates({ contacts, deals, period });
  const C1 = checkMissingSource({ contacts, deals, period, excludeContactIds: new Set(Object.keys(C3.merges)) });
  const C2 = checkChannelSpelling({ contacts, deals, period });
  const C4 = checkOrphanDeals({ contacts, deals, period });
  const orphanSuggestions = Object.fromEntries(C4.items.map((i) => [i.deal_id, i.suggested_contact_id]));
  const C5 = checkBilling({ contacts, deals, billing, period, orphanSuggestions });

  const fixes = { channelMap: C2.channelMap, merges: C3.merges };
  return {
    checks: { C1, C2, C3, C4, C5 },
    fixes,
    arr: {
      reported: arrByChannel({ deals, contacts, period }),
      after_fixes: arrByChannel({ deals, contacts, period, ...fixes }),
    },
  };
}
