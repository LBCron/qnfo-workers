-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_reach_site_daily; CREATE VIEW v_reach_growth_7d AS SELECT measure, last_7d, prev_7d FROM bak_20261104_reach_site_daily_v
-- BACKUP: bak_20261104_reach_site_daily
-- REACH-CANONICAL-1 (pillar reach): reach_signals repeats one total under several entity_type rows (ga4 sessions: channel, country, device, host, page, source each
-- hold the same day), so any SUM without an entity_type inflated a view 5x; it happened twice (v_prd_funnel, then v_reach_growth_7d). v_reach_site_daily is the one
-- deduped read: one entity_type that partitions each source per measure. Reach views read it; scripts/reach-signals-lint.test.mjs fails a new migration that sums
-- reach_signals directly.
-- CAUSE-MAPPED: views only, registers no metric.
CREATE TABLE bak_20261104_reach_site_daily AS SELECT * FROM v_reach_growth_7d;
CREATE TABLE bak_20261104_reach_site_daily_v AS SELECT * FROM v_reach_growth_7d;
CREATE VIEW v_reach_site_daily AS
SELECT date, CASE metric WHEN 'sessions' THEN 'ga4_sessions' ELSE 'ga4_engaged_sessions' END AS measure, '' AS channel, SUM(value) AS value FROM reach_signals WHERE source='ga4' AND entity_type='channel' AND metric IN ('sessions','engagedSessions') GROUP BY date, metric
UNION ALL
SELECT date, 'ga4_pageviews', '', SUM(value) FROM reach_signals WHERE source='ga4' AND entity_type='host' AND metric='screenPageViews' GROUP BY date
UNION ALL
SELECT date, 'rum_visits', '', SUM(value) FROM reach_signals WHERE source='cf-rum-human' AND entity_type='host' AND metric='visits' GROUP BY date
UNION ALL
SELECT date, 'rum_pageviews', '', SUM(value) FROM reach_signals WHERE source='cf-rum-human' AND entity_type='site' AND metric='pageviews' AND quality='human' GROUP BY date
UNION ALL
SELECT date, 'utm_clicks_human', channel, SUM(value) FROM reach_signals WHERE source='utm' AND entity_type='campaign' AND metric='clicks_human' GROUP BY date, channel;
DROP VIEW v_reach_growth_7d;
CREATE VIEW v_reach_growth_7d AS
SELECT CASE measure WHEN 'rum_visits' THEN 'visits' WHEN 'rum_pageviews' THEN 'pageviews_site' WHEN 'ga4_sessions' THEN 'ga4_sessions' ELSE 'clicks_human:' || channel END AS measure,
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0) AS last_7d,
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0) AS prev_7d
FROM v_reach_site_daily WHERE measure IN ('rum_visits','rum_pageviews','ga4_sessions','utm_clicks_human')
GROUP BY 1;
