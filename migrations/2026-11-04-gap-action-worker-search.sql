-- GAP-ACTION-WORKER-SEARCH-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1; corrects a miss of D1-INDEX-HOTSPOTS-1).
-- Measured 2026-11-04 16:55Z, after migrations/2026-11-04-d1-index-hotspots.sql applied (16:48:33Z): the SELECT parts of the other three steps fell as predicted
-- (issue-probe-agent probe-request 1.0 M -> under 8 K rows, portfolio-execute 0.56 M + 0.53 M -> under 8 K, portfolio-deploy-sync 370 K -> 28.5 K), but
-- portfolio-gap-action step 8 still reads 1,944,880 rows a run (was 1,905,620). The index added for it, idx_roadmap_impl_item_status, is not used by the D1 planner
-- (the plan still shows SEARCH r USING AUTOMATIC PARTIAL COVERING INDEX (status=?)); my diagnosis of that step was wrong.
-- Real cause, from the live EXPLAIN QUERY PLAN of the step: inside the EXISTS the planner starts with "SCAN w" (worker_compat_state, 3,018 rows: 41 workers x about 73 checks) for
-- each of the 644 open issues, because the only condition tying w to the outer row is agent_issues.title = 'PORTFOLIO-UPGRADE-1: advance compat_date for ' || w.worker, an
-- expression that cannot drive an index lookup. 644 x 3,018 = 1.94 M rows. Only 4 of the 644 open issues carry that title prefix.
-- Change: add the implied equality w.worker = substr(agent_issues.title, length('PORTFOLIO-UPGRADE-1: advance compat_date for ') + 1) in front of the title equality. A title
-- equal to prefix || worker has exactly that worker after the prefix, so every row the old condition accepted is still accepted and no other row is (same rows); but the new
-- condition is an equality of w.worker with an outer expression, which the planner turns into SEARCH w USING the primary key (worker=?): one probe per open issue.
-- Prediction: step 8 1.94 M -> about 3 K rows a run (-99 %), about 31 runs a day (51 M rows a day in the 24 h top list, GraphQL) -> under 0.1 M. Verify with the SELECT part and the
-- GraphQL statement 'UPDATE agent_issues SET status=''closed'', close_channel=''auto:portfolio-gap-action''' for the day.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_gap_action_workflow
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_gap_action_workflow WHERE id = 'portfolio-gap-action'), version = version + 1 WHERE id = 'portfolio-gap-action'
-- spof-review: one workflow definition edited in place (same steps, same cadence, same rows); the previous definition is kept in the backup table.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_gap_action_workflow AS
SELECT id, definition, version FROM fleet_tasks WHERE id = 'portfolio-gap-action';

UPDATE fleet_tasks
SET definition = REPLACE(
      definition,
      'WHERE agent_issues.title=''PORTFOLIO-UPGRADE-1: advance compat_date for ''||w.worker',
      'WHERE w.worker = substr(agent_issues.title, length(''PORTFOLIO-UPGRADE-1: advance compat_date for '') + 1) AND agent_issues.title=''PORTFOLIO-UPGRADE-1: advance compat_date for ''||w.worker'
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'portfolio-gap-action'
  AND json_valid(definition)
  AND instr(definition, 'WHERE w.worker = substr(agent_issues.title, length(') = 0
  AND instr(definition, 'WHERE agent_issues.title=''PORTFOLIO-UPGRADE-1: advance compat_date for ''||w.worker') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'the per-open-issue EXISTS in portfolio-gap-action step 8 is driven by SCAN worker_compat_state because nothing ties w.worker to the outer row; stating the implied equality lets the planner search by worker',
  'GAP-ACTION-WORKER-SEARCH-1: step 8 of portfolio-gap-action gains w.worker = substr(agent_issues.title, length(prefix) + 1) in front of the title equality',
  'after D1-INDEX-HOTSPOTS-1 applied: step 8 still 1,944,880 rows (was 1,905,620) while probe-request, portfolio-execute and deploy-sync fell 90-99 %; live plan: SCAN w inside CORRELATED SCALAR SUBQUERY 2; 644 open issues, 4 with the PORTFOLIO-UPGRADE-1 prefix, worker_compat_state 3,018 rows',
  'same issues closed, about 99 % fewer rows read by the step', 'one fleet_tasks row (definition kept in bak_20261104_gap_action_workflow, version + 1)',
  'the Rollback line', 'the portfolio gap action costs a thousandth of its rows',
  'portfolio-gap-action step 8 under 10 K rows a run after the merge, same GraphQL statement', NULL, 'SQLite plan and equivalence test in migrations/gap-action-worker-search.test.mjs, live EXPLAIN'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'GAP-ACTION-WORKER-SEARCH-1:%');
