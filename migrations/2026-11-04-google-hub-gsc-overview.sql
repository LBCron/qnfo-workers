-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title LIKE 'GOOGLE-HUB-1:%';
-- GOOGLE-HUB-1 (pillar reach; owner 2026-11-04: Cloudflare, GitHub and Google tightly integrated, free quotas used, no OAuth chores).
-- Measured today: GA4 ingest ok daily (137 rows 2026-11-03), GSC ingest ok daily (16 rows 2026-11-01) through the service-account key,
-- /api/ga4/overview and /analytics live, but /api/gsc and /api/gsc/overview return 404: the owner cannot see search results anywhere.
-- CAUSE-MAPPED: no metric is registered here; the issues below carry their own closing probes.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'GOOGLE-HUB-1: Search Console overview page and API (/search, /api/gsc/overview) so search results are visible',
  'Pillar reach. GSC ingest already runs daily (gscIngest, sc-domain:qnfo.org, service account ga4-reader) but only writes reach_signals; there is no reader. Mirror ga4OverviewData/ga4Html in qnfo-fleet-dashboard/worker.js: a gscOverviewData(env) that calls searchAnalytics.query live (28 complete days ending today-3, previous 28 for deltas) for totals, daily series, top queries, top pages, countries, devices and search appearance, plus sitemaps.list and the sites.list permission level; cache 5 min in-isolate; a failed panel is null with its reason, never zero. Route GET /search and /api/gsc/overview (open, read-only), nav entry next to analytics at the pages list near line 2355, and a Cloudflare-side join: top pages with their GA4 page views. Bump VERSION (minor: new page). Done when the runtime-probe below passes.
code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js
code-anchor: function ga4Delta(ratio) {
runtime-probe: {"url": "https://fleet.qnfo.org/api/gsc/overview", "status": 200, "contains": "gsc-overview/v1"}',
  'session:GOOGLE-HUB-1', 'reach', 'high', 'open', CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'GOOGLE-HUB-1: Search Console overview%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'GOOGLE-HUB-1: adopt the unused free Google tiers behind the existing service account (docs/GOOGLE-HUB-INTEGRATION.md)',
  'Pillar reach. Follow the table in docs/GOOGLE-HUB-INTEGRATION.md one service per change, read-only first, each with a metric or ledger row: Search Console sitemaps and URL Inspection (2000 inspections/day free), PageSpeed Insights API + CrUX API (key-free quota), GA4 BigQuery export to the free BigQuery sandbox, Indexing-friendly sitemap submission, Gemini free tier as a qnfo-ai fallback leg, Google Cloud Storage 5 GB always-free as an R2 backup mirror. Each lands via the code loop with a code-task line; prose is not the record. Done when docs/GOOGLE-HUB-INTEGRATION.md rows 1-3 show status live with a ledger event kind each.',
  'session:GOOGLE-HUB-1', 'reach', 'medium', 'open', CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'GOOGLE-HUB-1: adopt the unused free Google tiers%');
