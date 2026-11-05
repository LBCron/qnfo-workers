-- PLUS-2 consumer (2026-11-05, charter pillar autonomy; roadmap_implementation row 1797, docs/PLUSSING.md step 1 "Pick ... weighted by usage").
-- migrations/2026-11-05-plus-2-5-usage-digest.sql made the usage number exist (product_registry.usage_value, 8 of 9 products measured). Nothing read it yet: step pl-research
-- ordered the products by hours since the last plus alone, and 8 of the 9 products share one created_at (2026-10-29 12:29Z) so they tie at the same hour count and were picked in
-- arbitrary order, while its prompt still said "Usage signal: worker_requests_7d" with no number. Two edits to that one step, in place, in management-personas-plus:
--   1. the prompt names the number and its meaning ("worker_requests_7d = 6126 over 7d (Worker requests, cron and calls between workers included, not people)"; unmeasured stays
--      the word unmeasured), so the product manager can weigh it;
--   2. the order becomes hours_since_plus plus a usage bonus (12 hours at 50,000 or more, 6 at 10,000, 3 at 1,000) and then by the usage number itself, so among products that are equally overdue the busier one goes first
--      and an overdue product still beats a busy one that was plussed recently. NULL usage adds nothing (a product with no signal is not starved, it keeps its place by age).
-- The daily cap, the in-flight rule, the rest rule and the quality guard in that step are untouched. Idempotent: it only runs while both old texts are present.
-- Prediction: the next pl-research request names papers (165,043 requests) or q08-home (45,124) before research-gateway (17,453) when their ages tie; cf_agent_requests prompt
-- contains "unmeasured" or a number after "Usage signal: worker_requests_7d =". Stop: Rollback restores the saved definition.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus2_pick
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261105_plus2_pick WHERE id = 'management-personas-plus'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 'management-personas-plus' AND EXISTS (SELECT 1 FROM bak_20261105_plus2_pick WHERE id = 'management-personas-plus');
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_plus2_pick AS SELECT id, definition FROM fleet_tasks WHERE id = 'management-personas-plus';

UPDATE fleet_tasks
SET definition = replace(replace(definition,
    'Usage signal: '' || COALESCE(r.usage_metric, ''none yet'') ||',
    'Usage signal: '' || COALESCE(r.usage_metric || '' = '' || COALESCE(CAST(r.usage_value AS TEXT), ''unmeasured'') || '' over '' || COALESCE(r.usage_window, ''?'') || '' (Worker requests, cron and calls between workers included, not people)'', ''none yet'') ||'),
    'ORDER BY d.hours_since_plus DESC LIMIT 3',
    'ORDER BY d.hours_since_plus + CASE WHEN r.usage_value >= 50000 THEN 12 WHEN r.usage_value >= 10000 THEN 6 WHEN r.usage_value >= 1000 THEN 3 ELSE 0 END DESC, r.usage_value DESC LIMIT 3'),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus'
  AND instr(definition, 'Usage signal: '' || COALESCE(r.usage_metric, ''none yet'') ||') > 0
  AND instr(definition, 'ORDER BY d.hours_since_plus DESC LIMIT 3') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (C3-products)',
  'a usage number that no consumer reads is not a signal; among equally overdue products the busier one should be plussed first, an overdue one still beating a recently plussed busy one',
  'PLUS-2 consumer: pl-research names the usage value in its prompt and orders by hours since the last plus plus a usage bonus of 0, 3, 6 or 12 hours',
  'product_registry.usage_value set for 8 of 9 products (PR 7337, migration_runs 1254); 8 products share created_at 2026-10-29 12:29Z so they tie on age; the live pl-research text read 2026-11-05 contains both replaced strings once',
  'pending', 'which product the plus loop asks about first, at most product_plus_daily_cap (3) a day; nothing is written to a product',
  'the Rollback header of migrations/2026-11-05-plus-2-usage-weighted-pick.sql, or ops_config product_plus = off',
  'the plus loop weighs products by use', 'the first pl-research requests after apply name papers and q08-home before research-gateway', 'none',
  'node:sqlite replay in migrations/plus-2-usage-pick.test.mjs; d1:qnfo-audit fleet_tasks text and cf_agent_requests after the next :50 tick'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-2 consumer:%');
