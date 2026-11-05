-- HEALTH-READBACK-1 (2026-11-05, charter pillar autonomy; GitHub QNFO/qnfo-workers#6157; agent_issues 1000982 IMPROVEMENT-TERMINAL-DISPOSITION, improvement #3204 "Credential Inflation in Formal Verification"; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_health_readback
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_e_health_readback b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1000982' AND EXISTS (SELECT 1 FROM bak_20261105_e_health_readback b WHERE b.class = remediation_contracts.class)
-- CAUSE-MAPPED: no metric is registered here; this replaces one contract probe.
--
-- The improvement: "a version bump must be tied to a verified deploy (health-check read-back), not a string edit. The credential is the running artifact, not the label."
-- Read 2026-11-05: worker_live_audit.health_probed_at and health_error exist (migrations/2026-11-01-one-probe-pass.sql) and nothing wrote them: 38 of 38 live version credentials in service_registry had no read-back on record,
-- although scripts/fleet-autoaudit.py already reads every worker's /health through deploy-drift-guard.py each hour and stores the version it served in live_version.
-- The code half (same PR): fleet-autoaudit.py health_stamp writes health_probed_at when /health answered 200 and named a version in that run, and health_error with the reason otherwise; a failed read clears an old stamp.
-- This file narrows and hardens the closing probe:
--   * scope: kind = 'worker' (a deployed script with its own /health). The one live `member` row (qnfo-backlog-exec, '2.0.7-folded') is a folded module with no script of its own (worker_live_audit note NOT_DEPLOYED,
--     http 404): it has no running artifact to read back, so counting it made the probe unsatisfiable for ever;
--   * freshness: the read-back must be under 3 hours old (the audit runs hourly), so a stamp from a worker that stopped answering does not count;
--   * the label is not compared with the served version here (a deploy changes the registry label up to an hour before the next audit run, which would flap the probe on every merge); drift between the two is the
--     job of the deploy-drift detectors that already read worker_live_audit.match.

CREATE TABLE IF NOT EXISTS bak_20261105_e_health_readback (class TEXT PRIMARY KEY, verify_probe TEXT);
INSERT OR IGNORE INTO bak_20261105_e_health_readback (class, verify_probe)
SELECT class, verify_probe FROM remediation_contracts WHERE class = 'issue-1000982';

UPDATE remediation_contracts
SET verify_probe = 'WITH cred AS (SELECT service AS worker, version AS label FROM service_registry WHERE state = ''live'' AND kind = ''worker'' AND version IS NOT NULL AND version <> ''unknown'') SELECT ''0 live version credentials without a health-check read-back'' AS expected, CAST(COUNT(*) AS TEXT) || '' live version credentials without a health-check read-back'' AS observed FROM cred WHERE NOT EXISTS (SELECT 1 FROM worker_live_audit w WHERE w.worker = cred.worker AND w.live_version IS NOT NULL AND w.health_probed_at IS NOT NULL AND w.health_probed_at > datetime(''now'', ''-3 hours''))',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000982' AND issue_id = 1000982;
