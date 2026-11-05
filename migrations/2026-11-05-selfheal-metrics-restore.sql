-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_selfheal_metrics
-- Rollback: UPDATE fleet_crons SET enabled = 0 WHERE name = 'selfheal-metrics-refresh-10m'; UPDATE fleet_tasks SET enabled = 0 WHERE id = 'selfheal-metrics-refresh'; DELETE FROM failure_modes WHERE fm_key IN ('selfheal-metrics-stale', 'metric-refresher-frozen'); DELETE FROM remediation_contracts WHERE class IN ('fm-selfheal-metrics-stale', 'fm-metric-refresher-frozen'). The eight metric values are recomputed from views, not edited; the backup table holds the frozen values and the retired trigger texts.
--
-- SELFHEAL-METRICS-RESTORE-1 (2026-11-05, charter pillar autonomy; cluster sla-graph-fm of the fleet breach audit; METRIC-CLOSED-LOOP-1).
-- Eight metrics have been frozen since 2026-11-02T17:40-17:44Z and read "on-target" with their last value: merges_undeployed_over_60m, code_pr_merge_share_7d,
-- code_prs_unmerged_over_120m (written by the trigger deploy_merge_age_tick) and errata_confirm_stalled, research_stage_stalled, publish_rate_ratio_24h, post_deploy_error_workers,
-- research_budget_member_share (written by breach_selfheal_heavy_tick).
--
-- WHAT WAS READ (qnfo-audit, 2026-11-05 01:00Z)
--   migrations/2026-11-02-breach-doctor-retire.sql (BREACH-DOCTOR-RETIRE-1, issue 1000399) dropped those two triggers because the issue-age replanning and the selfheal actions moved to
--   issue-age-live-doers and breachDoctorTick. It did not notice that each trigger also carried metric refreshes (three UPDATE metric_registry statements in the first, five in the second): the
--   metrics stopped at 17:40-17:44Z and have not moved for 31 hours, with their source views live (v_merge_reliability: 0 workers undeployed, merge share 0.97, 0 PRs unmerged;
--   v_breach_selfheal: 1 post-deploy error hit, qnfo-fleet-control). A metric that stays on its last value hides a breach from its trigger for as long as it is frozen, and
--   post_deploy_error_workers (trigger 14350, 1 and hit) cannot clear while it is frozen. breach_selfheal_state and breach_selfheal_inputs_state have no reader but the dropped trigger
--   (read from sqlite_master), so the metrics are computed from the views directly and the caches stay as they are.
-- WHAT THIS FILE DOES
--   New fleet task selfheal-metrics-refresh (cron every 10 minutes, the cadence of the dropped triggers): eight single-statement steps, the UPDATEs of the dropped triggers with the cache table
--   reads replaced by the views they were filled from, each guarded so an empty view leaves the old value instead of writing NULL. Detector fm-selfheal-metrics-stale (a d1-query: any of the
--   eight refreshed more than 60 minutes ago, expected 0). No trigger is recreated, no threshold changes.
-- Prediction (decision_log): all eight metrics refreshed within 10 minutes of the first run; the values equal the views (merges_undeployed_over_60m 0, code_pr_merge_share_7d 0.97, code_prs_unmerged_over_120m 0,
-- post_deploy_error_workers 1 until qnfo-fleet-control's post-deploy errors clear, then 0).
-- spof-review: one fleet task and one cron on the existing dispatcher, each reversible by enabled = 0.

CREATE TABLE IF NOT EXISTS bak_20261105_selfheal_metrics AS
  SELECT 'metric' AS kind, metric AS k, last_value || ' @ ' || COALESCE(last_refreshed, '') AS v FROM metric_registry
   WHERE metric IN ('merges_undeployed_over_60m', 'code_pr_merge_share_7d', 'code_prs_unmerged_over_120m', 'errata_confirm_stalled', 'research_stage_stalled', 'publish_rate_ratio_24h', 'post_deploy_error_workers', 'research_budget_member_share')
  UNION ALL SELECT 'trigger', name, sql FROM sqlite_master WHERE name IN ('deploy_merge_age_tick', 'breach_selfheal_heavy_tick');

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
VALUES ('selfheal-metrics-refresh', 'SELFHEAL-METRICS-RESTORE-1: the eight merge-reliability and breach-selfheal metrics that two retired triggers refreshed are computed from their views every 10 minutes', 'workflow',
  json_object('steps', json_array(
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'merges-undeployed', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT workers_undeployed_over_60m FROM v_merge_reliability) AS TEXT) WHERE metric = ''merges_undeployed_over_60m'' AND (SELECT workers_undeployed_over_60m FROM v_merge_reliability) IS NOT NULL'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'merge-share', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT COALESCE(merge_share_7d, 1) FROM v_merge_reliability) AS TEXT) WHERE metric = ''code_pr_merge_share_7d'' AND EXISTS (SELECT 1 FROM v_merge_reliability)'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'prs-unmerged', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT prs_unmerged_over_120m FROM v_merge_reliability) AS TEXT) WHERE metric = ''code_prs_unmerged_over_120m'' AND (SELECT prs_unmerged_over_120m FROM v_merge_reliability) IS NOT NULL'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'errata-confirm-stalled', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT hit FROM v_breach_selfheal WHERE check_class = ''chain-stall'' AND subject = ''errata-confirm'') AS TEXT) WHERE metric = ''errata_confirm_stalled'' AND EXISTS (SELECT 1 FROM v_breach_selfheal WHERE check_class = ''chain-stall'' AND subject = ''errata-confirm'')'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'research-stage-stalled', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT hit FROM v_breach_selfheal WHERE check_class = ''chain-stall'' AND subject = ''research'') AS TEXT) WHERE metric = ''research_stage_stalled'' AND EXISTS (SELECT 1 FROM v_breach_selfheal WHERE check_class = ''chain-stall'' AND subject = ''research'')'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'publish-rate-ratio', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT CASE WHEN published_daily_base_7d < 5 THEN 1 ELSE ROUND(published_24h / published_daily_base_7d, 3) END FROM v_breach_selfheal_inputs) AS TEXT) WHERE metric = ''publish_rate_ratio_24h'' AND EXISTS (SELECT 1 FROM v_breach_selfheal_inputs)'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'post-deploy-error-workers', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT COUNT(*) FROM v_breach_selfheal WHERE check_class = ''post-deploy-errors'' AND hit = 1) AS TEXT) WHERE metric = ''post_deploy_error_workers'' AND EXISTS (SELECT 1 FROM v_breach_selfheal WHERE check_class = ''post-deploy-errors'')'),
    json_object('type', 'sql', 'db', 'AUDIT', 'name', 'research-budget-member-share', 'sql', 'UPDATE metric_registry SET last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'', last_value = CAST((SELECT CASE WHEN budget_spent_today > 0 THEN ROUND(budget_members_today * 1.0 / budget_spent_today, 3) ELSE 0 END FROM v_breach_selfheal_inputs) AS TEXT) WHERE metric = ''research_budget_member_share'' AND EXISTS (SELECT 1 FROM v_breach_selfheal_inputs)'))),
  60000, 1, 1, 1, datetime('now'));

INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, updated_at)
SELECT 'selfheal-metrics-refresh-10m', '*/10 * * * *', 'selfheal-metrics-refresh', 1, 'UTC', datetime('now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'selfheal-metrics-refresh' AND enabled = 1);

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, symptom, blast_radius) VALUES
 ('selfheal-metrics-stale', 'A metric whose only refresher was dropped with a trigger keeps its last value and reads on-target for days',
  'BREACH-DOCTOR-RETIRE-1 dropped deploy_merge_age_tick and breach_selfheal_heavy_tick, which also carried eight metric refreshes; nothing tested that the retired trigger had no other duty',
  'SELFHEAL-METRICS-RESTORE-1: fleet task selfheal-metrics-refresh computes the eight metrics from their views every 10 minutes',
  'fm-selfheal-metrics-stale: the eight metrics, any refreshed more than 60 minutes ago, expected 0', 'fm-selfheal-metrics-stale', '2026-11-05',
  'merges_undeployed_over_60m last refreshed 2026-11-02T17:40Z with a live value of 0 from its view', 'every trigger and dashboard that reads the eight metrics');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at) VALUES
('fm-selfheal-metrics-stale', NULL, 'SELFHEAL-METRICS-RESTORE-1', 'failure-mode detector',
 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM metric_registry WHERE metric IN (''merges_undeployed_over_60m'', ''code_pr_merge_share_7d'', ''code_prs_unmerged_over_120m'', ''errata_confirm_stalled'', ''research_stage_stalled'', ''publish_rate_ratio_24h'', ''post_deploy_error_workers'', ''research_budget_member_share'') AND (last_refreshed IS NULL OR last_refreshed < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-60 minutes''))) AS TEXT) AS observed',
 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now'));

-- The class, not only the eight: a metric whose refresher stopped reads on-target on its last value. Thresholds by cadence: 3 hours for the sub-hourly classes, 12 hours for hourly, 36 hours for
-- daily, 10 days for weekly. Read 2026-11-05 01:00Z after the eight: 8 more (billed_ai_gateway_mtd_usd since 2026-11-01, outreach_reply_rate_30d, warm_conversations_30d,
-- paper_render_defect_pages, paper_math_browser_fail_pages, signal_source_families_7d, claim_coverage, and the two paper_loop metrics at the edge), each with its own producer, listed on the failure mode.
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, symptom, blast_radius) VALUES
 ('metric-refresher-frozen', 'A metric whose refresher stopped keeps its last value for days and reads on-target',
  'a producer was dropped, orphaned or never reached (a retired trigger, a task that orphans, a cron that stops) and nothing compared last_refreshed with the metric''s own cadence',
  'fix the producer named by the metric''s source_of_truth; SELFHEAL-METRICS-RESTORE-1 restored the eight of 2026-11-02; at the time of this row the others were billed_ai_gateway_mtd_usd (scripts/cost_ledger.py), outreach_reply_rate_30d and warm_conversations_30d (outreach learner), paper_render_defect_pages and paper_math_browser_fail_pages (gateway render-health), signal_source_families_7d (radar-hub intake), claim_coverage (claims ledger)',
  'fm-metric-refresher-frozen: unretired metrics with a last_refreshed older than 3 h (sub-hourly cadence), 12 h (hourly), 36 h (daily) or 10 days (weekly), expected 0', 'fm-metric-refresher-frozen', '2026-11-05',
  'merges_undeployed_over_60m last refreshed 2026-11-02T17:40Z; billed_ai_gateway_mtd_usd 2026-11-01T00:01Z', 'every trigger and dashboard that reads the stale metric');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at) VALUES
('fm-metric-refresher-frozen', NULL, 'SELFHEAL-METRICS-RESTORE-1', 'failure-mode detector',
 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM metric_registry WHERE state <> ''RETIRED'' AND last_refreshed IS NOT NULL AND ((refresh_cadence IN (''*/10'', ''10m'', ''5m'', ''20m'', ''*/15'', ''*/10m'') AND last_refreshed < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'')) OR (refresh_cadence IN (''hourly'', ''1h'', ''2h'', ''6h'') AND last_refreshed < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-12 hours'')) OR (refresh_cadence = ''daily'' AND last_refreshed < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-36 hours'')) OR (refresh_cadence = ''weekly'' AND last_refreshed < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-10 days'')))) AS TEXT) AS observed',
 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'dropping a trigger must keep every duty it carried; a metric whose refresher is gone reads green on its last value and hides a breach from its own trigger',
  'SELFHEAL-METRICS-RESTORE-1: fleet task selfheal-metrics-refresh (every 10 minutes) recomputes the eight metrics the retired triggers deploy_merge_age_tick and breach_selfheal_heavy_tick refreshed, from v_merge_reliability, v_breach_selfheal and v_breach_selfheal_inputs; detector fm-selfheal-metrics-stale',
  'read 2026-11-05 01:00Z: the eight metrics last refreshed 2026-11-02T17:40-17:44Z (31 hours); BREACH-DOCTOR-RETIRE-1 (migrations/2026-11-02-breach-doctor-retire.sql) dropped both triggers at that time; the views are live (v_merge_reliability 0 / 0.97 / 0, v_breach_selfheal one post-deploy hit); the state tables have no other reader',
  'migration merged', 'one fleet task, one cron, one failure mode and its contract; eight metric_registry rows are written by the task', 'see the Rollback header and bak_20261105_selfheal_metrics',
  'the eight metrics are measured every 10 minutes again; a frozen metric is detected within the hour',
  'all eight refreshed within 10 minutes of the first run; values equal their views; post_deploy_error_workers can clear',
  'the merge-reliability and breach-selfheal triggers see current values',
  'd1:qnfo-audit metric_registry, v_merge_reliability, v_breach_selfheal, v_breach_selfheal_inputs, fleet_tasks, fleet_crons'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'SELFHEAL-METRICS-RESTORE-1:') = 1);

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'merges_undeployed_over_60m', '<=', 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 hours'), 'seeded'
FROM decision_log d WHERE instr(d.action, 'SELFHEAL-METRICS-RESTORE-1:') = 1;
