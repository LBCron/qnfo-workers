-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-plus-registry-slug-not-in-catalog'; DELETE FROM failure_modes WHERE fm_key = 'plus-registry-slug-not-in-catalog'; DELETE FROM products WHERE slug = 'papers' AND NOT EXISTS (SELECT 1 FROM plus_ledger WHERE product_slug = 'papers')
-- The Rollback leaves the decision row: decision_log is append-only.
-- BACKUP: products
-- PLUS-REGISTRY-SLUG-1 (2026-11-05, charter pillar autonomy; GitHub 6876 / agent_issues 1001621 ROOT-CAUSE-1: CRON-FAULT-1 keeps recurring; the task-failed:management-personas-plus fault, agent_issues 1001846).
-- plus_ledger.product_slug references products(slug) and D1 enforces foreign keys (PRAGMA foreign_keys = 1, read 2026-11-05T00:25Z). The plus loop writes product_slug = the product_registry key
-- (step pl-ledger: substr(request_instance, ...) of roadmap-<program>-plus-<product>-...). Eight of the nine active registry products have a catalog row of the same slug; the registry slug
-- "papers" has none because the catalog holds "papers-hub" for the same surface (papers.qnfo.org, qnfo-gateway). The first plus proposed for papers therefore fails pl-ledger with
-- FOREIGN KEY constraint failed, and since the plus steps are one workflow the whole management-personas-plus task fails again and cron-watch files the same task-failed CRON-FAULT-1
-- the 24-hourly plus loop was just unblocked from (PLUS-LEDGER-STATUS-CHECK-1, PR 7361 and its sibling, which fixed the CHECK on the status column only). Every active product is asked for a
-- plus once a day, so this is a matter of hours, not weeks.
-- Repair: a catalog row for papers that mirrors papers-hub (copied from it, so name, surface, owner and path are the live ones). papers-hub stays: nothing reads the catalog except the plus
-- workflow. The detector fm-plus-registry-slug-not-in-catalog counts active registry products with no catalog row (expected 0) so the next registry slug that drifts is caught within the hour.
-- Prediction: 1 active registry product is missing from the catalog before, 0 after; no management-personas-plus run fails with FOREIGN KEY constraint failed. Falsified if a run does.
-- CAUSE-MAPPED: no metric is registered here.

INSERT OR IGNORE INTO products (slug, name, surface, owner_worker, repo, path)
SELECT 'papers', name, surface, owner_worker, repo, path FROM products
 WHERE slug = 'papers-hub' AND NOT EXISTS (SELECT 1 FROM products WHERE slug = 'papers');

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('plus-registry-slug-not-in-catalog',
   'an active product_registry slug has no products row, so the first plus proposed for it fails the plus_ledger foreign key and the whole plus workflow fails',
   'product_registry (the plus loop identity) and products (the catalog and plus_ledger.product_slug identity) are maintained by different migrations; the registry holds papers where the catalog holds papers-hub',
   'PLUS-REGISTRY-SLUG-1: a catalog row for papers; fm-plus-registry-slug-not-in-catalog counts active registry products with no catalog row',
   'd1-query count of active product_registry rows whose product is not a products.slug',
   'fm-plus-registry-slug-not-in-catalog', '2026-11-05', 1001621,
   'a registry product is added or renamed without the matching products row',
   'management-personas-plus fails with FOREIGN KEY constraint failed on the pl-ledger insert and cron-watch files task-failed:management-personas-plus',
   'the product plus loop for every product, the plus metrics and the CRON-FAULT-1 family');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to) VALUES
  ('fm-plus-registry-slug-not-in-catalog', NULL,
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM product_registry r WHERE r.state = ''active'' AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = r.product)) AS TEXT) AS observed',
   'd1-query', 3, 1, 'active', 'PLUS-REGISTRY-SLUG-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a foreign key that D1 enforces turns an identity mismatch between two tables into a whole-workflow failure at the first row that hits it; the catalog is the side to complete because nothing but the plus workflow reads it',
  'PLUS-REGISTRY-SLUG-1: a products row for papers copied from papers-hub; detector fm-plus-registry-slug-not-in-catalog',
  'live reads 2026-11-05T00:25Z: PRAGMA foreign_keys = 1; products holds companion-today, fleet-api, fleet-dashboard, idea-hub, jobs, ops-executor, papers-hub, q08-home, research-gateway, shorts-channel, travel; product_registry holds nine active slugs of which papers is not a products.slug; plus_ledger.product_slug REFERENCES products(slug)',
  'migration merged through the canonical path; no worker bundle changed',
  'one products row, one failure mode, one detector contract',
  'the Rollback header deletes the products row (only when plus_ledger holds no row for it), the detector and the failure mode; the decision row stays (append-only)',
  'the product plus loop can propose a plus for papers without failing the workflow',
  'the detector reads 1 before and 0 after; the next plus for papers inserts into plus_ledger',
  'none',
  'offline suite migrations/plus-papers-catalog-slug.test.mjs (foreign keys on: the insert for papers fails before and succeeds after; the detector reads 1 then 0; a replay and a rollback)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-REGISTRY-SLUG-1:%');
