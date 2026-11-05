-- C5-OBSERVE / RM-CAPABILITY-PRODUCT-LOOP-1 (2026-11-05, charter pillar autonomy): the first four adopt-leg decisions of cloudflare_capability_catalog, each with the evidence read in the repository and in D1 on 2026-11-05.
-- The catalog had 15 rows in status proposed written by the 2026-10-02 session audit and nothing decided them (migrations/2026-11-04-c5-observe-rows.sql, issue CF-CAPABILITY-ADOPT-1). Four of them are decided by what the repository
-- and the live fleet already show; the other eleven are left to the decision step that issue adds to qnfo-fleet-control (one deduped CF-CAPABILITY-DECIDE-1 issue per row, two a day).
--   turnstile            in_use    Turnstile siteverify calls in 7 workers (idea-hub, qnfo-ai-search, qnfo-fleet-dashboard, qnfo-ipatent, qnfo-gateway, personal-companion, q08-signal-engine); linked issue 1758 closed
--   analytics-engine     in_use    qnfo-observability binds the Analytics Engine dataset qnfo_fleet ([[analytics_engine_datasets]] in its wrangler.toml; ae:qnfo_fleet in docs/SYSTEM-MAP.md); linked issue 1711 closed
--   cron-single-trigger  in_use    one cron expression per worker with an in-code due table: docs/SYSTEM-MAP.md shows cron:1 on every cron worker except qnfo-fleet-control and q08-signal-engine (cron:2); CRON-SINGLE-TRIGGER-1 (issue 1785) closed
--   gradual-deployments  approved  built (scripts/gradual_deploy.py, .github/workflows/gradual-deploy.yml, docs/GRADUAL-DEPLOYS.md, BP26-GRADUAL-DEPLOYS-1) but metric deploys_via_gradual reads 0.0032 on 2026-11-04, so it is not yet how the fleet deploys; metric_ref set
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE cloudflare_capability_catalog SET status = 'proposed' WHERE slug IN ('turnstile', 'analytics-engine', 'cron-single-trigger', 'gradual-deployments'); DELETE FROM decision_log WHERE action LIKE 'C5-OBSERVE-CAPABILITY-1:%';

UPDATE cloudflare_capability_catalog SET status = 'in_use', last_synced = datetime('now'),
  when_to_choose = COALESCE(when_to_choose, '') || ' | decision 2026-11-05 (c5-observe, RM-CAPABILITY-PRODUCT-LOOP-1): in use, Turnstile siteverify calls in 7 workers (idea-hub, qnfo-ai-search, qnfo-fleet-dashboard, qnfo-ipatent, qnfo-gateway, personal-companion, q08-signal-engine)'
  WHERE slug = 'turnstile' AND status = 'proposed';

UPDATE cloudflare_capability_catalog SET status = 'in_use', last_synced = datetime('now'),
  when_to_choose = COALESCE(when_to_choose, '') || ' | decision 2026-11-05 (c5-observe, RM-CAPABILITY-PRODUCT-LOOP-1): in use, qnfo-observability binds the Analytics Engine dataset qnfo_fleet'
  WHERE slug = 'analytics-engine' AND status = 'proposed';

UPDATE cloudflare_capability_catalog SET status = 'in_use', last_synced = datetime('now'),
  when_to_choose = COALESCE(when_to_choose, '') || ' | decision 2026-11-05 (c5-observe, RM-CAPABILITY-PRODUCT-LOOP-1): in use, one cron expression per worker with an in-code due table (cron:1 on every cron worker in docs/SYSTEM-MAP.md except qnfo-fleet-control and q08-signal-engine)'
  WHERE slug = 'cron-single-trigger' AND status = 'proposed';

UPDATE cloudflare_capability_catalog SET status = 'approved', metric_ref = COALESCE(NULLIF(metric_ref, ''), 'deploys_via_gradual'), last_synced = datetime('now'),
  when_to_choose = COALESCE(when_to_choose, '') || ' | decision 2026-11-05 (c5-observe, RM-CAPABILITY-PRODUCT-LOOP-1): approved and built (scripts/gradual_deploy.py, gradual-deploy.yml, docs/GRADUAL-DEPLOYS.md); deploys_via_gradual reads 0.0032 on 2026-11-04, so it becomes in_use when that metric shows it is how the fleet deploys'
  WHERE slug = 'gradual-deployments' AND status = 'proposed';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'c5-observe',
  'a catalog row whose product the repository and the live fleet already use is decided from that evidence, not left proposed until a session happens to look',
  'C5-OBSERVE-CAPABILITY-1: cloudflare_capability_catalog turnstile, analytics-engine, cron-single-trigger set to in_use and gradual-deployments to approved',
  'repository 2026-11-05: Turnstile siteverify calls in 7 worker.js files; qnfo-observability wrangler.toml [[analytics_engine_datasets]] dataset qnfo_fleet; docs/SYSTEM-MAP.md cron:1 per worker; scripts/gradual_deploy.py with metric deploys_via_gradual 0.0032',
  'migration merged',
  'four rows of cloudflare_capability_catalog; no worker, no behaviour',
  'the Rollback header of migrations/2026-11-04-c5-observe-capability-decisions.sql',
  'the capability catalog records what the fleet already uses, so the open-proposal count measures real undecided rows',
  'undecided proposed rows fall from 15 to 11; the other eleven get a decision issue from qnfo-fleet-control',
  'none',
  'd1:qnfo-audit read-only, node:sqlite replay in migrations/c5-observe-capability-decisions.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'C5-OBSERVE-CAPABILITY-1:%');
