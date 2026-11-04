-- MIGRATION-FALLBACK-1 drill (2026-11-04, SURVIVE-1, charter pillar: autonomy). A declared skip for the GitHub Actions runner on purpose: only
-- qnfo-cloud-ops migration-fallback (1.44.0) applies this file, 45 minutes after it merged, from the GitHub contents API through the AUDIT binding.
-- The run is the real fallback path end to end; migration_runs gets applied_by 'cf:migration-fallback' and the spof probe below reads it.
-- APPLY-BY: none (cf-fallback drill: applied only by the Cloudflare fallback, never by the Actions runner)
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS migration_fallback_drill;
CREATE TABLE IF NOT EXISTS migration_fallback_drill (id INTEGER PRIMARY KEY, note TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
INSERT OR IGNORE INTO migration_fallback_drill (id, note) VALUES (1, 'applied by the Cloudflare migration fallback, not by GitHub Actions');
