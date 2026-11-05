-- LANE-WAITS-FOR-REVIEW-1 and BP26-SLO-MERGE-LANE-1 (2026-11-05, charter pillar autonomy; sweep cluster B-governance-code; agent_issues 1000872 / GitHub 5515, roadmap 1709 / GitHub 5592).
-- qnfo-fleet-control 0.66.0: before it merges, the stale-PR lane reads the reviews of the head (ONE extra REST read, only for a pull request that passed every other gate). The automated
-- reviewer's High finding on the head holds the merge with one comment that starts HOLD: per head (both lanes obey it; a new push, a later comment or 24 hours release it); a requested review
-- that has not arrived holds a migration, workflow or control-plane change for at most 8 minutes after the pull request opened; and while ops_config slo_budget_spent is non-empty a pull request
-- that adds a new-capability release fragment (patch number 0) waits. slo_budget_spent is empty today, so the freeze changes nothing today. Replay of the evidence: PR 5366 was merged at
-- 08:51:03Z, five minutes after review 5709974064 listed two High items on its head; qnfo-fleet-control/lane-review-slo.test.mjs reads that review and refuses the merge.
-- This file records what the doctrine asks of every new hold: the ops_config defaults, a control_registry row (disposition, critical path, tested alternate) and a read-only alternate probe for each,
-- the failure mode and its standing detector (fm-lane-merges-before-automated-review: the mechanism is still in the worker), the closing probe of issue 1000872 (the old one counted every merge in
-- the history, so it could never pass), the progress of roadmap row 1709, and the remainder filed with a doer: step (4) of the issue, feeding the reviewer's findings to the code loop's repair round.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_lane_review_slo
-- Rollback: DELETE FROM ops_config WHERE key IN ('lane_review_hold', 'lane_review_wait_min', 'slo_merge_lane'); DELETE FROM control_alternate_probes WHERE control IN ('lane-review-hold', 'slo-merge-lane-freeze') AND last_run_at IS NULL; DELETE FROM control_registry WHERE control IN ('lane-review-hold', 'slo-merge-lane-freeze'); DELETE FROM remediation_contracts WHERE class = 'fm-lane-merges-before-automated-review'; DELETE FROM failure_modes WHERE fm_key = 'lane-merges-before-automated-review'; UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_lane_review_slo b WHERE b.class = remediation_contracts.class), verify_transport = 'd1-query' WHERE class = 'issue-1000872'; UPDATE roadmap_implementation SET status = 'planned' WHERE id = 1709 AND status = 'built'; DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'lane-reads-reviewer-and-slo-budget';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_lane_review_slo AS SELECT class, verify_probe, verify_transport, status, last_verdict FROM remediation_contracts WHERE class = 'issue-1000872';

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES
  ('lane_review_hold', 'on', 'LANE-WAITS-FOR-REVIEW-1 (qnfo-fleet-control 0.66.0): on = the stale-PR lane reads the reviews of a head before it merges and holds on the reviewer bot''s High finding with one HOLD: comment; off stops the read. Needs stale_pr_holds_enabled (the comment is what the lane reads).'),
  ('lane_review_wait_min', '8', 'LANE-WAITS-FOR-REVIEW-1: minutes after a pull request opened that a requested automated review is waited for on a migration, workflow or control-plane change (bounds 0 to 15; 0 never waits). The 10-minute merge SLA holds at 8.'),
  ('slo_merge_lane', 'on', 'BP26-SLO-MERGE-LANE-1: on = while ops_config slo_budget_spent is non-empty the stale-PR lane holds a pull request that adds a new-capability release fragment (patch number 0); the label reliability or slo, or a body line slo-exempt: <reason>, lets it through; off lifts the freeze without a deploy.');

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence)
VALUES
 ('lane-review-hold', 'ops_config lane_review_hold and lane_review_wait_min, read by qnfo-fleet-control bhConfig; bhReadReview, bhReviewVerdict in the stale-PR lane (bhTryMerge)', 'hold',
  'a pull request merged while the automated reviewer''s High findings on its head are open (PR 5366, 2026-10-30) or while a requested review is still being written',
  1, 'keep', 'applied',
  'the hold is a comment that any collaborator releases with a later comment (hold released) and that expires after 24 hours; a new push clears it; ops_config lane_review_hold = off removes the read without a deploy; the wait is bounded at 8 minutes and only for migrations, workflows and control-plane workers; a failed reviews read assumes no hold',
  'LANE-WAITS-FOR-REVIEW-1: qnfo-fleet-control/lane-review-slo.test.mjs (67 checks: replay of review 5709974064 refuses the merge, one HOLD per head, a release merges, an older head and a clean review hold nothing, a failed read assumes nothing, the wait is bounded and only for risky changes, both switches)'),
 ('slo-merge-lane-freeze', 'ops_config slo_budget_spent (written hourly by scripts/bp26_slo.py), slo_merge_lane; bhSloGate in qnfo-fleet-control bhMergeDecide', 'hold',
  'new-capability releases merging while a public surface has spent its 28-day availability error budget (slo_attainment_28d_min 0.479 on 2026-11-05)',
  1, 'keep', 'applied',
  'a freeze with an exit and no timer to forget: it exists only while slo_budget_spent is non-empty, so it lifts when the budget recovers; the label reliability or slo, or a body line slo-exempt: <reason>, lets one change through; ops_config slo_merge_lane = off lifts it without a deploy; fixes, patch releases, migrations, docs and tests are never held',
  'BP26-SLO-MERGE-LANE-1: lane-review-slo.test.mjs section C; slo_budget_spent reads empty on 2026-11-05, so the freeze changes nothing today');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('lane-review-hold',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''lane_review_hold'') = 0 THEN ''the ops_config row lane_review_hold is missing, so the off lever cannot be read'' WHEN (SELECT value FROM ops_config WHERE key = ''lane_review_hold'') NOT IN (''on'', ''off'') THEN ''ops_config lane_review_hold holds a value other than on or off'' ELSE ''ok'' END AS observed',
  'state probe, no window: the lever row and its value. The hold itself is released by a collaborator comment, a new push or 24 hours', 1),
 ('slo-merge-lane-freeze',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''slo_merge_lane'') = 0 THEN ''the ops_config row slo_merge_lane is missing, so the off lever cannot be read'' WHEN (SELECT value FROM ops_config WHERE key = ''slo_merge_lane'') NOT IN (''on'', ''off'') THEN ''ops_config slo_merge_lane holds a value other than on or off'' WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''slo_budget_spent'') = 0 THEN ''the ops_config row slo_budget_spent is missing, so the freeze can never apply or lift'' ELSE ''ok'' END AS observed',
  'state probe, no window: the lever, the budget list and their values', 1);

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('lane-merges-before-automated-review',
   'the merge lane merges a pull request while the automated reviewer''s review of its head lists High severity findings, or before that review is written',
   'no gate read the reviewer''s review: REQUEST-COPILOT-REVIEW-1 only requested it, and the ruleset rule copilot_code_review cannot be written with the app token',
   'bhReadReview in the stale-PR lane reads the reviews of the head just before the merge and holds on a High finding (one HOLD: comment per head); a requested review is waited for at most 8 minutes on risky changes; this detector fails if the mechanism is removed',
   'fm-lane-merges-before-automated-review: qnfo-fleet-control/worker.js still reads the reviews of the head before it merges', 'fm-lane-merges-before-automated-review', '2026-11-05', 1000872,
   'bhReadReview is absent from qnfo-fleet-control/worker.js on main',
   'PR 5366 merged at 08:51:03Z, five minutes after a review with two High findings on its head (review 5709974064)',
   'every pull request the stale-PR lane merges');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-lane-merges-before-automated-review', NULL,
   'qnfo-fleet-control/worker.js on main reads the reviews of the head in bhTryMerge before the merge call',
   'failure-mode detector: restore the call of bhReadReview in bhTryMerge and the pure helpers bhReviewVerdict and bhReviewFindings (LANE-WAITS-FOR-REVIEW-1); the regression suite is qnfo-fleet-control/lane-review-slo.test.mjs',
   '{"paths":["qnfo-fleet-control/worker.js"],"contains":"var rr = await bhReadReview(env, n, pr.j"}',
   'code-read', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

-- The closing probe of issue 1000872: the old one counted every merge in the history of ci_gate_audit without a review requirement (it can never pass); this one reads the mechanism.
UPDATE remediation_contracts
SET verify_transport = 'code-read',
    verify_probe = '{"paths":["qnfo-fleet-control/worker.js"],"contains":"var rr = await bhReadReview(env, n, pr.j"}',
    precondition = 'LANE-WAITS-FOR-REVIEW-1 (1000872): the stale-PR lane reads the reviews of the head before it merges; the regression suite lane-review-slo.test.mjs replays review 5709974064 of PR 5366.',
    action = 'Measure on main that bhTryMerge calls bhReadReview before the merge call.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000872' AND status IN ('active', 'holding', 'escalated', 'superseded', 'probe-review-refused')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000872 AND status = 'open');

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'B-GOVERNANCE-2 (2026-11-05): steps (1) to (3) are in qnfo-fleet-control 0.66.0: the lane reads the reviews of the head, holds on the reviewer bot''s High finding with one HOLD: comment per head, and waits at most 8 minutes for a review that has not arrived (migrations, workflows and control-plane changes only). The regression suite replays review 5709974064. Step (4), feeding the findings to the code loop''s repair round, is filed as LANE-REVIEW-REPAIR-1 with a doer. The closing probe now reads the mechanism on main; the old one counted every merge in the history and could not pass.'
WHERE id = 1000872 AND status = 'open' AND instr(description, 'B-GOVERNANCE-2') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'LANE-REVIEW-REPAIR-1: feed the automated reviewer''s High findings to the code loop''s repair round',
  'Charter pillar: autonomy. ROADMAP-1 follow-up of LANE-WAITS-FOR-REVIEW-1 step (4) (agent_issues 1000872): the stale-PR lane now holds a pull request whose head has High findings from copilot-pull-request-reviewer[bot] (qnfo-fleet-control 0.66.0, bhReadReview), but a held pull request waits for its author. When the pull request is the fleet''s own, the repair round should start from the findings: in bhFileRepair add the finding titles and links (bhReviewFindings of the reviews already read for the hold) to the repair issue it files for the pull request, so the doer''s prompt names what to fix. Definition of done: a regression test that a held pull request with two High findings files one repair issue whose text lists both titles, a VERSION bump with the mirror, and the repair issue closes on the next push. Revert: remove the lines that add the findings.' || char(10) ||
  'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
  'code-anchor: async function bhFileRepair(env, pr, rep) {',
  'session:B-governance-code', 'automation', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'LANE-REVIEW-REPAIR-1:%' AND status = 'open');

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'qnfo-fleet-control 0.66.0 (BP26-SLO-MERGE-LANE-1): bhSloGate in bhMergeDecide holds a pull request that adds a new-capability release fragment (<worker>/releases/X.Y.0-...md, patch number 0) while ops_config slo_budget_spent is non-empty; fixes, patch releases, migrations, docs and tests merge; the label reliability or slo, a body line slo-exempt: <reason>, or ops_config slo_merge_lane = off lets a change through. slo_budget_spent is empty on 2026-11-05 (slo_attainment_28d_min 0.479 is not yet a spent budget), so the freeze changes nothing today. lane-review-slo.test.mjs section C. Limit: the code loop''s own pull requests (cmDecide) are decided by their runner and are not gated here; they are fixes by construction (RED-DRAIN-1). Verified live by a later file once /health reports 0.66.0.'
WHERE id = 1709 AND status = 'planned';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a reversible fleet decision takes the recommended option: the lane reads the reviewer''s review and the SLO budget before it merges',
  'qnfo-fleet-control 0.66.0; ops_config lane_review_hold = on, lane_review_wait_min = 8, slo_merge_lane = on; control records, failure mode and detector; LANE-REVIEW-REPAIR-1 filed for step (4)',
  'PR 5366 merged five minutes after review 5709974064 listed two High findings on its head; slo_budget_spent exists and is read by nothing',
  'pending', 'every pull request the stale-PR lane merges (one extra reviews read each, only after every other gate); the SLO freeze applies only while slo_budget_spent is non-empty',
  'ops_config lane_review_hold = off and slo_merge_lane = off, or revert the PR; the Rollback line restores the closing probe of issue 1000872',
  'lane-reads-reviewer-and-slo-budget',
  'a head with a High reviewer finding is not merged until a push or a release comment; merge latency of plain changes is unchanged; risky changes wait at most 8 minutes for a review that was requested',
  'none (safety)', 'qnfo-fleet-control/lane-review-slo.test.mjs and migrations/lane-review-slo.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'lane-reads-reviewer-and-slo-budget');
