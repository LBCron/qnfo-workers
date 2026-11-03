-- ISSUE-YIELD-PER-100-1 (issue 1000780, charter pillar autonomy; cost and quality guard).
-- Measure distinct, evidence-backed issue closures against the complete seven-day cost ledger.
-- Spending zero or lacking a full cost window returns no yield. The issue's probe also requires
-- higher yield than its captured baseline, non-falling remedy quality and an in-budget monthly run rate.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_issue_yield_contract
-- Rollback: UPDATE remediation_contracts SET precondition=(SELECT precondition FROM bak_20261103_issue_yield_contract WHERE class='issue-1000780'), action=(SELECT action FROM bak_20261103_issue_yield_contract WHERE class='issue-1000780'), verify_probe=(SELECT verify_probe FROM bak_20261103_issue_yield_contract WHERE class='issue-1000780'), module=(SELECT module FROM bak_20261103_issue_yield_contract WHERE class='issue-1000780') WHERE class='issue-1000780' AND EXISTS (SELECT 1 FROM bak_20261103_issue_yield_contract WHERE class='issue-1000780'); DROP VIEW IF EXISTS v_issue_yield_per_100;

CREATE TABLE IF NOT EXISTS bak_20261103_issue_yield_contract AS
SELECT class, precondition, action, verify_probe, module
FROM remediation_contracts WHERE class = 'issue-1000780';

CREATE VIEW IF NOT EXISTS v_issue_yield_per_100 AS
WITH spend AS (
  SELECT SUM(usd) AS spend_usd_7d, COUNT(DISTINCT date) AS cost_days_7d,
    MAX(updated_at) AS spend_refreshed_at
  FROM cost_daily
  WHERE date >= date('now', '-6 days') AND date <= date('now')
), closures AS (
  SELECT COUNT(DISTINCT l.issue_id) AS evidence_closures_7d
  FROM issue_lifecycle l
  JOIN agent_issues i ON i.id = l.issue_id
  JOIN issue_triage t ON t.issue_id = l.issue_id
  WHERE l.to_status IN ('closed', 'resolved')
    AND l.has_evidence = 1
    AND i.status IN ('closed', 'resolved')
    AND t.close_evidence IS NOT NULL AND trim(t.close_evidence) <> ''
    AND datetime(l.ts) >= datetime('now', '-7 days')
), quality AS (
  SELECT
    MAX(CASE WHEN metric = 'remedy_efficacy_30d' THEN CAST(last_value AS REAL) END) AS remedy_quality,
    MAX(CASE WHEN metric = 'remedy_efficacy_30d' THEN last_refreshed END) AS remedy_quality_refreshed_at
  FROM metric_registry
), budget AS (
  SELECT current AS monthly_spend_usd, cap AS monthly_budget_usd, updated_at AS budget_refreshed_at
  FROM fleet_budget WHERE node_class = 'cost:fleet_all_in_month'
)
SELECT c.evidence_closures_7d, s.spend_usd_7d, s.cost_days_7d, s.spend_refreshed_at,
  CASE WHEN s.cost_days_7d = 7 AND s.spend_usd_7d > 0
    THEN ROUND(100.0 * c.evidence_closures_7d / s.spend_usd_7d, 2) END AS issue_closures_per_100_usd_7d,
  q.remedy_quality, q.remedy_quality_refreshed_at,
  b.monthly_spend_usd, b.monthly_budget_usd, b.budget_refreshed_at,
  CASE WHEN b.monthly_spend_usd > 0 AND b.monthly_budget_usd > 0
      AND b.monthly_spend_usd <= b.monthly_budget_usd THEN 1 ELSE 0 END AS within_monthly_budget
FROM closures c CROSS JOIN spend s CROSS JOIN quality q
LEFT JOIN budget b ON 1 = 1;

UPDATE remediation_contracts
SET precondition = (
      SELECT json_object('contract', 'ISSUE-YIELD-PER-100-1',
        'baseline_yield_per_100_usd', issue_closures_per_100_usd_7d,
        'baseline_remedy_quality', remedy_quality)
      FROM v_issue_yield_per_100
    ),
    action = 'ISSUE-YIELD-PER-100-1: measure distinct evidence-backed issue closures per $100 of complete seven-day spend. Keep the remedy only when yield rises above baseline, remedy_efficacy_30d does not fall, and monthly spend is within its budget.',
    verify_probe = 'WITH baseline AS (SELECT CAST(json_extract((SELECT precondition FROM remediation_contracts WHERE class = ''issue-1000780''), ''$.baseline_yield_per_100_usd'') AS REAL) AS yield_per_100, CAST(json_extract((SELECT precondition FROM remediation_contracts WHERE class = ''issue-1000780''), ''$.baseline_remedy_quality'') AS REAL) AS remedy_quality), current AS (SELECT * FROM v_issue_yield_per_100) SELECT ''pass'' AS expected, CASE WHEN current.cost_days_7d = 7 AND current.issue_closures_per_100_usd_7d IS NOT NULL AND baseline.yield_per_100 IS NOT NULL AND current.issue_closures_per_100_usd_7d > baseline.yield_per_100 AND current.remedy_quality IS NOT NULL AND baseline.remedy_quality IS NOT NULL AND current.remedy_quality >= baseline.remedy_quality AND current.within_monthly_budget = 1 AND datetime(current.budget_refreshed_at) >= datetime(''now'', ''-120 minutes'') AND datetime(current.remedy_quality_refreshed_at) >= datetime(''now'', ''-120 minutes'') AND datetime(current.spend_refreshed_at) >= datetime(''now'', ''-120 minutes'') THEN ''pass'' ELSE ''pending: yield, quality, complete spend window or monthly budget guard has not recovered'' END AS observed FROM baseline CROSS JOIN current',
    module = 'issue-yield-per-100'
WHERE class = 'issue-1000780'
  AND instr(COALESCE(precondition, ''), 'ISSUE-YIELD-PER-100-1') = 0;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain,
   predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:QNFO.OPS',
  'Issue yield must count durable evidence-backed closures against the same seven-day spend window, not count zero spend as success',
  'ISSUE-YIELD-PER-100-1: add a live yield view and bind issue 1000780 to its captured baseline, quality and monthly-budget guards',
  'Live qnfo-audit baseline: yield=' || COALESCE(CAST(issue_closures_per_100_usd_7d AS TEXT), 'n/a')
    || ', evidence closures=' || evidence_closures_7d || ', seven-day spend=' || COALESCE(CAST(spend_usd_7d AS TEXT), 'n/a')
    || ', remedy quality=' || COALESCE(CAST(remedy_quality AS TEXT), 'n/a'),
  'pending canonical migration and a later fresh read; current budget and quality guards remain binding',
  'one read-only view and issue 1000780 remediation contract',
  'Rollback line of migrations/2026-11-03-issue-yield-per-100.sql',
  'evidence-backed issue yield becomes measurable without rewarding zero spend or weakened remediation quality',
  'yield rises above the captured baseline, remedy_efficacy_30d does not fall, and monthly spend is within cap',
  'no reach claim',
  'SQLite migration regression and live qnfo-audit read-only baseline'
FROM v_issue_yield_per_100
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log WHERE action LIKE 'ISSUE-YIELD-PER-100-1:%'
);
