-- TURNSTILE-SELFTEST-1 (agent_issues 1000683, GitHub #5718, pillar security; sibling issues 1000681 and 1000682 follow with their workers).
-- Finding (read 2026-11-04 from live qnfo-audit): SECRET-CHANGE-WATCH-1 opened 1000683 because TURNSTILE_SECRET was set on qnfo-ipatent at 2026-10-28T12:49:56Z. Its contract probe asked for a
-- counted siteverify success from each of three workers, but no worker records the outcome, so the probe could never pass and the secret could never be shown to work without a real visitor.
-- qnfo-ipatent 3.20.1 adds an hourly self-test (the bound secret posted to Cloudflare siteverify with a dummy token: invalid-input-response proves the secret, invalid-input-secret proves it wrong)
-- and records one cloud_ops_events row per worker and hour (kind turnstile-selftest). This contract now asks for exactly that row for qnfo-ipatent and reads the newest one by primary-key range.
-- It reads 'pending:' until the deploy and the first hour, and fails if the newest verdict is anything but accepted.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_turnstile_selftest b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_turnstile_selftest b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_turnstile_selftest);

CREATE TABLE IF NOT EXISTS bak_20261105_turnstile_selftest AS
SELECT class, issue_id, verify_probe, last_verdict, status FROM remediation_contracts WHERE class IN ('issue-1000681', 'issue-1000682', 'issue-1000683');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''accepted'' AS expected, COALESCE((SELECT json_extract(meta, ''$.secret'') FROM cloud_ops_events WHERE id > ''turnstile-selftest-qnfo-ipatent-'' AND id < ''turnstile-selftest-qnfo-ipatent-~'' ORDER BY id DESC LIMIT 1), ''pending: no turnstile self-test row for qnfo-ipatent yet (it runs hourly once qnfo-ipatent 3.20.1 is live)'') AS observed',
    verify_transport = 'd1-query',
    status = 'active',
    last_verdict = NULL,
    attempts = 0,
    next_due_at = datetime('now')
WHERE class = 'issue-1000683' AND issue_id = 1000683;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'the Turnstile secret on qnfo-ipatent can be proven valid without a visitor, because siteverify answers invalid-input-response for a valid secret and invalid-input-secret for a wrong one (checked 2026-11-04 against Cloudflare with Cloudflare''s published test secret and a deliberately wrong one)',
       'TURNSTILE-SELFTEST-1: qnfo-ipatent 3.20.1 records an hourly self-test row; contract issue-1000683 reads it',
       'issue 1000683 contract could never pass: no worker recorded a siteverify outcome (agent_issues description, 2026-10-28)',
       'the contract passes (secret accepted) within about 2 hours of the 3.20.1 deploy, or names a rejected secret',
       'cloud_ops_events gains at most 24 rows a day per worker; one contract row changes',
       'Rollback restores the previous probe from bak_20261105_turnstile_selftest; the worker change is reverted by the canonical revert path',
       'a rotated Turnstile secret can be verified without owner traffic',
       'contract issue-1000683 observed = accepted within 2 hours of the deploy',
       'no external reach change',
       'offline vm suite scripts/turnstile-selftest.test.mjs; live Cloudflare siteverify answers for test and wrong secrets'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TURNSTILE-SELFTEST-1: qnfo-ipatent%');
