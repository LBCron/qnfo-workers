-- EK-2-COVERAGE-1 closing probe (2026-11-05, charter pillar reach; session W2-G). agent_issues EK-2-COVERAGE-1 (id 1002100, filed by migration 2026-11-05-ek2-coverage-1.sql) was born with the circular birth probe
-- (superseded: CLOSE-PROBE-CIRCULAR-1), so nothing would ever close it. Its measuring probe is the code state of its first slice: the worker writes companion_contested_supply_share_7d (supply share, counts only).
-- Revert: set the contract back to superseded with the rollback below.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', verify_transport = 'd1-query' WHERE class IN (SELECT 'issue-' || id FROM agent_issues WHERE title LIKE 'EK-2-COVERAGE-1:%');
-- CAUSE-MAPPED: registers no metric_registry row.
-- NOOP-OK: the UPDATE matches only a superseded contract; a replay after activation changes nothing.

UPDATE remediation_contracts
SET verify_transport = 'code-read',
    verify_probe = '{"paths": ["personal-companion/worker.js"], "contains": "companion_contested_supply_share_7d"}',
    status = 'active', module = 'ek2-coverage-2026-11-05', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 1, max_attempts = 3,
    action = 'machine probe: the worker writes companion_contested_supply_share_7d (EK-2-COVERAGE-1, 2026-11-05)'
WHERE class IN (SELECT 'issue-' || id FROM agent_issues WHERE title LIKE 'EK-2-COVERAGE-1:%' AND status = 'open')
  AND status = 'superseded';
