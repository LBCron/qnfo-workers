-- SEEDED-GAP-1 and SEEDED-GAP-2 (2026-11-05, charter pillar research; RM-SEEDED-CLAIM-HARNESS-2, roadmap row 1703): the widened seeded-claim harness (scripts/seeded_claim_harness.mjs, seeds version 2) found five known-false seeds that
-- the deterministic gates of qnfo-research-exec do not catch. seeded_false_claim_catch_rate read 1.0 for a week because its six seeds were the six sentences the scan was written against; with 17 seeds over three
-- gates the first run read 12 of 17. Each miss gets a doer and a closing probe that reads the newest harness run (OWNER-NO-LOOSE-ENDS-1); a seed is never removed to raise the rate.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'SEEDED-GAP-1:%' OR title LIKE 'SEEDED-GAP-2:%';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SEEDED-GAP-1: fabricatedClaimScan misses paraphrased fabricated-study sentences (seeds S07 to S10 of scripts/seeded-claims.json)',
 'Charter pillar: research. Doer: qnfo-research-exec via qnfo-code-orchestrator. scripts/seeded_claim_harness.mjs runs fabricatedClaimScan on a clean body plus one seed sentence and reads the result as caught or not. The first ten scan seeds: S01 to S06 (the sentences the patterns were written for) are caught, the four paraphrases are not: S07 "A panel of twelve practitioners graded the outputs in a blinded evaluation.", S08 "The apparatus was calibrated before each of the 30 experimental runs.", S09 "Data were collected from 1,200 households across three regions.", S10 "We interviewed fifteen engineers about how they use the method in practice." Each states fabricated empirical work in a pipeline that runs none (the FACT in ciExtractPrompt). Lever: add the patterns that catch these four to CI_PATTERNS (grader or rater panels with a count, calibration or run counts of an apparatus, data collected from a counted population, interviews with a counted group), keeping the modal, negation and cited-without-first-person exclusions; add a test beside qnfo-research-exec/claim-integrity.test.mjs with the four sentences and at least five legitimate sentences that must stay unflagged (a cited related-work sentence, a proposal in the conditional, a negation, a sentence about the cited authors'' own survey with a citation marker). Done: the newest scripts/seeded_claim_harness.mjs run catches S07 to S10 and flags none of its three controls, the claim-integrity suite passes, and qnfo-research-exec is deployed with the version above this issue.
code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: function fabricatedClaimScan(md) {',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SEEDED-GAP-1:%' AND status = 'open');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1.00'' AS expected, printf(''%.2f'', COALESCE((SELECT AVG(caught) FROM seeded_claim_runs WHERE seed_id IN (''S07-panel'', ''S08-calibrated'', ''S09-households'', ''S10-interviews'') AND ts >= datetime(''now'', ''-12 hours'')), 0)) AS observed',
    verify_transport = 'd1-query', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 6, module = 'seeded-claim-gap',
    precondition = 'SEEDED-GAP-1: the scan seeds S07 to S10 are not caught by fabricatedClaimScan',
    action = 'the code loop extends CI_PATTERNS in qnfo-research-exec; the seeded harness (scripts/bp26_seeded.py, every 6 hours) re-measures'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'SEEDED-GAP-1:%' AND status = 'open' ORDER BY id DESC LIMIT 1);

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SEEDED-GAP-2: the citation gate never compares a reference label with the arXiv title for lines in the form [n] Title. arXiv:id (seed S12)',
 'Charter pillar: research. Doer: qnfo-research-exec via qnfo-code-orchestrator. The citation gate judges a reference by comparing its label with the title the index returns (titleAgrees at 0.9). labelOf (qnfo-research-exec/worker.js, inside CITATION_GATE) finds the label only for a markdown link [text](url) that contains the id or for a list item that starts with a bullet or "1." or "1)"; the fleet''s own reference lines are written "[1] Title. arXiv:2401.00001. https://arxiv.org/abs/2401.00001", which is neither, so the label is empty, titleAgrees answers judged false, and a real arXiv id under a wrong title passes. Seed S12 ("[1] Quantum Error Correction With Surface Codes. arXiv:1706.03762", index title "Attention Is All You Need") is not caught while the fabricated id, dead DOI and dead link seeds are. Lever: treat a leading "[n]" as a list marker in labelOf so the text after it, with the ids stripped, is the label; keep the one-link-per-line rule; add the case to qnfo-research-exec/citation-gate-ledger.test.mjs together with three accepted lines in the fleet format whose titles match their arXiv titles (including a title with LaTeX or a trailing version suffix) so the 0.9 threshold does not start holding good papers; measure first with ops_config research_citation_gate = measure for one publish cycle if the replayed bibliographies of the last 20 papers show any mismatch. Done: the newest scripts/seeded_claim_harness.mjs run catches S12 and flags none of its controls, the citation suites pass, and the held-paper count (CITATION-HELD issues) does not rise in the 24 hours after the deploy.
code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: function labelOf(line, id) {',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SEEDED-GAP-2:%' AND status = 'open');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1.00'' AS expected, printf(''%.2f'', COALESCE((SELECT AVG(caught) FROM seeded_claim_runs WHERE seed_id = ''S12-wrong-title'' AND ts >= datetime(''now'', ''-12 hours'')), 0)) AS observed',
    verify_transport = 'd1-query', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 6, module = 'seeded-claim-gap',
    precondition = 'SEEDED-GAP-2: seed S12 (a real arXiv id under a wrong title) is not caught by the citation gate',
    action = 'the code loop makes labelOf read the label of a [n] reference line; the seeded harness re-measures every 6 hours'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'SEEDED-GAP-2:%' AND status = 'open' ORDER BY id DESC LIMIT 1);
