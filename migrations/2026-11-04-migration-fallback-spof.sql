-- MIGRATION-FALLBACK-1 (2026-11-04, SURVIVE-1, charter pillar: autonomy). Records the second migration runner on the SPOF row that had alternate_path NULL,
-- and the probe the chaos drill reads. alternate_tested_at is stamped by the drill only after migration_runs holds an ok row applied_by 'cf:migration-fallback'.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE spof_registry SET alternate_path = NULL WHERE component = 'GitHub Actions (CI, migration runner, runner-https probes)'; DELETE FROM spof_alternate_probes WHERE component = 'GitHub Actions (CI, migration runner, runner-https probes)'; DELETE FROM remediation_contracts WHERE class = 'fm-migration-fallback-unproven';
-- BACKUP: remediation_contracts
UPDATE spof_registry SET
  alternate_path = 'Migrations: qnfo-cloud-ops migration-fallback (MIGRATION-FALLBACK-1, every 10-minute tick) applies an opted-in, non-destructive qnfo-audit migration that has had no ok migration_runs row 45 minutes after it merged, reading the file from the GitHub contents API and writing through the AUDIT binding (applied_by cf:migration-fallback). Destructive and trigger files stay with the runner. Deploys: DEPLOY-DRIFT-CF-1. Still without a second runner: CI checks and runner-https probes. NOT COVERED: GitHub itself being down. The fallback and DEPLOY-DRIFT-CF-1 both read main from GitHub, so with GitHub down nothing new is applied or deployed automatically; the only paths then are the manual ones (direct Cloudflare API deploy, tested 2026-10-17, and D1 writes through the Cloudflare API). Running workers and crons keep going on the code already deployed.',
  reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE component = 'GitHub Actions (CI, migration runner, runner-https probes)';
INSERT OR IGNORE INTO spof_alternate_probes (component, probe_sql, exercise, window_note)
VALUES ('GitHub Actions (CI, migration runner, runner-https probes)',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM migration_runs WHERE applied_by = ''cf:migration-fallback'' AND status = ''ok'') > 0 THEN ''ok'' ELSE ''the Cloudflare migration fallback has never applied a migration'' END AS observed',
  NULL, 'ever: the fallback applied a real merged file (migrations/2026-11-04-migration-fallback-drill.sql) through the GitHub contents API and the AUDIT binding');
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to)
VALUES ('fm-migration-fallback-unproven', NULL,
  'SELECT ''1'' AS expected, CAST(MIN(1, COUNT(*)) AS TEXT) AS observed FROM migration_runs WHERE applied_by = ''cf:migration-fallback'' AND status = ''ok''',
  'd1-query', 3, 1, 'active', 'qnfo-cloud-ops 1.44.0 deployed', 'qnfo-cloud-ops migration-fallback applies migrations/2026-11-04-migration-fallback-drill.sql 45 minutes after merge; if it has not, read cloud_ops_events kind migration-fallback and the worker logs', 'qnfo-fleet-control');
