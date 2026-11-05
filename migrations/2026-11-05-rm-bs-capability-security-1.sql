-- RM-BS-CAPABILITY-SECURITY-1 slice 1 (blue-sky roadmap B9, rows 3265 and CF-B-07/CF-B-08/AGT-18; charter pillar security; W2-J 2026-11-05).
-- WHAT  (1) mcp_front_door_inventory: every MCP front door of the fleet with what a tokenless caller gets, the credential kinds it accepts, whether it can narrow a token,
--           and where calls are audited. Values were READ LIVE on 2026-11-05 03:40Z (curl: POST /mcp tools/list and GET /mcp/sse without a token; /health of each worker).
--       (2) capability_static_token_baseline: the count the roadmap predicts will fall to zero (x-loop-token in worker.js, per worker; the shared Bearer secrets qnfo-tools-mcp holds).
--       (3) ops_config capability_token_policy_v1: the attenuation rules as executable configuration. qnfo-tools-mcp 1.5.0 implements them (POST /mcp/attenuate, qcap1 HMAC-chain tokens,
--           caveats t=tool allowlist, x=expiry, w=0 read-only, k=task tag; nothing can widen; no new secret).
--       (4) failure mode mcp-front-door-open with three runner-https detectors (a tokenless request to a front door must answer 401) and one deploy detector (qnfo-tools-mcp >= 1.5.0 live).
--       (5) next slices as agent_issues rows with a doer and a closing probe: qnfo-memory-mcp accepts the same tokens; a read-only Cloudflare MCP-portal audit in cf-ops-actions.
-- WHY   the roadmap asks for no static shared token on an internal route and every tool call allowlisted and audited; the inventory shows qnfo-tools-mcp and qnfo-memory-mcp each gate on
--       one write secret and one read secret with no per-task narrowing, so a sandbox or subagent that needs one tool holds the credential for all of them.
-- PREDICTION: after the qnfo-tools-mcp deploy, a token minted with {tools:[x], ttl_s:600} lists and calls only x and stops working at its expiry (offline proof: qnfo-tools-mcp/capability-token.test.mjs, 13 checks);
--             static tokens held by a sandbox on this surface fall from 2 to 0 once a caller switches to minted tokens; mcp_log gains rows whose session column starts with cap:. Guard: the three 401 probes keep passing.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TABLE IF EXISTS mcp_front_door_inventory; DROP TABLE IF EXISTS capability_static_token_baseline; DELETE FROM ops_config WHERE key = 'capability_token_policy_v1'; UPDATE remediation_contracts SET status = 'superseded' WHERE class IN ('fm-mcp-front-door-open', 'fm-mcp-front-door-open-memory', 'fm-mcp-front-door-open-ops', 'fm-capability-tokens-live'); UPDATE failure_modes SET detector = 'retired by rollback of RM-BS-CAPABILITY-SECURITY-1' WHERE fm_key = 'mcp-front-door-open'
-- CAUSE-MAPPED: registers no metric_registry row; the detectors are a failure_modes row with remediation contracts.
-- spof-review: adds no worker, cron, D1 trigger, route or credential in this file; the route is in qnfo-tools-mcp 1.5.0.

CREATE TABLE IF NOT EXISTS mcp_front_door_inventory (
  surface TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  door_routes TEXT,
  auth TEXT,
  static_secrets INTEGER,
  unauth_http TEXT,
  tools_total INTEGER,
  write_tools INTEGER,
  tool_allowlist TEXT,
  capability_tokens INTEGER NOT NULL DEFAULT 0,
  audit_log TEXT,
  portal TEXT,
  observed_at TEXT NOT NULL,
  note TEXT
);

INSERT OR IGNORE INTO mcp_front_door_inventory (surface, host, door_routes, auth, static_secrets, unauth_http, tools_total, write_tools, tool_allowlist, capability_tokens, audit_log, portal, observed_at, note) VALUES
 ('qnfo-tools-mcp', 'qnfo-tools-mcp.q08.workers.dev', '/mcp, /mcp/sse, /mcp/messages, /mcp/attenuate', 'bearer MCP_TOKEN (write) or MCP_READ_TOKEN (read), ?token=, or a qcap1 capability token (1.5.0)', 2,
  'POST /mcp 401 unauthorized; GET /mcp/sse 401 unauthorized', 18, 5, 'per capability token: the t caveat limits tools/list and tools/call', 1, 'qnfo-audit.mcp_log (tool, redacted args, result, session; cap:<id>:<task> for capability tokens)', 'none (workers.dev host)', '2026-11-05T03:40:00Z',
  'WRITE_TOOLS are email_respond, email_mark, express_desire, owner_code, owner_act. Upstream calls use INTENT_TOKEN, INFRA_TOKEN, REGISTRY_TOKEN, EMAIL_API_KEY and RT as static Bearer secrets (internal, not given to clients).'),
 ('qnfo-memory-mcp', 'qnfo-memory-mcp.q08.workers.dev', '/mcp, /mcp/sse, /mcp/messages, /fleet-graph/* (open read-only, OPEN-ACCESS-1)', 'bearer MCP_TOKEN (write) or MCP_READ_TOKEN (read), ?token=', 2,
  'GET / 401 unauthorized; POST /mcp 401; GET /mcp/sse 401', NULL, NULL, 'none: scope is read or write only', 0, 'qnfo-graph.mcp_log', 'none (workers.dev host)', '2026-11-05T03:40:00Z',
  '/health lists no tool count by design (the list is served to authenticated clients only). Next slice: accept qcap1 tokens (agent_issues W2-J-CAP-2).'),
 ('qnfo-ops', 'ops.qnfo.org', '/mcp (the ops tool surface is also reached through /v1/chat tool calls)', 'owner session token (e-mailed code via /v1/owner/login) or API key', NULL,
  'GET /mcp 401; POST /mcp 401 with a message naming the e-mailed-code login', NULL, NULL, 'none per token: the ops model chooses its tools', 0, 'not read in this slice', 'none', '2026-11-05T03:40:00Z',
  'Control-plane host, claim-locked often: the front-door work for qnfo-ops (a Cloudflare MCP-portal in front, Access as the OAuth provider) needs a Cloudflare Zero Trust read first (agent_issues W2-J-CAP-3).'),
 ('personal-api', 'personal.qnfo.org', '/mcp (TWIN-MCP-1)', 'API_KEY bearer', 1,
  'POST /mcp 401', NULL, NULL, 'none: the twin tool registry', 0, 'not read in this slice', 'none, and never one shared with the research plane', '2026-11-05T03:40:00Z',
  'Personal plane: any portal for it is separate from the research portal (personal/research separation). Not touched by this slice.');

CREATE TABLE IF NOT EXISTS capability_static_token_baseline (
  worker TEXT NOT NULL,
  token_kind TEXT NOT NULL,
  occurrences INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (worker, token_kind)
);

INSERT OR IGNORE INTO capability_static_token_baseline (worker, token_kind, occurrences, read_at, note) VALUES
 ('qnfo-fleet-dashboard', 'x-loop-token', 24, '2026-11-05T03:40:00Z', 'string occurrences in worker.js (ripgrep count); the routes behind it take the loop token for changes to the fleet (OPEN-ACCESS-1 exceptions)'),
 ('q08-signal-engine', 'x-loop-token', 8, '2026-11-05T03:40:00Z', 'string occurrences in worker.js'),
 ('qnfo-jobsearch', 'x-loop-token', 4, '2026-11-05T03:40:00Z', 'string occurrences in worker.js'),
 ('qnfo-evolve', 'x-loop-token', 3, '2026-11-05T03:40:00Z', 'string occurrences in worker.js'),
 ('qnfo-ai-calibration', 'x-loop-token', 3, '2026-11-05T03:40:00Z', 'string occurrences in worker.js'),
 ('qnfo-tools-mcp', 'static-bearer-secret', 7, '2026-11-05T03:40:00Z', 'MCP_TOKEN, MCP_READ_TOKEN (client-facing); INTENT_TOKEN, INFRA_TOKEN, REGISTRY_TOKEN, EMAIL_API_KEY, RT (upstream, internal)'),
 ('qnfo-memory-mcp', 'static-bearer-secret', 2, '2026-11-05T03:40:00Z', 'MCP_TOKEN, MCP_READ_TOKEN (client-facing)');

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES ('capability_token_policy_v1',
 '{"version":1,"scheme":"qcap1 HMAC chain (macaroon style), sig0 = HMAC(root secret, qcap1|id), sig(n) = HMAC(sig(n-1), caveat n)","roots":{"w":"MCP_TOKEN (write)","r":"MCP_READ_TOKEN (read)"},"caveats":{"t":"tool allowlist (intersection when repeated)","x":"expiry, epoch seconds (earliest wins)","w":"0 = read-only","k":"task tag written to the audit session column"},"max_ttl_s":86400,"default_ttl_s":3600,"max_caveats":16,"mint":"POST /mcp/attenuate","rules":["a child can only add caveats; removing one needs the root secret","an unknown caveat, a bad chain, a missing root or an expired token fails closed (401)","a token derived from the read root is read-only whatever else it carries","every call by a capability token is audited as cap:<id>:<task>"],"enforced_by":["qnfo-tools-mcp>=1.5.0"],"next":["qnfo-memory-mcp","qnfo-ops via a Cloudflare MCP portal"],"open_access_note":"public reads (OPEN-ACCESS-1) stay tokenless; this policy covers MCP tool calls and routes that change the fleet"}',
 'RM-BS-CAPABILITY-SECURITY-1 slice 1 (W2-J 2026-11-05): attenuating task tokens; proof qnfo-tools-mcp/capability-token.test.mjs; revert by deleting the key (the static tokens never stopped working)');

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('mcp-front-door-open', 'an MCP front door answers a request that carries no token, or a worker that should accept task tokens no longer does',
  'each MCP worker gates on one or two static secrets in its own fetch handler; a refactor that moves the auth check after route matching, or a deploy that drops the secret binding, fails open (qnfo-memory-mcp fails closed with 503 when no token is configured, which is the pattern)',
  'restore the 401 gate in the worker (scopeFor/resolveScope before any JSON-RPC handling) and redeploy through the canonical path; DEPLOY-PROBES-1 in qnfo-tools-mcp/probes.json reverts a push that opens it',
  'fm-mcp-front-door-open (tools-mcp), fm-mcp-front-door-open-memory, fm-mcp-front-door-open-ops: a tokenless request must answer 401; fm-capability-tokens-live reads qnfo-tools-mcp /health for version 1.5.0 or later',
  'fm-mcp-front-door-open', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'a tokenless GET /mcp/sse (tools-mcp, memory-mcp) or GET /mcp (ops) answers anything other than 401',
  'an unauthenticated caller can list or call fleet tools, including the e-mail and owner-card write tools',
  'e-mail send, owner queue actions, memory writes');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at) VALUES
 ('fm-mcp-front-door-open', NULL, 'RM-BS-CAPABILITY-SECURITY-1', 'failure-mode detector: qnfo-tools-mcp tokenless request',
  '{"url": "https://qnfo-tools-mcp.q08.workers.dev/mcp/sse", "status": 401, "contains": "unauthorized"}', 'runner-https', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now')),
 ('fm-mcp-front-door-open-memory', NULL, 'RM-BS-CAPABILITY-SECURITY-1', 'failure-mode detector: qnfo-memory-mcp tokenless request',
  '{"url": "https://qnfo-memory-mcp.q08.workers.dev/mcp/sse", "status": 401, "contains": "unauthorized"}', 'runner-https', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now')),
 ('fm-mcp-front-door-open-ops', NULL, 'RM-BS-CAPABILITY-SECURITY-1', 'failure-mode detector: qnfo-ops tokenless request',
  '{"url": "https://ops.qnfo.org/mcp", "status": 401}', 'runner-https', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now')),
 ('fm-capability-tokens-live', NULL, 'RM-BS-CAPABILITY-SECURITY-1', 'qnfo-tools-mcp 1.5.0 or later serves the capability-token mint route',
  '{"url": "https://qnfo-tools-mcp.q08.workers.dev/health", "status": 200, "contains": "\"worker\":\"qnfo-tools-mcp\"", "min_version": "1.5.0"}', 'runner-https', 24, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS W2-J-CAP-2: qnfo-memory-mcp accepts qcap1 capability tokens (same scheme as qnfo-tools-mcp 1.5.0)',
 'code-task: repo=qnfo-workers path=qnfo-memory-mcp/worker.js' || char(10) ||
 'code-anchor: function scopeFor(token, env) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-memory-mcp/worker.js"], "contains": "qcap1."}' || char(10) || char(10) ||
 'Charter pillar security (program QNFO.OPS); roadmap row RM-BS-CAPABILITY-SECURITY-1 (3265), blue-sky B9, AGT-18. Metric it should move: capability_static_token_baseline for qnfo-memory-mcp (2 client-facing static secrets) stops being the only way to reach memory tools; mcp_log rows with session cap:*.' || char(10) ||
 'DO: copy the CAP-TOKEN-1 block of qnfo-tools-mcp/worker.js (capB64u ... capMint, resolveScope; keep caveats t, x, w, k and the 16-caveat limit identical, the policy is ops_config capability_token_policy_v1) into qnfo-memory-mcp, make scopeFor async-aware (resolveScope) at the /mcp, /mcp/sse and /mcp/messages doors, filter tools/list and tools/call by the t caveat, add POST /mcp/attenuate, record cap:<id>:<task> in its mcp_log session column, and port qnfo-tools-mcp/capability-token.test.mjs (13 checks). Write tools there (remember_fact, exuvia_publish_paper) need the write root: a read-root child stays read-only. Bump with scripts/worker_release.py --minor; impact on the worker first.' || char(10) ||
 'Definition of done: merged and verified live: a token minted at POST https://qnfo-memory-mcp.q08.workers.dev/mcp/attenuate with {"tools":["search_memories"],"ttl_s":600} lists exactly that tool; a call to remember_fact with it answers -32003; the fm-mcp-front-door-open-memory contract still reads 401; recorded in issue_triage.close_evidence.',
 'session:w2-j', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS W2-J-CAP-2%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS W2-J-CAP-3: cf-ops-actions mcp-portals (read): can the repository Cloudflare token list Zero Trust MCP server portals and Access apps for the front doors',
 'code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py' || char(10) ||
 'code-anchor: def main() -> int:' || char(10) ||
 'code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "mcp-portals"}' || char(10) || char(10) ||
 'Charter pillar security (program QNFO.OPS); roadmap row RM-BS-CAPABILITY-SECURITY-1 (3265), blue-sky B9 (CF-B-07 governed MCP front door, CF-B-08 Access for Workers). Blocker to test, not to assume: the owner said no new Cloudflare token will be issued, so the first step is a READ with the token in place, recorded in blocker_redteam.' || char(10) ||
 'DO: add an allowlisted read-only action mcp-portals to scripts/cf_ops_actions.py (its test file already pins the action list: extend it) that calls the Cloudflare API for Zero Trust MCP server portals and Access applications and prints the HTTP status and the names found (never a secret); run it through cf-ops-actions.yml workflow_dispatch; write the result and the refusal text, if any, to blocker_redteam with a surfaces: line. If the token may write portals, file the portal-in-front-of-qnfo-ops change as the next code task; if it may not, the portal setup is an IDENTITY-BOUND human_actions card (owner account, Zero Trust dashboard) with a probe that closes it when the portal answers.' || char(10) ||
 'Definition of done: the action ran from the runner, its output is quoted on this issue, blocker_redteam has the row, and either the next task or the IDENTITY-BOUND card exists; recorded in issue_triage.close_evidence.',
 'session:w2-j', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS W2-J-CAP-3%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2-j (blue-sky B9)',
  'a sandbox or subagent that needs one MCP tool should not hold the credential for all of them; attenuation by HMAC chain needs no new secret and no Cloudflare permission',
  'RM-BS-CAPABILITY-SECURITY-1 slice 1: qnfo-tools-mcp 1.5.0 POST /mcp/attenuate, front-door inventory, static-token baseline, capability_token_policy_v1, four detectors, two follow-up issues',
  'live reads 2026-11-05: tokenless POST /mcp 401 on tools-mcp, memory-mcp, ops and personal-api; x-loop-token appears in 5 worker.js files (42 occurrences); node qnfo-tools-mcp/capability-token.test.mjs 13 passed, 0 failed',
  'migration plus qnfo-tools-mcp 1.5.0', 'one worker route, two tables, one ops_config key, one failure mode, four contracts, two issues',
  'the Rollback header of migrations/2026-11-05-rm-bs-capability-security-1.sql; redeploy qnfo-tools-mcp 1.4.0 (the static tokens never changed)',
  'task-scoped, expiring, audited MCP credentials derived without the root secret',
  'tokens held by a sandbox on qnfo-tools-mcp fall from 2 static secrets to 0 once a caller mints; mcp_log rows with session cap:* appear', 'none', 'node:sqlite offline suite, curl of four front doors'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-BS-CAPABILITY-SECURITY-1 slice 1:%');
