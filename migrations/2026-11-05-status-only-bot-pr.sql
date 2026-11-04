-- STATUS-ONLY-PR-1 (2026-11-05, charter pillar autonomy; metric pr_open_over_10m, family BREACH-DOCTOR-1 cluster doctor-probes).
-- Measured 2026-11-04 on qnfo-audit pr_sla_state (48 hours): fleet-bot/apply-pending-patches opened 2 pull requests and both stayed open over 10 minutes (max 55);
-- the open one, PR 7285, changed one file, ci-status/apply-pending-report.json, and was CONFLICTING with main for 25 minutes (CONFLICT-REPAIR-DOER-1 refused it six
-- times: "Only VERSION-line and mirror conflicts" are repaired). Cause: the commit-back step of apply-pending-patches.yml ran `git add -A`, so the regenerated report
-- (timestamps change on every run) rode in the code pull request although the step "Commit the status artifact" already publishes ci-status/ to fleet-artifacts without
-- one. Fix is in the workflow (ci-status/ is unstaged before the code commit; scripts/apply-pending-status-only.test.mjs). This file records the failure mode and its
-- detector: an open fleet-bot/apply-pending-patches pull request older than 60 minutes, expected 0.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-status-only-bot-pr'; DELETE FROM failure_modes WHERE fm_key = 'status-only-bot-pr'; decision_log is append-only and remains.
-- spof-review: one failure mode row and one detector contract, no new dependency.

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
  ('status-only-bot-pr', 'a bot pull request that carries only a generated ci-status artifact conflicts with main and stays open',
   'apply-pending-patches.yml staged the whole tree (git add -A) before the code commit, so ci-status/apply-pending-report.json (rewritten with new timestamps on every run) became the only file of a code pull request that the lane cannot merge once main moves the same file; ci-status/ already publishes through push_head.sh artifact',
   'STATUS-ONLY-PR-1: the commit-back step unstages ci-status/ before the code commit; a run that landed no patch opens no pull request',
   'fm-status-only-bot-pr: open fleet-bot/apply-pending-patches pull requests older than 60 minutes, expected 0', 'fm-status-only-bot-pr', '2026-11-05',
   'pr_sla_state holds an open fleet-bot/apply-pending-patches pull request older than 60 minutes',
   'pr_open_over_10m stays above 0 on a pull request nobody can merge', 'every pull request-based metric and the 25 stale-lane reads it costs');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to)
VALUES
  ('fm-status-only-bot-pr', NULL,
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM pr_sla_state WHERE state = ''open'' AND head_ref = ''fleet-bot/apply-pending-patches'' AND last_seen >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 minutes'') AND opened_at < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-60 minutes'')) AS TEXT) AS observed',
   'd1-query', 3, 1, 'active', 'STATUS-ONLY-PR-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-remediation/roster-sla',
  'A generated status artifact needs no review and must not travel as a code pull request when the fleet-artifacts branch already carries it.',
  'STATUS-ONLY-PR-1: apply-pending-patches.yml unstages ci-status/ before the code commit; failure mode status-only-bot-pr with an open-pull-request detector; PR 7285 (status-only, CONFLICTING 25 minutes) closed with a comment.',
  'pr_sla_state 2026-11-04: fleet-bot/apply-pending-patches 2 of 2 pull requests over 10 minutes (max 55); PR 7285 changed only ci-status/apply-pending-report.json; replay in scripts/apply-pending-status-only.test.mjs fails on the old step (6 of 14 checks) and passes on the new.',
  'A run that lands no patch opens no pull request; a run that lands a patch opens one that holds only the patch.',
  'one workflow step; ci-status/ publication is unchanged (fleet-artifacts)',
  'Revert the workflow hunk; the Rollback line removes the detector and the failure mode.',
  'The bot no longer creates pull requests that only the owner of a generated file could resolve.',
  'pr_open_over_10m: the apply-pending-patches share of over-10-minute pull requests falls from 2 of 2 to 0 of 0 in the next 7 days (fleet-bot/apply-pending-patches opens only for a landed patch).',
  'none',
  'D1 pr_sla_state, apply-pending-patches.yml, scripts/apply-pending-status-only.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'STATUS-ONLY-PR-1:%');
