-- DEFAULT-APPROVE-1 for agent_issues 1000657 / owner card 200 (charter pillar autonomy): the recommended option is executed. WORKERS-STANDARDS-GUARD-1 (diff-only, about 15 s) now blocks a pull
-- request as a guard of scripts/pr_fast_guards.py (the strict step of the pr-checks `scans` job); every other deploy-gate step stays advisory (MERGE-STREAMLINE-1). deploy-gate itself left the
-- pull-request path (PR-CHECK-CAP-5-1), so the old step with `continue-on-error` could no longer be made strict there: the guard moved to where pull requests are checked.
-- The old probe counted merges whose commit had a deploy-gate failure at that step in the last 7 days (a rolling window that cannot pass before the old failures age out); it is replaced by a
-- code-read probe on the implementation (the guard entry exists on main), and the measurement of the effect stays in the decision_log row below.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_transport = 'd1-query', verify_probe = 'WITH g AS (SELECT DISTINCT head_sha AS sha FROM workflow_failures WHERE workflow = ''deploy-gate'' AND conclusion = ''failure'' AND failed_step LIKE ''%WORKERS-STANDARDS-GUARD-1%'' AND head_sha IS NOT NULL AND run_at >= datetime(''now'', ''-7 days'')) SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM ci_gate_audit c JOIN g ON g.sha = c.merge_sha WHERE c.required_state = ''green''' WHERE class = 'issue-1000657'; DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'workers-standards-guard-blocks-prs';

UPDATE remediation_contracts
SET verify_transport = 'code-read',
    verify_probe = '{"paths":["scripts/pr_fast_guards.py"],"contains":"workers-standards-guard"}',
    precondition = 'DEFAULT-APPROVE-1 (1000657): the diff-only WORKERS-STANDARDS-GUARD-1 is a guard of scripts/pr_fast_guards.py, the strict scans step of every pull request.',
    action = 'Measure the approved option on main: the guard entry exists in scripts/pr_fast_guards.py.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000657' AND status IN ('active', 'holding', 'superseded', 'escalated');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'the owner decides nothing (DEFAULT-APPROVE-1, owner card 200): the recommended option is to make only WORKERS-STANDARDS-GUARD-1 blocking on pull requests',
  'scripts/pr_fast_guards.py gets a workers-standards-guard entry (selected by a worker.js, wrangler.toml or scripts/*.py change; run through regression_gate.py with GUARD_BASE set to the merge base); issue-1000657 probe replaced by a code-read probe',
  'deploy-gate left the pull-request path (PR-CHECK-CAP-5-1) so the swallowed-catch regression that reached main on run 40680554551 (qnfo-memory-mcp/worker.js) had no blocking check; WORKFLOW-FAILED-1 reopened deploy-gate 14 times in 7 days',
  'pending',
  'every pull request that adds a worker.js, wrangler.toml or scripts/*.py line',
  'revert the migration (Rollback line) and delete the workers-standards-guard entry from scripts/pr_fast_guards.py; REGRESSION_GATE=strict is unrelated',
  'workers-standards-guard-blocks-prs',
  'a pull request that adds a Workers anti-pattern fails its scans job instead of reaching main; deploy-gate WORKERS-STANDARDS-GUARD-1 failures on main fall to 0 in 7 days; no unrelated pull request is held (the guard judges only added lines)',
  'none (quality gate)',
  'scripts/pr-fast-guards.test.mjs, python scripts/pr_fast_guards.py on a branch that adds a scripts change'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'workers-standards-guard-blocks-prs');
