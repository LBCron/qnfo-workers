-- AI-CAL-FAIL-BACKOFF-1 (2026-11-05, charter pillar cost; FLEET-JOURNEY-FAILED-1 traffic-health agent_issues 2562, step "qnfo-ai 5xx answers <= 2% of requests").
-- WHAT WAS READ (Workers Observability telemetry query, qnfo-ai, status >= 500, 2026-11-04 18:35Z to 2026-11-05 00:35Z):
--   215 qnfo-ai 5xx answers in 6 hours: 206 are 504, 8 are 502, 1 is 503. By user agent: QNFO-AI-Calibration/1.6.10 21, /1.6.11 119, /1.6.12 18, /1.6.13 54, unidentified 3. So 212 of 215 (98.6 %) are
--   the qnfo-ai-calibration worker's own probes; the journey step reads 21.8 % and the non-calibration share is about 0.4 %. The 504 is the router's own router_timeout/gateway answer for a model that does
--   not answer (wall time p50 2.6 s, p90 11.8 s).
--   qnfo-audit.ai_model_health: deepseek-v4-flash-thinking is status failing with consecutive_failures 130 (last probe 00:01Z, 10.3 s), the only row that is not ok. The calibration worker asks every
--   model on every full sweep (ping, budget probe, vision, tools, stream, routing) and truthTick, and asks the not-ok ones again on each lean tick (leanSweepModels), so a model that has failed for 65 hours
--   is probed at the rate of a model that failed once, and every probe is a 504 that the traffic-health journey counts against the router.
-- This file files the fix for the code loop (it changes the calibration worker, not the journey: the step stays as it is, a probe failing is exactly what the router must not hide, and the fix removes the
-- repeated probing of a model already known to be down). Prediction: calibration 5xx fall from about 35 an hour to at most 6, the qnfo-ai 5xx step reads under 2 % six hours after the deploy.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: SELECT 1 /* an issue row is closed with evidence through issue_triage (close_evidence, close_channel session:breach-remediation), never rolled back by SQL */;
-- spof-review: one issue row for a doer; no code, binding, cron or credential.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'AI-CAL-FAIL-BACKOFF-1: stop probing a model that has failed 130 times in a row on every tick',
  'Charter pillar cost. Owner: the code loop (qnfo-ai-calibration). Journey: traffic-health step "qnfo-ai 5xx answers <= 2% of requests" (agent_issues 2562).' || char(10) ||
  'Measured 2026-11-05 00:35Z (Workers Observability, qnfo-ai, status >= 500, 6 h): 215 answers, 206 of them 504; 212 come from user agent QNFO-AI-Calibration/*, about 0.4% from anything else. ai_model_health: deepseek-v4-flash-thinking status failing, consecutive_failures 130, last_probe_ts 2026-11-05T00:01Z, latency 10.3 s; every other model is ok.' || char(10) ||
  'Cause: qnfo-ai-calibration asks a not-ok model again on every tick (leanSweepModels returns every row that is not ok), on every full sweep (ping, budget probe, vision, tools, stream, routing) and in truthTick (ALL_MODELS x truth_probe_items), so a model that has been down for 65 hours is probed like one that failed once, and each probe is a router 504 that the journey counts as real traffic.' || char(10) ||
  'Fix (qnfo-ai-calibration/worker.js, one change): a model whose ai_model_health row is failing with consecutive_failures >= 6 is probed on one tick in 8 (Math.round(nowMs / CAL_TICK_MS) % 8 === 0, about every 4 hours) in leanSweepModels, in the full sweep and in truthTick; any other row is unchanged; a pass resets consecutive_failures as today, so recovery is seen within 4 hours; the "[ai-cal] model probe failing" issue stays open while the model is down. Keep the constants and the helper named AI-CAL-FAIL-BACKOFF-1 in a comment, add a suite case for the skip and for the 8th tick, bump the version.' || char(10) ||
  'Definition of done: the code is on main and deployed; six hours later the journey step reads under 2% (GET https://qnfo-fleet-control.q08.workers.dev/journeys, traffic-health). Do not exclude the calibration user agent from the journey and do not lower the threshold.' || char(10) ||
  'code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js' || char(10) ||
  'code-anchor: function leanSweepModels(models, healthRows) {' || char(10) ||
  'code-probe: {"paths": ["qnfo-ai-calibration/worker.js"], "contains": "AI-CAL-FAIL-BACKOFF-1"}',
  'breach-reach-journeys', 'reliability', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.title = 'AI-CAL-FAIL-BACKOFF-1: stop probing a model that has failed 130 times in a row on every tick' AND a.status = 'open');
