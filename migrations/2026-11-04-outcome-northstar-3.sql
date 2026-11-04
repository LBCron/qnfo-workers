-- OUTCOME-NORTHSTAR-3 (2026-11-04, pillar reach). product_task_share_7d ranked a code task as self-maintenance when its goal text
-- contained "probe", "METRIC-TRIGGER" or "LOOP-". Every dispatched task says "Definition of done and probe are on the issue", so the
-- metric read 28 product tasks of 714 (3.9%) in 7 days; by path alone it is 234 of 714 (32.8%). The same text match drove the claim order
-- (qnfo-code-orchestrator 0.40.1 removes it). Caveat: path-only still counts any worker directory that is not control plane, scripts,
-- migrations or .github as product, so it overstates; a per-worker product list is the next refinement.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_outcome_northstar_view_3
-- Rollback: DROP VIEW IF EXISTS v_outcome_northstar; restore the view from bak_20261104_outcome_northstar_view_3.sql;

CREATE TABLE IF NOT EXISTS bak_20261104_outcome_northstar_view_3 AS
SELECT name, sql FROM sqlite_master WHERE name='v_outcome_northstar';

DROP VIEW IF EXISTS v_outcome_northstar;
CREATE VIEW v_outcome_northstar AS
SELECT 'product_task_share_7d' AS metric,
  ROUND(1.0*SUM(NOT (path LIKE 'qnfo-fleet-control/%' OR path LIKE 'qnfo-ops/%' OR path LIKE 'qnfo-deploy-guard/%' OR path LIKE 'qnfo-code-orchestrator/%' OR path LIKE 'qnfo-cloud-ops/%' OR path LIKE 'qnfo-observability/%' OR path LIKE 'qnfo-github-steward/%' OR path LIKE 'scripts/%' OR path LIKE 'migrations/%' OR path LIKE '.github/%'))/COUNT(*),3) AS value
FROM code_tasks WHERE created_at>=datetime('now','-7 day')
UNION ALL
SELECT 'outreach_human_clicks_7d', COALESCE(SUM(human_clicks_7d),0) FROM v_channel_impact_7d
UNION ALL
SELECT 'reader_signal_7d', (SELECT count(*) FROM reader_reports WHERE created_at>=datetime('now','-7 day'))+(SELECT count(*) FROM ask_feedback WHERE ts>=datetime('now','-7 day'))
UNION ALL
SELECT 'human_pageviews_7d', COALESCE(SUM(value),0) FROM reach_signals WHERE source='cf-rum-human' AND entity_type='host' AND entity_id NOT IN ('fleet.qnfo.org') AND metric='pageviews' AND date>=date('now','-7 day')
UNION ALL
SELECT 'ga4_sessions_7d', COALESCE(SUM(value),0) FROM reach_signals WHERE source='ga4' AND entity_type='channel' AND metric='sessions' AND date>=date('now','-7 day');
