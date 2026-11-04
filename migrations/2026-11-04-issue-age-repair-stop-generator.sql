-- ISSUE-AGE-REPAIR-STOP-1 (2026-11-04, charter pillar autonomy): stop filing a second issue for every aged issue that has no doer.
-- Measured on qnfo-audit 2026-11-04: ISSUE-AGE-24H-REPAIR-1 is the largest open family (105 of 598), 192 filed in 7 days, and the planner re-plans the parent itself
-- (step 3 of this same task sets its plan to retry), so the ticket adds no doer: it is itself an open issue that needs one. The blocker stays recorded on the parent
-- (issue_age_actions, rung 24h) and the parent is escalated to critical by the rung steps that remain.
-- This removes only the step that INSERTs the REPAIR issue; the other eleven steps of the task are unchanged.
-- Prediction: ISSUE-AGE-24H-REPAIR-1 issues filed per day fall from about 27 to 0 within 24 h; open doerless issues fall by the 105 existing tickets once they are closed as superseded by their parents.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_issue_age_live_doers_task
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_issue_age_live_doers_task WHERE id = 'issue-age-live-doers' AND src = 'fleet_tasks'), version = version + 1 WHERE id = 'issue-age-live-doers'; UPDATE fleet_tasks_canonical SET definition = (SELECT definition FROM bak_20261104_issue_age_live_doers_task WHERE id = 'issue-age-live-doers' AND src = 'fleet_tasks_canonical') WHERE id = 'issue-age-live-doers';

CREATE TABLE IF NOT EXISTS bak_20261104_issue_age_live_doers_task AS
SELECT 'fleet_tasks' AS src, id, definition FROM fleet_tasks WHERE id = 'issue-age-live-doers'
UNION ALL
SELECT 'fleet_tasks_canonical', id, definition FROM fleet_tasks_canonical WHERE id = 'issue-age-live-doers';

UPDATE fleet_tasks
SET definition = json_set(definition, '$.steps',
      (SELECT json_group_array(json(value)) FROM json_each(fleet_tasks.definition, '$.steps')
        WHERE NOT (instr(value, 'INSERT INTO agent_issues') > 0 AND instr(value, 'ISSUE-AGE-24H-REPAIR-1: issue #') > 0))),
    version = version + 1
WHERE id = 'issue-age-live-doers'
  AND instr(definition, 'INSERT INTO agent_issues') > 0 AND instr(definition, 'ISSUE-AGE-24H-REPAIR-1: issue #') > 0;

UPDATE fleet_tasks_canonical
SET definition = json_set(definition, '$.steps',
      (SELECT json_group_array(json(value)) FROM json_each(fleet_tasks_canonical.definition, '$.steps')
        WHERE NOT (instr(value, 'INSERT INTO agent_issues') > 0 AND instr(value, 'ISSUE-AGE-24H-REPAIR-1: issue #') > 0)))
WHERE id = 'issue-age-live-doers'
  AND instr(definition, 'INSERT INTO agent_issues') > 0 AND instr(definition, 'ISSUE-AGE-24H-REPAIR-1: issue #') > 0;
