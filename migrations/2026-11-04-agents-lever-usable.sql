-- AGENTS-LEVER-USABLE-1 (2026-11-04, charter pillar cost, autonomy; programs QNFO.OPS and QNFO.INFRA). Owner goal: fleet AI cost USD 200-300 a month and managers that originate strategy.
-- WHAT WAS MEASURED (qnfo-audit cf_agent_requests and ai_spend_ledger, read 2026-11-04 before qnfo-agents 0.6.0): the qnfo-agents loop answers the managers' lever reviews (instance lever-*) and
-- roadmap asks. Of 337 lever rows from 2026-10-28 to 2026-11-04, 47 (14 percent) held an EDIT: or a CORRECTED TARGET: (the PR body says 44, the brief 59; this file uses one SQL on both sides of the
-- change), so a manager that got no lever asked again at about 3.3k neurons a call. qnfo-agents spent USD 8.365 on 2026-11-04 (1385 calls, a partial day), about USD 250 a month at that rate.
-- PR 7141 (FINAL-ANSWER-PICK-1, qnfo-agents 0.6.0) makes a preface, an empty last step or raw tool-call markup a non-answer and asks for the final answer. It merged 2026-11-04T19:22:33Z and its
-- deploy (deploy-qnfo-agents.yml run 41896335735) finished 2026-11-04T19:23:39Z. Its prediction is at least 60 percent usable lever replies over 48 hours, and the 48 hour verdict is time-gated:
-- before this file a session had to remember to read it.
-- WHAT THIS ADDS (no worker is edited, no cron is added: the reading rides the existing fleet_tick like its siblings, and the fleet_budget caps are breached):
-- (1) v_agents_lever_usable_48h, finished lever rows created after the deploy and within the last 48 hours, and agents_lever_usable_share_48h, their usable share, NULL (no verdict) until 30 rows exist.
--     Usable is the same test as the baseline: instr(result, 'EDIT:') or instr(result, 'CORRECTED TARGET:'). A row still queued or running is not a reply yet and is left out; a failed row is a reply
--     that was not usable and stays in. Rows created before the deploy never count, so the metric measures 0.6.0 and nothing older; after 48 hours it is a rolling guard against a regression.
-- (2) a trigger (lt 0.60) whose lever is a code task on qnfo-agents, so a miss reaches a doer and not a report; a named exemption in metric_unmeasured_exemptions while the value is absent (the same
--     sample-floor case as ask_plain_share_7d: management-personas would otherwise file a missing-producer issue for a metric that is correctly NULL).
-- (3) agents_usd_per_usable_lever_2d, the cost companion: qnfo-agents USD per usable lever reply over the complete UTC days after the deploy (at most the last two). It is a guard-style reading with a
--     named exemption from a threshold trigger, like research_neurons_per_engaged_session_7d: spend caps judge cost, this reads cost per outcome and has no stable baseline until days exist. The USD is
--     every qnfo-agents loop (lever, roadmap, probe), so the reading is an upper bound on one usable reply, and it is comparable only with itself over time. Baseline 0.42 (2026-11-04, partial day).
-- (4) fm-agents-lever-verdict-missing, a standing d1-query probe on the metric: it fails when the metric was not refreshed in 3 hours or still has no verdict three days after the deploy, so the
--     verdict can never silently stop being produced. The breach itself is the trigger's job; the probe does not repeat it (two signals from one producer are one path).
-- (5) the decision_log row for PR 7141 with its prediction in the parsed form, so calibration_scorer_tick scores it at its due time against this metric and writes decision_outcomes: the verdict is
--     produced by the hourly loop and not by a session. Read it with: SELECT * FROM v_decision_calibration WHERE action LIKE 'AGENTS-LEVER-USABLE-1:%' (matched 1 or 0).
-- PREDICTION (decision_log, below): agents_lever_usable_share_48h >= 0.6 within 48 h. Falsifier: under 0.60 with at least 30 rows means 0.6.0 did not make lever replies usable; the trigger then files
-- the code task. Failure mode of this measure: lever asks are bursty (0 to 10 an hour, 75 to 130 a day), so 30 rows need most of a day and a quiet two days leaves no verdict; the probe names that.
-- Roadmap asks (instance roadmap-QNFO.OPS-* and roadmap-QNFO.INFRA-*) are in the view (roadmap_n, roadmap_usable: a reply with TITLE: and code-anchor:, baseline 8 of 21) but not a metric: 21 rows
-- in all of history is no sample.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS agents_lever_usable_tick; DROP VIEW IF EXISTS v_agents_usd_per_usable_lever; DROP VIEW IF EXISTS v_agents_lever_usable_48h; DELETE FROM remediation_contracts WHERE class = 'fm-agents-lever-verdict-missing'; DELETE FROM failure_modes WHERE fm_key = 'agents-lever-verdict-missing'; DELETE FROM control_registry WHERE control = 'agents-lever-usable-sample-floor'; DELETE FROM metric_unmeasured_exemptions WHERE metric_key IN ('agents_lever_usable_share_48h', 'agents_usd_per_usable_lever_2d'); DELETE FROM analytics_metric_triggers WHERE metric_key = 'agents_lever_usable_share_48h'; DELETE FROM metric_breach_cause WHERE metric_key IN ('agents_lever_usable_share_48h', 'agents_usd_per_usable_lever_2d'); DELETE FROM metric_registry WHERE metric IN ('agents_lever_usable_share_48h', 'agents_usd_per_usable_lever_2d'); -- the decision_log row is append-only and stays as evidence.
-- spof-review: one producer, the agents_lever_usable_tick trigger on fleet_tick (hourly, first ten minutes of the hour); a missed tick leaves the reading an hour old and the probe fails after 3 hours.
-- runtime-probe (D1): SELECT metric, last_value, last_refreshed FROM metric_registry WHERE metric = 'agents_lever_usable_share_48h' -- expected a refresh within 3 h and, from 30 rows, a number
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps both metrics (code-loop, spend) in this same file.
-- NOOP-OK: the first-reading UPDATE of the two registry rows is idempotent; a replay rewrites the same readings.

-- ---- the readings ------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- One row. Window start: the deploy of 0.6.0, or 48 hours ago when that is later. A finished row is done or failed; queued and running rows are not replies yet.
CREATE VIEW IF NOT EXISTS v_agents_lever_usable_48h AS
WITH w AS (
  SELECT MAX('2026-11-04T19:23:39Z', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-48 hours')) AS lo
), l AS (
  SELECT COUNT(*) AS n,
    COALESCE(SUM(instr(COALESCE(r.result, ''), 'EDIT:') > 0 OR instr(COALESCE(r.result, ''), 'CORRECTED TARGET:') > 0), 0) AS usable,
    COALESCE(SUM(length(COALESCE(r.result, '')) < 200), 0) AS short,
    COALESCE(SUM(instr(COALESCE(r.result, ''), '<|tool_call') > 0 OR instr(COALESCE(r.result, ''), '<tool_call>') > 0), 0) AS markup
  FROM cf_agent_requests r, w
  WHERE r.instance LIKE 'lever-%' AND r.status IN ('done', 'failed') AND r.created_at >= w.lo
), m AS (
  SELECT COUNT(*) AS roadmap_n,
    COALESCE(SUM(instr(COALESCE(r.result, ''), 'TITLE:') > 0 AND instr(COALESCE(r.result, ''), 'code-anchor:') > 0), 0) AS roadmap_usable
  FROM cf_agent_requests r, w
  WHERE (r.instance LIKE 'roadmap-QNFO.OPS-%' OR r.instance LIKE 'roadmap-QNFO.INFRA-%') AND r.status IN ('done', 'failed') AND r.created_at >= w.lo
)
SELECT w.lo AS window_start, l.n AS n, l.usable AS usable, l.short AS short, l.markup AS markup, m.roadmap_n AS roadmap_n, m.roadmap_usable AS roadmap_usable,
  CASE WHEN l.n >= 30 THEN ROUND(1.0 * l.usable / l.n, 3) END AS value
FROM w, l, m;

-- One row. Complete UTC days after the deploy day, at most the last two; the lever replies counted are those created on the same days. NULL until a complete day exists with 10 usable replies.
CREATE VIEW IF NOT EXISTS v_agents_usd_per_usable_lever AS
WITH d AS (
  SELECT day, SUM(usd) AS usd, SUM(calls) AS calls
  FROM ai_spend_ledger
  WHERE caller = 'qnfo-agents' AND day > '2026-11-04' AND day < date('now') AND day >= date('now', '-2 days')
  GROUP BY day
), s AS (
  SELECT COUNT(*) AS days, SUM(usd) AS usd, SUM(calls) AS calls, MIN(day) AS first_day FROM d
), u AS (
  SELECT COALESCE(SUM(instr(COALESCE(r.result, ''), 'EDIT:') > 0 OR instr(COALESCE(r.result, ''), 'CORRECTED TARGET:') > 0), 0) AS usable
  FROM cf_agent_requests r, s
  WHERE r.instance LIKE 'lever-%' AND r.status IN ('done', 'failed') AND r.created_at >= s.first_day AND r.created_at < date('now')
)
SELECT s.days AS days, ROUND(s.usd, 3) AS usd, s.calls AS calls, u.usable AS usable,
  CASE WHEN s.days >= 1 AND u.usable >= 10 THEN ROUND(s.usd / u.usable, 3) END AS value
FROM s, u;

-- ---- the metrics ------------------------------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('agents_lever_usable_share_48h', 'operational', 'target',
   'Share of qnfo-agents lever replies (cf_agent_requests instance lever-*, status done or failed, created after the 0.6.0 deploy 2026-11-04T19:23:39Z and within the last 48 hours) that hold EDIT: or CORRECTED TARGET:; NULL (no verdict) below 30 such rows (AGENTS-LEVER-USABLE-1, the verdict on PR 7141 FINAL-ANSWER-PICK-1)',
   'qnfo-audit.v_agents_lever_usable_48h <- cf_agent_requests (qnfo-agents ledger); refreshed hourly by trigger agents_lever_usable_tick on fleet_tick',
   '0.14 (47 of 337 lever rows 2026-10-28..11-04, before qnfo-agents 0.6.0; the same SQL on both sides)',
   '>= 0.60', 'qnfo-agents', 'qnfo-agents loop: analytics_metric_triggers files a code task on qnfo-agents when it reads under 0.60 with 30 or more rows',
   '1h', '< 0.60', '< 0.30', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed'),
  ('agents_usd_per_usable_lever_2d', 'operational', 'leading',
   'qnfo-agents USD (ai_spend_ledger caller qnfo-agents, every loop) over the complete UTC days after 2026-11-04, at most the last two, divided by the usable lever replies created on the same days; NULL until a complete day with 10 usable replies exists (AGENTS-LEVER-USABLE-1)',
   'qnfo-audit.v_agents_usd_per_usable_lever <- ai_spend_ledger and cf_agent_requests; refreshed hourly by trigger agents_lever_usable_tick on fleet_tick',
   '0.42 (2026-11-04 partial day, mostly before 0.6.0: USD 8.365 over 20 usable lever replies; the USD includes every qnfo-agents loop)',
   'falling; no absolute gate. The product of usable share and spend per call', 'qnfo-agents',
   'exempt from a threshold trigger: the ai_spend caps and fleet_cost_bound_month_usd judge cost, this reads cost per usable reply and has no stable baseline before complete days exist (AGENTS-LEVER-USABLE-1)',
   '1h', '> 0.42', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed');

-- Hourly, in the first ten minutes (like its siblings), and once when this file is applied.
CREATE TRIGGER IF NOT EXISTS agents_lever_usable_tick
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' OR NEW.source LIKE 'migration:%'
BEGIN
  UPDATE metric_registry
  SET last_value = (SELECT CAST(v.value AS TEXT) FROM v_agents_lever_usable_48h v),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = CASE WHEN (SELECT v.value FROM v_agents_lever_usable_48h v) IS NULL THEN 'UNMEASURED' ELSE 'MEASURED' END
  WHERE metric = 'agents_lever_usable_share_48h';
  UPDATE metric_registry
  SET last_value = (SELECT CAST(v.value AS TEXT) FROM v_agents_usd_per_usable_lever v),
      last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
      state = CASE WHEN (SELECT v.value FROM v_agents_usd_per_usable_lever v) IS NULL THEN 'UNMEASURED' ELSE 'MEASURED' END
  WHERE metric = 'agents_usd_per_usable_lever_2d';
END;

-- First reading, so the metric row carries a measured (or honestly absent) value the moment this merges.
UPDATE metric_registry
SET last_value = (SELECT CAST(v.value AS TEXT) FROM v_agents_lever_usable_48h v),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = CASE WHEN (SELECT v.value FROM v_agents_lever_usable_48h v) IS NULL THEN 'UNMEASURED' ELSE 'MEASURED' END
WHERE metric = 'agents_lever_usable_share_48h';

UPDATE metric_registry
SET last_value = (SELECT CAST(v.value AS TEXT) FROM v_agents_usd_per_usable_lever v),
    last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    state = CASE WHEN (SELECT v.value FROM v_agents_usd_per_usable_lever v) IS NULL THEN 'UNMEASURED' ELSE 'MEASURED' END
WHERE metric = 'agents_usd_per_usable_lever_2d';

-- ---- the trigger (lever = a code task on qnfo-agents), the cause mapping and the sample-floor exemption -----------------------------------------------------------------------------
INSERT OR IGNORE INTO analytics_metric_triggers
  (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES
  ('agents_lever_usable_share_48h', 'Agents gap: under 60% of lever replies hold an EDIT or a CORRECTED TARGET', 'registry', 'lt', 0.6, 5,
   'Pillar cost (autonomy). Lever: in qnfo-agents executeRun treat a turn whose instance starts with lever- and whose picked answer holds neither EDIT: nor CORRECTED TARGET: as unanswered, so the tool-free final-answer call runs with the required form restated. First read what the unusable replies are: SELECT instance, status, length(result), substr(result,1,200) FROM cf_agent_requests WHERE instance LIKE ''lever-%'' AND created_at >= ''2026-11-04T19:23:39Z'' AND NOT (instr(COALESCE(result,''''),''EDIT:'')>0 OR instr(COALESCE(result,''''),''CORRECTED TARGET:'')>0) ORDER BY id DESC LIMIT 20 (preface, truncation, tool markup, refusal). Done: agents_lever_usable_share_48h is at or above 0.60 at two hourly refreshes with at least 30 lever rows, qnfo-agents VERSION bumped, worker.js and deployed-current.worker.js rebuilt with npm run build in qnfo-agents, a regression test in qnfo-agents/worker.test.mjs, and agents_usd_per_usable_lever_2d not higher than its 0.42 baseline.' || char(10) ||
   'code-task: repo=qnfo-workers path=qnfo-agents/src/index.ts' || char(10) ||
   'code-anchor: async executeRun(id: string) {',
   'qnfo-agents', 'agent_issues', 24, 1,
   'AGENTS-LEVER-USABLE-1: the verdict on PR 7141 (FINAL-ANSWER-PICK-1, qnfo-agents 0.6.0, deployed 2026-11-04T19:23:39Z). The window starts at the deploy and holds finished lever rows only; below 30 rows the value is NULL and the metric is in metric_unmeasured_exemptions. Switch off with enabled = 0 on this row.');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('agents_lever_usable_share_48h', 'code-loop', 'AGENTS-LEVER-USABLE-1 2026-11-04: a lever reply without EDIT: or CORRECTED TARGET: is a qnfo-agents turn that ended without the answer the manager asked for (a preface, a truncated step, tool markup); the repair is in executeRun and its final-answer pick, a code change, not a budget or a model switch.'),
  ('agents_usd_per_usable_lever_2d', 'spend', 'AGENTS-LEVER-USABLE-1 2026-11-04: USD per usable lever reply rises when usable replies fall or when calls per turn rise; the levers are the usable share (agents_lever_usable_share_48h) and the step cap in qnfo-agents, not the daily cap.');

INSERT OR IGNORE INTO metric_unmeasured_exemptions
  (metric_key, reason, ends_when, doer)
VALUES
  ('agents_lever_usable_share_48h',
   'the producer is the agents_lever_usable_tick trigger, which writes NULL below 30 finished lever rows in the window (lever asks are bursty: 75 to 130 a day); this is a valid sample floor, not a missing producer',
   'At least 30 finished lever rows exist after the 0.6.0 deploy within the last 48 hours and the trigger writes a numeric value',
   'qnfo-agents'),
  ('agents_usd_per_usable_lever_2d',
   'the producer is the agents_lever_usable_tick trigger, which writes NULL until a complete UTC day after the deploy holds 10 usable lever replies; a valid sample floor, not a missing producer',
   'A complete UTC day after 2026-11-04 exists in ai_spend_ledger with 10 usable lever replies and the trigger writes a numeric value',
   'qnfo-agents');

INSERT OR IGNORE INTO control_registry
  (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence, issue_id)
VALUES
  ('agents-lever-usable-sample-floor',
   'qnfo-audit.metric_unmeasured_exemptions agents_lever_usable_share_48h and agents_usd_per_usable_lever_2d; management-personas missing-producer audit',
   'filter',
   'false missing-producer issues while the lever-reply share has fewer than 30 finished rows in its window',
   0,
   'keep',
   'applied',
   'the exemption holds only while the value is NULL; the enabled trigger evaluates any numeric value, and fm-agents-lever-verdict-missing fails when no verdict exists three days after the deploy, so a metric that stays NULL is reported by its own probe',
   'AGENTS-LEVER-USABLE-1: lever rows were 75 to 130 a day on 2026-11-02..11-04 and 0 to 10 an hour; the sample floor of 30 is reached in under a day at that rate. Measured effect: no METRIC-UNMEASURED-1 issue for these two metrics while NULL.',
   NULL);

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled)
VALUES ('agents-lever-usable-sample-floor',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_unmeasured_exemptions WHERE metric_key = ''agents_lever_usable_share_48h'') THEN ''named sample-floor exemption is missing'' WHEN NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = ''agents_lever_usable_share_48h'' AND enabled = 1) THEN ''metric trigger is disabled, so a numeric value is not judged'' ELSE ''ok'' END AS observed',
  '60', 1);

-- ---- the standing probe on the metric ---------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('agents-lever-verdict-missing',
   'the verdict on a qnfo-agents change is never produced by the metric loop and waits for a session to read it',
   'the 48 hour usable-lever share was time-gated and had no producer: a session had to remember to read cf_agent_requests after two days',
   'agents_lever_usable_share_48h is refreshed hourly by agents_lever_usable_tick; this detector fails when the refresh stops or no verdict exists three days after the deploy',
   'fm-agents-lever-verdict-missing: agents_lever_usable_share_48h not refreshed in 3 hours, or still NULL after 2026-11-07T19:23:39Z',
   'fm-agents-lever-verdict-missing', '2026-11-04', NULL,
   'the metric row is missing, its last_refreshed is older than 3 hours, or its value is NULL after 2026-11-07T19:23:39Z',
   'PR 7141 stays unverified and managers keep re-asking at about 3.3k neurons a call without anyone seeing it',
   'qnfo-agents lever replies, manager lever reviews and the AI spend of qnfo-agents');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status)
VALUES
  ('fm-agents-lever-verdict-missing', NULL,
   'metric_registry holds agents_lever_usable_share_48h and trigger agents_lever_usable_tick exists on fleet_tick',
   'failure-mode detector: read SELECT COUNT(*), MAX(created_at) FROM cf_agent_requests WHERE instance LIKE ''lever-%''; when lever rows stopped, the management-personas lever-request step or the qnfo-agents ledger is the producer to fix; when rows exist, the agents_lever_usable_tick trigger or its views are broken (EXPLAIN a zero-row INSERT INTO fleet_tick)',
   'SELECT ''1'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_registry WHERE metric = ''agents_lever_usable_share_48h'') THEN ''0'' WHEN COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''agents_lever_usable_share_48h''), '''') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN ''0'' WHEN (SELECT last_value FROM metric_registry WHERE metric = ''agents_lever_usable_share_48h'') IS NULL AND strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'') > ''2026-11-07T19:23:39Z'' THEN ''0'' ELSE ''1'' END AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active');

-- ---- the decision and its prediction, in the parsed form, so calibration_scorer_tick scores it ---------------------------------------------------------------------------------------
INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:agents-lever-metric',
  'the usable-reply share of lever asks, measured with one SQL on both sides of the change, is the outcome of PR 7141; a verdict that waits for a session is a loose end',
  'AGENTS-LEVER-USABLE-1: register agents_lever_usable_share_48h with a trigger and the cost companion agents_usd_per_usable_lever_2d, so the 48 hour verdict on FINAL-ANSWER-PICK-1 is produced by the hourly metric loop',
  'cf_agent_requests 2026-10-28..11-04: 47 of 337 lever rows usable (14 percent) before qnfo-agents 0.6.0; roadmap asks 8 of 21; ai_spend_ledger qnfo-agents 2026-11-04 USD 8.365 over 1385 calls. PR 7141 merged 2026-11-04T19:22:33Z, deploy finished 19:23:39Z, /health 0.6.0.',
  'pending',
  'the metric rows, a fleet_tick trigger, two views and the sample-floor exemption; no worker and no cron',
  'DROP TRIGGER agents_lever_usable_tick and the two views, DELETE the registry, trigger, cause, exemption, control and contract rows named in the Rollback line of migrations/2026-11-04-agents-lever-usable.sql',
  'agents-lever-usable-verdict',
  'agents_lever_usable_share_48h >= 0.6 within 48 h',
  'No external reach gain; cost and autonomy: managers get a usable lever the first time and stop re-asking.',
  'v_agents_lever_usable_48h and v_agents_usd_per_usable_lever read on the live D1; scripts/apply_migrations.py --check'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'AGENTS-LEVER-USABLE-1:%');

INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
  ('agents-lever-usable-verdict', 'migrations/2026-11-04-agents-lever-usable.sql',
   'cf_agent_requests, ai_spend_ledger, fleet_tick, calibration_scorer_tick',
   0.5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'The usable-reply share of lever asks is a registered, triggered metric with a prediction the calibration scorer settles; a code change to qnfo-agents gets its verdict from the hourly loop.');
