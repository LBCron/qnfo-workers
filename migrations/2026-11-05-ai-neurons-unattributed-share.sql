-- AI-NEURONS-UNATTRIBUTED-1 (2026-11-05, charter pillar cost; sweep cluster B-governance-code; GitHub 7067, the owner asked for cost to be traceable per caller).
-- The issue's guard metric `ai_neurons_unattributed_share_7d` (target under 20 percent) over the data that already exists: v_ai_meter_daily (migrations of PR 7019 and its sibling) holds the Cloudflare
-- meter per day (ai_meter_model_daily, GraphQL aiInferenceAdaptiveGroups) next to the per-worker counters (ai_call_counters), and v_ai_meter_vs_counters splits the gap by model.
-- READ 2026-11-05 (complete days 2026-10-29..11-04): meter 18.19M neurons, counters 9.97M, so 8.22M or 45 percent unattributed (11-04: 32, 11-03: 58, 11-02: 47, 11-01: 56, 10-31: 38,
-- 10-30: 31, 10-29: 34). The issue's "about 90 percent" was measured on purpose = binding alone; all purposes together the share is half that and falling: qnfo-agents joined the counters on 11-02
-- (purpose ledger-rollup, 945k neurons for deepseek-v4.1-flash). By model, 7-day unattributed neurons: deepseek-v4.1-flash-1017 3.45M (meter 4.40M, counted 0.95M), kimi-k2.6 2.41M (2.90M, 0.49M),
-- kimi-k2.7-code 1.35M (3.58M, 2.22M), gpt-oss-120b 0.80M, glm-5.3 0.34M. The gateway log of kimi-k2.6 (cf-ops-actions gateway-logs, 300 rows) is 280 tiny pings tagged qnfo-ai chat (66 tokens in)
-- and 20 untagged calls of about 8.6k tokens in: the bulk is direct env.AI.run with no gateway tag, so the gap is counted by model, not by worker, until each caller reports its neurons.
-- Workers that still hold only the older call-count counter (aiRunAttr in personal-companion: calls and in_chars, neurons 0) or no wrapper at all: personal-companion, idea-hub, qnfo-fleet-dashboard,
-- qnfo-ipatent, qnfo-model-eval, qnfo-social (they are small: 110 calls in 3 days for personal-companion, 500 for idea-hub); the large gaps are the models above, which the leaderboard shows.
-- THIS FILE adds: the view v_ai_neurons_unattributed_7d, the guard metric (target < 20, refreshed hourly in the first ten minutes by the trigger ai_unattributed_share_tick on fleet_tick and once on
-- apply), a weekly metric trigger (gt 20, cooldown 168 h, priority 5) whose text carries the leaderboard query and the lever (wrap the caller with __aiAttrEnv, which records neurons from usage;
-- or record neurons in the older counter), the cause mapping, a decision_log row. It changes no worker, no budget and no model.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS ai_unattributed_share_tick; DROP VIEW IF EXISTS v_ai_neurons_unattributed_7d; DELETE FROM metric_breach_cause WHERE metric_key = 'ai_neurons_unattributed_share_7d'; DELETE FROM analytics_metric_triggers WHERE metric_key = 'ai_neurons_unattributed_share_7d'; DELETE FROM metric_registry WHERE metric = 'ai_neurons_unattributed_share_7d'; DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'ai-neurons-unattributed-guard';
-- spof-review: one producer, the ai_unattributed_share_tick trigger on fleet_tick (first ten minutes of each hour); a missed tick leaves the reading an hour old.
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps ai_neurons_unattributed_share_7d (measurement) in this same file.
-- NOOP-OK: the first-reading UPDATE of the registry row is idempotent; a replay rewrites the same reading.

CREATE VIEW IF NOT EXISTS v_ai_neurons_unattributed_7d AS
SELECT COUNT(*) AS days,
       CAST(ROUND(SUM(neurons)) AS INTEGER) AS meter_neurons,
       CAST(ROUND(SUM(neurons) - SUM(unattributed_neurons)) AS INTEGER) AS counted_neurons,
       CAST(ROUND(MAX(0, SUM(unattributed_neurons))) AS INTEGER) AS unattributed_neurons,
       CASE WHEN COUNT(*) >= 5 AND SUM(neurons) > 0 THEN ROUND(100.0 * MAX(0, SUM(unattributed_neurons)) / SUM(neurons), 1) END AS value
FROM v_ai_meter_daily
WHERE date >= date('now', '-7 days') AND date < date('now');

INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('ai_neurons_unattributed_share_7d', 'operational', 'guard',
   'Share of Workers AI neurons of the last 7 complete UTC days that no worker counts: 100 x max(0, sum of the Cloudflare meter minus sum of ai_call_counters.neurons) / sum of the meter, from v_ai_meter_daily; NULL below 5 days of meter. A cost alarm can only be traced to a caller for the counted share; v_ai_meter_vs_counters lists the gap by model (AI-NEURONS-UNATTRIBUTED-1, GitHub 7067)',
   'qnfo-audit.v_ai_neurons_unattributed_7d <- ai_meter_model_daily (GraphQL aiInferenceAdaptiveGroups) and ai_call_counters; refreshed hourly by trigger ai_unattributed_share_tick on fleet_tick',
   '45.2 (8.22M of 18.19M neurons, 2026-10-29..11-04; the filing read about 90 on purpose binding alone)', '< 20', 'qnfo-fleet-control',
   'a code task or an issue for the caller behind the largest unattributed model in v_ai_meter_vs_counters', '1h', '> 20', '> 60',
   NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed');

CREATE TRIGGER IF NOT EXISTS ai_unattributed_share_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = (SELECT CAST(v.value AS TEXT) FROM v_ai_neurons_unattributed_7d v),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = CASE WHEN (SELECT v.value FROM v_ai_neurons_unattributed_7d v) IS NULL THEN 'UNMEASURED' ELSE 'MEASURED' END
  WHERE metric = 'ai_neurons_unattributed_share_7d';
END;

UPDATE metric_registry
SET last_value = (SELECT CAST(v.value AS TEXT) FROM v_ai_neurons_unattributed_7d v),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = CASE WHEN (SELECT v.value FROM v_ai_neurons_unattributed_7d v) IS NULL THEN 'UNMEASURED' ELSE 'MEASURED' END
WHERE metric = 'ai_neurons_unattributed_share_7d';

INSERT INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT
  'ai_neurons_unattributed_share_7d', 'Cost gap: over 20% of Workers AI neurons in the last 7 days belong to no worker in ai_call_counters', 'registry', 'gt', 20, 5,
  'Pillar cost. A cost alarm cannot be traced to a caller for the share nobody counts. Read the gap by model: SELECT model, SUM(meter_neurons) AS meter, SUM(counter_neurons) AS counted, SUM(unattributed_neurons) AS unattributed FROM v_ai_meter_vs_counters WHERE date >= date(''now'', ''-7 days'') AND date < date(''now'') GROUP BY model ORDER BY unattributed DESC LIMIT 8. For the top model find its callers (docs/SYSTEM-MAP.md section AI call paths; cf-ops-actions gateway-logs with the model filter lists the gateway rows by metadata.worker; a direct env.AI.run has no tag, so grep the model id and AI.run in the worker sources). Lever: wrap the caller with __aiAttrEnv (qnfo-ai/worker.js or qnfo-lifecycle/worker.js hold the block; it records neurons from usage) or write neurons in the older call counter (personal-companion aiRunAttr records calls and in_chars only), one worker per change, and keep the telemetry non-blocking. Definition of done: the metric reads under 20 on two hourly refreshes, a regression test per fixed caller, qnfo-audit.ai_call_counters rows for the caller carry neurons.',
  'qnfo-fleet-control', 'agent_issues', 168, 1,
  'AI-NEURONS-UNATTRIBUTED-1: guard on the cost metrics; one issue a week while the share is above 20. The share was 45.2 on 2026-11-05 and falling as callers join the counters. Switch off with enabled = 0 on this row.'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = 'ai_neurons_unattributed_share_7d');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('ai_neurons_unattributed_share_7d', 'measurement', 'AI-NEURONS-UNATTRIBUTED-1 2026-11-05: neurons the Cloudflare meter bills and no worker counts are callers that do not report their usage; the repair is a counter in the caller (__aiAttrEnv), not a budget or a model switch.');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'the owner asked for cost to be traceable per caller; the guard that says how much is untraceable, with the gap by model, is the first step and costs nothing at run time',
  'AI-NEURONS-UNATTRIBUTED-1: view v_ai_neurons_unattributed_7d, guard metric ai_neurons_unattributed_share_7d with a weekly trigger and the cause mapping',
  'v_ai_meter_daily 2026-10-29..11-04: meter 18.19M neurons, unattributed 8.22M (45.2 percent); top unattributed models deepseek-v4.1-flash-1017 3.45M, kimi-k2.6 2.41M, kimi-k2.7-code 1.35M, gpt-oss-120b 0.80M, glm-5.3 0.34M',
  'pending', 'one view, one registry row, one trigger on fleet_tick (first ten minutes of the hour), one metric trigger; no worker, budget or model change',
  'the Rollback line of migrations/2026-11-05-ai-neurons-unattributed-share.sql',
  'ai-neurons-unattributed-guard',
  'the metric reads 45 now and falls below 20 as the callers behind the top unattributed models report neurons; the weekly trigger files one issue until it does',
  'none (cost integrity)', 'node migrations/ai-neurons-unattributed-share.test.mjs (SQLite fixture with the production view definitions)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'ai-neurons-unattributed-guard');
