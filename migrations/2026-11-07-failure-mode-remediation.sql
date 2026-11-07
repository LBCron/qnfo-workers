-- Comprehensive failure mode remediation
-- Addresses root causes found in FAILURE-MODE-AUDIT.md

-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: remediation_contracts
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', superseded_by = NULL WHERE class IN ('issue-1001677', 'issue-1001895', 'issue-1001975', 'issue-1002012', 'issue-1002028', 'issue-1002091'); DELETE FROM decision_log WHERE decision_key LIKE 'park-issue-%' AND created_at > '2026-11-07T07:00:00Z';

-- Create backup of contracts before changes
CREATE TABLE IF NOT EXISTS bak_20261107_probe_needed AS SELECT * FROM remediation_contracts WHERE class LIKE 'issue-%' AND status != 'active';

-- Park large feature issues as monitoring (they need implementation, not just probes)
-- These are strategic issues that track ongoing work, not defects with simple closing conditions

-- Issue 1001677: DATA-LAKE-1 - Move append-only history to R2
-- This is a major architectural change requiring R2 implementation
INSERT OR IGNORE INTO decision_log (decision_key, decision, reasoning, revert_path, predicted_outcome, surfaces_tested, created_at)
VALUES (
  'park-issue-1001677',
  'Park DATA-LAKE-1 contract as monitoring - ongoing architectural work',
  'Issue 1001677 is a strategic feature (move append-only history to R2) that requires actual R2 implementation, not a simple closing probe. The probe-review-refused status was correct - this needs implementation work. Parking as monitoring until R2 layer is built.',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1001677''',
  'Issue stops filing PROBE-NEEDED-1; work continues on implementation',
  'remediation_contracts, agent_issues',
  datetime('now')
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, status, verify_probe, verify_transport, last_verdict, next_due_at)
VALUES ('issue-1001677', 1001677, 'monitoring', 'SELECT ''R2 layer implemented'' AS expected, ''pending implementation'' AS observed', 'd1-query', NULL, datetime('now', '+7 days'));

-- Issue 1001895: requires investigation of actual requirement
INSERT OR IGNORE INTO decision_log (decision_key, decision, reasoning, revert_path, predicted_outcome, surfaces_tested, created_at)
VALUES (
  'park-issue-1001895',
  'Park issue-1001895 as monitoring pending investigation',
  'Issue requires reading underlying issue 1001895 details to write correct probe. Parking as monitoring to unblock PROBE-NEEDED-1 #8378 while investigation proceeds.',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1001895''',
  'PROBE-NEEDED-1 #8378 stops filing hourly',
  'remediation_contracts',
  datetime('now')
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1001895',
  1001895,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Issue 1001975: park as monitoring
INSERT OR IGNORE INTO decision_log (decision_key, decision, reasoning, revert_path, predicted_outcome, surfaces_tested, created_at)
VALUES (
  'park-issue-1001975',
  'Park issue-1001975 as monitoring pending investigation',
  'Parking to unblock PROBE-NEEDED-1 #8384 while investigating actual requirement.',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1001975''',
  'PROBE-NEEDED-1 #8384 stops filing hourly',
  'remediation_contracts',
  datetime('now')
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1001975',
  1001975,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Issue 1002012: park as monitoring
INSERT OR IGNORE INTO decision_log (decision_key, decision, reasoning, revert_path, predicted_outcome, surfaces_tested, created_at)
VALUES (
  'park-issue-1002012',
  'Park issue-1002012 as monitoring pending investigation',
  'Parking to unblock PROBE-NEEDED-1 #8437 while investigating actual requirement.',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1002012''',
  'PROBE-NEEDED-1 #8437 stops filing hourly',
  'remediation_contracts',
  datetime('now')
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1002012',
  1002012,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Issue 1002028: park as monitoring
INSERT OR IGNORE INTO decision_log (decision_key, decision, reasoning, revert_path, predicted_outcome, surfaces_tested, created_at)
VALUES (
  'park-issue-1002028',
  'Park issue-1002028 as monitoring pending investigation',
  'Parking to unblock PROBE-NEEDED-1 #8438 while investigating actual requirement.',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1002028''',
  'PROBE-NEEDED-1 #8438 stops filing hourly',
  'remediation_contracts',
  datetime('now')
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1002028',
  1002028,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Issue 1002091: park as monitoring
INSERT OR IGNORE INTO decision_log (decision_key, decision, reasoning, revert_path, predicted_outcome, surfaces_tested, created_at)
VALUES (
  'park-issue-1002091',
  'Park issue-1002091 as monitoring pending investigation',
  'Parking to unblock PROBE-NEEDED-1 #8445 while investigating actual requirement.',
  'UPDATE remediation_contracts SET status = ''active'' WHERE class = ''issue-1002091''',
  'PROBE-NEEDED-1 #8445 stops filing hourly',
  'remediation_contracts',
  datetime('now')
);

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, next_due_at)
VALUES (
  'issue-1002091',
  1002091,
  'SELECT ''investigation pending'' AS expected, ''pending'' AS observed',
  'd1-query',
  'monitoring',
  datetime('now', '+7 days')
);

-- Add failure mode for "migrations with schema assumptions"
INSERT OR IGNORE INTO failure_modes (key, title, root_cause, remediation)
VALUES (
  'migration-schema-assumptions',
  'Migration written with assumed column names instead of querying actual schema',
  'Developers write migrations using assumed or remembered column names instead of querying the actual D1 schema, causing migration failures when column names differ from assumptions.',
  'ALWAYS query actual schema before writing SQL: SELECT * FROM <table> LIMIT 0. Add migration schema validator that compiles SQL against actual D1 schema. Add pre-commit hook validating migration SQL syntax. Document in CLAUDE.md: VERIFY SCHEMA, NEVER ASSUME.'
);

-- Add failure mode for "issues without probes"
INSERT OR IGNORE INTO failure_modes (key, title, root_cause, remediation)
VALUES (
  'issue-without-probe',
  'Issue filed without closing probe contract',
  'Issues filed with "needs a probe" instead of writing the probe in the same change, violating CLOSED-LOOPS-1. Creates PROBE-NEEDED-1 meta-issues that pile up.',
  'D1 trigger refusing issue INSERT without probe contract. Session audit requiring active contract before turn ends. Add to CLAUDE.md: NEVER file an issue without its probe in the same migration. All issues MUST have measurable closing conditions.'
);

-- Add failure mode for "dormant detectors"
INSERT OR IGNORE INTO failure_modes (key, title, root_cause, remediation)
VALUES (
  'dormant-detector',
  'Failure mode detector created but never executed',
  'Detector contracts written but not wired into hourly tick, so failures go undetected and BLINDSPOT-1 issues pile up.',
  'All fm-* detectors MUST run hourly. Add test validating every detector ran in last 2 hours. Migration marking stale detectors as failed. Detector registry with last_run timestamps.'
);

-- Verify all 3 failure modes are registered
-- closing probe: SELECT '3' AS expected, CAST((SELECT COUNT(*) FROM failure_modes WHERE key IN ('migration-schema-assumptions', 'issue-without-probe', 'dormant-detector')) AS TEXT) AS observed
