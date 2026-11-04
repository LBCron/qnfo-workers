-- OUTCOME-NORTHSTAR-1 (2026-11-04, pillar reach; owner ask "point the fleet at real outcomes").
-- Live read 2026-11-04: of 708 code tasks in 7 days, 681 (96%) touched fleet self-maintenance paths and 27 product/research
-- (8 merged, 17 failed). analytics_events is empty and analytics_daily holds one schema row, so no reader/visit outcome exists;
-- the only outcome data is v_channel_impact_7d (human clicks), reader_reports (52) and ask_feedback (7).
-- This adds one view and three metrics so managers can rank work by outcome. No issue-filing trigger: the share is acted on directly by qnfo-code-orchestrator PRODUCT-FIRST-CLAIM-1 (claim order), since filing issues adds self-work.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS outcome_northstar_tick; DROP VIEW IF EXISTS v_outcome_northstar; DELETE FROM metric_breach_cause WHERE metric_key IN ('product_task_share_7d','outreach_human_clicks_7d','reader_signal_7d'); DELETE FROM metric_registry WHERE metric IN ('product_task_share_7d','outreach_human_clicks_7d','reader_signal_7d');

CREATE VIEW IF NOT EXISTS v_outcome_northstar AS
SELECT 'product_task_share_7d' AS metric,
  ROUND(1.0*SUM(NOT (path LIKE 'qnfo-fleet-control/%' OR path LIKE 'qnfo-ops/%' OR path LIKE 'qnfo-deploy-guard/%' OR path LIKE 'qnfo-code-orchestrator/%' OR path LIKE 'qnfo-cloud-ops/%' OR path LIKE 'qnfo-observability/%' OR path LIKE 'qnfo-github-steward/%' OR path LIKE 'scripts/%' OR path LIKE 'migrations/%' OR path LIKE '.github/%' OR goal LIKE '%probe%' OR goal LIKE '%METRIC-TRIGGER%' OR goal LIKE '%LOOP-%'))/COUNT(*),3) AS value
FROM code_tasks WHERE created_at>=datetime('now','-7 day')
UNION ALL
SELECT 'outreach_human_clicks_7d', COALESCE(SUM(human_clicks_7d),0) FROM v_channel_impact_7d
UNION ALL
SELECT 'reader_signal_7d', (SELECT count(*) FROM reader_reports WHERE created_at>=datetime('now','-7 day'))+(SELECT count(*) FROM ask_feedback WHERE created_at>=datetime('now','-7 day'));

INSERT OR IGNORE INTO metric_registry(metric,layer,kind,formula,source_of_truth,target,owner,disposition_actor,refresh_cadence,state,last_value) VALUES
('product_task_share_7d','outcome','target','code tasks of 7 days that touch product or research paths / all code tasks','v_outcome_northstar','>= 0.25','qnfo-fleet-control','managers','hourly','MEASURED','0.038'),
('outreach_human_clicks_7d','outcome','target','human clicks across channels in 7 days','v_channel_impact_7d','non-decreasing','qnfo-social','managers','hourly','MEASURED','940'),
('reader_signal_7d','outcome','target','reader reports plus ask feedback rows in 7 days','reader_reports, ask_feedback','non-decreasing','qnfo-lifecycle','managers','hourly','MEASURED',NULL);

INSERT OR IGNORE INTO metric_breach_cause(metric_key,cause_key,note) VALUES
('product_task_share_7d','code-loop','outcome north star: share of code work that reaches products and research'),
('outreach_human_clicks_7d','code-loop','outcome north star'),
('reader_signal_7d','code-loop','outcome north star');

CREATE TRIGGER IF NOT EXISTS outcome_northstar_tick AFTER INSERT ON fleet_tick WHEN strftime('%M','now')<'10'
BEGIN
  UPDATE metric_registry SET last_refreshed=strftime('%Y-%m-%dT%H:%M:%SZ','now'), state='MEASURED',
    last_value=CAST((SELECT value FROM v_outcome_northstar v WHERE v.metric=metric_registry.metric) AS TEXT)
  WHERE metric IN ('product_task_share_7d','outreach_human_clicks_7d','reader_signal_7d');
END;
