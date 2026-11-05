-- AI-METER-AE-2 (2026-11-05, pillar cost, program QNFO.INFRA, roadmap RM-ANALYTICS-ENGINE-METERS-1 row 56, agent_issues 1001927; cluster W2-F agent W2F-A).
-- AI-METER-AE-1 puts one Workers Analytics Engine data point per routed model call into dataset qnfo_ai_calls (binding AI_METER in qnfo-ai, written before the D1 guard in
-- spendRecord, so it survives the D1 overload that makes spendRecord skip its ledger row). This file is the read side: scripts/ai_meter_ae.py (a heavy-job step of
-- remediation-consumer.yml, every 3 hours, idempotent, never fails the job) reads the dataset back through the Analytics Engine SQL API (the REACH-AE-1 pattern of qnfo-infra)
-- and upserts a per-day rollup into ai_meter_ae_daily, keyed (day, provider, caller, model, outcome). v_ai_meter_ae_vs_ledger puts it next to ai_spend_ledger, so the calls the
-- ledger missed are a column, and "who called kimi-k2.6, how often, at what price" is a D1 query that costs the hot path no D1 write.
-- Read 2026-11-05 04:20Z with the Analytics Engine SQL API: datasets qnfo_fleet (24,662 rows, written by qnfo-observability since 2026-10-18), qnfo_ops and qnfo_reach exist;
-- qnfo_ai_calls does not exist until the first write, which is why the reader treats an unknown dataset as "nothing yet", not as a failure.
-- Additive only: no DROP, no DELETE. CAUSE-MAPPED: no metric is registered in this file.
-- PREDICTION: after the qnfo-ai write is deployed, SELECT SUM(ae_calls) - SUM(ledger_calls) FROM v_ai_meter_ae_vs_ledger WHERE day = date('now') reads a number (the ledger's missed calls) within 3 hours, and
--   SELECT COUNT(DISTINCT caller) FROM ai_meter_ae_daily WHERE day = date('now') reads the number of qnfo-ai callers (the ledger shows 10 or more).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_ai_meter_ae_vs_ledger; DROP TABLE IF EXISTS ai_meter_ae_daily;

CREATE TABLE IF NOT EXISTS ai_meter_ae_daily (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  caller TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  calls INTEGER NOT NULL,
  in_tok INTEGER NOT NULL,
  out_tok INTEGER NOT NULL,
  cached_tok INTEGER NOT NULL,
  usd REAL NOT NULL,
  points INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, provider, caller, model, outcome)
) WITHOUT ROWID;

-- calls is 0 for a refused or downgraded call in both stores (spendRecord books calls = 0 for those), so the sums over all outcomes compare like with like.
CREATE VIEW IF NOT EXISTS v_ai_meter_ae_vs_ledger AS
SELECT a.day AS day, a.provider AS provider, a.caller AS caller, a.model AS model,
  SUM(a.calls) AS ae_calls, COALESCE(l.calls, 0) AS ledger_calls, SUM(a.calls) - COALESCE(l.calls, 0) AS ledger_missed_calls,
  ROUND(SUM(a.usd), 3) AS ae_usd, ROUND(COALESCE(l.usd, 0), 3) AS ledger_usd,
  SUM(a.in_tok) AS ae_in_tok, COALESCE(l.in_tok, 0) AS ledger_in_tok, SUM(a.points) AS ae_points
FROM ai_meter_ae_daily a
LEFT JOIN ai_spend_ledger l ON l.day = a.day AND l.provider = a.provider AND l.caller = a.caller AND l.model = a.model
GROUP BY a.day, a.provider, a.caller, a.model;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-a', 'A per-call record that does not depend on D1 being healthy is worth one table and one view: the D1 ledger skips its write under overload, which is when spend runs hottest.',
  'added ai_meter_ae_daily, v_ai_meter_ae_vs_ledger and the heavy-job step scripts/ai_meter_ae.py that reads dataset qnfo_ai_calls back',
  'Analytics Engine SQL API read 2026-11-05: datasets qnfo_fleet, qnfo_ops, qnfo_reach exist; qnfo_ai_calls does not yet; qnfo-ai spendRecord returns before any write when d1AttrWriteSkip() is true',
  'applied by CI on merge; the table fills after the qnfo-ai write is deployed', 'one table (about 30 to 60 rows a day, like the ledger), one view, no worker deploy, no spend (Analytics Engine reads are free of D1 writes beyond the rollup)',
  'DROP VIEW IF EXISTS v_ai_meter_ae_vs_ledger; DROP TABLE IF EXISTS ai_meter_ae_daily; remove the Read the AI meter dataset step from remediation-consumer.yml',
  'calls the ledger missed, and per-caller per-model counts, readable without a D1 hot-path write',
  'ai_meter_ae_daily rows 0 -> 30 or more a day once qnfo-ai writes', 'none', 'Analytics Engine SQL grammar (formatDateTime, _sample_interval) read against qnfo_fleet'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-a' AND action LIKE 'added ai_meter_ae_daily%');
