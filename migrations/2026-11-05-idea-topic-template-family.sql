-- TOPIC-TEMPLATE-FAMILY-1 (2026-11-05, pillar research; agent_issues 2047 = METRIC-TRIGGER-1238 idea_topic_concentration_30d). Follow-up of TOPIC-DERIVE-GENERATED-1 (PR 7340, merged and live 2026-11-04T23:55Z).
-- Read after that fix (D1, SELECT only; replay of the shipped rule in the Cloudflare API sandbox): the radar intake names one producer per feed (intake:arxiv-complexity, intake:journal-nature ...)
-- and every feed appends the same trailer to its text (source, http, fits). Each feed alone has fewer than 10 texts, so the producer-boilerplate rule of the cluster derivation never fired, and the
-- trailer became a topic: all 15 intake texts of the 90-day window (seven different fields) carry source+http+fits and formed the cluster source/fits/http, which held 11 of the 29 generated
-- accepts of 2026-11-04. The more feeds the intake gains (the point of SIGNAL-INTAKE-1), the more of it would read as one topic. A producer is now the name up to its first ":" (idea-hub 1.17.2,
-- qnfo-cloud-ops 1.46.2, shared block), so the feed family is one producer and its trailer is dropped. Replay on the same rows: 2026-11-04 0.345 (was 0.414), 11-05 0.375, 11-06 0.35, 11-07 0.50.
-- Honest limit: with 10 or fewer generated accepts left in the window the share is one or two rows (11-08: 6 of 10 fall in a generic cluster headed "model", an 11-09 window has 8 and the daily job
-- leaves the registry value unrefreshed under IDEA_TOPIC_MIN_GENERATED); the value is a signal only while the intake produces at least 10 generated accepts in 30 days.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE metric_registry SET formula = replace(formula, ' | TOPIC-TEMPLATE-FAMILY-1 2026-11-05 (idea-hub 1.17.2, qnfo-cloud-ops 1.46.2, agent_issues 2047): a producer for the boilerplate rule is the name up to its first colon, so the intake:<feed> producers are one family and their shared trailer (source, http, fits) is dropped instead of forming a cluster that held 11 of the 29 generated accepts.', '') WHERE metric = 'idea_topic_concentration_30d';
-- Rollback note: the decision_log row stays (append-only); the worker change reverts with the canonical deploy canary or a revert of the pull request.

UPDATE metric_registry SET formula = formula || ' | TOPIC-TEMPLATE-FAMILY-1 2026-11-05 (idea-hub 1.17.2, qnfo-cloud-ops 1.46.2, agent_issues 2047): a producer for the boilerplate rule is the name up to its first colon, so the intake:<feed> producers are one family and their shared trailer (source, http, fits) is dropped instead of forming a cluster that held 11 of the 29 generated accepts.'
WHERE metric = 'idea_topic_concentration_30d' AND instr(formula, 'TOPIC-TEMPLATE-FAMILY-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'agent-breach-reach-ideas',
  'boilerplate shared by a family of feed-named producers is not a topic, and a diversity measure must not read more feeds as less diversity',
  'TOPIC-TEMPLATE-FAMILY-1: the producer of the cluster derivation''s boilerplate rule is the name up to its first colon (idea-hub 1.17.2, qnfo-cloud-ops 1.46.2 shared block), so the intake:<feed> trailer (source, http, fits) is dropped instead of forming a cluster',
  'qnfo-audit 2026-11-04 (SELECT only): 15 intake texts in 90 days, 15 of 15 carry source+http+fits; cluster source/fits/http held 11 of the 29 generated accepts; replay with the family rule: share 0.345 on the same rows (0.414 before), 0.375 on 11-05, 0.35 on 11-06',
  'migration merged',
  'one metric formula text; the worker change only changes which terms the daily derivation drops, no table or trigger',
  'the Rollback header of migrations/2026-11-05-idea-topic-template-family.sql and a revert of the pull request',
  'the intake diversity metric no longer scales with the number of intake feeds',
  'idea_topic_concentration_30d stays <= 0.5 at the daily runs of 2026-11-05 and 2026-11-06 (replay 0.375, 0.35); no cluster derived from the 90-day generated accepts carries source, http or fits',
  'none',
  'd1:qnfo-audit read-only, replay in the Cloudflare API sandbox, qnfo-cloud-ops/idea-topic.test.mjs section 9d (negative control: the old rule puts all 12 fixture texts in one trailer cluster, share 1.0)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TOPIC-TEMPLATE-FAMILY-1:%');
