-- CLOUD-OPS-EVENTS-TRIGGER-COST-1 (2026-11-04, pillar cost; D1-SPLIT-1 sibling). Charter pillar: cost.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- MEASURED 2026-11-04 (D1 d1QueriesAdaptiveGroups, 6 h): INSERT INTO cloud_ops_events = 187 s query time, 13.6M rows read; the table
-- has 18 triggers. Two of them read far more than the insert needs:
--  (1) self_heal_reap_stale_v2_ins fires on every kind='ops_ai_tool' insert (45/h) and runs
--      UPDATE self_heal_actions ... WHERE status='dispatched' AND verified_at IS NULL AND <ts expr> < ...
--      self_heal_actions has 13,276 rows and NO index, so each insert scans all of them (~3.6M rows read per 6 h). Only 3 rows
--      match. FIX: partial index idx_sha_dispatched_open ON self_heal_actions(ts) WHERE status='dispatched' AND verified_at IS NULL.
--      It holds only the open rows, the planner uses it because the trigger's WHERE implies the index WHERE. Additive, no trigger change.
--  (2) tool_error_rate_filer_v3_ins (ops_ai_tool + status='error' only) runs five COUNT(*) subqueries on (kind, text) filtered by
--      substr(e.ts,1,19) >= strftime(...). The substr() hides ts from idx_coe_kind_text_ts(kind,text,ts), so every error insert reads
--      the tool's whole history. FIX: replace the five `substr(e.ts,1,19) >= X` with `e.ts >= X`.
--      EQUIVALENCE (X is always exactly 19 chars, '%Y-%m-%dT%H:%M:%S'; both sides compare under BINARY collation):
--        len(ts) < 19: substr(ts,1,19) = ts, identical expression.
--        len(ts) >= 19: let p = substr(ts,1,19). p > X  => ts > X (same first 19 chars decide). p < X => ts < X.
--        p = X => ts >= X is true (ts equals X or extends it) and p >= X is true. So (p >= X) <=> (ts >= X) for every string ts.
--      NULL ts is NULL in both. The trigger therefore files the same issues for every row set; only the access path changes
--      (index range seek on kind, text, ts).
-- Left alone on purpose (cheap, or no behaviour-preserving cut): secret scrub/guard x4 (LIKE on NEW only, no reads), meta_json_guard x2,
-- ts_norm x3 (WHEN on NEW only; 0 length-19 rows in the last hour), deploy_locks_reap_expired_v2_ins (55-row table), tool_error_files_issue_v2
-- (error inserts only, ~2/h), metric_goal_review_* / metric_probe_review_* (kind-guarded, range on idx_coe_kind_ts, ~200-300 rows),
-- agent_actions_from_secret_changes (secret-change kind only). Doc: docs/D1-CLOUD-OPS-EVENTS-2026-11.md.
-- Rollback: DROP INDEX IF EXISTS idx_sha_dispatched_open; DROP TRIGGER IF EXISTS tool_error_rate_filer_v3_ins; then execute the sql column of bak_20261104_coe_filer_trigger (row tool_error_rate_filer_v3_ins) to recreate the original trigger; no data is touched.
-- BACKUP: bak_20261104_coe_filer_trigger

CREATE TABLE IF NOT EXISTS bak_20261104_coe_filer_trigger AS
SELECT name, tbl_name, sql FROM sqlite_master
WHERE type = 'trigger' AND name = 'tool_error_rate_filer_v3_ins';

CREATE INDEX IF NOT EXISTS idx_sha_dispatched_open ON self_heal_actions(ts) WHERE status = 'dispatched' AND verified_at IS NULL;

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
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
VALUES ('TOOL-ERROR-RATE-' || NEW.text || '-1',
'Auto-filed by tool_error_rate_filer_v3_ins (TOOL-FAILURE-CLASSIFY-4, 2026-09-29). v3 fixes the v2 defect: v2 computed its fail rate as 24h_errors / MAX(1, 24h_errors), which is identically 1.0, so the >=0.25 arm was vacuous and every tool with >=5 errors in 24h filed a ticket (that is how 1344/1387/1404 were filed). v3 computes unexcluded_errors / total_calls over a minimum 20-call sample, requires unexcluded_errors >= 10, and raises the raw-volume arm to >=60. Exclusions honoured on both sides. Triggering event: ' || NEW.id || '.',
'cloud_ops_events:' || NEW.id, 'observability', 'high', 'open',
CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;
