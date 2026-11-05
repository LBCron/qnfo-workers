-- F1E-FOLLOWUP-CONTRACTS-REARM-1 (2026-11-05, charter pillars research and autonomy; agent_issues ROADMAP-1 #rag-rerank-parity 1001862 and ROADMAP-1 #memory-consolidation 1001939).
-- The migrations 2026-11-05-rag-hybrid-baseline-probe.sql and 2026-11-05-memory-tiering-store.sql each filed a ROADMAP-1 row and then replaced the probe of its issue-<id> contract.
-- The trigger contract_probe_templates_v3_generic (ORPHAN-GUARD-BIRTH-1) had already inserted that contract at birth as status superseded with the vacuous template, and an UPDATE of verify_probe
-- leaves the status alone: read from qnfo-audit after the merges, both contracts hold the measuring probe and status superseded, so neither is ever probed and neither issue could close.
-- This re-arms them (status active, due now), with a precondition and action that say what the contract is for. The third row filed the same way, ROADMAP-1 #qwav-demos (1001909), took its
-- contract from the code-probe line and is active; it is not touched.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261105_f1e_rearm b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_f1e_rearm b WHERE b.class = remediation_contracts.class), next_due_at = (SELECT b.next_due_at FROM bak_20261105_f1e_rearm b WHERE b.class = remediation_contracts.class), precondition = (SELECT b.precondition FROM bak_20261105_f1e_rearm b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_f1e_rearm b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_f1e_rearm);
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: two contract rows re-armed; no new loop, cron or gate.

CREATE TABLE IF NOT EXISTS bak_20261105_f1e_rearm AS
SELECT c.class AS class, c.status AS status, c.last_verdict AS last_verdict, c.next_due_at AS next_due_at, c.precondition AS precondition, c.action AS action
FROM remediation_contracts c
WHERE c.class IN (SELECT 'issue-' || a.id FROM agent_issues a WHERE a.title LIKE 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity:%' OR a.title LIKE 'ROADMAP-1: QNFO.INFRA #memory-consolidation:%');

UPDATE remediation_contracts
SET status = 'active', next_due_at = datetime('now'), attempts = 0,
    precondition = 'qnfo-ai-search 2.14.0 is deployed and the daily golden-set loop has recorded 3 or more rerank pairs (migrations/2026-11-05-rag-hybrid-baseline-probe.sql)',
    action = 'Decide the rerank-only adoption rule from the recorded pairs and write experiments row RAG-RERANK-PARITY-1 (adopted or kept)',
    last_verdict = 'rearmed: F1E-FOLLOWUP-CONTRACTS-REARM-1 (born superseded by the vacuous template, then given a measuring probe that the status kept from running)'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.RSCH #rag-rerank-parity:%' LIMIT 1)
  AND status = 'superseded' AND instr(verify_probe, 'experiments WHERE id = ''RAG-RERANK-PARITY-1''') > 0;

UPDATE remediation_contracts
SET status = 'active', next_due_at = datetime('now'), attempts = 0,
    precondition = 'qnfo-memory-mcp 2.9.0 is deployed and the memory tools are in use (migrations/2026-11-05-memory-tiering-store.sql)',
    action = 'Consolidate episodic memories into semantic rows and record the run in memory_consolidation_runs, or record that the tools are unused and retire the feature',
    last_verdict = 'rearmed: F1E-FOLLOWUP-CONTRACTS-REARM-1 (born superseded by the vacuous template, then given a measuring probe that the status kept from running)'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA #memory-consolidation:%' LIMIT 1)
  AND status = 'superseded' AND instr(verify_probe, 'FROM memory_consolidation_runs WHERE semantic_out > 0') > 0;
