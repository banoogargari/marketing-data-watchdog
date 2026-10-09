# Marketing Data Watchdog

An agent that answers one question: **"How much ARR did marketing source, by channel, and can we trust that number?"**

It walks the chain *contact → deal → closed won → ARR → billed in Stripe*, finds the links that are broken, measures how much ARR each one moves, and proposes fixes for a person to approve.

> 🚧 Work in progress. See [SPEC.md](SPEC.md) for the full plan.

## Status

- [x] Spec
- [x] Test data generator with planted problems (8 scenarios + answer keys)
- [x] ARR by channel, before and after fixes
- [x] Five checks (C1–C5), tested against every scenario's answer key
- [ ] Agent (Claude) that investigates and explains
- [ ] Verifier + HTML report
- [ ] Eval scorer
- [ ] Live HubSpot source
- [ ] Demo

## Run it

Requires Node.js 20+. No API keys needed yet.

```bash
npm run seed                    # (re)generate the test scenarios
npm test                        # check every check against the answer keys
npm run checks -- everything    # see the checks' findings for one scenario
```

Scenarios: `clean`, `missing-source`, `channel-spelling`, `duplicates`, `orphan-deals`, `billing-gap`, `everything`, `subtle`.
