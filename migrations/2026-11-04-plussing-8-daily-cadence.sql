-- PLUSSING-8 (2026-11-04, charter pillar autonomy). Owner: plussing is continuous, products keep improving without being prompted.
-- Evidence read from qnfo-audit on 2026-11-04 14:08Z: the nine pl-* steps from PLUSSING-3 are live (migration_runs ok 2026-10-29 12:40Z), but v_product_plus_due returned no row,
-- cf_agent_requests held no roadmap-%-plus-% request in 6 days and plus_ledger had no row from the loop. Cause: every product in product_registry has plus_cadence_h = 168 counted from
-- created_at (2026-10-29 12:29Z), so the first plus of any product was not due before 2026-11-05 12:29Z, and the loop then plusses a product once a week at most.
-- WHAT: cadence 168 to 24 hours for active products that still have the default, so the oldest products are due on the next hourly tick, up to ops_config product_plus_daily_cap (3) a day.
-- Prediction: cf_agent_requests with instance roadmap-%-plus-% >= 1 within 2 hours of apply, product_plus_deployed_7d >= 1 within 7 days.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_plus8_cadence
-- Rollback: UPDATE product_registry SET plus_cadence_h = (SELECT plus_cadence_h FROM bak_20261104_plus8_cadence b WHERE b.product = product_registry.product) WHERE product IN (SELECT product FROM bak_20261104_plus8_cadence);

CREATE TABLE IF NOT EXISTS bak_20261104_plus8_cadence AS SELECT product, plus_cadence_h FROM product_registry;

UPDATE product_registry SET plus_cadence_h = 24 WHERE plus_cadence_h = 168 AND state = 'active';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
VALUES ('session (PLUSSING-8)', 'plussing is continuous; a weekly gate counted from product creation delays the first plus a week and then caps it at one a week',
  'product_registry.plus_cadence_h 168 to 24 for active default-cadence products',
  'v_product_plus_due empty and no roadmap-%-plus-% request in cf_agent_requests 2026-10-29 to 2026-11-04 despite the pl-* steps live', 'pending',
  'at most ops_config product_plus_daily_cap (3) cf_agent_requests a day',
  'the Rollback line of migrations/2026-11-04-plussing-8-daily-cadence.sql; or ops_config product_plus = off',
  'product-plussing', 'a roadmap-%-plus-% request within 2 hours of apply', 'product_registry, v_product_plus_due, cf_agent_requests, migration_runs');
