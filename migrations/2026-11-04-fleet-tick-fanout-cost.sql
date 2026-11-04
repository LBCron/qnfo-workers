-- FLEET-TICK-FANOUT-COST-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1, owner: fleet cost under $200-300 a month and a fast dashboard).
-- Measured 2026-11-04 15:00Z on qnfo-audit (D1 GraphQL d1QueriesAdaptiveGroups, 24 h): every successful INSERT INTO fleet_tick reads about 1.6 M rows
-- (2.1-2.25 M on the hourly tick) and takes 7-30 s of D1 time, because the 52 AFTER INSERT triggers run inside that one statement on a single-threaded
-- database; a failed or retried attempt re-reads the same rows (the 5-minute buckets with 10-44 attempts read 15-74 M rows each). In the last 24 h
-- cron:qnfo-fleet-dashboard wrote 143 of 143 ticks. Profiled trigger by trigger (the SELECT part of each statement run against the live data, rows_read from D1):
--   autonomy_selfheal_tick   about 1.1 M: open_issues_without_doer_24h and _120m each scan all of code_tasks (1,428 rows, LIKE with a computed
--                            pattern, no index can serve it) once per open issue older than the window: 541 K rows and 4.1 s per statement.
--   antifragile_tick_10m     about 0.4 M: it writes issues_open_over_120m; issue_sla_bound_metric_after_write (ISSUE-SLA-SCOPE-1, 2026-11-01) then reads
--                            v_sla_bound_issue_age twice (WHEN and body), and the view scans all of goals and objective_space once per open issue
--                            (four OR terms with a computed LIKE pattern): about 195 K rows per read.
--   the other 28 always-on triggers together read about 0.2 M (largest: scorecard_v2_tick 29 K, content_items_over_stage_sla_tick 23 K,
--                            cadence_overdue_tick_10m 21 K, outreach_impact_tick 17 K, queue_sla_tick_10m 16 K, agent_issues_normalise_tick 16 K).
-- Fix (same results, verified on live data: 24 h and 120 m doer-less id sets and the 320 SLA-bound ids are identical old against new):
--   1. the doer-less counts read code_tasks and work_claims once into an IN list (a non-correlated subquery is materialised once) and drive the outer
--      scan from idx_issues_status (the unary plus on created_at stops the planner choosing idx_issues_created, which read 5.3 K index entries and rows):
--      541 K -> 4.9 K rows and 4.1 s -> 13 ms per statement.
--   2. v_sla_bound_issue_age reads goals and objective_space once: the issue id is parsed out of source ('agent_issues:<id>' or 'agent_issues <id>', optionally
--      followed by ' (' and a note), the same four forms the old OR matched: about 195 K -> 2.5 K rows per read.
-- Prediction: rows read per tick 1.6 M -> under 0.3 M (-80 % or more), tick statement 7-30 s -> under 2 s, qnfo-audit rows read per day -230 M (about 10 %),
-- D1 'overloaded' errors in the retry storm windows -> 0. No index is missing for these statements (idx_issues_status, idx_work_claims_open and
-- idx_work_claims_path_open exist); the cadence of the tick is untouched (owner SLA: ten minutes).
-- Not changed: D1-OVERLOAD-1e would have the dashboard tick only when the newest row is older than 20 minutes. The orchestrator wrote 0 of 143 ticks in 24 h,
-- so that guard would stretch the real cadence to 20-30 minutes; its issue gets a caution below and a measurement-based supersede once this lands.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_fleet_tick_fanout
-- Rollback: DROP TRIGGER IF EXISTS autonomy_selfheal_tick; DROP VIEW IF EXISTS v_sla_bound_issue_age; then re-create both from bak_20261104_fleet_tick_fanout (column sql holds the exact previous CREATE statements); DELETE FROM spof_registry WHERE component = 'fleet_tick producers (qnfo-audit trigger fan-out)'; DELETE FROM remediation_contracts WHERE class = 'fm-fleet-tick-fanout-rows-read'; DELETE FROM failure_modes WHERE fm_key = 'fleet-tick-fanout-rows-read'
-- spof-review: rewrite of two existing objects (same inputs and outputs, no new dependency); the single-producer exposure is recorded below with its second-source issue.

CREATE TABLE IF NOT EXISTS bak_20261104_fleet_tick_fanout AS
SELECT name, type, sql FROM sqlite_master WHERE name IN ('autonomy_selfheal_tick', 'v_sla_bound_issue_age');

DROP TRIGGER IF EXISTS autonomy_selfheal_tick;
CREATE TRIGGER autonomy_selfheal_tick AFTER INSERT ON fleet_tick
BEGIN
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT COUNT(*) FROM agent_issues a WHERE a.status = 'open' AND +a.created_at <= (CAST(strftime('%s', 'now') AS INTEGER) - 86400) * 1000
        AND instr(COALESCE(a.description, ''), 'code-task:') = 0
        AND CAST(a.id AS TEXT) NOT IN (SELECT substr(k.goal, 9, instr(k.goal, ']') - 9) FROM code_tasks k WHERE k.goal LIKE '[issue #%]%' AND k.status NOT IN ('failed', 'closed', 'superseded', 'needs_human'))
        AND a.id NOT IN (SELECT w.issue_id FROM work_claims w WHERE w.issue_id IS NOT NULL AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        AND 'issue:' || a.id NOT IN (SELECT w.path FROM work_claims w WHERE w.path IS NOT NULL AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))) AS TEXT)
  WHERE metric = 'open_issues_without_doer_24h';
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT COUNT(*) FROM agent_issues a WHERE a.status = 'open' AND +a.created_at <= (CAST(strftime('%s', 'now') AS INTEGER) - 7200) * 1000
        AND instr(COALESCE(a.description, ''), 'code-task:') = 0
        AND CAST(a.id AS TEXT) NOT IN (SELECT substr(k.goal, 9, instr(k.goal, ']') - 9) FROM code_tasks k WHERE k.goal LIKE '[issue #%]%' AND k.status NOT IN ('failed', 'closed', 'superseded', 'needs_human'))
        AND a.id NOT IN (SELECT w.issue_id FROM work_claims w WHERE w.issue_id IS NOT NULL AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        AND 'issue:' || a.id NOT IN (SELECT w.path FROM work_claims w WHERE w.path IS NOT NULL AND w.released_at IS NULL AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))) AS TEXT)
  WHERE metric = 'open_issues_without_doer_120m';
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT COUNT(DISTINCT a.id) FROM agent_issues a JOIN remediation_contracts c ON c.issue_id = a.id AND c.status IN ('active', 'holding')
      WHERE a.status = 'open' AND (COALESCE(c.last_verdict, '') IN ('vacuous-probe-result', 'probe-not-machine-executable', 'probe-error', 'probe-same-account-host')
            OR instr(c.verify_probe, 'THEN ''closed'' ELSE NULL END FROM agent_issues WHERE id = ') > 0)) AS TEXT)
  WHERE metric = 'contracts_unexecutable_open';
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT COALESCE(CAST(ROUND((julianday('now') - julianday((SELECT verified_at FROM remediation_verifications INDEXED BY idx_remediation_verifications_ts
      WHERE verifier LIKE 'qnfo-fleet-control/remediation-tick%' ORDER BY verified_at DESC LIMIT 1))) * 1440) AS INTEGER), 9999)) AS TEXT)
  WHERE metric = 'remediation_tick_age_min';
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST((
      SELECT ROUND(1.0 * SUM(CASE WHEN COALESCE(a.close_channel, '') NOT LIKE 'session%' AND COALESCE(a.close_channel, '') NOT LIKE 'claude%'
                                   AND COALESCE(a.close_channel, '') NOT LIKE 'issue-triage%'
                                   AND NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = a.id
                                                   AND (COALESCE(t.owner, '') LIKE 'session%' OR COALESCE(t.owner, '') LIKE 'claude%'))
                              THEN 1 ELSE 0 END) / MAX(1, COUNT(*)), 3)
      FROM agent_issues a WHERE a.status IN ('closed', 'resolved') AND a.updated_at > (CAST(strftime('%s', 'now') AS INTEGER) - 604800) * 1000) AS TEXT)
  WHERE metric = 'server_side_close_share_7d';
  UPDATE metric_registry SET last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED', last_value = CAST(ROUND(100.0 * (
        MIN(1.0, MAX(0.0, COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'autonomy_rate_7d'), 0)))
      + MIN(1.0, MAX(0.0, COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'server_side_close_share_7d'), 0)))
      + MIN(1.0, MAX(0.0, COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'issue_auto_close_2h_share_24h'), 0)))
      + MIN(1.0, MAX(0.0, COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'issue_drain_ratio_24h'), 0) / 1.5))
      + MIN(1.0, MAX(0.0, (120.0 - COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'remediation_tick_age_min'), 120)) / 100.0))
      + MAX(0.0, 1.0 - COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'contracts_unexecutable_open'), 10) / 10.0)
      + MAX(0.0, 1.0 - COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'open_issues_without_doer_120m'), 0)
                       / MAX(1.0, (SELECT COUNT(*) FROM agent_issues WHERE status = 'open')))
    ) / 7.0, 1) AS TEXT)
  WHERE metric = 'autonomy_selfheal_score';
END;

DROP VIEW IF EXISTS v_sla_bound_issue_age;
CREATE VIEW v_sla_bound_issue_age AS
SELECT a.id, a.priority, a.title, a.age_min, i.category
FROM v_issue_age a
JOIN agent_issues i ON i.id = a.id
WHERE a.age_min >= 120
  AND lower(trim(COALESCE(i.category, ''))) IN ('defect', 'incident', 'reliability')
  AND i.title NOT LIKE 'METRIC-TRIGGER-%'
  AND CAST(i.id AS TEXT) NOT IN (
    SELECT CASE WHEN instr(substr(g.source, 14), ' (') > 0 THEN substr(g.source, 14, instr(substr(g.source, 14), ' (') - 1) ELSE substr(g.source, 14) END
    FROM goals g WHERE substr(g.source, 1, 13) IN ('agent_issues:', 'agent_issues ')
  )
  AND CAST(i.id AS TEXT) NOT IN (
    SELECT CASE WHEN instr(substr(o.source, 14), ' (') > 0 THEN substr(o.source, 14, instr(substr(o.source, 14), ' (') - 1) ELSE substr(o.source, 14) END
    FROM objective_space o WHERE substr(o.source, 1, 13) IN ('agent_issues:', 'agent_issues ')
  );

INSERT INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence, issue_id, reviewed_at)
SELECT 'fleet_tick producers (qnfo-audit trigger fan-out)',
  'every 10-minute D1 fixer (52 AFTER INSERT triggers on fleet_tick: queue SLA, age ladder, reconcile, doctrine metrics, self-heal scores) runs from one INSERT whose producer is a race between two workers on the same 9-minute guard; in the 24 h to 2026-11-04T15:00Z cron:qnfo-fleet-dashboard wrote 143 of 143 ticks and cron:qnfo-code-orchestrator 0 (its */2 attempts were blocked by the guard or never ran), so one worker is the single producer in practice',
  'qnfo-code-orchestrator */2 feedFleetTick (same guard) takes the slot whenever the dashboard has not written for 9 minutes; a third producer in a different worker (qnfo-fleet-control, */10 cron) is filed as FLEET-TICK-SECOND-SOURCE-1; the database itself is a shared single-threaded dependency, so the tick statement is kept under 2 s (FLEET-TICK-FANOUT-COST-1)',
  NULL,
  'GraphQL d1QueriesAdaptiveGroups 24 h: INSERT INTO fleet_tick cron:qnfo-fleet-dashboard 143 inserts and 345 M rows read; SELECT source, COUNT(*) FROM fleet_tick over 24 h returns one source; a tick of 1.6 M rows and 7-30 s plus retries is what overloaded D1 in the 5-minute windows with 10-44 attempts',
  (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM spof_registry WHERE component = 'fleet_tick producers (qnfo-audit trigger fan-out)');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'FLEET-TICK-SECOND-SOURCE-1: fleet_tick has one producer in practice (dashboard 143 of 143 ticks in 24 h); add a producer in qnfo-fleet-control',
 'QNFO.OPS; charter pillar autonomy. Measured 2026-11-04 (SELECT source, COUNT(*) FROM fleet_tick WHERE ts > now - 24 h GROUP BY source): cron:qnfo-fleet-dashboard 143, cron:qnfo-code-orchestrator 0. The 52 fleet_tick triggers are every 10-minute fixer, so a dashboard outage stops them until the orchestrator wins the slot, and the orchestrator has not won one in 24 h. Spof row: spof_registry component fleet_tick producers (qnfo-audit trigger fan-out). Fix: in qnfo-fleet-control scheduledOnce (the */10 cron) insert a fleet_tick row only when no row is newer than 12 minutes (standby behind the two 9-minute producers, so the cadence never changes and never doubles), source cron:qnfo-fleet-control, with the same OR IGNORE isolated retry the orchestrator uses, and record the outcome in fleet_heartbeat. Do not lengthen the 10-minute tick (owner SLA). Prediction: fleet_tick sources in 24 h 1 -> 2 or more with the primary healthy at 0-2 rows from the standby, and tick_completion_24h unchanged. Closing marker: the fix carries the text FLEET-TICK-SECOND-SOURCE-1 in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: async scheduledOnce(event, env, ctx) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-control/worker.js"],"contains":"FLEET-TICK-SECOND-SOURCE-1"}',
 'session:fleet-tick-fanout', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'FLEET-TICK-SECOND-SOURCE-1:%' AND status = 'open');

UPDATE agent_issues SET updated_at = unixepoch() * 1000,
  description = COALESCE(description, '') || char(10) || 'CADENCE-CAUTION (FLEET-TICK-FANOUT-COST-1, 2026-11-04): in the 24 h to 15:00Z the dashboard wrote 143 of 143 fleet_tick rows and the orchestrator 0, so a guard of 20 minutes would stretch the real tick to 20-30 minutes and break the owner 10-minute SLA. The rows read per tick fall at the cause instead (autonomy_selfheal_tick and issue_sla_bound_metric_after_write, migrations/2026-11-04-fleet-tick-fanout-cost.sql); keep the 9-minute guard, drop or reshape this change after FLEET-TICK-SECOND-SOURCE-1 gives the tick a second live producer.'
WHERE title LIKE 'D1-OVERLOAD-1e:%' AND status = 'open' AND instr(COALESCE(description, ''), 'CADENCE-CAUTION') = 0;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('fleet-tick-fanout-rows-read',
  'one fleet_tick insert reads over a million rows and holds the single-threaded D1 for 7-30 s, so every other statement on qnfo-audit queues or fails with D1 DB is overloaded',
  'a fleet_tick trigger statement (or a metric_registry trigger it fires) runs a correlated subquery that scans a whole table once per open issue: code_tasks LIKE with a computed pattern in autonomy_selfheal_tick (541 K rows each, twice) and goals/objective_space OR LIKE in v_sla_bound_issue_age (195 K rows each, twice); the first fix on 2026-10-18 (D1-ROWS-READ-HOTSPOTS-1, 1.08 M -> 0.29 M) was undone as the tables and the open-issue count grew and ISSUE-SLA-SCOPE-1 added the second scan',
  'FLEET-TICK-FANOUT-COST-1: read the inner table once into an IN list (a non-correlated subquery is materialised once), never once per outer row; the detector fails when a fleet_tick trigger or v_sla_bound_issue_age again carries the correlated shape',
  'fm-fleet-tick-fanout-rows-read: count of fleet_tick triggers and v_sla_bound_issue_age whose SQL contains a correlated LIKE with a computed pattern (zero while the fixes stand)',
  'fm-fleet-tick-fanout-rows-read', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'a new or edited fleet_tick trigger whose statement scans a table inside NOT EXISTS or a scalar subquery with a pattern built from the outer row',
  'INSERT INTO fleet_tick rows_read above 1 M in d1QueriesAdaptiveGroups; 429 D1 DB is overloaded in the minute after each tick; retry storms of the same insert',
  'every writer and reader of qnfo-audit while the tick statement runs');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-fleet-tick-fanout-rows-read', NULL, 'FLEET-TICK-FANOUT-COST-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM sqlite_master WHERE ((type = ''trigger'' AND tbl_name = ''fleet_tick'') OR name = ''v_sla_bound_issue_age'') AND (sql LIKE ''%k.goal LIKE ''''[issue #'''' ||%'' OR sql LIKE ''%g.source LIKE ''''agent_issues:'''' || i.id%'')) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'the fleet_tick fan-out is the largest D1 load and most of it is two correlated table scans, not the number of triggers',
  'FLEET-TICK-FANOUT-COST-1: autonomy_selfheal_tick and v_sla_bound_issue_age rewritten to read code_tasks, work_claims, goals and objective_space once; D1-OVERLOAD-1e given a cadence caution; fleet_tick single-producer exposure recorded in spof_registry with FLEET-TICK-SECOND-SOURCE-1',
  'GraphQL d1QueriesAdaptiveGroups 24 h: INSERT INTO fleet_tick 1.6 M rows per tick, 345 M rows read a day; per-trigger profile: autonomy_selfheal 1.1 M, antifragile 0.4 M, 28 others 0.2 M; old and new queries return identical id sets on live data',
  'same metric values, about 85 % fewer rows read per tick', 'one trigger and one view on qnfo-audit (old text in bak_20261104_fleet_tick_fanout), one spof row, one failure mode and detector, one issue',
  'the Rollback line', 'the 10-minute tick costs about a tenth of its rows and stops overloading D1',
  'rows read per fleet_tick insert 1.6 M -> under 0.3 M and statement time 7-30 s -> under 2 s, measured by d1QueriesAdaptiveGroups after the merge', NULL, 'live qnfo-audit data (old against new id sets), SQLite test in migrations/fleet-tick-fanout-cost.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'FLEET-TICK-FANOUT-COST-1:%');
