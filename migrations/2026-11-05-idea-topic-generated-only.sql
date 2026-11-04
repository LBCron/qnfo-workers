-- TOPIC-DERIVE-GENERATED-1 (2026-11-05, pillar research; agent_issues 2047 = METRIC-TRIGGER-1238 idea_topic_concentration_30d, SIGNAL-INTAKE-1 diversity).
-- Root cause (read-only D1 and a replay of the shipped derivation rule on the same rows, 2026-11-04): the metric counts the 29 GENERATED accepts of the last 30 days, but the topic clusters it
-- counts them against were derived from ALL accepts of 90 days, 1,211 of 1,333 documents being the owner-corpus notebook (one subject). The notebook's vocabulary made the first cluster
-- model/matter/quantum/derive/simulation/state/formal/formalize, generic words that 21 of the 29 generated accepts contain: 0.724. With clusters derived from the generated accepts themselves, the
-- same 29 rows read 0.414 (12 in the quantum cluster, 11 in a source/theory cluster, 1 in a data cluster, 5 in no cluster). The intake is not one stream: auto-scan, auto-reentry and six intake
-- families (arXiv complexity, economics-games, metascience, computing-energy, logic-philosophy, a journal) supplied the accepts. The cap that should bind the population (idea-hub triage IDEA-DIVERSITY-CAP-1) read all 1,250 accepts, so one generated accept moved its share by 0.1 point whatever cluster it joined.
-- Fix (code, idea-hub 1.17.1 and qnfo-cloud-ops 1.46.1, shared block TOPIC-CLUSTERS-DERIVED-1): derive from the non-owner producers only, and give triage a second check, a generated
-- proposal is held when its cluster would exceed half of the 30-day GENERATED accepts (DIVERSITY-GENERATED-CAP-1, "other" never held). This file records the definition change, nothing else.
-- Prediction: idea_topic_concentration_30d <= 0.5 at the first idea-topic-metric run after both workers are live (0.414 by replay on the 29 rows). Leading indicator, the share of NEW generated accepts per cluster:
--   SELECT substr(created_at,1,10) d, name, decision, COUNT(*) n FROM idea_proposals WHERE created_at >= '2026-11-05' AND lower(name) NOT LIKE '%owner%' GROUP BY 1,2,3
-- plus the DEFER-DIVERSITY rationales naming "generated accepts". Honest limit: only 8 generated accepts were made since 2026-10-10 (the intake feeds are mostly HOLD at the bar, and idea-hub 1.17.0 is rigid), so the 30-day
-- count falls under IDEA_TOPIC_MIN_GENERATED (10) by about 2026-11-09 and the daily job then leaves the value unrefreshed; the value written before that (<= 0.5) stays until accepts resume.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET formula = replace(formula, ' | TOPIC-DERIVE-GENERATED-1 2026-11-05 (idea-hub 1.17.1, qnfo-cloud-ops 1.46.1, agent_issues 2047): the topic clusters are derived from the GENERATED accepts of the last 90 days only (producer name without owner), the population the share counts; before, from all accepts, 1,211 of 1,333 documents being the owner''s notebook, whose first cluster held 21 of the 29 generated accepts (0.724) where clusters derived from the generated accepts give 0.414 on the same rows. Triage also holds a generated accept whose cluster would exceed half of the 30-day generated accepts (DIVERSITY-GENERATED-CAP-1).', '') WHERE metric = 'idea_topic_concentration_30d'; UPDATE analytics_metric_triggers SET notes = replace(notes, ' | TOPIC-DERIVE-GENERATED-1 2026-11-05: clusters now derive from the generated accepts only; triage caps the generated population (see metric_registry.formula).', '') WHERE metric_key = 'idea_topic_concentration_30d';
-- Rollback note: the decision_log row stays (append-only); the worker changes revert with the canonical deploy canary or a revert of the pull request.

UPDATE metric_registry SET formula = formula || ' | TOPIC-DERIVE-GENERATED-1 2026-11-05 (idea-hub 1.17.1, qnfo-cloud-ops 1.46.1, agent_issues 2047): the topic clusters are derived from the GENERATED accepts of the last 90 days only (producer name without owner), the population the share counts; before, from all accepts, 1,211 of 1,333 documents being the owner''s notebook, whose first cluster held 21 of the 29 generated accepts (0.724) where clusters derived from the generated accepts give 0.414 on the same rows. Triage also holds a generated accept whose cluster would exceed half of the 30-day generated accepts (DIVERSITY-GENERATED-CAP-1).'
WHERE metric = 'idea_topic_concentration_30d' AND instr(formula, 'TOPIC-DERIVE-GENERATED-1') = 0;

UPDATE analytics_metric_triggers SET notes = COALESCE(notes, '') || ' | TOPIC-DERIVE-GENERATED-1 2026-11-05: clusters now derive from the generated accepts only; triage caps the generated population (see metric_registry.formula).'
WHERE metric_key = 'idea_topic_concentration_30d' AND instr(COALESCE(notes, ''), 'TOPIC-DERIVE-GENERATED-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'agent-breach-reach-ideas',
  'a diversity measure must take its cluster boundaries from the population it counts, and a cap must read the population the metric reads, otherwise neither can move when the counted intake changes',
  'TOPIC-DERIVE-GENERATED-1: the topic clusters of idea_topic_concentration_30d are derived from the generated accepts only (idea-hub 1.17.1, qnfo-cloud-ops 1.46.1 shared block) and idea-hub triage holds a generated accept whose cluster would exceed half of the 30-day generated accepts (DIVERSITY-GENERATED-CAP-1); the owner notebook stays in the all-sources mix and in the job notes',
  'qnfo-audit 2026-11-04 (SELECT only): metric 0.724; ACCEPTs of 90 days 1,333, owner-corpus and owner-chat 1,222; generated accepts of 30 days 29, 21 of them in the cluster model/matter/quantum/derive/simulation/state/formal/formalize; replay of the shipped rule over the generated accepts of 90 days (111 rows): 0.414 on the same 29 rows, top cluster quantum 12 of 29',
  'migration merged',
  'one metric formula text, one trigger note; no table, trigger or value written (the daily job writes the value); the worker changes are separate and revert with the canonical deploy canary',
  'the Rollback header of migrations/2026-11-05-idea-topic-generated-only.sql and a revert of the pull request',
  'the intake diversity metric and the triage cap read the same population, so the cap can bind the number the trigger judges',
  'idea_topic_concentration_30d <= 0.5 at the first daily run after both workers are live (0.414 by replay); new generated accepts per cluster stay at or under half of the 30-day generated accepts once 10 exist',
  'none',
  'd1:qnfo-audit read-only, replay of the derivation in the Cloudflare API sandbox, node:sqlite fixtures in qnfo-cloud-ops/idea-topic.test.mjs, idea-hub/diversity-cap.test.mjs and migrations/idea-topic-generated-only.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TOPIC-DERIVE-GENERATED-1:%');
