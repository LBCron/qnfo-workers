-- ROADMAP-TWIN-FOLD-1 (2026-11-05, pillar autonomy; metrics open_agent_issues, largest_issue_family_net_inflow_24h). Four ROADMAP-1 items filed by the QNFO.REACH program manager (management-personas, 2026-11-04 20:36Z)
-- repeat items a session had filed nine hours earlier (session:reader-yield, 11:00Z) word for word; both copies sit in the code loop's queue as ct_im<id> tasks on the same two files
-- (qnfo-fleet-dashboard/worker.js, qnfo-social/worker.js), where a second change to a file the twin is already editing can only conflict. Read 2026-11-05 04Z:
--   1001797 #2131 classify automated fetchers as bots    = 1001719 READER-YIELD-1.1 (open, task merged)
--   1001798 #2132 pageviews_30d flaps between 0 and 25000 = 1001720 READER-YIELD-1.2 (open, task queued)
--   1001800 #2134 GA4 ingest by campaign and country      = 1001722 READER-YIELD-1.4 (open, task queued)
--   1001799 #2133 give the papers an outsider reached a second post = 1001721 READER-YIELD-1.3 (CLOSED, task merged, closed by auto:verified-remediation-trigger)
-- The first three are superseded by the open twin, the fourth is moot (its twin shipped and closed). A close needs both sides to still match: the same wording for the first 50 characters after the item code, and the
-- twin in the state read above. The closes drop the twins' parked code tasks (PARKED-TASK-ISSUE-CLOSED-1) so the queue sheds 2 to 3 rows. Closures marked "superseded"/"moot" are not fixes (IL-NONFIX-CLOSURE-1).
-- Prediction: open_agent_issues -4; the dashboard file queue shrinks by the twins' tasks; no duplicate pull request for the same change.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'open', close_channel = (SELECT b.issue_close_channel FROM bak_20261105_roadmap_twins b WHERE b.issue_id = agent_issues.id), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id IN (SELECT issue_id FROM bak_20261105_roadmap_twins) AND status = 'closed'; UPDATE issue_triage SET triage_state = (SELECT b.triage_state FROM bak_20261105_roadmap_twins b WHERE b.issue_id = issue_triage.issue_id), close_evidence = (SELECT b.triage_close_evidence FROM bak_20261105_roadmap_twins b WHERE b.issue_id = issue_triage.issue_id) WHERE issue_id IN (SELECT issue_id FROM bak_20261105_roadmap_twins);
-- Closing probe: SELECT COUNT(*) FROM agent_issues WHERE id IN (1001797, 1001798, 1001799, 1001800) AND status = 'open'; -- 0

CREATE TABLE IF NOT EXISTS bak_20261105_roadmap_twins AS
SELECT a.id AS issue_id, a.status AS issue_status, a.close_channel AS issue_close_channel, t.triage_state AS triage_state, t.close_evidence AS triage_close_evidence
FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id
WHERE a.id IN (1001797, 1001798, 1001799, 1001800);

UPDATE agent_issues SET close_channel = 'session:breach-remediation'
WHERE status = 'open' AND title LIKE 'ROADMAP-1:%' AND id IN (1001797, 1001798, 1001799, 1001800)
  AND EXISTS (
    SELECT 1 FROM agent_issues s
    WHERE s.id = CASE agent_issues.id WHEN 1001797 THEN 1001719 WHEN 1001798 THEN 1001720 WHEN 1001799 THEN 1001721 WHEN 1001800 THEN 1001722 END
      AND lower(substr(substr(s.title, 12), instr(substr(s.title, 12), ': ') + 2, 50)) = lower(substr(substr(agent_issues.title, 12), instr(substr(agent_issues.title, 12), ': ') + 2, 50))
      AND ((agent_issues.id <> 1001799 AND s.status = 'open') OR (agent_issues.id = 1001799 AND s.status = 'closed')));

UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'),
  close_evidence = CASE issue_id
    WHEN 1001799 THEN 'MOOT: the same roadmap item is issue 1001721 (READER-YIELD-1.3, identical wording), closed by auto:verified-remediation-trigger with its code task ct_im1001721 merged; this twin filed by management-personas nine hours later has nothing left to build. Read 2026-11-05.'
    ELSE 'SUPERSEDED BY #' || CASE issue_id WHEN 1001797 THEN 1001719 WHEN 1001798 THEN 1001720 ELSE 1001722 END || ': the same roadmap item with identical wording was filed nine hours earlier by session:reader-yield and is open with its own code task; this twin only queues a second change to the same files. Read 2026-11-05.' END
WHERE issue_id IN (1001797, 1001798, 1001799, 1001800)
  AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = issue_triage.issue_id AND a.status = 'open' AND a.close_channel = 'session:breach-remediation');

UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded (ROADMAP-TWIN-FOLD-1)', last_attempt_at = datetime('now'), next_due_at = NULL
WHERE issue_id IN (1001797, 1001798, 1001799, 1001800) AND status IN ('monitoring', 'escalated', 'active', 'holding', 'needs-machine-probe', 'probe-review-refused')
  AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = remediation_contracts.issue_id AND a.status = 'closed' AND a.close_channel = 'session:breach-remediation');
