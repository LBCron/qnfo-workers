-- PAPER-PROVENANCE-PROBE-TRANSPORT-1 (#6529, charter pillar core).
-- issue-1000641 reads papers and its change ledger in living-paper, not qnfo-audit.
-- The unchanged probe returned expected=1.00, observed=1.00 against living-paper.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_transport = 'd1-query', last_verdict = NULL, next_due_at = datetime('now') WHERE class = 'issue-1000641' AND verify_transport = 'd1-query@living-paper'; UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-paper-provenance-probe-transport';

UPDATE remediation_contracts
SET verify_transport = 'd1-query@living-paper',
    last_verdict = NULL,
    attempts = 0,
    deferred_since = NULL,
    next_due_at = datetime('now')
WHERE class = 'issue-1000641'
  AND status = 'active'
  AND verify_transport = 'd1-query';

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('paper-provenance-probe-transport', 'Paper provenance verification queries the wrong D1 database',
   'issue-1000641 uses the audit transport for living-paper tables',
   'Route the unchanged provenance probe through d1-query@living-paper',
   'fm-paper-provenance-probe-transport', 'fm-paper-provenance-probe-transport',
   '2026-11-03', 1000641);

INSERT OR IGNORE INTO remediation_contracts
  (class, precondition, action, verify_probe, verify_transport, max_attempts,
   escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-paper-provenance-probe-transport', 'Paper provenance contract must read living-paper',
   'Correct issue-1000641 verify_transport to d1-query@living-paper without changing its predicate.',
   'SELECT ''0'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM remediation_contracts WHERE class = ''issue-1000641'' AND verify_transport = ''d1-query@living-paper'') THEN ''0'' ELSE ''1'' END AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'paper-provenance-probe-transport');
