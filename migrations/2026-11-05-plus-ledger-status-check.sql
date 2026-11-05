-- PLUS-LEDGER-STATUS-CHECK-1 (2026-11-05, pillar personal and reach; closes CRON-FAULT-1 task-failed:management-personas-plus, agent_issues 1001846).
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-04 23:20Z)
--   The hourly workflow management-personas-plus has failed on every run since 2026-11-04T21:52Z (fleet_runs 69871, 70006, 70013, 70046; v_cron_faults consecutive_fails 4) with
--   "D1_ERROR: CHECK constraint failed: status IN ('proposed','shipped','kept','reverted')". The live plus_ledger was created by the product-catalog migration
--   (2026-10-29-plus-1-products.sql) with that four-value CHECK; the plussing migrations that followed (plussing-1 CREATE TABLE IF NOT EXISTS, which did not replace it, then plussing-3, -4, -6, -7)
--   write the values 'building', 'deployed', 'rejected' and 'reverting' (workflow steps pl-sync, pl-rejected, pl-deployed; the in-flight reading of v_product_plus_due counts 'building' and 'reverting').
--   Row 2 (proposal #2152, jobs) reached roadmap_proposals status building, pl-sync tried to write it, and the CHECK refused the whole step, so no plus can ever move past 'proposed':
--   the table holds 2 rows, both 'proposed', and the plussing metrics product_plus_rate_7d and plus_keep_rate_30d can never rise from a deployed plus.
--
-- WHAT THIS FILE DOES
--   Rebuilds plus_ledger with the same columns and a CHECK that lists every status the workflow writes ('proposed','building','deployed','rejected','reverting','reverted','kept','shipped').
--   SQLite cannot alter a CHECK, so: backup table first (2 rows), build plus_ledger_v2, copy by column name, drop the old table, rename, recreate the index. The two views that read the table are leaves
--   (nothing else reads them) and are dropped and recreated around the rename, because a rename validates every view. v_product_plus_debt now counts 'deployed' beside 'shipped' and 'kept' as
--   a delivered plus: a plus that is deployed, merged and verified live is shipped; before this change the status could not exist, so the view never saw one. v_product_plus_due is unchanged.
--   No trigger, no workflow edit: the workflow already writes the right values; the table refused them.
--   Prediction (decision_log): management-personas-plus runs ok on its next hourly tick (:50), v_cron_faults loses task-failed:management-personas-plus, and plus_ledger row 2 moves to 'building'.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus_ledger
-- Rollback: DROP VIEW IF EXISTS v_product_plus_debt; DROP VIEW IF EXISTS v_product_plus_due; DROP TABLE IF EXISTS plus_ledger; CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT NOT NULL REFERENCES products(slug), plus TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','shipped','kept','reverted')), metric TEXT, predicted TEXT, measured TEXT, shipped_at TEXT, decided_at TEXT NOT NULL DEFAULT (datetime('now')), product TEXT, kind TEXT, title TEXT, evidence TEXT, predicted_outcome TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT, created_at TEXT); INSERT INTO plus_ledger (id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at) SELECT id, product_slug, plus, CASE WHEN status IN ('proposed','shipped','kept','reverted') THEN status WHEN status = 'deployed' THEN 'shipped' ELSE 'proposed' END, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at FROM bak_20261105_plus_ledger; CREATE INDEX IF NOT EXISTS idx_plus_ledger_product ON plus_ledger(product_slug, status); CREATE VIEW IF NOT EXISTS v_product_plus_debt AS SELECT p.slug, p.name, p.surface, p.owner_worker, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at, CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug; CREATE VIEW IF NOT EXISTS v_product_plus_due AS SELECT p.product, p.host, p.program_code, p.last_plus_at, CAST((julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 AS INTEGER) AS hours_since_plus, p.plus_cadence_h, p.misses_in_row, p.pluses_since_simplify, CASE WHEN p.pluses_since_simplify >= 4 THEN 'simplify' ELSE 'plus' END AS next_kind, (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building','reverting')) AS in_flight FROM product_registry p WHERE p.state = 'active' AND (p.rest_until IS NULL OR p.rest_until <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) AND (julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 >= p.plus_cadence_h ORDER BY hours_since_plus DESC;
-- CAUSE-MAPPED: no metric is registered here; this rebuilds one table and two views.

CREATE TABLE IF NOT EXISTS bak_20261105_plus_ledger AS SELECT * FROM plus_ledger;

DROP VIEW IF EXISTS v_product_plus_debt;

DROP VIEW IF EXISTS v_product_plus_due;

DROP TABLE IF EXISTS plus_ledger_v2;

CREATE TABLE plus_ledger_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_slug TEXT NOT NULL REFERENCES products(slug),
  plus TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','building','deployed','rejected','reverting','reverted','kept','shipped')),
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

INSERT INTO plus_ledger_v2 (id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at)
SELECT id, product_slug, plus, status, metric, predicted, measured, shipped_at, decided_at, product, kind, title, evidence, predicted_outcome, issue_id, pr_url, outcome, created_at FROM plus_ledger;

DROP TABLE plus_ledger;

ALTER TABLE plus_ledger_v2 RENAME TO plus_ledger;

CREATE INDEX IF NOT EXISTS idx_plus_ledger_product ON plus_ledger(product_slug, status);

CREATE VIEW IF NOT EXISTS v_product_plus_debt AS
SELECT p.slug, p.name, p.surface, p.owner_worker,
  MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at,
  CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus
FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept','deployed')
GROUP BY p.slug;

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

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-loop-failures',
  'The plussing workflow writes the statuses building, deployed, rejected and reverting by design (plussing-3, -4, -6, -7); the live table kept the four-value CHECK of the earlier product-catalog design, so the table is wrong, not the workflow.',
  'PLUS-LEDGER-STATUS-CHECK-1: rebuild plus_ledger with a CHECK that lists every status the workflow writes; v_product_plus_debt counts deployed as delivered.',
  'qnfo-audit 2026-11-04 23:20Z: fleet_runs 69871/70006/70013/70046 failed with CHECK constraint failed: status IN (proposed,shipped,kept,reverted); plus_ledger holds 2 rows, both proposed (row 2 = proposal #2152, jobs); sqlite_master shows idx_plus_ledger_product and two leaf views reading the table; offline suite migrations/plus-ledger-status-check.test.mjs',
  'pending canonical migration; measured by fleet_runs for management-personas-plus and by plus_ledger status counts',
  'one 2-row table, one index, two leaf views; no trigger, no workflow edit',
  'Rollback line of migrations/2026-11-05-plus-ledger-status-check.sql restores the four-value CHECK from bak_20261105_plus_ledger',
  'a plus can move from proposed through building to deployed and kept in the ledger',
  'management-personas-plus: 4 failed runs in a row to ok on the next :50 tick; plus_ledger row 2 reaches building; product_plus_rate_7d can rise from a deployed plus',
  'unblocks the plussing loop for every product (jobs, companion-today, travel, shorts-channel, q08-home)',
  'node:sqlite suite migrations/plus-ledger-status-check.test.mjs (old CHECK refuses building, new accepts it, rows and ids kept, index and views back, idempotent re-run)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-LEDGER-STATUS-CHECK-1:%');
