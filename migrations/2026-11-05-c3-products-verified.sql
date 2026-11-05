-- C3-PRODUCTS verified state (2026-11-05, charter pillar autonomy and reach; roadmap_implementation rows 1800 PLUS-5, 1797 PLUS-2, 3109 YT-16; agent_issues 1001913).
-- Written after the live reads, not before them:
--   PLUS-5  PR 7450 merged; GET https://fleet.qnfo.org/health reports qnfo-fleet-dashboard 1.93.0; GET /api/plus answers fleet-plus/v1 with 9 products (usage set for 8, shorts-channel null),
--           the digest of 2026-11-04 and unavailable []; GET /plus answers 200 with the title, the digest, the word unmeasured and its navigation tab; /api lists /api/plus. The task
--           management-personas-plus ran ok at 00:50:52Z (run 70400, 26 steps, 6.2 s) after PLUS-LEDGER-STATUS-1, so pl-usage and pl-digest execute. The phone journey follows in PR 7520.
--   PLUS-2  the consumer (PR 7456, migration_runs ok 00:58:44Z) changes the pick from the next batch; the daily cap of 3 plus requests was already used at 00:50:54Z (research-gateway, fleet-dashboard,
--           travel, prompts reading "Usage signal: worker_requests_7d." with no number), so the first request under the new rule is written after 2026-11-06T00:50Z. Contract rm-plus-2-pick-verify
--           reads pending until a plus prompt carries the number, then ok. Not claimed verified before that.
--   YT-16   qnfo-social 0.22.0 is live (GET /health lists short-video-posts) and its hourly :30 step runs ("qnfo-social shorts ok" at 00:31Z and 01:30Z) but posted 0: Bluesky held:weekly-cap
--           (21 of 21 in 7 days), Mastodon held:weekly-cap (10 of 7). A Short uploaded after 2026-11-05T00:00Z exists (row 6, 01:04Z), so the first native post waits for a slot to roll out of
--           the 7-day window; the Shorts step runs before the text drain at :30 so it takes the first slot. Status deployed, not built: social_video_posts is empty. Contract rm-yt-16-first-post
--           reads pending until a posted row exists. The caps are the fleet's own decision (RULE-8-RETIRED-1) and are not changed here; a reserved video slot is filed as the next slice below.
--   1001913 the owner tapped "Fleet: you do it" on card yt-oauth-publish 17 minutes after it was filed (human_actions 226, resolution "handed back ... issue 1001913"). The step cannot be done by the
--           fleet: publishing the OAuth app In production is a setting on an owner-held Google Cloud project; a web search on 2026-11-05 found only the Console flow (Google Auth Platform, Audience,
--           Publish app), no REST or gcloud call; the repository and Cloudflare tokens carry no Google credential; the Console needs the owner Google sign-in with a one-time code. The issue keeps
--           its IDENTITY-BOUND text, and its superseded birth probe is replaced by one that measures the outcome (card resolved without a handback, or uploads spanning 21 days on one token), the same
--           shape as issue-1001749 and issue-1001750.
-- Prediction: rows 1797 and 1800 read built, row 3109 deployed; the three contracts exist and read pending, not failing; issue-1001913 reads pending with the IDENTITY-BOUND text.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_c3_rows2
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_c3_rows2 b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_c3_rows2 b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_c3_rows2 b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_c3_rows2); DELETE FROM remediation_contracts WHERE class IN ('rm-plus-2-pick-verify', 'rm-yt-16-first-post'); UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'issue-1001913';
-- CAUSE-MAPPED: registers no metric_registry row; the contracts are roadmap-gate and owner-step probes.

CREATE TABLE IF NOT EXISTS bak_20261105_c3_rows2 AS SELECT id, item, source, status, evidence, verified_at FROM roadmap_implementation WHERE id IN (1797, 1800, 3109);

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('rm-plus-2-pick-verify', NULL, 'PLUS-2', 'confirms the plus loop reads the usage number: a plus prompt written after PR 7456 carries it',
  'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM (SELECT prompt FROM cf_agent_requests WHERE instance LIKE ''roadmap-%-plus-%'' ORDER BY id DESC LIMIT 12) WHERE prompt LIKE ''%worker_requests_7d = %'') THEN ''ok'' ELSE ''pending: no plus request has been written since PR 7456 changed the pick, the daily cap of 3 was reached at 00:50Z on 2026-11-05 so the next batch is after 2026-11-06T00:50Z'' END AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 24, 'active', 'roadmap-gate', datetime('now'));

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('rm-yt-16-first-post', NULL, 'YT-16', 'confirms the first Short was posted natively to Bluesky or Mastodon (social_video_posts holds a posted row)',
  'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM social_video_posts WHERE state = ''posted'') THEN ''ok'' ELSE ''pending: social_video_posts has no posted row yet, the Shorts step runs at :30 and is held by the weekly caps (Bluesky 21 of 21, Mastodon 10 of 7 on 2026-11-05) until a slot rolls out of the 7-day window'' END AS observed',
  'd1-query', 3, 'qnfo-social', 24, 'active', 'roadmap-gate', datetime('now'));

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM human_actions WHERE slug = ''yt-oauth-publish'' AND status IN (''done'', ''resolved'') AND instr(COALESCE(resolution, ''''), ''handed back'') = 0) OR ((SELECT MIN(ts) FROM cloud_ops_events WHERE job = ''qnfo-youtube-shorts'' AND kind = ''youtube.uploaded'') <= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-21 days'') AND (SELECT MAX(ts) FROM cloud_ops_events WHERE job = ''qnfo-youtube-shorts'' AND kind = ''youtube.uploaded'') >= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-2 days'')) THEN ''ok'' ELSE ''pending: IDENTITY-BOUND owner step. Publishing the OAuth app In production is a setting on an owner-held Google Cloud project (Auth Platform, Audience, Publish app). Red-team 2026-11-05: no REST or gcloud call sets the publishing status (only the Console flow is documented), the repository and Cloudflare tokens carry no Google credential, and the Console needs the owner Google sign-in with a one-time code. Uploads have run '' || COALESCE(CAST(julianday(''now'') - julianday((SELECT MIN(ts) FROM cloud_ops_events WHERE job = ''qnfo-youtube-shorts'' AND kind = ''youtube.uploaded'')) AS INTEGER), 0) || '' of 21 days on one refresh token.'' END AS observed',
  verify_transport = 'd1-query', status = 'active', last_verdict = NULL, module = 'owner-step',
  action = 'C3-products 2026-11-05: replaces the birth probe that observed its own issue status; closes when the card yt-oauth-publish is resolved by the owner (not as a handback) or uploads have run 21 days on one refresh token',
  next_due_at = datetime('now')
WHERE class = 'issue-1001913';

UPDATE roadmap_implementation SET status = 'built', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), evidence = 'PR 7450 merged (qnfo-fleet-dashboard 1.93.0) on top of the data layer of PR 7337. Read live 2026-11-05: GET https://fleet.qnfo.org/health reports 1.93.0; GET /api/plus answers fleet-plus/v1 with 9 products (usage set for 8, shorts-channel null = unmeasured), the digest of 2026-11-04 and unavailable []; GET /plus answers 200 with Plus: what got better, the digest text, the word unmeasured, the note that usage is requests and not people, and its navigation tab; GET /api lists /api/plus. fleet_runs 70400 (management-personas-plus, 00:50Z) ran ok with 26 steps, so pl-usage and pl-digest execute; detector fm-plus-digest-stale. Phone journey plus-page-loads: PR 7520. No e-mail is sent from SQL: the owner reads the page.' WHERE id = 1800 AND item = 'PLUS-5';

UPDATE roadmap_implementation SET evidence = evidence || ' Consumer side (PR 7456, migration_runs ok 2026-11-05T00:58:44Z): pl-research names the usage number in its prompt and orders by hours since the last plus plus a usage bonus. The daily cap of 3 plus requests was used at 00:50:54Z, before this change (prompts read Usage signal: worker_requests_7d. with no number), so the first request under the new rule is written after 2026-11-06T00:50Z; contract rm-plus-2-pick-verify reads pending until then. The data layer is verified, the consumer is applied and not yet observed.' WHERE id = 1797 AND item = 'PLUS-2' AND instr(evidence, 'Consumer side (PR 7456') = 0;

UPDATE roadmap_implementation SET status = 'deployed', evidence = 'SHORT-POSTS-1 (qnfo-social 0.22.0, PR 7258) is live: GET https://qnfo-social.q08.workers.dev/health lists short-video-posts and the hourly :30 step runs (cloud_ops_events qnfo-social shorts ok at 2026-11-05T00:31Z and 01:30Z). It has posted nothing yet: platforms bluesky held:weekly-cap (21 of 21 in 7 days) and mastodon held:weekly-cap (10 of 7). A Short uploaded after the 2026-11-05T00:00Z start exists (youtube_videos row 6, 01:04Z), so the first native post waits for a slot to roll out of the 7-day window; the Shorts step runs before the text drain, so it takes the first free slot. social_video_posts is empty, so this is not built-and-verified: contract rm-yt-16-first-post reads pending until a posted row exists. TikTok, Instagram and Facebook Reels: agent_issues YT-16-REELS-1 (IDENTITY-BOUND, owner-authorised apps).' WHERE id = 3109 AND item = 'YT-16';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (C3-products)',
  'a row is built only after a live read; a step the fleet cannot take (publishing an OAuth app on an owner-held Google project) stays IDENTITY-BOUND even when the owner taps hand-back, with the attempt and a measuring probe on the issue',
  'C3-products verified state: PLUS-5 built, PLUS-2 consumer pending, YT-16 deployed with a first-post contract, issue-1001913 probe replaced',
  'live reads of fleet.qnfo.org/plus and /api/plus, fleet_runs 70400, migration_runs 1254 and the 00:58Z apply, cloud_ops_events qnfo-social shorts held:weekly-cap, human_actions 226',
  'migration merged', 'roadmap_implementation rows 1797, 1800, 3109; two contracts; one issue contract probe',
  'the Rollback header of migrations/2026-11-05-c3-products-verified.sql',
  'the dashboard answers what got better; the first native Short post is watched by a contract instead of by a session',
  'rm-plus-2-pick-verify reads ok after 2026-11-06T00:50Z; rm-yt-16-first-post reads ok when a slot frees', 'Shorts reach (indirect)',
  'fleet.qnfo.org, d1:qnfo-audit, qnfo-social cloud_ops_events'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'C3-products verified state:%');
