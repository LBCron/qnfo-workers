-- W2-B products rows (2026-11-05, charter pillar reach and autonomy; roadmap_implementation rows 1623 YT-6, 1677 JS-6, 1678 JS-7, 1680 JS-9, 1688 JS-11, 1690 EXUVIA-ENGAGE-1, 1714 YT-10, 1717 YT-13, 1800 PLUS-5).
-- Written after live reads made in this session, not before them:
--   JS-6   GET https://qnfo-jobsearch.q08.workers.dev/api/ops (checked_at 2026-11-05T03:27Z, 1.6.2-codeagent): rerank {status http-502, at 03:16:28Z, binding true}; jobsearch_meta rerank_status = http-502.
--          qnfo-ai logged that call (ai_queries 03:16:28.786Z) as model dynamic/value, "HANDLECHAT-CATCH-502: dynamic route returned no content or tool calls", 37.2 s. The re-rank code of PR 7423 is on main and
--          never answered once. PR 7658 (F2 session, qnfo-jobsearch 1.6.3, open) asks the Workers AI binding first; this file adds the closing contract rm-1677 and files the router half (below).
--   router qnfo-ai/worker.js defines reasoningEffortFor() (REASONING-BUDGET-1, measured 2026-10-12: glm-5.3-flash at default effort spends a 700 token budget reasoning and answers empty) and never calls it
--          (grep: one occurrence, the definition), and runDynamicChat takes reasoning_effort only from its opts, which the chat path does not set. A small one-shot to the gateway route therefore reasons at default effort.
--   JS-7 and JS-11  jobsearch_feeds (qnfo-audit) at 03:16:28Z: smartrecruiters:oecd 22 and recruitee:sweco 179, publicsector:werkenvoornederland 30 (was 2), academictransfer 137 (was 5), euraxess 35, all consecutive_fail 0;
--          agent_issues 1000643 (JOBSEARCH-NL-PUBLIC-SECTOR-1) is closed.
--   JS-9   GET /api/outcomes: mature_applied_90d 0, min_mature_for_rate 10, reading "unknown: 0 application(s) old enough to have had a reply, 10 needed": data-gated, stays built.
--   EXUVIA-ENGAGE-1  Workers Logs (qnfo-memory-mcp, needle exuvia-cron, last 6 h): draft {seen 13, drafts 0, unmatched 10, errors 0, best_score 0.67} each hour; decision_log has no row of actor qnfo-memory-mcp:exuvia-engage;
--          the 0.82 bar turned every post away. PR 7660 (qnfo-memory-mcp 2.11.1) logs the closest pairs so the bar is judged from them.
--   YT-6   youtube_videos.views and avg_view_duration_s are NULL on all 5 uploaded Shorts; 10 of 10 hourly youtube.retention_scope events since 2026-11-04T12:00Z; human_actions 233 (IDENTITY-BOUND) was handed back by the owner
--          at 02:47Z as agent_issues 1002003, whose birth probe observed its own status (superseded at birth): replaced here with one that measures the outcome.
--   YT-10 / YT-13  built parts as in their evidence; the remainders are open issues with doers (YT-SCENE-VARIETY-1 1001963, YT-C2PA-1 1001965); YT-11 is PR 7675 (container --disable_caching and stage timings).
--   PLUS-5  PR 7626 (phone layout) merged; https://fleet.qnfo.org/plus carries data-l labels (3 x "Used (7 days)") and the max-width 640px stacked-card CSS under dashboard 1.94.0; GET /api/plus 2026-11-05T03:53Z answers fleet-plus/v1
--          with the digest of 2026-11-04; product_registry.usage_read_at 2026-11-05T03:10:53Z for 8 of 9 products (the daily read runs).
-- Prediction: rm-1677 reads pending until a run after the PR 7658 deploy writes jobsearch_meta rerank_status ok or reordered, then ok and the row verifies; the router issue reads pending; no other contract changes verdict.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_w2b_rows
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_w2b_rows b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_w2b_rows b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_w2b_rows b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_w2b_rows); UPDATE remediation_contracts SET status = 'superseded' WHERE class IN ('rm-1623', 'rm-1677');
-- CAUSE-MAPPED: registers no metric_registry row; the contracts are roadmap-gate probes and the issue is filed for a doer.
-- spof-review: roadmap rows, two contracts, one contract probe replaced and one issue row; no code, binding, cron or credential.

CREATE TABLE IF NOT EXISTS bak_20261105_w2b_rows AS SELECT id, item, source, status, evidence, verified_at FROM roadmap_implementation WHERE id IN (1623, 1677, 1678, 1680, 1688, 1690, 1714, 1717, 1800);

-- JS-7 and JS-11: verified by live reads of the per-feed health.
UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | Verified live 2026-11-05 (W2-B): jobsearch_feeds read at 03:16:28Z and GET /api/ops at 03:27Z (102 feeds): smartrecruiters:oecd last_count 22 and recruitee:sweco last_count 179, both active with consecutive_fail 0; every active feed is at consecutive_fail 0 except lever:mistral (2, HTTP 404) and the three retired greenhouse feeds are active=false. Last run 211: 12,600 fetched, 568 passed, 69 stored.'
WHERE id = 1678 AND item = 'JS-7' AND instr(evidence, 'W2-B') = 0;

UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | Verified live 2026-11-05 (W2-B): jobsearch_feeds at 03:16:28Z: publicsector:werkenvoornederland last_count 30 (30 JSON-LD posting pages an hour out of 1,346 sitemap vacancies; was 2), publicsector:academictransfer 137 (was 5), publicsector:euraxess 35, all active with consecutive_fail 0; agent_issues 1000643 (JOBSEARCH-NL-PUBLIC-SECTOR-1) is closed.'
WHERE id = 1688 AND item = 'JS-11' AND instr(evidence, 'W2-B') = 0;

-- JS-6: built, not working live. Status built so the closing contract below verifies it when a run answers.
UPDATE roadmap_implementation SET status = 'built',
  evidence = evidence || ' | Live 2026-11-05 (W2-B): NOT working. /api/ops 03:27Z rerank {status http-502, at 03:16:28Z, binding true}; jobsearch_meta rerank_status http-502; qnfo-ai ai_queries 03:16:28.786Z model dynamic/value, response HANDLECHAT-CATCH-502 "dynamic route returned no content or tool calls", 37.2 s. Fix in flight: PR 7658 (qnfo-jobsearch 1.6.3: Workers AI binding first, router second; measured direct 11.4 s, valid JSON). Router half filed as AI-ROUTER-REASONING-EFFORT-1. Verified by contract rm-1677: jobsearch_meta rerank_status ok or reordered, written within 3 hours.'
WHERE id = 1677 AND item = 'JS-6' AND instr(evidence, 'W2-B') = 0;

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('rm-1677', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item JS-6 (id 1677) is built, deployed or implemented and waits for its closing probe',
  'JS-6 AI re-rank: the hourly run records jobsearch_meta rerank_status ok or reordered (the model answered and the guards accepted or reordered), written within the last 3 hours; PR 7658 asks the Workers AI binding first',
  'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT v FROM jobsearch_meta WHERE k = ''rerank_status''), '''') IN (''ok'', ''reordered'') AND COALESCE((SELECT v FROM jobsearch_meta WHERE k = ''rerank_at''), '''') >= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-3 hours'') THEN ''ok'' ELSE ''pending: jobsearch_meta rerank_status is '' || COALESCE((SELECT v FROM jobsearch_meta WHERE k = ''rerank_status''), ''unset'') || '' at '' || COALESCE((SELECT v FROM jobsearch_meta WHERE k = ''rerank_at''), ''never'') || '' (the AI re-rank must answer ok or reordered on a run of the last 3 hours)'' END AS observed',
  'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now'));

-- JS-9: data-gated, evidence only.
UPDATE roadmap_implementation SET evidence = evidence || ' | Live 2026-11-05 (W2-B): GET /api/outcomes funnel matches 180, approved 5, applied 1; mature_applied_90d 0 of min_mature_for_rate 10; reading "unknown: 0 application(s) old enough to have had a reply, 10 needed". The weights stay at their defaults by design until ten applications are old enough; not claimed verified.'
WHERE id = 1680 AND item = 'JS-9' AND instr(evidence, 'W2-B') = 0;

-- EXUVIA-ENGAGE-1: the draft step runs, nothing clears the bar.
UPDATE roadmap_implementation SET status = 'partial',
  evidence = evidence || ' | Live 2026-11-05 (W2-B): the draft tick runs every hour (Workers Logs, qnfo-memory-mcp, needle exuvia-cron, last 6 h): seen 13, drafts 0, unmatched 10, errors 0, best_score 0.67 against the 0.82 bar; decision_log has no row of actor qnfo-memory-mcp:exuvia-engage, so there is nothing to read and posting stays off (exuvia_engage_post absent). PR 7660 (qnfo-memory-mcp 2.11.1) names the closest post and paper pairs in the log line so the bar is judged from them, not guessed. Open: judge the bar from the pairs, switch posting on, the 7 day referral measurement, and the second half of the row (publishing flagship papers: exuvia_publish_paper stays dry-run until the loop decides a cap).'
WHERE id = 1690 AND item = 'EXUVIA-ENGAGE-1' AND instr(evidence, 'W2-B') = 0;

-- YT-6: built, waits for the IDENTITY-BOUND consent.
UPDATE roadmap_implementation SET status = 'built',
  evidence = evidence || ' | Live 2026-11-05 (W2-B): youtube_videos.views and avg_view_duration_s NULL on all 5 uploaded Shorts; every hourly read is refused (youtube.retention_scope, 10 events since 2026-11-04T12:00Z). IDENTITY-BOUND consent: human_actions 233 handed back by the owner at 02:47Z as agent_issues 1002003 (its probe now measures the outcome); the Google Cloud project and channel are the owner''s accounts. Verified by contract rm-1623 when metric youtube_avg_view_duration_s reads MEASURED. Not worked around: the public viewCount scrape breaks YouTube terms.'
WHERE id = 1623 AND item = 'YT-6' AND instr(evidence, 'W2-B') = 0;

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('rm-1623', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item YT-6 (id 1623) is built, deployed or implemented and waits for its closing probe',
  'YT-6 retention measurement: the metric youtube_avg_view_duration_s reads MEASURED once the owner consent (human_actions 233, issue 1002003) gives the grant its analytics scopes',
  'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT state FROM metric_registry WHERE metric = ''youtube_avg_view_duration_s''), '''') = ''MEASURED'' AND COALESCE((SELECT trim(last_value) FROM metric_registry WHERE metric = ''youtube_avg_view_duration_s''), '''') <> '''' THEN ''ok'' ELSE ''pending: IDENTITY-BOUND owner step, card yt-oauth-production-and-analytics (human_actions 233, handed back as issue 1002003): the YouTube grant carries the upload scope only, so the hourly retention read is refused (youtube.retention_scope, scope-missing)'' END AS observed',
  'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now'));

-- issue 1002003: replace the birth probe that observed its own status with one that measures the outcome (same shape as issue-1001913).
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM human_actions WHERE slug = ''yt-oauth-production-and-analytics'' AND status IN (''done'', ''resolved'') AND instr(COALESCE(resolution, ''''), ''handed back'') = 0) OR (COALESCE((SELECT state FROM metric_registry WHERE metric = ''youtube_avg_view_duration_s''), '''') = ''MEASURED'' AND COALESCE((SELECT trim(last_value) FROM metric_registry WHERE metric = ''youtube_avg_view_duration_s''), '''') <> '''') THEN ''ok'' ELSE ''pending: IDENTITY-BOUND owner step. Publishing the OAuth app In production (Google Auth Platform, Audience) and pressing Allow with the three scopes is a setting and a consent on the owner-held Google Cloud project gen-lang-client-0589613911. No REST or gcloud call exists for it and no fleet credential is a Google sign-in. Closes when the card is resolved by the owner (not as a handback) or the retention metric reads MEASURED'' END AS observed',
  verify_transport = 'd1-query', status = 'active', last_verdict = NULL, module = 'owner-step',
  action = 'W2-B 2026-11-05: replaces the birth probe that observed its own issue status; closes when the owner completes the consent on card yt-oauth-production-and-analytics (YT-5 and YT-6) or the retention metric is measured',
  next_due_at = datetime('now')
WHERE class = 'issue-1002003';

-- YT-10 and YT-13: partial, remainders have doers.
UPDATE roadmap_implementation SET status = 'partial',
  evidence = evidence || ' | W2-B 2026-11-05: partial. The centring (PR 7458) is on main; templates 11 to 15 are agent_issues 1001963 (YT-SCENE-VARIETY-1, open, doer: the code loop for container/short_scene.py).'
WHERE id = 1714 AND item = 'YT-10' AND instr(evidence, 'W2-B') = 0;

UPDATE roadmap_implementation SET status = 'partial',
  evidence = evidence || ' | W2-B 2026-11-05: partial. The visible label on every frame, the mp4 comment, description and copyright tags, the R2 sidecar (PR 7458) and containsSyntheticMedia are on main; the signed C2PA manifest is agent_issues 1001965 (YT-C2PA-1, open).'
WHERE id = 1717 AND item = 'YT-13' AND instr(evidence, 'W2-B') = 0;

-- PLUS-5: verified, page and phone layout read live.
UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | Verified live 2026-11-05 (W2-B): GET https://fleet.qnfo.org/api/plus at 03:53Z answers fleet-plus/v1 with the digest of 2026-11-04 (9 products, 2 in flight); product_registry.usage_read_at 2026-11-05T03:10:53Z for 8 of 9 products (the daily usage read runs); the phone layout (PR 7626, merged) is live: https://fleet.qnfo.org/plus carries 3 x data-l="Used (7 days)" and the max-width 640px stacked-card CSS under dashboard 1.94.0, rendered from the real worker code at 412, 360 and 1280 px with no sideways scroll. The weekly digest recurs on Mondays (fm-plus-digest-stale watches it).'
WHERE id = 1800 AND item = 'PLUS-5' AND instr(evidence, 'W2-B') = 0;

-- Router half of JS-6: the one-shot small answer to the gateway route reasons at default effort.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'AI-ROUTER-REASONING-EFFORT-1: reasoningEffortFor() is never called, so a small structured answer to the gateway route reasons at default effort and the router answers 502',
  'Charter pillar core and cost. Owner: the code loop (qnfo-ai). Roadmap JS-6 (id 1677), found while reading why the qnfo-jobsearch re-rank never answered.' || char(10) ||
  'Measured 2026-11-05: qnfo-jobsearch 1.6.2 POST /v1/chat/completions {model @cf/zai-org/glm-5.3-flash, max_tokens 2000, temperature 0, 25 postings} was routed to dynamic/value and ai_queries 03:16:28.786Z holds "HANDLECHAT-CATCH-502: dynamic route returned no content or tool calls: dynamic/value" after 37.2 s; the same prompt sent straight to Workers AI with reasoning_effort low answered in 11.4 s with valid JSON (PR 7658). REASONING-BUDGET-1 (qnfo-ai/worker.js, measured 2026-10-12) says glm-5.3-flash at default effort spends a 700 token budget reasoning and answers empty, and defines reasoningEffortFor(modelId, maxTokens, requested, hasTools) for that case. grep finds it once, its definition: nothing calls it, and runDynamicChat only forwards reasoning_effort that its opts carry, which the chat path (runDynamicChat(env, route, messages, maxTokens, false, { tools, temperature, top_p, tool_choice })) never sets.' || char(10) ||
  'Fix (qnfo-ai/worker.js, one change): at the chat path call reasoning_effort: reasoningEffortFor(modelId, maxTokens, body.reasoning_effort, hasTools) and pass it in the opts of runDynamicChat for a request that names a glm-5.3-flash, kimi-k2.6 or gpt-oss-120b model and asks for at most 2048 tokens without tools; leave every other request unchanged. Measure first on the gateway route (a 25 item JSON re-rank prompt, max_tokens 2000): if the gateway route rejects the field or the answer does not improve, route that request class to the direct Workers AI path instead and record the measurement here. Do not raise max_tokens as the fix.' || char(10) ||
  'Definition of done: the code is on main and deployed; over 6 hours ai_queries holds no "HANDLECHAT-CATCH-502: dynamic route returned no content" row (the closing probe), and the router health still reads ok.' || char(10) ||
  'code-task: repo=qnfo-workers path=qnfo-ai/worker.js' || char(10) ||
  'code-anchor: function reasoningEffortFor(modelId, maxTokens, requested, hasTools) {' || char(10) ||
  'code-probe: {"paths": ["qnfo-ai/worker.js"], "contains": "reasoning_effort: reasoningEffortFor("}',
  'w2b-products', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.title LIKE 'AI-ROUTER-REASONING-EFFORT-1:%' AND a.status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (W2-B products)',
  'a roadmap row is verified only on a live read; a step that needs the owner own Google or Exuvia accounts stays IDENTITY-BOUND with a measuring probe; a defect found in a shared router is filed for its doer with its measurement, not patched blind',
  'W2-B products rows: JS-7, JS-11 and PLUS-5 verified, JS-6 built with contract rm-1677, EXUVIA-ENGAGE-1 partial, YT-6 built with contract rm-1623 and issue 1002003 probe replaced, YT-10 and YT-13 partial, AI-ROUTER-REASONING-EFFORT-1 filed',
  'live reads: qnfo-jobsearch /api/ops and /api/outcomes, jobsearch_feeds, jobsearch_meta, ai_queries 03:16Z, Workers Logs exuvia-cron, fleet.qnfo.org/plus and /api/plus, youtube_videos, human_actions 233, PRs 7626 7658 7660 7675',
  'migration merged', 'roadmap_implementation rows 1623, 1677, 1678, 1680, 1688, 1690, 1714, 1717, 1800; two contracts; one probe replaced; one issue',
  'the Rollback header of migrations/2026-11-05-w2b-products-rows.sql',
  'the AI re-rank and the YouTube retention read are watched by contracts that close their rows when the live reading changes',
  'rm-1677 reads ok after the PR 7658 deploy and a run; rm-1623 and issue-1002003 read ok when the owner completes the consent', 'job search and Shorts reach (indirect)',
  'qnfo-jobsearch, fleet.qnfo.org, d1:qnfo-audit, qnfo-memory-mcp logs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'W2-B products rows:%');
