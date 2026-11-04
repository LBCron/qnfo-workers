# D1 split design: hot write paths off qnfo-audit (D1-SPLIT-1, pillar core)

Builds on docs/COST-AND-D1-ANALYSIS-2026-11-04.md (item 4 of section 1), migrations/2026-11-04-d1-replica-and-attribution.sql (read replicas, COST-D1-DRILL-1a), the D1-OVERLOAD-1 series (single statements), FLEET-TICK-FANOUT-COST-1 (PR 6974, owns the fleet_tick insert; not duplicated here) and docs/D1-RESTORE-RUNBOOK.md (Time Travel is whole-database, so a split must not rely on it per table). Design only: no table is cut over by this change.

## 1. Measurement (read 2026-11-04 ~17:00Z)

Source: Cloudflare GraphQL `d1QueriesAdaptiveGroups`, database 35e2e573, last 6 h, 1,842 query groups, 164,344 queries, 471.8M rows read, 3.32M rows written (3.0M of that is one `CREATE INDEX idx_rv_verified_cover` run 8 times; the real baseline is about 300k rows written per 6 h, 50k an hour), 2,362 s of query time (11% of wall clock). Tables are parsed from the INSERT/UPDATE/DELETE text, so these are statements that write the table; the triggers they fire are inside the duration and rows read.

| table | stmts | rows written | rows read by those stmts | query s / 6 h | triggers on it | writers (workers) | readers (workers) |
|---|---|---|---|---|---|---|---|
| fleet_tick | 220 | 7,913 | 36.5M | 329 | 53 | 2 (dashboard, code-orchestrator) | 2 |
| cloud_ops_events | 2,531 | 18,362 | 13.6M | 187 | 18 (9 row-local, 9 cross-table) | 30 | 19 + 19 views |
| remediation_verifications | 4,539 | 42,550 | 5.4M | 178 | 8 (5 read other tables) | 1 (qnfo-fleet-control) | 4 + 33 views |
| remediation_contracts | 8,631 | 13,895 | 22.0M | 98 | - | fleet-control | many |
| program_focus_plan_now | 88 | 4,788 | 38.2M | 85 | - | fleet-control (INSERT ... SELECT from a view) | - |
| fleet_runs | 2,582 | 6,237 | 1.2M | 4 | 2 | 4 | 6 |
| worker_logs | 2,625 | 15,450 | 0.16M | 1 | 1 | 2 (observability, ops) | 7 |
| fleet_probe_log | 2,262 | 9,048 | 0.12M | 1 | 0 | 1 (dashboard) | 9 |
| bp26_probe_results | 495 | 10,030 | 1.7M | 7 | 0 | 1 | - |
| ops_req_log | 491 | 982 | 0 | <1 | 0 | qnfo-ops | - |

Row counts (max rowid): remediation_verifications 584,995; fleet_probe_log 374,704; worker_logs 87,602; fleet_runs 69,062; bp26_probe_results 61,237; ops_req_log 27,718; issue_lifecycle 10,850; fleet_tick 3,888. Not measured: ai_call_counters, llm_gateway_log and issue_lifecycle did not reach the top 30 by duration, so their write cost is below 1 s per 6 h or the statement text did not parse.

### The finding that shapes the plan

Write volume is not the problem. The append-only telemetry tables named in the brief (worker_logs, fleet_probe_log, ops_req_log, bp26_probe_results) are cheap and trigger-free: together about 4k rows an hour and about 9 s of database time per 6 h. Moving them cuts roughly 8% of baseline rows written and well under 1% of busy time. The expensive tables are expensive because of the triggers hanging off them: each fleet_tick, cloud_ops_events and remediation_verifications insert reads thousands to millions of rows through triggers and holds the single writer 40 ms to 25 s. Those three tables are 29% of all query time in 6 h.

Consequence: a table that carries cross-table triggers cannot be moved by copying it. D1 has no cross-database triggers or joins, so the trigger logic must first be lifted out of SQLite into a reader (or into the writer) while the table is still on qnfo-audit. Order of work: P0 lift triggers, P1 prove the cutover mechanism on trigger-free tables, P2 move the lifted tables.

## 2. Impact (fleet-graph `impact?id=d1t:qnfo-audit.<table>`, depth 3; the graph truncates at 1,200 to 1,500 nodes because every binder of qnfo-audit appears at depth 2)

- fleet_tick: 53 triggers fire on it, 3 views, writers in qnfo-fleet-dashboard and qnfo-code-orchestrator. Owned by PR 6974.
- cloud_ops_events: 21 triggers, 19 views, 48 handlers; 30 workers insert into it. Row-local triggers (meta_json_guard x2, secret_guard x2, secret_scrub x2, ts_norm x3) can be replaced by one writer helper. Cross-table triggers: agent_actions_from_secret_changes, deploy_locks_reap_expired_v2_ins, self_heal_reap_stale_v2_ins, metric_goal_review_refusal_ai/au, metric_probe_review_refused_ai/au, tool_error_files_issue_v2, tool_error_rate_filer_v3_ins; each writes agent_issues, deploy_locks or a metrics table and needs a reader.
- remediation_verifications: 12 triggers, 33 views, single writer (qnfo-fleet-control remediationContractsTick, 3 insert sites); readers qnfo-backlog-exec, qnfo-fleet-dashboard, qnfo-lifecycle. Triggers autoclose_ins/upd (close issues), reopen_on_relapse_d1, dedupe_ins, transport_guard_ins/upd read other tables; retention_prune_tick_v2 writes it; autonomy_selfheal_tick and recurrence_guard_tick read it.
- fleet_runs: 2 triggers (cron_watch_exec_silent_tick reads, retention_prune_2_tick writes), 5 views (v_cron_activity, v_cron_faults_task, v_prd_funnel_health), 4 writers.
- worker_logs: 1 trigger (retention_prune_2_tick), 2 views (v_breach_selfheal_spend), readers conLogs, assessIntegration, digest; writers ingestTrace, logEvent, errorDetailCapture.

Rerun `impact` immediately before each slice (CLAUDE.md fleet-graph rule); INFERRED edges are leads, not facts.

## 3. Target layout

- `qnfo-telemetry` (new D1): append-only event tables with no cross-table triggers. Order: worker_logs, fleet_probe_log, ops_req_log, bp26_probe_results; then, after P0, remediation_verifications and cloud_ops_events; last fleet_runs.
- Writers hold a second binding `TELEMETRY` and call one helper per worker, `telemetryWrite(env, table, sql, binds)`, which writes to the new database when `ops_config d1_split_<table>` is `dual` or `new`, and to qnfo-audit when `old` or `dual`. A failure on the new side never fails the caller; it increments a counter.
- Retention stays where it is until the table has moved; the prune trigger for a moved table is dropped in the same step as the read switch, replaced by a worker cron DELETE in the new database (batches of 5,000 rows).
- Not chosen: Workers Analytics Engine for events that views join on (no SQL joins to D1, sampling); it suits counters only (ai_call_counters). Hyperdrive/Postgres: a new dependency the volume does not need.

## 4. Per-table cutover (never loses a row)

1. Create `qnfo-telemetry` (cf-ops-actions create-d1; extend `scripts/cf_ops_actions.py` if the action is absent) with the table DDL copied from sqlite_master.
2. Backup first: `d1-backup` of qnfo-audit to R2 (the D1-RESTORE-RUNBOOK export path), and record the Time Travel bookmark in the issue. A restore rewinds the whole database, so it is the last resort; the real rollback is the flag below.
3. Dual-write window: flag `dual`, at least 24 h (one retention cycle). Every new row goes to both.
4. Backfill by id range, oldest first, 5,000 rows per statement from old to new with `INSERT OR IGNORE`, preserving the original id (or the natural key, e.g. worker_logs.event_hash). Stop at the first id dual-write already holds. Resumable via a cursor row.
5. Verify: count and `max(id)` equal, plus `sum(id)` and `sum(length(<text col>))` per 10k-id bucket; a mismatch blocks the next step and files an issue.
6. Read switch, one worker at a time (flag `read_new`); views that join the table are replaced as in section 5. Dual-write continues.
7. Stop the old write (`new`), keep the old table untouched for 7 days, then drop it by a migration whose `-- BACKUP:` names a table or an R2 export recorded on the issue.

Rollback per step: 3 flag to `old`; 4 truncate the new table (it is a copy); 6 flip the reader flag back (the old table is current because dual-write continues); 7 flip to `dual` and re-backfill the gap from the new database; after the drop, restore from the R2 export (RTO hours).

## 5. What breaks and how it is handled

| dependency | handling |
|---|---|
| cross-table triggers on the moved table | P0: replace by a scheduled reader in the owning worker (fleet-control tick) reading the table and writing agent_issues; run trigger and reader side by side for 24 h; drop the trigger only after they match |
| row-local guards (secret scrub, ts normalisation, json guard) | one shared helper applied before the INSERT; the same triggers are created in the new database, where they do not block audit tables |
| views joining the table (33 on remediation_verifications, 19 on cloud_ops_events) | D1 cannot join across databases. Classify each view: (a) counts or latest-per-key: materialise a summary table in qnfo-audit by a cron that reads the new database (the output_quality_headline_cache pattern); (b) joins to issues: the reader fetches ids and joins in the worker. The view list is a deliverable of each cutover slice |
| triggers that read the moved table (autonomy_selfheal_tick, recurrence_guard_tick, retention_prune_tick_v2) | repoint to the summary table from (a) or move the check to the reader |
| ids | preserve original ids in backfill; during dual-write the primary side generates the id and passes it to the secondary |
| 83 bindings | only writers and readers of the moved table get TELEMETRY; wrangler.toml change goes through the canonical deploy |
| migration runner | applies only to qnfo-audit; DDL for qnfo-telemetry comes from the writer's ensureSchema until the runner learns a second database |

## 6. Prediction (measure, keep or revert)

| phase | tables | rows written / h moved | busy seconds / h moved |
|---|---|---|---|
| P0 | none moved; remediation_verifications triggers lifted | 0 | about 20 of the 30 s an hour its inserts hold the writer; about 0.9M fewer rows read an hour |
| P1 | worker_logs, fleet_probe_log, ops_req_log, bp26_probe_results | about 4,000 of about 50,000 baseline (8%) | about 1.5 (under 1% of 394 s an hour) |
| P2 | remediation_verifications, cloud_ops_events | about 10,000 (20%) | about 60 (15%), because the triggers no longer run in the audit database |
| PR 6974 | fleet_tick fan-out | about 1,300 | about 55 (14%) |

Verification: re-run the same d1QueriesAdaptiveGroups query 24 h after each phase and compare per-table query s; keep only if the table's seconds fell and `v_metric_trigger_state` guards did not worsen.

Failure modes: a dual-write helper that throws or adds a second D1 round trip inside hot crons; a backfill racing the prune triggers; a reader the graph missed (INFERRED edge) silently reading a stale table, so each switch is preceded by a grep of the table name across all worker.js; a view left joining a dropped table. Strongest argument against the split: P1 buys under 1% of busy time, so P1 alone will not stop "D1 DB is overloaded"; it is justified only as the proving ground for P2, and the payoff is in P0 and PR 6974.

## 7. Slices filed (migrations/2026-11-04-d1-split-roadmap.sql)

1. D1-SPLIT-1a (P0, first): qnfo-fleet-control `remediationContractsTick` does the dedupe and transport guard in the INSERT statement itself and stops relying on the reading triggers. Chosen first because the table has one writer, the highest per-insert cost after fleet_tick (39 ms average, 5.4M rows read per 6 h) and the change moves no data.
2. D1-SPLIT-1b (P1): qnfo-observability `ingestTrace` dual-writes worker_logs to qnfo-telemetry behind `ops_config d1_split_worker_logs`; proves helper, flag, backfill and verify.
3. D1-SPLIT-1c (P1): qnfo-fleet-dashboard `healthProbes` dual-writes fleet_probe_log (single writer, no triggers, 9 readers).
