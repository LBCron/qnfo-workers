-- OPS-RM-SLICES-1 (2026-11-05, session C-ops-tools-F1; charter pillars autonomy, security, cost, reach; programs QNFO.OPS and QNFO.INFRA). Companion of qnfo-ops 2.63.0 for the five qnfo-ops roadmap items
-- RM-TRACE-FOLD-1 (agent_issues 1000650), RM-POLICY-SMT-GATE-1 (1000649), RM-CODEMODE-MCP-SURFACE-1 (1000639), RM-COMPOSIO-BRIDGE-1 (1000794) and RM-OAUTH-BROKER-1 (1000807).
-- WHAT WAS MEASURED (2026-11-05): ops_run_events had 0 rows (the appender read the run id from model arguments and omitted the NOT NULL seq column); cloud_ops_events had 0 ops-surface-size rows (the logger
-- inserted a nonexistent size column); 0 policy-gate-shadow rows because no call of the three classes happened since 2026-09-01 except 15 ops_d1_write calls on 2026-10-29; the composio and OAuth broker code is
-- deployed (GET https://ops.qnfo.org/oauth/callback answers 400 invalid or expired OAuth state, POST /oauth/authorize answers 401 without a key) but the contracts of 1000794 and 1000807 could never pass: 1000794 compared a
-- fixed text with a string made of counts, 1000807 looked for a worker named like oauth/broker with a cron and a table named like %oauth%token%, while the broker lives inside qnfo-ops (cron every 30 minutes,
-- table oauth_broker_records).
-- WHAT THIS DOES: replaces each contract probe with one that measures the issue's real Done (1000639 and 1000650: the doc heading that records the 20-task result; 1000649: the replay result heading;
-- 1000794 and 1000807: a live call through the bridge or broker), registers the capabilities and tools, files the two IDENTITY-BOUND owner cards the live reads wait on, files the remainder as ROADMAP-1 rows
-- with a doer, and marks the roadmap mirrors partial with their evidence. No issue is closed here.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_ops_rm_contracts
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_ops_rm_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_ops_rm_contracts b WHERE b.class = remediation_contracts.class), last_verdict = NULL WHERE class IN (SELECT class FROM bak_20261105_ops_rm_contracts); UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_ops_rm_roadmap b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_ops_rm_roadmap b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_ops_rm_roadmap); UPDATE agent_issues SET status = 'closed' WHERE instr(title, 'ROADMAP-1: QNFO.OPS RM-CODEMODE-MCP-SURFACE-1.2:') = 1 OR instr(title, 'ROADMAP-1: QNFO.OPS RM-TRACE-FOLD-1.2:') = 1 OR instr(title, 'ROADMAP-1: QNFO.OPS RM-POLICY-SMT-GATE-1.2:') = 1; UPDATE human_actions SET status = 'dismissed' WHERE slug IN ('composio-account-1', 'oauth-broker-clients-1'); UPDATE agent_tool_allowlist SET enabled = 0 WHERE surface = 'qnfo-ops' AND pattern IN ('composio_execute', 'composio_status');

CREATE TABLE IF NOT EXISTS bak_20261105_ops_rm_contracts AS SELECT class, verify_probe, verify_transport, last_verdict FROM remediation_contracts WHERE class IN ('issue-1000639', 'issue-1000649', 'issue-1000650', 'issue-1000794', 'issue-1000807');
CREATE TABLE IF NOT EXISTS bak_20261105_ops_rm_roadmap AS SELECT id, status, evidence FROM roadmap_implementation WHERE id IN (1683, 1692, 1693, 1802, 1808);

-- Closing probes that measure each issue's own Done. A marker probe would close an issue on the first edit, so the code-read probes name the heading that carries a MEASUREMENT.
UPDATE remediation_contracts
SET verify_probe = '{"paths": ["docs/CODEMODE-EVAL.md"], "contains": "## Result on 20 tasks"}', verify_transport = 'code-read', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000639' AND issue_id = 1000639;

UPDATE remediation_contracts
SET verify_probe = '{"paths": ["docs/TRACE-FOLD-EVAL.md"], "contains": "## Result on 20 long tasks"}', verify_transport = 'code-read', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000650' AND issue_id = 1000650;

UPDATE remediation_contracts
SET verify_probe = '{"paths": ["docs/POLICY-GATE-REPLAY.md"], "contains": "## Replay result"}', verify_transport = 'code-read', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000649' AND issue_id = 1000649;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''composio_execute answered ok at least once'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cloud_ops_events WHERE kind = ''ops_ai_tool'' AND text = ''composio_execute'' AND status = ''ok'') THEN ''composio_execute answered ok at least once'' ELSE ''no ok composio_execute call recorded - blocked on owner card composio-account-1 (COMPOSIO_API_KEY, COMPOSIO_USER_ID, one consented connected account)'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000794' AND issue_id = 1000794;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''a stored token record has served a call through the broker'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM oauth_broker_records WHERE record_type = ''token'' AND call_count > 0) THEN ''a stored token record has served a call through the broker'' ELSE ''no token record has served a call - blocked on owner card oauth-broker-clients-1 (OAuth client id and secret for Google, GitHub or Slack, then one consent)'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000807' AND issue_id = 1000807;

-- Roadmap mirrors: partial, with what exists.
UPDATE roadmap_implementation SET status = 'partial', evidence = COALESCE(evidence, '') || ' | OPS-RM-SLICES-1 (qnfo-ops 2.63.0): the opt-in code-mode MCP surface exists, its sizes are now logged (ops-surface-size), the pair left the default catalogue, scripts/codemode_surface_size.mjs measures the list at 1.34 percent of the default; the 20-task result is pending (docs/CODEMODE-EVAL.md)' WHERE id = 1683;
UPDATE roadmap_implementation SET status = 'partial', evidence = COALESCE(evidence, '') || ' | OPS-RM-SLICES-1 (qnfo-ops 2.63.0): shadow gate live since 2026-11-01; scripts/policy_gate_replay.mjs measured precision 0.9565 and recall 1.0 on a 50-case labelled corpus after fixing a D1 delete pattern miss (docs/POLICY-GATE-REPLAY.md); enforcement waits for real traffic' WHERE id = 1692;
UPDATE roadmap_implementation SET status = 'partial', evidence = COALESCE(evidence, '') || ' | OPS-RM-SLICES-1 (qnfo-ops 2.63.0): ops_run_events appender fixed (seq, loop run id), foldRunState and GET /v1/run-state shipped (docs/TRACE-FOLD-EVAL.md); the 20-long-task measurement is pending' WHERE id = 1693;
UPDATE roadmap_implementation SET status = 'partial', evidence = COALESCE(evidence, '') || ' | OPS-RM-SLICES-1: composio_execute and composio_status are in qnfo-ops (2.61.0, fail closed); registered in capability_ledger and agent_tool_allowlist; live use waits on owner card composio-account-1' WHERE id = 1802;
UPDATE roadmap_implementation SET status = 'partial', evidence = COALESCE(evidence, '') || ' | OPS-RM-SLICES-1: the OAuth broker is built into qnfo-ops (authorize, callback, provider reads, refresh on the 30-minute cron, table oauth_broker_records) and live (callback answers 400 invalid state, authorize 401 without a key on 2026-11-05); live use waits on owner card oauth-broker-clients-1' WHERE id = 1808;

-- Capabilities the fleet now has.
INSERT INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
SELECT 'composio bridge tools in qnfo-ops (composio_execute, composio_status)', 'RM-COMPOSIO-BRIDGE-1 (qnfo-ops 2.61.0, agent_issues 1000794)', 'COMPOSIO_API_KEY and COMPOSIO_USER_ID Worker secrets (owner card composio-account-1) and one consented connected account', 'fail closed: both tools answer unavailable until the secret, a non-personal user id and an ACTIVE account exist; qnfo-audit keeps action metadata only', '2026-11-01', NULL, 'qnfo-ops/worker.js composioExecute and composioStatus; qnfo-ops/composio-tools.test.mjs; docs/COMPOSIO-INTEGRATION.md section 3'
WHERE NOT EXISTS (SELECT 1 FROM capability_ledger WHERE capability = 'composio bridge tools in qnfo-ops (composio_execute, composio_status)');

INSERT INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
SELECT 'in-Worker OAuth broker for Google, GitHub and Slack (qnfo-ops)', 'RM-OAUTH-BROKER-1 (qnfo-ops/oauth-broker.mjs inlined as OAuthBroker, agent_issues 1000807)', 'OAUTH_<PROVIDER>_CLIENT_ID and _CLIENT_SECRET, OAUTH_BROKER_ENCRYPTION_KEY and OAUTH_BROKER_REDIRECT_URI Worker secrets (owner card oauth-broker-clients-1)', 'tokens encrypted at rest in oauth_broker_records, personal and research planes held apart, refresh under a lease on the 30-minute cron; qnfo-ops/oauth-broker.test.mjs', '2026-11-02', NULL, 'live 2026-11-05: GET https://ops.qnfo.org/oauth/callback answers 400 invalid or expired OAuth state; POST /oauth/authorize answers 401 without a key; migrations/2026-11-02-oauth-broker.sql'
WHERE NOT EXISTS (SELECT 1 FROM capability_ledger WHERE capability = 'in-Worker OAuth broker for Google, GitHub and Slack (qnfo-ops)');

INSERT INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
SELECT 'per-run tool event ledger and folded run state (qnfo-ops)', 'RM-TRACE-FOLD-1 (qnfo-ops 2.63.0, agent_issues 1000650, migrations/2026-10-28-cluster-e-b-doers.sql)', 'a run id: the job workflow job id or the agent DO conversation id', 'best effort: a ledger write failure never fails a tool call; arguments are hashed, never stored', '2026-11-05', NULL, 'qnfo-ops/trace-fold.test.mjs writes through the real ops_run_events DDL; GET /v1/run-state?run_id=<id>; docs/TRACE-FOLD-EVAL.md'
WHERE NOT EXISTS (SELECT 1 FROM capability_ledger WHERE capability = 'per-run tool event ledger and folded run state (qnfo-ops)');

INSERT INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
SELECT 'policy gate replay harness (precision and recall of the shadow gate)', 'RM-POLICY-SMT-GATE-1 (scripts/policy_gate_replay.mjs, agent_issues 1000649)', 'a labelled corpus (qnfo-ops/policy-gate-corpus.json) or exported cloud_ops_events rows', 'corpus measurement, not traffic: production holds almost no irreversible calls; recall 1.0, precision 0.9565 on 50 cases', '2026-11-05', NULL, 'qnfo-ops/policy-gate-replay.test.mjs; docs/POLICY-GATE-REPLAY.md'
WHERE NOT EXISTS (SELECT 1 FROM capability_ledger WHERE capability = 'policy gate replay harness (precision and recall of the shadow gate)');

-- The composio tools were never registered with the tool allow-list.
INSERT INTO agent_tool_allowlist (surface, kind, pattern, note)
SELECT 'qnfo-ops', 'tool', 'composio_execute', 'registered in qnfo-ops/worker.js (RM-COMPOSIO-BRIDGE-1, 2.61.0); fails closed without COMPOSIO_API_KEY and a non-personal COMPOSIO_USER_ID'
WHERE NOT EXISTS (SELECT 1 FROM agent_tool_allowlist WHERE surface = 'qnfo-ops' AND kind = 'tool' AND pattern = 'composio_execute');
INSERT INTO agent_tool_allowlist (surface, kind, pattern, note)
SELECT 'qnfo-ops', 'tool', 'composio_status', 'registered in qnfo-ops/worker.js (RM-COMPOSIO-BRIDGE-1, 2.61.0); read-only status of a connected account owned by the configured non-personal user'
WHERE NOT EXISTS (SELECT 1 FROM agent_tool_allowlist WHERE surface = 'qnfo-ops' AND kind = 'tool' AND pattern = 'composio_status');

-- The two steps only the owner can take, each with its default in effect and the contract that closes the issue when the step is done.
INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source)
VALUES ('composio-account-1',
  'Create the Composio account and project API key so qnfo-ops composio_execute can run (RM-COMPOSIO-BRIDGE-1)',
  'IDENTITY-BOUND: creating a Composio account and its API key is an account creation in the owner''s name, and every toolkit consent (Google, GitHub, Slack) is the owner''s own account. The bridge code is deployed (composio_execute and composio_status in qnfo-ops 2.61.0, qnfo-ops/composio-tools.test.mjs) and fails closed: without COMPOSIO_API_KEY, a dedicated non-personal COMPOSIO_USER_ID and an ACTIVE connected account both tools answer unavailable. Closing probe: remediation_contracts class issue-1000794 (an ok composio_execute call is recorded in cloud_ops_events kind ops_ai_tool).',
  'The fleet keeps its own direct Google and Outlook links and the in-Worker OAuth broker (card oauth-broker-clients-1). composio_execute and composio_status answer unavailable. Nothing else changes.',
  'Create a Composio project at composio.dev (free Hobby plan, 100,000 tool calls a month), copy the project API key, create a dedicated non-personal user id for the fleet (never the personal one), and connect one toolkit account (for example Google Calendar) through the consent link. Hand the key and the user id to the fleet through the owner secret hand-off; the fleet then stores COMPOSIO_API_KEY and COMPOSIO_USER_ID on qnfo-ops under the secret lock. Never paste the key into a chat, an issue or a file.',
  'normal', 'open', 'session:C-ops-tools-F1');

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source)
VALUES ('oauth-broker-clients-1',
  'Register OAuth apps for Google, GitHub and Slack so the qnfo-ops OAuth broker can hold tokens (RM-OAUTH-BROKER-1)',
  'IDENTITY-BOUND: an OAuth client id and secret is minted in the owner''s own Google Cloud, GitHub or Slack account, and each consent screen is the owner''s. The broker is built into qnfo-ops and live (POST /oauth/authorize, GET /oauth/callback, POST /oauth/google/calendar, /oauth/github/profile, /oauth/slack/profile; refreshOAuthBrokerTokens on the 30-minute cron; table oauth_broker_records): on 2026-11-05 GET https://ops.qnfo.org/oauth/callback answers 400 invalid or expired OAuth state and POST /oauth/authorize answers 401 without a key. Closing probe: remediation_contracts class issue-1000807 (a stored token record has served a call).',
  'The Today dashboard keeps its own calendar links and the broker answers that a provider is not configured. Nothing breaks.',
  'For each provider you want, register an OAuth app with the redirect URI https://ops.qnfo.org/oauth/callback (Google Cloud console with the calendar.events.readonly scope; GitHub Settings, Developer settings, OAuth Apps with read:user; Slack api.slack.com/apps with users:read) and hand its client id and secret to the fleet through the owner secret hand-off. The fleet stores OAUTH_<PROVIDER>_CLIENT_ID and OAUTH_<PROVIDER>_CLIENT_SECRET, mints OAUTH_BROKER_ENCRYPTION_KEY itself and sets OAUTH_BROKER_REDIRECT_URI, all under the secret lock. Then open the authorize link once per provider and consent. Never paste a client secret into a chat, an issue or a file.',
  'normal', 'open', 'session:C-ops-tools-F1');

-- Remainders, each with a doer (code-task and code-anchor) and the probe that closes it.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS RM-CODEMODE-MCP-SURFACE-1.2: run the 20-task before/after on both MCP surfaces and record "## Result on 20 tasks"',
 'code-task: repo=qnfo-workers path=scripts/codemode_surface_size.mjs' || char(10) ||
 'code-anchor: // Usage: node scripts/codemode_surface_size.mjs [--check] [--worker qnfo-ops/worker.js]' || char(10) ||
 'Charter pillar cost (program QNFO.OPS). Metric it should move: tokens per task of qnfo-ops MCP clients (docs/CODEMODE-EVAL.md). Serves RM-CODEMODE-MCP-SURFACE-1 (agent_issues 1000639, roadmap 1683).' || char(10) ||
 'Evidence (OPS-RM-SLICES-1): the opt-in surface and its size logging are in qnfo-ops 2.63.0; the static list is 548 characters against 40,866 (1.34 percent). What is missing is the live measurement on 20 tasks.' || char(10) ||
 'EDIT: add scripts/codemode_eval_run.mjs (a new file) with scripts/codemode-eval-tasks.json (20 fixed operator tasks, each with a deterministic success check on the final tool result). It runs each task twice through the same model from the router (model qnfo, ENSEMBLE-POLICY-1: no model judge), once against tools/list and once against tools/list?surface=codemode of https://ops.qnfo.org/mcp using a key from the runner environment (never a literal), sums the ops-surface-size rows of the run (chars and req_chars, divided by 4) plus the model turns, and prints a table. Run it from a workflow_dispatch runner, then write the table, the success counts and the decision (keep the pair only if tokens per task fall and success does not drop) under the heading "## Result on 20 tasks" in docs/CODEMODE-EVAL.md and remove the heading "## Pending: the 20-task result".' || char(10) ||
 'Definition of done: merged and verified live; the heading "## Result on 20 tasks" is in docs/CODEMODE-EVAL.md with 20 rows; record the before and after in issue_triage.close_evidence of 1000639.' || char(10) ||
 'code-probe: {"paths": ["docs/CODEMODE-EVAL.md"], "contains": "## Result on 20 tasks"}',
 'session:C-ops-tools-F1', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE instr(title, 'ROADMAP-1: QNFO.OPS RM-CODEMODE-MCP-SURFACE-1.2:') = 1 AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS RM-TRACE-FOLD-1.2: read the folded run state into the job loop and measure 20 long tasks',
 'code-task: repo=qnfo-workers path=qnfo-ops/worker.js' || char(10) ||
 'code-anchor: async function opsRunState(env, runId) {' || char(10) ||
 'Charter pillar autonomy (program QNFO.OPS). Metric it should move: tokens per task of long qnfo-ops jobs with no drop in task success. Serves RM-TRACE-FOLD-1 (agent_issues 1000650, roadmap 1693).' || char(10) ||
 'Evidence (OPS-RM-SLICES-1): ops_run_events had 0 rows before qnfo-ops 2.63.0 because the appender omitted the NOT NULL seq column and read the run id from model arguments; the job workflow and the agent DO now append one row per tool call and GET /v1/run-state folds a run (foldRunState). What is missing is the use of the fold and the measurement.' || char(10) ||
 'EDIT: in the job workflow loop, behind ops_config trace_fold_context (default off), replace the compacted transcript prefix of a run that has 10 or more ops_run_events rows with the folded state from opsRunState (tools used, error_count, last_error, open_items) plus the last two tool results, and log the prompt tokens of the round to ops_ai_log as today. Then run 20 long tasks with the key on and off, compare tokens per task (ops_ai_log by job_id) and the final job status, and write the table under the heading "## Result on 20 long tasks" in docs/TRACE-FOLD-EVAL.md. Keep the switch on only if tokens per task fall with no silent truncation and no drop in success; otherwise record why and leave it off.' || char(10) ||
 'Definition of done: merged and verified live; the heading "## Result on 20 long tasks" is in docs/TRACE-FOLD-EVAL.md; record the before and after in issue_triage.close_evidence of 1000650.' || char(10) ||
 'code-probe: {"paths": ["docs/TRACE-FOLD-EVAL.md"], "contains": "## Result on 20 long tasks"}',
 'session:C-ops-tools-F1', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE instr(title, 'ROADMAP-1: QNFO.OPS RM-TRACE-FOLD-1.2:') = 1 AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS RM-POLICY-SMT-GATE-1.2: replay the shadow gate on real calls, then enforce the three classes',
 'code-task: repo=qnfo-workers path=qnfo-ops/worker.js' || char(10) ||
 'code-anchor: async function policyGateShadow(env, name, args) {' || char(10) ||
 'Charter pillar security (program QNFO.OPS). Metric it should move: irreversible tool calls that execute while incomplete or unconfirmed (target 0). Serves RM-POLICY-SMT-GATE-1 (agent_issues 1000649, roadmap 1692); extends BP26-PROMPT-INJECTION-1 (1000359).' || char(10) ||
 'Evidence (OPS-RM-SLICES-1): the shadow gate has run since 2026-11-01 and wrote 0 rows because no call of the three classes happened; the replay harness measured precision 0.9565 and recall 1.0 on a 50-case corpus (docs/POLICY-GATE-REPLAY.md). A corpus written by the rule author does not show the calls nobody thought of, so enforcement needs real calls.' || char(10) ||
 'EDIT: when SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''policy-gate-shadow'' is at least 30, export those rows and the matching ops_ai_tool rows, run scripts/policy_gate_replay.mjs --events on them, append the result to docs/POLICY-GATE-REPLAY.md, and only if precision is at least 0.95 and recall at least 0.95 add ops_config policy_gate_mode = enforce to policyGateShadow so a would_block call in the three classes returns a refusal with the rule reason instead of dispatching (the current user-affirmation and confirm checks stay). Not before 30 real shadow rows exist; do not enforce on the corpus alone.' || char(10) ||
 'Definition of done: merged and verified live; docs/POLICY-GATE-REPLAY.md carries a replay on at least 30 real shadow rows; record the precision and recall in issue_triage.close_evidence of 1000649.',
 'session:C-ops-tools-F1', 'feature', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE instr(title, 'ROADMAP-1: QNFO.OPS RM-POLICY-SMT-GATE-1.2:') = 1 AND status = 'open');

INSERT INTO decision_log
  (actor,assumption,action,evidence,outcome,blast_radius,rollback_path,capability_gain,predicted_outcome,reach_gain,surfaces_tested)
SELECT 'session:C-ops-tools-F1',
  'the first steps of five qnfo-ops roadmap items were shipped by the code loop but never produced the rows their probes read, and two contracts could never pass',
  'OPS-RM-SLICES-1: fix the ops_run_events appender and the ops-surface-size logger, take the code-mode pair out of the default catalogue, add a gate replay harness, replace five contract probes with ones that measure the issue Done, register composio and the OAuth broker, file the owner cards and the remainders',
  'qnfo-ops 2.62.20: ops_run_events 0 rows, cloud_ops_events kind ops-surface-size 0 rows, policy-gate-shadow 0 rows; live broker routes answer 400 and 401; the 1000794 and 1000807 probes compared a fixed string with a count string and looked for a worker named oauth/broker',
  'branch change; verify after CI migration and canonical deployment',
  'qnfo-ops tool logging, MCP tools/list, contracts of 1000639 1000649 1000650 1000794 1000807',
  'migrations/2026-11-05-ops-rm-registrations.sql Rollback header restores the probes and roadmap rows from bak_20261105_ops_rm_contracts and bak_20261105_ops_rm_roadmap; decision_log is append-only',
  'a per-run tool ledger with a read route, a measured shadow policy gate, a logged MCP surface size, and registered composio and OAuth capabilities',
  'within a day of the 2.63.0 deploy ops_run_events holds rows for job workflow runs and cloud_ops_events holds ops-surface-size rows once an MCP client lists tools; no reader gain is predicted',
  'cost: the code-mode list is 1.34 percent of the default list, so a code-mode client saves about 10,000 tokens per session start',
  'offline: qnfo-ops trace-fold, codemode-surface, policy-gate-replay and composio tests; live: ops.qnfo.org health, /oauth/callback 400 and /oauth/authorize 401, D1 reads of the 5 affected contracts; not verified: the deployed 2.63.0 write path'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'OPS-RM-SLICES-1:%');
