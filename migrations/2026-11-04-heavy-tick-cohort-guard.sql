-- HEAVY-TICK-COHORT-GUARD-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1, owner: fleet cost under $200-300 a month).
-- Measured 2026-11-04 ~16:00Z on qnfo-audit: the fleet_tick_heavy trigger output_quality_cohort_snapshot_tick (PERSONA-VIEWS-ROWS-READ-1) re-computes
-- v_output_quality_remediation_cohort_raw on EVERY heavy tick: 761,449 rows read and 1.8 s per refresh (SELECT part run against live data), about 145
-- heavy ticks a day, so about 110 M rows a day and 4 minutes of single-writer D1 time, for a one-row snapshot that its reader
-- (v_output_quality_remediation_cohort) accepts for 90 minutes and that PERSONA-VIEWS-ROWS-READ-1 documents as refreshed "about every 30 min".
-- The trigger carries no WHEN, so the cadence it was designed for was never enforced. The guard below refreshes only when the snapshot is
-- 30 minutes old (or missing), which keeps a 60-minute margin before readers fall back to the live computation.
-- Prediction: heavy-tick rows read about 0.78 M -> about 0.18 M on average (-77 %); the INSERT INTO fleet_tick_heavy statement (129 M rows read
-- in 24 h, 545 calls) falls by about 100 M rows a day; v_output_quality_headline stays at 326 rows a read; the snapshot's computed_at stays under 40 minutes old.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_cohort_snapshot_tick
-- Rollback: DROP TRIGGER IF EXISTS output_quality_cohort_snapshot_tick; then re-create it from bak_20261104_cohort_snapshot_tick (column sql holds the exact previous CREATE statement); DELETE FROM remediation_contracts WHERE class = 'fm-cohort-snapshot-stale'; DELETE FROM failure_modes WHERE fm_key = 'cohort-snapshot-stale'
-- spof-review: one trigger gains a WHEN guard (same statement, same table); the readers keep their live fallback when the snapshot is older than 90 minutes.

CREATE TABLE IF NOT EXISTS bak_20261104_cohort_snapshot_tick AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'output_quality_cohort_snapshot_tick';

DROP TRIGGER IF EXISTS output_quality_cohort_snapshot_tick;
CREATE TRIGGER output_quality_cohort_snapshot_tick AFTER INSERT ON fleet_tick_heavy
WHEN NOT EXISTS (SELECT 1 FROM output_quality_cohort_snapshot WHERE k = 1 AND computed_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 minutes'))
BEGIN
  INSERT OR REPLACE INTO output_quality_cohort_snapshot (k, computed_at, now_day, prev_day, subjects, now_value, prev_value)
  SELECT 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), now_day, prev_day, subjects, now_value, prev_value FROM v_output_quality_remediation_cohort_raw;
END;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('cohort-snapshot-stale',
  'the one-row cohort snapshot behind v_output_quality_headline is older than its 90-minute freshness window, so every reader re-computes the 760 K-row cohort and the headline costs 760 K rows a read again',
  'the snapshot is refreshed only by output_quality_cohort_snapshot_tick on fleet_tick_heavy; if the heavy tick stops (orchestrator down, trigger dropped, raw view empty) nothing else refreshes it',
  'HEAVY-TICK-COHORT-GUARD-1: the trigger refreshes at 30 minutes of age (60 minutes of margin); this detector fails when the snapshot is older than 75 minutes, so a stopped refresher is seen before readers fall back',
  'fm-cohort-snapshot-stale: 1 when output_quality_cohort_snapshot is missing or its computed_at is older than 75 minutes, expected 0',
  'fm-cohort-snapshot-stale', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'fleet_tick_heavy stops receiving rows for over 75 minutes, or the raw cohort view returns no row',
  'v_output_quality_headline reads 760 K rows again; D1 rows read per hour rises by the number of headline readers times 760 K',
  'dashboard status build, qnfo-ai spend block, management-personas persona_briefs');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-cohort-snapshot-stale', NULL, 'HEAVY-TICK-COHORT-GUARD-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN EXISTS (SELECT 1 FROM output_quality_cohort_snapshot WHERE k = 1 AND computed_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-75 minutes'')) THEN 0 ELSE 1 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a snapshot trigger without a WHEN refreshes on every heavy tick, so its documented 30-minute cadence is five times too frequent',
  'HEAVY-TICK-COHORT-GUARD-1: output_quality_cohort_snapshot_tick gains WHEN snapshot older than 30 minutes; detector fm-cohort-snapshot-stale at 75 minutes',
  'd1QueriesAdaptiveGroups 24 h: INSERT INTO fleet_tick_heavy 129 M rows read in 545 calls; per-trigger SELECT parts: cohort snapshot 761 K rows and 1.8 s, all other heavy triggers 76 K together',
  'same snapshot values, refreshed every 30-60 minutes instead of every 10', 'one trigger on fleet_tick_heavy (old text in bak_20261104_cohort_snapshot_tick); readers unchanged',
  'the Rollback line', 'the heavy tick costs about a quarter of its rows',
  'fleet_tick_heavy statement rows read 129 M -> under 40 M a day; snapshot computed_at under 40 minutes old at every read', NULL, 'SQLite test in migrations/heavy-tick-cohort-guard.test.mjs, live SELECT-part measurement'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'HEAVY-TICK-COHORT-GUARD-1:%');
