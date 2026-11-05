-- F2 close-out (2026-11-05, charter pillars reach and personal): live evidence on four roadmap rows, and the three remainders that were only prose get a row, a doer and a probe.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f2_final
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.evidence FROM bak_20261105_f2_final b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_f2_final)
-- CAUSE-MAPPED: registers no metric_registry row.
-- Read live 2026-11-05: jobsearch /api/ops 05:16Z rerank ok via ai, 13 of 69 stored matches carry an LLM rank line and 1 of those a model reason (cause fixed by PR 7789: the model cites the posting score and reasonOk dropped the reasons), 0 drafts carry an LLM line;
-- qnfo-memory-mcp cron log 05:35Z seen 13 drafts 0 unmatched 10 best_score 0.67 against the 0.82 threshold; R2 youtube/7 and youtube/8 hold provenance.json; qnfo-social logs SOCIAL-CADENCE-CAP-1 shorts: bluesky posts_7d=21 cap=21 holding queued rows.
CREATE TABLE IF NOT EXISTS bak_20261105_f2_final AS
SELECT id, status, evidence FROM roadmap_implementation WHERE id IN (1677, 1690, 1717, 3109);

UPDATE roadmap_implementation SET evidence = 'PRs 7423 (1.6.0), 7547 (1.6.1), 7658 (1.6.3: the Workers AI binding first, the router answered HTTP 502 after 38 s), 7730 (third-person signals), 7789 (a reason may repeat the posting''s own score). Live 2026-11-05 05:16Z: /api/ops rerank status ok via ai, 13 of 69 stored matches carry an LLM rank line and 1 of those a model reason before 7789, 0 drafts carry an LLM line. Verified when agent_issues JS-6-VERIFY-1 passes (a stored match carries a model reason and no draft carries an LLM line); then this row is set verified.'
WHERE id = 1677 AND status = 'planned' AND instr(evidence, 'JS-6-VERIFY-1') = 0;
UPDATE roadmap_implementation SET evidence = evidence || ' Live 2026-11-05 05:35Z cron log: seen 13, drafts 0, unmatched 10, best_score 0.67 against the 0.82 threshold, the nearest papers unrelated to the posts (platform and validation topics): the needs-response feed holds nothing the QNFO papers answer, so 3 replies in 7 days (agent_issues 1000644) are unlikely. The flagship-publish half (at most one paper a day through exuvia_publish_paper) is not built: agent_issues EXUVIA-PUBLISH-1.'
WHERE id = 1690 AND status = 'planned' AND instr(evidence, 'EXUVIA-PUBLISH-1') = 0;
UPDATE roadmap_implementation SET evidence = evidence || ' Verified live 2026-11-05: R2 youtube/7/provenance.json and youtube/8/provenance.json exist (254 and 272 bytes, hash checked) for the Shorts rendered on 0.7.0; youtube/6 (rendered before the deploy) has none; no youtube.provenance warn event.'
WHERE id = 1717 AND status = 'planned' AND instr(evidence, 'youtube/7/provenance.json') = 0;
UPDATE roadmap_implementation SET evidence = evidence || ' Live 2026-11-05: no social_video_posts row yet. The Shorts drain logs SOCIAL-CADENCE-CAP-1 shorts: bluesky posts_7d=21 cap=21, holding queued rows (text posts used the 21 weekly Bluesky slots), and one D1-overload line that fails closed as paused. Remainder inside the cap: agent_issues SHORTS-SLOT-PRIORITY-1.'
WHERE id = 3109 AND status = 'planned' AND instr(evidence, 'SHORTS-SLOT-PRIORITY-1') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'JS-6-VERIFY-1: the AI re-rank must store a model reason on a match and never reach a draft (verify roadmap JS-6)',
 'Charter pillar: personal. qnfo-jobsearch re-ranks the top 25 matches (JOBSEARCH-LLM-RERANK-1, PRs 7423, 7547, 7658, 7730, 7789). Read 2026-11-05 05:16Z: rerank ok via ai, 13 of 69 stored matches have an LLM rank line, 1 of those a model reason, 0 drafts have an LLM line; PR 7789 fixes the reason guard. Doer: the fleet closes the loop: when the contract passes, set roadmap_implementation id 1677 (item JS-6) to verified with this read as evidence. Definition of done: after a run on 1.6.7 or later, at least one stored match has an LLM reason line that is not a rank line, and no resume or note contains an LLM line. If reasons stay at 0 after two runs, read the model answer against reasonOk before touching the guard (a guard is never loosened to raise a count).',
 'session:F2', 'reach', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'JS-6-VERIFY-1:%' AND status = 'open');

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'issue-' || a.id, a.id, 'F2 2026-11-05', 'closes JS-6-VERIFY-1 when a stored match carries a model reason and no draft carries an LLM line',
  'SELECT ''ok'' AS expected, CASE WHEN r.reasons > 0 AND r.drafts = 0 THEN ''ok'' ELSE ''pending: '' || r.reasons || '' stored matches with a model reason, '' || r.drafts || '' drafts with an LLM line'' END AS observed FROM (SELECT COALESCE(SUM(CASE WHEN (length(why_json) - length(replace(why_json, ''"LLM: '', ''''))) / 6 > (length(why_json) - length(replace(why_json, ''"LLM: rank'', ''''))) / 10 THEN 1 ELSE 0 END), 0) AS reasons, COALESCE(SUM(resume_md LIKE ''%LLM: %'' OR note_md LIKE ''%LLM: %''), 0) AS drafts FROM jobsearch_matches WHERE run_id = (SELECT MAX(id) FROM jobsearch_runs WHERE finished_at IS NOT NULL)) r',
  'd1-query', 3, 'qnfo-cloud-ops', 1, 'active', 'owner-step', datetime('now')
FROM agent_issues a WHERE a.title LIKE 'JS-6-VERIFY-1:%' AND a.status = 'open' ORDER BY a.id DESC LIMIT 1;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'EXUVIA-PUBLISH-1: publish at most one flagship QNFO paper a day on Exuvia, default off (second half of EXUVIA-ENGAGE-1)',
 'Charter pillar: reach. agent_issues 1000644 asks for replies and for flagship papers on Exuvia. The reply half shipped in qnfo-memory-mcp 2.8.0 (drafts on, posting off) but the live cron log (2026-11-05 05:35Z) shows nothing to answer: seen 13, drafts 0, best_score 0.67 against 0.82. The publish half is not built. Lever: in the hourly exuviaCron, a step that, only when ops_config exuvia_publish_flagship is on (the row ships absent = off, a post is public and cannot be deleted by an agent), picks the newest published flagship paper with no EXUVIA-ENGAGE-1 publish row in decision_log, builds the post with exPaperDraft (abstract, excerpt, knowledge-graph neighbours, DOI line only if a DOI exists: 0 of 723 published papers has one), posts it through POST /api/v1/posts with the Exuvia rules (2 per burst, 150 s cooldown, 429 retry_after_seconds), and logs one decision_log row with its predicted outcome. At most one a day. Doer: the code loop. Definition of done: the version line names EXUVIA-PUBLISH-1, the offline suite shows off by default, one a day, no repeat, 429 stops the run.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-memory-mcp/worker.js' || char(10) ||
 'code-anchor: async function exuviaReplyTick(env, nowMs) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-memory-mcp/worker.js"], "contains": "EXUVIA-PUBLISH-1"}',
 'session:F2', 'reach', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'EXUVIA-PUBLISH-1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SHORTS-SLOT-PRIORITY-1: native Short videos starve behind text posts for the 21 weekly Bluesky slots (YT-16)',
 'Charter pillar: reach. qnfo-social 0.22.0 posts new Shorts natively to Bluesky and Mastodon inside the platform weekly caps (SHORT-POSTS-1). Read 2026-11-05 from Workers Observability: SOCIAL-CADENCE-CAP-1 shorts: bluesky posts_7d=21 cap=21, holding queued rows; social_video_posts is empty although 3 Shorts were uploaded after the flag date. The cap is a policy limit and does not change; the lever is the order inside it: when a Short is queued, drainShorts may take the next free slot ahead of the text drain, or the text drain leaves one slot of the 21 for a Short (REACH-FOCUS-1 measures which channel earns engaged readers). Doer: the code loop. Definition of done: the version line names SHORTS-SLOT-PRIORITY-1, the offline suite shows a queued Short is posted while the text queue is also full and the weekly total never exceeds the cap, and social_video_posts has a posted row for bluesky.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-social/worker.js' || char(10) ||
 'code-anchor: async function drainShorts(env, opts) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-social/worker.js"], "contains": "SHORTS-SLOT-PRIORITY-1"}',
 'session:F2', 'reach', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SHORTS-SLOT-PRIORITY-1:%' AND status = 'open');
