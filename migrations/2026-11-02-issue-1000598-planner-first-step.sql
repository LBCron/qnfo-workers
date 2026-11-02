-- ISSUE-AGE-24H-REPAIR-1 (issue 1001205, autonomy): issue 1000598 has no live task, claim, or progressing diagnosis.
-- Its existing plan retries the whole qnfo-ipatent retirement as one worker.js edit, despite the issue's ordered dependency work.
-- Put the first single-file dashboard step first so trusted planner intake can decide it under its normal checks.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_issue_1000598_planner_first_step
-- Rollback: UPDATE agent_issues SET description = (SELECT description FROM bak_20261102_issue_1000598_planner_first_step WHERE id = 1000598) WHERE id = 1000598 AND EXISTS (SELECT 1 FROM bak_20261102_issue_1000598_planner_first_step WHERE id = 1000598); DROP TABLE IF EXISTS bak_20261102_issue_1000598_planner_first_step;

CREATE TABLE IF NOT EXISTS bak_20261102_issue_1000598_planner_first_step (
  id INTEGER PRIMARY KEY,
  description TEXT
);

INSERT OR IGNORE INTO bak_20261102_issue_1000598_planner_first_step
SELECT id, description FROM agent_issues WHERE id = 1000598;

UPDATE agent_issues AS a
SET description =
  'NEXT EXECUTABLE STEP: make only the first ordered retirement change, removing the iPatent dashboard tile and reads from qnfo-fleet-dashboard/worker.js. Keep this as a one-file task; leave qnfo-ops, qnfo-ipatent, the service binding, and the later retirement/deletion steps untouched. The trusted planner and intake decide whether to enqueue it; existing refusal, path-claim, and verification checks still apply. Keep this issue open through the later dependency and retirement steps.' ||
  char(10) || 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' ||
  char(10) || 'code-anchor: async function ipatentUsage(env) {' ||
  char(10) || char(10) || COALESCE(a.description, '')
WHERE a.id = 1000598
  AND a.status = 'open'
  AND a.title = 'NET-ZERO-1: retire qnfo-ipatent to fund qnfo-youtube-shorts (same class, reach)'
  AND COALESCE(a.description, '') NOT LIKE '%code-task:%'
  AND EXISTS (
    SELECT 1 FROM issue_age_actions x
    WHERE x.issue_id = a.id
      AND x.rung = '24h'
      AND x.blocker = 'no live task, claim or progressing diagnosis'
  )
  AND EXISTS (
    SELECT 1 FROM issue_plans p
    WHERE p.issue_id = a.id
      AND p.outcome = 'retry'
      AND p.planned_at = '2000-01-01T00:00:00Z'
      AND p.task_id IS NULL
      AND p.path = 'qnfo-ipatent/worker.js'
      AND p.detail LIKE '%cannot be resolved by a single code edit%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM code_tasks k
    WHERE (k.goal LIKE '[issue #' || a.id || ']%' OR k.id = 'ct_im' || a.id)
      AND k.status NOT IN ('merged', 'closed', 'superseded', 'publish_failed', 'needs_human', 'failed', 'reverted')
      AND (k.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 minutes')
           OR k.lease_until > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM work_claims w
    WHERE (w.issue_id = a.id OR w.path = 'issue:' || a.id)
      AND w.released_at IS NULL
      AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  )
  AND NOT EXISTS (
    SELECT 1 FROM breach_diagnoses d
    WHERE d.issue_id = a.id
      AND d.mode = 'on'
      AND d.state IN ('queued', 'applied', 'verifying')
      AND d.action_ref IS NOT NULL
      AND d.action_kind <> 'none'
      AND d.lease_until > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      AND d.last_progress_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-120 minutes')
  );

INSERT INTO decision_log (
  actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
  capability_gain, predicted_outcome, reach_gain, surfaces_tested
)
SELECT 'copilot:1001205',
  'Issue 1000598 has a 24h no-doer action and its only plan retries a multi-step retirement as one qnfo-ipatent worker.js edit.',
  'ISSUE-AGE-24H-REPAIR-1: expose the first ordered single-file dashboard step to trusted planner intake.',
  'Live qnfo-audit reads: issue_age_actions rung 24h says no live task, claim, or progressing diagnosis; issue_plans has a retry for qnfo-ipatent/worker.js with no task id. The issue already specifies the dashboard step and its ipatentUsage anchor.',
  'The issue remains open; the trusted planner can decide whether to enqueue only the first dashboard file step using its existing refusal, claim, and verification checks.',
  'Issue 1000598 description only; no task, claim, diagnosis, plan, or close state is changed.',
  'Restore the original description from bak_20261102_issue_1000598_planner_first_step; the decision log remains append-only.',
  'The planner receives a bounded first code step instead of the full multi-stage retirement as one edit.',
  'The 24h no-doer breach for issue 1000598 falls from 1 to 0 after a live task or progressing diagnosis is established within 120 minutes; the issue closes only after its own probe passes.',
  'No direct external reach gain; the existing dashboard remains intact until its verified code change.',
  'Read issue_age_actions, issue_plans, agent_issues, code_tasks, work_claims, breach_diagnoses, and the unique qnfo-fleet-dashboard ipatentUsage anchor; migration regression test and apply-migrations check.'
WHERE EXISTS (
    SELECT 1 FROM bak_20261102_issue_1000598_planner_first_step b
    JOIN agent_issues a ON a.id = b.id
    WHERE b.id = 1000598
      AND a.status = 'open'
      AND instr(a.description, 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js') > 0
      AND a.description LIKE '%code-anchor: async function ipatentUsage(env) {%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM decision_log
    WHERE action = 'ISSUE-AGE-24H-REPAIR-1: expose the first ordered single-file dashboard step to trusted planner intake.'
  );
