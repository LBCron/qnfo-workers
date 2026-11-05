-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_metric_hygiene_1
-- Rollback: UPDATE fleet_crons SET enabled = 0 WHERE name = 'metric-meta-bridge-hourly'; UPDATE fleet_tasks SET enabled = 0 WHERE id = 'metric-meta-bridge'; UPDATE metric_registry SET formula = (SELECT v FROM bak_20261105_metric_hygiene_1 WHERE kind = 'formula' AND k = metric_registry.metric) WHERE metric IN ('jobsearch_reply_rate_90d', 'jobsearch_interview_rate_90d'); UPDATE metric_authorship SET probation_until = (SELECT v FROM bak_20261105_metric_hygiene_1 WHERE kind = 'probation' AND k = metric_authorship.metric) WHERE metric IN ('jobsearch_reply_rate_90d', 'jobsearch_interview_rate_90d'); DELETE FROM failure_modes WHERE fm_key = 'metric-meta-value-not-in-registry'; DELETE FROM remediation_contracts WHERE class = 'fm-metric-meta-value-not-in-registry'.
--
-- METRIC-HYGIENE-1 (2026-11-05, charter pillar autonomy; cluster sla-graph-fm of the fleet breach audit).
-- Metric metrics_on_probation_overdue 9 (target 0): "a registered metric that never produced a value".
--
-- WHAT WAS READ (qnfo-audit, 2026-11-05 00:10Z)
--   The nine: provenance_marking_coverage, brier_rolling_90d, mttr_rollback_min_p95 (BP26 catalogue metrics, producers in scripts/bp26_*.py), plain_article_coverage_pct,
--   plain_article_hard_violations, plain_article_failed_final (qnfo-gateway), jobsearch_reply_rate_90d, jobsearch_interview_rate_90d (qnfo-jobsearch), youtube_avg_view_duration_s
--   (qnfo-youtube-shorts). kernel_registries_tick graduates a probation metric once metric_registry.last_value IS NOT NULL.
--   Three of the nine have a producer that works and a registry row that never gets the value: qnfo-gateway articlePublishMetrics writes plain_article_coverage_pct 67.9,
--   plain_article_hard_violations 0 and plain_article_failed_final 3 into analytics_dash_meta every hour (source_of_truth says so); the metric triggers read that table
--   (fleet-control reads analytics_dash_meta first for a meta source), but no loop copies the value into metric_registry, so the registry shows UNMEASURED and last_value NULL and
--   the metrics can never graduate. These three are the only metrics whose key exists in analytics_dash_meta and whose registry value is NULL.
--   Two have a sample floor by design: jobsearch_reply_rate_90d and jobsearch_interview_rate_90d are "unknown (not written) under 10 such applications" (qnfo-jobsearch 1.2.0 writes nothing
--   below the floor). METRIC-SAMPLE-GATE-1 (2026-10-26) counts such a metric apart (metrics_awaiting_samples) and moves its probation 30 days ahead, but recognises the gate only by the phrases
--   "unmeasured below", "written once at least" or "minimum sample" in the formula, which these two do not carry. The step that applies it lives in the last steps of fleet_tasks metric-refresh,
--   a 15-step chain that orphans most hours (8 of 12 recent runs), so the rule also reaches nothing on time.
--   The other four (provenance_marking_coverage, brier_rolling_90d, mttr_rollback_min_p95, youtube_avg_view_duration_s) have producers that write nothing yet (no resolved forecasts, no rollback
--   events, no analytics grant); they stay overdue and visible, and belong to the BP26 and YouTube owners.
--
-- WHAT THIS FILE DOES
--   1. New fleet task metric-meta-bridge (one step, cron :10): for a metric whose source_of_truth says it is published into / via analytics_dash_meta, copy the meta value of the same key
--      into metric_registry (value, last_refreshed, state MEASURED), every hour. Exactly the three plain_article metrics match today. Producers are not edited.
--   2. The two jobsearch formulas get the sample-gate phrase ("minimum sample: written once at least 10 such applications exist"), which is what the producer already does, and their probation
--      moves 30 days ahead as METRIC-SAMPLE-GATE-1 would have done (they stay on probation, counted in metrics_awaiting_samples, visible).
--   3. Failure mode metric-meta-value-not-in-registry with a d1-query detector (a metric with a value in analytics_dash_meta under its own name and a NULL registry value, among metrics that
--      say they publish there), so a fourth metric of this shape shows within the hour.
-- Prediction (decision_log): metrics_on_probation_overdue 9 -> 4 within two hours (three graduate at the first kernel_registries_tick after the bridge runs at :10, two are sample-gated).
-- Not done: provenance, brier, mttr and youtube producers are not edited (their files are other sessions' work); no probation row is marked dormant or closed.
-- spof-review: one fleet task and one cron on the existing dispatcher, each reversible by enabled = 0.

CREATE TABLE IF NOT EXISTS bak_20261105_metric_hygiene_1 AS
  SELECT 'formula' AS kind, metric AS k, formula AS v FROM metric_registry WHERE metric IN ('jobsearch_reply_rate_90d', 'jobsearch_interview_rate_90d')
  UNION ALL SELECT 'probation', metric, probation_until FROM metric_authorship WHERE metric IN ('jobsearch_reply_rate_90d', 'jobsearch_interview_rate_90d');

INSERT OR IGNORE INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
VALUES ('metric-meta-bridge', 'METRIC-HYGIENE-1: a metric published into analytics_dash_meta gets its value in metric_registry, so it can graduate from probation', 'workflow',
  json_object('steps', json_array(json_object('type', 'sql', 'db', 'AUDIT', 'name', 'bridge', 'sql',
    'UPDATE metric_registry SET last_value = (SELECT m.value FROM analytics_dash_meta m WHERE m.key = metric_registry.metric), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE (instr(COALESCE(source_of_truth, ''''), ''into analytics_dash_meta'') > 0 OR instr(COALESCE(source_of_truth, ''''), ''via analytics_dash_meta'') > 0) AND EXISTS (SELECT 1 FROM analytics_dash_meta m WHERE m.key = metric_registry.metric AND m.value IS NOT NULL AND m.value <> '''')'))),
  60000, 1, 1, 1, datetime('now'));

INSERT OR IGNORE INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, updated_at)
SELECT 'metric-meta-bridge-hourly', '10 * * * *', 'metric-meta-bridge', 1, 'UTC', datetime('now')
WHERE EXISTS (SELECT 1 FROM fleet_tasks WHERE id = 'metric-meta-bridge' AND enabled = 1);

UPDATE metric_registry SET formula = formula || ' METRIC-HYGIENE-1 (2026-11-05): minimum sample: written once at least 10 such applications exist (the producer writes nothing below the floor), so the metric is counted in metrics_awaiting_samples while it waits.'
WHERE metric IN ('jobsearch_reply_rate_90d', 'jobsearch_interview_rate_90d') AND instr(formula, 'METRIC-HYGIENE-1') = 0 AND last_value IS NULL;

UPDATE metric_authorship SET probation_until = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+30 days')
WHERE status = 'probation' AND metric IN ('jobsearch_reply_rate_90d', 'jobsearch_interview_rate_90d')
  AND EXISTS (SELECT 1 FROM metric_registry r WHERE r.metric = metric_authorship.metric AND r.last_value IS NULL AND instr(r.formula, 'METRIC-HYGIENE-1') > 0)
  AND probation_until < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+2 days');

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, symptom, blast_radius) VALUES
 ('metric-meta-value-not-in-registry', 'A metric whose producer publishes into analytics_dash_meta has a NULL value in metric_registry, so it stays UNMEASURED and can never graduate from probation',
  'no loop copied analytics_dash_meta values into metric_registry; the metric triggers read the meta table, so the gap was invisible there', 'METRIC-HYGIENE-1: fleet task metric-meta-bridge copies the value every hour',
  'fm-metric-meta-value-not-in-registry: metrics that say they publish into or via analytics_dash_meta, with a meta value under their own name and a NULL registry value, expected 0', 'fm-metric-meta-value-not-in-registry', '2026-11-05',
  'plain_article_coverage_pct 67.9 in analytics_dash_meta, NULL in metric_registry for two weeks', 'metrics_on_probation_overdue and every registry reader of the metric');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
  escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts, next_due_at) VALUES
('fm-metric-meta-value-not-in-registry', NULL, 'METRIC-HYGIENE-1', 'failure-mode detector',
 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM metric_registry r WHERE r.last_value IS NULL AND (instr(COALESCE(r.source_of_truth, ''''), ''into analytics_dash_meta'') > 0 OR instr(COALESCE(r.source_of_truth, ''''), ''via analytics_dash_meta'') > 0) AND EXISTS (SELECT 1 FROM analytics_dash_meta m WHERE m.key = r.metric AND m.value IS NOT NULL AND m.value <> '''')) AS TEXT) AS observed',
 'd1-query', 3, 'qnfo-fleet-control', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0, datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'a metric that cannot reach the registry, or cannot measure below a sample floor, must say so in the form the probation rule reads, not stay overdue for ever',
  'METRIC-HYGIENE-1: fleet task metric-meta-bridge (:10) copies analytics_dash_meta values into metric_registry for metrics that publish there; the two jobsearch rate metrics carry the sample-gate phrase and their probation moves 30 days; detector fm-metric-meta-value-not-in-registry',
  'read 2026-11-05 00:10Z: 9 metrics on probation past probation_until with a NULL registry value; three have values in analytics_dash_meta (67.9, 0, 3) and no loop copies them; two are sample-gated by design without the phrase METRIC-SAMPLE-GATE-1 reads; four have producers that write nothing yet; metric-refresh, which carries the sample-gate step, orphans 8 of 12 runs',
  'migration merged', 'one fleet task, one cron, two formula texts, two probation dates, one failure mode and its contract', 'see the Rollback header and bak_20261105_metric_hygiene_1',
  'a published metric reaches the registry within the hour and can graduate; a sample-gated metric is counted apart',
  'metrics_on_probation_overdue 9 to 4 within two hours; metrics_awaiting_samples rises by 2; the remaining four are producer work owned by BP26 and YouTube',
  'the probation counter lists only metrics with no working producer',
  'd1:qnfo-audit metric_registry, metric_authorship, analytics_dash_meta, fleet_tasks, fleet_crons'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'METRIC-HYGIENE-1:') = 1);

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'metrics_on_probation_overdue', '<=', 4, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+3 hours'), 'seeded'
FROM decision_log d WHERE instr(d.action, 'METRIC-HYGIENE-1:') = 1;
