# AI Search instances and the 2026-11-01 usage billing (RM-AISEARCH-GA-MIGRATE-1)

Charter pillar: **cost**. Doer: qnfo-ai-search via qnfo-code-orchestrator. Issue: agent_issues 1000651 (roadmap item `RM-AISEARCH-GA-MIGRATE-1`,
docs/SCOUT-ROADMAP-2026-10.md). Read on 2026-10-28 from the live worker (`GET https://qnfo-ai-search.q08.workers.dev/instances`) and from
`wrangler.toml` of every worker on `main`.

Source of the change: Cloudflare changelog 2026-10-01, AI Search generally available (full text read when the roadmap item was filed). Usage billing
was announced for 2026-11-01 and **postponed to 2026-12-01** by the changelog of 2026-11-02 (read 2026-11-05; `scripts/cost_ledger.py`
`AI_SEARCH_BILLING_START` already says 2026-12-01). Embedding and rerank calls move into AI Search pricing and no longer appear on Workers AI bills or in AI Gateway logs. Hybrid search is
the default for new instances. File caps are 10 MiB (OCR and text) and 4 MiB.

**Correction 2026-11-05 (BLUESKY-2026-11, full text of the changelog post read):** Cloudflare postponed usage billing by one month: it now begins
**2026-12-01**, not 2026-11-01, and the default sync interval for new instances is 24 hours (was 6); pricing and included usage are unchanged
(https://developers.cloudflare.com/changelog/post/2026-11-02-billing-postponed-default-sync-interval/). Every "2026-11-01" in this file reads 2026-12-01. The
instance's own `sync_interval` is set explicitly, so the new default does not change `qnfo-corpus`; check that before creating any second instance.

## Review of 2026-11-05 (AI-SEARCH-COST-1)

- **Instances (live read 2026-11-05):** still exactly one, `qnfo-corpus` (namespace `default`, hybrid, rerank off, sync interval 86400 s, last activity 2026-11-04). No new instance since 2026-10-28.
- **Rates are now readable** (https://developers.cloudflare.com/ai-search/platform/limits-pricing/, read 2026-11-05): per account and month 5 million ingestion tokens, 10 GB-month storage,
  1,000 semantic and 1,000 full-text queries are included; beyond that ingestion USD 0.75 per million tokens, storage USD 2.00 per GB-month, semantic, vector and hybrid queries USD 0.75 per 1,000,
  full-text queries USD 0.10 per 1,000, instances USD 0.10 per month above 5,000 (the fleet has one). Embedding and rerank calls are inside these lines.
- **Expected bill, as a bound and not a reading:** the dominant line is the query line. At the upper bound of the volume table below (about 400 searches a day, 12,000 a month, hybrid, so priced as
  semantic) it is (12,000 - 1,000) / 1,000 x 0.75 = **USD 8.25 a month**; ingestion stays inside the included 5 million tokens at the current rate of about 100 new papers a month; storage is far below 10 GB.
  Against `ai_est_cost_30d` of 749.08 (2026-11-04) that is about 1 percent. The first invoice line replaces this bound after 2026-12-01.
- **Measured, not bounded (AI-SEARCH-COST-2, read 2026-11-05 from the GraphQL meters Cloudflare bills on):** the billing REST report (`/billable-usage`) is readable with the repository token in the GitHub runner but answers 403 to the Workers' tokens, lists a charge only above the allowances and has no AI Search line yet (read 2026-11-05), so the five datasets
  `aiSearchSemanticQueriesAdaptiveGroups`, `aiSearchFulltextQueriesAdaptiveGroups`, `aiSearchStorageAdaptiveGroups`, `aiSearchIngestionTokensAdaptiveGroups` and `aiSearchImageProcessingTokensAdaptiveGroups`
  are readable. Seven days for `qnfo-corpus`: about 36 hybrid queries a day (October 27 to November 3: 35 to 47), so about 900 to 1,100 a month against the 1,000 included (the 400 a day above is an upper bound that
  the meter does not reach), 76 MB stored against 10 GB, 25 k to 270 k ingestion tokens a day (658 k in the first four days of November, so 5 to 6 M a month against the 5 M included), no full-text and no image
  tokens. Priced after the allowances that is under USD 1 a month (the first qnfo-infra tick, 2026-11-05T04:30:54Z, forecasts USD 0.66, all of it ingestion), not USD 8.25. qnfo-infra 1.13.0 (`costVendorTick`) reads the five datasets hourly into `cost_usage_daily` and prices them from `cost_price_book` into `cost_vendor_month` product `ai_search`
  (evidence `meter`; the line `v_cost_lines_month` shows), and `scripts/cost_ledger.py` copies the month's reading into `ai_search_cost_snapshots.usage_json` (basis `meter`) when the billing report is refused, so
  from 2026-12-01 the snapshot reads `measured` from the meters instead of `unavailable`. Detector: `fm-ai-search-meter-silent`.
- **Cost telemetry (the failure mode of this item):** `write_ai_search_snapshot` (PR 6563) had no caller and its table `ai_search_cost_snapshots` no DDL, and `v_cost_lines_month` did not read the
  `ai_search:usage` source, so the first AI Search charge would have reached no cost line (the Money card would have read a saving). `scripts/cost_ledger.py` now runs the snapshot on every hourly ledger run,
  `migrations/2026-11-05-e-ai-search-cost.sql` creates the table and makes `v_cost_lines_month` read `ai_search:usage` as vendor `cloudflare`, product `ai_search`, evidence `invoice`, and an inventory that
  cannot be read is stored as unknown (NULL), never as zero instances.
- **Why `unified_cost_usd_30d` is not the comparison:** that key is the AI Gateway unified-billing share (`aiSpendByBilling(...).unified` in qnfo-fleet-control) and reads 0.00 because the fleet pays Workers AI by neuron
  and BYOK by provider; it never summed the lines AI Search absorbs. The meters that did are `workers_ai_cost_30d_usd` (neurons) and `cost_usd_30d`; the before and after comparison belongs to them and to
  `v_cost_all_in` (which now includes the AI Search line).

## Which workers bind AI Search

| Worker | Binding | What it is | Source |
|---|---|---|---|
| qnfo-ai-search | `AI_SEARCH` (`[[ai_search_namespaces]]`, namespace `default`, remote) | the only direct AI Search binding in the fleet | qnfo-ai-search/wrangler.toml |
| qnfo-autopilot | `SB_AI_SEARCH` (service binding to qnfo-ai-search) | calls the worker above, no AI Search usage of its own | qnfo-autopilot/wrangler.toml |
| qnfo-fleet-control | `SVC_QNFO_AI_SEARCH` (service binding) | a journey probe asks one synthetic question every `JRN_ASK_EVERY_H` hours | qnfo-fleet-control/worker.js `JRN_TARGET` |

No other `wrangler.toml` in the repository declares `ai_search`, `autorag` or `AI_SEARCH` (searched 2026-10-28). The repository holds the worker
declarations only: an instance created outside wrangler (dashboard or API) does not show in it, which is why the instance list below is read live.

## Instances (live, 2026-10-28)

| Instance | Engine | Retrieval | Embedding model | Rerank | Summarise / rewrite | AI Gateway | Created | Last activity |
|---|---|---|---|---|---|---|---|---|
| `qnfo-corpus` | 3 | hybrid (vector + keyword, RRF), `hybrid_search_enabled: true` | `@cf/qwen/qwen3-embedding-0.6b` | off | off / off | `default`, cache on (`close_enough`, 172800 s) | 2026-07-25 | 2026-10-28 |

That is one instance. The fleet runs no second instance.

## What uses it (volume, read from qnfo-audit on 2026-10-28)

- Query path: `ask_events` holds 374 public Ask answers in the last 30 days (about 12 a day), plus the golden-set loop's retrieval evaluation (16
  questions per tuning run, hourly cron, `tuneRetrieval`) and the fleet journey probe. Each answer calls `AI_SEARCH.get(...).search(...)` once or twice.
- Ingest path: the hourly corpus feeder uploads published papers the index lacks (`ask_corpus_sync`, 735 rows in total); `POST /ingest` is the manual path.
- Rerank and summarisation are off, so the two new billing lines that matter are the embedding of each query and document chunk and the indexing
  of uploaded files. Both were hidden before 2026-11-01 (the embedding went through the `AI` binding of the managed instance and the AI Gateway `default`).

## Expected monthly bill

The usage rates are not in this repository and were not readable from the account on 2026-10-28, so a number here would be invented. What is bounded:

| Driver | Measured volume | Bound |
|---|---|---|
| Queries | about 12 public answers a day, plus at most one golden-set evaluation of 16 questions per hourly tick (an upper bound of about 400 searches a day, not measured), plus the probe | at most the order of 10,000 searches a month |
| Documents | 735 uploaded papers, one upload per newly published paper | order of 100 uploads a month after the backlog |
| Rerank | off | 0 |

The first step after 2026-11-01 is therefore a read, not an estimate: the AI Search line of the first invoice, per instance. A single instance at this
volume is expected to be a small fraction of `unified_cost_usd_30d` (the metric read 0.00 on 2026-10-28; see the next section), and the check below
makes that claim testable.

## Cost telemetry: what could read lower after 2026-11-01

- `analytics_dash_meta.unified_cost_usd_30d` read `0.00` and `ai_est_cost_30d` read `595.90` on 2026-10-28. The unified metric is therefore already
  unmeasured or zero, and a cost metric that falls to zero reads as a saving (the failure mode of this roadmap item).
- Anything that sums Workers AI lines for qnfo-ai-search (`ai_call_counters`, worker `qnfo-ai-search`, WORKERS-AI-ATTRIBUTION-2) will lose the embedding calls
  of the managed instance on 2026-11-01. Those counters only ever saw the worker's own `env.AI` calls (ask, judge, question generation), so the drop is
  the embedding share that was never attributed to this worker.
- AI Gateway log ids became UUIDv7 on 2026-10-08 (Workers changelog); a parser that assumes the old shape reads nothing.

## Checks to run (the definition of done)

1. On 2026-11-01 and again on 2026-11-08 (billing moved to 2026-12-01: repeat on 2026-12-01 and 2026-12-08, now recorded hourly in `ai_search_cost_snapshots.inventory_json`), `GET /instances` lists exactly the instances in the table above (a new row is a finding).
2. The AI Search line of the invoice, per instance, is recorded here next to the bound above. If it exceeds 10 percent of the 30 day AI spend, the lever is
   `reranking` off (already) and `cache` on (already), then fewer golden-set evaluations (`tuneRetrieval` cadence).
3. `unified_cost_usd_30d` for the 30 days before and after 2026-11-01 are compared; a drop of more than 10 percent that is not explained by volume is
   a telemetry gap, filed as an issue with the metric's producer as owner.

## Failure mode of this inventory

An instance created by the dashboard, a token or another account member shows up in `GET /instances` but in no `wrangler.toml`; one created in another
account does not show up at all. The inventory is exactly as complete as that endpoint. Rates were not read, so the bill column stays empty until the invoice
is read, never filled with an estimate.
