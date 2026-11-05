-- AI-SEARCH-COST-3 (2026-11-05, charter pillar cost; GitHub QNFO/qnfo-workers#5400 and #5573; agent_issues 1000651; roadmap_implementation 1694; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_ai_search_dedupe
-- Rollback: DROP VIEW IF EXISTS v_cost_lines_month
-- Rollback (second step, then recreate the view from the table bak_20261105_e_ai_search_dedupe, column sql, or from migrations/2026-11-05-e-ai-search-cost.sql): the view text before this file.
-- CAUSE-MAPPED: no metric is registered here; this recreates one view.
--
-- Found after migrations/2026-11-05-e-ai-search-cost.sql merged (PR 7640): v_cost_lines_month now has two ways to carry the same AI Search charge.
--   * the meter line: qnfo-infra costVendorTick reads the five aiSearch* GraphQL datasets hourly into cost_vendor_month (product ai_search, evidence meter: usage x the published price after the included
--     allowance; read 2026-11-05T04:30:54Z: ingestion 657,938 tokens in four days, forecast USD 0.66), and the view's second branch carries it;
--   * the invoice line that file added: cost_daily source ai_search:usage (Cloudflare billable-usage ContractedCost per charge day, written by scripts/cost_ledger.py), evidence invoice.
-- Both would be summed into v_cost_all_in the day the billable-usage report answers, i.e. the same charge twice. Today the report answers 403 to every token in reach (docs/COST-LEDGER-ALLVENDOR.md), so
-- the invoice branch has no rows and nothing is double counted yet; the defect is latent and would start without any deploy.
-- Fix: the invoice line is the fallback, not an addend. The view reads ai_search:usage rows only while cost_vendor_month holds no ai_search row for the month; the rows stay in cost_daily and
-- ai_search_cost_snapshots as the figure to reconcile the meter against. The contract probe of issue 1000651 and rm-1694 still holds (the view text still reads ai_search:usage).

CREATE TABLE IF NOT EXISTS bak_20261105_e_ai_search_dedupe (name TEXT PRIMARY KEY, sql TEXT);
INSERT OR IGNORE INTO bak_20261105_e_ai_search_dedupe (name, sql)
SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_cost_lines_month';

DROP VIEW IF EXISTS v_cost_lines_month;
CREATE VIEW v_cost_lines_month AS
WITH b AS (
  SELECT strftime('%Y-%m', 'now') AS m, date('now', 'start of month') AS m0, date('now') AS d0,
    CAST(julianday(date('now', 'start of month', '+1 month')) - julianday(date('now', 'start of month')) AS INTEGER) AS dim,
    CAST(julianday(date('now')) - julianday(date('now', 'start of month')) AS INTEGER) AS done
), ai AS (
  SELECT CASE WHEN source = 'workers_ai' OR instr(source, 'ai_gateway:') = 1 OR source = 'cloudflare_plan:daily' OR source = 'ai_search:usage' THEN 'cloudflare' ELSE 'owner' END AS vendor,
    CASE WHEN source = 'cloudflare_plan:daily' THEN 'workers_paid_plan' WHEN source = 'direct_providers_external:daily' THEN 'direct_providers' WHEN source = 'ai_search:usage' THEN 'ai_search' ELSE source END AS product,
    CASE WHEN source = 'cloudflare_plan:daily' OR source = 'ai_search:usage' THEN 'invoice' WHEN source = 'direct_providers_external:daily' THEN 'owner-stated' ELSE 'meter' END AS evidence,
    date, usd
  FROM cost_daily
  WHERE date >= date('now', '-40 days')
    AND (source IN ('workers_ai', 'cloudflare_plan:daily', 'direct_providers_external:daily', 'ai_search:usage') OR instr(source, 'ai_gateway:') = 1 OR instr(source, 'owner_gateway:') = 1)
    AND NOT (source = 'ai_search:usage' AND EXISTS (SELECT 1 FROM cost_vendor_month x WHERE x.vendor = 'cloudflare' AND x.product = 'ai_search' AND x.month = strftime('%Y-%m', 'now')))
)
SELECT ai.vendor AS vendor, ai.product AS product, ai.evidence AS evidence,
  ROUND(SUM(CASE WHEN ai.date >= b.m0 AND ai.date < b.d0 THEN ai.usd ELSE 0 END), 2) AS mtd_usd,
  ROUND(SUM(CASE WHEN ai.date >= b.m0 AND ai.date < b.d0 THEN ai.usd ELSE 0 END)
        + (b.dim - b.done) * SUM(CASE WHEN ai.date >= date('now', '-3 days') AND ai.date < b.d0 THEN ai.usd ELSE 0 END) / 3.0, 2) AS forecast_month_usd,
  ROUND(SUM(CASE WHEN ai.date >= date('now', '-3 days') AND ai.date < b.d0 THEN ai.usd ELSE 0 END) / 3.0, 4) AS rate_daily_usd
FROM ai, b GROUP BY ai.vendor, ai.product, ai.evidence
UNION ALL
SELECT m.vendor, m.product, m.evidence, ROUND(SUM(m.net_mtd_usd), 2), ROUND(SUM(m.net_forecast_usd), 2), ROUND(SUM(m.rate_daily_3d_usd), 4)
FROM cost_vendor_month m, b WHERE m.month = b.m GROUP BY m.vendor, m.product, m.evidence;
