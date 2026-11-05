-- MERGE-LANE-REQUIRED-1 (2026-11-05, charter pillar core; velocity). Found while following PR 7444 (qnfo-gateway 3.60.0) to its merge in the 2026-11-04 open-issue sweep. Files the defect with a doer.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title LIKE 'MERGE-LANE-REQUIRED-1:%' AND status = 'open';
-- CAUSE-MAPPED: no metric is registered here; this files one issue.
--
-- Measured 2026-11-05 01:40 UTC:
--   * qnfo-fleet-control EVOLVE_REQUIRED is ["guard", "mirror-guard", "comparator"] (unchanged since 2026-10-26, MERGE-STREAMLINE-1). PR-CHECK-CAP-5-1 (2026-11-04, owner: "MAX 5 CHECKS PER PR")
--     folded those workflows into the `versions` and `scans` jobs, so no pull request has a check run with those names any more.
--   * git log of main: the last commit with "Merged by qnfo-fleet-control" is 7612248b at 2026-11-04 16:38 UTC; 608 commits landed since 2026-11-04 00:00 UTC and none after that hour was merged by the fleet
--     lane (28 were between 12:00 and 16:38 UTC). branch_hygiene_log since 2026-11-04 18:00 UTC: 0 `merge` rows, 105 `merge-refused` (for PR 7444 and PR 7503: "required check(s) mirror-guard, comparator, guard never ran on <sha>").
--   * The GitHub lane (pr-lane.yml, merge step) is therefore the only merger, and it is a single attempt per event. It excludes `Workers Builds: qnfo-workers` from its own wait list while the ruleset
--     `require-build` makes that check required, so on a large bundle (qnfo-gateway) it asked for the merge while the build was still running: "Pull request #7444 is not mergeable: the base branch
--     policy prohibits the merge" (run 41945706783, 01:02:33Z), exited 0, and nothing retried it. The fleet lane is the intended retry (every 10 minutes) and could not. PR 7444 sat green and CLEAN from
--     01:02 to 01:41 and merged only when a session re-ran that lane job. Any green control-plane pull request can wait the same way.
--   * Code-loop pull requests are opened by qnfo-fleet-control CODE-TASK-MERGE-RUNNER-1 and merged by the same two lanes, so the fleet half of their merge path is dead too (cmRequired builds its list from the same names plus
--     guard, charter and test, none of which is a check run now).
-- The change is one list in one file; it is filed, not made here, because qnfo-fleet-control is a control-plane worker under a live claim policy and the merge lane is the fleet's own authority.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'MERGE-LANE-REQUIRED-1: qnfo-fleet-control EVOLVE_REQUIRED names checks that no longer exist, so the fleet merge lane merges nothing',
'Charter pillar: core (velocity). Owner directive 2026-10-14: "The system shall process PRs more rapidly and push to production." Metric it should move: `code_pr_merge_share_7d` and green pull requests waiting over 20 minutes (the stale-PR lane is the retry for every pull request the GitHub lane could not merge on its one attempt).

Evidence (read 2026-11-05): `var EVOLVE_REQUIRED = ["guard", "mirror-guard", "comparator"]` in qnfo-fleet-control/worker.js has not changed since 2026-10-26. PR-CHECK-CAP-5-1 (2026-11-04) folded those workflows into the `versions` and `scans` jobs of pr-checks.yml, so a pull request shows only `Workers Builds: qnfo-workers`, `versions`, `scans` and `lane`. bhMergeDecide therefore answers "required check(s) mirror-guard, comparator, guard never ran on <sha>" for every pull request (branch_hygiene_log, PR 7444 at 01:07Z and PR 7503 at 01:26Z). The last commit on main merged by the fleet lane is 7612248b at 2026-11-04 16:38 UTC; branch_hygiene_log has 0 `merge` and 105 `merge-refused` rows since 18:00 UTC. The GitHub lane (pr-lane.yml) is the only merger left and it tries once per event: PR 7444 (qnfo-gateway, CLEAN, all fast checks green from 01:02Z) was refused at 01:02:33Z with "the base branch policy prohibits the merge" because the required `Workers Builds: qnfo-workers` check (ruleset require-build) was still running, nothing retried it, and it merged at 01:41Z only after a session re-ran the lane job.

Change in qnfo-fleet-control: make the required list the check names the repository really produces. EVOLVE_REQUIRED becomes ["versions", "scans"] (the two the GitHub lane requires, at least two present); cmRequired stops adding `guard` (for a worker.js), `charter` and `test`, which are no longer check runs, and keeps treating a failed or still-running other check as a reason to wait (cmChecks `pending` and `other`, which already covers `Workers Builds: qnfo-workers`). Read every other EVOLVE_REQUIRED use first (the evolve loop at line 3324 and the status route at 12026) so the same list serves them. Add an offline test with fixture check-run lists for the four shapes: all green, `Workers Builds` pending (waits, does not refuse), a failed `scans` (refuses with the name), and a legacy name absent (does not count as missing).

Verify live: after the deploy, a pull request that is CLEAN with versions and scans green and the build finished is merged by the fleet lane within 10 minutes of the GitHub lane having skipped it, and `SELECT COUNT(*) FROM branch_hygiene_log WHERE action = ''merge''` is above 0 for the following 24 hours.

code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js
code-anchor: var EVOLVE_REQUIRED = ["guard", "mirror-guard", "comparator"];
code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "absent": "var EVOLVE_REQUIRED = [\"guard\", \"mirror-guard\", \"comparator\"];"}',
'merge-lane-required-1', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'MERGE-LANE-REQUIRED-1:%');
