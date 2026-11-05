-- CRON-FAULT-FAMILY-1 (2026-11-05, charter pillar autonomy; breach cluster doctor-probes; agent_issues 1001842, 1001843, 1001844, 1001845, 1001846 as the measured cases).
-- WHAT WAS MEASURED (qnfo-audit, read-only, 2026-11-04 22:40-23:50Z)
--  1. management-personas-plus fails its run on the step pl-sync: it sets plus_ledger.status to the status of the roadmap proposal ('building', 'deployed', 'rejected'), and pl-outcome-result sets 'reverting',
--     but the live table carries the CHECK of an older design (status IN ('proposed','shipped','kept','reverted')). migrations/2026-10-29-plussing-1.sql declared the table without a CHECK and used
--     CREATE TABLE IF NOT EXISTS, so the older table won. The first proposal to reach 'building' (roadmap proposal 2152, jobs, plus_ledger row 2) stopped the run at 21:52:46Z and every run since:
--     "CHECK constraint failed: status IN ('proposed','shipped','kept','reverted')" (fleet_runs 22:34, 22:38, 22:50). The plus program therefore moves nothing past 'proposed' (plus_shipped_7d 0,
--     product_plus_rate_7d 0, plus_keep_rate_30d 0).
--  2. management-personas-c fails with "close-while-contract-fails": its step mi-unmeasured-close is one UPDATE agent_issues SET status = 'closed' over every METRIC-UNMEASURED-1 issue whose owner has
--     no unmeasured metric left, and the BEFORE UPDATE trigger issue_close_evidence_required (CLOSE-BINDS-TO-PROBE-1) aborts the whole statement when ONE of those issues has a contract whose
--     last_verdict is fail / probe-error / vacuous (issue 1000745 qnfo-youtube-shorts read fail at 21:52Z). The abort fails the run, so the 11 steps after it never run (the 'mgmt-personas-c stall').
--     The same statement shape closes issues in management-personas (rc-close, rm-deployed-close) and management-personas-b (recovered-close, twin-close).
--  3. fleet_crons management-personas-b-hourly '42 * * * *', management-personas-c-hourly '49 * * * *' and staff-roster-hourly '52 * * * *' fire off the 5-minute grid. The dispatcher ticks every
--     5 minutes, so they have always run at :45, :50 and :55; the faults (cron-watch CRON-FAULT-1: "fires off the 5-minute grid") are about the written minute only.
-- WHAT THIS CHANGES (data only; no worker, trigger or cron of a worker)
--  1. plus_ledger is rebuilt with the CHECK widened to every status the plussing steps write (proposed, building, deployed, shipped, kept, reverting, reverted, rejected). Rows, ids and the
--     sequence are kept (2 rows, seq 2); the index and the two views that read it are put back from the live text. Backup: bak_20261105_plus_ledger.
--  2. the five bulk-close steps above gain "AND NOT EXISTS (<the issue's own contract reads a failing verdict>)", the exact condition of the trigger, so an issue whose own probe still fails stays
--     open for its contract to close and the rest of the batch closes. Backup: bak_20261105_personas_close_steps.
--  3. the three crons move to :45, :50 and :55 (the minutes they already ran at).
-- PREDICTION (decision_log): management-personas-plus finishes its next run (fleet_runs status ok) and plus_ledger row 2 reads building or deployed after the step; management-personas-c finishes
--  its next run with a failing-contract issue in the batch; CRON-FAULT-1 issues 1001842-1001846 close on their loop's next clean read. Falsifier: fleet_runs for either task fails again with the
--  same message, or cron-watch files a schedule fault for a minute that is a multiple of 5.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus_ledger
-- Rollback: UPDATE fleet_crons SET cron_expr = '42 * * * *' WHERE name = 'management-personas-b-hourly'; UPDATE fleet_crons SET cron_expr = '49 * * * *' WHERE name = 'management-personas-c-hourly'; UPDATE fleet_crons SET cron_expr = '52 * * * *' WHERE name = 'staff-roster-hourly'; UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261105_personas_close_steps b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id IN (SELECT id FROM bak_20261105_personas_close_steps); the plus_ledger CHECK only gained values, its rows are in bak_20261105_plus_ledger and a table with the older CHECK is not needed by any step
-- CAUSE-MAPPED: registers no metric_registry row.

-- 1. plus_ledger: same columns, the CHECK widened
CREATE TABLE IF NOT EXISTS bak_20261105_plus_ledger AS SELECT * FROM plus_ledger;

CREATE TABLE plus_ledger_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT NOT NULL REFERENCES products(slug), plus TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','building','deployed','shipped','kept','reverting','reverted','rejected')), metric TEXT, predicted TEXT, measured TEXT, shipped_at TEXT, decided_at TEXT NOT NULL DEFAULT (datetime('now')), product TEXT, kind TEXT, title TEXT, evidence TEXT, predicted_outcome TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT, created_at TEXT);

INSERT INTO plus_ledger_v2 (id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at) SELECT id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at FROM plus_ledger;

DROP VIEW IF EXISTS v_product_plus_debt;

DROP VIEW IF EXISTS v_product_plus_due;

DROP TABLE plus_ledger;

ALTER TABLE plus_ledger_v2 RENAME TO plus_ledger;

CREATE INDEX idx_plus_ledger_product ON plus_ledger(product_slug, status);

CREATE VIEW v_product_plus_debt AS SELECT p.slug, p.name, p.surface, p.owner_worker, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at, CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug;

CREATE VIEW v_product_plus_due AS
SELECT p.product, p.host, p.program_code, p.last_plus_at,
  CAST((julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 AS INTEGER) AS hours_since_plus,
  p.plus_cadence_h, p.misses_in_row, p.pluses_since_simplify,
  CASE WHEN p.pluses_since_simplify >= 4 THEN 'simplify' ELSE 'plus' END AS next_kind,
  (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building','reverting')) AS in_flight
FROM product_registry p
WHERE p.state = 'active'
  AND (p.rest_until IS NULL OR p.rest_until <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  AND (julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 >= p.plus_cadence_h
ORDER BY hours_since_plus DESC;

-- 2. the bulk-close steps skip an issue whose own contract still reads a failing verdict (the trigger's condition)
CREATE TABLE IF NOT EXISTS bak_20261105_personas_close_steps AS SELECT id, definition, version FROM fleet_tasks WHERE id IN ('management-personas', 'management-personas-b', 'management-personas-c');

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT key FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'rc-close') || '].sql', (SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'rc-close') || ' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = agent_issues.id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'rc-close' AND instr(json_extract(value, '$.sql'), 'UPDATE agent_issues SET status = ''closed''') = 1 AND instr(json_extract(value, '$.sql'), 'FROM remediation_contracts c WHERE c.issue_id = agent_issues.id') = 0 AND substr(json_extract(value, '$.sql'), -1) NOT IN (';', ' ', char(10)));

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT key FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'rm-deployed-close') || '].sql', (SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'rm-deployed-close') || ' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = agent_issues.id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'rm-deployed-close' AND instr(json_extract(value, '$.sql'), 'UPDATE agent_issues SET status = ''closed''') = 1 AND instr(json_extract(value, '$.sql'), 'FROM remediation_contracts c WHERE c.issue_id = agent_issues.id') = 0 AND substr(json_extract(value, '$.sql'), -1) NOT IN (';', ' ', char(10)));

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT key FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'recovered-close') || '].sql', (SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'recovered-close') || ' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = agent_issues.id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-b'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'recovered-close' AND instr(json_extract(value, '$.sql'), 'UPDATE agent_issues SET status = ''closed''') = 1 AND instr(json_extract(value, '$.sql'), 'FROM remediation_contracts c WHERE c.issue_id = agent_issues.id') = 0 AND substr(json_extract(value, '$.sql'), -1) NOT IN (';', ' ', char(10)));

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT key FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'twin-close') || '].sql', (SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'twin-close') || ' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = agent_issues.id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-b'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'twin-close' AND instr(json_extract(value, '$.sql'), 'UPDATE agent_issues SET status = ''closed''') = 1 AND instr(json_extract(value, '$.sql'), 'FROM remediation_contracts c WHERE c.issue_id = agent_issues.id') = 0 AND substr(json_extract(value, '$.sql'), -1) NOT IN (';', ' ', char(10)));

UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT key FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'mi-unmeasured-close') || '].sql', (SELECT json_extract(value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'mi-unmeasured-close') || ' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = agent_issues.id AND c.status IN (''active'', ''holding'') AND COALESCE(c.last_verdict, '''') IN (''fail'', ''vacuous-probe-result'', ''probe-error'', ''probe-not-machine-executable'', ''probe-same-account-host''))'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c'
  AND EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') WHERE json_extract(value, '$.name') = 'mi-unmeasured-close' AND instr(json_extract(value, '$.sql'), 'UPDATE agent_issues SET status = ''closed''') = 1 AND instr(json_extract(value, '$.sql'), 'FROM remediation_contracts c WHERE c.issue_id = agent_issues.id') = 0 AND substr(json_extract(value, '$.sql'), -1) NOT IN (';', ' ', char(10)));

-- 3. the three crons move to the 5-minute grid, at the minute the dispatcher already ran them
UPDATE fleet_crons SET cron_expr = '45 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE name = 'management-personas-b-hourly' AND cron_expr = '42 * * * *';

UPDATE fleet_crons SET cron_expr = '50 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE name = 'management-personas-c-hourly' AND cron_expr = '49 * * * *';

UPDATE fleet_crons SET cron_expr = '55 * * * *', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE name = 'staff-roster-hourly' AND cron_expr = '52 * * * *';

-- detectors: each reads the state this file repairs, so a relapse is seen within the hour
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('plus-ledger-check-rejects-steps',
  'the plussing steps write a plus_ledger status the table CHECK refuses, so management-personas-plus fails every run',
  'plus_ledger was created by an older design with CHECK (status IN (proposed, shipped, kept, reverted)); the plussing migrations declared the table without a CHECK and used CREATE TABLE IF NOT EXISTS, so the older table won, and pl-sync/pl-outcome-result write building, deployed, rejected and reverting',
  'CRON-FAULT-FAMILY-1 rebuilds the table with the CHECK widened to every status the steps write',
  'fm-plus-ledger-check-rejects-steps: 1 when the plus_ledger CHECK does not allow building, deployed, reverting and rejected, expected 0', 'fm-plus-ledger-check-rejects-steps', '2026-11-05', 1001846,
  'management-personas-plus fails with CHECK constraint failed: status IN (...)', 'product plus program stalls at proposed; plus_shipped_7d, product_plus_rate_7d and plus_keep_rate_30d read 0', 'product plussing of every active product'),
 ('personas-bulk-close-aborted-by-failing-contract',
  'a bulk UPDATE agent_issues SET status = closed in a management-personas step aborts the run when one issue in the batch has a failing contract',
  'issue_close_evidence_required (CLOSE-BINDS-TO-PROBE-1) raises ABORT for the whole statement when any closed row has an active or holding contract with a failing last_verdict; the steps did not exclude those rows',
  'CRON-FAULT-FAMILY-1 adds the trigger''s own condition to rc-close, rm-deployed-close, recovered-close, twin-close and mi-unmeasured-close',
  'fm-personas-bulk-close-aborted-by-failing-contract: the number of those five steps without the exclusion, expected 0', 'fm-personas-bulk-close-aborted-by-failing-contract', '2026-11-05', 1001845,
  'management-personas-c fails with close-while-contract-fails', 'the run ends before its remaining steps (lever-mark, briefs); metric lever reviews repeat', 'the three management-personas tasks'),
 ('fleet-cron-off-grid',
  'an enabled fleet_crons row fires on a minute that is not a multiple of 5',
  'three migrations inserted crons at :42, :49 and :52; nothing checked the minute of a fleet_crons row at review time (cron_rate_guard.py reads wrangler.toml only)',
  'CRON-FAULT-FAMILY-1 moves them to :45, :50 and :55; apply_migrations.py --check refuses a new off-grid fleet_crons literal',
  'fm-fleet-cron-off-grid: the number of enabled fleet_crons rows whose minute field is a number that is not a multiple of 5, expected 0', 'fm-fleet-cron-off-grid', '2026-11-05', 1001842,
  'cron-watch files CRON-FAULT-1 schedule:fleet-exec:<name>', 'a CRON-FAULT-1 issue per off-grid cron', 'fleet-exec crons');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-plus-ledger-check-rejects-steps', NULL, 'CRON-FAULT-FAMILY-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN instr((SELECT sql FROM sqlite_master WHERE type = ''table'' AND name = ''plus_ledger''), ''''''building'''''') > 0 AND instr((SELECT sql FROM sqlite_master WHERE type = ''table'' AND name = ''plus_ledger''), ''''''deployed'''''') > 0 AND instr((SELECT sql FROM sqlite_master WHERE type = ''table'' AND name = ''plus_ledger''), ''''''reverting'''''') > 0 AND instr((SELECT sql FROM sqlite_master WHERE type = ''table'' AND name = ''plus_ledger''), ''''''rejected'''''') > 0 THEN 0 ELSE 1 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0),
 ('fm-personas-bulk-close-aborted-by-failing-contract', NULL, 'CRON-FAULT-FAMILY-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM fleet_tasks t, json_each(t.definition, ''$.steps'') j WHERE t.id IN (''management-personas'', ''management-personas-b'', ''management-personas-c'') AND json_extract(j.value, ''$.name'') IN (''rc-close'', ''rm-deployed-close'', ''recovered-close'', ''twin-close'', ''mi-unmeasured-close'') AND instr(json_extract(j.value, ''$.sql''), ''FROM remediation_contracts c WHERE c.issue_id = agent_issues.id'') = 0',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0),
 ('fm-fleet-cron-off-grid', NULL, 'CRON-FAULT-FAMILY-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM fleet_crons WHERE enabled = 1 AND substr(cron_expr, 1, instr(cron_expr || '' '', '' '') - 1) NOT GLOB ''*[^0-9]*'' AND length(substr(cron_expr, 1, instr(cron_expr || '' '', '' '') - 1)) > 0 AND CAST(substr(cron_expr, 1, instr(cron_expr || '' '', '' '') - 1) AS INTEGER) % 5 <> 0',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-doctor-probes-families-ops',
  'a stalled hourly workflow is repaired at the statement that fails, not by retrying the run',
  'CRON-FAULT-FAMILY-1: plus_ledger CHECK widened to the statuses the plussing steps write; five bulk-close steps skip issues whose own contract fails; three fleet_crons moved to the 5-minute grid',
  'fleet_runs 2026-11-04 21:52-22:50Z: management-personas-plus failed 4 of 4 runs with CHECK constraint failed; management-personas-c failed with close-while-contract-fails; v_cron_faults listed three schedule faults',
  'the next hourly runs of management-personas-plus and management-personas-c finish ok; CRON-FAULT-1 issues 1001842-1001846 close on their loop',
  'plus_ledger (2 rows), fleet_tasks management-personas, -b, -c (five steps), fleet_crons (three rows)',
  'the Rollback line of this file; bak_20261105_plus_ledger and bak_20261105_personas_close_steps hold the previous rows and definitions',
  'the product plus program can move a plus past proposed; the persona close steps survive one issue with a failing contract',
  'fleet_runs for management-personas-plus and management-personas-c read ok at the next :50 run; plus_ledger row 2 reads building or deployed',
  'none', 'node migrations/families-ops-a.test.mjs (SQLite replay of the live schemas and step texts)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'CRON-FAULT-FAMILY-1:%');
