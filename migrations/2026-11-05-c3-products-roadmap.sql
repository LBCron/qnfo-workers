-- C3-PRODUCTS roadmap dispositions (2026-11-05, charter pillar reach; roadmap_implementation rows 1622 YT-5, 1679 JS-8, 1680 JS-9, 1713 YT-9, 1716 YT-12, 1797 PLUS-2).
-- Each row gets the disposition its live evidence supports; nothing is closed to lower a count and nothing here is a wontfix. Read 2026-11-04 23:5xZ:
--   YT-5   publishing the OAuth app "In production" is a setting on the owner's own Google Cloud project (Auth Platform > Audience): no API exposes it and no session may click it.
--          IDENTITY-BOUND card yt-oauth-publish with its default in effect and a self-closing contract. Uploads still work 8 days after the first (rows 3 and 5 uploaded 22:00Z and
--          23:08Z on 2026-11-04, first upload 2026-10-27) although a Testing-mode token lives 7 days, so the stored token was re-minted or the app is already published; the
--          contract below closes the card only after uploads have run 21 days (three Testing-mode lifetimes) with the newest inside 48 hours.
--   JS-8   the two open ledger questions (jobsearch_meta.ledger_open_questions = 2) are the owner's immigration facts: personal data no tool can read. Card 198 is IDENTITY-BOUND, its
--          contract owner-card-jobsearch-ledger reads the open count, the answer path is the CV review tab of jobs.q08.org. Nothing is blocked meanwhile: owner_stated already records
--          authorization in NL and US and relocation anywhere (2026-10-27), and the matcher flags only what it cannot know.
--   JS-9   built by PR 6368 (qnfo-jobsearch outcomeScoreWeights); the code is unit-tested and switches on by itself at 10 applications 21 days old (GET /api/outcomes read 2026-11-04:
--          mature_applied_90d 0 of 10, reply_rate_90d null, metric jobsearch_reply_rate_90d UNMEASURED with its trigger). Built, data-gated: it cannot be verified before the data exists.
--   YT-9   DEFAULT-APPROVE-1: the blind voice test needs an owner who listens; the recommended option is taken, Kokoro-82M as the default voice with Aura 2 as the per-sentence
--          fallback (PR 7211). youtube_spend for row 5 (rendered 2026-11-04 23:02Z) has a director line and a 306 s container line but no tts_aura line, which rows 3 and 4 (Aura) have.
--          The voice is reversible by one engine switch in qnfo-youtube-shorts; the owner's ear remains the last word and is not claimed.
--   YT-12  decided with the recommended option, not built now: the 2026-10-28 survey found diffusion cannot draw correct charts or numbers, the owner's actual ask (varied professional
--          graphics) is YT-19, and the row itself waits for retention data. Status deferred with a data gate: contract rm-yt-12-gate reads pending until 5 Shorts have a view count.
--   PLUS-2 built and verified live: PR 7337, migrations/2026-11-05-plus-2-5-usage-digest.sql applied (migration_runs 1254, ok, 16 statements); product_registry.usage_value is set for
--          8 of 9 active products (shorts-channel NULL: no view read yet), steps pl-usage, pl-usage-shorts and pl-digest are in management-personas-plus.
-- Prediction: the card and contracts exist after apply; fm contracts read pending, not failing; roadmap rows show the new statuses. Stop: Rollback below.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_c3_rows
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_c3_rows b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_c3_rows b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_c3_rows b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_c3_rows); DELETE FROM human_actions WHERE slug = 'yt-oauth-publish' AND source = 'session:C3-products'; DELETE FROM remediation_contracts WHERE class IN ('owner-card-yt-oauth-publish', 'rm-yt-12-gate');
-- CAUSE-MAPPED: registers no metric_registry row; the contracts are owner-step and roadmap-gate probes.

CREATE TABLE IF NOT EXISTS bak_20261105_c3_rows AS SELECT id, item, source, status, evidence, verified_at FROM roadmap_implementation WHERE id IN (1622, 1679, 1680, 1713, 1716, 1797);

INSERT INTO human_actions (slug, title, why, default_in_effect, action, url, sev, status, source, created_at, updated_at)
SELECT 'yt-oauth-publish', 'YouTube: publish the QNFO uploader app "In production" so its refresh token stops expiring weekly',
 'IDENTITY-BOUND: the setting lives on your own Google Cloud project (gen-lang-client-0589613911, Google Auth Platform, Audience page). No API exposes it and no session or loop may click it as you. An OAuth app left in Testing mode issues refresh tokens that expire after 7 days, which would stop the Shorts uploads weekly until someone re-consents. Read 2026-11-04: uploads at 22:00Z and 23:08Z worked 8 days after the first one (2026-10-27), so either the token was re-minted or the app is already published; nothing is blocked today.',
 'The app stays as it is. Uploads keep working while the stored refresh token lives; if it expires, the upload stage fails with an oauth refresh error (youtube_videos.note, cloud_ops_events youtube.stage_error) and the re-consent helper POST /oauth/consent (qnfo-youtube-shorts, x-run-token) issues a replacement token.',
 'Open the Audience page of the project, press Publish app and confirm In production (an unverified app is allowed for your own channel and shows the warning screen once at sign-in). If it already says In production, mark this card done. The card also closes by itself when uploads have run 21 days on one refresh token with the newest inside 48 hours.',
 'https://console.cloud.google.com/auth/audience?project=gen-lang-client-0589613911', 'low', 'open', 'session:C3-products', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM human_actions WHERE slug = 'yt-oauth-publish');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('owner-card-yt-oauth-publish', NULL, 'YT-5', 'closes the human_actions card yt-oauth-publish when uploads have run 21 days on one refresh token',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT MIN(ts) FROM cloud_ops_events WHERE job = ''qnfo-youtube-shorts'' AND kind = ''youtube.uploaded'') <= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-21 days'') AND (SELECT MAX(ts) FROM cloud_ops_events WHERE job = ''qnfo-youtube-shorts'' AND kind = ''youtube.uploaded'') >= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-2 days'') THEN ''ok'' ELSE ''pending: uploads have run '' || COALESCE(CAST(julianday(''now'') - julianday((SELECT MIN(ts) FROM cloud_ops_events WHERE job = ''qnfo-youtube-shorts'' AND kind = ''youtube.uploaded'')) AS INTEGER), 0) || '' of 21 days with a recent upload (a Testing-mode refresh token lives 7)'' END AS observed',
  'd1-query', 3, 'qnfo-cloud-ops', 24, 'active', 'owner-step', datetime('now'));

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('rm-yt-12-gate', NULL, 'YT-12', 'reopens the generative hook b-roll evaluation (roadmap row YT-12) once 5 Shorts have a view count',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM youtube_videos WHERE state = ''uploaded'' AND views IS NOT NULL) >= 5 THEN ''ok'' ELSE ''pending: '' || (SELECT COUNT(*) FROM youtube_videos WHERE state = ''uploaded'' AND views IS NOT NULL) || '' of 5 Shorts have a view count (YT-6: public view read, or owner card yt-analytics-consent)'' END AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 24, 'active', 'roadmap-gate', datetime('now'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (C3-products)',
  'the blind voice test needs an owner who listens; DEFAULT-APPROVE-1 takes the recommended option for a reversible choice',
  'YT-9: Kokoro-82M is the default Shorts voice, Aura 2 the per-sentence fallback (PR 7211); the owner is not asked to run a blind test',
  'owner complaint 2026-11-04 (robotic unsentenced speech); youtube_spend: row 5 rendered 23:02Z has no tts_aura line (rows 3 and 4 do) and a 306 s container line',
  'taken', 'the voice of new Shorts only; published Shorts are not touched',
  'switch the TTS engine back to Aura 2 in qnfo-youtube-shorts (ttsEngine) and redeploy; or the owner names another voice',
  'Shorts with a more natural voice and real word times', 'owner hears the new voice on the next Short and keeps it or names a change', 'Shorts reach (indirect)',
  'youtube_spend rows, qnfo-youtube-shorts /status, PR 7211'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'YT-9: Kokoro-82M is the default%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (C3-products)',
  'generative b-roll cannot draw correct charts or numbers (survey 2026-10-28), needs a GPU outside the USD 50 cap check, and waits for retention data that does not exist yet; the owner asked for varied professional graphics, which YT-19 delivers programmatically',
  'YT-12 deferred behind a data gate (5 Shorts with a view count, contract rm-yt-12-gate); no b-roll is built now',
  'roadmap row 1716 evidence (survey); youtube_videos.views NULL on all 5 uploaded rows on 2026-11-04; YT-19 row 3129 open',
  'taken', 'none: nothing is built or spent', 'set the row back to planned', 'none now; evaluation reopens when the gate reads ok', 'none now', 'none', 'youtube_videos, roadmap_implementation 1716 and 3129'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'YT-12 deferred behind a data gate%');

UPDATE roadmap_implementation SET status = 'owner-decision', evidence = 'IDENTITY-BOUND card yt-oauth-publish (migrations/2026-11-05-c3-products-roadmap.sql): publishing the OAuth app In production is a setting on the owner''s own Google Cloud project (Auth Platform, Audience), no API, no session may click it. Default in effect: the app stays as it is; the upload path survives (uploads 2026-11-04 22:00Z and 23:08Z, 8 days after the first) and the re-consent helper POST /oauth/consent (qnfo-youtube-shorts 0.4.0, #5479) reissues a token. Closing probe: contract owner-card-yt-oauth-publish reads ok after 21 days of uploads on one token with a recent upload.' WHERE id = 1622 AND item = 'YT-5';

UPDATE roadmap_implementation SET status = 'owner-decision', evidence = 'IDENTITY-BOUND: the two open ledger questions (US citizenship vs authorization basis, NL permit type) are the owner''s immigration facts. Card jobsearch-ledger-owner-answers (id 198, handed back 2026-11-04 17:09Z as OWNER-TASK issue 1001749), contract owner-card-jobsearch-ledger reads jobsearch_meta.ledger_open_questions (2 on 2026-11-04); the owner answers in the CV review tab of jobs.q08.org. Not blocking: owner_stated records authorization in NL and US and relocation anywhere (2026-10-27), and the matcher flags only what it cannot know.' WHERE id = 1679 AND item = 'JS-8';

UPDATE roadmap_implementation SET status = 'built', evidence = 'PR 6368 (qnfo-jobsearch outcomeScoreWeights, feature weights from mature applications, bounded to +-8); unit tests in qnfo-jobsearch/worker.test.mjs (fewer than ten mature applications, or applications younger than 21 days, tune nothing). Data-gated, so not verifiable yet: GET https://qnfo-jobsearch.q08.workers.dev/api/outcomes read 2026-11-04 shows mature_applied_90d 0 of 10 and reply_rate_90d null; metric jobsearch_reply_rate_90d is UNMEASURED with trigger threshold 0.03. It switches on by itself when 10 applications are 21 days old.' WHERE id = 1680 AND item = 'JS-9';

UPDATE roadmap_implementation SET status = 'built', evidence = 'DEFAULT-APPROVE-1 decision logged (decision_log, YT-9): Kokoro-82M default with Aura 2 per-sentence fallback, shipped by PR 7211 (qnfo-youtube-shorts 0.5.0, real word times from the Kokoro render, so no whisper alignment is needed). Read 2026-11-04: youtube_spend for row 5 (rendered 23:02Z) has no tts_aura line while rows 3 and 4 have one. The owner''s listening verdict is not claimed; revert is the ttsEngine switch.' WHERE id = 1713 AND item = 'YT-9';

UPDATE roadmap_implementation SET status = 'deferred', evidence = 'DECIDED 2026-11-05 (DEFAULT-APPROVE-1, decision_log YT-12): not built now. Survey 2026-10-28: diffusion cannot draw correct charts or numbers; the owner''s ask for varied professional graphics is YT-19; the row waits for retention data. Gate: contract rm-yt-12-gate reads pending until 5 uploaded Shorts have a view count (0 of 5 on 2026-11-04), then the evaluation reopens; owner of the gate is the QNFO.REACH manager.' WHERE id = 1716 AND item = 'YT-12';

UPDATE roadmap_implementation SET status = 'built', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), evidence = 'PR 7337 merged; migrations/2026-11-05-plus-2-5-usage-digest.sql applied (migration_runs 1254, ok, 16 statements, 2026-11-04T23:52Z). Read after apply: product_registry.usage_value is set for 8 of 9 active products (usage_metric worker_requests_7d from worker_usage_daily, usage_read_at 2026-11-04T03:10Z; shorts-channel NULL, unmeasured, never 0); step pl-usage, pl-usage-shorts and pl-digest are in fleet_tasks management-personas-plus; detectors fm-product-usage-unmeasured and fm-plus-digest-stale. The number is Worker requests (cron and service-binding calls included), not people.' WHERE id = 1797 AND item = 'PLUS-2';
