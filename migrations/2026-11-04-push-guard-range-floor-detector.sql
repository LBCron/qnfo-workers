-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = '{"paths": [".github/workflows/version-bump-guard.yml"], "contains": "cancel-in-progress: ${{ github.ref != ''refs/heads/main'' }}"}' WHERE class = 'fm-push-guard-cancelled-on-main'; UPDATE failure_modes SET remediation = 'PR-GUARD-FIXES-1: a push to main has a group per commit and is never cancelled; a branch or pull request keeps the per-ref group and the cancel', detector = 'code-read of .github/workflows/version-bump-guard.yml for the per-sha group on main and the cancel only off main' WHERE fm_key = 'push-guard-cancelled-on-main';
-- The Rollback leaves the decision row: decision_log is append-only.
-- MAIN-RED-SUITES-1 / MAIN-GUARD-RANGE-FLOOR-1 (2026-11-04, charter pillar autonomy; ci-watchdog issue 7070, deploy-gate full set red on main from 17:07Z).
-- PUSH-COALESCE-1 (pull request 7001) made a newer push to main cancel the older version-bump-guard run, which reverses the rule PR-GUARD-FIXES-1 (2026-10-20, agent_issues 100295)
-- put in place and that the detector `fm-push-guard-cancelled-on-main` reads: `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. The detector therefore read
-- `missing-marker` against main (migrations/pr-guard-fixes.test.mjs red in the full suite set, and the live contract red for the same reason).
-- Coalescing is kept (38 merges an hour queued one guard run per sha), and the hole it opens is closed in the workflow instead: the range step of a push to main starts at the
-- head of the last GREEN push run of the guard (MAIN-GUARD-RANGE-FLOOR-1), so the newest run reads the range a cancelled run would have read. This file repoints the detector to
-- that line (the echo "range floor is the last green guard run", present once in the workflow) and rewrites the failure mode's remediation and detector text to match.
-- Only the one contract and the one failure mode change; a second run writes the same values, and the decision row is guarded by NOT EXISTS.
UPDATE remediation_contracts SET verify_probe = '{"paths": [".github/workflows/version-bump-guard.yml"], "contains": "range floor is the last green guard run"}'
 WHERE class = 'fm-push-guard-cancelled-on-main';

UPDATE failure_modes SET
  remediation = 'PUSH-COALESCE-1 (#7001) lets a newer push to main cancel the older guard run; MAIN-GUARD-RANGE-FLOOR-1: the range of a push to main starts at the head of the last green guard run (an ancestor of event.before, at most 300 commits back), so the newest run validates the range a cancelled run would have',
  detector = 'code-read of .github/workflows/version-bump-guard.yml for the range floor of a push to main'
 WHERE fm_key = 'push-guard-cancelled-on-main';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:github-issues-resolution',
  'a cancelled push run is only a loss when nobody else reads its range; widening the newest run to the last green head is a superset of before..after, so it can only be stricter, and it keeps the runner-queue saving of PUSH-COALESCE-1',
  'MAIN-GUARD-RANGE-FLOOR-1: version-bump-guard.yml starts the range of a push to main at the last green push run of the guard; the detector fm-push-guard-cancelled-on-main reads that line; eight suites made stale by THREE-PR-WORKFLOWS-1, TWO-PR-WORKFLOWS-1 and PUSH-COALESCE-1 are updated to the new workflow shapes',
  'ci-watchdog issue 7070: deploy-gate push runs 41874391546, 41875824963, 41882390338 and 41889103539 red on main with eight suites failing (the workflow-trigger pins, docs inventory, domain inventory, worker-observability memo); node scripts/version-bump-guard.test.mjs 32 passed including six range-floor cases',
  'migration merged with the workflow and suite changes through the canonical path; no worker bundle changed',
  'one workflow file, eight test suites, two docs inventory files and one remediation contract and one failure mode row',
  'the Rollback header restores the previous probe and text; the workflow and suite changes revert with the pull request',
  'a burst of merges to main is guarded by one run that reads the whole burst instead of by n runs of which n-1 are cancelled and unread',
  'no push to main reaches a deploy without a guard verdict over its range, while version-bump-guard push runs on main per merge burst fall from one per sha to one that survives; main deploy-gate full set reads green',
  'none',
  'offline suites scripts/version-bump-guard.test.mjs (range-floor shell run against a throw-away repository with a fake gh), migrations/pr-guard-fixes.test.mjs (detector judged by the consumer own functions, red on a workflow without the floor); deploy-gate runs API read (read-only)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'MAIN-GUARD-RANGE-FLOOR-1:%');
