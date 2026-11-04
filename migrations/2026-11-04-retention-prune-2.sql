-- RETENTION-PRUNE-2 (2026-11-04, charter pillar cost; owner request "old data we don't need anymore needs to be automatically cleaned ... costs down 90%").
-- APPLY-BY: ci
-- DB: qnfo-audit
-- spof-review: non-critical housekeeping; if it stops, only scan cost and storage growth return. Second path: ops_config retention_prune=off pauses it; the bounded DELETEs can be run by hand.
-- Rollback: DROP TRIGGER IF EXISTS retention_prune_2_tick;
-- Measured 2026-11-04 (qnfo-audit, 1.49 GB file; row counts and summed column bytes read from D1):
--   codeparse_events 68,456 rows / 33.6 MB, 56,792 of them older than 3 days, no view or trigger reads it (telemetry);
--   cron_fire_log 78,820 / 15.4 MB, 16,150 older than 14 days (readers v_cron_activity, v_cron_faults_worker window shorter);
--   fleet_runs 68,774 / 31.0 MB, 16,329 finished runs older than 14 days (running rows are never pruned);
--   worker_logs 46,904 / 11.0 MB, 22,228 older than 7 days (v_breach_selfheal_spend reads <= 48 h);
--   ops_req_log 25,356 / 2.3 MB, 13,441 older than 7 days, no reader.
-- Mechanism: a bounded, PK-range DELETE per table (oldest 4000 ids, then only the rows past the age), run on every sixth fleet_tick_heavy
-- insert (about hourly), never on fleet_tick (FLEET-TICK-SPLIT-1: that statement is near its memory limit). The PK-range form reads at most 4000 rows
-- per table, never a full scan. Evidence tables (remediation_verifications, agent_issues, issue_lifecycle, chatbox_conversations, papers) are not touched;
-- they get archive-to-R2 before any prune in a later change. Owner data is not touched.

CREATE TRIGGER IF NOT EXISTS retention_prune_2_tick AFTER INSERT ON fleet_tick_heavy
WHEN NEW.id % 6 = 0 AND COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off'
BEGIN
  DELETE FROM codeparse_events WHERE id IN (SELECT id FROM codeparse_events WHERE id <= (SELECT MIN(id) + 4000 FROM codeparse_events)
    AND ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days'));
  DELETE FROM cron_fire_log WHERE id IN (SELECT id FROM cron_fire_log WHERE id <= (SELECT MIN(id) + 4000 FROM cron_fire_log)
    AND fired_at < datetime('now', '-14 days'));
  DELETE FROM fleet_runs WHERE id IN (SELECT id FROM fleet_runs WHERE id <= (SELECT MIN(id) + 4000 FROM fleet_runs)
    AND started_at < datetime('now', '-14 days') AND status <> 'running');
  DELETE FROM worker_logs WHERE id IN (SELECT id FROM worker_logs INDEXED BY idx_worker_logs_ts
    WHERE ts_ms < (CAST(strftime('%s', 'now') AS INTEGER) - 7 * 86400) * 1000 LIMIT 4000);
  DELETE FROM ops_req_log WHERE rowid IN (SELECT rowid FROM ops_req_log WHERE rowid <= (SELECT MIN(rowid) + 4000 FROM ops_req_log)
    AND ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days'));
END;
