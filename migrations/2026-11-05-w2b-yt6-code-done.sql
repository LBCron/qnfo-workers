-- W2-B YT-6 code-done (2026-11-05, charter pillar cost and reach; agent_issues 1000597 "YT-6: read views and average view duration of each Short back into youtube_videos", roadmap row 1623).
-- WHAT WAS READ: the issue carries "code-task: repo=qnfo-workers path=qnfo-youtube-shorts/worker.js" and has had 5 CODE-TASK-MERGE-RUNNER-1 refusals ("qnfo-youtube-shorts declares [[containers]]; the canonical deploy cannot carry it"); a sixth
--   attempt (ct_8wc5dr3f4yaas1, retry 6) holds the file claim file:qnfo-youtube-shorts/worker.js at 2026-11-05T04:19Z. The change it is asked to make is already on main: qnfo-youtube-shorts 0.3.0 readRetention (worker.js: YouTube Analytics
--   reports views and averageViewDuration by video, hourly), the metric youtube_avg_view_duration_s and its trigger. The code-probe line of the issue (contains averageViewDuration) passes today. What is missing is the owner consent that gives the grant its
--   analytics scopes (IDENTITY-BOUND, human_actions 233 handed back as agent_issues 1002003): 10 of 10 hourly reads since 2026-11-04T12:00Z are refused with youtube.retention_scope scope-missing and youtube_videos.views is NULL on all 5 Shorts.
-- So every further code task for this issue rebuilds existing code, is refused by the merge runner for a worker the canonical path cannot deploy, and blocks the worker.js claim that real work on this worker needs (YT-VOICE-RETRY-1, agent_issues 1001978,
--   is a genuine worker.js change and waits behind it). This file renames the issue's code-task line to code-done so the code loop stops filing it, and says where the remaining step lives. The issue stays open, its contract issue-1000597
--   (metric youtube_avg_view_duration_s MEASURED) still closes it, and roadmap contract rm-1623 watches the same metric.
-- Prediction: no new code task is created for issue 1000597 after the in-flight one ends; the worker.js file claim frees for 1001978; the issue's contract is unchanged (pending until the consent).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_w2b_yt6_issue
-- Rollback: UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_w2b_yt6_issue b WHERE b.id = agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_w2b_yt6_issue);
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: one issue description; no code, binding, cron or credential.

CREATE TABLE IF NOT EXISTS bak_20261105_w2b_yt6_issue AS SELECT id, title, status, description FROM agent_issues WHERE id = 1000597;

UPDATE agent_issues
SET description = replace(description, 'code-task: repo=qnfo-workers path=qnfo-youtube-shorts/worker.js', 'code-done (W2-B 2026-11-05): the read is on main (qnfo-youtube-shorts 0.3.0 readRetention, metric youtube_avg_view_duration_s); no further code task: the remaining step is the IDENTITY-BOUND owner consent, agent_issues 1002003 and human_actions 233 (the previous line is kept in bak_20261105_w2b_yt6_issue)'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000597 AND instr(description, 'code-task: repo=qnfo-workers path=qnfo-youtube-shorts/worker.js') > 0 AND instr(description, 'code-done (W2-B') = 0;
