-- OWNER-AI-CONTROL-SLICE-1 (GitHub #6631; pillar security, cost and autonomy; program QNFO.OPS): the remaining work of the owner emergency AI control is filed as doers, one per distinct file, so prose is not the only record.
-- What is on main with this change: the authority (qnfo-deploy-guard 1.6.0 routes /ai-control*, the fleet_ai_control singleton with its append-only audit, the shared gate _shared/fleet-ai-control.js and its unit test, docs/AI-EMERGENCY-CONTROL.md).
-- What is not: any caller of the gate. The full integration exists as commit 47dfafe4 (archived at refs/archive/rwnq8-fleet-ai-stop-enforcement in QNFO/qnfo-workers, 230 files, 22 callers); it is ported one worker at a time.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed', close_channel = 'rollback:OWNER-AI-CONTROL' WHERE title LIKE 'OWNER-AI-CONTROL-%' AND status = 'open';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'OWNER-AI-CONTROL-2: the qnfo-ai router consults the owner pause authority before every dispatch',
 'code-task: repo=qnfo-workers path=qnfo-ai/worker.js' || char(10) ||
 'code-anchor: async function aiRunAttr(env, worker, purpose, model, input, opts) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-ai/worker.js"], "contains": "fleetAiGuard"}' || char(10) ||
 'Charter pillars: security, cost, autonomy (program QNFO.OPS; GitHub QNFO/qnfo-workers#6631). Metric it should move: fleet AI callers covered by the owner pause authority, 0 of 24 Workers to at least 1, then the rest (OWNER-AI-CONTROL-3 and one pull request per worker). Port, do not redesign: the router part of commit 47dfafe4 (git show 47dfafe4 -- qnfo-ai/worker.js, 166 insertions) inlines _shared/fleet-ai-control.js (scripts/fleet-ai-control-sync.mjs in that commit does the inlining) and makes aiRunAttr, the attribution proxy, the gateway tool entry and the Gateway HTTP transport open their own withSession("first-primary") read of qnfo-audit.fleet_ai_control before each dispatch, refuse on paused, missing or unreadable state, and never fall back to a billable model on a pause error. Constraints: the authority (qnfo-deploy-guard 1.6.0) is on main; the callers read the same D1 singleton, they do not call deploy-guard; the change switches no pause on; keep deployed-current.worker.js identical; bump VERSION by a minor; carry the qnfo-ai part of that commit''s dispatch test.',
 'session:G-owner-security', 'security', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'OWNER-AI-CONTROL-2:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'OWNER-AI-CONTROL-3: qnfo-research-exec, the largest Workers AI spender, consults the owner pause authority (qnfo-ops follows in its own pull request)',
 'code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js' || char(10) ||
 'code-anchor: async function aiText(env, model, prompt, maxTokens, effort) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-research-exec/worker.js"], "contains": "fleetAiGuard"}' || char(10) ||
 'Charter pillars: security, cost, autonomy (program QNFO.OPS; GitHub QNFO/qnfo-workers#6631). qnfo-research-exec took about 3.9M of the fleet''s neurons in the 7 days to 2026-11-04 and was held by other work claims when the first build was made, so commit 47dfafe4 has no patch for it; qnfo-ops (the model and agent-tool dispatcher) is in the same position and is a separate pull request under its own claim (path qnfo-ops/worker.js). Do the same as OWNER-AI-CONTROL-2 in this file: inline _shared/fleet-ai-control.js and make aiText (every research call goes through it, and so do the ensemble, review and revise stages) and the other env.AI.run and gateway fetch sites open their own first-primary read of qnfo-audit.fleet_ai_control before each dispatch; paused and unreadable state are terminal for model fallback; queue and workflow work is parked pending, with no retry storm and no bulk replay when the pause lifts. Use python scripts/worker_outline.py qnfo-research-exec --show aiText and --find "env.AI.run(" to find the sites; never read the 1.6 MB file whole.',
 'session:G-owner-security', 'security', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'OWNER-AI-CONTROL-3:%' AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'the authority half of the owner AI pause can land alone and safely: it changes no dispatch, fails closed, and its owner routes answer 503 until an OTP-only Access application is pinned',
       'OWNER-AI-CONTROL-SLICE-1: land the deploy-guard authority, the migration, the shared gate and the doc; file the router and the research callers as doers',
       'commit 47dfafe4 (230 files, 22 callers) was never published; its authority tests pass on main after the rebase: node qnfo-deploy-guard/ai-control.test.mjs 11 passed, the shared gate suite passed, the 12 other deploy-guard suites pass',
       'qnfo-deploy-guard 1.6.0 serves /ai-control* after the canonical deploy; no dispatch is affected',
       'qnfo-deploy-guard (control plane) gains routes, qnfo-audit gains two tables and five triggers; nothing else reads them yet',
       'Revert qnfo-deploy-guard through the canonical path; drop the fleet_ai_control tables and triggers named in the header of migrations/2026-11-03-owner-ai-control.sql',
       'a revisioned, audited, owner-authenticated pause authority exists for the fleet to call',
       'GET /ai-control answers 503 owner_auth_unavailable (config unset) and /health lists owner-ai-control after the deploy; the two doers are picked up by the code loop',
       'no external reach change',
       'offline suites; the Access OTP-only application and its three variables are an owner-account step, not made here'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'OWNER-AI-CONTROL-SLICE-1: land%');
