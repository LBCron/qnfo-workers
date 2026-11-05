-- LANE-LEGACY-CHECK-NAMES-1 (2026-11-05, pillar autonomy, program QNFO.OPS; session w2f-a at the coordinator's request). The stale-PR lane (bhMergeDecide) and the merge runner (cmChecks) require checks named
-- mirror-guard, comparator, guard (and charter for fleet-control files) on every pull request. PR-CHECK-CAP-5-1 (owner, 2026-11-04: at most five checks per pull request) folded those guards into the
-- steps of the versions and scans jobs, so the names never exist on a pull request now. Read 2026-11-05 from qnfo-audit.branch_hygiene_log: 12 merge-refused rows between 04:06Z and 05:05Z, all
-- "required check(s) mirror-guard, comparator[, guard][, charter] never ran on <sha>" (PRs 7665, 7675, 7692, 7700, 7702, 7711, 7723, 7725, 7731, 7740, 7745, 7768); 7725, 7740, 7745 and 7768 were
-- still open and CLEAN at 05:15Z. qnfo-fleet-control 0.68.0 (the PR that carries this file) lets the success of BOTH versions and scans stand for a legacy name that has no run of its own.
-- This file files the defect with its doer and closing probe, and repoints issue 1001924, whose contract probe still reads the FOLDED directory qnfo-model-eval/worker.js.
-- CAUSE-MAPPED: no metric is registered in this file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'LANE-LEGACY-CHECK-NAMES-1%' AND status = 'open'; UPDATE remediation_contracts SET verify_probe = '{"paths": ["qnfo-model-eval/worker.js"], "contains": "__aiAttrEnv(env, \"qnfo-model-eval\", \"AI\", \"AUDIT\")"}' WHERE class = 'issue-1001924';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'LANE-LEGACY-CHECK-NAMES-1: the stale-PR lane and the merge runner refuse every worker.js pull request with "required check(s) mirror-guard, comparator, guard never ran" since PR-CHECK-CAP-5-1',
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: function cmChecks(runs, statusJ, required) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "LANE-LEGACY-CHECK-NAMES-1"}' || char(10) || char(10) ||
 'Charter pillar autonomy (program QNFO.OPS). Found by W2F-A while a green dashboard pull request (7725) sat open for 45 minutes; verified by the coordinator in D1.' || char(10) ||
 'Evidence (qnfo-audit.branch_hygiene_log, action merge-refused, 2026-11-05 04:06Z to 05:05Z): 12 rows with why "required check(s) mirror-guard, comparator[, guard][, charter] never ran on <sha>" for PRs 7665, 7675, 7692, 7700, 7702, 7711, 7723, 7725, 7731, 7740, 7745 and 7768. Cause, read in qnfo-fleet-control bhMergeDecide: cmRequired(names) returns the legacy check names (mirror-guard and comparator always, guard for a worker.js, charter for fleet-control or charter documents) and cmChecks looks each up by exact name in the head check runs. PR-CHECK-CAP-5-1 (owner 2026-11-04: at most five checks per pull request) moved those guards into steps of the versions and scans jobs, so a pull request carries versions, scans, lane and Workers Builds only, and the names never exist.' || char(10) ||
 'Fix (in the pull request that files this issue): cmChecks lets the success of BOTH versions and scans satisfy a legacy name that has no run of its own. A missing run of either keeps the name missing (never ran), a running one keeps it pending, a failed one fails it with that conclusion, a real run under the legacy name still decides for itself, and a name with no legacy meaning (test) is unchanged. Test: qnfo-fleet-control/lane-legacy-checks.test.mjs (22 checks).' || char(10) ||
 'Definition of done: merged and deployed (qnfo-fleet-control /health at 0.68.0 or later), then SELECT COUNT(*) FROM branch_hygiene_log WHERE action = ''merge-refused'' AND why LIKE ''%never ran%'' AND ts > <deploy time> reads 0, and the open clean pull requests that were refused (7740, 7745, 7768) merge or carry a different refusal; recorded in issue_triage.close_evidence. The code-probe above closes the code half on its own.',
 'session:w2f-a', 'reliability', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'LANE-LEGACY-CHECK-NAMES-1%' AND status = 'open');

UPDATE remediation_contracts
SET verify_probe = '{"paths": ["qnfo-ai-calibration/worker.js"], "contains": "\"qnfo-model-eval\", \"AI\", \"AUDIT\")"}', status = 'active', last_verdict = NULL
WHERE class = 'issue-1001924' AND verify_transport = 'code-read' AND instr(verify_probe, 'qnfo-model-eval/worker.js') > 0;

UPDATE agent_issues SET updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, description =
 'code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js' || char(10) ||
 'code-anchor: keys: ["AI", "AUDIT", "QNFO_AI"],' || char(10) ||
 'code-probe: {"paths": ["qnfo-ai-calibration/worker.js"], "contains": "\"qnfo-model-eval\", \"AI\", \"AUDIT\")"}' || char(10) || char(10) ||
 'REPOINTED 2026-11-05 by session w2f-a. qnfo-model-eval is FOLDED into qnfo-ai-calibration (PR 7523; the old directory is never deployed again), so its Workers AI calls run as the member qnfoModelEvalFoldMod inside qnfo-ai-calibration/worker.js, and __foldWrap builds the member env from the raw host env: the host __aiAttrEnv never reached them. FIXED by PR 7781 (merged 05:11:34Z, qnfo-ai-calibration 1.9.1 live at 05:14Z; test qnfo-ai-calibration/model-eval-ai-meter.test.mjs, 11 checks): the member env function returns __aiAttrEnv(Object.assign(e, { AUDIT: raw.QNFO_AUDIT }), "qnfo-model-eval", "AI", "AUDIT"). The contract probe above (code-read on the folded host) replaces the old one on qnfo-model-eval/worker.js, which can never pass.' || char(10) ||
 'Definition of done: the probe passes on main and SELECT calls FROM ai_call_counters WHERE worker = ''qnfo-model-eval'' AND day = date(''now'') is at least 1 after the first benchmark slot following the deploy (00:17, 06:17, 12:17, 18:17 UTC); recorded in issue_triage.close_evidence. Follow-up in the same file set: delete the qnfo-ai-calibration:qnfo-model-eval line of UNMETERED_BASELINE in scripts/ai_call_paths_audit.mjs (a NOTE until 2026-11-12, a failure after).'
 WHERE id = 1001924 AND status = 'open';
