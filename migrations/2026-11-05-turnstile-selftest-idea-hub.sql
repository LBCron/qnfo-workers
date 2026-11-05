-- TURNSTILE-SELFTEST-1 (agent_issues 1000682, GitHub #5717, pillar security). Same finding and mechanism as migrations/2026-11-05-turnstile-selftest-ipatent.sql: the SECRET-CHANGE-WATCH-1 contract
-- of this issue asked for a counted siteverify success from three workers, which no worker recorded. Proven live 2026-11-05 03:00Z for qnfo-ipatent 3.20.1: cloud_ops_events carries
-- turnstile-selftest-qnfo-ipatent-<hour> rows with status ok and "secret accepted by Cloudflare [invalid-input-response]" for 2026-11-04T23, 11-05T00, T01, T02 and T03, and its contract passes.
-- idea-hub 1.18.1 runs the same self-test from its hourly scheduled handler; this contract now asks for the newest idea-hub row, by primary-key range.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_turnstile_selftest b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_turnstile_selftest b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1000682' AND EXISTS (SELECT 1 FROM bak_20261105_turnstile_selftest b WHERE b.class = 'issue-1000682');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''accepted'' AS expected, COALESCE((SELECT json_extract(meta, ''$.secret'') FROM cloud_ops_events WHERE id > ''turnstile-selftest-idea-hub-'' AND id < ''turnstile-selftest-idea-hub-~'' ORDER BY id DESC LIMIT 1), ''pending: no turnstile self-test row for idea-hub yet (it runs hourly once idea-hub 1.18.1 is live)'') AS observed',
    verify_transport = 'd1-query',
    status = 'active',
    last_verdict = NULL,
    attempts = 0,
    next_due_at = datetime('now')
WHERE class = 'issue-1000682' AND issue_id = 1000682;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'the Turnstile secret on idea-hub can be proven valid without a visitor, as it was for qnfo-ipatent (live rows 2026-11-04T23 to 2026-11-05T03, all accepted)',
       'TURNSTILE-SELFTEST-1: idea-hub 1.18.1 records an hourly self-test row; contract issue-1000682 reads it',
       'issue 1000682 contract could never pass: no worker recorded a siteverify outcome (agent_issues description, 2026-10-28); qnfo-ipatent proved the mechanism live',
       'the contract passes (secret accepted) within about 2 hours of the idea-hub deploy, or names a rejected secret',
       'cloud_ops_events gains at most 24 rows a day; one contract row changes',
       'Rollback restores the previous probe from bak_20261105_turnstile_selftest; the worker change is reverted by the canonical revert path',
       'a rotated Turnstile secret on idea-hub can be verified without owner traffic',
       'contract issue-1000682 observed = accepted within 2 hours of the deploy',
       'no external reach change',
       'offline vm suite scripts/turnstile-selftest.test.mjs; the same block live on qnfo-ipatent'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'TURNSTILE-SELFTEST-1: idea-hub%');
