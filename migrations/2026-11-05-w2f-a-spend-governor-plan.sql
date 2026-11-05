-- SPEND-GOVERNOR-1 (2026-11-05, pillar cost, program QNFO.INFRA, roadmap RM-COST-L6-DRAFT-VERIFY-1 row 13, agent_issues 1001813; cluster W2-F agent W2F-A).
-- Issue 1001813 asked for an hourly governor that demotes each ai_gateway_routes route whose model costs over 1.8x its cheapest sufficient alternative, and records the saving in
-- ai_call_counters under purpose 'governor'. Read 2026-11-05 04:10Z, three premises of that text are wrong:
--   1. ai_gateway_routes has 11 rows and every one is active = 0 (all DELETED 2026-09-26 single-happy-path): there is no route to demote. Model choice lives in each worker's code
--      and in the qnfo-ai router, and a change of a worker's model is judged by the paired A/B harness (model_ab_runs, AB-HARNESS-1), not by a table edit.
--   2. ai_call_counters is the cap input and the attribution-coverage input (workers_ai_attribution_coverage_pct, code_loop_daily_neurons): a 'governor' row holding projected neurons would
--      raise both. The plan therefore goes to its own table.
--   3. The code PR that closed the issue's task (#7333, qnfo-lifecycle 1.17.8) added only `globalThis.spendGovernor = { hourlyRoute: "cheapest" };`, a line no code reads. It stays on main as
--      a claim without a feature until the issue's rewritten code-task removes it.
-- What this file builds is the part that is real and gated: an hourly plan. For every (worker, purpose, model) with at least 20 calls and 20,000 neurons in 7 days (purposes binding and
-- ledger-rollup: the ladder rungs of the code loop are escalations that run after the cheap rung failed, so they are not demotion targets) it finds the cheapest chat model in cf_model_catalog
-- (status in_production or passed, @cf/ id, battery score null or at least 0.9, context at least the current model's) at the same token mix, keeps the row when that is 1.8x cheaper or more,
-- and reads the latest model_ab_runs verdict for that pair: action 'demote' only with a 'pass', else 'queue-ab'. Nothing is switched by this file: it names the order in which to spend A/B runs.
-- Live read of the same SQL, 2026-11-05 04:20Z: 18 (worker, purpose, model) rows over the floors, 14 of them 1.8x cheaper with an alternative, USD 1.77 a day at 100 percent adoption
-- (q08-signal-engine kimi-k2.6 to glm-5.3-flash 0.34, qnfo-paper-reviser deepseek-v4-flash-0731 0.27, gpt-oss-120b 0.23, qnfo-gateway kimi-k2.6 0.19, errata-hub kimi-k2.6 0.17).
-- Known under-count: the agent loop's one ledger-rollup row (about USD 10.4 a day, the largest line) does not pass the 1.8x test because its alternative is priced on uncached input
-- while about a quarter of its input is cached; pricing it from ai_spend_ledger cached_tok is the first follow-up (agent_issues 1001813, NEXT). The code loop's top rung
-- kimi-k2.7-code (USD 24.41 over 7 days at list price) is already governed by the ladder. Zero model_ab_runs pass rows exist for any pair (27 runs, verdicts error, inconclusive
-- and regression), so no demotion is evidenced today and the honest prediction for this file is a plan, not a saving.
-- PREDICTION: SELECT COUNT(*), ROUND(SUM(save_usd_day), 2) FROM spend_governor_plan WHERE day = date('now') reads 10 or more rows and USD 1.5 or more within 2 hours of the apply.
-- CAUSE-MAPPED: no metric is registered in this file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_crons SET enabled = 0 WHERE name = 'spend-governor-plan-hourly'; UPDATE fleet_tasks SET enabled = 0 WHERE id = 'spend-governor-plan'; DROP VIEW IF EXISTS v_spend_governor_plan; DROP TABLE IF EXISTS spend_governor_plan;

CREATE TABLE IF NOT EXISTS spend_governor_plan (
  day TEXT NOT NULL,
  worker TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  alt_model TEXT NOT NULL,
  calls_7d INTEGER NOT NULL,
  cur_usd_7d REAL NOT NULL,
  alt_usd_7d REAL NOT NULL,
  save_usd_day REAL NOT NULL,
  ab_verdict TEXT,
  action TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, worker, purpose, model)
) WITHOUT ROWID;

CREATE VIEW IF NOT EXISTS v_spend_governor_plan AS
WITH cur AS (
  SELECT c.worker AS worker, c.purpose AS purpose, c.model AS model, SUM(c.calls) AS calls, SUM(c.in_tok) AS in_tok, SUM(c.out_tok) AS out_tok,
    SUM(c.neurons) * 0.000011 AS cur_usd
  FROM ai_call_counters c
  WHERE c.day >= date('now', '-7 days') AND c.purpose IN ('binding', 'ledger-rollup') AND c.neurons > 0
  GROUP BY c.worker, c.purpose, c.model
  HAVING SUM(c.calls) >= 20 AND SUM(c.neurons) >= 20000
),
alt AS (
  SELECT p.worker AS worker, p.purpose AS purpose, p.model AS model, a.model_id AS alt_model,
    (p.in_tok * a.price_in + p.out_tok * a.price_out) / 1000000.0 AS alt_usd,
    ROW_NUMBER() OVER (PARTITION BY p.worker, p.purpose, p.model ORDER BY (p.in_tok * a.price_in + p.out_tok * a.price_out) ASC, a.model_id ASC) AS rk
  FROM cur p JOIN cf_model_catalog a
    ON a.status IN ('in_production', 'passed') AND a.modality = 'chat' AND a.model_id LIKE '@cf/%' AND a.model_id <> p.model
   AND a.price_in > 0 AND (a.best_score IS NULL OR a.best_score >= 0.9)
   AND a.ctx >= COALESCE((SELECT m.ctx FROM cf_model_catalog m WHERE m.model_id = p.model), 128000)
),
pick AS (
  SELECT p.worker AS worker, p.purpose AS purpose, p.model AS model, al.alt_model AS alt_model, p.calls AS calls, p.cur_usd AS cur_usd, al.alt_usd AS alt_usd,
    (SELECT r.verdict FROM model_ab_runs r WHERE r.worker = p.worker AND r.pre_model = p.model AND r.post_model = al.alt_model ORDER BY r.id DESC LIMIT 1) AS ab_verdict
  FROM cur p JOIN alt al ON al.worker = p.worker AND al.purpose = p.purpose AND al.model = p.model AND al.rk = 1
  WHERE al.alt_usd * 1.8 <= p.cur_usd
)
SELECT worker, purpose, model, alt_model, calls AS calls_7d, ROUND(cur_usd, 2) AS cur_usd_7d, ROUND(alt_usd, 2) AS alt_usd_7d,
  ROUND((cur_usd - alt_usd) / 7.0, 2) AS save_usd_day, ab_verdict,
  CASE WHEN ab_verdict = 'pass' THEN 'demote' ELSE 'queue-ab' END AS action
FROM pick;

INSERT INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at)
VALUES ('spend-governor-plan', 'SPEND-GOVERNOR-1 / RM-COST-L6-DRAFT-VERIFY-1: hourly plan of the models that cost 1.8x or more than the cheapest sufficient alternative, gated on a paired A/B pass', 'workflow',
 '{"steps":[{"type":"sql","db":"AUDIT","sql":"INSERT INTO spend_governor_plan (day, worker, purpose, model, alt_model, calls_7d, cur_usd_7d, alt_usd_7d, save_usd_day, ab_verdict, action, updated_at) SELECT date(''now''), worker, purpose, model, alt_model, calls_7d, cur_usd_7d, alt_usd_7d, save_usd_day, ab_verdict, action, datetime(''now'') FROM v_spend_governor_plan WHERE 1 ON CONFLICT(day, worker, purpose, model) DO UPDATE SET alt_model = excluded.alt_model, calls_7d = excluded.calls_7d, cur_usd_7d = excluded.cur_usd_7d, alt_usd_7d = excluded.alt_usd_7d, save_usd_day = excluded.save_usd_day, ab_verdict = excluded.ab_verdict, action = excluded.action, updated_at = excluded.updated_at"}]}',
 30000, 1, 1, 1, datetime('now'))
ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition = excluded.definition, version = fleet_tasks.version + 1, enabled = 1, updated_at = excluded.updated_at;

INSERT INTO fleet_crons (name, cron_expr, task_id, enabled, timezone, updated_at)
VALUES ('spend-governor-plan-hourly', '35 * * * *', 'spend-governor-plan', 1, 'UTC', datetime('now'))
ON CONFLICT(name) DO UPDATE SET cron_expr = excluded.cron_expr, task_id = excluded.task_id, enabled = excluded.enabled, updated_at = excluded.updated_at;

UPDATE agent_issues SET updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, description =
 'code-task: repo=qnfo-workers path=qnfo-lifecycle/worker.js' || char(10) ||
 'code-anchor: globalThis.spendGovernor = { hourlyRoute: "cheapest" };' || char(10) ||
 'code-probe: {"paths": ["qnfo-lifecycle/worker.js"], "absent": "globalThis.spendGovernor"}' || char(10) || char(10) ||
 'REWRITTEN 2026-11-05 by session w2f-a (SPEND-GOVERNOR-1, migrations/2026-11-05-w2f-a-spend-governor-plan.sql). Pillar cost, program QNFO.INFRA, roadmap RM-COST-L6-DRAFT-VERIFY-1 (row 13). Original ask: an hourly governor that demotes routes to the cheapest sufficient model, predicted cost 798.53 -> 700 (-12 percent).' || char(10) ||
 'What is built: the hourly plan (D1 workflow spend-governor-plan, table spend_governor_plan, view v_spend_governor_plan). It lists each (worker, purpose, model) with an alternative that is 1.8x cheaper at the same token mix and the latest paired A/B verdict for the pair; action demote only with a pass, else queue-ab. Zero A/B passes exist today, so nothing is switched.' || char(10) ||
 'Why the original edit could not be built as written: ai_gateway_routes has no active route (11 rows, all active = 0, deleted 2026-09-26); ai_call_counters rows with purpose governor would raise the cap and attribution inputs; and PR 7333 added only a line no code reads (globalThis.spendGovernor), which this issue now removes.' || char(10) ||
 'DO (this code-task): delete the line `globalThis.spendGovernor = { hourlyRoute: "cheapest" };` from qnfo-lifecycle/worker.js and its mirror deployed-current.worker.js, bump with python scripts/worker_release.py bump qnfo-lifecycle --note "remove the dead spendGovernor stub (SPEND-GOVERNOR-1)". The code-probe above closes it.' || char(10) ||
 'NEXT (not this task): act on the plan. Read SELECT * FROM v_spend_governor_plan ORDER BY save_usd_day DESC (14 rows, USD 1.77 a day at 100 percent adoption on 2026-11-05). (1) The one large line, the agent loop (ledger-rollup, about USD 10.4 a day), is under-counted: its alternative is priced on uncached input, so it fails the 1.8x test; price it from ai_spend_ledger cached_tok in the view. (2) Switch the model of one worker at a time through the worker''s own code, so AB-HARNESS-1 runs the paired comparison (scripts/model-policy.json, model_ab_runs); keep the change only on a pass, revert on a regression. Record each switch in decision_log with its revert path.' || char(10) ||
 'Definition of done: the stub is gone from main (code-probe), the plan table has rows for the current day (SELECT COUNT(*) FROM spend_governor_plan WHERE day = date(''now'')), and the first demoted pair has a pass row in model_ab_runs and a lower cost_per_task in v_cost_per_task_all_paths; recorded in issue_triage.close_evidence.' || char(10) ||
 'north-star: cost' || char(10) ||
 'prediction: cost: the plan alone moves nothing; the first applied demotion of a 1.8x line should cut that line by about 45 percent, read in v_spend_governor_plan and ai_meter_model_daily one week after the switch.'
 WHERE id = 1001813 AND status = 'open';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-a', 'A governor that switches models without a paired quality verdict would trade output quality for dollars (MODEL-QUALITY-PARITY-1), and one that writes projected neurons into ai_call_counters would corrupt the cap and attribution inputs, so the first real slice is an hourly plan gated on model_ab_runs, in its own table.',
  'added spend_governor_plan, v_spend_governor_plan and the hourly D1 workflow spend-governor-plan; rewrote the code-task of agent_issues 1001813 to remove the dead spendGovernor stub',
  'ai_gateway_routes read 2026-11-05: 11 rows, all active 0; model_ab_runs: 27 runs, no pass for any candidate pair; PR 7333 added `globalThis.spendGovernor = { hourlyRoute: "cheapest" };` to qnfo-lifecycle/worker.js and nothing reads it',
  'applied by CI on merge; the plan fills at the next :35 tick', 'one table (about 15 rows a day), one view, one hourly SQL task, no worker deploy, no model switched',
  'UPDATE fleet_crons SET enabled = 0 WHERE name = ''spend-governor-plan-hourly''; DROP VIEW IF EXISTS v_spend_governor_plan; DROP TABLE IF EXISTS spend_governor_plan',
  'the fleet names, hourly and with the A/B state next to each line, which model switch is worth testing next and what it would save',
  'spend_governor_plan day rows 0 -> 10 or more; no change in Workers AI spend from this file', 'none', 'candidate SQL run read-only against qnfo-audit 2026-11-05 04:10Z'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-a' AND action LIKE 'added spend_governor_plan%');
