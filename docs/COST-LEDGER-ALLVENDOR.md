# All-vendor monthly cost ledger (COST-LEDGER-ALLVENDOR-1, pillar cost)

Owner target (2026-11-04): total cost inside USD 200-300 a month, all-in, **measured, not estimated**. This is the one place that total is built, and the evidence behind each line.

## Read it

```sql
SELECT * FROM v_cost_all_in;                    -- month to date, month forecast, budget, measured share
SELECT * FROM v_cost_lines_month ORDER BY forecast_month_usd DESC;   -- one line per vendor and product, with its evidence flag
SELECT * FROM cost_vendor_month WHERE month = strftime('%Y-%m','now') ORDER BY net_forecast_usd DESC;  -- per metric: usage, allowance, gross, net, forecast
SELECT date, product, metric, quantity, rate_usd FROM v_cost_usage_priced_daily ORDER BY date DESC;     -- each day's usage priced at the overage rate
```

`/api/cost` and the dashboard Money card read `v_cost_all_in` and `v_cost_lines_month` (keys `all_in`, `all_in_lines`).

## Evidence flags (every line carries one)

| flag | meaning | lines |
|---|---|---|
| `meter` | usage read from the vendor's own meter, times the vendor's published unit price after the monthly included allowance | Workers AI, AI Gateway (cost_daily); Workers, D1, Durable Objects, R2, KV, Queues, Vectorize, Containers, Browser Rendering, Workers Logs (cost_vendor_month) |
| `invoice` | an amount the vendor states itself | Workers Paid subscription (`GET /accounts/{id}/subscriptions`), GitHub billing usage summary (`netAmount`) |
| `estimate` | computed from a list of owned things times an assumed price | none yet (domain renewals would be this) |
| `owner-stated` | a figure the owner gave and no API can see | `direct_providers_external:daily` (USD 450 a month, stated 2026-09-26) |

`measured_share_pct` counts `meter` and `invoice`. `fleet_measured_share_pct` leaves the owner-stated line out, because the fleet cannot see it.

## Where the data comes from

| vendor | collector | cadence | source |
|---|---|---|---|
| Cloudflare non-AI products | `qnfo-infra` `costVendorTick` (1.11.0) | hourly at :30, last 3 days rewritten, 30-day backfill when empty | GraphQL analytics datasets (workersInvocationsAdaptive, d1AnalyticsAdaptiveGroups, d1StorageAdaptiveGroups, durableObjectsPeriodicGroups, durableObjectsInvocationsAdaptiveGroups, durableObjectsSqlStorageGroups, r2OperationsAdaptiveGroups, r2StorageAdaptiveGroups, kvOperationsAdaptiveGroups, kvStorageAdaptiveGroups, queueMessageOperationsAdaptiveGroups, vectorizeV2QueriesAdaptiveGroups, vectorizeV2StorageAdaptiveGroups, containersUsageAdaptiveGroups, browserRenderingBrowserTimeUsageAdaptiveGroups) and `GET /workers/observability/usage` |
| Cloudflare Workers AI, AI Gateway, plan | `scripts/cost_ledger.py` (remediation-consumer.yml, hourly) | hourly | aiInferenceAdaptiveGroups, AI Gateway GraphQL, subscriptions API, into `cost_daily` |
| GitHub | `qnfo-github-steward` `githubBillingTick` (0.14.0) | hourly (55-minute throttle) | `GET /organizations/QNFO/settings/billing/usage/summary` and `GET /users/rwnq8/settings/billing/usage/summary` |
| Owner direct providers | seeded in `cost_daily` | per day | owner-stated monthly figure / 30 |

Prices live in `cost_price_book` (vendor, product, metric, included per month, USD per block, source URL, date read). A price change is a later migration with a new `checked_on`. **2026-12-01: Workers Logs move to Cloudflare Observability pricing and stored traces start to bill; re-read the price book then.**

The Cloudflare billing API (`/billing/usage`, `/billable-usage`, `/billing/history`) answers 403 to every token in reach, so the invoice itself is not read; the line is what the invoice would add, from the vendor's meter and published price. Allowances are applied to the calendar month (UTC); Cloudflare bills on its own cycle, so a boundary day can differ.

## Measured 2026-11-04 (the numbers behind the first cut list)

| line | usage | allowance | forecast month at the 3-day pace |
|---|---|---|---|
| Workers AI | about 2.4 M neurons a day | 10 k a day | about USD 800 (cost_daily, the spend-enforcement session owns it) |
| Owner direct providers | n/a | n/a | USD 450 (owner-stated, unverified) |
| D1 rows read | 7.8 B in 4 days (2 B a day; October 0.6 B a day) | 25 B | about USD 35 |
| D1 rows written | 1.4 to 2.1 M a day | 50 M | about USD 0 to 13 (at the edge of the allowance) |
| Durable Objects duration | 35 k GB-s a day since 2026-11-01 (October 1.8 k a day; 76 object-hours a day of active time) | 400 k | about USD 8 |
| Workers Paid plan | n/a | n/a | USD 5 |
| Workers CPU | 2.1 M ms a day | 30 M ms | about USD 0.7 |
| R2 | 92 GB stored, 260 k class B reads a day | 10 GB, 10 M | about USD 1.2 |
| Vectorize | 4.5 M queried dimensions a day, 201 M stored | 50 M, 10 M | about USD 0.9 |
| Containers, KV, Queues, Browser Rendering, Workflows | inside the allowances | | USD 0 |
| Workers Logs and traces | 4.9 M events in 30 days | 20 M | USD 0 |
| GitHub Actions | 186,195 Linux minutes in October (list USD 1,117) | public repository: 100% discount | USD 0 net |
| GitHub Copilot AI units (owner account) | USD 200 list in October, USD 199.67 in the first 4 days of November | plan allowance | USD 0 net; the allowance was gone on 2026-11-04 (this is why the Copilot coding agent refuses new work) |

Reading: outside Workers AI and the owner-stated line, the whole fleet costs about USD 55 a month (D1 reads, Durable Object duration, the USD 5 plan). The USD 200-300 target is decided by Workers AI (about USD 800 a month at the current pace) and by the owner's own USD 450, not by infrastructure. Trace sampling and log retention are worth USD 0 at today's volume (4.9 M of 20 M events); GitHub Actions minutes are worth USD 0 while the repository stays public (a private repository would put USD 1,117 a month at risk).

## What is not in the ledger, and why

- The owner's direct provider subscriptions (USD 450 a month, stated 2026-09-26): no API the fleet can reach shows them. Itemizing them once (name and USD a month each) turns one blob into lines, still `owner-stated`; reading them needs the owner's own console or admin key (IDENTITY-BOUND).
- The Copilot subscription fee: GitHub's API shows AI-unit consumption and discount, not the plan price.
- Google: the fleet uses the YouTube Data API, Calendar and fonts (free tiers) and Gemini only as a model id; no Google Cloud billing is reachable, so no Google line exists; any Google Workspace subscription is the owner's.
- Domain renewals (11 domains at Cloudflare Registrar, about USD 10 a month at list): estimate only, not yet a line.
- Workers Trace Events Logpush (one enabled job to R2): billed per logged request (10 M a month included, the account makes about 1.7 M); the R2 bucket it fills is in the R2 line.

## Adding a vendor or product

1. `INSERT INTO cost_price_book` (published price, allowance, source URL, date) in a migration.
2. A collector writes `cost_usage_daily` (and `cost_vendor_month` for an invoice-style vendor); a Cloudflare dataset is one entry in `COST_DATASETS` in `qnfo-infra/worker.js`.
3. Extend the offline test (`qnfo-infra/cost-vendor-ledger.test.mjs`).

## Checks

`fm-cost-vendor-ledger-stale` (qnfo-audit `failure_modes`, `remediation_contracts`) reads `v_cost_ledger_stale`: no Cloudflare usage row newer than 6 hours is a breach.
