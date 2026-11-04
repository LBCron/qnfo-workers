# cloud_ops_events insert cost (CLOUD-OPS-EVENTS-TRIGGER-COST-1, 2026-11-04)

Measured 6 h on 2026-11-04 (D1 GraphQL `d1QueriesAdaptiveGroups`): `INSERT INTO cloud_ops_events` = 187 s query time, 13.6M rows read.
Table: `id TEXT PK, ts, kind, text, meta, job, status`; indexes `idx_coe_kind_ts`, `idx_coe_kind_text_ts`, `idx_coe_ts`, `idx_coe_job_ts`, `idx_coe_status_ts`, partial `idx_coe_container_ts`.
Insert volume last hour: about 400 rows (ops_ai_tool 45, code-task.intake 44, canonical_refresh 41, ...). D1 has no cross-database triggers, so the lever is cheaper triggers.

## The 18 triggers

| Trigger | Fires on | Body reads | Verdict |
|---|---|---|---|
| self_heal_reap_stale_v2_ins | ins, kind=ops_ai_tool (~45/h) | UPDATE self_heal_actions, 13,276 rows, no index | COSTLY, fixed: partial index idx_sha_dispatched_open |
| tool_error_rate_filer_v3_ins | ins, ops_ai_tool + error (~2/h) | 5 COUNT(*) on (kind,text) with `substr(ts,1,19)`: index cannot seek ts, reads the tool's whole history | COSTLY per fire, fixed: `e.ts >=` (proved equivalent, see migration header) |
| deploy_locks_reap_expired_v2_ins | ins, ops_ai_tool | UPDATE deploy_locks, 55 rows | cheap, left |
| tool_error_files_issue_v2 | ins, ops_ai_tool + error, not excluded | NEW only plus agent_issues title check | cheap (~2/h), left |
| metric_goal_review_refusal_ai / _au | ins / upd, kind=code-merge.goal-review | 7 d range on idx_coe_kind_ts, ~200 rows, json_extract | cheap, kind-guarded |
| metric_probe_review_refused_ai / _au | ins / upd, kind=probe-review | same, ~300 rows | cheap, kind-guarded |
| agent_actions_from_secret_changes | ins, kind=secret-change | INSERT OR IGNORE agent_actions | cheap, rare |
| cloud_ops_events_secret_scrub_ins / _upd | every ins / upd of text, WHEN 7 LIKE terms on NEW | none | no reads; fires only on a secret |
| cloud_ops_events_secret_guard_ins / _upd | same for meta | none | no reads |
| cloud_ops_events_meta_json_guard_ins / _upd | meta not valid JSON | none | no reads |
| cloud_ops_events_ts_norm_ins / _upd | length(ts)=19 (0 in last hour) | self UPDATE (rewrites 6 indexes when it fires) | idle now |
| cloud_ops_events_ts_norm_epoch_ins | 10-digit ts | self UPDATE | idle |

(18 triggers: 12 fire on insert, 6 on update; the table rows above pair the _ins/_upd and _ai/_au variants.)
The trigger depth on this table stays at 2 (insert -> self UPDATE -> secret/ts guards); the migration adds no nesting.

## Change

`migrations/2026-11-04-cloud-ops-events-trigger-cost.sql` (BACKUP `bak_20261104_coe_filer_trigger`): the partial index and the filer trigger rewrite.
Test: `node migrations/cloud-ops-events-trigger-cost.test.mjs` (old vs new filer on 9 scenarios and every ts format, planner checks, reaper behaviour, idempotency, rollback).

## Prediction

| Measure | Before (6 h) | Target |
|---|---|---|
| cloud_ops_events insert query time | 187 s | under 70 s |
| rows read | 13.6M | under 5M |

Basis: the reaper alone is about 270 fires x 13.3k rows = 3.6M rows per 6 h, and error bursts of the filer read a tool's full history five times per fire. The remaining rows read are not explained by the triggers read here (the other triggers read well under 1M rows per 6 h), so the 5M target is uncertain: if the re-measure shows more than 5M, the next suspect is bursts of ops_ai_tool inserts (the reaper and deploy_locks reaper run per insert) and the ts_norm self-UPDATEs; replace the reaper triggers with a throttled sweep from a cron.

## Re-measure (after the merge deploys the migration, wait 6 h)

Cloudflare GraphQL `d1QueriesAdaptiveGroups` (datetimeGeq = now-6h, filter databaseId 35e2e573-92f3-46ac-83c6-22f6429fc5e5, order sum_queryDurationMs / sum_rowsRead descending, limit 20), find the group whose query text starts `INSERT INTO cloud_ops_events`; compare `sum.queryDurationMs` (187 s before) and `sum.rowsRead` (13.6M before). Index check: `SELECT name FROM sqlite_master WHERE name='idx_sha_dispatched_open'`.
