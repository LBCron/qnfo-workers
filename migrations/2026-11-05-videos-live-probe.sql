-- COMPANION-NO-TYPING-1:videos (2026-11-05, charter pillar personal; agent_issues 1001637). The three parts of the definition of done are live:
--   q08-mind 2.3.0 (PR 7394): data/videos.json with seven ted.com talks, each URL fetched on 2026-11-05 (HTTP 200), and /now?kind=video (GET https://mind.q08.org/now?kind=video
--   answered 200 with a ted.com talk link; /health lists video-pick);
--   personal-api 4.36.1 (PR 7412): the Today card "What can I do right now?" carries Watch something (GET https://me.q08.org/companion answered 200 and contains Watch something
--   and kind=video; GET https://personal.qnfo.org/health shows 4.36.1).
-- The contract was born superseded on a probe that observes the issue's own status, which can never pass. It becomes a runner probe on the page the owner opens: it passes only
-- while the companion page carries the video link, and the autoclose trigger closes the issue on that pass (a later regression reopens it).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261105_videos_live_probe b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_videos_live_probe b WHERE b.class = remediation_contracts.class), verify_probe = (SELECT b.verify_probe FROM bak_20261105_videos_live_probe b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_videos_live_probe b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_videos_live_probe b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_videos_live_probe b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1001637' AND EXISTS (SELECT 1 FROM bak_20261105_videos_live_probe b WHERE b.class = 'issue-1001637')

CREATE TABLE IF NOT EXISTS bak_20261105_videos_live_probe AS
SELECT class, issue_id, action, verify_probe, verify_transport, module, status, last_verdict FROM remediation_contracts WHERE class = 'issue-1001637';

UPDATE remediation_contracts
SET verify_transport = 'runner-https', module = 'probe-line-sweep-v1', status = 'active',
    verify_probe = '{"url": "https://me.q08.org/companion", "status": 200, "contains": "kind=video"}',
    action = 'COMPANION-NO-TYPING-1:videos: the companion page carries the Watch something link to mind.q08.org/now?kind=video (personal-api 4.36.1, q08-mind 2.3.0, data/videos.json with seven live-checked talks). Replaces the born-superseded probe that observed this issue''s own status.',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1001637' AND issue_id = 1001637
  AND verify_probe LIKE '%agent_issues WHERE id = 1001637%';
