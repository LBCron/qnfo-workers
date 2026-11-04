-- COLD-TIER-1 (2026-11-04, charter pillar cost; owner question "D1 is slow and has way too many rows", docs/D1-TIERING-2026-11.md).
-- Measured 2026-11-04 on qnfo-audit: 1.45 GB, 639 tables plus 268 bak_ tables (8 MB in all), 645 indexes, 1.55 M rows. Largest append-only tables: fleet_probe_log 212,959 rows / 61 MB
-- (21 days kept, every reader asks for the last day or the latest row per probe), remediation_verifications 363,497 rows / 56 MB and 7 indexes (8 days kept, a rollup of it exists nowhere),
-- bp26_probe_results 62,294 rows / 9.5 MB with no retention at all (about 7 k rows a day, 55 metrics x 449 subjects).
-- Change: the tables and knob scripts/cold_tier.py needs. The script (run by continuity_snapshot.py main, remediation-consumer workflow) writes cold_rollup_daily rows for every complete
-- day first, then archives rows older than keep_days to R2 qnfo-backups cold/qnfo-audit/<table>/<yyyymm>/<table>-<idmin>-<idmax>.jsonl.gz, reads each object back and compares its sha256 and
-- line count, writes the cold_archive_ledger row, and only then deletes (fleet_probe_log keeps 3 days, bp26_probe_results 7; the newest row of each probe key always stays).
-- remediation_verifications is copied 2 days before retention_prune_tick_v2 deletes at 8 days (no delete by this script).
-- This file creates tables, one knob, a failure mode with its closing probe, a read view and a decision_log row; it deletes nothing.
-- PREDICTION: fleet_probe_log 212,959 -> about 35,000 rows within 4 days (190 k archived at 2,400 deleted rows a run; 30 k kept), bp26_probe_results stops growing past about 55,000 rows,
-- cold_rollup_daily about 5,000 rows a month, R2 objects about 30 a day; rows read by readers of those tables fall in proportion; qnfo-audit file size falls only after D1 reuses freed pages.
-- Restore: gunzip the object named in cold_archive_ledger.r2_key and INSERT OR IGNORE the lines back (columns are the table's own).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = 'off' WHERE key = 'cold_tier'; DROP VIEW IF EXISTS v_cold_tier_status; DELETE FROM remediation_contracts WHERE class = 'fm-cold-archive-lag'; DELETE FROM failure_modes WHERE fm_key = 'cold-archive-lag'; (the two tables hold the ledger and the rollups: keep them, the R2 objects are named in the ledger)
-- CAUSE-MAPPED: registers no metric_registry row; the failure-mode contract fm-cold-archive-lag is the alarm.

CREATE TABLE IF NOT EXISTS cold_archive_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  src_table TEXT NOT NULL,
  id_min INTEGER NOT NULL,
  id_max INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  deleted_rows INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_cold_ledger_table ON cold_archive_ledger (src_table, id_max);

CREATE TABLE IF NOT EXISTS cold_rollup_daily (
  src_table TEXT NOT NULL,
  day TEXT NOT NULL,
  dim1 TEXT NOT NULL,
  dim2 TEXT NOT NULL,
  n INTEGER NOT NULL,
  n_ok INTEGER NOT NULL,
  n_fail INTEGER NOT NULL,
  v1 REAL,
  v2 REAL,
  rolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (src_table, day, dim1, dim2)
);

CREATE VIEW IF NOT EXISTS v_cold_tier_status AS
SELECT src_table, COUNT(*) AS objects, SUM(rows) AS rows_archived, SUM(deleted_rows) AS rows_pruned, SUM(bytes) AS bytes_r2,
       MAX(archived_at) AS last_archived_at, SUM(verified = 0) AS unverified
FROM cold_archive_ledger GROUP BY src_table;

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('cold_tier', 'on', 'COLD-TIER-1: scripts/cold_tier.py rolls up, archives to R2 and prunes fleet_probe_log, bp26_probe_results (and copies remediation_verifications); off stops it', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('cold-archive-lag', 'fleet_probe_log keeps more than 1,000 rows older than 5 days: the cold-tier archive is not running or not verifying',
  'scripts/cold_tier.py deletes a row only after its R2 object was read back and matched; when the object cannot be written or read, nothing is deleted and the table grows again',
  'read the latest continuity-snapshot run log line {"cold-tier": ...} (error field), cold_archive_ledger / v_cold_tier_status, and ops_config cold_tier; fix the R2 write or the budget, never delete the rows by hand',
  'fm-cold-archive-lag', 'fm-cold-archive-lag', '2026-11-04',
  'fleet_probe_log rows older than 5 days exceed 1,000 (30 000 would be a 3-day-keep table that was never pruned)',
  'SELECT COUNT(*) FROM fleet_probe_log WHERE ts < now - 5 days',
  'D1 size and the rows read by every reader of fleet_probe_log');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-cold-archive-lag', NULL,
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT COUNT(*) FROM fleet_probe_log WHERE ts < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-5 days'')) > 1000 THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 1000, 1, 'active',
  'fleet_probe_log holds at most 1,000 rows older than 5 days (the newest row of each probe key is kept, a few hundred)',
  'Read the {"cold-tier": ...} line of the last remediation-consumer continuity step and v_cold_tier_status; a tier with error verify-sha-mismatch or r2-put-refused is an R2 problem, a tier with stopped=budget needs another run',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:d1-slim-tiering', 'old telemetry rows are read by nobody but the question "how reliable has X been", which a daily rollup answers in a few hundred rows; the raw rows belong in R2',
  'COLD-TIER-1: cold_archive_ledger, cold_rollup_daily, ops_config cold_tier, fm-cold-archive-lag; scripts/cold_tier.py archives fleet_probe_log and bp26_probe_results to R2 (verified read-back) before it prunes them',
  'D1 2026-11-04: fleet_probe_log 212,959 rows / 61 MB, bp26_probe_results 62,294 rows with no retention, remediation_verifications 363,497 rows; readers of fleet_probe_log ask for the last day or the latest row per name',
  'raw rows older than 3 days (7 for bp26) leave D1 only after an R2 object holds them; a daily rollup keeps the reliability history', 'fleet_probe_log, bp26_probe_results (prune), remediation_verifications (copy only)',
  'ops_config cold_tier = off; restore from the ledger r2_key', 'cold data costs R2 storage (free tier) instead of D1 pages and index entries',
  'fleet_probe_log 212,959 -> about 35,000 rows in 4 days; bp26_probe_results flat; rollups present for each complete day',
  NULL, 'python scripts/cold_tier.py --selftest (rollup before prune, sha mismatch deletes nothing, newest row per key kept, kill switch); migrations/cold-tier-1.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'COLD-TIER-1:%');
