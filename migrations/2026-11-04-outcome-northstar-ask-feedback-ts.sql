-- OUTCOME-NORTHSTAR-FIX-1 (2026-11-04, charter pillar autonomy; incident: no fleet_tick from 16:34:44Z to 16:58:44Z, 24 minutes against the 10-minute SLA).
-- migrations/2026-11-04-outcome-northstar.sql (PR 7023, applied 16:42:39Z) created v_outcome_northstar reading ask_feedback.created_at; ask_feedback has event_id, ts and
-- helpful, no created_at. CREATE VIEW does not check columns, but its trigger outcome_northstar_tick (AFTER INSERT ON fleet_tick, WHEN minute < 10) is compiled when any
-- INSERT INTO fleet_tick is prepared, whatever the WHEN says, so from 16:43:47Z every insert by both producers failed with "D1_ERROR: no such column: created_at" (logged as
-- fleet-cron-tick-error by qnfo-code-orchestrator at 16:43:47, 16:44:45, 16:47:06, 16:48:45, 16:55:15; qnfo-fleet-dashboard heartbeat ok = 0 at 16:55:24Z). No 10-minute fixer ran.
-- Hand-applied at 16:57:30Z (the outage was live; EXPLAIN INSERT INTO fleet_tick compiled again, the next tick landed 16:58:44Z, no tick error since): the same DROP VIEW and CREATE VIEW as
-- below, with ask_feedback.ts (ISO text, the same format as reader_reports.created_at). This file records it in the repository, idempotently, so main and qnfo-audit agree.
-- Prevention (same PR): scripts/apply_migrations.py TRIGGER-COMPILE-CANARY-1 now refuses a trigger whose insert, update or delete no longer compiles; the canary saw this exact error and
-- ignored it because only "nested too deep" was acted on.
-- Prediction: v_outcome_northstar returns three rows, INSERT INTO fleet_tick compiles, ticks keep landing at least every 10 minutes (the tick row stays under 10 minutes old), and
-- reader_signal_7d counts the ask_feedback rows of the last 7 days.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_outcome_northstar
-- Rollback: DROP VIEW IF EXISTS v_outcome_northstar; then re-create it from bak_20261104_v_outcome_northstar (column sql holds the previous CREATE VIEW statement); DELETE FROM remediation_contracts WHERE class = 'fm-fleet-tick-stale-20m'; DELETE FROM failure_modes WHERE fm_key = 'fleet-tick-stale-20m'
-- spof-review: one view redefined (same columns); a tick-age detector added; no trigger, cron or executor.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_v_outcome_northstar AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_outcome_northstar';

DROP VIEW IF EXISTS v_outcome_northstar;
CREATE VIEW v_outcome_northstar AS
SELECT 'product_task_share_7d' AS metric,
  ROUND(1.0*SUM(NOT (path LIKE 'qnfo-fleet-control/%' OR path LIKE 'qnfo-ops/%' OR path LIKE 'qnfo-deploy-guard/%' OR path LIKE 'qnfo-code-orchestrator/%' OR path LIKE 'qnfo-cloud-ops/%' OR path LIKE 'qnfo-observability/%' OR path LIKE 'qnfo-github-steward/%' OR path LIKE 'scripts/%' OR path LIKE 'migrations/%' OR path LIKE '.github/%' OR goal LIKE '%probe%' OR goal LIKE '%METRIC-TRIGGER%' OR goal LIKE '%LOOP-%'))/COUNT(*),3) AS value
FROM code_tasks WHERE created_at>=datetime('now','-7 day')
UNION ALL
SELECT 'outreach_human_clicks_7d', COALESCE(SUM(human_clicks_7d),0) FROM v_channel_impact_7d
UNION ALL
SELECT 'reader_signal_7d', (SELECT count(*) FROM reader_reports WHERE created_at>=datetime('now','-7 day'))+(SELECT count(*) FROM ask_feedback WHERE ts>=datetime('now','-7 day'));

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('fleet-tick-stale-20m',
  'no fleet_tick row for 20 minutes, so none of the 52 ten-minute D1 fixers runs (queue SLA, age ladder, reconcile, doctrine metrics, self-heal scores)',
  'every INSERT INTO fleet_tick fails at prepare time when any of its AFTER INSERT triggers (or a view it reads) references a column, table or function that does not exist; on 2026-11-04 outcome_northstar_tick read ask_feedback.created_at (no such column) and both producers failed for 24 minutes, and earlier 2026-10-26 breach_selfheal_tick (SQLITE_NOMEM) and 2026-10-18 (UNIQUE) did the same by other routes',
  'TRIGGER-COMPILE-CANARY-1 in scripts/apply_migrations.py refuses such a trigger at apply time; this detector fails when the newest fleet_tick row is older than 20 minutes, so any other route to a dead tick is seen within two ticks',
  'fm-fleet-tick-stale-20m: 1 when the newest fleet_tick row is older than 20 minutes, expected 0',
  'fm-fleet-tick-stale-20m', '2026-11-04', NULL,
  'a migration that adds or changes a fleet_tick trigger or a view one reads, with a column or table that is not there',
  'fleet-cron-tick-error events naming the missing column every producer run; fleet_heartbeat ok = 0 for qnfo-fleet-dashboard; fleet_tick max(ts) stops advancing',
  'every 10-minute fixer behind fleet_tick');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-fleet-tick-stale-20m', NULL, 'OUTCOME-NORTHSTAR-FIX-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT MAX(ts) FROM fleet_tick) < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-20 minutes'') THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a dead fleet_tick is worth a direct, reversible repair at once (view definition only) and a repository record, not a wait for the 20-minute merge lane',
  'OUTCOME-NORTHSTAR-FIX-1: v_outcome_northstar reads ask_feedback.ts instead of the missing created_at (hand-applied 2026-11-04T16:57:30Z, recorded here); detector fm-fleet-tick-stale-20m; the runner refuses uncompilable triggers (TRIGGER-COMPILE-CANARY-1)',
  'cloud_ops_events fleet-cron-tick-error "no such column: created_at" 16:43:47Z-16:55:16Z; fleet_tick last row 16:34:44Z until 16:58:44Z; pragma_table_info(ask_feedback) = event_id, ts, helpful; EXPLAIN INSERT INTO fleet_tick compiled after the fix; PR 7023 migration',
  'tick restored after 24 minutes; same fix recorded in the repository', 'one view (broken text was in sqlite_master, not kept: it could not compile); the metrics outcome_northstar_tick refreshes read it',
  'the Rollback line', 'a migration can no longer silently kill the tick', 'newest fleet_tick row under 10 minutes old at every check for 24 h; fm-fleet-tick-stale-20m reads 0', NULL, 'SQLite test in migrations/outcome-northstar-fix.test.mjs, live EXPLAIN INSERT INTO fleet_tick, scripts/apply_migrations_test.py'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'OUTCOME-NORTHSTAR-FIX-1:%');
