-- RESTORE-DRILL-1 (2026-11-04, charter pillar: core; SQL and scheduled steps only, zero AI calls). Owner thread "Make the fleet survive big failures".
-- Measured 2026-11-04: every weekly qnfo-audit export since 2026-10-20 ended ok=0 (HTTP 429 on code_tasks, never retried), 4 of 6 daily snapshots on
-- 2026-11-04 did the same, and no backup was ever restored. scripts/continuity_snapshot.py now retries 429/5xx, reopens a failed export for its failed tables,
-- and stores each database's DDL beside its rows; scripts/d1_restore_drill.py restores the newest exports into a scratch D1 weekly and records the result here.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS d1_restore_drills; DELETE FROM remediation_contracts WHERE class IN ('fm-d1-restore-drill-stale','fm-d1-export-stale'); DELETE FROM failure_modes WHERE fm_key IN ('d1-restore-drill-stale','d1-export-stale');
-- BACKUP: remediation_contracts

CREATE TABLE IF NOT EXISTS d1_restore_drills (
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
CREATE INDEX IF NOT EXISTS d1_restore_drills_ts ON d1_restore_drills (ts);

-- The qnfo-audit D1 single point of failure had no registry row although continuity_snapshot.py stamps it; create it so the stamp lands.
-- alternate_tested_at stays NULL until a drill restores real data and Time Travel answers for one day ago.
INSERT OR IGNORE INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence, issue_id)
VALUES ('qnfo-audit D1', 'every fleet loop reads and writes qnfo-audit (about 1.5 GB, 794 tables)',
  'D1 Time Travel (30 days) plus a daily logical snapshot and a weekly full export to R2 qnfo-backups; RESTORE-DRILL-1 restores them into a scratch D1 weekly',
  NULL,
  'RESTORE-DRILL-1 2026-11-04: before this, the weekly export was ok=0 since 2026-10-20 (HTTP 429, not retried) and no restore had ever been run. The drill stamps this row only after a restore from R2 matches the ledger and a one-day-ago Time Travel bookmark answers.',
  NULL);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('d1-restore-drill-stale', 'backups exist but nothing proves they restore',
  'exports and snapshots were counted by rows written, never restored; a partial export (ok=0) stood for weeks',
  'weekly RESTORE-DRILL-1 restores the newest exports into a scratch D1 and compares counts; a failed drill is a warn event and a stale drill trips this detector',
  'fm-d1-restore-drill-stale', 'fm-d1-restore-drill-stale', '2026-11-04', NULL,
  'no passing drill row in 8 days', 'a lost or corrupted qnfo-audit would be found out during the incident', 'every D1 database in the account');
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to)
VALUES ('fm-d1-restore-drill-stale', NULL,
  'SELECT ''1'' AS expected, CAST(MIN(1, COUNT(*)) AS TEXT) AS observed FROM d1_restore_drills WHERE ok = 1 AND target = ''qnfo-audit-state'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-8 days'')',
  'd1-query', 3, 1, 'active', 'd1_restore_drills installed', 'remediation-consumer runs scripts/d1_restore_drill.py after the continuity snapshot; fix the failing table named in the newest d1_restore_drills.note', 'qnfo-fleet-control');

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('d1-export-stale', 'a database has no complete (ok=1) full export inside 9 days',
  'one 429 on one table marked the whole export ok=0 and the next run skipped the database for six days',
  'continuity_snapshot.py retries 429/5xx with backoff and reopens a young failed export for the failed tables only',
  'fm-d1-export-stale', 'fm-d1-export-stale', '2026-11-04', NULL,
  'a database lacks an ok=1 export row younger than 9 days', 'Time Travel (30 days) is the only copy', 'qnfo-audit, living-paper, q08-signal, personal-life, portfolio-state, qnfo-graph, ipatent-db, qnfo-cms');
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to)
VALUES ('fm-d1-export-stale', NULL,
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM (SELECT ''qnfo-audit'' AS db UNION ALL SELECT ''living-paper'' UNION ALL SELECT ''q08-signal'' UNION ALL SELECT ''personal-life'' UNION ALL SELECT ''portfolio-state'' UNION ALL SELECT ''qnfo-graph'' UNION ALL SELECT ''ipatent-db'' UNION ALL SELECT ''qnfo-cms'') d WHERE NOT EXISTS (SELECT 1 FROM continuity_snapshots n WHERE n.ok = 1 AND n.r2_prefix LIKE ''qnfo-backups/export/'' || d.db || ''/%'' AND n.ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-9 days''))',
  'd1-query', 3, 1, 'active', 'continuity_snapshots installed', 'remediation-consumer export step reopens and finishes the failed tables on its next run', 'qnfo-fleet-control');
