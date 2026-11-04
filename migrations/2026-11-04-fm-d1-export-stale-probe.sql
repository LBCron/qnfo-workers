-- FM-D1-EXPORT-PROBE-1 (2026-11-04, charter pillar core; issue family: worker-observability probe-error, qnfo-fleet-control issue 7183).
-- The contract fm-d1-export-stale could never run: its probe built the database list with 8 chained SELECT ... UNION ALL terms and D1 refuses it
-- ("D1_ERROR: too many terms in compound SELECT", HTTP 400, code 7500; cloud_ops_events kind probe-error at 17:42Z and 20:35Z, every tick since it was written).
-- Same list through json_each. Run live against qnfo-audit before this file: the old text returns HTTP 400, the new text returns expected 0, observed 1, i.e. one of the
-- eight databases has no ok export in 9 days and the probe was hiding it. That finding is now visible as a failing contract instead of a probe-error.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = replace(verify_probe, 'SELECT value AS db FROM json_each(''["qnfo-audit","living-paper","q08-signal","personal-life","portfolio-state","qnfo-graph","ipatent-db","qnfo-cms"]'')', 'SELECT ''qnfo-audit'' AS db UNION ALL SELECT ''living-paper'' UNION ALL SELECT ''q08-signal'' UNION ALL SELECT ''personal-life'' UNION ALL SELECT ''portfolio-state'' UNION ALL SELECT ''qnfo-graph'' UNION ALL SELECT ''ipatent-db'' UNION ALL SELECT ''qnfo-cms''') WHERE class = 'fm-d1-export-stale';
-- spof-review: one probe text on one contract; no table, trigger or view changes.

UPDATE remediation_contracts
SET verify_probe = replace(verify_probe,
  'SELECT ''qnfo-audit'' AS db UNION ALL SELECT ''living-paper'' UNION ALL SELECT ''q08-signal'' UNION ALL SELECT ''personal-life'' UNION ALL SELECT ''portfolio-state'' UNION ALL SELECT ''qnfo-graph'' UNION ALL SELECT ''ipatent-db'' UNION ALL SELECT ''qnfo-cms''',
  'SELECT value AS db FROM json_each(''["qnfo-audit","living-paper","q08-signal","personal-life","portfolio-state","qnfo-graph","ipatent-db","qnfo-cms"]'')')
WHERE class = 'fm-d1-export-stale' AND verify_probe LIKE '%SELECT ''qnfo-audit'' AS db UNION ALL%';
