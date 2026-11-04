-- PLUS-LEDGER-STATUS-1 (2026-11-05, charter pillar autonomy; found while verifying roadmap items PLUS-3, PLUS-4 and PLUS-6 for the open-issue sweep, cluster A-roadmap-done).
-- DEFECT management-personas-plus (the product plussing task, hourly) fails with "D1_ERROR: CHECK constraint failed: status IN ('proposed','shipped','kept','reverted')" (fleet_runs 69871, 70006, 70013 on 2026-11-04,
-- first at 21:52Z, two hours after proposal #2152 left 'proposed'). plus_ledger kept the CHECK of the older ledger the PLUS-1 migration found (its CREATE TABLE IF NOT EXISTS changed nothing), but the steps write building,
-- deployed, rejected and reverting (pl-sync, pl-rejected, pl-deployed-mark, pl-outcome-result, pl-revert-sync). So the plus loop ran once, filed a proposal, and stops at the first transition: plus_ledger holds 2 rows,
-- both 'proposed', and plus_shipped_7d reads 0, so no product has ever been kept or reverted.
-- FIX rebuild plus_ledger with a CHECK that admits every status the steps and views use (proposed, building, deployed, rejected, shipped, kept, reverting, reverted), same columns, same ids, same index, and re-create the two views that read it.
-- SQLite cannot alter a CHECK, so the file copies the rows to a backup table first, drops the two views, builds plus_ledger_v2 from the backup, drops plus_ledger, renames the new table and recreates the index and views. Every statement is
-- safe to run again after a failure part way (IF NOT EXISTS, OR IGNORE, copy from the backup, DROP ... IF EXISTS), so a re-run converges.
-- PREDICTION: the next management-personas-plus run (hourly, :50) finishes ok; proposal #2152 moves to building when its change lands and the loop carries it to deployed, kept or reverted; plus_shipped_7d moves off 0 once a plus is deployed.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus_ledger
-- Rollback: INSERT OR REPLACE INTO plus_ledger (id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at) SELECT id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at FROM bak_20261105_plus_ledger; UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-plus-ledger-status-rejected'
-- CAUSE-MAPPED: registers no metric_registry row; the detector is a failure_modes row with a remediation contract.

CREATE TABLE IF NOT EXISTS bak_20261105_plus_ledger AS
SELECT id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at
FROM plus_ledger;

DROP VIEW IF EXISTS v_product_plus_due;
DROP VIEW IF EXISTS v_product_plus_debt;

CREATE TABLE IF NOT EXISTS plus_ledger_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_slug TEXT NOT NULL REFERENCES products(slug),
  plus TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'building', 'deployed', 'rejected', 'shipped', 'kept', 'reverting', 'reverted')),
  metric TEXT,
  predicted TEXT,
  measured TEXT,
  shipped_at TEXT,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  product TEXT,
  kind TEXT,
  title TEXT,
  evidence TEXT,
  predicted_outcome TEXT,
  issue_id INTEGER,
  pr_url TEXT,
  outcome TEXT,
  created_at TEXT
);

INSERT OR IGNORE INTO plus_ledger_v2 (id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at)
SELECT id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at
FROM bak_20261105_plus_ledger;

DROP TABLE IF EXISTS plus_ledger;

ALTER TABLE plus_ledger_v2 RENAME TO plus_ledger;

CREATE INDEX IF NOT EXISTS idx_plus_ledger_product ON plus_ledger(product_slug, status);

CREATE VIEW IF NOT EXISTS v_product_plus_debt AS SELECT p.slug, p.name, p.surface, p.owner_worker, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at, CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug;

CREATE VIEW IF NOT EXISTS v_product_plus_due AS
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

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('plus-ledger-status-rejected', 'the product plussing task fails because plus_ledger rejects a status its own steps write',
  'plus_ledger kept the CHECK (status IN proposed, shipped, kept, reverted) of an older ledger while the plus steps write building, deployed, rejected and reverting; the loop stopped at the first transition (2026-11-04T21:52Z)',
  'plus_ledger admits every status the steps and views use (migrations/2026-11-05-plus-ledger-status.sql); a new status is added to the CHECK in the same migration that first writes it',
  'the fm-plus-ledger-status-rejected contract reads the latest management-personas-plus run: its error mentions a CHECK constraint, expected 0',
  'fm-plus-ledger-status-rejected', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'the latest fleet_runs row of task management-personas-plus failed with an error naming a CHECK constraint',
  'plus_shipped_7d stays 0; plus_ledger never leaves proposed; no product is plussed, kept or reverted',
  'QNFO.PERSONAL, QNFO.REACH and QNFO.OPS product plussing (9 products)');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-plus-ledger-status-rejected', NULL, 'PLUS-LEDGER-STATUS-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COALESCE((SELECT 1 FROM fleet_runs WHERE id = (SELECT MAX(id) FROM fleet_runs WHERE task_id = ''management-personas-plus'') AND status = ''failed'' AND error LIKE ''%CHECK constraint%''), 0) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'A-roadmap-done (remediation sweep 2026-11-04)',
  'the plus loop is meant to carry a proposal through building, deployed and kept or reverted; the table constraint, not the steps, is what is wrong',
  'PLUS-LEDGER-STATUS-1: plus_ledger rebuilt so it admits building, deployed, rejected and reverting; failure mode and detector registered',
  'fleet_runs 69871, 70006, 70013 (management-personas-plus) failed on the CHECK constraint after proposal #2152 left proposed; sqlite_master shows the CHECK; the steps write building, deployed, rejected, reverting; plus_ledger held 2 rows, both proposed',
  'migration merged', 'plus_ledger (2 rows) and the two views that read it; the table is absent for milliseconds while it is renamed',
  'the Rollback header of migrations/2026-11-05-plus-ledger-status.sql restores the rows from bak_20261105_plus_ledger',
  'the product plussing loop can move a plus through every state it writes',
  'management-personas-plus runs ok each hour; plus_shipped_7d rises above 0 when the first plus is deployed', 'none', 'd1:qnfo-audit fleet_runs and sqlite_master reads; node:sqlite fixture with the live DDL in migrations/plus-ledger-status.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-LEDGER-STATUS-1:%');
