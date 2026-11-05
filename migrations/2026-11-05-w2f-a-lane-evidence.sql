-- LANE-LEGACY-CHECK-NAMES-1 live reading (2026-11-05, pillar autonomy; session w2f-a). qnfo-fleet-control 0.68.0 (PR 7792, merged 05:25:53Z) was live at 05:26:36Z (/health version 0.68.0-codeagent).
-- qnfo-audit.branch_hygiene_log, action merge-refused with why LIKE '%never ran%': 13 rows from 04:06Z to 05:20:53Z (12 pull requests through 05:05:52Z, plus 7783 at 05:20:53Z), 0 rows after the deploy through 05:41Z (three lane ticks: 05:29:47Z,
-- 05:36:52Z and the 05:41Z read). The pull requests the lane evaluated after the deploy were refused for other reasons (7793 canary pair, 7692 and 7799 merge conflicts); 7740, 7745 and 7768, the clean
-- ones that had been refused, were merged by rwnq8 (7740 and 7768 at 05:17Z, 7745 at 05:29:06Z; no merge-stale-pr row), so a positive lane merge of a worker.js pull request is not read yet.
-- CAUSE-MAPPED: no metric is registered in this file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'READ 2026-11-05 05:41Z') - 1) WHERE title LIKE 'LANE-LEGACY-CHECK-NAMES-1%' AND instr(description, char(10) || 'READ 2026-11-05 05:41Z') > 0;

UPDATE agent_issues SET updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
 description = description || char(10) ||
 'READ 2026-11-05 05:41Z (session w2f-a): qnfo-fleet-control 0.68.0 live at 05:26:36Z. branch_hygiene_log merge-refused rows with "never ran": 13 from 04:06Z to 05:20:53Z (12 pull requests through 05:05:52Z, plus 7783 at 05:20:53Z), 0 after the deploy through 05:41Z (lane ticks 05:29:47Z and 05:36:52Z evaluated 7793, 7692 and 7799, each refused for a different reason: canary pair, merge conflicts). The clean pull requests 7740 and 7768 were merged by rwnq8 at 05:17Z and 7745 at 05:29:06Z (0 merge-stale-pr rows), not by the lane. Still to read: the first worker.js pull request the lane itself merges (action merge-stale-pr); until then the count above is the evidence and the code-probe closes the code half.'
 WHERE title LIKE 'LANE-LEGACY-CHECK-NAMES-1%' AND status = 'open' AND instr(description, char(10) || 'READ 2026-11-05 05:41Z') = 0;
