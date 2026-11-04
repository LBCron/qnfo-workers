-- VIEW-HEALTH-1 (2026-11-04, charter pillar: autonomy). PR 7023 merged v_outcome_northstar, a view that errors on read, and nothing caught it.
-- scripts/view_health.py (called hourly from scripts/remediation_consumer.py) plans every qnfo-audit view with EXPLAIN (no rows read, so no cost) and files or closes one BLINDSPOT-1 issue.
-- This registers the metric it writes. Adds no gate and no owner card.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET state = 'RETIRED' WHERE metric = 'broken_views';
-- CAUSE-MAPPED: the metric has no trigger; the BLINDSPOT-1 issue it files carries the lever.
INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, target, owner, disposition_actor, refresh_cadence, state, last_value, last_refreshed)
VALUES ('broken_views', 'operational', 'target', 'qnfo-audit views whose EXPLAIN SELECT * fails', 'scripts/view_health.py (VIEW-HEALTH-1)', '0', 'remediation-consumer', 'agent:view-health', 'hourly', 'MEASURED', NULL, NULL);
