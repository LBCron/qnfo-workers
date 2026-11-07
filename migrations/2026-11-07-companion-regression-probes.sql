-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code');
-- BACKUP: none

-- COMPANION-UI-REGRESSION-GUARD-1: Add probes to prevent 'For the Quniverse' fleet asks 
-- from returning to personal companion (issue #8495, regression fixed in PR #8494)

-- Runtime probe: detects if 'For the Quniverse' text reappears on me.q08.org/companion
INSERT INTO remediation_contracts (
    class,
    verify_transport,
    contract_json,
    cadence_hours,
    owner,
    closes_issue_id,
    note
)
SELECT 
    'issue-8495-runtime',
    'runner-https',
    '{"url": "https://me.q08.org/companion", "status": 200, "absent": "For the Quniverse"}',
    1,
    'qnfo-cloud-ops',
    8495,
    'COMPANION-UI-REGRESSION-GUARD-1: runtime check that fleet asks UI clutter does not return to personal companion Today tab'
WHERE NOT EXISTS (
    SELECT 1 FROM remediation_contracts WHERE class = 'issue-8495-runtime'
);

-- Code probe: detects if fleetAsks() function is reintroduced to personal-api
INSERT INTO remediation_contracts (
    class,
    verify_transport,
    contract_json,
    cadence_hours,
    owner,
    closes_issue_id,
    note
)
SELECT 
    'issue-8495-code',
    'code-read',
    '{"paths": ["personal-api/worker.js"], "absent": "function fleetAsks"}',
    1,
    'qnfo-cloud-ops',
    8495,
    'COMPANION-UI-REGRESSION-GUARD-1: code check that fleetAsks function does not return to personal-api'
WHERE NOT EXISTS (
    SELECT 1 FROM remediation_contracts WHERE class = 'issue-8495-code'
);
