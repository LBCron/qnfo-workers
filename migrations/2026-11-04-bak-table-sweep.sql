-- BAK-TABLE-SWEEP-1 (2026-11-04, program QNFO.INFRA, charter pillar core): expired bak_ tables are dropped once the R2 export holds them.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-bak-tables-accumulate'; DELETE FROM failure_modes WHERE fm_key = 'bak-tables-accumulate'; DELETE FROM ops_config WHERE key = 'bak_table_keep_days'; DROP TABLE IF EXISTS dropped_bak_tables_ledger;
-- CAUSE-MAPPED: registers no metric_registry row; the failure-mode contract fm-bak-tables-accumulate is the alarm.
--
-- Measured 2026-11-04 on qnfo-audit: 941 tables, 239 views, 295 triggers, 653 indexes; 300 of the tables are bak_ copies, every one created 10-24 to 11-04 by a migration
-- that deleted or dropped something (the runner requires a BACKUP table per such file), 258 of them holding 10 rows or fewer. Nothing ever removed one, so the schema
-- gains about 25 tables a day: every statement parse, every sqlite_master read (4,256 rows), the fleet graph and the migration check carry them. The weekly full export
-- to R2 (scripts/continuity_snapshot.py export_step, qnfo-backups export/qnfo-audit/<stamp>/<table>.jsonl.gz, per-table done/live/exported/sha in _progress.json) already
-- holds them. scripts/continuity_snapshot.py bak_sweep now drops a bak_ table whose name date is at least ops_config bak_table_keep_days old (default 7, 'off' stops it)
-- when the latest export holds it completely (done, no error, exported rows at least the rows now) and no view or trigger mentions it, 40 a run, writing each to
-- dropped_bak_tables_ledger with its R2 key and sha. A table with no date in its name, or one the export does not hold, is never dropped.
-- PREDICTION: bak_ tables fall from 300 to about 170 within a day (the ones dated 10-28 and earlier that the export holds), then track the last 7 days of migrations
-- (about 25 a day); total tables 941 -> about 810, then flat. The restore path for a dropped table is the export object named in the ledger.
-- Check: SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'bak\_%' ESCAPE '\'; SELECT COUNT(*) FROM dropped_bak_tables_ledger.

CREATE TABLE IF NOT EXISTS dropped_bak_tables_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rows INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  sha TEXT,
  dropped_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('bak_table_keep_days', '7', 'BAK-TABLE-SWEEP-1: a bak_ table is dropped when its name date is at least this many days old and the latest R2 export holds it; off stops the sweep', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('bak-tables-accumulate', 'bak_ backup tables older than 10 days still exist in qnfo-audit',
  'Every migration that deletes or drops names a BACKUP table and nothing removed it afterwards: 300 bak_ tables in 12 days (941 tables in all), schema growth of about 25 a day',
  'scripts/continuity_snapshot.py bak_sweep (BAK-TABLE-SWEEP-1) drops an expired bak_ table once the weekly R2 export holds it, ledgered in dropped_bak_tables_ledger; fix the export (v_continuity_status, _progress.json errors) when tables stay not-exported',
  'fm-bak-tables-accumulate', 'fm-bak-tables-accumulate', '2026-11-04',
  'A bak_<yyyymmdd>_ table is more than 10 days old',
  'sqlite_master lists bak_ tables dated more than 10 days ago',
  'Schema size: every statement parse, sqlite_master read, fleet-graph build and migration check');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-bak-tables-accumulate', NULL,
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM sqlite_master WHERE type = ''table'' AND name LIKE ''bak\_2026%'' ESCAPE ''\'' AND substr(name, 5, 8) < strftime(''%Y%m%d'', ''now'', ''-10 days'')',
  'd1-query', 1000, 1, 'active',
  'No bak_<yyyymmdd>_ table older than 10 days exists in qnfo-audit',
  'Read the latest continuity_snapshots export row and the _progress.json errors; a bak_ table the export does not hold stays, so finish the export (the weekly export_step resumes) and let bak_sweep drop it; never drop one by hand before its export object exists',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-spend-enforce',
 'A backup table that has outlived its migration and sits in the weekly R2 export is schema weight with no reader',
 'BAK-TABLE-SWEEP-1: bak_sweep in scripts/continuity_snapshot.py drops expired bak_ tables the export holds; ledger dropped_bak_tables_ledger; contract fm-bak-tables-accumulate',
 'sqlite_master on 2026-11-04: 941 tables of which 300 bak_ (10-24 to 11-04), 258 with 10 rows or fewer; the export _progress.json lists 199 bak_ tables, 198 done',
 'bak_ tables older than 7 days leave qnfo-audit after their export object exists; the table is restorable from R2',
 'bak_ tables only; the sweep refuses a table that a view or trigger mentions, one without a date in its name, and one the export does not hold completely',
 'set ops_config bak_table_keep_days to off; recreate a dropped table from its ledger r2_key',
 'qnfo-audit stops growing by about 25 tables a day',
 'bak_ tables 300 -> about 170 within a day, then flat; total tables 941 -> about 810',
 'continuity_snapshot.py --selftest (bak_selftest: young, undated, referenced, not-exported, grew-since-export, per-run cap, off, missing ledger)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'BAK-TABLE-SWEEP-1:%');
