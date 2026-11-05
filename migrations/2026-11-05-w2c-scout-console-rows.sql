-- W2C-SCOUT-ROWS-1 (2026-11-05, roadmap completion sweep, agent W2-C scout-2026-10 / composio / console; charter pillars cost, autonomy, research): status and live evidence for the
-- scout and code-agent-console rows whose build landed through other sessions' pull requests, each read after the deploys on 2026-11-05, plus the two doers for the gaps found on the way.
-- Every UPDATE is guarded by the status (or the evidence text) it replaces, so a status another session wrote is never overwritten and a replay changes nothing.
-- ROWS: 1684 RM-RAG-HYBRID-BASELINE-1 built (the rerank A/B ran and was decided), 1695 RM-AUTOROUTER-EVAL-1 partial (built, never run: nothing calls it), 1702 RM-CLAIMS-LEDGER-1 partial (writer live,
-- no paper published since), 1696/1806/1807 in_progress to partial (0.8.0 live, acceptance needs authenticated use), 1802/1808 evidence appended (owner handed the account steps back; red-teamed),
-- 1683/1693 evidence appended (the 20-task measurements are gated by traffic and by a client that holds the ops key). Doers: AUTOROUTER-SHADOW-SCHEDULE-1, ATOMIC-CLAIMS-LIVE-1.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_w2c_rows b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_w2c_rows b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_w2c_rows b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_w2c_rows); DELETE FROM blocker_redteam WHERE actor = 'W2-C' AND target IN ('card:223', 'card:224'); DELETE FROM capability_ledger WHERE capability = 'ai-search-cost-meter'
-- BACKUP: bak_20261105_w2c_rows

CREATE TABLE IF NOT EXISTS bak_20261105_w2c_rows AS SELECT * FROM roadmap_implementation WHERE id IN (1683, 1684, 1693, 1695, 1696, 1702, 1802, 1806, 1807, 1808);

-- 1684: the A/B the row asks for has run and was decided.
UPDATE roadmap_implementation SET status = 'built', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'qnfo-ai-search 2.14.0 (PR 7308), live as 2.15.1 on 2026-11-05: corpusSearch asks AI Search for hybrid retrieval (vector plus keyword, reciprocal-rank fusion) and applies the @cf/baai/bge-reranker-base cross-encoder unless the config says rerank false; rerank is a retrieval key of the daily golden-set loop (TUNE_SPACE rerank [false, true], the same win rule as every retrieval key). A/B result read 2026-11-05 in ask_evals: id 63 champion rerank true (MRR 0.9063, recall 0.9375, mean 7906 ms, 16 rerank calls) against id 64 challenger rerank false (MRR 0.9583, recall 1, mean 3305 ms, 0 rerank calls), n = 16 golden questions; experiment ASK-TUNE-R-2026-11-05-rerank adopted (ask_loop_runs eval-retrieval 2026-11-05T03:44:54Z, adopted true; the 2026-11-02 run, ASK-TUNE-R-2026-11-02-rerank, was rejected). The cheaper arm that holds quality, hybrid without the cross-encoder, is now the champion. Limits: 16 questions and one pair per run; the daily loop re-tests the key. No agentic-retrieval loop exists in the fleet to A/B against it yet.'
WHERE id = 1684 AND item = 'RM-RAG-HYBRID-BASELINE-1' AND status = 'planned';

-- 1695: built and deployed, never run.
UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'Built and deployed, never run: qnfo-ai has POST /internal/eval/autorouter-shadow (PR 6567, autoRouterShadowRun: replays at most 5 logged prompts of the last 7 days through cloudflare/auto with spend governance and writes autorouter-shadow rows to cloud_ops_events) and cf-ops-actions has the read-only gateway-routes action (PR 7002, 7381). Read 2026-11-05T03:50Z: 0 autorouter-shadow rows ever, because only the router key or a trusted service-binding caller can post to the route and no loop does. AUTOROUTER-SHADOW-SCHEDULE-1 (filed with this row, doer qnfo-ai-calibration through the code loop; its file was claimed by session:breach-main to 04:51Z) has the calibration tick call it once a day through its QNFO_AI binding, which qnfo-ai already trusts by ctx.props.caller, so no secret is involved; its closing probe is 9 ok or skipped_budget autorouter-shadow events in 4 days.'
WHERE id = 1695 AND item = 'RM-AUTOROUTER-EVAL-1' AND status = 'planned';

-- 1702: the writer is live; no paper has published since it deployed, so the ledger has not been exercised.
UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'PR 7419 (qnfo-research-exec 0.51.0, merged 2026-11-05T00:36:20Z, live as 0.53.0): extractAtomicClaims and writeAtomicClaimsLedger write one atomic row per reader-facing prose sentence into paper_claims after the queue row is marked published, keyed (slug, claim_kind, source_ref), state verified, refuted, unverified or unsupported; stageVerify hands its recomputed claims over. Read 2026-11-05T03:55Z: paper_claims holds 148 rows, all claim_kind reference, 0 atomic; the newest publish is 2026-11-04T21:11:40Z (research_queue.published_at), before the deploy, and none since, so the writer has not run on a real paper. claim_coverage still carries its old value 1 (last refreshed 2026-11-03T09:11Z) because its collector reads atomic rows only. The earlier closing probe of agent_issues 1000664 (claim_coverage has a non-empty value) passed on that carried value and proves nothing; ATOMIC-CLAIMS-LIVE-1 replaces it with a probe on the atomic rows themselves.'
WHERE id = 1702 AND item = 'RM-CLAIMS-LEDGER-1' AND status = 'planned';

-- 1696, 1806, 1807: qnfo-agents 0.8.0 is live; the acceptance probes need authenticated use of the console.
UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'docs/CODE-AGENT-CONSOLE.md; qnfo-agents 0.8.0 live (PR 7376: CodeSession per-session neuron budget, plan and claim gate, durable approval pause; PR 7567 console follows a continued run; PR 7356 render and settle of stream turns still open). Read 2026-11-05T03:55Z in qnfo-audit: cf_agent_session_usage 2 sessions, both done with tokens and cost (probe of 1000805 needs 10); cf_agent_approvals 0 rows (probe of 1000653 needs a staged_action executed after a restart); cf_agent_sandbox_log 0 rows (probe of 1000806 needs one session with plan_approved, claim, edit and pr). The remainder is use, not code: the console takes the owner sign-in (an e-mailed code, IDENTITY-BOUND), and a probe row written by a harness that is not a real task would be gaming the probe, so none was written.'
WHERE id = 1696 AND item = 'RM-DURABLE-INTERRUPT-1' AND status = 'in_progress';
UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'docs/CODE-AGENT-CONSOLE.md; qnfo-agents 0.8.0 live (PR 7376 CodeSession with a per-session neuron budget; PR 7567 console follows a continued run; PR 7356 open). Read 2026-11-05T03:55Z: cf_agent_session_usage holds 2 done sessions with tokens and cost against the 10 that the probe of agent_issues 1000805 needs. The remainder is authenticated use of the console at /cmd (owner sign-in, IDENTITY-BOUND), not code.'
WHERE id = 1806 AND item = 'RM-CODE-SESSION-1' AND status = 'in_progress';
UPDATE roadmap_implementation SET status = 'partial', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'docs/CODE-AGENT-CONSOLE.md; qnfo-agents 0.8.0 live with the plan and claim gate (PR 7376). Read 2026-11-05T03:55Z: cf_agent_sandbox_log has 0 rows; the probe of agent_issues 1000806 needs one session with plan_approved, claim, edit and pr rows. The remainder is an authenticated code session through the console (owner sign-in, IDENTITY-BOUND), not code.'
WHERE id = 1807 AND item = 'RM-CODE-SANDBOX-1' AND status = 'in_progress';

-- 1802, 1808: the owner handed the account steps back to the fleet; the fleet cannot create an account or consent in the owner's name.
UPDATE roadmap_implementation SET evidence = evidence || ' | W2-C 2026-11-05: the owner handed card 223 composio-account-1 back from the dashboard (agent_issues 1001915, open); composio_status answers unavailable until COMPOSIO_API_KEY, a dedicated COMPOSIO_USER_ID and an ACTIVE connected account exist. Red-teamed (blocker_redteam card:223): creating the Composio account and consenting to a toolkit is an account creation and consent in the owner''s name, which no fleet surface may do; the code side is complete, the closing probe is remediation_contracts issue-1000794.'
WHERE id = 1802 AND item = 'RM-COMPOSIO-BRIDGE-1' AND evidence NOT LIKE '%W2-C 2026-11-05%';
UPDATE roadmap_implementation SET evidence = evidence || ' | W2-C 2026-11-05: the owner handed card 224 oauth-broker-clients-1 back from the dashboard (agent_issues 1001914, open). Red-teamed (blocker_redteam card:224): an OAuth client id and secret is minted in the owner''s own Google Cloud, GitHub or Slack account and every consent screen is the owner''s; GitHub documents no REST call that creates an OAuth app, and no repository or Cloudflare credential reaches a Google Cloud or Slack workspace. The broker stays live and fail-closed; the closing probe is remediation_contracts issue-1000807.'
WHERE id = 1808 AND item = 'RM-OAUTH-BROKER-1' AND evidence NOT LIKE '%W2-C 2026-11-05%';

-- 1683, 1693: the 20-task measurements.
UPDATE roadmap_implementation SET evidence = evidence || ' | W2-C 2026-11-05: ops-surface-size has 0 rows in cloud_ops_events (qnfo-ops 2.63.0 merged 2026-11-04T23:58Z, 2.64.0 live); the measurement needs a model-driven client that holds the ops key, which no loop or session in reach has, so the 20-task section of docs/CODEMODE-EVAL.md stays unwritten and the pair stays opt-in.'
WHERE id = 1683 AND item = 'RM-CODEMODE-MCP-SURFACE-1' AND evidence NOT LIKE '%W2-C 2026-11-05%';
UPDATE roadmap_implementation SET evidence = evidence || ' | W2-C 2026-11-05: ops_run_events holds 0 rows and 0 runs since the appender fix (the last ops job in ops_jobs is 2026-10-31, so no loop that owns a run id has run since qnfo-ops 2.63.0 deployed); the sample is gated by traffic, not by code. The 20-long-task result needs 20 runs of at least 10 tool calls; the probe is the heading Result on 20 long tasks in docs/TRACE-FOLD-EVAL.md.'
WHERE id = 1693 AND item = 'RM-TRACE-FOLD-1' AND evidence NOT LIKE '%W2-C 2026-11-05%';

-- Doer 1: nothing calls the Auto Router shadow evaluation.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'AUTOROUTER-SHADOW-SCHEDULE-1: nothing calls the Auto Router shadow evaluation, so RM-AUTOROUTER-EVAL-1 has no result',
 'Charter pillar: cost. Doer: qnfo-ai-calibration via qnfo-code-orchestrator. Roadmap row 1695, parent agent_issues 1000652. qnfo-ai POST /internal/eval/autorouter-shadow (autoRouterShadowRun) is deployed and replays up to 5 logged prompts of the last 7 days through cloudflare/auto, recording the selected model, latency, cost delta against the logged baseline and an exact-match flag as cloud_ops_events kind autorouter-shadow. Read 2026-11-05: 0 such rows. The route takes the router key or a trusted service-binding caller, and qnfo-ai-calibration already holds a QNFO_AI binding with props caller qnfo-ai-calibration (wrangler.toml), so it needs no secret. Lever: once a day (a key in ai_calibration_config, the way gw_sweep_last_ts is kept) from the calibration entry point, POST {confirm: true, limit: 3} through env.QNFO_AI, record the answer in the tick result, never fail the tick, and skip when ai_calibration_config autorouter_shadow is off; add an offline test with a fake binding. Mark the change with a comment containing AUTOROUTER-SHADOW-SCHEDULE-1. Done: at least 9 autorouter-shadow rows in cloud_ops_events from three consecutive days, each with status ok or skipped_budget, and a one-paragraph reading of cost_delta_usd and selected_model against the ladder in docs/AUTOROUTER-EVAL.md written from the rows, not from the plan.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js' || char(10) ||
 'code-anchor: async function calibration(env, trigger) {',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'AUTOROUTER-SHADOW-SCHEDULE-1:%' AND status = 'open');

-- Doer 2: the claims ledger writer has not run on a real paper.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ATOMIC-CLAIMS-LIVE-1: the atomic claims ledger has not written a row, so claim_coverage is still a carried value',
 'Charter pillar: research. Owner: the research pipeline (qnfo-research-exec publishStageV2, the */10 cron), reviewed by the code loop if it fails. Roadmap row 1702, parent agent_issues 1000664 (closed on a probe that passed on the carried value). PR 7419 (research-exec 0.51.0, live as 0.53.0 on 2026-11-05) writes one atomic row per reader-facing prose sentence of a published paper into paper_claims (claim_kind atomic) after the queue row is marked published. Read 2026-11-05T03:55Z: paper_claims has 148 rows, all claim_kind reference, 0 atomic; the newest research_queue.published_at is 2026-11-04T21:11:40Z, before the deploy, so the writer has not run on a real paper; claim_coverage carries 1 from 2026-11-03T09:11Z. Next step: the next paper that publishes writes its rows. If a paper has published since this issue and paper_claims still has 0 atomic rows, the writer fails silently on the real path (best effort by design): read the publish stage log for that slug (Workers Observability, qnfo-research-exec, where the write is caught), fix the cause in qnfo-research-exec/worker.js and add the failing case to qnfo-research-exec/atomic-claims-verify.test.mjs. Done: at least 10 atomic rows for at least 1 slug, and claim_coverage refreshed by its collector from them (last_refreshed after the first atomic row).',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ATOMIC-CLAIMS-LIVE-1:%' AND status = 'open');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''9'' AS expected, CAST(MIN(9, (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''autorouter-shadow'' AND status IN (''ok'', ''skipped_budget'') AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-4 days''))) AS TEXT) AS observed',
    verify_transport = 'd1-query', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 24, module = 'autorouter-shadow-schedule',
    precondition = 'AUTOROUTER-SHADOW-SCHEDULE-1: the shadow evaluation route exists and no loop calls it',
    action = 'the code loop makes the qnfo-ai-calibration tick post the daily shadow evaluation; the rows are the evidence'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'AUTOROUTER-SHADOW-SCHEDULE-1:%' AND status = 'open' ORDER BY id DESC LIMIT 1);

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''10'' AS expected, CAST(MIN(10, (SELECT COUNT(*) FROM paper_claims WHERE claim_kind = ''atomic'')) AS TEXT) AS observed',
    verify_transport = 'd1-query', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 6, module = 'atomic-claims-live',
    precondition = 'ATOMIC-CLAIMS-LIVE-1: the atomic claims writer is deployed and no paper has published since',
    action = 'the research pipeline publishes the next paper; its atomic rows are the evidence'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ATOMIC-CLAIMS-LIVE-1:%' AND status = 'open' ORDER BY id DESC LIMIT 1);

-- Red-team records for the two owner hand-backs (OWNER-NO-LOOSE-ENDS-1: a blocker claim carries its attempt).
INSERT INTO blocker_redteam (target, claim, attempt, verdict, evidence, actor, ts)
SELECT 'card:223', 'Composio needs an account and project API key that only the owner can create', 'read card 223 and the handback issue 1001915; read composio_status behaviour (fails closed without COMPOSIO_API_KEY, COMPOSIO_USER_ID and an ACTIVE connected account); looked for a surface that holds or can mint the key',
  'confirmed-with-evidence', 'IDENTITY-BOUND: creating the Composio account and the toolkit consent is an account creation and a consent in the owner''s name; the owner handing the card back from the dashboard does not move that into the fleet. No secret store, repository token or Cloudflare credential holds a Composio key. surfaces: D1 human_actions and gate view, issue 1001915, qnfo-ops composio-tools.test.mjs, secret lock inventory (no COMPOSIO_* secret)',
  'W2-C', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM blocker_redteam WHERE target = 'card:223' AND actor = 'W2-C');
INSERT INTO blocker_redteam (target, claim, attempt, verdict, evidence, actor, ts)
SELECT 'card:224', 'The OAuth broker needs client ids and secrets minted in the owner''s Google Cloud, GitHub and Slack accounts', 'read card 224 and the handback issue 1001914; read the live broker (callback 400 invalid state, authorize 401 without a key on 2026-11-05); looked for a fleet-held OAuth app',
  'confirmed-with-evidence', 'IDENTITY-BOUND: an OAuth client is registered in the owner''s own provider account and each consent screen is the owner''s; GitHub documents no REST call that creates an OAuth app, and no repository or Cloudflare credential reaches a Google Cloud project or a Slack workspace. The broker is built, live and fail-closed. surfaces: D1 human_actions and gate view, issue 1001914, ops.qnfo.org/oauth routes, secret lock inventory (no OAUTH_* client secret)',
  'W2-C', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM blocker_redteam WHERE target = 'card:224' AND actor = 'W2-C');

INSERT OR IGNORE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
VALUES ('ai-search-cost-meter', 'qnfo-infra 1.13.0 (AI-SEARCH-COST-1, PR 7655), migrations/2026-11-05-ai-search-cost-meters.sql', 'Cloudflare GraphQL aiSearch* datasets (CF_TOKEN already used by costVendorTick), qnfo-audit',
 'hourly :30 with the other cost datasets; detector fm-ai-search-meter-silent',
 strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
 'the AI Search line (queries, storage, ingestion) in cost_vendor_month and v_cost_lines_month before usage billing starts 2026-12-01');
