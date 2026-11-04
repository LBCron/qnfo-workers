-- RAG-HYBRID-BASELINE-1 (2026-11-05, charter pillar cost, program QNFO.RSCH; agent_issues 1000640 = GitHub 5689, roadmap_implementation 1684 = GitHub 5561).
-- The contract issue-1000640 compared the literal 'record of ASK-LOOP-1 hybrid+rerank A/B with latency and token cost' with a row description, so expected could never equal observed
-- (253 failed verifications); it also matched ask_evals id 60 (change rerank=true, 2026-11-02), a pair from before the rerank parameter was wired into corpusSearch, which compared a config
-- with itself. qnfo-ai-search 2.14.0 wires cfg.rerank into the AI Search request, restores rerank to the golden-set loop and records mean_ms, rerank and rerank_calls in both arms of the pair.
-- The probe below passes on that pair (a champion row and the rerank challenger row it belongs to, each with mean_ms and rerank_calls) once its experiment has a decision (adopted or rejected).
-- It does not close the question "keep the cheaper arm that holds quality": that needs 3 or more pairs and is filed as the ROADMAP-1 row at the end of this file, with its own probe.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_f1e_rag b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_f1e_rag b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_f1e_rag); UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_f1e_rag b WHERE b.class = 'issue-1000640') WHERE id = 1000640 AND EXISTS (SELECT 1 FROM bak_20261105_f1e_rag WHERE class = 'issue-1000640'); UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity:%' AND status = 'open' AND EXISTS (SELECT 1 FROM issue_triage WHERE issue_id = agent_issues.id AND close_evidence IS NOT NULL);
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: one probe text on one contract; no new loop, cron or gate.

CREATE TABLE IF NOT EXISTS bak_20261105_f1e_rag AS
SELECT c.class AS class, c.verify_probe AS verify_probe, c.verify_transport AS verify_transport, a.description AS description
FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id
WHERE c.class = 'issue-1000640';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM ask_evals h WHERE h.kind = ''retrieval-challenger'' AND json_extract(h.detail, ''$.change'') LIKE ''rerank=%'' AND json_extract(h.detail, ''$.rerank_calls'') IS NOT NULL AND json_extract(h.detail, ''$.mean_ms'') IS NOT NULL AND EXISTS (SELECT 1 FROM ask_evals c WHERE c.kind = ''retrieval-champion'' AND c.id < h.id AND c.id >= h.id - 3 AND json_extract(c.detail, ''$.rerank_calls'') IS NOT NULL AND json_extract(c.detail, ''$.mean_ms'') IS NOT NULL) AND EXISTS (SELECT 1 FROM experiments e WHERE e.id LIKE ''ASK-TUNE-R-%-rerank'' AND e.status IN (''adopted'', ''rejected''))) THEN ''ok'' ELSE ''no ask_evals champion and challenger pair for the rerank key with mean_ms and rerank_calls, or no decided experiment'' END AS observed',
    verify_transport = 'd1-query'
WHERE class = 'issue-1000640';

UPDATE agent_issues
SET description = description || char(10) || char(10) ||
  'STATE (RAG-HYBRID-BASELINE-1, 2026-11-05, session F1-research-reach/E): the default Ask path is already hybrid plus cross-encoder rerank (PR 6365, qnfo-ai-search 2.12.9 sends rerank true per query; live GET /instances on 2026-11-04: qnfo-corpus has hybrid_search_enabled true, fusion rrf and reranking false at instance level). PR 6365 also took the rerank entry out of TUNE_SPACE; before it that entry was never read by corpusSearch, so ask_evals id 60 (change rerank=true, 2026-11-02) compared a config with itself. qnfo-ai-search 2.14.0 reads cfg.rerank in corpusSearch, restores rerank to TUNE_SPACE and RETRIEVAL_KEYS, makes rerank the daily key until a pair is on record, runs one unscored warm-up retrieval (the champion arm used to pay the catalog download: 6608 ms champion against 2871 ms challenger for the same config on 2026-11-03) and adds rerank and rerank_calls next to mean_ms in both arms of the ask_evals detail. Adoption stays on the existing win rule (MRR +0.03, latency at most +20 percent). The closing probe now reads the recorded pair and its decided experiment. Remains: the pair itself (the first 03:4x UTC tick after the 2.14.0 deploy) and the cheaper-arm-holds-quality rule, which needs 3 or more pairs (follow-up ROADMAP-1: QNFO.RSCH #rag-rerank-parity). Not verified: a live rerank=false request to the AI Search API (offline suite only).',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 1000640 AND instr(description, 'STATE (RAG-HYBRID-BASELINE-1') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity: keep the cheaper rerank arm when quality holds, decided from 3 recorded pairs',
       'Charter pillar: cost. Program QNFO.RSCH. Metric to move: ask_cost_per_answer_usd_7d; guards ask_grounded_share_7d and ask_retrieval_mrr must not fall. Parent: agent_issues 1000640 (RM-RAG-HYBRID-BASELINE-1, GitHub 5689). The lever of the parent is to keep the cheaper of hybrid and hybrid plus cross-encoder rerank that holds quality; its first step (qnfo-ai-search 2.14.0) records the pair but adopts only by the win rule (MRR +0.03, latency at most +20 percent), so a rerank=false arm that ties on MRR is never adopted.' || char(10) ||
       'START ONLY WHEN 3 or more rerank pairs are recorded: SELECT ts, cfg, score, detail FROM ask_evals WHERE kind IN (''retrieval-champion'', ''retrieval-challenger'') AND json_extract(detail, ''$.rerank_calls'') IS NOT NULL ORDER BY id DESC LIMIT 12. If fewer than 3 challenger rows with change rerank=false or rerank=true come back, stop and leave this issue open (the loop adds a pair on its next daily tick that picks the rerank key). The golden set is 16 questions with MRR near 0.95 and the same config read 802 to 6608 ms across ticks, so read the pairs together, not one.' || char(10) ||
       'Decide: if rerank=false held MRR within 0.02 of rerank=true in every pair, add a rerank-only adoption rule in tuneRetrieval (the challenger that drops the rerank call is adopted on parity), mark it RAG-RERANK-PARITY-1, test it offline in qnfo-ai-search/ask-loop.test.mjs, and write experiments row RAG-RERANK-PARITY-1 with status adopted. If rerank=true gained MRR in any pair, write the same row with status kept and the three pair ids in its hypothesis column. Definition of done: experiments row RAG-RERANK-PARITY-1 exists with a decision, and at least 3 rerank pairs are recorded.' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-ai-search/worker.js' || char(10) ||
       'code-anchor: var win = res.mrr >= base.mrr + 0.03 && res.mean_ms <= base.mean_ms * 1.2 + 200;',
       'claude-session', 'reliability', 'medium', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity:%');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, budget_ms, max_items, requires_container)
SELECT 'issue-' || a.id, a.id, 'qnfo-ai-search 2.14.0 is deployed and the daily golden-set loop has run', 'Read the recorded rerank pairs and decide the rerank-only adoption rule (RAG-RERANK-PARITY-1)',
       'SELECT ''ok'' AS expected, ''pending'' AS observed', 'd1-query', 3, 'qnfo-ai-search', 24, 'active', 'issue', 45000, 5, 0
FROM agent_issues a WHERE a.title LIKE 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity:%';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ask_evals WHERE kind = ''retrieval-challenger'' AND json_extract(detail, ''$.change'') LIKE ''rerank=%'' AND json_extract(detail, ''$.rerank_calls'') IS NOT NULL) >= 3 AND EXISTS (SELECT 1 FROM experiments WHERE id = ''RAG-RERANK-PARITY-1'' AND status IN (''adopted'', ''kept'')) THEN ''ok'' ELSE ''rerank pairs recorded: '' || (SELECT COUNT(*) FROM ask_evals WHERE kind = ''retrieval-challenger'' AND json_extract(detail, ''$.change'') LIKE ''rerank=%'' AND json_extract(detail, ''$.rerank_calls'') IS NOT NULL) || '', experiments RAG-RERANK-PARITY-1 decided: '' || (SELECT COUNT(*) FROM experiments WHERE id = ''RAG-RERANK-PARITY-1'' AND status IN (''adopted'', ''kept'')) END AS observed',
    verify_transport = 'd1-query'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity:%' LIMIT 1);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session F1-research-reach/E (2026-11-04 open-issue sweep)',
       'the rerank A/B of the golden-set loop is meaningful only if cfg.rerank reaches the AI Search request and both arms carry latency and call counts',
       'RAG-HYBRID-BASELINE-1: wire cfg.rerank into corpusSearch, restore rerank to the tuned keys, record mean_ms, rerank and rerank_calls per arm, replace the unsatisfiable probe of issue-1000640',
       'ask_evals id 60 (rerank=true, 2026-11-02) ran against a corpusSearch that ignored the flag; contract issue-1000640 failed 253 times comparing a literal with a description; live /instances shows reranking false at instance level',
       'qnfo-ai-search 2.14.0 PR plus this migration; baseline stays hybrid plus rerank until the win rule adopts otherwise',
       'qnfo-ai-search retrieval eval and pipeline_flags ask_config (rerank only when the loop adopts it); issue-1000640 contract',
       'revert the PR; Rollback line of migrations/2026-11-05-rag-hybrid-baseline-probe.sql restores the probe and description from bak_20261105_f1e_rag',
       'the loop can now measure what the reranker costs next to what it gains',
       'an ask_evals champion and challenger pair with rerank_calls appears within 24 hours of the deploy (first 03:4x UTC tick); the contract issue-1000640 then passes',
       'no external reach change',
       'ask-loop.test.mjs section 8a (offline: pair recorded, adoption persisted through the generation save, live path honours it)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RAG-HYBRID-BASELINE-1:%');
