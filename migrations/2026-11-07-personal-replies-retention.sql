-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261107_personal_replies_before_retention
-- Rollback: DROP TRIGGER IF EXISTS personal_replies_retention_sweep; INSERT INTO personal_replies SELECT * FROM bak_20261107_personal_replies_before_retention WHERE reply_id NOT IN (SELECT reply_id FROM personal_replies);
-- SPOF: personal_replies_retention_sweep trigger has no alternate path - it's the single automatic cleanup for unbounded growth. A failed trigger means rows accumulate forever, detected by table-size monitoring. Manual cleanup is the alternate (DELETE FROM personal_replies WHERE replied_at < datetime('now', '-30 days')).
--
-- KERNEL-EVERYWHERE-1 follow-up: bound personal_replies growth (#8474)
--
-- personal_replies mirrors every personal-api twin reply for false-stop scanning.
-- It was unbounded (one row per reply, kept forever). This adds a 30-day retention
-- sweep so the table stays bounded while preserving the 7-day false_stops_7d window.

-- Backup existing rows before adding retention sweep
CREATE TABLE IF NOT EXISTS bak_20261107_personal_replies_before_retention AS 
SELECT * FROM personal_replies;

-- Scheduled cleanup: delete personal_replies rows older than 30 days.
-- Runs every 10 minutes off the fleet heartbeat.
CREATE TRIGGER IF NOT EXISTS personal_replies_retention_sweep
AFTER INSERT ON fleet_heartbeat
FOR EACH ROW
WHEN NEW.tick_min_10 = 1
BEGIN
  DELETE FROM personal_replies
  WHERE replied_at < datetime('now', '-30 days');
END;

-- Immediate cleanup: remove existing rows beyond the 30-day window
DELETE FROM personal_replies
WHERE replied_at < datetime('now', '-30 days');
