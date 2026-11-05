-- W2-D wrap-up (2026-11-05, charter pillar research): rows 113, 43, 42, 37, 35, 33 set to partial with the live reads of the C7 slices (PRs 7553, 7352, 7569, 7522, 7432), three defects found by those reads filed with a doer, and CF-OBS issue 1002066 (GitHub 7775) closed with its evidence.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'not-built', verified_at = NULL, evidence = substr(evidence, 1, instr(evidence, ' | W2-D wrap-up') - 1) WHERE id IN (113, 43, 42, 33) AND instr(evidence, ' | W2-D wrap-up') > 0; UPDATE roadmap_implementation SET status = 'partial', verified_at = NULL, evidence = substr(evidence, 1, instr(evidence, ' | W2-D wrap-up') - 1) WHERE id IN (37, 35) AND instr(evidence, ' | W2-D wrap-up') > 0; DELETE FROM agent_issues WHERE status = 'open' AND source = 'w2d-wrapup' AND (title LIKE 'RENDER-SOURCE-FIX-1:%' OR title LIKE 'IDEA-FEED-PROMPT-LEAK-1:%' OR title LIKE 'IDEA-STREAM-LINK-1:%'); UPDATE issue_triage SET triage_state = 'triaged', close_evidence = NULL WHERE issue_id = 1002066; UPDATE agent_issues SET status = 'open', close_channel = NULL WHERE id = 1002066

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D wrap-up 2026-11-05 (read live 06:10Z): PR 7553 idea-hub 1.18.0 is deployed, GET https://ideas.qnfo.org/stream answers 200 with data-page="idea-stream", the home page carries href="/stream", /api/feed?limit=3 returns items. Not met: the row asks for a link from qnfo.org and https://qnfo.org/ does not mention the stream (IDEA-STREAM-LINK-1, qnfo-gateway, file claimed by another session). Defect found by the read: the first public feed item is a role prompt (title starts "### TASK WRITER You are one of three independent research writers"), so the stream shows it (IDEA-FEED-PROMPT-LEAK-1).'
  WHERE id = 113;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D wrap-up 2026-11-05 (read live 06:10Z): PR 7352 radar-hub 1.6.0 deployed, /health reports events_workflow true; research_scan_log row evwf-2026-11-05T01:34:16.436Z-done (instance c7-verify-mw2vh473, via workflow, events-radar-2026-11-05, 39 events, catalog 5/5) shows the Workflow ran to completion. Open: the first cron-created instance, Monday 2026-11-09 05:00Z (rows started then done in research_scan_log job events-radar-workflow).'
  WHERE id = 43;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D wrap-up 2026-11-05 (read live 06:10Z): PR 7569 is deployed (research-exec 0.53.2 on /health) but the capability does not work: GET /render-check answers ok false, reason render-error, error "erratapublishMod is not defined", and the last four ground-render rows in cloud_ops_events (05:02Z and 05:32Z) carry the same error with ms=0. The deployed script (read through the Cloudflare API, 1,716,758 bytes) holds var erratapublishMod once, so the failing lookup is a scope problem to find (RENDER-SOURCE-FIX-1). The Queues half of the row is not started.'
  WHERE id = 42;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D wrap-up 2026-11-05 (read live 06:10Z): PR 7522 deployed; GET https://qnfo-research-exec.q08.workers.dev/precheck answers 200 (page), POST /api/precheck with a 128-character manuscript returned ok false, "1 to fix before you submit, 3 worth a second look", 11 checks with the assistant-text check at fix. No model call. Open: the small-model read of unsupported claims from another family (next slice named in the PR).'
  WHERE id = 37;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D wrap-up 2026-11-05 (read live 06:10Z): PR 7432 (qnfo-ai-search 2.15.0) https://ask.qwav.org/concepts answers 200 and /api/concepts?q=ultrametric returns nodes; KG-CURATE-1 (PR 7531, memory-mcp 2.11.0 on /health) curates the graph. Open: Durable Objects at scale and a fuller visualisation.'
  WHERE id = 35;

UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = evidence || ' | W2-D wrap-up 2026-11-05 (read live 06:10Z): PR 7432 https://ask.qwav.org/consistency answers 200 and /api/consistency?slug=joules-per-solution-metric returns checked.passages 3 compared with 726 papers, missing_citations 2, redundancy 0, same_work 0, labelled candidates for a reader to check. Open: contradictions between papers are not checked yet.'
  WHERE id = 33;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'RENDER-SOURCE-FIX-1: Browser Run grounding render fails with "erratapublishMod is not defined"',
'Charter pillar: research (roadmap row 42 RM-RESEARCH-BROWSER-QUEUES-1). Doer: the code loop. Metric it should move: ground-render rows with ok=1 in cloud_ops_events (now 0 of 4) and ground-fulltext rows with rendered=N.

Evidence read 2026-11-05 06:10Z: research-exec 0.53.2 live; GET /render-check returns ok false, error "erratapublishMod is not defined"; the deployed script has var erratapublishMod once (before its member IIFE) and renderedSourceText (top level) calls erratapublishMod.renderSourceHtml. The unit test passes only because it sets globalThis.erratapublishMod.

What to change: find why the identifier is not visible at run time (check whether the folded member var is inside a block or a separate function scope in the built script; the safe fix is a top-level function renderSourceHtmlBridge that renderedSourceText calls and that the member registers on globalThis at its return, or move the call into the member). Keep RENDER_ALLOW, the 2-per-run budget and ops_config ground_render. Add a test that evaluates the real worker.js text, not a globalThis stub. Bump with python scripts/worker_release.py bump qnfo-research-exec. Do not touch the errata-fold test allowance beyond the one return line.

Closes when: GET https://qnfo-research-exec.q08.workers.dev/render-check returns ok true with sections above 3.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function renderedSourceText(env, url, ctl) {
runtime-probe: {"url": "https://qnfo-research-exec.q08.workers.dev/render-check", "status": 200, "absent": "is not defined"}',
'w2d-wrapup', 'roadmap', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'RENDER-SOURCE-FIX-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'IDEA-FEED-PROMPT-LEAK-1: the public idea feed and stream show a role prompt as an idea',
'Charter pillar: reach (roadmap row 113 RM-IDEA-STREAM-UI-1). Doer: the code loop. Metric it should move: public feed items whose title starts with "###" or "TASK" (now at least 1 of the newest 3).

Evidence read 2026-11-05 06:10Z: GET https://ideas.qnfo.org/api/feed?limit=3 returns first the thread t-task-writer-you-are-one-of-three-2026-11-05 with title "### TASK WRITER You are one of three independent research writers producing a full-length preprint"; /stream renders it.

What to change: in idea-hub, make publicTitle reject titles that start with markdown heading marks or a TASK/ROLE prompt shape (the existing role-prompt gate misses a title that begins with ###), add the shape to the idea-hub feed test, bump with worker_release.py. Do not loosen any other public gate.

Closes when: /api/feed?limit=40 holds no title matching ^#{1,6} or ^TASK .

code-task: repo=qnfo-workers path=idea-hub/worker.js
code-anchor: function publicTitle(s){const t=clean(s,1000);
runtime-probe: {"url": "https://ideas.qnfo.org/api/feed?limit=40", "status": 200, "absent": "### TASK WRITER"}',
'w2d-wrapup', 'roadmap', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'IDEA-FEED-PROMPT-LEAK-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'IDEA-STREAM-LINK-1: qnfo.org links the public idea stream (and the platform pages of row 40)',
'Charter pillar: reach (roadmap rows 113 RM-IDEA-STREAM-UI-1 and 40 RM-VISION-UNIFIED-PLATFORM-1). Doer: the code loop. Metric it should move: referrals from qnfo.org to ideas.qnfo.org/stream.

Evidence read 2026-11-05 06:10Z: https://ideas.qnfo.org/stream is live; https://qnfo.org/ has no link to it. The platform page that was to carry it was never built. qnfo-gateway/worker.js is claimed by another session (check GET https://qnfo-deploy-guard.q08.workers.dev/work-locks first).

What to change: in the qnfo.org hub page (handleHub) add one link in the existing navigation or hero action row: "Live idea stream" to https://ideas.qnfo.org/stream, plus links to https://ask.qwav.org/concepts, /consistency, /paper and /compute under a short "Tools" list. Plain anchors, no script. Add the addresses to the hub test, bump with worker_release.py.

Closes when: the qnfo.org home page contains ideas.qnfo.org/stream.

code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: async function handleHub(env) {
runtime-probe: {"url": "https://qnfo.org/", "status": 200, "contains": "ideas.qnfo.org/stream"}',
'w2d-wrapup', 'roadmap', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'IDEA-STREAM-LINK-1:%');

UPDATE agent_issues SET close_channel = 'session:w2-d' WHERE id = 1002066 AND status = 'open';

UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'),
  close_evidence = 'W2-D, read 2026-11-05 06:10Z: the one observation (count 1) was at 2026-11-05T04:23:39Z, 62 s before the living-paper chain migration applied (migration_runs 1464, 04:24:41Z), a probe in the deploy window. PR 7778 (qnfo-lifecycle 1.19.1, live: /health 1.19.1-codeagent) answers a missing table with 503 installed:false and logs nothing. Since the migration: paper_ledger_seals id 1 (05:02:14Z) and id 2 (06:02:19Z) sealed, GET /paper-ledger/chain at 06:06:34Z answered 200 with chain_rows 1000 and sql_breaks 0, worker_logs holds 0 rows for qnfo-lifecycle with "chain status failed" or "no such table" after 04:24Z (7 rows read). GitHub 7775 is closed by the steward.'
WHERE issue_id = 1002066 AND triage_state <> 'closed';

UPDATE agent_issues SET status = 'closed', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1002066 AND status = 'open'
  AND EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = 1002066 AND t.triage_state = 'closed' AND t.close_evidence IS NOT NULL);
