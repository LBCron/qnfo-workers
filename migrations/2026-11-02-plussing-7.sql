-- PLUSSING-7 (2026-11-02, issue 1000800, charter pillar autonomy).
-- Restore producers for the enabled product_plus_rate_7d and plus_keep_rate_30d
-- metrics from their declared qnfo-audit.plus_ledger source.
-- PREDICTION: the next management-personas tick writes numeric values for both
-- metrics; with the current ledger, both are 0.000 and eligible to trigger.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_plussing7_workflow
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261102_plussing7_workflow WHERE id = 'management-personas'), version = version + 1 WHERE id = 'management-personas'

CREATE TABLE IF NOT EXISTS bak_20261102_plussing7_workflow AS
SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas';

UPDATE fleet_tasks
SET definition = json_insert(
      json_insert(
        json_insert(
          definition,
          '$.steps[#]',
          json('{"type":"sql","name":"pl-shipped-at","db":"AUDIT","sql":"UPDATE plus_ledger SET shipped_at = decided_at WHERE shipped_at IS NULL AND decided_at IS NOT NULL AND status IN (''deployed'', ''kept'', ''reverting'', ''reverted'')"}')
        ),
        '$.steps[#]',
        json('{"type":"sql","name":"pl-product-plus-rate","db":"AUDIT","sql":"UPDATE metric_registry SET last_value = CASE WHEN (SELECT COUNT(*) FROM product_registry WHERE state = ''active'') = 0 THEN NULL ELSE CAST(ROUND(1.0 * (SELECT COUNT(*) FROM plus_ledger WHERE shipped_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'')) / (SELECT COUNT(*) FROM product_registry WHERE state = ''active''), 3) AS TEXT) END, last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = CASE WHEN (SELECT COUNT(*) FROM product_registry WHERE state = ''active'') = 0 THEN ''UNMEASURED'' ELSE ''MEASURED'' END WHERE metric = ''product_plus_rate_7d''"}')
      ),
      '$.steps[#]',
      json('{"type":"sql","name":"pl-plus-keep-rate","db":"AUDIT","sql":"UPDATE metric_registry SET last_value = CAST(ROUND(1.0 * (SELECT COUNT(*) FROM plus_ledger WHERE status = ''kept'' AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')) / MAX(1, (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''kept'', ''reverted'') AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days''))), 3) AS TEXT), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric = ''plus_keep_rate_30d''"}')
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND instr(definition, '"pl-shipped-at"') = 0;

INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
  ('program-manager-plus-metrics-measured', 'migrations/2026-11-02-plussing-7.sql (PLUSSING-7)',
   'management-personas hourly workflow, product_registry, plus_ledger',
   0.5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'the existing manager tick records verified shipment timestamps and computes product_plus_rate_7d and plus_keep_rate_30d from plus_ledger');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'management-personas (PLUSSING-7)',
  'enabled product-plus metrics should be refreshed from their declared plus_ledger source so they can be evaluated by their existing triggers',
  'append idempotent management-personas steps to timestamp verified shipments and calculate both product-plus rates from plus_ledger',
  'live qnfo-audit read found seed strings for both metrics and a manager workflow that refreshed only the newer plus_shipped_7d and plus_kept_share_30d metrics',
  'pending',
  'management-personas workflow and the two plus_ledger-backed metric values',
  'restore management-personas from bak_20261102_plussing7_workflow',
  'program-manager-plus-metrics-measured',
  'the next manager tick writes numeric values for both metrics; no product denominator yields UNMEASURED for the shipment rate, and an empty keep window yields a measured zero',
  'enables existing product-plus triggers to act on computed delivery and retention data',
  'SQLite migration replay, empty-window values, shipment timestamps, and populated rate calculations'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'management-personas (PLUSSING-7)'
    AND action = 'append idempotent management-personas steps to timestamp verified shipments and calculate both product-plus rates from plus_ledger'
);
