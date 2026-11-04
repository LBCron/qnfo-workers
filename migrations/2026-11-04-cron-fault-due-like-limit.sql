-- CRON-FAULT-DUE-LIKE-1 (2026-11-04, charter pillar autonomy; family worker-observability / cron-watch).
-- v_cron_fault_due compared an issue title with  LIKE 'CRON-HOURLY-FLOOR-1:' || worker || ':%'.  D1 refuses a LIKE or GLOB pattern longer than 50 bytes
-- ("D1_ERROR: LIKE or GLOB pattern too complex", code 7500); the prefix is 20 bytes + ':%', so any worker name over 28 bytes (fleet-exec:management-personas-b-hourly is 39)
-- makes every read of the view fail. Measured live 2026-11-04 22:20Z: SELECT COUNT(*) FROM v_cron_fault_due -> that error; the cron-watch fleet task (the only reader)
-- was failing the same way (task-failed:cron-watch, 30 consecutive fails at 20:37Z), so no cron fault became an issue, among them
-- worker-silent:qnfo-research-exec ("no run recorded since 2026-11-04T21:20:57Z"). The same read with a substr() prefix compare returns the 7 current faults in 1,605 rows.
-- Same predicate, no pattern: substr(title, 1, length(prefix)) = prefix. A literal title containing % or _ no longer acts as a wildcard (it never should have).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_v_cron_fault_due
-- Rollback: DROP VIEW IF EXISTS v_cron_fault_due; then re-create it from bak_20261104_v_cron_fault_due (column sql holds the exact previous CREATE VIEW statement)
-- spof-review: one view redefined with the same columns; cron-watch reads it unchanged.

CREATE TABLE IF NOT EXISTS bak_20261104_v_cron_fault_due AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_cron_fault_due';

DROP VIEW IF EXISTS v_cron_fault_due;
CREATE VIEW v_cron_fault_due AS
SELECT * FROM v_cron_fault_now
WHERE first_seen <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', CASE WHEN kind = 'schedule' THEN '-90 minutes' ELSE '-9 minutes' END)
  AND NOT (kind = 'schedule' AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.status = 'open'
    AND substr(a.title, 1, length('CRON-HOURLY-FLOOR-1:' || v_cron_fault_now.worker || ':')) = 'CRON-HOURLY-FLOOR-1:' || v_cron_fault_now.worker || ':'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:d1-ai-cost', 'a LIKE pattern built from a worker name stays under D1''s 50-byte pattern limit',
  'CRON-FAULT-DUE-LIKE-1: v_cron_fault_due compares the title prefix with substr(), not LIKE',
  'live: COUNT(*) FROM v_cron_fault_due -> LIKE or GLOB pattern too complex; blind-spot-audit and cron-watch fleet runs failed with the same text; the substr form returned the 7 current faults',
  'cron faults become issues again', 'one view (old text in bak_20261104_v_cron_fault_due)', 'the Rollback line', 'cron-watch can file faults for long worker names',
  'v_cron_fault_due readable: SELECT COUNT(*) works; task-failed:cron-watch clears within two ticks', NULL, 'live SELECT on qnfo-audit before and after; migrations/cron-fault-due-like-limit.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'CRON-FAULT-DUE-LIKE-1:%');
