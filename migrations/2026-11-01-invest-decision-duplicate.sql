-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261101_invest_decision_duplicate
-- Rollback: UPDATE issue_triage SET triage_state = (SELECT triage_state FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124 LIMIT 1), close_evidence = (SELECT close_evidence FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124 LIMIT 1) WHERE issue_id = 2124 AND EXISTS (SELECT 1 FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124); UPDATE agent_issues SET status = (SELECT issue_status FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124 LIMIT 1), close_channel = (SELECT issue_close_channel FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124 LIMIT 1), updated_at = (SELECT issue_updated_at FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124 LIMIT 1) WHERE id = 2124 AND EXISTS (SELECT 1 FROM bak_20261101_invest_decision_duplicate WHERE issue_id = 2124); UPDATE remediation_contracts SET status = (SELECT contract_status FROM bak_20261101_invest_decision_duplicate WHERE contract_class = remediation_contracts.class LIMIT 1), last_verdict = (SELECT contract_last_verdict FROM bak_20261101_invest_decision_duplicate WHERE contract_class = remediation_contracts.class LIMIT 1) WHERE issue_id = 2124 AND class IN (SELECT contract_class FROM bak_20261101_invest_decision_duplicate WHERE contract_class IS NOT NULL);
-- REAPPLY-OK: fix ordering after the 2026-11-01 partial apply failed at statement 2
-- INVEST-DECISION-DUPLICATE-1 (issue 2124, charter pillar autonomy): REMEDIATION-REOPEN-2
-- reopened the duplicate after its old close evidence ("Duplicate of agent_issues 1836") did not
-- match the trigger's explicit superseded/moot dispositions. Keep 1836 as the canonical investment
-- decision record, close 2124 through triage with a recognized supersession, and retire its contracts.
CREATE TABLE IF NOT EXISTS bak_20261101_invest_decision_duplicate AS
SELECT a.id AS issue_id, a.status AS issue_status, a.close_channel AS issue_close_channel,
       a.updated_at AS issue_updated_at, t.triage_state, t.close_evidence,
       c.class AS contract_class, c.status AS contract_status, c.last_verdict AS contract_last_verdict
FROM agent_issues a
LEFT JOIN issue_triage t ON t.issue_id = a.id
LEFT JOIN remediation_contracts c ON c.issue_id = a.id
WHERE a.id = 2124;

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:INVEST-DECISION-DUPLICATE-1 by issue 1836'
WHERE issue_id = 2124
  AND status IN ('active', 'holding')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1836);

UPDATE issue_triage
SET close_evidence = 'superseded by agent_issues 1836 (INVEST-DECISION-1; duplicate investment verdict record)',
    triage_state = 'closed'
WHERE issue_id = 2124
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1836)
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 2124);

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-fleet-control (issue 2124 remediation)',
       'issue 2124 is a duplicate of the canonical investment verdict issue 1836, and the relapse trigger requires explicit superseded evidence',
       'INVEST-DECISION-DUPLICATE-1: close issue 2124 through triage as superseded by issue 1836 and supersede its active contracts',
       'issue 2124 reopen record: its prior close evidence named issue 1836 as a duplicate; metric-relapse-2124 failed twice after closure',
       'issue 2124 is closed with evidence recognized by REMEDIATION-REOPEN-2; issue 1836 remains the sole investment verdict record',
       'issue 2124 triage and remediation contracts only',
       'Rollback restores issue, triage and contract values from bak_20261101_invest_decision_duplicate',
       'the recurring duplicate no longer reopens and the canonical issue remains actionable',
       'metric-relapse-2124 reopen count falls from 2 to 0; no change to issue 1836',
       'no external reach change',
       'D1 triage-close synchronization; REMEDIATION-REOPEN-2 superseded-evidence predicate; offline SQLite regression test'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action LIKE 'INVEST-DECISION-DUPLICATE-1:%'
);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('migration-close-before-contract-retire', 'a migration fails when closing an issue with active remediation contracts',
  'the migration closed duplicate issue 2124 before superseding its active contract, so the D1 close guard aborted at statement 2',
  'supersede active contracts before closing the issue and mark a repaired partial migration REAPPLY-OK',
  'fm-migration-close-before-contract-retire', 'fm-migration-close-before-contract-retire', '2026-11-01', 1001246,
  'an issue close runs while its remediation contract is active or holding', 'apply-migrations fails with close-while-contract-fails',
  'qnfo-audit issue_triage and apply-migrations workflow');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, requires_container)
VALUES ('fm-migration-close-before-contract-retire', 1001246, 'The corrected migration is applied',
  'Verify the corrected investment-decision migration has a successful migration_runs row',
  'SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM migration_runs WHERE file = ''migrations/2026-11-01-invest-decision-duplicate.sql'' AND status = ''ok'') THEN ''1'' ELSE ''0'' END AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', 45000, 5, 0);
