-- PLUS-2 and PLUS-5 data layer (2026-11-05, charter pillar autonomy; roadmap_implementation source plussing-2026, rows 1797 and 1800, docs/PLUSSING.md).
-- PLUS-2 (usage signal): every product_registry row had usage_metric NULL and no number, so the plus loop (step 1 "weighted by usage") could not weigh anything and a
--   product with no signal was invisible (PLUSSING failure mode 4). The fleet already snapshots requests and errors per Worker script from Cloudflare analytics
--   (workersInvocationsAdaptive) into worker_usage_daily once a day (SCRIPT-USAGE-GRAPHQL-1, qnfo-fleet-control refreshScriptUsage, 40 scripts a day, newest 2026-11-04T03:10Z).
--   Nothing new is collected: the step pl-usage copies the newest snapshot of each product's worker into product_registry (usage_value, usage_window, usage_errors,
--   usage_read_at, usage_source). A snapshot older than 36 hours, or a worker with no row, leaves usage_value NULL: unmeasured, never 0. The number is Worker requests
--   (cron ticks and service-binding calls included), not a count of people, and usage_source says so. shorts-channel has no Worker route: its signal is the YouTube view
--   count the Shorts worker reads into youtube_videos.views (NULL until that read lands; owner card yt-analytics-consent), step pl-usage-shorts.
-- PLUS-5 (digest): plus_digest holds one row per Monday (and one at apply): products, plusses in flight, decided / deployed / reverted in 7 days and a plain list of what got
--   better, read from plus_ledger by the step pl-digest. An empty week says so; nothing is invented. fleet.qnfo.org/plus (qnfo-fleet-dashboard) and GET /api/plus serve it.
-- The three steps are appended to management-personas-plus (hourly, :50); each statement is idempotent, so an hourly rerun changes only what moved.
-- Prediction: product_registry.usage_value is non-NULL for 8 of 9 active products within 1 hour of apply (shorts-channel stays NULL until views are read); plus_digest has 1 row at apply
-- and 1 more each Monday; fm-product-usage-unmeasured and fm-plus-digest-stale read 0. Stop: DELETE the three steps by name (Rollback), the columns and table are inert.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus25_task
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261105_plus25_task WHERE id = 'management-personas-plus'), version = version + 1 WHERE id = 'management-personas-plus'; DELETE FROM remediation_contracts WHERE class IN ('fm-product-usage-unmeasured','fm-plus-digest-stale'); DELETE FROM failure_modes WHERE fm_key IN ('product-usage-unmeasured','plus-digest-stale'); DROP TABLE IF EXISTS plus_digest;
-- CAUSE-MAPPED: registers no metric_registry row; the detectors are failure_modes rows with remediation contracts.

CREATE TABLE IF NOT EXISTS bak_20261105_plus25_task AS SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas-plus';

ALTER TABLE product_registry ADD COLUMN usage_value INTEGER;
ALTER TABLE product_registry ADD COLUMN usage_window TEXT;
ALTER TABLE product_registry ADD COLUMN usage_errors INTEGER;
ALTER TABLE product_registry ADD COLUMN usage_read_at TEXT;
ALTER TABLE product_registry ADD COLUMN usage_source TEXT;

CREATE TABLE IF NOT EXISTS plus_digest (
  day TEXT PRIMARY KEY,
  products INTEGER,
  in_flight INTEGER,
  decided_7d INTEGER,
  deployed_7d INTEGER,
  reverted_7d INTEGER,
  body_md TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Backfill now with the same statements the steps run, so the page and the registry have values at apply.
UPDATE product_registry SET
  usage_metric = 'worker_requests_7d',
  usage_window = '7d',
  usage_value = (SELECT u.requests_7d FROM worker_usage_daily u WHERE u.script = product_registry.worker AND u.day = (SELECT MAX(day) FROM worker_usage_daily) AND u.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-36 hours')),
  usage_errors = (SELECT u.errors_7d FROM worker_usage_daily u WHERE u.script = product_registry.worker AND u.day = (SELECT MAX(day) FROM worker_usage_daily) AND u.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-36 hours')),
  usage_read_at = (SELECT u.ts FROM worker_usage_daily u WHERE u.script = product_registry.worker AND u.day = (SELECT MAX(day) FROM worker_usage_daily) AND u.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-36 hours')),
  usage_source = 'cloudflare workersInvocationsAdaptive per Worker script, via worker_usage_daily; counts cron ticks and service-binding calls too, not people'
WHERE state = 'active' AND worker IS NOT NULL AND product <> 'shorts-channel';

UPDATE product_registry SET
  usage_metric = 'youtube_views_total',
  usage_window = 'lifetime',
  usage_value = (SELECT SUM(views) FROM youtube_videos WHERE state = 'uploaded' AND views IS NOT NULL),
  usage_errors = NULL,
  usage_read_at = (SELECT MAX(retention_read_at) FROM youtube_videos WHERE state = 'uploaded' AND views IS NOT NULL),
  usage_source = 'youtube_videos.views, read by qnfo-youtube-shorts; NULL (unmeasured, never 0) until a view read lands'
WHERE product = 'shorts-channel';

INSERT OR IGNORE INTO plus_digest (day, products, in_flight, decided_7d, deployed_7d, reverted_7d, body_md)
SELECT strftime('%Y-%m-%d', 'now'),
  (SELECT COUNT(*) FROM product_registry WHERE state = 'active'),
  (SELECT COUNT(*) FROM plus_ledger WHERE status IN ('proposed', 'building', 'reverting')),
  (SELECT COUNT(*) FROM plus_ledger WHERE date(decided_at) >= date('now', '-7 days')),
  (SELECT COUNT(*) FROM plus_ledger WHERE status IN ('deployed', 'shipped', 'kept') AND date(decided_at) >= date('now', '-7 days')),
  (SELECT COUNT(*) FROM plus_ledger WHERE status = 'reverted' AND date(decided_at) >= date('now', '-7 days')),
  'What got better in the last 7 days: ' || COALESCE((SELECT group_concat('- ' || COALESCE(product, product_slug) || ': ' || COALESCE(title, plus) || ' [' || status || ']', char(10)) FROM (SELECT product, product_slug, title, plus, status FROM plus_ledger WHERE status IN ('deployed', 'shipped', 'kept', 'reverted') AND date(decided_at) >= date('now', '-7 days') ORDER BY decided_at DESC LIMIT 20)), 'no plus was deployed, kept or reverted yet. ' || (SELECT COUNT(*) FROM plus_ledger WHERE status IN ('proposed', 'building', 'reverting')) || ' in flight.');

UPDATE fleet_tasks
SET definition = json_insert(definition,
    '$.steps[#]', json(json_object('type', 'sql', 'name', 'pl-usage', 'db', 'AUDIT', 'sql',
      'UPDATE product_registry SET usage_metric = ''worker_requests_7d'', usage_window = ''7d'', usage_value = (SELECT u.requests_7d FROM worker_usage_daily u WHERE u.script = product_registry.worker AND u.day = (SELECT MAX(day) FROM worker_usage_daily) AND u.ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-36 hours'')), usage_errors = (SELECT u.errors_7d FROM worker_usage_daily u WHERE u.script = product_registry.worker AND u.day = (SELECT MAX(day) FROM worker_usage_daily) AND u.ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-36 hours'')), usage_read_at = (SELECT u.ts FROM worker_usage_daily u WHERE u.script = product_registry.worker AND u.day = (SELECT MAX(day) FROM worker_usage_daily) AND u.ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-36 hours'')), usage_source = ''cloudflare workersInvocationsAdaptive per Worker script, via worker_usage_daily; counts cron ticks and service-binding calls too, not people'' WHERE state = ''active'' AND worker IS NOT NULL AND product <> ''shorts-channel''')),
    '$.steps[#]', json(json_object('type', 'sql', 'name', 'pl-usage-shorts', 'db', 'AUDIT', 'sql',
      'UPDATE product_registry SET usage_metric = ''youtube_views_total'', usage_window = ''lifetime'', usage_value = (SELECT SUM(views) FROM youtube_videos WHERE state = ''uploaded'' AND views IS NOT NULL), usage_errors = NULL, usage_read_at = (SELECT MAX(retention_read_at) FROM youtube_videos WHERE state = ''uploaded'' AND views IS NOT NULL), usage_source = ''youtube_videos.views, read by qnfo-youtube-shorts; NULL (unmeasured, never 0) until a view read lands'' WHERE product = ''shorts-channel''')),
    '$.steps[#]', json(json_object('type', 'sql', 'name', 'pl-digest', 'db', 'AUDIT', 'sql',
      'INSERT OR IGNORE INTO plus_digest (day, products, in_flight, decided_7d, deployed_7d, reverted_7d, body_md) SELECT strftime(''%Y-%m-%d'', ''now''), (SELECT COUNT(*) FROM product_registry WHERE state = ''active''), (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''proposed'', ''building'', ''reverting'')), (SELECT COUNT(*) FROM plus_ledger WHERE date(decided_at) >= date(''now'', ''-7 days'')), (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''deployed'', ''shipped'', ''kept'') AND date(decided_at) >= date(''now'', ''-7 days'')), (SELECT COUNT(*) FROM plus_ledger WHERE status = ''reverted'' AND date(decided_at) >= date(''now'', ''-7 days'')), ''What got better in the last 7 days: '' || COALESCE((SELECT group_concat(''- '' || COALESCE(product, product_slug) || '': '' || COALESCE(title, plus) || '' ['' || status || '']'', char(10)) FROM (SELECT product, product_slug, title, plus, status FROM plus_ledger WHERE status IN (''deployed'', ''shipped'', ''kept'', ''reverted'') AND date(decided_at) >= date(''now'', ''-7 days'') ORDER BY decided_at DESC LIMIT 20)), ''no plus was deployed, kept or reverted yet. '' || (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''proposed'', ''building'', ''reverting'')) || '' in flight.'') WHERE strftime(''%w'', ''now'') = ''1''')) ),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus' AND instr(definition, '"pl-usage"') = 0;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('product-usage-unmeasured', 'a product has no usage number, so the plus loop cannot weigh it and a dead product looks the same as a busy one',
  'product_registry.usage_metric was NULL for every product (PLUS-2 planned); the per-script request snapshot existed in worker_usage_daily but nothing joined it to the product',
  'pl-usage copies the newest worker_usage_daily snapshot of each product worker into product_registry; a missing or stale snapshot leaves usage_value NULL and this detector reads it',
  'the fm-product-usage-unmeasured contract counts active products with a worker, other than shorts-channel (no Worker route), whose usage_read_at is empty or older than 48 hours, expected 0',
  'fm-product-usage-unmeasured', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'an active product_registry row with a worker and usage_read_at NULL or older than 48 hours',
  'v_product_plus_due cannot be weighted by usage; the fleet dashboard /plus page shows a product as unmeasured',
  'plussing: products are plussed in cadence order only, never by how much they are used');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-product-usage-unmeasured', NULL, 'PLUS-2', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM product_registry WHERE state = ''active'' AND worker IS NOT NULL AND product <> ''shorts-channel'' AND (usage_read_at IS NULL OR usage_read_at < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-48 hours''))) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('plus-digest-stale', 'the weekly what-got-better digest stops, so the owner has to ask what the plus loop did',
  'the digest is one INSERT OR IGNORE a week in the hourly management-personas-plus task; that task has stalled before (PLUS-OWN-TASK-1: 27 runs stuck in running)',
  'pl-digest writes plus_digest each Monday; this detector reads the newest row and the task run state',
  'the fm-plus-digest-stale contract counts 1 when the newest plus_digest row is older than 9 days, expected 0',
  'fm-plus-digest-stale', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'max(plus_digest.day) older than 9 days',
  'fleet.qnfo.org/plus shows a digest older than a week',
  'owner quiet channel: the weekly digest is the only report of plus work');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-plus-digest-stale', NULL, 'PLUS-5', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN COALESCE((SELECT MAX(day) FROM plus_digest), ''1970-01-01'') < strftime(''%Y-%m-%d'', ''now'', ''-9 days'') THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (C3-products)',
  'a usage signal that reuses the existing per-script Cloudflare snapshot costs nothing new; Worker requests are a stated proxy, not people, and unmeasured stays NULL',
  'PLUS-2 and PLUS-5: product_registry.usage_* filled from worker_usage_daily by step pl-usage; weekly plus_digest by step pl-digest; two failure-mode detectors',
  'worker_usage_daily holds 40 scripts for 2026-11-04 (ts 03:10Z); product_registry usage_metric was NULL on all 9 products; plus_ledger holds 2 rows, so the digest must say so',
  'migration merged', 'one table, five registry columns, three steps in management-personas-plus, two detector contracts',
  'the Rollback header of migrations/2026-11-05-plus-2-5-usage-digest.sql',
  'the plus loop and the owner can see which products are used and what got better',
  'usage_value non-NULL for 8 of 9 active products within 1 hour; plus_digest row each Monday', 'none',
  'node:sqlite replay in migrations/plus-2-5.test.mjs; d1:qnfo-audit read after apply'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-2 and PLUS-5:%');
