-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_queued_backlog
-- Rollback: UPDATE research_queue SET status='queued' WHERE id IN (SELECT id FROM bak_20261104_queued_backlog);
-- Unstarted proposal rows queued >3 days are backlog, not work in flight: hand them to deferred so
-- synthesis (ideaSynthesisTick) merges them and backpressure admits the best few (belief-research-drains-in-3h).
CREATE TABLE IF NOT EXISTS bak_20261104_queued_backlog AS
  SELECT id FROM research_queue WHERE status='queued' AND source='proposal' AND attempt=0
   AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days');
UPDATE research_queue SET status='deferred'
 WHERE id IN (SELECT id FROM bak_20261104_queued_backlog) AND status='queued';
