-- C8-PAPER-LEARN-NOTE-FIXES-1 (2026-11-05, charter pillar autonomy; cluster C8-PROJECTS-GOALS of the roadmap and backlog completion sweep). Correction of my own merged PR 7379 and PR 7486.
-- A second pass over the names those notes cite, against the repository markers (read 2026-11-05 01:55Z): qnfo-chat-canary carries a RETIRED marker; qnfo-citation-watch carries a FOLDED marker;
-- errata-hub, qnfo-errata-publish, qnfo-errata-respond and qnfo-errata-watch are FOLDED and errata-orchestrator is RETIRED. Four settled learnings and one catalogue citation named those workers as running mechanisms.
-- The dispositions stand (each rests on mechanisms that exist: CF-MODEL-EVAL-1, research_golden_runs, CITE-FULLTEXT-1, the claim gate, qnfo-research-exec draftCorrection, PAPER-LEDGER-1); only the wording that named a retired or
-- folded worker is replaced with what runs today. Rows are matched by id and by the exact old text, so nothing else in a note can change. Revert: the Rollback header.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE paper_learnings SET status_note = (SELECT b.status_note FROM bak_20261105_c8_note_fix b WHERE b.id = paper_learnings.id) WHERE id IN (SELECT id FROM bak_20261105_c8_note_fix); UPDATE paper_learning_mechanisms SET citation = (SELECT c.citation FROM bak_20261105_c8_mech_fix c WHERE c.mech_key = paper_learning_mechanisms.mech_key) WHERE mech_key IN (SELECT mech_key FROM bak_20261105_c8_mech_fix)
-- CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261105_c8_note_fix AS SELECT id, status_note FROM paper_learnings WHERE id IN (4866, 5535, 4939, 5538);
CREATE TABLE IF NOT EXISTS bak_20261105_c8_mech_fix AS SELECT mech_key, citation FROM paper_learning_mechanisms WHERE mech_key = 'research-golden-set';

UPDATE paper_learnings SET status_note = replace(status_note, 'fixed-answer canaries exist (qnfo-chat-canary, the CF-MODEL-EVAL-1 battery, research_golden_runs)', 'fixed-answer checks exist (the CF-MODEL-EVAL-1 battery, research_golden_runs and the post-deploy canaries of DEPLOY-PROBES-1)')
WHERE id = 4866 AND instr(status_note, 'qnfo-chat-canary') > 0;
UPDATE paper_learnings SET status_note = replace(status_note, ', qnfo-citation-watch watches citations, and the claim gate', ', and the claim gate')
WHERE id = 5535 AND instr(status_note, 'qnfo-citation-watch') > 0;
UPDATE paper_learnings SET status_note = replace(status_note, 'the errata pipeline for its papers', 'corrections to its papers through qnfo-research-exec draftCorrection with the full prior body kept in paper_change_ledger')
WHERE id = 4939 AND instr(status_note, 'the errata pipeline for its papers') > 0;
UPDATE paper_learnings SET status_note = replace(status_note, '(issue_lifecycle, the errata pipeline)', '(issue_lifecycle, paper_change_ledger)')
WHERE id = 5538 AND instr(status_note, 'the errata pipeline') > 0;
UPDATE paper_learning_mechanisms SET citation = replace(citation, 'research_golden_runs, qnfo-chat-canary, cf_model_eval_runs (qnfo-model-eval)', 'research_golden_runs and cf_model_eval_runs (qnfo-model-eval); the post-deploy canaries of DEPLOY-PROBES-1')
WHERE mech_key = 'research-golden-set' AND instr(citation, 'qnfo-chat-canary') > 0;
