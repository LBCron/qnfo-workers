# AI Search instances and the 2026-11-01 usage billing (RM-AISEARCH-GA-MIGRATE-1)

Charter pillar: **cost**. Doer: qnfo-ai-search via qnfo-code-orchestrator. Issue: agent_issues 1000651 (roadmap item `RM-AISEARCH-GA-MIGRATE-1`,
docs/SCOUT-ROADMAP-2026-10.md). Read on 2026-10-28 from the live worker (`GET https://qnfo-ai-search.q08.workers.dev/instances`) and from
`wrangler.toml` of every worker on `main`.

Source of the change: Cloudflare changelog 2026-10-01, AI Search generally available (full text read when the roadmap item was filed). Usage billing
begins 2026-11-01. Embedding and rerank calls move into AI Search pricing and no longer appear on Workers AI bills or in AI Gateway logs. Hybrid search is
the default for new instances. File caps are 10 MiB (OCR and text) and 4 MiB.

**Correction 2026-11-05 (BLUESKY-2026-11, full text of the changelog post read):** Cloudflare postponed usage billing by one month: it now begins
**2026-12-01**, not 2026-11-01, and the default sync interval for new instances is 24 hours (was 6); pricing and included usage are unchanged
(https://developers.cloudflare.com/changelog/post/2026-11-02-billing-postponed-default-sync-interval/). Every "2026-11-01" in this file reads 2026-12-01. The
instance's own `sync_interval` is set explicitly, so the new default does not change `qnfo-corpus`; check that before creating any second instance.

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

1. On 2026-11-01 and again on 2026-11-08, `GET /instances` lists exactly the instances in the table above (a new row is a finding).
2. The AI Search line of the invoice, per instance, is recorded here next to the bound above. If it exceeds 10 percent of the 30 day AI spend, the lever is
   `reranking` off (already) and `cache` on (already), then fewer golden-set evaluations (`tuneRetrieval` cadence).
3. `unified_cost_usd_30d` for the 30 days before and after 2026-11-01 are compared; a drop of more than 10 percent that is not explained by volume is
   a telemetry gap, filed as an issue with the metric's producer as owner.

## Failure mode of this inventory

An instance created by the dashboard, a token or another account member shows up in `GET /instances` but in no `wrangler.toml`; one created in another
account does not show up at all. The inventory is exactly as complete as that endpoint. Rates were not read, so the bill column stays empty until the invoice
is read, never filled with an estimate.
