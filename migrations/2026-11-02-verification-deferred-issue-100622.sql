-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_vd_issue_100622
-- Rollback: UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261102_vd_issue_100622 b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261102_vd_issue_100622 b WHERE b.class = remediation_contracts.class), deferred_since = (SELECT b.deferred_since FROM bak_20261102_vd_issue_100622 b WHERE b.class = remediation_contracts.class), next_due_at = (SELECT b.next_due_at FROM bak_20261102_vd_issue_100622 b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261102_vd_issue_100622);
-- VERIFICATION-DEFERRED-7D-1 issue-100622 (2026-11-02, charter pillar autonomy).
-- Issue 100622 is already closed with evidence, but its contract remains active and deferred on a queued-count probe.
-- Supersede only that contract; keep the research queue condition and the closed issue itself unchanged.

CREATE TABLE IF NOT EXISTS bak_20261102_vd_issue_100622 AS
SELECT class, status, last_verdict, deferred_since, next_due_at
FROM remediation_contracts
WHERE class = 'issue-100622'
  AND status = 'active'
  AND last_verdict LIKE 'deferred%'
  AND deferred_since IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN issue_triage t ON t.issue_id = a.id
    WHERE a.id = remediation_contracts.issue_id
      AND a.status = 'closed'
      AND COALESCE(t.close_evidence, '') <> ''
  );

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:contract-on-closed-issue (issue 100622 closed with evidence; VERIFICATION-DEFERRED-7D-1 issue 1001218)',
    deferred_since = NULL,
    next_due_at = NULL
WHERE class = 'issue-100622'
  AND status = 'active'
  AND last_verdict LIKE 'deferred%'
  AND deferred_since IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN issue_triage t ON t.issue_id = a.id
    WHERE a.id = remediation_contracts.issue_id
      AND a.status = 'closed'
      AND COALESCE(t.close_evidence, '') <> ''
  );

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'Copilot PR 6315',
  'a deferred contract attached to an issue closed with evidence is obsolete; superseding it is more accurate than treating its still-measurable queue condition as a passing result',
  'VERIFICATION-DEFERRED-7D-1 issue-100622: supersede the active deferred contract because issue 100622 is closed with evidence; retain its queued-count probe and leave the research queue unchanged',
  'live qnfo-audit read 2026-11-02: issue 100622 is closed with issue_triage.close_evidence referencing remediation_verifications#411462; contract issue-100622 is active/deferred since 2026-10-25; its unchanged probe reads pending: queued=192',
  'after CI apply, issue-100622 is superseded and issue-1001218 closing probe reads cleared on its next pass',
  'one remediation_contracts row and its backup; no issue, probe, queue, worker, trigger or secret is changed',
  'Rollback header restores contract status, verdict, deferral timestamp and next due time from bak_20261102_vd_issue_100622',
  'closed-issue-contract-supersession',
  'the next remediation pass reads issue-1001218 as cleared; the queued-count condition remains visible in the superseded contract probe',
  NULL,
  'node:sqlite migration replay and issue-1001218 d1-query closing probe'
WHERE EXISTS (SELECT 1 FROM bak_20261102_vd_issue_100622)
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'VERIFICATION-DEFERRED-7D-1 issue-100622:') > 0);
