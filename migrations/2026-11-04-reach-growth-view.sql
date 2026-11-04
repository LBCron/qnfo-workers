-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_reach_growth_7d;
-- EMAIL-UTM-1 / REACH-GROWTH-1 (pillar reach): one row per week window of human visits (cf-rum-human), GA4 sessions and
-- human UTM clicks per channel, so growth is read week over week, and email clicks show once qnfo-outreach 0.3.9 tags links.
CREATE VIEW IF NOT EXISTS v_reach_growth_7d AS
SELECT 'visits' AS measure,
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0) AS last_7d,
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0) AS prev_7d
FROM reach_signals WHERE source='cf-rum-human' AND metric='visits'
UNION ALL
SELECT 'ga4_sessions',
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0),
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0)
FROM reach_signals WHERE source='ga4' AND metric='sessions'
UNION ALL
SELECT 'clicks_human:' || channel,
  COALESCE(SUM(CASE WHEN date >= date('now','-7 days') THEN value END),0),
  COALESCE(SUM(CASE WHEN date >= date('now','-14 days') AND date < date('now','-7 days') THEN value END),0)
FROM reach_signals WHERE source='utm' AND metric='clicks_human' GROUP BY channel;
