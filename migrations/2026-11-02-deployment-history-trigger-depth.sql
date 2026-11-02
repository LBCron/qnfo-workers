-- TRIGGER-DEPTH-COMPILE-1 (issue 1001212, charter pillar reliability).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_deployment_history_depth_trigger
-- Rollback: recreate version_regression_files_issue_ins from the saved SQL in bak_20261102_deployment_history_depth_trigger.
-- The BEFORE version-monotonic guard remains authoritative. Its AFTER issue-filer duplicates the rejected-regression
-- path and introduces a deep agent_issues trigger chain into deployment_history writes.

CREATE TABLE IF NOT EXISTS bak_20261102_deployment_history_depth_trigger AS
SELECT name, tbl_name, sql FROM sqlite_master
WHERE type = 'trigger' AND name = 'version_regression_files_issue_ins';

DROP TRIGGER IF EXISTS version_regression_files_issue_ins;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1001212',
  'The AFTER version-regression issue trigger nests deployment_history writes into agent_issues, while the existing BEFORE monotonic guard already rejects unapproved regressions.',
  'TRIGGER-DEPTH-COMPILE-1: remove the redundant deployment_history issue-filer trigger and retain the monotonic guard.',
  'Live trigger inventory: version_regression_files_issue_ins writes agent_issues; the 2026-11-02 16:07:59 UTC compile sweep still refused deployment_history after fleet_tick_heavy recovered.',
  'pending CI migration and a passing fm-trigger-depth-compile sweep',
  'deployment_history_version_monotonic_ins, deployment_history_provenance_required_ins, deployment_history_deployed_at_norm_ins, deployment_history_mirrors_fleet_deploys_ins',
  'Restore version_regression_files_issue_ins using the saved SQL in bak_20261102_deployment_history_depth_trigger.',
  'deployment_history writes no longer enter the deep agent_issues trigger graph; version monotonicity and deploy mirroring remain.',
  'The next compile-time sweep reports no offending table and normal deployment_history writes compile.',
  'none',
  'live D1 sqlite_master and trigger-depth sweep; offline SQLite migration and behavior regression test'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'TRIGGER-DEPTH-COMPILE-1: remove the redundant deployment_history issue-filer trigger and retain the monotonic guard.'
);
