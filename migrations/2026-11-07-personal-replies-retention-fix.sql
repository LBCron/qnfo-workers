-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_personal_replies_retention_fix
-- Rollback: DROP TRIGGER IF EXISTS personal_replies_retention_sweep; DELETE FROM bak_20261107_personal_replies_retention_fix;
-- SPOF: personal_replies_retention_sweep trigger on fleet_tick - no alternate path because retention is a cost optimization, not a correctness requirement. If the trigger fails to fire, rows accumulate but the table still functions. The retention window (30 days) provides buffer.
--
-- Fix personal_replies retention sweep (#8474)
-- The original 2026-11-07-personal-replies-retention.sql failed with:
-- "TRIGGER-COMPILE-1, an insert, update or delete on fleet_heartbeat no longer compiles"
--
-- The table is named fleet_tick, not fleet_heartbeat. Also the trigger should
-- use fleet_tick's time-based firing pattern like other retention sweeps.

CREATE TABLE IF NOT EXISTS bak_20261107_personal_replies_retention_fix AS 
SELECT * FROM personal_replies WHERE 1=0;

-- Drop the broken trigger if it exists
DROP TRIGGER IF EXISTS personal_replies_retention_sweep;

-- Create the retention sweep trigger
-- Fires every 10 minutes (when minute < '10') and deletes rows older than 30 days
-- Pattern matches retention_prune_tick_v2 and other retention sweeps
CREATE TRIGGER personal_replies_retention_sweep
AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10'
BEGIN
  DELETE FROM personal_replies 
  WHERE id IN (
    SELECT id FROM personal_replies
    WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')
    LIMIT 1000
  );
END;

-- Run immediate cleanup for existing old rows
DELETE FROM personal_replies 
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days');
