-- PAPER-LEARN-PROBATION-DOD-1 (2026-11-05, charter pillar autonomy, program QNFO.OPS; cluster C8-PROJECTS-GOALS of the roadmap and backlog completion sweep).
-- Read 2026-11-04 23:00Z: 225 goals PAPER-LEARN-<id> sit adopted with the DoD "the learning is applied or rejected" (qnfo-lifecycle plProbationGoal); 4 completed, 225 failing; 229 goals were created in 4 days (37, 81, 69, 42 a day) and the learnings were
-- settled one at a time by nobody. A learning can end in two more honest states the fleet already uses: already-in-place (a live mechanism covers it) and routed (handed to an issue or goal with a doer). This file widens the goal DoD and the
-- contract probe of every PAPER-LEARN goal to those four settled states, so the dispositions in the settle files complete them; nothing is completed here. qnfo-lifecycle plProbationGoal gets the same DoD in the code change that follows.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE goals SET dod = (SELECT b.dod FROM bak_20261105_c8_pl_goals b WHERE b.goal_key = goals.goal_key), updated_at = datetime('now') WHERE goal_key IN (SELECT goal_key FROM bak_20261105_c8_pl_goals); UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_c8_pl_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_c8_pl_contracts)

CREATE TABLE IF NOT EXISTS bak_20261105_c8_pl_goals AS SELECT goal_key, dod FROM goals WHERE goal_key LIKE 'PAPER-LEARN-%';
CREATE TABLE IF NOT EXISTS bak_20261105_c8_pl_contracts AS SELECT class, verify_probe FROM remediation_contracts WHERE class LIKE 'goal-PAPER-LEARN-%';

UPDATE goals SET dod = replace(dod, 'fleet_status NOT IN (''applied'', ''rejected'')', 'fleet_status NOT IN (''applied'', ''rejected'', ''routed'', ''already-in-place'')'), updated_at = datetime('now') WHERE goal_key LIKE 'PAPER-LEARN-%' AND status IN ('adopted', 'completed') AND instr(dod, '''already-in-place''') = 0;

UPDATE remediation_contracts SET verify_probe = (SELECT d.probe FROM v_goal_dod d WHERE 'goal-' || d.goal_key = remediation_contracts.class)
WHERE module = 'goal-dod-v1' AND class LIKE 'goal-PAPER-LEARN-%' AND EXISTS (SELECT 1 FROM v_goal_dod d WHERE 'goal-' || d.goal_key = remediation_contracts.class AND d.transport IS NOT NULL AND d.probe IS NOT remediation_contracts.verify_probe);
