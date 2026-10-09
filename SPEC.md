# Marketing Data Watchdog — Spec

**Status:** Draft v0.1 · **Author:** Banoo Gargari · **Last updated:** 2026-10-08

## 1. Problem

Marketing data lives in several systems — a CRM (HubSpot), a billing system (Stripe), and the dashboards built on top. They are supposed to agree, but they drift apart silently: a form stops filling a field, a sync stops, someone tags a campaign `LinkedIn` instead of `linkedin`. Nobody notices for weeks, and decisions get made on wrong numbers.

Today, catching this depends on a person happening to look. The weekly performance report is assembled by hand, and it presents every number with the same confidence whether or not the data behind it is sound.

## 2. Goal

An agent that checks the marketing data every run, investigates anything that looks wrong, and produces a weekly report that **separates numbers you can trust from numbers you can't, and says why.**

Guiding principle: **an agent reporting confidently on bad data is worse than no agent.** Verification is part of the product, not an afterthought, so the eval suite ships with the agent.

### Success criteria (v1)

Measured by the eval suite (Section 7) across all scenarios:

| Metric | Target |
|---|---|
| Planted issues detected (recall) | ≥ 90% |
| False alarms per scenario | ≤ 1 |
| Affected metrics reported without a caveat ("confident on bad data") | **0** |
| Numbers in the report that don't match a tool result | **0** |
| Clean scenario (no planted issues) | Report says "no issues found" |

## 3. Scope

### In scope (v1)
- **Two sources:** HubSpot contacts and deals (live, via API, from a developer test account) and payments (a local Stripe-shaped JSON file).
- **Four checks** (Section 5).
- **Investigation:** for each failed check, find when it started, how many records, and which metrics it affects.
- **Weekly report** in Markdown: headline metrics, issues found, trust status per metric.
- **Proposed fixes** written to a file (e.g. a duplicate-merge list). Never applied automatically.
- **Eval suite** with planted-issue scenarios and a scored results table.
- **Offline mode:** the same agent runs against local fixture files instead of HubSpot, so evals are fast, free of setup, and repeatable.

### Out of scope (v1)
- Writing anything back to HubSpot or Stripe.
- Scheduling (runs are started from the command line; a cron/GitHub Action is a v2 note).
- Live Stripe API (Stripe test mode is the v2 swap; the payments data already uses Stripe's shape).
- A UI. Output is a CLI run plus a Markdown report.
- PostHog, Customer.io, warehouse, GA4.

## 4. Inputs and outputs

**Inputs**
- HubSpot test account, read through a private-app token (contacts: `email`, `createdate`, `lifecyclestage`, `utm_source`, `utm_medium`, `utm_campaign`; deals: `amount`, `closedate`, `dealstage`, associated contact).
- `data/payments.json`: Stripe-shaped charges/subscriptions (`id`, `customer_email`, `amount`, `currency`, `created`, `status`).
- Reporting window (default: last 7 days).

**Outputs**
- `reports/weekly-YYYY-MM-DD.md`: the report (example in Section 6).
- `reports/run-YYYY-MM-DD.json`: machine-readable findings (used by the eval scorer).
- `reports/proposed-fixes/`: e.g. `duplicate-merges.csv`, `utm-normalization-map.csv`.

## 5. The checks

Each check is deterministic code exposed to the agent as a tool. The tool returns facts; the agent decides what they mean and investigates further.

| # | Check | What it detects | Example finding |
|---|---|---|---|
| C1 | **Duplicate contacts** | Same person stored twice: emails that match after lowercasing/trimming, or Gmail dot/plus variants | "42 duplicate pairs; 30 created on Oct 4" |
| C2 | **Field going empty** | Null rate of a key property jumps vs. its baseline (e.g. `utm_source` 2% → 38%) | "utm_source empty on 38% of contacts since Oct 3" |
| C3 | **Revenue mismatch** | Stripe revenue vs. HubSpot closed-won deal revenue for the same window; lists payments with no matching deal and vice versa | "Stripe $3,870 vs HubSpot $3,410; 6 payments have no deal" |
| C4 | **Messy UTM values** | Variants of the same source/medium (`LinkedIn`, `linkedin`, `li`, `linkedin.com`) splitting one channel into several | "linkedin appears as 4 spellings; channel totals understated" |

**Stretch (if time):** C5 *Stale source* — no new records from a source for longer than expected (the "sync stopped" case).

## 6. How it works

```
         ┌──────────────┐     ┌───────────────┐
         │ HubSpot API  │     │ payments.json │      (or fixture files in offline mode)
         └──────┬───────┘     └───────┬───────┘
                └─────────┬───────────┘
                    data loaders
                          │
          ┌───────────────┴────────────────┐
          │  Tools (deterministic JS)      │
          │  run_checks · get_metrics      │
          │  query_contacts · query_deals  │
          │  query_payments · compare_...  │
          └───────────────┬────────────────┘
                          │ tool calls
                ┌─────────┴─────────┐
                │  Agent (Claude)   │  investigates, decides trust status
                └─────────┬─────────┘
                          │
                 ┌────────┴────────┐
                 │ Report verifier │  every number must match a tool result
                 └────────┬────────┘
                          ▼
            weekly report · findings JSON · proposed fixes
```

**Run steps**
1. Load data for the window (HubSpot or fixtures, plus payments).
2. Agent calls `run_checks` for the summary of C1–C4.
3. For each failed check, the agent investigates with query tools: start date, record count, affected metrics.
4. Agent calls `get_metrics` for headline numbers (signups, closed-won deals, revenue, signups by channel).
5. Agent writes structured findings: each issue has `check`, `severity`, `evidence`, `affected_metrics`, `suggested_fix`.
6. **Verifier** (plain code, not the LLM) checks that every number in the findings and report appears in a tool result, and that every metric listed as affected carries a caveat. If verification fails, the run is marked failed rather than published.
7. Report and fix files are written.

**Design rules**
- **The LLM never does arithmetic.** All counts and sums come from tools; the agent only interprets and explains them.
- **Every claim cites evidence**: a tool result the verifier can check.
- **Read-only.** Fixes are proposals in files; a human applies them.
- **Model is configurable** (`ANTHROPIC_MODEL` in `.env`).

### Example report

> **Weekly Marketing Report: Oct 1–7**
>
> | Metric | Value | Trust |
> |---|---|---|
> | Signups | 1,240 | ✅ |
> | Closed-won deals | 86 | ✅ |
> | Revenue (Stripe) | $3,870 | ✅ |
> | Revenue (HubSpot) | $3,410 | ⚠️ see issue 2 |
> | Signups by channel | — | ⚠️ see issues 1, 4 |
>
> **Issues**
> 1. **utm_source empty on 38% of new contacts since Oct 3** (baseline 2%). Channel attribution for this week is unreliable. Likely cause: a signup form change on Oct 3.
> 2. **Revenue mismatch:** Stripe $3,870 vs HubSpot $3,410. 6 Stripe payments have no HubSpot deal → `proposed-fixes/unmatched-payments.csv`.
> 3. **42 duplicate contacts** (case variants of the same email). Signup count may be overstated by up to 42 → `proposed-fixes/duplicate-merges.csv`.
>
> No issues: lifecycle stages, payment statuses.

## 7. Evaluation

**Scenarios** are generated by a seed script with a fixed random seed. Each has a `ground-truth.json` listing the planted issues.

| Scenario | Planted issues |
|---|---|
| `clean` | none (tests false alarms) |
| `dupes` | duplicate contacts (case + Gmail-dot variants) |
| `null-spike` | `utm_source` goes empty from a given date |
| `revenue-gap` | payments with no deal, and a deal with the wrong amount |
| `utm-mess` | linkedin/facebook spelled several ways |
| `everything` | all of the above at once |
| `subtle` | small versions (e.g. 3 dupes, a 2% → 9% null rise) to test sensitivity |

**Scorer** (`npm run eval`) compares `run-*.json` with ground truth and outputs:
- recall per check type and overall
- false positives per scenario
- confident-on-bad-data count (affected metric shown as ✅)
- verifier failures
- cost and run time per scenario

Results go into a table in the README. Each scenario runs 3 times to show consistency.

## 8. Tech stack

- Node.js 20+, JavaScript (ES modules)
- `@anthropic-ai/sdk` with tool use for the agent loop
- `@hubspot/api-client` for HubSpot
- `dotenv` for secrets; `.env` is git-ignored, `.env.example` is committed
- No database for v1: data is loaded into memory (small volumes)

## 9. Repo layout

```
marketing-data-watchdog/
├── SPEC.md
├── README.md               # what it is, how to run, eval results, demo link
├── .env.example
├── src/
│   ├── index.js            # CLI entry: npm run watchdog -- --source hubspot|fixtures
│   ├── agent.js            # agent loop + system prompt
│   ├── tools/              # tool definitions the agent can call
│   ├── checks/             # C1–C4, pure functions, unit-tested
│   ├── sources/            # hubspot.js, fixtures.js, payments.js
│   ├── verify.js           # report verifier
│   └── report.js           # Markdown writer
├── scripts/
│   ├── seed-fixtures.js    # generates scenarios + ground truth
│   └── seed-hubspot.js     # loads a scenario into the HubSpot test account
├── evals/
│   ├── scenarios/
│   └── score.js
├── reports/                # outputs (example committed, rest ignored)
└── test/                   # unit tests for checks and verifier
```

## 10. Plan (one weekend)

| When | Work | Done when |
|---|---|---|
| Sat AM | Finalize spec; repo setup; seed script + scenarios | `npm run seed` creates all scenarios with ground truth |
| Sat PM | Checks C1–C4 + unit tests; fixtures source | `npm test` passes |
| Sun AM | Agent loop, tools, verifier, report writer | Agent produces a correct report for `everything` offline |
| Sun PM | Eval scorer + results table; HubSpot source + seed one scenario into test account; README; demo recording | README shows eval table; one run against live HubSpot |

## 11. Risks and open questions

- **HubSpot test account custom properties:** UTM fields may need to be created as custom contact properties. The seed script creates them if missing.
- **Matching payments to deals:** v1 matches on email + amount + date within ±2 days. Fuzzy cases are flagged, not guessed.
- **Thresholds for "suddenly empty":** v1 uses a simple rule (rate more than 3× baseline and above 5%). Documented and tunable.
- **LLM variability:** handled by deterministic checks + verifier + 3 runs per scenario in evals.
- **Cost:** expected under $5 for development plus evals; scorer reports actual cost.

## 12. Definitions

- **Signup:** a HubSpot contact with `createdate` in the window, after de-duplication.
- **Revenue (Stripe):** sum of `succeeded` charges in the window, in USD.
- **Revenue (HubSpot):** sum of `amount` on deals with stage `closedwon` and `closedate` in the window.
- **Channel:** normalized `utm_source` (normalization map in `src/checks/utm.js`).
- **Trust status:** ✅ no open issue affects the metric · ⚠️ an issue affects it (with a link to the issue).
