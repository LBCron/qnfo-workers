-- LEDGER-TRUTH-E-1 (2026-11-05, charter pillar autonomy; GitHub QNFO/qnfo-workers#5444, #5438, #5434; agent_issues 1000811, 1000793, 1000706; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_ledger_truth
-- Rollback: DELETE FROM migration_runs WHERE applied_by = 'ci:superseded-record' AND file IN ('migrations/2026-10-13-fleet-journeys.sql', 'migrations/2026-11-02-management-personas-metric-intake.sql') AND status = 'superseded'; UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_e_ledger_truth b WHERE b.k = remediation_contracts.class AND b.kind = 'contract') WHERE class IN ('issue-1000811', 'issue-1000793') AND EXISTS (SELECT 1 FROM bak_20261105_e_ledger_truth b WHERE b.k = remediation_contracts.class AND b.kind = 'contract'); DELETE FROM metric_breach_cause WHERE note = 'LEDGER-TRUTH-E-1';
-- CAUSE-MAPPED: no metric is registered here; the last part maps nine existing metrics to a cause (metric_breach_cause).
--
-- Three issues of one family: a record that says "failed" or "not done" for a thing that is done, read against the live ledgers on 2026-11-05 00:30 UTC.
--
-- (1) 1000811 LOOP-BREAKER-1 / MIGRATION-UNAPPLIED-1. Its contract probe counts files whose newest CI error is later than their newest ok or superseded row. Read live: three files.
--   * migrations/2026-11-02-management-personas-metric-intake.sql: ok as migration_runs 1050 (2026-11-02 17:41Z, sha256 458757ac); PR 6898 (63c00589) edited the merged file, the runner replayed the
--     edited content as migration_runs 1121 (2026-11-04 15:55Z, sha256 880f5283, "statement 4: SQL code did not contain a statement"); PR 7124 (f811e178) restored the file to the content that applied ok.
--     The restored content is already applied (apply_migrations.py: already_applied), so no newer run is ever written and the old error row outlives its cause.
--   * migrations/2026-10-13-fleet-journeys.sql: ok 2026-10-14 03:53:00Z, then an error row 03:54:20Z written by a run on an older commit replaying the content that had failed (MIGRATION-STALE-SHA-1,
--     scripts/apply_migrations.py, the same case that rule now records as `superseded` instead of an error row).
--   * migrations/2026-10-18-issue-sla-window-retry.sql: recorded `superseded` on 2026-10-19 by migrations/2026-10-19-resolve-migration-superseded.sql (applied_by RESOLVE-ALL-OPEN-1), but the probe filters
--     rows by `applied_by LIKE 'ci:%'` on the ok side too, so that superseded row is invisible to it. That filter is the measurement defect: an error is a CI error, but the record that supersedes it may come
--     from any applier, exactly as scripts/remediation_consumer.py migrations_sweep counts it (status IN ok, superseded, any applier).
--   The fix records the two supersessions that have no row (the precedent is the 2026-10-19 file) and lets the probe see a superseding row from any applier.
--   Nothing is hidden: the three error rows stay in migration_runs.
--
-- (2) 1000793 MIGRATION-APPLY-FAILED-1 for migrations/2026-10-29-plus-1-products.sql. The failure ("table products has no column named key") was fixed by PR 5487, which moved the registry to its own
--   table product_plus_registry; migration_runs shows the file ok on 2026-11-01 08:36:52Z (its issue_triage row already carries that evidence). The contract probe still asks the OLD repository-catalog
--   table `products` for a `key` column, which that table does not have and the file never creates, so it can never pass. The replacement reads the table the file creates.
--
-- (3) 1000706 METRIC-CAUSE-AT-REGISTRATION-1. https://fleet.qnfo.org/api/triage read 2026-11-05: `unmapped` lists nine breaching metrics with no metric_breach_cause row (down from 32). Each is mapped to the
--   cause whose lever its own trigger names, with the same causes the fleet already uses (BREACH-UNMAPPED-3 precedent). INSERT OR IGNORE: a mapping a session made with better evidence is kept.
--   The second half of the issue (a metric registered later is mapped at birth) is enforced by migrations/metric-family-cluster-b.test.mjs (METRIC-CAUSE-AT-REGISTRATION-1) for every migration that
--   registers a metric; a metric registered by worker code, outside a migration, stays visible as unmapped on /api/triage and breaches_unmapped, never guessed.

CREATE TABLE IF NOT EXISTS bak_20261105_e_ledger_truth (kind TEXT NOT NULL, k TEXT NOT NULL, verify_probe TEXT, PRIMARY KEY (kind, k));
INSERT OR IGNORE INTO bak_20261105_e_ledger_truth (kind, k, verify_probe)
SELECT 'contract', class, verify_probe FROM remediation_contracts WHERE class IN ('issue-1000811', 'issue-1000793');

-- (1) supersession records. The first requires the ok row it names; the second requires its ok row to be older than the replayed error, as read.
INSERT INTO migration_runs (file, sha256, commit_sha, db, status, statements, error, applied_by)
SELECT 'migrations/2026-11-02-management-personas-metric-intake.sql', 'superseded', NULL, 'qnfo-audit', 'superseded', 0,
  'superseded: the error run migration_runs 1121 (sha256 880f5283, commit 63c00589) executed content that PR 6898 clobbered, and PR 7124 (f811e178) restored the file to the content that applied ok as migration_runs 1050 (sha256 458757ac), which is already_applied and is never replayed',
  'ci:superseded-record'
WHERE EXISTS (SELECT 1 FROM migration_runs WHERE id = 1050 AND file = 'migrations/2026-11-02-management-personas-metric-intake.sql' AND status = 'ok')
  AND NOT EXISTS (SELECT 1 FROM migration_runs WHERE file = 'migrations/2026-11-02-management-personas-metric-intake.sql' AND status = 'superseded');

INSERT INTO migration_runs (file, sha256, commit_sha, db, status, statements, error, applied_by)
SELECT 'migrations/2026-10-13-fleet-journeys.sql', 'superseded', NULL, 'qnfo-audit', 'superseded', 0,
  'superseded: the error row at 2026-10-14 03:54:20Z is a replay of content that had already failed by a run on an older commit, after a newer content of this file applied ok at 03:53:00Z (MIGRATION-STALE-SHA-1: such a replay is now skipped as superseded and writes no error row)',
  'ci:superseded-record'
WHERE EXISTS (SELECT 1 FROM migration_runs WHERE file = 'migrations/2026-10-13-fleet-journeys.sql' AND status = 'ok')
  AND NOT EXISTS (SELECT 1 FROM migration_runs WHERE file = 'migrations/2026-10-13-fleet-journeys.sql' AND status = 'superseded');

-- the probe: a superseding or ok row from ANY applier counts (the error side stays CI-only).
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM (SELECT f.file AS file, (SELECT MAX(o.applied_at) FROM migration_runs o WHERE o.file = f.file AND o.status IN (''ok'', ''superseded'')) AS ok_at, f.err_at AS err_at FROM (SELECT file, MAX(applied_at) AS err_at FROM migration_runs WHERE status = ''error'' AND applied_by LIKE ''ci:%'' GROUP BY file) f) WHERE ok_at IS NULL OR err_at > ok_at',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000811' AND issue_id = 1000811;

-- (2) the probe reads the table the file creates.
UPDATE remediation_contracts
SET verify_probe = 'WITH info AS (SELECT (SELECT COUNT(*) FROM pragma_table_info(''product_plus_registry'') WHERE name = ''key'') AS has_key, (SELECT COUNT(*) FROM product_plus_registry) AS n) SELECT ''product_plus_registry has the key column and at least 6 rows'' AS expected, CASE WHEN has_key = 1 AND n >= 6 THEN ''product_plus_registry has the key column and at least 6 rows'' WHEN has_key = 0 THEN ''product_plus_registry has no key column'' ELSE ''product_plus_registry has only '' || n || '' rows'' END AS observed FROM info',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000793' AND issue_id = 1000793;

-- (3) the nine unmapped breaching metrics, read from /api/triage on 2026-11-05.
INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('cf_obs_reopen_churn_24h', 'issue-backlog', 'LEDGER-TRUTH-E-1'),
 ('contracts_unexecutable_open', 'measurement', 'LEDGER-TRUTH-E-1'),
 ('idea_topic_concentration_30d', 'publishing', 'LEDGER-TRUTH-E-1'),
 ('improvement_rate_7d', 'issue-backlog', 'LEDGER-TRUTH-E-1'),
 ('metrics_on_probation_overdue', 'measurement', 'LEDGER-TRUTH-E-1'),
 ('orphaned_leases', 'structure', 'LEDGER-TRUTH-E-1'),
 ('secrets_in_repo', 'structure', 'LEDGER-TRUTH-E-1'),
 ('worker_count_disagreement', 'structure', 'LEDGER-TRUTH-E-1'),
 ('workers_ai_attribution_coverage_pct', 'measurement', 'LEDGER-TRUTH-E-1');
UPDATE metric_registry SET last_value = CAST((SELECT COALESCE(SUM(breaches), 0) FROM v_breach_by_cause WHERE cause_key = 'unmapped') AS TEXT),
  last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE metric = 'breaches_unmapped';
