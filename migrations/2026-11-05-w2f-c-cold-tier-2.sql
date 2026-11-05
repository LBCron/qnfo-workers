-- COLD-TIER-2 (2026-11-05, agent W2-F-C, charter pillar cost; roadmap row 119 RM-D1-RETENTION-1; agent_issues 1001971). scripts/cold_tier.py puts cron_fire_log (keep 3 days), fleet_runs (7) and
-- analytics_action_log (30) into TIERS: rollup per day first, then each object written to R2 qnfo-backups cold/qnfo-audit/<table>/, read back and compared by sha256 and ids, a verified
-- cold_archive_ledger row, and only then deletes of at most 400 ids a statement. The newest row of every (cron_name, outcome), (task_id, status) and (trigger_id, status) stays, so the readers
-- that ask for "the latest ok" or "the latest failure" (v_cron_activity, v_cron_faults_worker, v_cron_faults_task, cronGridDue, v_persona_recovered_close) still find it.
-- Measured 2026-11-05 03:50Z (D1 reads): cron_fire_log 63,803 rows from 2026-10-22 (4,500 a day, kept 14 days by retention_prune_2_tick), fleet_runs 53,429 rows from 2026-10-22 (3,800 a day, 14 days),
-- analytics_action_log 20,705 rows from 2026-09-05 (no retention); none of the three has a trigger of its own. cloud_ops_events is NOT in this slice: its id is TEXT, its rowid is not time order
-- (the lowest rowid, 91199, was written 2026-11-05T03:50Z by an upserted heartbeat row), and v_trust_ledger / v_process_last_run read it without a 14 day window; it is filed as COLD-TIER-3 below.
-- This file adds a failure mode with its closing probe (a verified archive of every new tier within 26 hours), a decision_log row and the COLD-TIER-3 issue; it deletes nothing.
-- PREDICTION: cron_fire_log 63,803 -> about 14,000 rows, fleet_runs 53,429 -> about 27,000 and analytics_action_log 20,705 -> about 10,500 within 3 days of the first runs (about 5,000 rows a tier per
-- run); about 87,000 rows and about 26 MB of row bytes leave qnfo-audit, R2 gains about 40 objects a day (a few MB); v_cold_tier_status lists the three tables with unverified 0. Verify:
-- SELECT * FROM v_cold_tier_status; SELECT src_table, SUM(rows), SUM(deleted_rows) FROM cold_archive_ledger GROUP BY src_table. The file size falls only after D1 reuses freed pages.
-- Restore: gunzip the object named in cold_archive_ledger.r2_key and INSERT OR IGNORE the lines back (columns are the table's own). Kill switch: ops_config cold_tier = off.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-cold-archive-lag-2'; DELETE FROM failure_modes WHERE fm_key = 'cold-archive-lag-2'; DELETE FROM decision_log WHERE actor = 'session:w2f-c' AND action LIKE 'COLD-TIER-2:%'; DELETE FROM agent_issues WHERE title LIKE 'COLD-TIER-3:%' AND source = 'session:w2f-c' AND status = 'open'
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it writes one failure mode, one contract, one decision_log row and one issue row.

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('cold-archive-lag-2', 'cron_fire_log, fleet_runs or analytics_action_log has no verified cold-tier archive object in the last 26 hours: the archive is not running, not verifying, or stopped by its budget',
  'scripts/cold_tier.py deletes a row only after its R2 object was read back and matched; when the object cannot be written or read, nothing is deleted and the table grows again. These three tables gain rows that age past their keep window every hour, so a day without a verified object means the archive stopped',
  'read the latest continuity-snapshot run log line {"cold-tier": ...} (error field), cold_archive_ledger / v_cold_tier_status, and ops_config cold_tier; fix the R2 write or the budget, never delete the rows by hand',
  'fm-cold-archive-lag-2', 'fm-cold-archive-lag-2', '2026-11-05',
  'a tier of cron_fire_log, fleet_runs, analytics_action_log has no cold_archive_ledger row with verified = 1 newer than 26 hours',
  'SELECT src_table FROM cold_archive_ledger WHERE verified = 1 AND archived_at >= now - 26 hours',
  'D1 size and the rows read by every reader of these three tables');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-cold-archive-lag-2', NULL,
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM (SELECT ''cron_fire_log'' AS t UNION ALL SELECT ''fleet_runs'' UNION ALL SELECT ''analytics_action_log'') w WHERE NOT EXISTS (SELECT 1 FROM cold_archive_ledger l WHERE l.src_table = w.t AND l.verified = 1 AND l.archived_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-26 hours''))) AS TEXT) AS observed',
  'd1-query', 1000, 1, 'active',
  'each of cron_fire_log, fleet_runs and analytics_action_log has a verified cold_archive_ledger row from the last 26 hours (the first runs after the COLD-TIER-2 merge write them)',
  'Read the {"cold-tier": ...} line of the last remediation-consumer continuity step and v_cold_tier_status; a tier with error verify-sha-mismatch or r2-put-refused is an R2 problem, a tier with stopped=budget needs another run',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now', '+3 hours'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-c',
 'cron_fire_log, fleet_runs and analytics_action_log can keep 3, 7 and 30 days in D1 if the newest row of every (cron_name, outcome), (task_id, status) and (trigger_id, status) stays and every pruned row has a verified R2 object and a daily rollup',
 'COLD-TIER-2: scripts/cold_tier.py archives and prunes cron_fire_log (3 days), fleet_runs (7) and analytics_action_log (30); cloud_ops_events deferred to COLD-TIER-3',
 'fleet-graph impact of the three tables (2026-11-05): readers are v_cron_activity (7 days), v_cron_faults_worker (2 days), cronGridDue, v_cron_faults_task (5,000 ids, 24 h), v_persona_recovered_close (newest row per trigger and status); no trigger on the tables; scripts/cold_tier.py --selftest covers the keep-latest rows, the index seek of the check, the space-separated timestamp and the rollup counts',
 'about 87,000 rows leave qnfo-audit in 3 days; every reader still finds its latest ok and latest failure row',
 'three tables of qnfo-audit; legacy retention triggers keep their own ages and are not changed',
 'ops_config cold_tier = off stops the archive; restore a table by gunzip of the ledger r2_key and INSERT OR IGNORE; revert the script by the canonical revert of the merge',
 'the biggest append-only run logs stop growing D1 and stay restorable from R2',
 'v_cold_tier_status lists cron_fire_log, fleet_runs, analytics_action_log with unverified 0 within 3 hours of the merge, and their ledger deleted_rows sum to rows archived',
 'no external reach change',
 'offline sqlite self-test of scripts/cold_tier.py (three tiers on tables shaped like the live ones, EXPLAIN QUERY PLAN of the keep-latest check)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-c' AND action LIKE 'COLD-TIER-2:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COLD-TIER-3: cloud_ops_events joins the cold tier on a timestamp cursor (TEXT id, rowid is not time order, readers need windows longer than 14 days)',
 'Charter pillar: cost (D1 size and speed). Roadmap row 119 (RM-D1-RETENTION-1). Evidence read 2026-11-05: cloud_ops_events holds 148,440 rows / 37 MB at 6,700 a day with TEXT primary key id; its lowest rowid (91199) was written 2026-11-05T03:50Z by an upserted heartbeat row, so scripts/cold_tier.py cannot use id or rowid order (the binary search of _edge_id and the copy cursor assume ids follow time). Readers: v_trust_ledger counts the kinds deploy-fallback and claim-reaper with no window, v_process_last_run takes MAX(ts) per job and kind, 19 workers write it; retention today is 5 days for housekeeping kinds and 90 days for the others (retention_prune_tick_v2).' || char(10) ||
 'EDIT: add a tier to TIERS with a timestamp cursor (ts index idx_coe_ts exists): archive rows with ts below the cutoff in ts order and chunks bounded by ts, ledger id_min/id_max holding the epoch seconds of the chunk, delete by the TEXT ids in statements of at most 400, keep the newest row per (job, kind) and every row of the kinds v_trust_ledger counts (or roll those counts up first), mode copy for the first 7 days of runs and delete only after the copy ledger shows 0 unverified. Extend --selftest with a table whose ids are text and out of time order.' || char(10) ||
 'Definition of done: v_cold_tier_status lists cloud_ops_events with unverified 0, v_trust_ledger and v_process_last_run return the same rows before and after (compare a sample), and the row count falls toward the keep window (read by cold_archive_ledger, never by COUNT(*) of the table).' || char(10) ||
 'code-task: repo=qnfo-workers path=scripts/cold_tier.py' || char(10) ||
 'code-anchor: def chunk_sql(t):' || char(10) ||
 'code-probe: {"paths": ["scripts/cold_tier.py"], "contains": "\"table\": \"cloud_ops_events\""}',
 'session:w2f-c', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'COLD-TIER-3:%' AND status = 'open');
