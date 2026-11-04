-- D1-OVERLOAD-1 (charter pillar autonomy): root cause and doers for the repeated D1_ERROR: D1 DB is overloaded.
-- Measured 2026-11-04 14:00Z, qnfo-audit (1.49 GB), 24 h: 680,614 queries, 2.39B rows read, 1.16M rows written, 11.9M ms of D1 time (3.3 h).
-- Reads are flat at 54M-114M rows an hour, so the cause is sustained heavy statements (8 s for the 52-trigger fleet_tick insert,
-- 4 s for v_output_quality_headline) on a single-threaded database, plus a retry storm: management-personas ran 155x against 24 expected.
-- Cron coincidence is minor: minutes divisible by 10 average 2.7M rows read against 1.0M-2.0M elsewhere.
-- Files issues only; no worker file is edited here.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: agent_issues
-- Rollback: DELETE FROM agent_issues WHERE source = 'session:d1-overload-1' AND title LIKE 'D1-OVERLOAD-1%';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1a: cron dispatcher re-fires a heavy task whose run is still running (management-personas 155 runs in 24h, 132 stuck running, expected 24)',
 'QNFO.OPS; charter pillar autonomy. Root cause (measured 2026-11-04 via D1 GraphQL, qnfo-audit, 24h): management-personas is declared hourly (fleet_crons 35 * * * *) but ran 155 times; 132 fleet_runs rows are stuck in status running, 15 ok (last ok 07:07Z), 8 failed with D1_ERROR D1 DB is overloaded. Its steps cost the persona_briefs UPDATE 232.6M rows read (155 calls), the program_focus_plan_now snapshot 133.2M (290 calls) and v_output_quality_headline 119.5M (78 calls): about 485M of 2.39B rows read per day. A run that outlives the dispatcher leaves no ok row, so liveness-keeper (pulls next_fire to now when 15 minutes overdue) and cron-watch (sets next_fire to now after a failure) re-arm it every 2-9 minutes: a retry storm on the already overloaded database. Fix in the folded fleet-exec dispatcher runTick: skip a due cron whose task has a fleet_runs row in status running started within max(2 x fleet_tasks.timeout_ms, 15 minutes), and mark older running rows failed with error stale-running-timeout so the existing failure accounting sees them; do not advance next_fire for a skipped row. Same change: the fleet_runs lookup by task_id and cron_name read 17M rows in 3427 calls (234 s of D1 time) for lack of an index, so add a migration with CREATE INDEX IF NOT EXISTS idx_fleet_runs_task_cron ON fleet_runs(task_id, cron_name, id). Prediction: management-personas runs per 24h 155 -> 30 or fewer, qnfo-audit rows read per day -15%, stuck running rows 132 -> 0. Guards: no cron is disabled; liveness-keeper and cron-watch unchanged. Closing marker: the fix carries the text D1-OVERLOAD-1a in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-code-orchestrator/worker.js' || char(10) ||
 'code-anchor: const due = await env.AUDIT.prepare("SELECT * FROM fleet_crons WHERE enabled = 1 AND (next_fire IS NULL OR next_fire <= ?1)")' || char(10) ||
 'code-probe: {"paths":["qnfo-code-orchestrator/worker.js"],"contains":"D1-OVERLOAD-1a"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1a: cron dispatcher re-fires a heavy task whose run is still running (management-personas 155 runs in 24h, 132 stuck running, expected 24)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1b: dashboard status build scans v_output_quality_headline each time (78 calls, 119.5M rows read, 4.2 s each)',
 'QNFO.OPS; charter pillar autonomy. Measured 24h: SELECT * FROM v_output_quality_headline = 78 calls, 119.5M rows read, 325 s D1 time (1.5M rows per call). Fix: read the single headline row from a snapshot table (output_quality_headline_now, refreshed by the hourly management-personas task) or a 30-minute cache like qnfo-ai QUALITY_FLOOR_TTL_MS, never the view per page build. Prediction: the query leaves the top 15, rows read -119M/day (5% of total). Closing marker: the fix carries the text D1-OVERLOAD-1b in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: d1all(A, "SELECT * FROM v_output_quality_headline")' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"D1-OVERLOAD-1b"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1b: dashboard status build scans v_output_quality_headline each time (78 calls, 119.5M rows read, 4.2 s each)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1c: qnfo-ai spendQualityBlock reads v_output_quality_headline for one column (36 calls, 55.7M rows read, 9 s each)',
 'QNFO.OPS; charter pillar autonomy. Measured 24h: SELECT worse FROM v_output_quality_headline = 36 calls, 55.7M rows read, 325 s D1 time. The one-hour in-isolate cache is per isolate, so every cold isolate re-runs the view. Fix: read the same snapshot row as D1-OVERLOAD-1b (one-row table lookup) and keep the cache. Prediction: -55M rows/day, query gone from the top 15. Closing marker: the fix carries the text D1-OVERLOAD-1c in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-ai/worker.js' || char(10) ||
 'code-anchor: var row = await db.prepare("SELECT worse FROM v_output_quality_headline").first();' || char(10) ||
 'code-probe: {"paths":["qnfo-ai/worker.js"],"contains":"D1-OVERLOAD-1c"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1c: qnfo-ai spendQualityBlock reads v_output_quality_headline for one column (36 calls, 55.7M rows read, 9 s each)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1d: workerObservability counts open worker-observability issues with correlated scans on every page build (484 calls, 46M rows read)',
 'QNFO.OPS; charter pillar autonomy. Measured 24h: the COUNT/GROUP_CONCAT over fleet_issue_loop, fleet_issue_dispatch and fleet_deploys = 484 calls, 46.0M rows read (95k per call), 64 s D1 time. Fix: cache the result in the isolate for 5 minutes (state is already built with a 5-minute maxAge) and add an index on fleet_deploys(worker, ok, ts) if absent. Prediction: calls 484 -> 100 or fewer per day, rows read -37M/day. Closing marker: the fix carries the text D1-OVERLOAD-1d in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function workerObservability(env, nowMs) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"D1-OVERLOAD-1d"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1d: workerObservability counts open worker-observability issues with correlated scans on every page build (484 calls, 46M rows read)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1e: fleet_tick standby producer in qnfo-fleet-dashboard fires the 52-trigger tick (303 calls, 345.6M rows read, 8.3 s each)',
 'QNFO.OPS; charter pillar autonomy. Measured 24h: INSERT INTO fleet_tick ... cron:qnfo-fleet-dashboard = 303 calls, 345.6M rows read (1.14M per call), 2,525 s D1 time: the most expensive statement, 14% of rows read and 21% of all D1 time. fleet_tick has 52 AFTER INSERT triggers, all run inside that one statement, and the guard is a 9-minute window while qnfo-code-orchestrator also writes the tick about every 10 minutes. The dashboard is documented as a standby: with the primary healthy it should attempt the insert only when the newest fleet_tick row is older than 20 minutes (SELECT MAX(ts) through the ts index). Prediction: dashboard-sourced ticks 303 -> 10 or fewer per day, rows read -330M/day, about 2.4M ms of D1 time freed per day. Guard: the spof_alternate_probes chaos drill (a cron:qnfo-fleet-dashboard row in 24 h) stays satisfied by the 360-minute clause. Closing marker: the fix carries the text D1-OVERLOAD-1e in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function feedFallbackTick(env) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"D1-OVERLOAD-1e"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1e: fleet_tick standby producer in qnfo-fleet-dashboard fires the 52-trigger tick (303 calls, 345.6M rows read, 8.3 s each)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1f: code-loop intake re-reads agent_issues with LIKE on description every 2 minutes (798 calls, 38.7M rows read)',
 'QNFO.OPS; charter pillar autonomy. Measured 24h: INTAKE_QUEUE_V2_SQL = 798 calls, 38.7M rows read (48k per call), 54 s D1 time; the leading-wildcard LIKE on description cannot use an index and joins v_issue_queue_v2. Fix: run intake at most once per 10 minutes unless the previous pass created a task (isolate memo), and bound the candidate set (status open and id above the last seen id). Prediction: calls 798 -> 150 or fewer per day, rows read -31M/day. Closing marker: the fix carries the text D1-OVERLOAD-1f in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-code-orchestrator/worker.js' || char(10) ||
 'code-anchor: var INTAKE_QUEUE_V2_SQL =' || char(10) ||
 'code-probe: {"paths":["qnfo-code-orchestrator/worker.js"],"contains":"D1-OVERLOAD-1f"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1f: code-loop intake re-reads agent_issues with LIKE on description every 2 minutes (798 calls, 38.7M rows read)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'D1-OVERLOAD-1g: remediation contracts tick writes 18,167 remediation_verifications rows a day, each firing triggers (632 s D1 time)',
 'QNFO.OPS; charter pillar autonomy. Measured 24h: INSERT INTO remediation_verifications = 18,167 calls, 21.8M rows read through triggers, 632 s D1 time; the table holds 376,471 rows. cloud_ops_events inserts add 6,672 calls and 401 s. Fix: write a verification row only when the verdict changes or once per contract per hour, otherwise update last_checked on the contract; readers use the latest row, so nothing downstream changes. Prediction: inserts 18k -> 4k or fewer per day, D1 time -500 s/day, writes -14k/day. Guards: remediation_latest_pass_pct_7d and issue_wontfix_share_7d must not worsen. Closing marker: the fix carries the text D1-OVERLOAD-1g in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: async function remediationContractsTick(env, opts) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-control/worker.js"],"contains":"D1-OVERLOAD-1g"}',
 'session:d1-overload-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'D1-OVERLOAD-1g: remediation contracts tick writes 18,167 remediation_verifications rows a day, each firing triggers (632 s D1 time)' AND status = 'open');
