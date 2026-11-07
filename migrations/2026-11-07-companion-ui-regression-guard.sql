-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_remediation_contracts_companion_ui
-- Rollback: DELETE FROM remediation_contracts WHERE class IN ('issue-8495-runtime', 'issue-8495-code'); DROP TABLE IF EXISTS bak_20261107_remediation_contracts_companion_ui;
--
-- COMPANION-UI-REGRESSION-GUARD-1: prevent fleet asks from returning to Today tab
-- Adds runtime and code probes to detect if 'For the Quniverse' UI clutter reappears

-- Create backup
CREATE TABLE IF NOT EXISTS bak_20261107_remediation_contracts_companion_ui AS 
SELECT * FROM remediation_contracts WHERE 1=0;

-- Add runtime probe: detects if 'For the Quniverse' text appears on Today
INSERT INTO remediation_contracts (
  class, verify_transport, verify_probe, verify_cadence_h, hit_action, issue_id, description
) VALUES (
  'issue-8495-runtime',
  'runner-https',
  '{"url": "https://me.q08.org/companion", "status": 200, "absent": "For the Quniverse"}',
  1,
  'runtime',
  8495,
  'COMPANION-UI-REGRESSION-GUARD-1: Ensure ''For the Quniverse'' text does not appear on me.q08.org/companion'
);

-- Add code probe: detects if fleetAsks function is reintroduced
INSERT INTO remediation_contracts (
  class, verify_transport, verify_probe, verify_cadence_h, hit_action, issue_id, description
) VALUES (
  'issue-8495-code',
  'code-read',
  '{"paths": ["personal-api/worker.js"], "absent": "function fleetAsks"}',
  1,
  'code',
  8495,
  'COMPANION-UI-REGRESSION-GUARD-1: Ensure fleetAsks function not reintroduced in personal-api'
);
