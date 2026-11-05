-- AI-SEARCH-COST-1 (2026-11-05, charter pillar cost; roadmap row 1694 RM-AISEARCH-GA-MIGRATE-1, agent_issues 1000651): the AI Search line of the all-vendor cost ledger.
-- Cloudflare AI Search is generally available with usage billing from 2026-12-01 (changelog 2026-10-01 said 2026-11-01; the 2026-11-02 changelog postponed it by a month, price
-- and included usage unchanged). Its embedding and rerank calls are inside AI Search pricing and no longer appear on the Workers AI bill or in AI Gateway logs, so no existing
-- ledger line sees them: a cost metric that only fell would read as a saving. The billing REST endpoints (/billable-usage, /billable-usage/info) answer 403 to every token in
-- reach (docs/COST-LEDGER-ALLVENDOR.md; read again 2026-11-05 with the Cloudflare MCP token), but the five GraphQL meters Cloudflare bills on are readable with the token the
-- hourly qnfo-infra costVendorTick already uses: aiSearchSemanticQueriesAdaptiveGroups, aiSearchFulltextQueriesAdaptiveGroups, aiSearchStorageAdaptiveGroups,
-- aiSearchIngestionTokensAdaptiveGroups and aiSearchImageProcessingTokensAdaptiveGroups. qnfo-infra (this change) reads them into cost_usage_daily; these rows price them.
-- Read 2026-11-05 (7 days, instance qnfo-corpus, the only one): about 36 hybrid queries a day (a month is about 1,100 against 1,000 included), 76 MB stored (10 GB included),
-- 25 k to 270 k ingestion tokens a day (about 4 M a month against 5 M included). Expected bill from 2026-12-01: under USD 1 a month. The detector below makes the meter's
-- silence a failure, not a zero.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM cost_price_book WHERE vendor = 'cloudflare' AND product = 'ai_search'; DELETE FROM cost_usage_daily WHERE vendor = 'cloudflare' AND product = 'ai_search'; DELETE FROM cost_vendor_month WHERE vendor = 'cloudflare' AND product = 'ai_search'; DELETE FROM remediation_contracts WHERE class = 'fm-ai-search-meter-silent'; DELETE FROM failure_modes WHERE fm_key = 'ai-search-meter-silent';
-- BACKUP: cost_price_book

INSERT OR IGNORE INTO cost_price_book (vendor, product, metric, kind, unit, included_per_month, usd_per_block, block_size, source_url, checked_on, note) VALUES
  ('cloudflare', 'ai_search', 'semantic_queries', 'flow', 'queries', 1000, 0.75, 1000, 'https://developers.cloudflare.com/ai-search/platform/limits-pricing/', '2026-11-05', 'AI Search semantic, vector and hybrid queries: 1,000 included, USD 0.75 per additional 1,000; billing begins 2026-12-01 (before that the line is the charge the month would carry)'),
  ('cloudflare', 'ai_search', 'fulltext_queries', 'flow', 'queries', 1000, 0.10, 1000, 'https://developers.cloudflare.com/ai-search/platform/limits-pricing/', '2026-11-05', 'AI Search full-text queries: 1,000 included, USD 0.10 per additional 1,000'),
  ('cloudflare', 'ai_search', 'storage_gb', 'stock', 'GB', 10, 2.00, 1, 'https://developers.cloudflare.com/ai-search/platform/limits-pricing/', '2026-11-05', 'AI Search storage: 10 GB-month included, USD 2.00 per GB-month; summed over every instance (decimal GB)'),
  ('cloudflare', 'ai_search', 'ingestion_tokens', 'flow', 'tokens', 5000000, 0.75, 1000000, 'https://developers.cloudflare.com/ai-search/platform/limits-pricing/', '2026-11-05', 'AI Search base ingestion: 5 M tokens included, USD 0.75 per additional million'),
  ('cloudflare', 'ai_search', 'image_tokens', 'flow', 'tokens', 0, 0.50, 1000000, 'https://developers.cloudflare.com/ai-search/platform/limits-pricing/', '2026-11-05', 'AI Search image processing: USD 0.50 per million tokens on top of base ingestion; the tokens share the 5 M ingestion allowance, which is not modelled here (no image tokens read in 7 days), so this line is an upper bound');

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('ai-search-meter-silent', 'the AI Search usage meter stops reaching the all-vendor cost ledger while its billing is about to start',
  'AI Search embedding and rerank calls left the Workers AI and AI Gateway lines, the billing REST endpoints answer 403, and the only reader is the qnfo-infra costVendorTick GraphQL step; a renamed dataset field or a token scope change drops the five AI Search datasets while every other product keeps updating',
  'AI-SEARCH-COST-1: qnfo-infra COST_DATASETS carries the five aiSearch* datasets (a failing dataset is reported and skipped by name, console.error plus the cost_ledger tick row); the detector reads the newest ai_search storage row, which Cloudflare reports every day while an instance exists',
  'fm-ai-search-meter-silent', 'fm-ai-search-meter-silent', '2026-11-05', 1000651,
  'no cost_usage_daily row for product ai_search metric storage_gb in the last 2 days, from 2026-11-08 (three days for the deploy and the first hourly run)',
  'the all-in cost ledger shows no ai_search line and a fall in Workers AI cost after 2026-10-01 reads as a saving',
  'v_cost_all_in, v_cost_lines_month, the dashboard Money card');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, requires_container)
VALUES ('fm-ai-search-meter-silent', 1000651, 'qnfo-infra carries the aiSearch* datasets in COST_DATASETS',
  'read cost_usage_daily for product ai_search; when it is stale, the console.error line of costVendorTick names the failing dataset and its message',
  'SELECT ''1'' AS expected, CASE WHEN date(''now'') < ''2026-11-08'' THEN ''1'' WHEN EXISTS (SELECT 1 FROM cost_usage_daily WHERE vendor = ''cloudflare'' AND product = ''ai_search'' AND metric = ''storage_gb'' AND date >= date(''now'', ''-2 days'')) THEN ''1'' ELSE ''0'' END AS observed',
  'd1-query', 3, 'qnfo-infra', 24, 'active', 'failure-mode', 45000, 5, 0);
