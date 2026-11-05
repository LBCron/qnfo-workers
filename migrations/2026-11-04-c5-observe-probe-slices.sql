-- C5-OBSERVE / RM-TP-2-ONE-KERNEL lever TP-2.3 (2026-11-05, charter pillar autonomy): slice 1 landed, slices 2 and 3 filed with a doer.
-- Measured 2026-11-05 with Cloudflare Workers Observability (user agent of every request to qnfo-tools-mcp, a worker with no public route and no cron, over two hours): qnfo-deploy-drift-guard 28 of 62
-- (scripts/fleet-autoaudit.py in fleet-autodeploy.yml, started by every canonical-deploy and mirror-sync completion), the dashboard probe 26 (healthProbes, every 5 minutes), fleet-control selfState 2 (hourly),
-- the remediation consumer 3. Over three hours that user agent made 52 requests to each of 37 workers (1882 in all). The lever text named qnfo-fleet-control as the one probe pass; the dashboard already probes
-- every live worker into fleet_probe_log, and the two heavy duplicates are the audit sweep of the deploy workflow and the dashboard's own cadence.
--   slice 1 (PR 7430, merged 2026-11-05T00:44:05Z): the --apply pass of fleet-autodeploy reuses the job's fresh audit when no worker is repo-ahead, halving the sweeps per job.
--   slice 2 (filed): the push-driven audit sweeps only the directories the push changed plus any worker not SYNC; the daily run keeps the full sweep.
--   slice 3 (filed): the dashboard probes a worker again only when its newest fleet_probe_log row is older than 9 minutes (10-minute resolution, owner directive 2026-10-14).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET evidence = substr(evidence, 1, instr(evidence, ' | TP-2.3 slice 1') - 1) WHERE id = 127 AND instr(evidence, ' | TP-2.3 slice 1') > 0; DELETE FROM agent_issues WHERE status = 'open' AND title IN ('TP-2.3-AUDIT-SCOPE-1: the push-driven fleet audit probes all 37 workers on every push', 'TP-2.3-PROBE-10M-1: the dashboard probes every worker every 5 minutes, the fleet works to a 10-minute resolution');

UPDATE roadmap_implementation SET verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | TP-2.3 slice 1 landed 2026-11-05 (PR 7430 merged 00:44:05Z, FLEET-AUTOAUDIT-APPLY-REUSE-1): attribution from Workers Observability, qnfo-deploy-drift-guard (scripts/fleet-autoaudit.py in fleet-autodeploy.yml) made 52 requests to each of 37 workers in 3 hours, 45 percent of what qnfo-tools-mcp took in 2 hours, the dashboard probe 42 percent, fleet-control selfState 3 percent (hourly); the apply pass no longer sweeps again when the audit of its job lists nothing repo-ahead. Slices 2 (TP-2.3-AUDIT-SCOPE-1) and 3 (TP-2.3-PROBE-10M-1) filed with a doer. qnfo-fleet-control 15x jump from 2026-11-02 (13369, 20067, 19027 requests a day) is not probing: it is POST /gh/webhook, 1291 deliveries in 30 minutes read 2026-11-05. worker_count is tracked by WORKER-COUNT-1 (PR 7393). Prediction: the 3-hour count of that user agent per worker 52 -> about 26 at equal merge velocity.'
  WHERE id = 127;

UPDATE transformation_levers SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  note = 'TP-2.3 slice 1 landed 2026-11-05 (PR 7430 FLEET-AUTOAUDIT-APPLY-REUSE-1: the apply pass reuses the audit of its job when nothing is repo-ahead). Slices 2 and 3 are issues with a doer: TP-2.3-AUDIT-SCOPE-1 (scripts/fleet-autoaudit.py) and TP-2.3-PROBE-10M-1 (qnfo-fleet-dashboard healthProbes). The lever lands when worker_requests_nonpublic_per_day (registered by migrations/2026-11-04-c5-observe-rows.sql, 63092 on 2026-11-05) is under 3000 and these are merged; issue 100366 grades it.'
  WHERE tp = 2 AND n = 3;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'TP-2.3-AUDIT-SCOPE-1: the push-driven fleet audit probes all 37 workers on every push',
'Charter pillar: autonomy (RM-TP-2-ONE-KERNEL lever TP-2.3, issue 100366). Metric it should move: worker_requests_nonpublic_per_day (63092 on 2026-11-05, target under 3000) and the requests an idle worker takes.

Evidence (Cloudflare Workers Observability, read 2026-11-05): the user agent qnfo-deploy-drift-guard made 52 requests to each of 37 workers in 3 hours (1882 in all, about 15000 a day), 45 percent of the traffic of a worker with no public route. It is scripts/fleet-autoaudit.py in .github/workflows/fleet-autodeploy.yml: every canonical-deploy and mirror-sync completion starts a job whose --audit pass runs deploy-drift-guard.py --all --content --json --ahead, a sweep of every worker /health and bundle, to refresh worker_live_audit and find a repo-ahead worker. PR 7430 removed the second sweep of the job (--apply); with merges every few minutes the audit sweep itself is still one request per worker per push.

Change: when the job was started by a workflow_run (not the daily schedule, not workflow_dispatch) and worker_live_audit holds a full sweep younger than 24 hours, the guard is given only the worker directories changed since that sweep (git diff of the triggering commit) plus every worker whose worker_live_audit note is not SYNC or that has no row; the scheduled 08:43 run and a manual dispatch keep the full sweep. A partial sweep must not run purge_stale (PURGE deletes rows not stamped by the run) and must keep the rows it did not probe. deploy-drift-guard.py needs an --only option that takes directory names. Constraints: a drift row must still survive DRIFT-CONFIRM-1 and DEPLOY-SETTLE-1 on the narrowed set; apply_ahead only ever sees workers that were probed; scripts/fleet-autoaudit-selftest.py gains a case for each rule (changed dir probed, unchanged SYNC dir not probed, non-SYNC dir probed, schedule full, partial sweep never purges). Prediction: the 3-hour request count of that user agent per worker falls from about 26 (after PR 7430) to under 6 at the same merge velocity. Revert: an env flag FLEET_AUTOAUDIT_SCOPE=full restores the full sweep.

code-task: repo=qnfo-workers path=scripts/fleet-autoaudit.py
code-anchor: def run_guard():
code-probe: {"paths": ["scripts/fleet-autoaudit.py"], "contains": "FLEET_AUTOAUDIT_SCOPE"}',
'c5-observe', 'optimization', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'TP-2.3-AUDIT-SCOPE-1: the push-driven fleet audit probes all 37 workers on every push');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'TP-2.3-PROBE-10M-1: the dashboard probes every worker every 5 minutes, the fleet works to a 10-minute resolution',
'Charter pillar: autonomy (RM-TP-2-ONE-KERNEL lever TP-2.3, issue 100366). Metric it should move: worker_requests_nonpublic_per_day (63092 on 2026-11-05, target under 3000).

Evidence (qnfo-audit fleet_probe_log, Workers Observability, read 2026-11-05): qnfo-fleet-dashboard healthProbes (buildState, run by the */5 cron) wrote 3598 http probe rows in 8 hours, 12 an hour for each of 37 workers, 288 a day a worker, 42 percent of what an idle worker such as qnfo-tools-mcp takes in a day. Owner directive 2026-10-14 sets every SLA to a 10-minute resolution and no SLA over 120 minutes; a worker /health sampled every 5 minutes buys nothing the 10-minute resolution does not, and the cron tick itself stays at 5 minutes (CRON-TICK-5M-1).

Change: in healthProbes, skip a worker whose newest fleet_probe_log row for it (name, transport http, the idx_fpl_name_transport_ts index) is younger than 9 minutes, so each worker is probed once per 10-minute window and the 5-minute tick that follows reads the rows; a worker whose newest row is a failure is probed on every tick (a down worker is confirmed at 5-minute resolution). Read the newest rows with one rowid-range query, never a scan. Readers of fleet_probe_log (probe_coverage_pct over 24 hours, probeVersion in qnfo-fleet-control, the dashboard Now screen) tolerate a 10-minute gap; qnfo-fleet-control selfState could read these rows instead of fetching, but it runs hourly and gains little. Add a case to the dashboard suite that replays two consecutive ticks (the second makes no fetch for a healthy worker, a failed worker is probed again). Prediction: dashboard probes 288 to 144 a day per worker; 5300 fewer requests a day across the fleet. Revert: the 9-minute threshold is one constant.

code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js
code-anchor: async function healthProbes(env, liveNames) {
code-probe: {"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "TP-2.3-PROBE-10M"}',
'c5-observe', 'optimization', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'TP-2.3-PROBE-10M-1: the dashboard probes every worker every 5 minutes, the fleet works to a 10-minute resolution');
