-- ISSUE-AGE-ANCHOR-REARM-1 (charter pillar autonomy; issue 1001196 / target issue 1000552).
-- Live qnfo-audit: the 24h action has no doer and the retry plan was rejected because its generated anchor was not a unique source line.
-- Re-arm only that still-open breach with a verified path and source anchor; the planner, trust, claim, and close-evidence checks remain unchanged.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_issue_1000552_anchor_rearm
-- Rollback: UPDATE agent_issues SET description = (SELECT description FROM bak_20261102_issue_1000552_anchor_rearm WHERE issue_id = agent_issues.id) WHERE id IN (SELECT issue_id FROM bak_20261102_issue_1000552_anchor_rearm) AND description = (SELECT description || char(10) || char(10) || 'ISSUE-AGE-ANCHOR-REARM-1' || char(10) || 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) || 'code-anchor: async function breachDoctorTick(env, opts) {' FROM bak_20261102_issue_1000552_anchor_rearm WHERE issue_id = agent_issues.id); UPDATE issue_plans SET planned_at = (SELECT planned_at FROM bak_20261102_issue_1000552_anchor_rearm WHERE issue_id = issue_plans.issue_id), outcome = (SELECT plan_outcome FROM bak_20261102_issue_1000552_anchor_rearm WHERE issue_id = issue_plans.issue_id) WHERE issue_id IN (SELECT issue_id FROM bak_20261102_issue_1000552_anchor_rearm) AND outcome = 'retry' AND planned_at = '2000-01-01T00:00:00Z' AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = issue_plans.issue_id AND instr(COALESCE(a.description, ''), 'ISSUE-AGE-ANCHOR-REARM-1') = 0);

CREATE TABLE IF NOT EXISTS bak_20261102_issue_1000552_anchor_rearm (
  issue_id INTEGER PRIMARY KEY,
  description TEXT,
  planned_at TEXT,
  plan_outcome TEXT
);

INSERT OR IGNORE INTO bak_20261102_issue_1000552_anchor_rearm (issue_id, description, planned_at, plan_outcome)
SELECT a.id, a.description, p.planned_at, p.outcome
FROM agent_issues a
JOIN issue_plans p ON p.issue_id = a.id
JOIN v_issue_age_ladder l ON l.id = a.id
WHERE a.id = 1000552
  AND a.source = 'qnfo-fleet-control'
  AND a.title LIKE 'METRIC-TRIGGER-14604-DOCTOR-ACTIONS-FAILED-24H:%'
  AND a.status = 'open'
  AND l.breach = 1
  AND p.outcome IN ('invalid', 'retry')
  AND p.task_id IS NULL
  AND instr(p.detail, 'anchor is not one verbatim, unique line of qnfo-fleet-control/worker.js:') > 0
  AND instr(COALESCE(a.description, ''), 'ISSUE-AGE-ANCHOR-REARM-1') = 0
  AND EXISTS (SELECT 1 FROM issue_age_actions ia WHERE ia.issue_id = a.id AND ia.rung = '24h');

UPDATE issue_plans
SET planned_at = '2000-01-01T00:00:00Z',
    outcome = 'retry'
WHERE issue_id IN (SELECT issue_id FROM bak_20261102_issue_1000552_anchor_rearm)
  AND outcome IN ('invalid', 'retry')
  AND task_id IS NULL
  AND instr(detail, 'anchor is not one verbatim, unique line of qnfo-fleet-control/worker.js:') > 0
  AND EXISTS (
    SELECT 1 FROM agent_issues a
    WHERE a.id = issue_plans.issue_id
      AND instr(COALESCE(a.description, ''), 'ISSUE-AGE-ANCHOR-REARM-1') = 0
  );

UPDATE agent_issues
SET description = rtrim(COALESCE(description, '')) || char(10) || char(10)
      || 'ISSUE-AGE-ANCHOR-REARM-1' || char(10)
      || 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10)
      || 'code-anchor: async function breachDoctorTick(env, opts) {',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (SELECT issue_id FROM bak_20261102_issue_1000552_anchor_rearm)
  AND status = 'open'
  AND instr(COALESCE(description, ''), 'ISSUE-AGE-ANCHOR-REARM-1') = 0;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1001196',
  'The open 24h issue remains trusted and claim-gated; its latest planner refusal is specifically a missing unique source anchor.',
  'ISSUE-AGE-ANCHOR-REARM-1: re-arm issue 1000552 with its exact worker path and unique breachDoctorTick source anchor.',
  'Live qnfo-audit reads: issue_age_actions has rung 24h with no-live-doer blocker; issue_plans is retry with an invalid anchor; v_issue_age_ladder reports breach=1.',
  'The existing planner may retry the issue; its trust, path claim, code-task validation, and issue probe remain authoritative.',
  'One open issue description and its issue_plans retry timestamp/outcome.',
  'The Rollback header restores the saved description and plan outcome/timestamp only if the planner has not progressed.',
  'The planner receives a unique source line in its keyword-scoped snippets instead of repeatedly selecting a non-verbatim anchor.',
  'The issue-age repair probe observes breach=0 after an existing live doer or the issue’s own remedy is verified.',
  'none',
  'Live read-only D1 evidence; migrations/2026-11-02-issue-1000552-anchor-rearm.test.mjs; migration header and rollback checks'
WHERE EXISTS (SELECT 1 FROM bak_20261102_issue_1000552_anchor_rearm)
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'ISSUE-AGE-ANCHOR-REARM-1:%');
