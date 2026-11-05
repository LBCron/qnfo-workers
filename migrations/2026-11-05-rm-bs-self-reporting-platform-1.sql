-- RM-BS-SELF-REPORTING-PLATFORM-1 slice 1 (blue-sky roadmap B12, row 3268; CF-A-06, CF-B-04; charter pillar reliability; W2-J 2026-11-05).
-- WHAT  The roadmap retires home-grown log capture only after the platform signal and the capture are measured to agree ("keep a fail-open fallback until measured agreement"). This file measures it:
--       (1) view v_telemetry_capture_agreement: per worker, the platform's invocation census (worker_usage_daily, GraphQL, latest day) beside the failures captured in worker_logs over the last 24 hours,
--           classed both-quiet | agree | differ | capture-blind (platform counts failures, nothing captured) | platform-blind (captured failures the census does not count).
--       (2) failure mode telemetry-capture-blind with detector fm-telemetry-capture-blind: the number of workers with at least 20 census errors and no captured failure, expected 0 (the digest in
--           qnfo-observability 1.6.0 alerts from the census for such a worker and stores the comparison hourly in its digest event, so the history is the measurement).
--       (3) the first reading as a decision_log row, and the next slice as an agent_issues row (qnfo-ops errorDetailCapture counts the platform's events per worker without copying rows).
-- READ 2026-11-05 03:55Z (this view's SELECT run on qnfo-audit): of the 25 workers with the most failures, 3 agree (qnfo-ai-search 27 vs 37, qnfo-model-eval 6 vs 10, qnfo-email 4 vs 4), 6 differ
--       (qnfo-fleet-control census 3 vs 3,166 captured, qnfo-social 4 vs 180, idea-hub 3 vs 113, personal-companion 1 vs 50, qnfo-infra 2 vs 47, radar-hub 1 vs 14) and 16 are platform-blind
--       (qnfo-research-exec 0 vs 1,117, qnfo-code-orchestrator 0 vs 920, qnfo-cloud-ops 0 vs 659, qnfo-ai 0 vs 454, q08-signal-engine 0 vs 130 ...). No worker is capture-blind.
--       The captured rows are error-level log events and scheduled-handler exceptions (qnfo-fleet-control: "D1 DB is overloaded", 89 of them in 3 hours) inside invocations the census counts as ok.
-- SO    the invocation census cannot replace the capture: it counts a different thing. The retirement the roadmap wants needs the platform's EVENT signal (Workers Observability telemetry query, which
--       qnfo-ops errorDetailCapture already reads and copies) counted at the source; that is the next slice. The roadmap's "16k D1 rows per 6 hours" is 1.7k rows per 6 hours today (1,787 read), so the
--       prediction of rows leaving qnfo-audit is re-based on that number.
-- PREDICTION: fm-telemetry-capture-blind reads 0; telemetry_agreement in the hourly digest event gives 24 samples a day of the agree / differ / blind split; the next slice moves rows per 6 hours in
--             worker_logs from 1,787 toward 0 once the event counts match the copy within 5 percent for 7 days.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_telemetry_capture_agreement; UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-telemetry-capture-blind'; UPDATE failure_modes SET detector = 'retired by rollback of RM-BS-SELF-REPORTING-PLATFORM-1' WHERE fm_key = 'telemetry-capture-blind'
-- CAUSE-MAPPED: registers no metric_registry row; the detector is a failure_modes row with a remediation contract.
-- spof-review: adds no worker, cron, trigger, route or credential in this file; the digest change is in qnfo-observability 1.6.0.

CREATE VIEW IF NOT EXISTS v_telemetry_capture_agreement AS
WITH plat AS (
  SELECT script, requests_24h, errors_24h FROM worker_usage_daily WHERE day = (SELECT MAX(day) FROM worker_usage_daily)
), own AS (
  SELECT script_name AS script, COUNT(*) AS captured_rows,
    SUM(CASE WHEN (outcome != 'ok' AND outcome != 'canceled') OR status >= 500 THEN 1 ELSE 0 END) AS captured_bad
  FROM worker_logs WHERE ts_ms >= (CAST(strftime('%s', 'now') AS INTEGER) - 86400) * 1000 GROUP BY script_name
), names AS (
  SELECT script FROM plat UNION SELECT script FROM own
)
SELECT n.script AS script, p.requests_24h AS requests_24h, COALESCE(p.errors_24h, 0) AS platform_errors, COALESCE(o.captured_bad, 0) AS captured_bad, COALESCE(o.captured_rows, 0) AS captured_rows,
  CASE
    WHEN COALESCE(p.errors_24h, 0) = 0 AND COALESCE(o.captured_bad, 0) = 0 THEN 'both-quiet'
    WHEN COALESCE(o.captured_bad, 0) = 0 AND COALESCE(p.errors_24h, 0) >= 5 THEN 'capture-blind'
    WHEN COALESCE(p.errors_24h, 0) = 0 AND COALESCE(o.captured_bad, 0) >= 10 THEN 'platform-blind'
    WHEN MAX(COALESCE(p.errors_24h, 0), COALESCE(o.captured_bad, 0)) <= 5 * MAX(MIN(COALESCE(p.errors_24h, 0), COALESCE(o.captured_bad, 0)), 1) THEN 'agree'
    ELSE 'differ'
  END AS agreement
FROM names n LEFT JOIN plat p ON p.script = n.script LEFT JOIN own o ON o.script = n.script;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('telemetry-capture-blind', 'a worker fails at scale in the platform census and none of its failures reach worker_logs, so the capture-based digest, console and alerts see a healthy worker',
  'the capture is a copy (Logpush rows plus telemetry events copied by qnfo-ops errorDetailCapture); a stalled copy, a filter that no longer matches, or a worker that stopped logging leaves the copy empty while the platform still counts the errors',
  'restore the copy (check cf-ops-actions gateway/observability reads and the qnfo-ops tick that runs errorDetailCapture); the digest already alerts from the census for such a worker',
  'the fm-telemetry-capture-blind contract counts workers with 20 or more census errors in the latest census day and no captured failure in 24 hours, expected 0',
  'fm-telemetry-capture-blind', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'v_telemetry_capture_agreement has a row with agreement capture-blind and platform_errors >= 20',
  'a failing worker shows no failures in the fleet console and no digest anomaly from worker_logs',
  'exception detection for the affected worker');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-telemetry-capture-blind', NULL, 'RM-BS-SELF-REPORTING-PLATFORM-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_telemetry_capture_agreement WHERE agreement = ''capture-blind'' AND platform_errors >= 20) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA W2-J-OBS-2: qnfo-ops errorDetailCapture counts the platform events per worker without copying rows, and the copy stops when the counts match for 7 days',
 'code-task: repo=qnfo-workers path=qnfo-ops/worker.js' || char(10) ||
 'code-anchor: async function errorDetailCapture(env, windowMs) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-ops/worker.js"], "contains": "telemetry_event_counts"}' || char(10) || char(10) ||
 'Charter pillar reliability (program QNFO.INFRA); roadmap row RM-BS-SELF-REPORTING-PLATFORM-1 (3268), blue-sky B12 (CF-A-06, CF-B-04). Metric it should move: rows written to qnfo-audit.worker_logs per 6 hours (1,787 read 2026-11-05) toward 0, exception detection from up to an hour toward minutes.' || char(10) ||
 'Slice 1 (qnfo-observability 1.6.0, migrations/2026-11-05-rm-bs-self-reporting-platform-1.sql) measured it: the invocation census and the captured failures count different things (3 of 25 workers agree, 16 are platform-blind), so the census cannot replace the copy. The platform signal that matches the copy is the Workers Observability event query errorDetailCapture already reads.' || char(10) ||
 'DO: (1) in the same tick, run a second telemetry query with view calculations (count of events with outcome != ok or $metadata.error, grouped by $metadata.service, same time window, same filters as the events query) and upsert one row per worker and hour into a new table telemetry_event_counts (day, hour, script, platform_events, copied_rows) with copied_rows from worker_logs for the same window; (2) add the view v_telemetry_event_agreement by migration (agree when copied_rows is within 5 percent of platform_events, hourly); (3) when 168 consecutive hours agree for a worker, stop copying that worker''s rows (config key in ops_config, default off, revert by deleting the key) and let the console read the platform events on demand; keep the fail-open fallback: any disagreement turns the copy back on. Also measure the 61 wrangler.toml observability blocks that declare head_sampling_rate (103 occurrences, read 2026-11-05) against the 2026-12-01 pricing and file the sampling change as its own task.' || char(10) ||
 'Definition of done: merged and verified live: telemetry_event_counts has hourly rows for every worker, v_telemetry_event_agreement reads agree for the heaviest five workers, and the copy is off for at least one worker with worker_logs rows for it falling to 0; recorded in issue_triage.close_evidence.',
 'session:w2-j', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA W2-J-OBS-2%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2-j (blue-sky B12)',
  'the home-grown failure capture can be retired once the platform signal is shown to agree with it; the invocation census is the cheapest candidate, so it is tested first',
  'RM-BS-SELF-REPORTING-PLATFORM-1 slice 1: v_telemetry_capture_agreement, detector fm-telemetry-capture-blind, digest comparison in qnfo-observability 1.6.0, next-slice issue W2-J-OBS-2',
  'live read 2026-11-05 03:55Z: of 25 workers with failures 3 agree, 6 differ, 16 platform-blind, 0 capture-blind; qnfo-fleet-control census errors 3 versus 3,166 captured (D1 overload exceptions logged inside ok invocations); worker_logs 1,787 rows in 6 hours',
  'the census does not replace the capture; the event-level platform signal is the candidate', 'one view, one detector, one hourly digest field',
  'the Rollback header of migrations/2026-11-05-rm-bs-self-reporting-platform-1.sql; redeploy qnfo-observability 1.5.8',
  'a measured, hourly record of how far the fleet capture and the platform signal agree',
  'fm-telemetry-capture-blind stays 0; the digest event gains 24 agreement samples a day', 'none', 'D1 reads of worker_usage_daily and worker_logs; node:sqlite suite qnfo-observability/telemetry-agreement.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-BS-SELF-REPORTING-PLATFORM-1 slice 1:%');
