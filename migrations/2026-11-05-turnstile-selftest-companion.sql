-- TURNSTILE-SELFTEST-1 (agent_issues 1000681, GitHub #5716, pillar security): third of three workers; same finding and mechanism as migrations/2026-11-05-turnstile-selftest-ipatent.sql.
-- The SECRET-CHANGE-WATCH-1 contract of this issue asked for a counted siteverify success from three workers, which no worker recorded. Live on qnfo-ipatent since 2026-11-04T23Z: one row an hour,
-- status ok, "secret accepted by Cloudflare [invalid-input-response]". personal-companion 1.45.4 runs the same self-test from its hourly tick (cron "0 21 * * *" excepted); this contract now asks
-- for the newest personal-companion row, by primary-key range.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_turnstile_selftest b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_turnstile_selftest b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1000681' AND EXISTS (SELECT 1 FROM bak_20261105_turnstile_selftest b WHERE b.class = 'issue-1000681');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''accepted'' AS expected, COALESCE((SELECT json_extract(meta, ''$.secret'') FROM cloud_ops_events WHERE id > ''turnstile-selftest-personal-companion-'' AND id < ''turnstile-selftest-personal-companion-~'' ORDER BY id DESC LIMIT 1), ''pending: no turnstile self-test row for personal-companion yet (it runs hourly once personal-companion 1.45.4 is live)'') AS observed',
    verify_transport = 'd1-query',
    status = 'active',
    last_verdict = NULL,
    attempts = 0,
    next_due_at = datetime('now')
WHERE class = 'issue-1000681' AND issue_id = 1000681;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'the Turnstile secret on personal-companion can be proven valid without a visitor, as it was for qnfo-ipatent',
       'TURNSTILE-SELFTEST-1: personal-companion 1.45.4 records an hourly self-test row; contract issue-1000681 reads it',
       'issue 1000681 contract could never pass: no worker recorded a siteverify outcome (agent_issues description, 2026-10-28); qnfo-ipatent proved the mechanism live',
       'the contract passes (secret accepted) within about 2 hours of the deploy, or names a rejected secret',
       'cloud_ops_events gains at most 24 rows a day; one contract row changes',
       'Rollback restores the previous probe from bak_20261105_turnstile_selftest; the worker change is reverted by the canonical revert path',
       'a rotated Turnstile secret on personal-companion can be verified without owner traffic',
       'contract issue-1000681 observed = accepted within 2 hours of the deploy',
       'no external reach change',
       'offline vm suite scripts/turnstile-selftest.test.mjs; the same block live on qnfo-ipatent'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TURNSTILE-SELFTEST-1: personal-companion%');
