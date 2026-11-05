-- C5-ENGINE-CONTRACTS-ACTIVE-1 (2026-11-05, charter pillar autonomy; follow-up to migrations/2026-11-04-c5-engine-roadmap-rows.sql, PR 7329).
-- Live read after that file applied: the three ROADMAP-1 issues (ids 1001865, 1001866, 1001867) carry the probes the file wrote, but their contracts stayed status superseded with the birth
-- template text (VACUOUS-PROBE-V3-1: the trigger contract_probe_templates_v3_generic supersedes a contract born from an issue insert, and an UPDATE of verify_probe does not re-arm it).
-- A superseded contract is never run, so the issues had no closing probe. This file re-arms them: status active, no verdict, due now, with the precondition and action that match the probe.
-- Prediction: the next remediation consumer run attempts all three (last_attempt_at set, last_verdict fail while the defect stands: 978 claim-held rows in 24 h, 5 twin-file and 32 patch-too-large failures since 2026-11-02),
-- and each passes by itself after the code loop lands its lever.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', next_due_at = NULL WHERE class IN (SELECT 'issue-' || id FROM agent_issues WHERE source = 'session:c5-engine' AND (title LIKE 'ROADMAP-1: autonomy #S2.1:%' OR title LIKE 'ROADMAP-1: autonomy #T1.25:%' OR title LIKE 'ROADMAP-1: autonomy #T1.26:%'));

UPDATE remediation_contracts
SET status = 'active',
    attempts = 0,
    last_verdict = NULL,
    last_attempt_at = NULL,
    next_due_at = datetime('now'),
    precondition = 'issue open; the code loop executes the code-task line of the issue',
    action = 'measure the defect named in the issue (code_tasks or cloud_ops_events counts); the contract passes by itself once the lever has landed',
    escalate_to = 'qnfo-code-orchestrator',
    module = 'roadmap'
WHERE class IN (SELECT 'issue-' || id FROM agent_issues
                WHERE source = 'session:c5-engine' AND status = 'open'
                  AND (title LIKE 'ROADMAP-1: autonomy #S2.1:%' OR title LIKE 'ROADMAP-1: autonomy #T1.25:%' OR title LIKE 'ROADMAP-1: autonomy #T1.26:%'))
  AND status = 'superseded'
  AND verify_probe NOT LIKE '%closed%';
