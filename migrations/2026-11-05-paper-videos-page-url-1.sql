-- PAPER-VIDEOS-PAGE-URL-1: /api/paper-videos returns page URLs of the form /papers/<slug>@v1, which the gateway answers with 404; the route that works is /papers/<slug>/v1 (or the plain slug).
-- Found by the post-merge ux-journeys run 41934927637 (2026-11-04T23:38Z): papers / paper-with-short failed after its retry too, and curl confirms the 404 (charter pillar reach; YT-15 reader path).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title = 'PAPER-VIDEOS-PAGE-URL-1: /api/paper-videos page URLs end in @v1 and answer 404' AND source = 'session:roadmap-backlog';
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'PAPER-VIDEOS-PAGE-URL-1: /api/paper-videos page URLs end in @v1 and answer 404',
'Pillar reach, roadmap YT-15. GET https://papers.qnfo.org/api/paper-videos lists items whose slug is the youtube_videos.slug (for example a-two-index-framework-for-the-bulk-boundary-correspondence-of-anyon-condensation@v1) and builds page as "https://papers.qnfo.org/papers/" + slug. The gateway answers that URL with 404 (checked with curl on 2026-11-04T23:40Z): the working forms are /papers/<base-slug> (200, carries "Watch it in under a minute" and the youtube-nocookie embed) and /papers/<base-slug>/v1 (200). Every consumer of the API (the phone journey papers / paper-with-short, outreach, search engines) gets a dead page link, and the journey keeps UX-JOURNEY-1: papers / paper-with-short open.
Fix in paperVideosJson (qnfo-gateway): split a trailing @v<N> off the slug and build page as "https://papers.qnfo.org/papers/" + base + (N ? "/v" + N : ""); keep slug as the key. Add the case to the gateway test so a slug with @v<N> never yields an @ in page.
code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: async function paperVideosJson(env) {
runtime-probe: {"url": "https://papers.qnfo.org/api/paper-videos", "status": 200, "absent": "papers/a-two-index-framework-for-the-bulk-boundary-correspondence-of-anyon-condensation@v1\""}
Claim note: qnfo-gateway/worker.js was held by breach-bp26-web (claim until 2026-11-05T00:35Z) when this was filed, so the edit is queued for the code loop instead of a second concurrent change.',
'session:roadmap-backlog', 'reliability', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'PAPER-VIDEOS-PAGE-URL-1: /api/paper-videos page URLs end in @v1 and answer 404' AND status = 'open');
