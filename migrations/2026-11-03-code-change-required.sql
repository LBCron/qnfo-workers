-- CODE-CHANGE-REQUIRED-1 (2026-11-03, program QNFO.OPS, charter pillar autonomy).
-- Prediction: zero empty/investigation-only PRs opened by the code publisher after deployment;
-- finished Copilot no-code PRs are closed on the next lifecycle pass, with their issues kept open.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'OWNER_DIRECTIVE_2026_11_03_CODE_CHANGE_REQUIRED_1'; DELETE FROM remediation_contracts WHERE class = 'fm-pr-code-change-required'; DELETE FROM failure_modes WHERE fm_key = 'pr-no-code-deliverable'; DELETE FROM control_registry WHERE control = 'pr-code-change-required'; DELETE FROM capability_ledger WHERE capability = 'pr-code-delivery-contract';

INSERT OR IGNORE INTO ops_config (key, value) VALUES
('OWNER_DIRECTIVE_2026_11_03_CODE_CHANGE_REQUIRED_1',
 'All issues and subsequent PRs require a code change in their definition of done. No empty, documentation-only or investigate-only PRs. Implement and test before publishing; if implementation already exists, record evidence on the issue rather than filing a no-change PR.');

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('pr-no-code-deliverable', 'Investigations are filed as PRs with no implementation change',
  'The documentation guard ran only at merge, exempted prose naming other PRs, and accepted empty file lists; finished Copilot empty drafts waited 30 minutes and ready no-code PRs were not cleaned up',
  'Require an implementation diff before publish/open/merge; attach code-change DoD to issue intake and PR creation; close finished no-code Copilot PRs on the next lifecycle pass while preserving open issues',
  'fm-pr-code-change-required', 'fm-pr-code-change-required', '2026-11-03',
  'A producer considers an investigation or empty diff complete',
  'Finished no-code PRs occupy delivery slots without fixing their linked issues',
  'Code publisher, fleet merge lane, Copilot lifecycle, issue intake and dispatch');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-pr-code-change-required', NULL,
  '{"paths":["scripts/code-task-publish.py"],"contains":"CODE-CHANGE-REQUIRED-1: staged diff has no code changes"}',
  'code-read', 1000, 1, 'active',
  'Code publisher is sourced from main; offline suites cover rejection and successful code delivery',
  'Restore code-change enforcement at publication if its source check regresses; the fleet runners own live verification',
  'program-manager:QNFO.OPS', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO control_registry
 (control, location, kind, guards_against, critical_path, disposition, disposition_state, evidence)
VALUES
 ('pr-code-change-required', 'scripts/code-task-publish.py; qnfo-fleet-control cmOpenDecide/cmDecide/bhMergeDecide; scripts/copilot-pr-lifecycle.mjs',
  'gate', 'No-code investigation reports being counted as implemented remedies',
  0, 'keep', 'applied',
  'Owner directive 2026-11-03; no-code cases rejected before publishing/opening/merging; finished no-code PRs close without closing their issues; running sessions remain untouched');

INSERT OR IGNORE INTO capability_ledger
 (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
 ('pr-code-delivery-contract', 'CODE-CHANGE-REQUIRED-1', 'Existing code publisher, fleet merge runner, issue steward and Copilot lifecycle',
  0.5, datetime('now'), 'Mandatory implementation DoD at intake and creation, pre-publication checks and finished no-code PR cleanup; deployment verification remains pending');

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
 'copilot:code-change-required',
 'An investigation-only PR is not an implementation deliverable',
 'Require a code-change DoD on issue dispatch and PR creation; enforce before publication, opening and merging; clean up finished no-code PRs',
 'Repository read: cmDocsOnly returned false for empty lists and allowed documentation exemptions; the lifecycle closed only finished empty drafts after 30 minutes',
 'pending live verification',
 'QNFO.OPS issue intake and engineering delivery',
 'Revert the code-change PR through the canonical path; execute this migration rollback for registry records only; decision_log stays append-only',
 'pr-code-delivery-contract',
 'Zero no-code PRs opened by the publisher; finished no-code Copilot PRs closed on the next lifecycle pass; implementation diffs and active sessions preserved',
 'No external reach change',
 'Publisher selftests; assignment, lifecycle, docs-only and branch-hygiene regression suites';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT
 'CODE-CHANGE-REQUIRED-1: enforce implementation diffs on main',
 'QNFO.OPS; charter pillar autonomy. Implementation is tracked by GitHub issue #6487 and PR #6489. The code publisher and merge lanes must reject empty and investigation-only diffs, all issue and PR definitions of done must require implementation changes, and the lifecycle must close finished no-code PRs without closing their issues. Regression suites passed locally; deployment and production outcome verification remain with the fleet. Do not publish an investigation-only PR: record existing implementation evidence on this issue when no further remedy is needed.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: async function evOpenPr(env, cid, worker, dir, newContent, title, body) {' || char(10) ||
 'code-probe: {"paths":["scripts/code-task-publish.py"],"contains":"CODE-CHANGE-REQUIRED-1: staged diff has no code changes"}',
 'copilot:code-change-required', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (
 SELECT 1 FROM agent_issues
 WHERE title = 'CODE-CHANGE-REQUIRED-1: enforce implementation diffs on main' AND status = 'open'
);

INSERT INTO session_records
 (session_id, wbs_code, agent_name, summary, decisions_made, files_changed, commits, infrastructure_changes,
  handoff_notes, execution_ratio, total_tasks, completed_tasks, started_at, completed_at, created_at)
SELECT
 'copilot-code-change-required-20261103', 'QNFO.OPS', 'GitHub Copilot',
 'Implemented code-change DoD at issue intake and PR publication, rejected no-code diffs before publication and both merge lanes, and closed finished no-code Copilot PRs while preserving issues and active sessions.',
 'Require implementation in each PR itself; remove documentation exemptions; preserve active harness sessions; extend the existing same-issue PR #6489 instead of opening another PR.',
 'scripts/code-delivery.mjs; scripts/code_delivery.py; scripts/code-task-publish.py; scripts/conflict_repair.py; scripts/copilot-pr-lifecycle.mjs; scripts/assign-copilot-sweep.mjs; qnfo-fleet-control; qnfo-github-steward; regression suites; CLAUDE.md',
 'Implementation branch for PR #6489; merge and deployment not claimed at session closeout',
 'CI-applied directive, failure mode, detector, control, capability and decision records',
 'Canonical lane owns PR #6489, migration application and deployment. The issue above verifies the source guard on main, not live behavior; production no-code delivery and active-session preservation must also be checked before closing GitHub issue #6487. Integrated full suite: 1157 passed, 32 failed. Twenty-one failures reproduced on the unchanged starting revision; the eleven failures introduced by incoming main also reproduced on unchanged PR base c503478.',
 0.6666666667, 3, 2, '2026-11-03T03:40:00Z', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM session_records WHERE session_id = 'copilot-code-change-required-20261103');
