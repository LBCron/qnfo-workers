-- AI-SEARCH-COST-1 (2026-11-05, charter pillar cost; GitHub QNFO/qnfo-workers#5400 and #5573; agent_issues 1000651; roadmap_implementation 1694 RM-AISEARCH-GA-MIGRATE-1; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_ai_search_cost
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.sql FROM bak_20261105_e_ai_search_cost b WHERE b.name = 'roadmap:1694:status'), evidence = (SELECT b.sql FROM bak_20261105_e_ai_search_cost b WHERE b.name = 'roadmap:1694:evidence') WHERE id = 1694 AND EXISTS (SELECT 1 FROM bak_20261105_e_ai_search_cost b WHERE b.name = 'roadmap:1694:status'); UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:rollback' WHERE class = 'rm-1694'; DROP TABLE IF EXISTS ai_search_cost_snapshots; DELETE FROM cost_source_registry WHERE source = 'ai_search:usage'
-- The previous v_cost_lines_month text is the table bak_20261105_e_ai_search_cost (name, sql) and, unchanged, migrations/2026-11-04-vendor-cost-ledger.sql: recreate it from there to roll the view back.
-- CAUSE-MAPPED: no metric is registered here; this creates a table, extends a view and replaces one contract probe.
--
-- RM-AISEARCH-GA-MIGRATE-1 asks that the first AI Search charge reaches a cost line, because "a cost metric that drops silently reads as a saving". Read on 2026-11-05:
--   * scripts/cost_ledger.py write_ai_search_snapshot (PR 6563) had no caller and its table ai_search_cost_snapshots no DDL: D1 answered "no such table".
--   * v_cost_lines_month (the lines behind v_cost_all_in and the dashboard Money card) read only workers_ai, ai_gateway:*, owner_gateway:*, cloudflare_plan:daily and
--     direct_providers_external:daily from cost_daily, so a cost_daily source 'ai_search:usage' would have been left out of the total.
--   * Cloudflare postponed AI Search usage billing from 2026-11-01 to 2026-12-01 (changelog 2026-11-02, read 2026-11-05), so no charge exists yet: the snapshot records the inventory and
--     'pre-billing' until then, and 'measured' with the billable ContractedCost per charge day after.
--   * The contract probe compared unified_cost_usd_30d (AI Gateway unified billing, 0.00 because the fleet pays neurons and BYOK) with ai_est_cost_30d - owner_local_cost_usd_30d (521.19 on
--     2026-11-04): two different quantities, so it could never pass. It is replaced by a probe of the telemetry itself: a snapshot under 26 hours old that read the inventory and the usage
--     report, and a view that reads ai_search:usage. The comparison the issue wants after billing starts is the Money card, which now includes the line.
-- The code half (scripts/cost_ledger.py ai_search_summary in main, selftest) and docs/AI-SEARCH-INSTANCES.md are in the same PR.

CREATE TABLE IF NOT EXISTS ai_search_cost_snapshots (
  snapshot_day TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  instance_count INTEGER,
  known_instance_fee_usd REAL,
  usage_state TEXT NOT NULL,
  usage_usd REAL,
  query_start TEXT,
  query_end TEXT,
  inventory_json TEXT,
  usage_json TEXT
);

CREATE TABLE IF NOT EXISTS bak_20261105_e_ai_search_cost (name TEXT PRIMARY KEY, sql TEXT);
INSERT OR IGNORE INTO bak_20261105_e_ai_search_cost (name, sql)
SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_cost_lines_month';

INSERT OR IGNORE INTO cost_source_registry (source, label, scope, payer, observable_via, notes) VALUES
  ('ai_search:usage', 'Cloudflare AI Search usage (ingestion, storage, queries), per charge day', 'fleet', 'user (Cloudflare billing)',
   'GET /accounts/{id}/billable-usage (ContractedCost of AI Search lines), read hourly by scripts/cost_ledger.py write_ai_search_snapshot; inventory from /ai-search/namespaces',
   'AI-SEARCH-COST-1: usage billing starts 2026-12-01 (postponed from 2026-11-01); until then the snapshot reads pre-billing and this source has no rows. Workers AI embedding and rerank calls made by AI Search are inside these lines, not on the Workers AI meter.');

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

-- The closing probe: the telemetry exists. The newest snapshot is under 26 hours old, read the inventory (instance_count is NULL when it could not) and is not 'unavailable'
-- or 'unmeasured' (a billing period with an instance and no AI Search line), and the view reads the source.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''AI Search cost telemetry is live: a snapshot under 26 hours old with a read inventory, and the cost view reads ai_search:usage'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM ai_search_cost_snapshots WHERE usage_state IN (''pre-billing'', ''measured'') AND instance_count IS NOT NULL AND (julianday(''now'') - julianday(observed_at)) * 24 < 26) AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = ''view'' AND name = ''v_cost_lines_month'' AND instr(sql, ''ai_search:usage'') > 0) THEN ''AI Search cost telemetry is live: a snapshot under 26 hours old with a read inventory, and the cost view reads ai_search:usage'' ELSE ''no fresh readable AI Search snapshot, or v_cost_lines_month does not read ai_search:usage'' END AS observed',
    action = 'AI-SEARCH-COST-1: scripts/cost_ledger.py runs write_ai_search_snapshot hourly (ai_search_summary), ai_search_cost_snapshots holds the inventory and billable usage, v_cost_lines_month reads ai_search:usage. Billing starts 2026-12-01; the first invoice line replaces the bound in docs/AI-SEARCH-INSTANCES.md.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000651' AND issue_id = 1000651;

-- The roadmap row (GitHub #5573) is built once this change is on main: the hourly ledger run is the code that deploys it. The steward (psBuiltVerify, ROADMAP-BUILT-VERIFY-1) closes the mirror from the same
-- probe, so the row stays open until the first fresh readable snapshot exists. The previous status and evidence are saved first (rows 'roadmap:1694:status' and 'roadmap:1694:evidence').
INSERT OR IGNORE INTO bak_20261105_e_ai_search_cost (name, sql) SELECT 'roadmap:1694:status', status FROM roadmap_implementation WHERE id = 1694;
INSERT OR IGNORE INTO bak_20261105_e_ai_search_cost (name, sql) SELECT 'roadmap:1694:evidence', evidence FROM roadmap_implementation WHERE id = 1694;

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'AI-SEARCH-COST-1 (2026-11-05): scripts/cost_ledger.py ai_search_summary runs hourly and writes ai_search_cost_snapshots (migrations/2026-11-05-e-ai-search-cost.sql); v_cost_lines_month reads the ai_search:usage source; docs/AI-SEARCH-INSTANCES.md has the inventory (one instance, qnfo-corpus), the rates and the postponement of usage billing to 2026-12-01. Closes when a fresh readable snapshot exists (contract rm-1694).'
WHERE id = 1694 AND item = 'RM-AISEARCH-GA-MIGRATE-1' AND status = 'planned';

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1694', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item RM-AISEARCH-GA-MIGRATE-1 (id 1694) is built and waits for its closing probe',
 'AI-SEARCH-COST-1: scripts/cost_ledger.py runs ai_search_summary hourly, ai_search_cost_snapshots holds the inventory and billable usage, v_cost_lines_month reads ai_search:usage.',
 (SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1000651'),
 'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1694 AND item = 'RM-AISEARCH-GA-MIGRATE-1' AND status IN ('built', 'deployed', 'implemented');
