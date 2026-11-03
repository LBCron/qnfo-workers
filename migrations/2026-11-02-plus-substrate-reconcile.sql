-- PLUS-SUBSTRATE-RECONCILE-1 (2026-11-02, charter pillars personal and reach).
-- Align the product catalog with the active plussing registry using the live fleet graph.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_plus_substrate_products
-- Rollback: UPDATE product_registry SET product = 'qnfo-site', host = 'qnfo.org', worker = 'qnfo-gateway', what_for = 'landing, papers and email capture' WHERE product = 'q08-home' AND host = 'q08.org' AND worker = 'q08-signal-engine'; DELETE FROM products WHERE slug IN ('jobs', 'travel', 'shorts-channel') AND NOT EXISTS (SELECT 1 FROM bak_20261102_plus_substrate_products b WHERE b.slug = products.slug); INSERT OR REPLACE INTO products (slug, name, surface, owner_worker, repo, path, created_at) SELECT slug, name, surface, owner_worker, repo, path, created_at FROM bak_20261102_plus_substrate_products; DROP TABLE IF EXISTS bak_20261102_plus_substrate_products;

CREATE TABLE IF NOT EXISTS bak_20261102_plus_substrate_products AS
SELECT * FROM products
WHERE slug IN ('q08-home', 'jobs', 'travel', 'shorts-channel');

INSERT INTO products (slug, name, surface, owner_worker, repo, path) VALUES
  ('jobs', 'Jobs matcher (jobs.q08.org)', 'jobs.q08.org', 'qnfo-jobsearch', 'QNFO/qnfo-workers', 'qnfo-jobsearch/worker.js'),
  ('travel', 'Travel planner (travel.q08.org)', 'travel.q08.org', 'personal-companion', 'QNFO/qnfo-workers', 'personal-companion/worker.js'),
  ('shorts-channel', 'Research Shorts (YouTube)', 'youtube', 'qnfo-youtube-shorts', 'QNFO/qnfo-workers', 'qnfo-youtube-shorts/worker.js')
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  surface = excluded.surface,
  owner_worker = excluded.owner_worker,
  repo = excluded.repo,
  path = excluded.path;

UPDATE products
SET owner_worker = 'q08-signal-engine',
    path = 'q08-signal-engine/worker.js'
WHERE slug = 'q08-home' AND surface = 'q08.org';

UPDATE product_registry
SET product = 'q08-home',
    host = 'q08.org',
    worker = 'q08-signal-engine',
    what_for = 'q08.org homepage'
WHERE product = 'qnfo-site';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'PLUS-SUBSTRATE-RECONCILE-1',
  'products.slug is the catalog and plus-ledger identity; live graph routes determine the serving worker, while the existing registry supplies the external YouTube surface',
  'Add catalog rows for jobs, travel and shorts-channel; keep q08-home as the canonical catalog slug and map the duplicate qnfo-site registry entry to its live q08.org surface',
  'Live qnfo-audit read: 8 catalog rows, 8 active registry rows, four unmatched slugs, no qnfo-site plus-ledger rows; live fleet graph: jobs.q08.org -> qnfo-jobsearch, travel.q08.org -> personal-companion, q08.org -> q08-signal-engine, and qnfo-youtube-shorts is live',
  'pending',
  'products, product_registry',
  'restore the backed-up catalog rows, reverse q08-home to qnfo-site, and remove only newly inserted catalog rows',
  'active product registry slugs resolve to a catalog identity with the verified serving worker and surface',
  'catalog coverage for active registry slugs increases from 4/8 to 8/8; the duplicate qnfo-site identity is removed',
  'complete product identity coverage for QNFO.PERSONAL and QNFO.REACH',
  'qnfo-jobsearch/jobs.q08.org; personal-companion/travel.q08.org; qnfo-youtube-shorts/youtube; q08-signal-engine/q08.org'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'PLUS-SUBSTRATE-RECONCILE-1'
    AND instr(action, 'Add catalog rows for jobs, travel and shorts-channel;') = 1
);
