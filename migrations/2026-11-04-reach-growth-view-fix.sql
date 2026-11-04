-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_reach_growth_7d; CREATE VIEW v_reach_growth_7d AS SELECT measure, last_7d, prev_7d FROM bak_20261104_reach_growth_view_v
-- BACKUP: bak_20261104_reach_growth_view
-- REACH-GROWTH-1 fix (pillar reach): v_reach_growth_7d summed ga4 sessions over all six entity types (channel, country, device, host, page, source), each of
-- which repeats the same total, so GA4 read 6,512 for 7 days against 1,181 (v_outcome_northstar). Each source is now summed at one entity type that partitions it:
-- ga4 sessions by channel, cf-rum-human visits by host and pageviews at the site row. utm clicks have one entity type (campaign), unchanged.
-- CAUSE-MAPPED: view only, registers no metric.
CREATE TABLE bak_20261104_reach_growth_view AS SELECT * FROM v_reach_growth_7d;
CREATE TABLE bak_20261104_reach_growth_view_v AS SELECT * FROM v_reach_growth_7d;
DROP VIEW v_reach_growth_7d;
CREATE VIEW v_reach_growth_7d AS
SELECT 'visits' AS measure,
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0) AS last_7d,
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0) AS prev_7d
FROM reach_signals WHERE source='cf-rum-human' AND metric='visits' AND entity_type='host'
UNION ALL
SELECT 'pageviews_site',
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0),
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0)
FROM reach_signals WHERE source='cf-rum-human' AND metric='pageviews' AND entity_type='site'
UNION ALL
SELECT 'ga4_sessions',
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0),
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0)
FROM reach_signals WHERE source='ga4' AND metric='sessions' AND entity_type='channel'
UNION ALL
SELECT 'clicks_human:' || channel,
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0),
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0)
FROM reach_signals WHERE source='utm' AND metric='clicks_human' GROUP BY channel;
