-- COST-LEDGER-ALLVENDOR-1 (2026-11-04, pillar cost; owner 2026-11-04: total cost inside USD 200-300 a month, measured, not estimated).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_cost_ledger_stale; DROP VIEW IF EXISTS v_cost_all_in; DROP VIEW IF EXISTS v_cost_lines_month; DROP VIEW IF EXISTS v_cost_usage_priced_daily; DROP TABLE IF EXISTS cost_vendor_month; DROP TABLE IF EXISTS cost_usage_daily; DROP TABLE IF EXISTS cost_price_book; DELETE FROM failure_modes WHERE fm_key = 'cost-vendor-ledger-stale'; DELETE FROM remediation_contracts WHERE class = 'fm-cost-vendor-ledger-stale'; DELETE FROM cost_source_registry WHERE source IN ('cloudflare:<product>', 'github:<product>')
--
-- WHY (measured 2026-11-04): the dashboard pace was wrong in both directions. cost_daily holds only Workers AI, AI Gateway, the USD 5 plan and the owner-stated
-- USD 15 a day; every other Cloudflare product (Workers CPU, D1, Durable Objects, R2, KV, Queues, Vectorize, Containers, Browser Rendering, Workers Logs) and
-- GitHub had no line at all. The Cloudflare billing API answers 403 to every token in reach (GET /accounts/{id}/billing/usage, /billable-usage), so the
-- honest figure is the vendor's own usage meter (GraphQL analytics datasets, the Workers observability usage endpoint, GitHub's billing usage summary)
-- multiplied by the vendor's published unit price after the monthly included allowance. cost_price_book holds those prices with their source URL and the date
-- they were read; cost_usage_daily the meter; cost_vendor_month the priced, allowance-aware month-to-date and month forecast per (vendor, product, metric).
-- qnfo-infra (hourly :30, its existing cron) fills the Cloudflare rows; qnfo-github-steward fills GitHub's. The views union them with the AI lines that
-- scripts/cost_ledger.py keeps in cost_daily, so /api/cost and the dashboard Money card read ONE total with an evidence flag per line:
--   meter         usage read from the vendor meter x the published price after the included allowance (the invoice would add this)
--   invoice       an amount the vendor states itself (Workers Paid subscription, GitHub billing usage netAmount)
--   estimate      computed from a list of owned things x an assumed price (domain renewals); not read from any meter
--   owner-stated  a figure the owner gave and no API can see (direct provider subscriptions)
-- A day's priced usage before the allowance is v_cost_usage_priced_daily.rate_usd: it is the marginal cost of that day's usage once the month is past its
-- allowance, so a cut is graded by the drop in rate_usd and in cost_vendor_month.net_forecast_usd, not by the day's invoiced amount (allowances make a
-- day's net amount zero until the month crosses them: D1 rows read were 7.8 B in 4 days of November against 25 B included, so the net was 0 for
-- November 1-4 and the forecast month is about USD 34).
-- Measured 2026-11-04 (CF GraphQL 2026-10-05..11-04, observability usage REST, GitHub billing REST): Workers requests 1.5 M and CPU 29 M ms in 27 days of October (allowances
-- 10 M and 30 M ms); D1 rows read 16.6 B in October (from the 5th) and 7.8 B in 4 days of November (about 2 B a day); Durable Object duration 1.8 k GB-s a day in October and
-- 35 k a day from November 1 (activeTime 275 e9 us a day, about 76 object-hours a day; allowance 400 k GB-s a month); R2 69 GB stored, class B 246 k reads a day;
-- Vectorize 118.8 M queried dimensions in 27 days (allowance 50 M); Containers, KV, Queues, Workflows, Browser Rendering inside their allowances; Workers Logs and traces
-- 4.9 M events in 30 days (allowance 20 M); GitHub Actions 186,195 Linux minutes in October = USD 1,117 at list, discount USD 1,117, net 0 (public repository).

CREATE TABLE IF NOT EXISTS cost_price_book (
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  metric TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('flow', 'stock')),
  unit TEXT NOT NULL,
  included_per_month REAL NOT NULL DEFAULT 0,
  usd_per_block REAL NOT NULL,
  block_size REAL NOT NULL DEFAULT 1,
  source_url TEXT NOT NULL,
  checked_on TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (vendor, product, metric)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS cost_usage_daily (
  date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  metric TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'meter',
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (date, vendor, product, metric)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS cost_vendor_month (
  month TEXT NOT NULL,
  vendor TEXT NOT NULL,
  product TEXT NOT NULL,
  metric TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (evidence IN ('meter', 'invoice', 'estimate', 'owner-stated')),
  unit TEXT NOT NULL,
  included REAL NOT NULL DEFAULT 0,
  usage_mtd REAL NOT NULL DEFAULT 0,
  usage_projected REAL NOT NULL DEFAULT 0,
  gross_mtd_usd REAL NOT NULL DEFAULT 0,
  net_mtd_usd REAL NOT NULL DEFAULT 0,
  net_forecast_usd REAL NOT NULL DEFAULT 0,
  rate_daily_3d_usd REAL NOT NULL DEFAULT 0,
  days_observed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (month, vendor, product, metric)
) WITHOUT ROWID;

-- Published unit prices, Workers Paid plan, read from the vendor's pricing pages on 2026-11-04. A price that changes is a later migration with a new checked_on.
INSERT OR IGNORE INTO cost_price_book (vendor, product, metric, kind, unit, included_per_month, usd_per_block, block_size, source_url, checked_on, note) VALUES
  ('cloudflare', 'workers', 'requests', 'flow', 'requests', 10000000, 0.30, 1000000, 'https://developers.cloudflare.com/workers/platform/pricing/', '2026-11-04', 'Standard model: 10 M included, USD 0.30 per additional million'),
  ('cloudflare', 'workers', 'cpu_ms', 'flow', 'cpu_ms', 30000000, 0.02, 1000000, 'https://developers.cloudflare.com/workers/platform/pricing/', '2026-11-04', '30 M CPU ms included, USD 0.02 per additional million'),
  ('cloudflare', 'd1', 'rows_read', 'flow', 'rows', 25000000000, 0.001, 1000000, 'https://developers.cloudflare.com/d1/platform/pricing/', '2026-11-04', '25 B included, USD 0.001 per additional million'),
  ('cloudflare', 'd1', 'rows_written', 'flow', 'rows', 50000000, 1.00, 1000000, 'https://developers.cloudflare.com/d1/platform/pricing/', '2026-11-04', '50 M included, USD 1.00 per additional million'),
  ('cloudflare', 'd1', 'storage_gb', 'stock', 'GB', 5, 0.75, 1, 'https://developers.cloudflare.com/d1/platform/pricing/', '2026-11-04', '5 GB included, USD 0.75 per GB-month; summed over every database (decimal GB)'),
  ('cloudflare', 'durable_objects', 'requests', 'flow', 'requests', 1000000, 0.15, 1000000, 'https://developers.cloudflare.com/durable-objects/platform/pricing/', '2026-11-04', '1 M included, USD 0.15 per additional million (WebSocket messages billed 20:1, not modelled)'),
  ('cloudflare', 'durable_objects', 'duration_gb_s', 'flow', 'GB-s', 400000, 12.50, 1000000, 'https://developers.cloudflare.com/durable-objects/platform/pricing/', '2026-11-04', '400 k GB-s included, USD 12.50 per additional million; the meter field duration equals activeTime x 128 MB'),
  ('cloudflare', 'durable_objects', 'sql_rows_read', 'flow', 'rows', 25000000000, 0.001, 1000000, 'https://developers.cloudflare.com/durable-objects/platform/pricing/', '2026-11-04', '25 B included'),
  ('cloudflare', 'durable_objects', 'sql_rows_written', 'flow', 'rows', 50000000, 1.00, 1000000, 'https://developers.cloudflare.com/durable-objects/platform/pricing/', '2026-11-04', '50 M included'),
  ('cloudflare', 'durable_objects', 'sql_storage_gb', 'stock', 'GB', 5, 0.20, 1, 'https://developers.cloudflare.com/durable-objects/platform/pricing/', '2026-11-04', '5 GB-month included, USD 0.20 per GB-month'),
  ('cloudflare', 'r2', 'class_a_ops', 'flow', 'requests', 1000000, 4.50, 1000000, 'https://developers.cloudflare.com/r2/pricing/', '2026-11-04', 'Class A (writes, lists, multipart, copy): 1 M included'),
  ('cloudflare', 'r2', 'class_b_ops', 'flow', 'requests', 10000000, 0.36, 1000000, 'https://developers.cloudflare.com/r2/pricing/', '2026-11-04', 'Class B (get, head): 10 M included; delete and abort are free'),
  ('cloudflare', 'r2', 'storage_gb', 'stock', 'GB', 10, 0.015, 1, 'https://developers.cloudflare.com/r2/pricing/', '2026-11-04', 'Standard storage: 10 GB-month free, USD 0.015 per GB-month; egress free'),
  ('cloudflare', 'kv', 'reads', 'flow', 'requests', 10000000, 0.50, 1000000, 'https://developers.cloudflare.com/kv/platform/pricing/', '2026-11-04', NULL),
  ('cloudflare', 'kv', 'writes', 'flow', 'requests', 1000000, 5.00, 1000000, 'https://developers.cloudflare.com/kv/platform/pricing/', '2026-11-04', NULL),
  ('cloudflare', 'kv', 'deletes', 'flow', 'requests', 1000000, 5.00, 1000000, 'https://developers.cloudflare.com/kv/platform/pricing/', '2026-11-04', NULL),
  ('cloudflare', 'kv', 'lists', 'flow', 'requests', 1000000, 5.00, 1000000, 'https://developers.cloudflare.com/kv/platform/pricing/', '2026-11-04', NULL),
  ('cloudflare', 'kv', 'storage_gb', 'stock', 'GB', 1, 0.50, 1, 'https://developers.cloudflare.com/kv/platform/pricing/', '2026-11-04', NULL),
  ('cloudflare', 'queues', 'operations', 'flow', 'operations', 1000000, 0.40, 1000000, 'https://developers.cloudflare.com/queues/platform/pricing/', '2026-11-04', 'billableOperations (64 KB units)'),
  ('cloudflare', 'vectorize', 'queried_dimensions', 'flow', 'dimensions', 50000000, 0.01, 1000000, 'https://developers.cloudflare.com/vectorize/platform/pricing/', '2026-11-04', '50 M queried dimensions included, USD 0.01 per additional million'),
  ('cloudflare', 'vectorize', 'stored_dimensions', 'stock', 'dimensions', 10000000, 0.05, 100000000, 'https://developers.cloudflare.com/vectorize/platform/pricing/', '2026-11-04', '10 M stored dimensions included, USD 0.05 per 100 M; summed over every index'),
  ('cloudflare', 'containers', 'memory_gib_s', 'flow', 'GiB-s', 90000, 0.0000025, 1, 'https://developers.cloudflare.com/containers/pricing/', '2026-11-04', '25 GiB-hours included; the meter field allocatedMemory is read as byte-seconds (consistent with cpuTimeSec and the run count)'),
  ('cloudflare', 'containers', 'vcpu_s', 'flow', 'vCPU-s', 22500, 0.000020, 1, 'https://developers.cloudflare.com/containers/pricing/', '2026-11-04', '375 vCPU-minutes included'),
  ('cloudflare', 'containers', 'disk_gb_s', 'flow', 'GB-s', 720000, 0.00000007, 1, 'https://developers.cloudflare.com/containers/pricing/', '2026-11-04', '200 GB-hours included; allocatedDisk read as byte-seconds'),
  ('cloudflare', 'browser_rendering', 'browser_hours', 'flow', 'hours', 10, 0.09, 1, 'https://developers.cloudflare.com/browser-rendering/pricing/', '2026-11-04', '10 hours included, USD 0.09 per additional hour; concurrent-browser charge not modelled (peak is far under 10)'),
  ('cloudflare', 'workers_logs', 'events', 'flow', 'events', 20000000, 0.60, 1000000, 'https://developers.cloudflare.com/workers/observability/logs/workers-logs/', '2026-11-04', 'Logs and traces events from GET /workers/observability/usage; billing moves to Cloudflare Observability pricing on 2026-12-01 (re-read then)');

INSERT OR IGNORE INTO cost_source_registry (source, label, scope, payer, observable_via, notes) VALUES
  ('cloudflare:<product>', 'Cloudflare non-AI products (Workers, D1, Durable Objects, R2, KV, Queues, Vectorize, Containers, Browser Rendering, Workers Logs), per month', 'fleet', 'user (Cloudflare billing)', 'Cloudflare GraphQL analytics datasets and GET /workers/observability/usage, read hourly by qnfo-infra into cost_usage_daily, priced from cost_price_book into cost_vendor_month', 'COST-LEDGER-ALLVENDOR-1; evidence meter; the billing API (/billing/usage, /billable-usage) answers 403 to every token in reach, so the invoice itself is not read'),
  ('github:<product>', 'GitHub Actions, storage and Copilot AI units, per month', 'fleet', 'user (GitHub billing)', 'GET /organizations/QNFO/settings/billing/usage/summary and /users/<owner>/settings/billing/usage/summary, read by qnfo-github-steward into cost_vendor_month', 'COST-LEDGER-ALLVENDOR-1; evidence invoice; netAmount is what GitHub charges after discounts, grossAmount the list value (Actions in a public repository is discounted 100%)');

-- One line per (vendor, product) for the current month: the AI lines scripts/cost_ledger.py keeps in cost_daily (month to date and 3-day pace, the same convention
-- as v_cost_forecast) plus the priced Cloudflare and GitHub rows of cost_vendor_month.
CREATE VIEW IF NOT EXISTS v_cost_lines_month AS
WITH b AS (
  SELECT strftime('%Y-%m', 'now') AS m, date('now', 'start of month') AS m0, date('now') AS d0,
    CAST(julianday(date('now', 'start of month', '+1 month')) - julianday(date('now', 'start of month')) AS INTEGER) AS dim,
    CAST(julianday(date('now')) - julianday(date('now', 'start of month')) AS INTEGER) AS done
), ai AS (
  SELECT CASE WHEN source = 'workers_ai' OR instr(source, 'ai_gateway:') = 1 OR source = 'cloudflare_plan:daily' THEN 'cloudflare' ELSE 'owner' END AS vendor,
    CASE WHEN source = 'cloudflare_plan:daily' THEN 'workers_paid_plan' WHEN source = 'direct_providers_external:daily' THEN 'direct_providers' ELSE source END AS product,
    CASE WHEN source = 'cloudflare_plan:daily' THEN 'invoice' WHEN source = 'direct_providers_external:daily' THEN 'owner-stated' ELSE 'meter' END AS evidence,
    date, usd
  FROM cost_daily
  WHERE date >= date('now', '-40 days')
    AND (source IN ('workers_ai', 'cloudflare_plan:daily', 'direct_providers_external:daily') OR instr(source, 'ai_gateway:') = 1 OR instr(source, 'owner_gateway:') = 1)
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

-- The one total: month to date, month forecast, the budget, and how much of the forecast is read from a meter or invoice rather than stated or estimated.
-- fleet_measured_share_pct leaves the owner-stated direct providers out, because the fleet cannot see them; measured_share_pct keeps them in.
CREATE VIEW IF NOT EXISTS v_cost_all_in AS
SELECT ROUND(SUM(mtd_usd), 2) AS mtd_usd,
  ROUND(SUM(forecast_month_usd), 2) AS forecast_month_usd,
  COALESCE((SELECT CAST(value AS REAL) FROM ops_config WHERE key = 'cost_budget_month_usd'), 300) AS budget_month_usd,
  COALESCE((SELECT CAST(value AS REAL) FROM ops_config WHERE key = 'cost_budget_floor_month_usd'), 200) AS budget_floor_month_usd,
  ROUND(SUM(CASE WHEN evidence IN ('meter', 'invoice') THEN forecast_month_usd ELSE 0 END), 2) AS measured_usd,
  ROUND(SUM(CASE WHEN evidence = 'estimate' THEN forecast_month_usd ELSE 0 END), 2) AS estimated_usd,
  ROUND(SUM(CASE WHEN evidence = 'owner-stated' THEN forecast_month_usd ELSE 0 END), 2) AS owner_stated_usd,
  ROUND(100.0 * SUM(CASE WHEN evidence IN ('meter', 'invoice') THEN forecast_month_usd ELSE 0 END) / NULLIF(SUM(forecast_month_usd), 0), 1) AS measured_share_pct,
  ROUND(100.0 * SUM(CASE WHEN evidence IN ('meter', 'invoice') AND vendor <> 'owner' THEN forecast_month_usd ELSE 0 END)
        / NULLIF(SUM(CASE WHEN evidence <> 'owner-stated' THEN forecast_month_usd ELSE 0 END), 0), 1) AS fleet_measured_share_pct,
  COUNT(*) AS lines,
  (SELECT MAX(observed_at) FROM cost_usage_daily) AS last_usage_at
FROM v_cost_lines_month;

-- Every priced day, before the monthly allowance: rate_usd is the marginal cost of that day's usage once the month is past its included amount.
CREATE VIEW IF NOT EXISTS v_cost_usage_priced_daily AS
SELECT u.date, u.vendor, u.product, u.metric, u.quantity, u.unit, p.kind, p.included_per_month,
  CASE p.kind WHEN 'flow' THEN u.quantity / p.block_size * p.usd_per_block
              ELSE MAX(0, u.quantity - p.included_per_month) / p.block_size * p.usd_per_block / 30.0 END AS rate_usd
FROM cost_usage_daily u JOIN cost_price_book p ON p.vendor = u.vendor AND p.product = u.product AND p.metric = u.metric;

CREATE VIEW IF NOT EXISTS v_cost_ledger_stale AS
SELECT vendor, MAX(observed_at) AS last_observed_at, ROUND((julianday('now') - julianday(MAX(observed_at))) * 24, 2) AS age_h
FROM cost_usage_daily GROUP BY vendor;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('cost-vendor-ledger-stale',
   'the all-vendor cost ledger stops updating, so the Money card keeps showing a total that no longer includes the non-AI Cloudflare products',
   'the hourly qnfo-infra step that reads Cloudflare GraphQL and the observability usage endpoint fails (GraphQL rate-limit budget shared with the fleet, a changed dataset field, an expired token) and nothing else writes cost_usage_daily',
   'COST-LEDGER-ALLVENDOR-1: qnfo-infra costVendorTick logs the failing dataset (console.error, Workers Logs), stops at a rate-limit answer and retries on the next fire; the probe reads v_cost_ledger_stale',
   'v_cost_ledger_stale has no cloudflare row newer than 6 hours once the ledger is older than 3 hours',
   'fm-cost-vendor-ledger-stale', '2026-11-04', NULL,
   'GraphQL answers "Rate limiter budget depleted" for 5 minutes at a time when several sessions and the fleet query the account together',
   'v_cost_all_in.last_usage_at older than 6 hours',
   'dashboard Money card total, v_cost_all_in, the measured share');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status) VALUES
  ('fm-cost-vendor-ledger-stale', NULL, 'COST-LEDGER-ALLVENDOR-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(CASE WHEN strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'') < ''2026-11-05T03:00:00Z'' THEN 0 WHEN NOT EXISTS (SELECT 1 FROM cost_usage_daily WHERE vendor = ''cloudflare'') THEN 1 ELSE (SELECT COUNT(*) FROM v_cost_ledger_stale WHERE vendor = ''cloudflare'' AND age_h > 6) END AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-infra', 1, 'active');

INSERT OR IGNORE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
VALUES ('all-vendor-cost-ledger', 'migrations/2026-11-04-vendor-cost-ledger.sql (COST-LEDGER-ALLVENDOR-1, qnfo-infra costVendorTick)', 'Cloudflare GraphQL analytics + observability usage REST (CF_TOKEN), qnfo-audit',
 'hourly :30 rewrite of the last 3 days; detector fm-cost-vendor-ledger-stale',
 strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
 'one total with an evidence flag per line: v_cost_all_in over v_cost_lines_month (cost_daily AI lines + cost_vendor_month priced Cloudflare and GitHub rows)');
