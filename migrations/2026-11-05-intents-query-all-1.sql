-- INTENTS-QUERY-ALL-1 (2026-11-05, charter pillar autonomy; agent_issues 1001339). The ops intents_query tool sends status=all and
-- qnfo-intent-orchestrator GET /intents compared it to the status column (WHERE status = 'all'), so a store holding 409 intents answered
-- {"count":0}. qnfo-intent-orchestrator 1.7.7 reads all (and *) as no filter; qnfo-intent-orchestrator/intents-status-all.test.mjs proves it offline.
-- The old probe counted intents whose status is the literal 'all' against the total, which no fix can satisfy and no defect-free store passes.
-- The new contract is the deploy check (runner-https, min_version 1.7.7); /intents needs the intent bearer token, so behaviour is held by the suite.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_transport = 'd1-query', module = 'probe-template-v3-generic', verify_probe = 'SELECT ''status_all_check'' AS label, CAST((SELECT COUNT(*) FROM intents) AS TEXT) AS expected, CAST((SELECT COUNT(*) FROM intents WHERE status = ''all'') AS TEXT) AS observed', attempts = 0, last_verdict = NULL, next_due_at = datetime('now') WHERE class = 'issue-1001339' AND issue_id = 1001339;

UPDATE remediation_contracts
SET verify_transport = 'runner-https',
    module = 'probe-line-sweep-v1',
    verify_probe = '{"url": "https://qnfo-intent-orchestrator.q08.workers.dev/health", "status": 200, "contains": "qnfo-intent-orchestrator", "min_version": "1.7.7"}',
    action = 'INTENTS-QUERY-ALL-1: qnfo-intent-orchestrator 1.7.7 or later is live, where GET /intents?status=all lists every intent (suite: qnfo-intent-orchestrator/intents-status-all.test.mjs). Replaces the VACUOUS-PROBE-V3-1 probe that counted rows whose status is the literal all.',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1001339' AND issue_id = 1001339
  AND verify_probe LIKE '%status_all_check%';
