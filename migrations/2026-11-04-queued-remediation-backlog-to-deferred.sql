-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_queued_rem_backlog
-- Rollback: UPDATE research_queue SET status='queued' WHERE id IN (SELECT id FROM bak_20261104_queued_rem_backlog);
-- Remediation re-entries of idea papers (not erratum corrections) that waited >3 days unstarted are backlog:
-- hand them to deferred so synthesis merges them and backpressure admits the best few (belief-research-drains-in-3h).
CREATE TABLE IF NOT EXISTS bak_20261104_queued_rem_backlog AS
  SELECT id FROM research_queue WHERE status='queued' AND source='remediation' AND attempt<=2
   AND idea NOT LIKE 'Correct the published paper%'
   AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days');
UPDATE research_queue SET status='deferred'
 WHERE id IN (SELECT id FROM bak_20261104_queued_rem_backlog) AND status='queued';
