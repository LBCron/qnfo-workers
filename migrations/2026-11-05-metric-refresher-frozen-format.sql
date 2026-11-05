-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_refresher_frozen_probe
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT v FROM bak_20261105_refresher_frozen_probe b WHERE b.k = remediation_contracts.class) WHERE class IN (SELECT k FROM bak_20261105_refresher_frozen_probe).
--
-- METRIC-REFRESHER-FROZEN-FORMAT-1 (2026-11-05, charter pillar autonomy; cluster sla-graph-fm of the fleet breach audit).
-- fm-metric-refresher-frozen (migrations/2026-11-05-selfheal-metrics-restore.sql) compared metric_registry.last_refreshed with strftime('%Y-%m-%dT%H:%M:%SZ', ...) as text. metric_registry
-- holds two timestamp shapes: ISO with a T and a Z (most writers) and SQLite's space form 'YYYY-MM-DD HH:MM:SS' (prd-funnel-monitor, cf_agent_requests and personal-calendar monitors, the
-- */10 probe-author and orphan metrics). Text comparison puts ' ' before 'T', so a space-form row refreshed a minute ago sorts before every ISO threshold of the same day and counted as frozen.
-- Read 2026-11-05 03:15Z: the detector's population listed 16 rows, 7 of them fresh rows in the space form (prd_funnel_missing_transitions, prd_funnel_monitor_stale,
-- personal_calendar_delivery_over_120m, cf_agent_requests_over_120m, orphan_issues_no_live_path, probe_author_accept_rate_7d, pn_open_over_120m); the nine genuinely frozen ones are
-- billed_ai_gateway_mtd_usd (2026-11-01), outreach_reply_rate_30d, warm_conversations_30d, paper_render_defect_pages, paper_math_browser_fail_pages, signal_source_families_7d, claim_coverage
-- (2026-11-03) and paper_loop_revisions_24h, papers_awaiting_revision (2026-11-04 21:51Z), each with its own producer.
-- WHAT THIS FILE DOES: both frozen-metric detectors compare the normalised value replace(substr(last_refreshed, 1, 19), 'T', ' ') with datetime('now', ...), so either shape is judged by its
-- instant. The thresholds (3 h, 12 h, 36 h, 10 days by cadence; 60 minutes for the eight selfheal metrics) do not change. Prediction (decision_log): fm-metric-refresher-frozen reads the true
-- count (9) instead of counting fresh space-form rows, and no longer swings with the number of 10-minute metrics written in the space form.
-- spof-review: two probe texts.

CREATE TABLE IF NOT EXISTS bak_20261105_refresher_frozen_probe AS
  SELECT class AS k, verify_probe AS v FROM remediation_contracts WHERE class IN ('fm-metric-refresher-frozen', 'fm-selfheal-metrics-stale');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM metric_registry WHERE state <> ''RETIRED'' AND last_refreshed IS NOT NULL AND ((refresh_cadence IN (''*/10'', ''10m'', ''5m'', ''20m'', ''*/15'', ''*/10m'') AND replace(substr(last_refreshed, 1, 19), ''T'', '' '') < datetime(''now'', ''-3 hours'')) OR (refresh_cadence IN (''hourly'', ''1h'', ''2h'', ''6h'') AND replace(substr(last_refreshed, 1, 19), ''T'', '' '') < datetime(''now'', ''-12 hours'')) OR (refresh_cadence = ''daily'' AND replace(substr(last_refreshed, 1, 19), ''T'', '' '') < datetime(''now'', ''-36 hours'')) OR (refresh_cadence = ''weekly'' AND replace(substr(last_refreshed, 1, 19), ''T'', '' '') < datetime(''now'', ''-10 days'')))) AS TEXT) AS observed',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'fm-metric-refresher-frozen' AND instr(verify_probe, 'strftime(') > 0;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM metric_registry WHERE metric IN (''merges_undeployed_over_60m'', ''code_pr_merge_share_7d'', ''code_prs_unmerged_over_120m'', ''errata_confirm_stalled'', ''research_stage_stalled'', ''publish_rate_ratio_24h'', ''post_deploy_error_workers'', ''research_budget_member_share'') AND (last_refreshed IS NULL OR replace(substr(last_refreshed, 1, 19), ''T'', '' '') < datetime(''now'', ''-60 minutes''))) AS TEXT) AS observed',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'fm-selfheal-metrics-stale' AND instr(verify_probe, 'strftime(') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'a freshness check must compare instants, not the text of two timestamp shapes',
  'METRIC-REFRESHER-FROZEN-FORMAT-1: fm-metric-refresher-frozen and fm-selfheal-metrics-stale compare replace(substr(last_refreshed,1,19),''T'','' '') with datetime(''now'', ...)',
  'read 2026-11-05 03:15Z: the detector population listed 16 metrics, 7 of them refreshed minutes ago in the space form that sorts before the ISO threshold; the nine frozen ones are producer work (cost ledger, outreach learner, render-health, radar-hub, claims ledger, paper loop)',
  'migration merged', 'two probe texts', 'see the Rollback header and bak_20261105_refresher_frozen_probe',
  'the frozen-metric detector counts only metrics that are frozen',
  'fm-metric-refresher-frozen reads 9 (the true count) instead of 16, and falls as the nine producers are repaired',
  'the class detector can be trusted as a work list',
  'd1:qnfo-audit metric_registry, remediation_contracts'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'METRIC-REFRESHER-FROZEN-FORMAT-1:') = 1);
