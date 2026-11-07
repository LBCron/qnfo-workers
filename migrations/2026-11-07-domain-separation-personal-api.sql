-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'domain-separation-personal-api';
-- BACKUP: none

-- DOMAIN-SEPARATION-PERSONAL-API-1: Enforce q08.org=personal, qnfo.org=fleet separation
-- Personal workers must not contain fleet-related code

INSERT INTO remediation_contracts (
    class,
    verify_transport,
    contract_json,
    cadence_hours,
    owner,
    note
)
SELECT 
    'domain-separation-personal-api',
    'code-read',
    '{"paths": ["personal-api/worker.js"], "absent": "fleet"}',
    1,
    'qnfo-cloud-ops',
    'DOMAIN-SEPARATION-1: personal-api must not contain fleet-related functions or references'
WHERE NOT EXISTS (
    SELECT 1 FROM remediation_contracts WHERE class = 'domain-separation-personal-api'
);
