-- PR-6510-SCAN-REPAIR-EVIDENCE-1, pillar autonomy, GitHub issue QNFO/qnfo-workers#6651.
-- GitHub reads on 2026-11-03: commit 234c678084020b7414e3d9a0e79b4c9d17498ea5
-- replaced the banned article fallback with @cf/google/gemma-4-26b-a4b-it.
-- https://github.com/QNFO/qnfo-workers/actions/runs/41598767589/job/125792262439
-- reports scan=success on that head. PR 6510 merged at 2026-11-03T07:52:22Z,
-- merge eae990fbed7b8b659dbda5e0c0a37468f2251984. The live gateway /health
-- returned status=ok, version=3.50.0; 81 article tests and 62 model-floor tests passed.
-- Record the already implemented remedy using the existing ISSUE-HYGIENE-1 ledger.
-- Do not supersede a replacement active probe or re-close a later recurrence.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: issue_fold_ledger
-- Rollback: UPDATE issue_triage SET triage_state = f.triage_state, close_evidence = f.triage_close_evidence, reopened_count = f.triage_reopened_count, triaged_at = f.triage_triaged_at FROM issue_fold_ledger f WHERE issue_triage.issue_id = 1001429 AND f.issue_id = issue_triage.issue_id AND f.rule = 'pr-6510-scan-repair-evidence' AND f.applied = 1 AND issue_triage.close_evidence = f.evidence; UPDATE agent_issues SET status = f.agent_status, close_channel = f.agent_close_channel, updated_at = f.agent_updated_at FROM issue_fold_ledger f WHERE agent_issues.id = 1001429 AND f.issue_id = agent_issues.id AND f.rule = 'pr-6510-scan-repair-evidence' AND f.applied = 1 AND agent_issues.close_channel = 'workflow:ISSUE-HYGIENE-1 pr-6510-scan-repair-evidence'; UPDATE remediation_contracts SET status = f.contract_status, last_verdict = f.contract_last_verdict, last_attempt_at = f.contract_last_attempt_at FROM issue_fold_ledger f WHERE remediation_contracts.class = 'issue-1001429' AND f.contract_class = remediation_contracts.class AND f.rule = 'pr-6510-scan-repair-evidence' AND f.applied = 1 AND remediation_contracts.last_verdict = 'superseded:closure-superseded (PR-6510-SCAN-REPAIR-EVIDENCE-1)';

INSERT INTO issue_fold_ledger
  (issue_id, rule, evidence, agent_status, agent_updated_at, agent_close_channel,
   triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at,
   contract_class, contract_status, contract_last_verdict, contract_last_attempt_at)
SELECT a.id, 'pr-6510-scan-repair-evidence',
  'moot: PR https://github.com/QNFO/qnfo-workers/pull/6510 was repaired by 234c678084020b7414e3d9a0e79b4c9d17498ea5 (Gemma fallback replaces banned model); scan succeeded on that head at https://github.com/QNFO/qnfo-workers/actions/runs/41598767589/job/125792262439; merged 2026-11-03T07:52:22Z as eae990fbed7b8b659dbda5e0c0a37468f2251984. Verified 2026-11-03: gateway /health status=ok version=3.50.0, 81 article tests and 62 model-floor tests passed, source model-floor scan clean and worker mirror identical. PR-6510-SCAN-REPAIR-EVIDENCE-1.',
  a.status, a.updated_at, a.close_channel,
  t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at,
  c.class, c.status, c.last_verdict, c.last_attempt_at
FROM agent_issues a
JOIN issue_triage t ON t.issue_id = a.id
JOIN remediation_contracts c ON c.class = 'issue-1001429' AND c.issue_id = a.id
WHERE a.id = 1001429 AND a.status = 'open' AND a.source = 'qnfo-fleet-control'
  AND a.title = 'STALE-PR-CHECK-REPAIR-1 PR 6510: scan failing on a green, quiet session pull request'
  AND c.status = 'monitoring' AND c.module = 'probe-template-v2d-loop'
  AND NOT EXISTS (
    SELECT 1 FROM issue_fold_ledger f
    WHERE f.issue_id = a.id AND (f.rule = 'pr-6510-scan-repair-evidence' OR f.applied = 0)
  );

UPDATE remediation_contracts
SET status = 'superseded',
    last_verdict = 'superseded:closure-superseded (PR-6510-SCAN-REPAIR-EVIDENCE-1)',
    last_attempt_at = datetime('now')
WHERE class IN (SELECT contract_class FROM issue_fold_ledger
  WHERE issue_id = 1001429 AND rule = 'pr-6510-scan-repair-evidence' AND applied = 0);

UPDATE agent_issues
SET close_channel = 'workflow:ISSUE-HYGIENE-1 pr-6510-scan-repair-evidence'
WHERE id = 1001429 AND status = 'open' AND EXISTS (
  SELECT 1 FROM issue_fold_ledger
  WHERE issue_id = 1001429 AND rule = 'pr-6510-scan-repair-evidence' AND applied = 0);

UPDATE issue_triage
SET triage_state = 'closed', triaged_at = datetime('now'),
    close_evidence = (SELECT evidence FROM issue_fold_ledger
      WHERE issue_id = 1001429 AND rule = 'pr-6510-scan-repair-evidence' AND applied = 0)
WHERE issue_id = 1001429 AND EXISTS (
  SELECT 1 FROM issue_fold_ledger
  WHERE issue_id = 1001429 AND rule = 'pr-6510-scan-repair-evidence' AND applied = 0);

UPDATE issue_fold_ledger SET applied = 1, applied_at = datetime('now')
WHERE issue_id = 1001429 AND rule = 'pr-6510-scan-repair-evidence' AND applied = 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001429 AND status = 'closed');
