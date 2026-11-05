-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_prd_entity_map
-- Rollback: DELETE FROM entity_map WHERE slug IN (SELECT slug FROM bak_20261105_prd_entity_map) AND doi IS NULL AND post_uri IS NULL AND buffer_id IS NULL AND utm_campaign IS NULL.
--
-- PRD-FUNNEL-BACKFILL-1 (2026-11-05, charter pillar research; cluster sla-graph-fm of the fleet breach audit; metric prd_funnel_missing_transitions 10, target 0, detector fm-prd-funnel-evidence).
--
-- WHAT WAS READ (qnfo-audit v_prd_funnel_publications and papers.qnfo.org, 2026-11-05 01:05Z)
--   Ten published papers older than 120 minutes miss funnel evidence. Eight of them are the batch published 2026-10-19 02:21-11:31Z: has_deposit 0 and has_page_mapping 0 (no entity_map row;
--   the DOI registrar is retired by NOZ-DOI-1, so an entity_map page address is the evidence), has_distribution 1. Every one of the eight is live: GET https://papers.qnfo.org/papers/<slug> answers
--   200 for all eight (checked 2026-11-05). Every paper published since has an entity_map row in the shape (slug, page_url = https://papers.qnfo.org/papers/<slug>, doi NULL), so the batch predates
--   the publish step that writes it. The other two (topological-extension-hypothesis, a-minimal-generative-grammar-of-coordination...) have their page mapping and wait for a posted distribution;
--   they resolve when the social queue posts them and are not touched.
-- WHAT THIS FILE DOES
--   Adds the entity_map row of each of the eight, with the page address that answers 200, only where no row exists (INSERT OR IGNORE, explicit slugs, no other column set). It writes no DOI and no social
--   identifier and changes no paper. Prediction (decision_log): prd_funnel_missing_transitions 10 -> 2 at the next prd-funnel-monitor run.
-- spof-review: eight rows added to one table; reversible from the backup table.

CREATE TABLE IF NOT EXISTS bak_20261105_prd_entity_map AS
  SELECT q.paper_slug AS slug, strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS backed_up_at FROM research_queue q
  WHERE q.status = 'published' AND q.paper_slug IN (
    'comparison-as-a-fundamental-primitive-relational-operation-algebra-fixed-points-',
    'real-numbers-as-coarse-grained-projections-of-re-entry-generated-p-adic-trees',
    'responsibility-heuristics-as-functional-protocols-in-deterministic-multi-agent-n',
    'universal-functional-anatomy-of-belief-systems-a-formal-framework-for-a-label-ag',
    'algebraic-and-categorical-formalization-of-laws-of-form-invariants-with-operatio',
    'cerebral-surge-as-a-mechanistic-generator-of-near-death-experience-narratives-in',
    'will-to-meaning-as-a-neurobiological-survival-mechanism',
    'evaluating-the-productivity-gains-of-a-five-phase-human-llm-orchestration-protoc')
    AND NOT EXISTS (SELECT 1 FROM entity_map e WHERE e.slug = q.paper_slug);

INSERT OR IGNORE INTO entity_map (slug, page_url, updated_at)
SELECT q.paper_slug, 'https://papers.qnfo.org/papers/' || q.paper_slug, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM research_queue q
WHERE q.status = 'published' AND q.paper_slug IN (SELECT slug FROM bak_20261105_prd_entity_map)
  AND NOT EXISTS (SELECT 1 FROM entity_map e WHERE e.slug = q.paper_slug);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-sla-graph-fm', 'a published paper whose page answers 200 and has no entity_map row is missing a record, not a publication',
  'PRD-FUNNEL-BACKFILL-1: entity_map rows (slug, page_url) added for the eight papers published 2026-10-19 whose pages answer 200 on papers.qnfo.org',
  'read 2026-11-05 01:05Z: v_prd_funnel_publications lists ten papers older than 120 minutes; eight have has_deposit 0 and has_page_mapping 0 and has_distribution 1; GET https://papers.qnfo.org/papers/<slug> returned 200 for all eight; every later paper has an entity_map row of this shape',
  'migration merged', 'eight entity_map rows added; no paper, DOI or social record touched', 'see the Rollback header and bak_20261105_prd_entity_map',
  'the publication funnel evidence is complete for the papers that are live',
  'prd_funnel_missing_transitions 10 to 2 at the next prd-funnel-monitor run (the two left wait for a posted social distribution)',
  'the funnel reports only papers that really lack a record',
  'd1:qnfo-audit entity_map, v_prd_funnel_publications; https://papers.qnfo.org/papers/<slug>'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'PRD-FUNNEL-BACKFILL-1:') = 1);

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'prd_funnel_missing_transitions', '<=', 2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+3 hours'), 'seeded'
FROM decision_log d WHERE instr(d.action, 'PRD-FUNNEL-BACKFILL-1:') = 1;
