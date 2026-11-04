# D1 tiering and slimming, 2026-11-04 (COLD-TIER-1 and D1-HOTSPOTS-3, pillar cost)

Owner question, 2026-11-04: "D1 is slow and has way too many rows" (a console query ran more than 20 minutes and was killed); move cold data to a free or cheap lake, condense it, and make the budget go down.
Every number below was read in this session on 2026-11-04 (17:00 to 22:00Z) from qnfo-audit (`35e2e573`): `sqlite_master`, `sum(length(CAST(col AS BLOB)))` per table (row bytes only, no index or free pages), and the GraphQL `d1QueriesAdaptiveGroups` dataset.
It builds on docs/D1-SPLIT-DESIGN-2026-11.md (a second D1 for hot write paths) and docs/COST-AND-D1-ANALYSIS-2026-11-04.md; it does not repeat them.

## 1. What is actually slow

- Rows stored are not the problem: 1,552,000 rows in 639 tables (plus 268 `bak_` tables: 5,706 rows, 8 MB, all younger than the 7-day sweep or undated). Row bytes of the 639 tables are about 0.9 GB; the file is 1.45 GB with 645 indexes and free pages.
- Rows read are: 24 h to 2026-11-04 14:00Z, 2.39 billion rows read for 1.55 M rows stored, so every row was read about 1,500 times. The cause is statements, not data:

| statement (24 h, before the fixes of the last hours) | calls | rows read | p50 / p99 per call |
|---|---|---|---|
| `INSERT INTO fleet_tick` (53 triggers fire inside it) | 286 | 279 M | 6.7 s / 21.7 s |
| `UPDATE persona_briefs ... v_output_quality_headline` | 157 | 236 M | 4.5 s |
| `INSERT OR REPLACE INTO program_focus_plan_now ... v_program_focus_plan` | 290 | 133 M | 0.7 s |
| `INSERT INTO fleet_tick_heavy` | 542 | 129 M | 14.8 ms / 10 s |
| `INSERT OR REPLACE INTO cron_fault_seen` | 251 | 113 M | 0.6 s |
| `SELECT * FROM v_output_quality_headline` | 62 | 95 M | 3.6 s |
| ad hoc `SELECT substr(r.created_at,1,10) day, COUNT(*) reqs ...` | 2 | 10.6 M | 17 s |

- A D1 database runs one statement at a time. A 20-second statement makes every other query wait, and a console query queues behind them, so "more than 20 minutes" is queueing plus a view that multiplies rows (nested `v_*` views with a correlated subquery per row), not the 1.5 M stored rows.
- Several sessions removed the top of this list while this analysis ran (headline cache 374 rows read now, cron fault scans, fleet_tick fan-out). The 20 heaviest statements of 19:20 to 21:20Z read about 160 M rows in all (the day before: 2.39 billion in 24 h); the remaining top statements are in D1-HOTSPOTS-3 below.

### D1-HOTSPOTS-3 (migrations/2026-11-04-d1-hotspots-3.sql)

| hotspot (2 h window 19:20 to 21:20Z) | before (one run, live) | after (live, same answer) | fix |
|---|---|---|---|
| `fm-consumer-pending-recorded-as-failure` probe: 27 runs, 9.9 M rows, 62 s | 363,753 rows read, 1.16 s | measured after the merge (planner proof in the test) | partial index `idx_rv_pending_fail` on the 1,926 pending failures of 363,499 rows |
| `fm-remediation-over-budget-metric-lifetime-count` probe: 33 runs, 6.7 M rows, 47 s | 259,780 rows read, 1.6 s | 7,681 rows read, 0.34 s | open `code_tasks` goals read once (CTE) instead of one LIKE scan per candidate contract |
| `v_breach_ticket_coverage_candidates`: 66 runs / 40 min, 1.58 M rows | 23,384 rows read | 994 rows read | range seek on `idx_agent_issues_title` instead of `LIKE 'METRIC-TRIGGER-' \|\| id \|\| '-%'` |

Together about 140 M rows read a day fewer. Not done, with the reason: `reachLatestAgg` (50 M rows a day, qnfo-fleet-dashboard worker.js, claimed by another session; the table has 4 indexes already, so the fix is a shorter window or a cache, not an index); `code_tasks WHERE goal LIKE ? OR id = ?` (16 M a day, a leading-wildcard LIKE needs an `issue_id` column on `code_tasks`, a schema change for the code loop's owner); `INSERT INTO fleet_tick` (PR 6974 owns it).

## 2. Tiering inventory (tables above 1,000 rows or 5 MB)

Bytes are row bytes. Growth is rows a day where measured. Readers are those found by grep of worker.js and by the views and probes in D1 (`impact` of the fleet graph before any cut).

| table | rows | MB | growth / day | readers | retention today | verdict |
|---|---|---|---|---|---|---|
| code_tasks | 1,465 | 250.0 | 70 | code loop, 11 k statements a day | none; `ctx` slimmed by CODE-TASKS-CTX-SLIM (PR 7078, 7201) | keep hot; `ctx` of closed tasks to R2 (follow-up) |
| chatbox_conversations | 3,495 | 173.8 | 40 | qnfo-ai history | `messages_json` nulled 150 rows a run (BLOB-TRIM-1) | trim then keep; about 30 MB after |
| fleet_probe_log | 212,959 | 60.9 | 9,000 | dashboard, scorecard, audit-hub (last day), lifecycle (latest per name) | 21 days | **archive to R2 and prune at 3 days (COLD-TIER-1)** |
| errata_actions | 1,042 | 57.8 | 8 | research-exec | none | archive bodies older than 30 days to R2, keep ids and status |
| remediation_verifications | 363,497 | 56.3 | 18,000 | fleet-control, 33 views, 4 workers (7-day window) | 8 days | **daily rollup and R2 copy (COLD-TIER-1)**, retention stays 8 days |
| code_task_ctx_archive | 346 | 47.6 | 5 | none found | none | archive to R2, drop the D1 copy (an archive inside D1 is not an archive) |
| cloud_ops_events | 148,440 | 37.1 | 6,700 | 19 workers, 19 views | 5 days housekeeping kinds, 90 days others | aggregate to the rollup table, archive non-housekeeping rows older than 14 days (slice 2) |
| version_queue | 310 | 28.0 | 3 | deploy loop | none | archive bodies of finished rows |
| fleet_runs | 53,429 | 24.4 | 3,800 | 6 workers, 5 views | 14 days | shorten to 7 days with the same rollup (slice 2) |
| codeparse_events | 49,367 | 24.2 | 16,000 | none found | 3 days (4,000 a pass) | prune is behind (49 k rows for a 3-day window); drop to 1 day |
| cron_fire_log | 63,803 | 12.4 | 4,500 | cron-watch (latest per cron) | 14 days | 3 days plus rollup (slice 2) |
| ops_jobs | 55 | 12.0 | 1 | qnfo-ops | none | blob columns to R2 |
| ops_ai_log / chat / ai_queries | 2.8 k / 2.8 k / 2.1 k | 11.6 / 11.6 / 10.7 | 100 | qnfo-ops, qnfo-ai | none | archive older than 30 days |
| remediation_runs | 3,307 | 10.0 | 150 | consumer | none | rollup then prune at 14 days |
| paper_integrity_backups | 211 | 9.7 | 2 | none | none | R2 only (it is a backup of papers) |
| analytics_action_log | 20,455 | 9.6 | 800 | trigger loop | none | prune at 30 days with a rollup |
| bp26_probe_results | 62,294 | 9.5 | 7,000 | SLO contracts (latest per subject, 24 h counts) | none | **archive to R2 and prune at 7 days (COLD-TIER-1)** |
| emails / email_raw_archive | 1,014 / 257 | 9.0 / 5.5 | 20 | personal plane readers | none | `email_raw_archive` to R2 (private bucket path, never the public repo) |
| mcp_log, agent_issues, github_steward_runs, fleet_state_snapshots | 4.8 k, 5.5 k, 408, 753 | 8.2, 7.95, 7.8, 7.4 | small | many | none | keep; `fleet_state_snapshots` to 14 days |
| quality_scores, reach_signals, social_engagements, journey_runs, work_claims | 23 k, 43 k, 24 k, 9.7 k, 10.8 k | 1.9, 5.1, 3.1, 5.3, 2.8 | 200 to 1,000 | dashboards | none | keep (small); `work_claims` closed rows older than 30 days to R2 |

The other 600 tables hold under 1,000 rows and under 5 MB each. The 268 `bak_` tables are 8 MB and 5,706 rows: BAK-TABLE-SWEEP-1 already drops every dated one past 7 days that the R2 export holds, so what remains is the last 7 days of migrations plus undated names. They cost schema parse time, not bytes; no further action.
Indexes: 645, many on tables this PR prunes. Dropping the redundant ones on `remediation_verifications` (13 indexes for 363 k rows) is the next write-cost cut; `migrations/redundant-indexes.test.mjs` is held by the spend-enforce session.

## 3. First slice built: COLD-TIER-1

`scripts/cold_tier.py`, called from `continuity_snapshot.py main()` in the remediation-consumer workflow (an R2 write path that already exists), with `migrations/2026-11-04-cold-tier-1.sql` for the ledger, the rollup table, the `ops_config cold_tier` kill switch and the failure mode `fm-cold-archive-lag`.

1. Rollup first: `cold_rollup_daily (src_table, day, dim1, dim2, n, n_ok, n_fail, v1, v2)` gets one row per day and probe (fleet_probe_log: name, transport, count, passes, average and maximum ms; bp26: metric, subject; remediation_verifications: class, transport). "How reliable has X been" survives as a few hundred rows a day instead of 213 k raw rows. A day is rolled up only when it is complete and before any of its rows can be archived; the archive query refuses rows of a day that is not rolled up.
2. Archive: rows older than `keep_days` (fleet_probe_log 3, bp26_probe_results 7, remediation_verifications 6 as a copy only) are written as `cold/qnfo-audit/<table>/<yyyymm>/<table>-<idmin>-<idmax>.jsonl.gz` in `qnfo-backups`, read back, and compared by sha256 and by row ids. Only then a `cold_archive_ledger` row (`verified = 1`) is written.
3. Prune: mode `delete` deletes the archived ids in statements of at most 400 ids (1 s apart; the 83 k-row delete stall of RETENTION-PRUNE-SPREAD-1), counts what is left, and writes `deleted_rows`. The newest row of each (name, transport) or (metric, subject) key always stays. Mode `copy` (remediation_verifications) never deletes: `retention_prune_tick_v2` still removes rows at 8 days, two days after the copy.
4. A run is bounded (150 s, 6 objects per table) and continues on the next run. `ops_config cold_tier = off` stops it; a failed read-back deletes nothing (tested).
5. Restore: gunzip the object named in `cold_archive_ledger.r2_key` and `INSERT OR IGNORE` the lines back.

Prediction: fleet_probe_log 212,959 rows to about 35,000 within 4 days (2,400 rows a run, the first runs also write 20 days of rollups), bp26_probe_results flat near 55,000, R2 objects about 30 a day, R2 storage under 100 MB a year (free tier is 10 GB). Verify with `SELECT * FROM v_cold_tier_status` and `SELECT COUNT(*) FROM fleet_probe_log`.
Weakest point: the legacy retention triggers (`retention_prune_tick_v2`, `retention_prune_2_tick`) still delete without an archive; that is today's behaviour, and the archive runs two days ahead of the one it duplicates (remediation_verifications). Making those deletes wait for the ledger means rewriting a trigger on `fleet_tick`, which PR 6974 owns; filed as the next step, not done here.

## 4. Where cold data can live (checked 2026-11-04)

| option | cost at our volume (about 100 MB a month compressed) | queryable | verdict |
|---|---|---|---|
| R2 object store, JSONL.gz (built) | free: 10 GB-month, 1 M Class A and 10 M Class B operations free; egress free (Cloudflare R2 pricing page) | by a Worker or script that lists the keys; not ad hoc SQL | **use now**; stays inside Cloudflare, no new secret |
| R2 Data Catalog (Iceberg) + R2 SQL | R2 SQL $2.50 per TB scanned, 10 GB scanned free a month, billing enabled 2026-08-03; catalog $9 per million operations, 1 M free; Pipelines $0.04/GB transform + $0.06/GB Parquet sink, 50 GB free on Workers Paid (Cloudflare changelog) | real SQL with JOINs, from the dashboard SQL editor | **the upgrade path** once cold data is over about 1 GB or someone needs ad hoc SQL: add a Pipelines stream with a Parquet sink, write the same rows, keep the JSONL as the backup |
| second D1 (`qnfo-telemetry`, D1-SPLIT-DESIGN) | D1 rows read/written pricing; no storage tax | full SQL, same engine | worth it for hot trigger-heavy tables (design stands); wrong for cold data, which only needs to be cheap |
| Workers Analytics Engine | cheap counters | write-only from workers, limited SQL, no joins to D1 | counters only (ai_call_counters); not for probe rows. Retention and quotas were not re-checked in this session |
| GitHub repository or Actions artifacts | free | git, not SQL | public repository (CLAUDE.md, cloudflare-only-host-guard): no telemetry rows, ever; only the public-safe subset already uploaded by continuity_snapshot |
| Google BigQuery (free tier 1 TB queried and 10 GB stored a month; connector available in this session) | free at our size | real SQL | **no**: needs a service-account key (`GCP_SA_KEY` exists for inventory only), moves private fleet rows out of Cloudflare, breaks the personal/research separation guarantee for any private table, and egress from R2 to GCP is a recurring step with a credential. Not worth it when R2 SQL does the same inside the account |

Recommended single path: R2 JSONL.gz now (done), then R2 Data Catalog + R2 SQL through a Pipelines Parquet sink when the cold volume or the need for ad hoc SQL justifies it. Blockers for the second step: a Pipelines stream and an R2 Data Catalog warehouse are new resources (net-zero worker rule does not apply, but a new binding does need a canonical-deploy PR), a read-only catalog token held by one worker only, and 30 days of data volume to size it. qnfo-identity, qnfo-outreach and every personal-life table stay out of any lake.

## 5. Next slices (each one coherent change)

1. `cron_fire_log`, `fleet_runs`, `cloud_ops_events` (non-housekeeping), `analytics_action_log`: add to `TIERS` with their rollup dimensions (tests in `cold_tier.py --selftest`).
2. R2-only for blob-heavy tables with no readers: `code_task_ctx_archive` (47.6 MB), `paper_integrity_backups` (9.7 MB), `email_raw_archive` (5.5 MB, private path), bodies of `errata_actions` and `version_queue` (86 MB together): archive, verify, then `UPDATE ... SET body = NULL` like BLOB-TRIM-1.
3. Gate the legacy retention deletes on the ledger (needs PR 6974 landed).
4. Drop redundant indexes on `remediation_verifications` (13 for a table written 18 k rows a day).
