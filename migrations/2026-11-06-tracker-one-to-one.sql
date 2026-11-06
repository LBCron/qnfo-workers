-- TRACKER-D1-CANON-1 (2026-11-06, pillar autonomy; owner directive 2026-11-06: "one-to-one correspondence between the issues in D1 and the issues mirrored on GitHub ... D1 are canonical")
-- Measured 2026-11-06: 574 open agent_issues; 365 open mirrors; 154 mirrors closed on GitHub while D1 is open (134 by REPOSITORY-AGE-POLICY-1, 128 of them critical); 55 open rows unmirrored
-- (gh_individual_priorities = critical rolls high, medium and low into digests). Both gaps break the 1:1 mirror. Code side (same PR): the age policy skips fleet-issue mirrors and the steward reopens
-- a mirror it closed that way. THIS CHANGES: ops_config gh_individual_priorities is removed, so every priority is one GitHub issue again (the documented ISSUE-ROLLUP-1 revert); the steward
-- mirrors the 55 and reopens the age-policy closes at its per-tick cap. Nothing changes in agent_issues. Open issues fall by being resolved with evidence, not by being hidden.
-- Rollback: INSERT OR REPLACE INTO ops_config (key, value, note) SELECT key, value, note FROM bak_20261106_ops_config_gh_individual WHERE key = 'gh_individual_priorities';
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261106_ops_config_gh_individual

CREATE TABLE IF NOT EXISTS bak_20261106_ops_config_gh_individual AS
SELECT * FROM ops_config WHERE key = 'gh_individual_priorities';

DELETE FROM ops_config WHERE key = 'gh_individual_priorities';
