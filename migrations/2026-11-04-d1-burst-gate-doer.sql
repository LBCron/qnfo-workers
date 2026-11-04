-- D1-BURST-GATE-1 (2026-11-04, charter pillar cost / reliability; D1-OVERLOAD family). Files the doer and the closing probe for the "D1 DB is overloaded" errors that remain after the scan and trigger fixes.
-- Measured 2026-11-04 20:00-20:10Z from worker_logs (exceptions_json LIKE '%D1 DB is overloaded%', last 6 h): about 2,000 exceptions, 300-370 an hour in every hour since 14:00Z, while D1 time is only 3-4 % of wall clock since 18:55Z
-- (a five-minute bucket averages 9-11 s; at 17:05-17:25Z it was 39-188 s). So the overload that is left is not average load: it comes in bursts.
--   by minute of the hour: :30 = 385, :00 = 369, :01 = 219, :20/:21 = 236, :51/:50 = 174, :31 = 101; by script: qnfo-fleet-control 848, qnfo-research-exec 307, qnfo-code-orchestrator 230, qnfo-cloud-ops 204, idea-hub 53, qnfo-social 41.
--   the worst seconds: 19:30:58 = 32 exceptions in one second, 18:30:57-58 = 55, 19:21:11 = 30; the invocations in the 19:30:50-19:31:10 window are all telemetry:scheduled (research-exec 27, cloud-ops 22, fleet-control 21, code-orchestrator 7).
--   the top D1 statements of that minute (GraphQL, 19:30:30-19:31:30Z) are trivial (each 0-1 s in total over 30-66 calls): the burst is the NUMBER of simultaneous requests, not their cost. Cron minutes (wrangler.toml, 29 workers
--   with crons, all on the 5-minute grid): :00 has 19 workers, :30 14, :20 10, :40 9, :50 8, :10 7, :05 and :15 6, the rest 3-4; :01-:04, :07, :11-:14 and so on have none.
--   qnfo-fleet-control alone starts about 25 independent tasks at once in its hourly fan-out and 14 in the 10-minute one (ctx.waitUntil(task(env)...) lines in scheduledOnce), each issuing D1 requests immediately.
-- Why the earlier conclusion was wrong: the 24-hour average of D1 time per five-minute bucket showed no dominant :00 herd (62 s at :00 and 59 s at :30 against about 40 s elsewhere). An admission limit measured in a 10-second window
-- (queue length and resources) is invisible in a five-minute average.
-- Change asked (qnfo-fleet-control first, the largest source, then research-exec, code-orchestrator and cloud-ops by the same pattern): a per-isolate in-flight cap on D1 requests at the binding boundary, applied once per invocation
-- where scheduledOnce already re-creates env (`env = await ghAppEnv(env)`), so no call site and no source-pinned test changes: a Proxy around each D1 binding in env (prepare, bind, run/all/first/raw, batch/exec) with a module-level
-- semaphore (cap 8) and a FIFO wait list; batch() receives unwrapped statements (a Proxy fails the native type check); a slot is released on success and on error; a binding already wrapped is not wrapped twice; non-D1 values
-- are untouched. The cap spreads the same work over more seconds instead of rejecting it. Budget-bound tasks (the breach doctor's 20 s) keep their budget, so the cap starts at 8 and is tuned by the probe below.
-- Prediction: qnfo-fleet-control overload exceptions fall from about 140 an hour to under 60, the :00 and :30 minutes lose most of their share, and no task reports more budget-skips (breach_diagnosis_events budget-skip stays at its 1-2 a day).
-- Verify: SELECT COUNT(*) FROM worker_logs WHERE script_name = 'qnfo-fleet-control' AND ts_ms > (strftime('%s','now') - 3600) * 1000 AND exceptions_json LIKE '%D1 DB is overloaded%' (below 60) 3 hours after the deploy.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #d1-bursts:%' AND source = 'session:fleet-tick-fanout'
-- NOOP-OK: the code-probe UPDATE matches nothing on a replay (the line is already there)
-- spof-review: files one issue and one contract; no trigger, cron, credential or executor.
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #d1-bursts: D1 overload errors come in bursts at :00 and :30 (about 2,000 in 6 h at 3-4 % average load); cap in-flight D1 requests per isolate in qnfo-fleet-control',
       'Charter pillar: cost / reliability. Program QNFO.OPS. Metric to move: open_agent_issues (the CF-OBS-ISSUE-1 and LOOP-BREAKER-1 D1-overload family: 7021, 7022, 7116 and about 15 more). Measured 2026-11-04 20:00-20:10Z in worker_logs: about 2,000 "D1 DB is overloaded" exceptions in 6 hours, 300-370 in every hour since 14:00Z, while D1 time is 3-4 % of wall clock (five-minute buckets 9-11 s since 18:55Z). By minute of hour: :30 385, :00 369, :01 219, :20/:21 236, :50/:51 174; by script: qnfo-fleet-control 848, qnfo-research-exec 307, qnfo-code-orchestrator 230, qnfo-cloud-ops 204; the worst seconds hold 30-55 exceptions (19:30:58, 18:30:57-58). The top statements of the burst minute are trivial (0-1 s in total each), so the cause is the number of simultaneous requests: wrangler.toml crons put 19 workers on :00 and 14 on :30, and qnfo-fleet-control starts about 25 tasks at once in its hourly fan-out (ctx.waitUntil lines in scheduledOnce). ' || char(10) ||
       'Change: in qnfo-fleet-control/worker.js add a per-isolate in-flight cap on D1 requests applied once per invocation where scheduledOnce re-creates env (after the ghAppEnv call), as a Proxy over each D1 binding in env: prepare() and bind() return wrapped statements; run, all, first, raw and the database batch and exec take a slot from a module-level semaphore (cap 8, FIFO wait list), released on success and on error; batch() must receive the unwrapped statements (a Proxy fails D1''s native type check: keep a WeakMap from wrapper to statement); a binding already wrapped is not wrapped again; values that are not D1 bindings are left alone. Name it D1-BURST-GATE-1 in a comment, bump VERSION (minor: a new capability) and the mirror. Do not edit the source-pinned fan-out lines (chaos-drill, journeys, remediation-slot, sla-tick-10m tests read them). Add a test file: the cap is never exceeded with 40 concurrent calls, FIFO order, a rejected call releases its slot, batch() gets unwrapped statements, double wrapping is a no-op. Then the same pattern for qnfo-research-exec, qnfo-code-orchestrator and qnfo-cloud-ops (one pull request each, after the first one proves out). ' || char(10) ||
       'Verify (3 hours after the deploy): SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-fleet-control'' AND ts_ms > (strftime(''%s'',''now'') - 3600) * 1000 AND exceptions_json LIKE ''%D1 DB is overloaded%'' is below 60 (about 140 an hour before), and breach_diagnosis_events budget-skip does not rise. ' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
       'code-anchor: // GH-APP-BROKER-1 (0.32.0): every GitHub call of this tick uses the App installation token, the personal token as fallback.',
       'session:fleet-tick-fanout', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #d1-bursts:%');

-- The code-probe line is added by an update (the line trigger installs the code-read contract only when the line is new in the description).
UPDATE agent_issues
SET description = description || char(10) || 'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "D1-BURST-GATE-1"}',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #d1-bursts:%' AND status = 'open' AND instr(description, 'code-probe: {') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'the D1 overload that remains is a burst of simultaneous requests at the cron minutes, which the five-minute averages hid; capping in-flight requests per isolate spreads the same work over more seconds',
  'D1-BURST-GATE-1: file the doer (qnfo-fleet-control first) with the measured burst profile and the closing probe',
  'worker_logs 6 h: about 2,000 overload exceptions, 300-370 an hour, by minute :30 385 / :00 369 / :01 219 / :20-:21 236, by script fleet-control 848 / research-exec 307 / code-orchestrator 230 / cloud-ops 204; GraphQL 19:30:30-19:31:30Z top statements 0-1 s each; wrangler.toml cron minutes :00 19 workers, :30 14, :20 10; D1 time 3-4 % of wall clock since 18:55Z',
  'a doer with a design and a probe exists for the remaining overload errors', 'one issue and its contract', 'the Rollback line',
  'overload errors are treated as an arrival-rate problem with a measured profile, not as average load', 'qnfo-fleet-control overload exceptions under 60 an hour 3 hours after the deploy', NULL, 'worker_logs and GraphQL reads, wrangler.toml cron table'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'D1-BURST-GATE-1:%');
