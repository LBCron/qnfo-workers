-- COE-FILER-DEPTH-FIX-1 (2026-11-04, charter pillar autonomy / reliability). Record of a live repair made at 19:22Z, plus the alarm that was missing.
-- Incident: migration cloud-ops-events-trigger-cost.sql (applied 18:57:08Z) re-created tool_error_rate_filer_v3_ins (AFTER INSERT ON cloud_ops_events, body INSERT INTO agent_issues) with only its WHEN clause changed.
-- From 18:57:17Z every plain INSERT INTO cloud_ops_events (VALUES and SELECT forms) failed with "triggers nested too deep" until 19:22Z: qnfo-ops, qnfo-fleet-control, qnfo-youtube-shorts and qnfo-pdf lost event writes
-- (INSERT OR IGNORE and OR REPLACE writers kept working, so about half of the writers did). Observed from worker_logs (first exception 18:57:17Z, 9 s after the apply) and a zero-row probe at 19:10Z.
-- Root cause, reproduced on a scratch copy of the whole schema (1,683 objects, trigger order kept): with the filer trigger absent the insert compiles; with it present as the newest trigger of the table, in its new
-- OR in its old text, it does not (depth 11 on the path cloud_ops_events -> agent_issues -> ... -> metric_registry; the chain was already at the limit and a trigger's place in the table's list decides which side of it a
-- recreated trigger falls); the same trigger with INSERT OR IGNORE INTO agent_issues in its body compiles. OR IGNORE is also the right semantics here: the WHEN already skips an open ticket of the same title, and a plain INSERT
-- that met the unique index on open titles would abort the event insert instead of skipping the ticket.
-- Repair (applied by hand at 19:22Z, backup bak_20261104_coe_filer_trigger_v2 holds the broken text; this file repeats it, idempotently, so main matches production): the same trigger with INSERT OR IGNORE INTO agent_issues.
-- Why the runner let it through: scripts/apply_migrations.py treated every refused INSERT probe as an advisory since 2026-10-18 (agent_issues refuses that form while real inserts work). The same PR adds INSERT-BASELINE-CANARY-1:
-- a probe that passed before the file and is refused after a CREATE TRIGGER now refuses the file (a chronic refusal stays an advisory), and a restored prior definition that refuses inserts again is dropped again.
-- Alarm: fm-trigger-depth-errors-live reads worker_logs for more than 5 "nested too deep" exceptions in the last 30 minutes (normal: 0; the 18:57-19:22Z window had dozens), served by the ts_ms range.
-- Prediction: plain INSERT INTO cloud_ops_events compiles (verified 19:22Z); the filer still files TOOL-ERROR-RATE tickets (same WHEN); the detector reads 0.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_coe_filer_trigger_v2
-- Rollback: DROP TRIGGER IF EXISTS tool_error_rate_filer_v3_ins; then execute the sql column of bak_20261104_coe_filer_trigger (the pre-18:57 text) or of bak_20261104_coe_filer_trigger_v2 (the broken text); DELETE FROM remediation_contracts WHERE class = 'fm-trigger-depth-errors-live'; DELETE FROM failure_modes WHERE fm_key = 'trigger-depth-errors-live'
-- spof-review: one trigger replaced by its own text with a safer conflict clause; one read-only detector.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_coe_filer_trigger_v2 AS
SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'tool_error_rate_filer_v3_ins';

DROP TRIGGER IF EXISTS tool_error_rate_filer_v3_ins;

CREATE TRIGGER tool_error_rate_filer_v3_ins AFTER INSERT ON cloud_ops_events
WHEN NEW.kind = 'ops_ai_tool' AND NEW.status = 'error'
AND NOT EXISTS (SELECT 1 FROM tool_error_exclusions e WHERE instr(COALESCE(NEW.meta,''), e.pattern) > 0 OR instr(COALESCE(NEW.text,''), e.pattern) > 0)
AND (SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = NEW.text AND e.ts >= strftime('%Y-%m-%dT%H:%M:%S','now','-24 hours')) >= 20
AND (SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = NEW.text AND e.status='error' AND NOT EXISTS (SELECT 1 FROM tool_error_exclusions x WHERE instr(COALESCE(e.meta,''), x.pattern) > 0 OR instr(COALESCE(e.text,''), x.pattern) > 0) AND e.ts >= strftime('%Y-%m-%dT%H:%M:%S','now','-24 hours')) >= 10
AND (
  1.0 * (SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = NEW.text AND e.status='error' AND NOT EXISTS (SELECT 1 FROM tool_error_exclusions x WHERE instr(COALESCE(e.meta,''), x.pattern) > 0 OR instr(COALESCE(e.text,''), x.pattern) > 0) AND e.ts >= strftime('%Y-%m-%dT%H:%M:%S','now','-24 hours'))
  / MAX(1, (SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = NEW.text AND e.ts >= strftime('%Y-%m-%dT%H:%M:%S','now','-24 hours')))
  >= 0.25
  OR (SELECT COUNT(*) FROM cloud_ops_events e WHERE e.kind='ops_ai_tool' AND e.text = NEW.text AND e.status='error' AND e.ts >= strftime('%Y-%m-%dT%H:%M:%S','now','-24 hours')) >= 60
)
AND NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.title = 'TOOL-ERROR-RATE-' || NEW.text || '-1' AND a.status = 'open')
BEGIN
INSERT OR IGNORE INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
VALUES ('TOOL-ERROR-RATE-' || NEW.text || '-1',
'Auto-filed by tool_error_rate_filer_v3_ins (TOOL-FAILURE-CLASSIFY-4, 2026-09-29). v3 fixes the v2 defect: v2 computed its fail rate as 24h_errors / MAX(1, 24h_errors), which is identically 1.0, so the >=0.25 arm was vacuous and every tool with >=5 errors in 24h filed a ticket (that is how 1344/1387/1404 were filed). v3 computes unexcluded_errors / total_calls over a minimum 20-call sample, requires unexcluded_errors >= 10, and raises the raw-volume arm to >=60. Exclusions honoured on both sides. Triggering event: ' || NEW.id || '.',
'cloud_ops_events:' || NEW.id, 'observability', 'high', 'open',
CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
 ('trigger-depth-errors-live',
  'plain INSERTs into a hot table fail with "triggers nested too deep" after a trigger change, while the migration run is recorded ok',
  'the trigger chain behind the table sits at D1''s depth limit (11 on cloud_ops_events -> agent_issues -> ... -> metric_registry), a re-created trigger lands as the newest of the table''s list and tips it over, and the runner reported its refused INSERT probe only as an advisory',
  'INSERT-BASELINE-CANARY-1 in scripts/apply_migrations.py refuses the file when the insert compiled before it; repair by re-creating the trigger with a shallower body (INSERT OR IGNORE) or removing it; this detector reads the live exceptions',
  'fm-trigger-depth-errors-live: 1 when more than 5 worker_logs exceptions in the last 30 minutes say "nested too deep", expected 0',
  'fm-trigger-depth-errors-live', '2026-11-04', (SELECT id FROM agent_issues WHERE title LIKE 'D1-OVERLOAD-1e:%' ORDER BY id DESC LIMIT 1),
  'a CREATE TRIGGER on a table whose trigger chain is at the depth limit (cloud_ops_events, agent_issues, remediation_verifications, fleet_tick)',
  'event rows missing for the writers that use a plain INSERT; D1_ERROR triggers nested too deep in qnfo-ops, qnfo-fleet-control, qnfo-pdf',
  'every worker that writes cloud_ops_events with a plain INSERT, the tool-error filer, observability');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, next_due_at, module, budget_ms, max_items, requires_container) VALUES
 ('fm-trigger-depth-errors-live', NULL, 'COE-FILER-DEPTH-FIX-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT COUNT(*) FROM worker_logs WHERE ts_ms > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 1800) * 1000 AND exceptions_json LIKE ''%nested too deep%'') > 5 THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', strftime('%Y-%m-%d %H:%M:%S', 'now'), 'failure-mode', 45000, 5, 0);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a live outage of the event bus outranks the canonical path for the repair, and the same change must then be recorded in a migration so main and production agree',
  'COE-FILER-DEPTH-FIX-1: tool_error_rate_filer_v3_ins re-created with INSERT OR IGNORE INTO agent_issues (applied by hand 19:22Z after a scratch-schema reproduction); detector fm-trigger-depth-errors-live; runner INSERT-BASELINE-CANARY-1',
  'worker_logs: first "triggers nested too deep" exception 18:57:17Z (migration applied 18:57:08Z); zero-row and VALUES inserts into cloud_ops_events refused at 19:10Z, OR IGNORE / OR REPLACE accepted; scratch schema copy: filer absent -> compiles, filer present (old or new text) -> refused, filer with INSERT OR IGNORE -> compiles; after the repair a plain insert succeeds (19:22Z)',
  'plain INSERT INTO cloud_ops_events works again; the next trigger change that breaks an insert that worked is refused by the runner', 'one trigger, one read-only contract, one runner check',
  'the Rollback line', 'an insert-path depth regression is stopped at the migration instead of found by the fleet 25 minutes later',
  'detector reads 0; no new "nested too deep" exception after 19:22Z', NULL, 'scratch D1 copy of the schema, live probes, scripts/apply_migrations_test.py (339 cases) and migrations/coe-filer-depth-fix.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'COE-FILER-DEPTH-FIX-1:%');
