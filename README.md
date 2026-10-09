# Marketing Data Watchdog

An agent that answers one question: **"How much ARR did marketing source, by channel, and can we trust that number?"**

It walks the chain *contact → deal → closed won → ARR → billed in Stripe*, finds the links that are broken, measures how much ARR each one moves, and proposes fixes for a person to approve.

> 🚧 Work in progress. See [SPEC.md](SPEC.md) for the full plan.

## Status

- [x] Spec
- [x] Test data generator with planted problems (8 scenarios + answer keys)
- [x] ARR by channel, before and after fixes
- [x] Five checks (C1–C5), tested against every scenario's answer key
- [x] Agent (Claude) that investigates, explains and decides which channels to trust
- [x] Verifier: findings are rejected unless every number is traceable and every affected channel is flagged
- [x] HTML + Markdown report, proposed-fix CSVs
- [x] Eval scorer
- [ ] First real eval run + results table here
- [ ] Live HubSpot source
- [ ] Demo

## Run it

Requires Node.js 20+.

```bash
npm install
npm test                                        # 42 tests, no API key needed

# The agent, with a scripted stand-in for Claude (free, no key):
npm run watchdog -- --scenario everything --sim

# The agent with Claude (needs ANTHROPIC_API_KEY in .env, copy .env.example):
npm run watchdog -- --scenario everything
open reports/everything-*/report.html

# Grade the agent on every scenario against the answer keys:
npm run eval -- --runs 1

# Other tools
npm run seed                                    # regenerate the test scenarios
npm run checks -- everything                    # the checks alone, no AI
```

Scenarios: `clean`, `missing-source`, `channel-spelling`, `duplicates`, `orphan-deals`, `billing-gap`, `everything`, `subtle`.
