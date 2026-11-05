-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM roadmap_implementation WHERE item IN ('GH-5466', 'GH-5467') AND source = 'session-d2c'; the decision_log rows stay (append-only).
-- D2C-VERIFICATION-EVIDENCE-1 (2026-11-05, charter pillar autonomy; GitHub issues 5466, 5467 and the live changes behind 5754 and 6184 of the D2 reliability cluster).
-- GitHub 5466 and 5467 were filed by hand on 2026-10-31 and have no agent_issues row (no mirror), so their outcome is recorded in roadmap_implementation, where the
-- fleet's verified work lives, and the GitHub issues are closed with the same text as an evidence comment. Every figure below was read on 2026-11-04/05.
-- 5754 and 6184 were fixed by two Cloudflare configuration writes made through the account API; decision_log keeps what was written, what it was before and how to undo it.
-- No D1 row is deleted; the Rollback removes only the two roadmap_implementation rows this file adds.

INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence, verified_at)
SELECT 'GH-5466', 'session-d2c', 'Verify SLOT-CRASH-TRACE-1 (0.40.11) deploy: patcher ran, version live, slot n errors stopped',
  'verification', 'github:QNFO/qnfo-workers#5466 qnfo-research-exec/worker.js scripts/slot-crash-trace-1-patch.py qnfo-research-exec/slot-crash-trace.test.mjs', 'verified',
  'All five acceptance checks hold on live reads of 2026-11-05. (1) The trace code is on main: worker.js carries three SLOT-CRASH-TRACE-1 markers (the slot catch logs e.message plus the top two stack frames; a comment documents the PAPER_SECTION_ORDER[-1] case); commit ed6b9484 landed the pending patch. (2) Live qnfo-research-exec answers /health version 0.50.2 (later than 0.40.11) and its deployed bundle is byte-identical to worker.js and deployed-current.worker.js (sha256 e84ae25c91cbe43c, see GH-5467). (3) cloud_ops_events kind error, job qnfo-research-exec, text "slot N: Cannot read properties of undefined (reading n)": 263, 348, 353, 335 and 605 events on 2026-10-27..31 (1904 in all), last 2026-10-31T12:51:08Z, zero on every day since; the only slot errors after it are the two of 2026-11-04. (4) Every slot error since 0.40.11 carries " @ <frames>": the 2 slot events of 2026-11-04 (last 14:41:10Z) both have frames and both read D1_ERROR "D1 DB is overloaded", the shared D1 overload, not the n crash. (5) node qnfo-research-exec/slot-crash-trace.test.mjs: 7 passed, 0 failed on main.',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM roadmap_implementation WHERE item = 'GH-5466' AND source = 'session-d2c');

INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence, verified_at)
SELECT 'GH-5467', 'session-d2c', 'Investigate 619-byte drift between live qnfo-research-exec script and repo HEAD',
  'verification', 'github:QNFO/qnfo-workers#5467 qnfo-research-exec/worker.js qnfo-research-exec/deployed-current.worker.js', 'verified',
  'No live-to-repo drift. On 2026-11-05 the live script of qnfo-research-exec 0.50.2 (Cloudflare API GET /workers/scripts/qnfo-research-exec/content/v2, multipart framing stripped) has sha256 e84ae25c91cbe43cb96e700df8c6ec4ab1208dbd0cd44af61acc53b206c38035 over 1,671,867 bytes, the same as origin/main qnfo-research-exec/worker.js and deployed-current.worker.js (cmp: identical). The 619 bytes of 2026-10-31 are consistent with how the figure was taken, if the live number was a character count of the content/v2 response (not recorded in the issue, so an inference): that response is the script inside a multipart body with 250 bytes of framing (boundary, Content-Disposition and Content-Type lines), and a character count differs from the repo byte count by the multi-byte characters of the file (802 in the 2026-10-31 blob 07b4efa8~1, 1,588,505 bytes = 1,587,703 characters): 1,588,505 - 1,587,886 = 619 = 802 - 250 + 67. The 67 that remain would be a real, small difference of that moment (a comment-sized edit on main not yet redeployed, as the issue guessed); the canonical deploy has since replaced the script several times (0.40.9 to 0.50.2) and every deploy writes through qnfo-ops /ops/deploy, so no out-of-band writer is needed to explain it. The mirror rule held: worker.js and deployed-current.worker.js are identical.',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM roadmap_implementation WHERE item = 'GH-5467' AND source = 'session-d2c');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2c-gateway-loops',
  'GATEWAY-DRIFT qnfo-infra:retries<2 is a true reading: the AI Gateway "qnfo-infra" (created 2026-10-29T10:20:27) has retry_max_attempts null, i.e. no gateway-level retry, while the fleet standard (gateway "default") is 2',
  'D2C-GATEWAY-RETRIES-1: PUT /accounts/{acct}/ai-gateway/gateways/qnfo-infra with retry_max_attempts 2, retry_delay 1000, retry_backoff exponential, every other field sent back as read (spend_limits rule monthly-50-all, authentication, cache_ttl, rate limit, log management kept)',
  'GET before: retry_max_attempts null, retry_delay null, retry_backoff null. GET after (modified_at 2026-11-04 23:03:11): 2 / 1000 / exponential; a field-by-field diff of the 16 settings shows only those three changed. The advisor audit (qnfo-fleet-control gatewayConfigAudit) flags retries < 2 and had read GATEWAY-DRIFT qnfo-infra:retries<2 in every advisor-audit event since 2026-10-29; the code treats a null as 0 (the undefined default of 2 never applies to the API''s null), so the finding was right.',
  'configuration written through the Cloudflare account API; the contract probe of issue-1000783 reads the latest advisor-audit event for the string qnfo-infra:retries<2 and passes at the first audit after the write',
  'one AI Gateway (qnfo-infra); no worker in this repository calls it (qnfo-infra reads the default gateway), so the only effect is a retry on failed requests that name this gateway',
  'PUT the same gateway with retry_max_attempts, retry_delay and retry_backoff null (or the dashboard); the advisor then reports the drift again',
  'a gateway created without retries is repaired in place; the next one still needs this repair (follow-up: the audit could apply it itself)',
  'issue-1000783 reads qnfo-infra:retries>=2 within one advisor audit (about 80 minutes) and closes through the autoclose trigger',
  'none', 'live GET of the gateway before and after; the audit code read for the null case'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'D2C-GATEWAY-RETRIES-1:%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2c-gateway-loops',
  'MODEL-FLOOR-1 failed on the live bundle of qnfo-fleet-lee (a Worker in the account with no source directory, served on lee.qnfo.org, no dependents in the fleet graph) because its AI_MODEL variable pinned @cf/meta/llama-4-scout-17b-16e-instruct; the guard accepts a banned DEFAULT_MODEL fallback when the AI_MODEL variable names an allowed model',
  'D2C-FLEET-LEE-MODEL-1: PATCH /accounts/{acct}/workers/scripts/qnfo-fleet-lee/settings, AI_MODEL set to @cf/qwen/qwen3-30b-a3b-fp8 (in scripts/model-policy.json), every other binding sent as type inherit (AI, ASSETS, CF_API_TOKEN secret, CF_ACCOUNT_ID, AI_GATEWAY_ID, routes), under the secret-lock lease for the worker',
  'Bindings before and after listed by name and type: identical except AI_MODEL (llama-4-scout to qwen3-30b-a3b-fp8); /api/health answers cf_token_set true, model qwen3-30b-a3b-fp8; POST /api/chat answers OK. Workflow model-floor-guard run 41932624731 (workflow_dispatch on main, live sweep): LIVE BUNDLES 0 workers with code-level violations, 39 bundles read; the run of 2026-11-04T11:00:19Z (41817966129) had failed on qnfo-fleet-lee L9 var DEFAULT_MODEL = llama-4-scout.',
  'configuration written through the Cloudflare account API; the contract probe of issue-1001226 (latest main run success and no workflow_failures row for 24 h) passes once the 11:00Z failure is 24 hours old, provided the next scheduled live sweep stays green',
  'one unmanaged Worker (lee.qnfo.org chat agent); its replies now come from qwen3-30b-a3b-fp8',
  'PATCH the same settings with AI_MODEL @cf/meta/llama-4-scout-17b-16e-instruct (this turns the guard red again)',
  'a live bundle that pins a banned model through a configurable variable is repaired at the variable',
  'issue-1001226 closes by the autoclose trigger after 2026-11-05T11:00Z; the daily live sweep (03:17Z) stays green',
  'none', 'live settings read before and after, health and chat requests to lee.qnfo.org, a live model-floor-guard run'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'D2C-FLEET-LEE-MODEL-1:%');
