-- D1-INDEX-HOTSPOTS-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1, owner: fleet cost under $200-300 a month).
-- Four workflow statements read 20-60 M rows a day each because a correlated lookup has no index: SQLite either scans the inner table once per
-- outer row or builds an automatic index on it every time the statement runs. Measured 2026-11-04 on qnfo-audit, 24 h (d1QueriesAdaptiveGroups
-- rows read, calls) and now (the SELECT part of each step run against live data, D1 rows_read; EXPLAIN QUERY PLAN for the cause):
--   issue-probe-agent step probe-request     57 M (77 runs)  1.0 M rows and 5.3 s per run: NOT EXISTS cf_agent_requests r WHERE requester = ? AND instance = ?
--                                            walks every row of that requester (2.4 K) for each of ~430 candidate issues (idx_cf_agent_requests_requester is (requester, id)).
--   portfolio-execute steps 0 and 1          59 M (111 runs) 0.56 M + 0.53 M rows per run: per active project (111) the EXISTS / NOT EXISTS over issue_project_map JOIN agent_issues
--                                            walks every closed issue (4.7 K) and probes the map by rowid; nothing indexes issue_project_map.project_code.
--   portfolio-deploy-sync step 0             29 M (78 runs)  0.37 M rows per run: deployment_history is joined through an automatic partial index on resource_name and the
--                                            latest-version subquery scans all of it (SCAN d2) for each of ~100 workers.
--   portfolio-gap-action step 8              51 M (31 runs)  1.9 M rows per run: for each of ~620 open issues the EXISTS builds an automatic index on roadmap_implementation
--                                            (item, status) over its 3 K rows.
-- Each index is additive (no data change, no statement text change) and serves exactly the lookup the plan names. Prediction: the four steps fall
-- from ~196 M rows a day to under 15 M (-90 % or more), probe-request from 5.3 s to under 0.2 s; remediation: re-run the same SELECT parts and read rows_read.
-- Not changed: the management-personas re-fire storm (D1-OVERLOAD-1a, a dispatcher code task) and the cadence of every workflow.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP INDEX IF EXISTS idx_cf_agent_requests_req_inst; DROP INDEX IF EXISTS idx_ipm_project; DROP INDEX IF EXISTS idx_deploy_history_res; DROP INDEX IF EXISTS idx_roadmap_impl_item_status; DELETE FROM remediation_contracts WHERE class = 'fm-d1-hotspot-index-missing'; DELETE FROM failure_modes WHERE fm_key = 'd1-hotspot-index-missing'
-- spof-review: four additive indexes, no new worker, cron, credential or executor.

CREATE INDEX IF NOT EXISTS idx_cf_agent_requests_req_inst ON cf_agent_requests (requester, instance, status);
CREATE INDEX IF NOT EXISTS idx_ipm_project ON issue_project_map (project_code, issue_id);
CREATE INDEX IF NOT EXISTS idx_deploy_history_res ON deployment_history (resource_name, deployed_at, version_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_impl_item_status ON roadmap_implementation (item, status);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('d1-hotspot-index-missing',
  'a workflow statement with a correlated EXISTS or subquery re-scans (or re-indexes) its inner table once per outer row, so a 3 K-row table costs hundreds of thousands of rows read per run and the statement holds the single-threaded D1 for seconds',
  'the lookup column has no index (cf_agent_requests requester+instance, issue_project_map.project_code, deployment_history.resource_name, roadmap_implementation item+status): EXPLAIN QUERY PLAN shows SCAN or SEARCH ... USING AUTOMATIC INDEX inside a CORRELATED SCALAR SUBQUERY',
  'D1-INDEX-HOTSPOTS-1: one additive index per lookup (migrations/2026-11-04-d1-index-hotspots.sql); the detector fails when one of them is dropped; a new correlated step is profiled with EXPLAIN QUERY PLAN before it ships',
  'fm-d1-hotspot-index-missing: count of the four indexes present, expected 4',
  'fm-d1-hotspot-index-missing', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'a fleet_tasks step or view joins a table of a few thousand rows inside EXISTS, NOT EXISTS or a scalar subquery on a column without an index',
  'd1QueriesAdaptiveGroups lists the statement with 200 K-2 M rows read per call; EXPLAIN shows AUTOMATIC INDEX or a SCAN on the inner table',
  'every writer and reader of qnfo-audit while the statement runs');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-d1-hotspot-index-missing', NULL, 'D1-INDEX-HOTSPOTS-1', 'failure-mode detector',
  'SELECT ''4'' AS expected, CAST((SELECT COUNT(*) FROM sqlite_master WHERE type = ''index'' AND name IN (''idx_cf_agent_requests_req_inst'', ''idx_ipm_project'', ''idx_deploy_history_res'', ''idx_roadmap_impl_item_status'')) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'four workflow steps account for about 196 M rows read a day and each is a missing-index lookup, not a design problem',
  'D1-INDEX-HOTSPOTS-1: four additive indexes (cf_agent_requests requester+instance+status, issue_project_map project_code, deployment_history resource_name+deployed_at+version_id, roadmap_implementation item+status)',
  'd1QueriesAdaptiveGroups 24 h: probe-request 57 M, portfolio-execute 59 M, deploy-sync 29 M, gap-action 51 M; per-run SELECT parts 1.0 M / 1.1 M / 0.37 M / 1.9 M rows; EXPLAIN QUERY PLAN names the scan or automatic index in each',
  'same results, about 90 % fewer rows read by these steps', 'four indexes on qnfo-audit (each slows its table writes by one index entry; the tables take a few writes an hour)',
  'the Rollback line', 'the fleet drops about 180 M rows read a day without a worker change',
  'the four steps read under 15 M rows a day in total within 24 h of the merge, probe-request under 0.2 s a run', NULL, 'live qnfo-audit per-step rows_read, EXPLAIN QUERY PLAN, SQLite plan test in migrations/d1-index-hotspots.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'D1-INDEX-HOTSPOTS-1:%');
