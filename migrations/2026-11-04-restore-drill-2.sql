-- RESTORE-DRILL-2 (2026-11-04, SURVIVE-1 fix). 2026-11-04-restore-drill.sql did CREATE TABLE IF NOT EXISTS d1_restore_drills, but that name already belongs to
-- scripts/cf_ops_d1_drill_test.py (the Time Travel drill of 2026-10-28: columns source_db, scratch_db, bookmark, rows_checked, outcome, evidence), so the create did
-- nothing and the export-restore drill's inserts and the two probes of that file would fail on columns that do not exist. The export-restore drill now writes
-- its own table, d1_export_restore_drills, and the probe reads it. The earlier file is not edited (the runner re-applies an edited file).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS d1_export_restore_drills; UPDATE remediation_contracts SET verify_probe = 'SELECT ''1'' AS expected, ''0'' AS observed' WHERE class = 'fm-d1-restore-drill-stale';
-- BACKUP: remediation_contracts
CREATE TABLE IF NOT EXISTS d1_export_restore_drills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  target TEXT NOT NULL,
  source_prefix TEXT,
  scratch_db TEXT,
  tables_total INTEGER NOT NULL DEFAULT 0,
  tables_ok INTEGER NOT NULL DEFAULT 0,
  rows_restored INTEGER NOT NULL DEFAULT 0,
  schema_source TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS d1_export_restore_drills_ts ON d1_export_restore_drills (ts);
UPDATE remediation_contracts SET
  verify_probe = 'SELECT ''1'' AS expected, CAST(MIN(1, COUNT(*)) AS TEXT) AS observed FROM d1_export_restore_drills WHERE ok = 1 AND target = ''qnfo-audit-state'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-8 days'')',
  action = 'remediation-consumer runs scripts/d1_restore_drill.py after the continuity snapshot; fix the failing table named in the newest d1_export_restore_drills.note'
WHERE class = 'fm-d1-restore-drill-stale';
