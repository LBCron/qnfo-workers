-- RESEARCH-BUDGET-TASK-RECOVERY-1 (#6176, agent_issues 1000995; charter pillars autonomy and cost).
-- ct_qboaksz1tgbkmj exhausted nine attempts changing a default pinned by budget-gate.test.mjs.
-- Its live ctx also lists cost-first.test.mjs three times, not the failing budget suite.
-- Main now has identical source/mirror files. Re-read both, with the budget test and config migration in scope.
-- The live research_daily_neurons override is 360000: changing only the source default would not steer live spend.
-- Prediction: one bounded, testable retry reaches ready_to_publish; a 120000 target selects lean work earlier,
-- not a hard stop, and makes no promise that historical spend immediately leaves the rolling 30-day metric.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE code_tasks SET (goal,status,step,attempts,model,ctx,last_error,lease_until,updated_at) = (SELECT goal,status,step,attempts,model,ctx,last_error,lease_until,updated_at FROM bak_20261102_research_budget_task WHERE id=code_tasks.id) WHERE id IN (SELECT id FROM bak_20261102_research_budget_task) AND status='queued' AND attempts=0 AND lease_until IS NULL AND instr(goal,'RESEARCH-BUDGET-TASK-RECOVERY-1')>0; UPDATE remediation_contracts SET (precondition,action,verify_probe,verify_transport,module,status,attempts,last_verdict,last_attempt_at,deferred_since,next_due_at,expected_cadence_h) = (SELECT precondition,action,verify_probe,verify_transport,module,status,attempts,last_verdict,last_attempt_at,deferred_since,next_due_at,expected_cadence_h FROM bak_20261102_research_budget_contract WHERE class=remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261102_research_budget_contract) AND module='research-budget-task-recovery-v1' AND EXISTS (SELECT 1 FROM code_tasks t JOIN bak_20261102_research_budget_task b ON b.id=t.id WHERE t.goal=b.goal AND t.status=b.status AND t.ctx=b.ctx)

CREATE TABLE IF NOT EXISTS bak_20261102_research_budget_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_qboaksz1tgbkmj' AND repo = 'qnfo-workers'
  AND path = 'qnfo-research-exec/worker.js' AND status = 'failed'
  AND (lease_until IS NULL OR datetime(lease_until) <= datetime('now'))
  AND COALESCE(pr_url, '') = '' AND merged_at IS NULL
  AND instr(COALESCE(last_error, ''), 'PUBLISH-SUITE-CHECK-1') > 0
  AND instr(goal, 'RESEARCH-BUDGET-TASK-RECOVERY-1') = 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000995 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100226 AND status = 'open')
  AND EXISTS (SELECT 1 FROM ops_config WHERE key = 'code_merge_multi_file' AND value = 'on');

CREATE TABLE IF NOT EXISTS bak_20261102_research_budget_contract AS
SELECT * FROM remediation_contracts
WHERE class = 'issue-1000995'
  AND EXISTS (SELECT 1 FROM bak_20261102_research_budget_task);

UPDATE code_tasks
SET goal = '[issue #100226] RESEARCH-BUDGET-TASK-RECOVERY-1: lower the research soft daily neuron target from 360000 to 120000.'
    || char(10) || 'Change only RESEARCH_DAILY_NEURONS_DEFAULT to 120000 near researchBudget. Keep researchBudget ok=true above the target, lean routing, fail-open reads, pacing, folded-worker accounting and the zero-budget override unchanged. Do not change models, cadence, prompts, metric targets or the 95 USD trigger.'
    || char(10) || 'Companion qnfo-research-exec/budget-gate.test.mjs: assert the new 120000 default and its midnight pace; cover 119999 and 120000 boundaries. Preserve the existing 360000 scenarios with explicit mk(360000, ...) fixtures rather than removing assertions. Keep the 200000 override, disabled budget, D1 failure and runLeased continuation cases.'
    || char(10) || 'Companion migrations/2026-11-02-research-daily-neuron-target.sql: add APPLY-BY ci, DB qnfo-audit and a Rollback line restoring 360000. UPDATE only ops_config research_daily_neurons from 360000 to 120000; preserve other overrides. The live row is 360000, so a source-default edit alone has no live effect. Do not apply the migration by hand.'
    || char(10) || 'Read current main, bump VERSION and keep deployed-current.worker.js identical. Run the existing worker suites, including budget-gate, internal-appendix and park-rearm-cap; do not lower verification. The issue 1000995 recovery probe waits for this task to reach ready_to_publish or later; issue 100226 still closes only on its own cost evidence.',
    status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object(
      'anchor', 'async function researchBudget(env, nowMs) {',
      'extras', json_array(
        json_object('path', 'qnfo-research-exec/budget-gate.test.mjs'),
        json_object('path', 'migrations/2026-11-02-research-daily-neuron-target.sql')
      )
    ),
    last_error = NULL, lease_until = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT id FROM bak_20261102_research_budget_task)
  AND status = 'failed'
  AND (lease_until IS NULL OR datetime(lease_until) <= datetime('now'))
  AND COALESCE(pr_url, '') = '' AND merged_at IS NULL
  AND instr(goal, 'RESEARCH-BUDGET-TASK-RECOVERY-1') = 0;

-- Replace the parked loop-owned contract, not the issue state or its close evidence.
UPDATE remediation_contracts
SET precondition = 'RESEARCH-BUDGET-TASK-RECOVERY-1: the narrowed task must pass verification',
    action = 'qnfo-code-orchestrator owns the retry; the remediation consumer records the passing task-status probe as close evidence for issue 1000995. Queued, failed, missing and merely reworded tasks do not pass. Issue 100226 retains its independent cost probe.',
    verify_probe = 'SELECT 1 AS expected, count(*) AS observed FROM code_tasks WHERE id = ''ct_qboaksz1tgbkmj'' AND status IN (''ready_to_publish'',''branch_pushed'',''published'',''pr_open'',''merged'')',
    verify_transport = 'd1-query', module = 'research-budget-task-recovery-v1',
    status = 'active', attempts = 0, last_verdict = NULL, last_attempt_at = NULL,
    deferred_since = NULL, next_due_at = datetime('now'), expected_cadence_h = 1
WHERE class = 'issue-1000995' AND issue_id = 1000995
  AND COALESCE(module, '') <> 'research-budget-task-recovery-v1'
  AND EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_qboaksz1tgbkmj'
    AND instr(goal, 'RESEARCH-BUDGET-TASK-RECOVERY-1') > 0)
  AND EXISTS (SELECT 1 FROM bak_20261102_research_budget_contract);

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
   capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6176', 'The budget change needs its pinned test and live config override in scope.',
  'RESEARCH-BUDGET-TASK-RECOVERY-1: narrow and requeue ct_qboaksz1tgbkmj',
  'Read live 2026-11-02: failed, attempts=9, PUBLISH-SUITE-CHECK-1; duplicate cost-first companions; research_daily_neurons=360000; code_merge_multi_file=on. Repository source and mirror are identical.',
  'Queued for a fresh read, not yet verified or deployed. Issue closure waits for task-status evidence.',
  'One failed code task and its exhaustion contract; no live budget or worker change.',
  'Use the Rollback header in migrations/2026-11-02-research-budget-task-recovery.sql before the queued task is leased.',
  'The retry may edit its actual regression test and live override together.',
  'One bounded retry reaches ready_to_publish; intended target is one third of the previous neuron target, with no hard stop.',
  'No direct reach change.',
  'Live task/config reads, source/mirror parity, offline SQLite migration and existing budget suites.'
WHERE EXISTS (SELECT 1 FROM code_tasks WHERE id = 'ct_qboaksz1tgbkmj'
    AND instr(goal, 'RESEARCH-BUDGET-TASK-RECOVERY-1') > 0)
  AND EXISTS (SELECT 1 FROM bak_20261102_research_budget_task)
  AND NOT EXISTS (SELECT 1 FROM decision_log
    WHERE action = 'RESEARCH-BUDGET-TASK-RECOVERY-1: narrow and requeue ct_qboaksz1tgbkmj');
