-- CODE-OUTCOMES-TRUE-1 (charter pillar: autonomy). Owner 2026-11-04: failure rate must show real failures.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_code_task_outcomes;
--
-- D1 read 2026-11-04: 11 of 26 'failed' code tasks in 6 hours were HUMAN-ITEMS-AUTOMATIC-1 returns (trigger code_task_needs_human_to_fleet_*
-- sets needs_human -> failed with that prefix in last_error), not failed attempts. Changing their status would ripple through the triggers
-- and views that read 'failed' (v_issue_dead_end, v_trust_ledger, v_parked_code_tasks, wip_self_tune ...), so the status stays and this
-- view separates them: outcome is merged, returned (bookkeeping), failed (real), or in_flight. Readers of the failure rate use this view.
CREATE VIEW IF NOT EXISTS v_code_task_outcomes AS
SELECT id, repo, path, model, attempts, updated_at,
  CASE WHEN status = 'merged' THEN 'merged'
       WHEN status = 'failed' AND COALESCE(last_error, '') LIKE 'HUMAN-ITEMS-AUTOMATIC-1:%' THEN 'returned'
       WHEN status = 'failed' THEN 'failed'
       WHEN status IN ('superseded', 'closed', 'reverted') THEN status
       ELSE 'in_flight' END AS outcome
FROM code_tasks;
