-- RETENTION-PRUNE-SPREAD-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1; follows RETENTION-SWEEP-1 step 1, migrations/2026-11-04-retention-shorten.sql, #6986).
-- Measured 2026-11-04 17:00-17:12Z (D1 GraphQL d1QueriesAdaptiveGroups, ordered by D1 time): the hourly fleet_tick (17:08:45Z, minute < 10) is the top statement of the window,
-- 83 s of D1 time over 17 calls, 6.02 M rows read and 83,856 rows WRITTEN; its non-hourly ticks write about 50 rows (the manual tick at 17:12Z: 176,170 rows read, 60 written, 1.35 s).
-- The 17:00-17:09 bucket held 17 "D1 DB is overloaded" events and 17:10-17:19 held 7, against 1-6 in the other 10-minute buckets of the hour.
-- Cause: RETENTION-SWEEP-1 shortened remediation_verifications retention 14 -> 8 days and cloud_ops_events housekeeping kinds 14 -> 5 days, which made 156,954 rows
-- (verified_at before 2026-10-27, oldest 2026-10-22) eligible at once; retention_prune_tick_v2 deletes up to 5,000 of them, plus up to 5,000 + 5,000 + 3,000 other rows,
-- in ONE statement per hour, and remediation_verifications carries 13 indexes, so each deleted row is 14 writes (5,000 rows about 70 K writes). D1 serves one statement at a time: about
-- a minute during which every other query waits and fails with the overload error, on top of the other hourly work that is also gated to minutes 0-9 (eight crons at minute 0).
-- Change: the same four deletes, the same retention windows and kinds, but every tick instead of the minute < 10 tick, with LIMIT 400 instead of 5,000 / 5,000 / 5,000 / 3,000: 2,400 rows an
-- hour per statement, 6 ticks, so about 5-6 K writes (a few seconds) per tick instead of about 80 K once an hour. The backlog of 156,954 rows drains in about 3.7 days instead of 31 hours
-- (the steady inflow is about 15 K a day = 625 an hour, well under 2,400). Nothing is deleted that was not already due; ops_config retention_prune = off still stops all pruning.
-- retention_prune_2_tick (fleet_tick_heavy) is left alone: its five deletes wrote about 2 K rows a day.
-- Prediction: the hourly tick drops from about 80 s to about 3 s of D1 time and from 6 M rows read / 84 K rows written to under 1 M / under 6 K; the 17:00 overload bucket falls from 17 toward
-- the 1-6 of the other buckets; rows older than 8 days in remediation_verifications fall by about 2,400 an hour; no table grows.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_retention_prune_trigger
-- Rollback: DROP TRIGGER IF EXISTS retention_prune_tick_v2; then re-create it from bak_20261104_retention_prune_trigger (column sql holds the exact previous CREATE statement)
-- spof-review: one trigger rewritten with the same statements and windows; ops_config retention_prune = off is the kill switch.
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_retention_prune_trigger AS
SELECT name, type, sql FROM sqlite_master WHERE type = 'trigger' AND name = 'retention_prune_tick_v2';

DROP TRIGGER IF EXISTS retention_prune_tick_v2;
CREATE TRIGGER retention_prune_tick_v2 AFTER INSERT ON fleet_tick
WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off'
BEGIN
  DELETE FROM cloud_ops_events WHERE id IN (SELECT id FROM cloud_ops_events INDEXED BY idx_coe_ts
    WHERE ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days')
      AND kind IN ('ops_ai_tool','heartbeat','idle','done','claim','code-task.claim-held','code-task.intake','code-task.intake-exhausted','code-task.intake-waiting','revise-patch','revise-noop','review-triage','slop-scan','deploy-drift-cf','ai-warn','metric-write-audit','rerun-route','pdf-backlog','remediation.deferred','math-scan','advisor-audit','container.sh','container.exec','container.workspace_exec','container.git_clone')
    LIMIT 400);
  DELETE FROM cloud_ops_events WHERE id IN (SELECT id FROM cloud_ops_events INDEXED BY idx_coe_ts
    WHERE ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days')
    LIMIT 400);
  DELETE FROM remediation_verifications WHERE id IN (SELECT id FROM remediation_verifications INDEXED BY idx_remediation_verifications_ts
    WHERE verified_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')
    LIMIT 400);
  DELETE FROM fleet_probe_log WHERE id IN (SELECT p.id FROM fleet_probe_log p INDEXED BY idx_fpl_ts
    WHERE p.ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')
      AND EXISTS (SELECT 1 FROM fleet_probe_log q INDEXED BY idx_fpl_name_transport_ts WHERE q.name = p.name AND q.transport = p.transport AND q.ts > p.ts)
    LIMIT 400);
END;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'a backlog created by shorter retention should be drained at the rate the database can absorb, not in one statement at the top of the hour',
  'RETENTION-PRUNE-SPREAD-1: retention_prune_tick_v2 runs on every tick with LIMIT 400 per delete (was minute < 10 only, LIMIT 5000 / 5000 / 5000 / 3000); same retention windows',
  'GraphQL 17:00-17:12Z: INSERT INTO fleet_tick 83 s of D1 time, 6.02 M rows read, 83,856 rows written over 17 calls; a non-hourly tick 176,170 read / 60 written / 1.35 s; remediation_verifications 156,954 rows older than 8 days and 13 indexes; cloud_ops_events overload events 17 in 17:00-17:09 against 1-6 in other buckets',
  'same rows pruned, in about 6 K-write steps', 'one trigger on fleet_tick (old text in bak_20261104_retention_prune_trigger)',
  'the Rollback line, or ops_config retention_prune = off', 'the sweep no longer stalls the database for a minute an hour',
  'hourly fleet_tick under 6 K rows written and about 3 s; overload events at the top of the hour near the other buckets; rows older than 8 days in remediation_verifications decreasing by about 2,400 an hour', NULL, 'SQLite test in migrations/retention-prune-spread.test.mjs, live GraphQL by D1 time'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'RETENTION-PRUNE-SPREAD-1:%');
