-- OUTCOME-NORTHSTAR-2 (2026-11-04, pillar reach). Fixes OUTCOME-NORTHSTAR-1: v_outcome_northstar failed on read
-- ("no such column: created_at": ask_feedback has ts, not created_at), so its hourly trigger refreshed nothing.
-- Also adds the visitor outcomes that already live in reach_signals (the earlier note that no visitor data existed was
-- wrong: analytics_events is empty but reach_signals holds cf-rum-human pageviews and ga4 sessions).
-- reach_signals repeats each total under every entity_type (site, host, referrer for CF; channel, country, device ... for GA4), so a plain
-- SUM counted a pageview 4 times. One entity_type per source is used. Live read: cf-rum-human site pageviews 3782 (7d) vs 5190 (prior 7d), -27%;
-- ga4 sessions 1181 vs 652 looks +81% but GA4 collection began 2026-10-25, so the prior window holds 3 days (217 a day vs 169 a day now, -22%).
-- fleet.qnfo.org (the owner dashboard, 1207 of 3782 pageviews, 32%) is excluded so the metric counts outside readers; q08.org and its personal hosts stay in until they are split out.
-- Both sources agree traffic is falling since 2026-10-26. Trusted source: cf-rum-human site (history since 2026-10-06, all hosts, bot-filtered); GA4 is the cross-check.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_outcome_northstar_view
-- Rollback: DROP VIEW IF EXISTS v_outcome_northstar; DELETE FROM metric_breach_cause WHERE metric_key IN ('human_pageviews_7d','ga4_sessions_7d'); DELETE FROM metric_registry WHERE metric IN ('human_pageviews_7d','ga4_sessions_7d'); CREATE VIEW v_outcome_northstar AS SELECT 1 AS metric, 1 AS value;

CREATE TABLE IF NOT EXISTS bak_20261104_outcome_northstar_view AS
SELECT name, sql FROM sqlite_master WHERE name='v_outcome_northstar';

DROP VIEW IF EXISTS v_outcome_northstar;
CREATE VIEW v_outcome_northstar AS
SELECT 'product_task_share_7d' AS metric,
  ROUND(1.0*SUM(NOT (path LIKE 'qnfo-fleet-control/%' OR path LIKE 'qnfo-ops/%' OR path LIKE 'qnfo-deploy-guard/%' OR path LIKE 'qnfo-code-orchestrator/%' OR path LIKE 'qnfo-cloud-ops/%' OR path LIKE 'qnfo-observability/%' OR path LIKE 'qnfo-github-steward/%' OR path LIKE 'scripts/%' OR path LIKE 'migrations/%' OR path LIKE '.github/%' OR goal LIKE '%probe%' OR goal LIKE '%METRIC-TRIGGER%' OR goal LIKE '%LOOP-%'))/COUNT(*),3) AS value
FROM code_tasks WHERE created_at>=datetime('now','-7 day')
UNION ALL
SELECT 'outreach_human_clicks_7d', COALESCE(SUM(human_clicks_7d),0) FROM v_channel_impact_7d
UNION ALL
SELECT 'reader_signal_7d', (SELECT count(*) FROM reader_reports WHERE created_at>=datetime('now','-7 day'))+(SELECT count(*) FROM ask_feedback WHERE ts>=datetime('now','-7 day'))
UNION ALL
SELECT 'human_pageviews_7d', COALESCE(SUM(value),0) FROM reach_signals WHERE source='cf-rum-human' AND entity_type='host' AND entity_id NOT IN ('fleet.qnfo.org') AND metric='pageviews' AND date>=date('now','-7 day')
UNION ALL
SELECT 'ga4_sessions_7d', COALESCE(SUM(value),0) FROM reach_signals WHERE source='ga4' AND entity_type='channel' AND metric='sessions' AND date>=date('now','-7 day');

INSERT OR IGNORE INTO metric_registry(metric,layer,kind,formula,source_of_truth,target,owner,disposition_actor,refresh_cadence,state) VALUES
('human_pageviews_7d','outcome','target','sum of cf-rum-human pageviews per host over 7 days, excluding the internal host fleet.qnfo.org (the trusted outside-visitor north star: longest history, all hosts, bots filtered)','reach_signals','non-decreasing','qnfo-social','managers','hourly','MEASURED'),
('ga4_sessions_7d','outcome','target','sum of ga4 sessions at entity_type channel over 7 days (cross-check; collection began 2026-10-25)','reach_signals','non-decreasing','qnfo-social','managers','hourly','MEASURED');

INSERT OR IGNORE INTO metric_breach_cause(metric_key,cause_key,note) VALUES
('human_pageviews_7d','code-loop','outcome north star: visitors'),
('ga4_sessions_7d','code-loop','outcome north star: visitors');

UPDATE metric_registry SET last_refreshed=strftime('%Y-%m-%dT%H:%M:%SZ','now'), state='MEASURED',
  last_value=CAST((SELECT value FROM v_outcome_northstar v WHERE v.metric=metric_registry.metric) AS TEXT)
WHERE metric IN ('product_task_share_7d','outreach_human_clicks_7d','reader_signal_7d','human_pageviews_7d','ga4_sessions_7d');

DROP TRIGGER IF EXISTS outcome_northstar_tick;
CREATE TRIGGER outcome_northstar_tick AFTER INSERT ON fleet_tick WHEN strftime('%M','now')<'10'
BEGIN
  UPDATE metric_registry SET last_refreshed=strftime('%Y-%m-%dT%H:%M:%SZ','now'), state='MEASURED',
    last_value=CAST((SELECT value FROM v_outcome_northstar v WHERE v.metric=metric_registry.metric) AS TEXT)
  WHERE metric IN ('product_task_share_7d','outreach_human_clicks_7d','reader_signal_7d','human_pageviews_7d','ga4_sessions_7d');
END;
