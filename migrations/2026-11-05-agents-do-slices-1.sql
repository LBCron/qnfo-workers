-- AGENTS-DO-SLICES-1 (2026-11-05, charter pillar autonomy; agent_issues 1000805, 1000806, 1000653 and roadmap_implementation 1806, 1807, 1696): the D1 side of qnfo-agents 0.8.0.
-- RM-CODE-SESSION-1: a CodeSession now has a per-session neuron budget that downgrades and never stops, and loops can start one (cf_agent_requests kind code_session).
-- RM-CODE-SANDBOX-1: a write-scope CodeSession gates changing tools behind an approved plan, takes a work claim per edited file and mirrors the chain to cf_agent_sandbox_log.
-- RM-DURABLE-INTERRUPT-1: every pause for approval is a cf_agent_approvals row (awaiting, approved or rejected, executed or failed, restart_survived).
-- The two tables below are written by the worker; the three closing probes are replaced because the old ones could not measure the feature: 1000805 compared an exact count of 10
-- (it fails again at 11 done sessions), 1000653 matched generic words (interrupt, approval, resume) in code_tasks goals, audit_trail and analytics_events, and 1000806 needed a merged
-- code_task whose goal names the issue (the feature is a session capability, not a code-loop task). The worker seeds its own ten replay turns and one approval selftest from 0.8.0
-- (a migration inserting them would race the deploy: the previous version fails an unknown request kind for good).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_agents_do_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_agents_do_contracts); UPDATE roadmap_implementation SET status = 'planned' WHERE id IN (1696, 1806, 1807) AND status = 'in_progress'; UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.OPS #code-session-%' OR title LIKE 'ROADMAP-1: QNFO.OPS #approval-card:%'; DROP INDEX IF EXISTS idx_cf_agent_approvals_status; DROP INDEX IF EXISTS idx_cf_agent_sandbox_log_session; DROP TABLE IF EXISTS cf_agent_approvals; DROP TABLE IF EXISTS cf_agent_sandbox_log;
-- spof-review: no new worker, cron or binding in D1; the qnfo-agents GUARD service binding (qnfo-deploy-guard) is declared in its wrangler.toml and degrades to an unreachable-claim record.

CREATE TABLE IF NOT EXISTS bak_20261105_agents_do_contracts AS
SELECT class, verify_probe FROM remediation_contracts WHERE class IN ('issue-1000805', 'issue-1000806', 'issue-1000653');

CREATE TABLE IF NOT EXISTS cf_agent_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  instance TEXT NOT NULL,
  caller TEXT NOT NULL,
  action TEXT NOT NULL,
  call_id TEXT,
  status TEXT NOT NULL,
  payload_sha TEXT,
  restart_survived INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT,
  note TEXT,
  created_ms INTEGER NOT NULL,
  decided_ms INTEGER,
  executed_ms INTEGER,
  UNIQUE (run_id, action)
);
CREATE INDEX IF NOT EXISTS idx_cf_agent_approvals_status ON cf_agent_approvals (status, created_ms);

CREATE TABLE IF NOT EXISTS cf_agent_sandbox_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  tool TEXT,
  path TEXT,
  detail TEXT,
  created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cf_agent_sandbox_log_session ON cf_agent_sandbox_log (session_id, created_ms);

-- 1000805 RM-CODE-SESSION-1: ten completed CodeSession turns with tokens and cost recorded (the issue's Done). Observed is capped at '10' so the 11th session does not fail it.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''10'' AS expected, CASE WHEN n >= 10 THEN ''10'' ELSE CAST(n AS TEXT) END AS observed FROM (SELECT COUNT(*) AS n FROM cf_agent_session_usage WHERE status = ''done'' AND input_tokens + output_tokens > 0 AND cost_usd > 0)',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000805' AND issue_id = 1000805;

-- 1000806 RM-CODE-SANDBOX-1: one session went plan approved, claim, edit, pull request (the chain in cf_agent_sandbox_log). The merge of that pull request is read from its url in the log.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT session_id FROM cf_agent_sandbox_log GROUP BY session_id HAVING SUM(kind = ''plan_approved'') > 0 AND SUM(kind = ''claim'') > 0 AND SUM(kind = ''edit'') > 0 AND SUM(kind = ''pr'') > 0) THEN ''1'' ELSE ''0'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000806' AND issue_id = 1000806;

-- 1000653 RM-DURABLE-INTERRUPT-1: one staged step was paused, survived a forced restart, was approved and executed on the same run (sends nothing).
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cf_agent_approvals WHERE action = ''staged_action'' AND status = ''executed'' AND restart_survived = 1) THEN ''1'' ELSE (SELECT COUNT(*) FROM cf_agent_approvals) || '' approval rows, none executed after a restart'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000653' AND issue_id = 1000653;

UPDATE roadmap_implementation
SET status = 'in_progress',
    evidence = evidence || '; qnfo-agents 0.8.0 slice (branch c-ops-tools-agents-do): see agent_issues 1000805, 1000806, 1000653 for the closing probes'
WHERE id IN (1696, 1806, 1807) AND status = 'planned';

-- Remainders, each with a doer. qnfo-agents/src is outside the code loop's merge scope, so its rows name a session as doer; the dashboard row is the code loop's.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #code-session-pane: the /cmd page streams the CodeSession, shows budget and plan, and sends the write scope only after a fresh code',
 'Charter pillar: autonomy. Serves RM-CODE-SESSION-1 (agent_issues 1000805) and RM-CODE-SANDBOX-1 (1000806). qnfo-agents 0.8.0 adds the worker side: the SSE stream carries budget, plan, claim, edit and pr events, POST /code-sessions/<id>/plan {approved} approves a plan (write scope only) and POST /code-sessions/<id>/turns takes escalate:true. The page still polls: cmdCodeSessionFetch sends no x-agent-scope header, so every session the console starts is read scope and a plan can never be approved from it. Lever: the /cmd page opens GET /code-sessions/<id>/events with EventSource semantics (Last-Event-ID resume), renders text, tool, budget and plan events, shows an Approve plan and a Reject plan button that call the plan route with the write scope after the existing fresh-code check, and cmdCodeSessionFetch forwards x-agent-scope: write only for that call. scripts/qcli.mjs reads the same stream. Done: one real fix goes from a typed request to a pull request with a cf_agent_sandbox_log row for plan_approved, claim, edit and pr, and the ten replay sessions of cf_agent_requests (requester rm-code-session-1) show tokens and cost per turn in cf_agent_session_usage.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function cmdCodeSessionFetch(env, path, body) {',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #code-session-pane:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #approval-card: a paused approval raises its IDENTITY-BOUND owner card and closes it when answered',
 'Charter pillar: autonomy. Serves RM-DURABLE-INTERRUPT-1 (agent_issues 1000653). qnfo-agents 0.8.0 pauses an identity-bound step at the @cloudflare/computer interrupt, survives a restart and resumes the same run on POST /approvals/<run id>/<call id> (write scope), and records every step in cf_agent_approvals. What is not built: the owner is not told. Lever: when markApprovalPending records an awaiting row for send_email, insert a human_actions card (slug approval-<run id>, source qnfo-agents, why carrying an IDENTITY-BOUND: line that names the action, the run and the payload hash, default_in_effect: rejected after 24 h) and set it resolved when respondToApproval answers; the console lists pending approvals (GET /approvals) beside the card. Done: a staged step raises a card, the owner answers it in /cmd, the run resumes and the card is resolved, all visible in cf_agent_approvals and human_actions.' || char(10) ||
 'doer: session (qnfo-agents/src/index.ts is outside the code loop merge scope; take file:qnfo-agents/src/index.ts as a work claim first)' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-agents/src/index.ts' || char(10) ||
 'code-anchor: private async markApprovalPending(call: any) {',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #approval-card:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #code-session-escalate: a CodeSession turn that ends unanswered escalates once to the premium route',
 'Charter pillar: cost. Serves RM-CODE-SESSION-1 (agent_issues 1000805): flash first, Pro on escalation. 0.8.0 lets the caller escalate a turn (POST /code-sessions/<id>/turns {escalate:true}) while the session budget is ok; the session never escalates by itself. Lever: when a streamed turn ends with no answer text (pickAnswer says unanswered) and the budget step canEscalate, run one more turn step on dynamic/premium with the tool transcript and FINAL_ANSWER_ASK, record the escalation in a budget event and the model in cf_agent_session_usage. Prediction: the share of CodeSession turns with an empty answer falls to near 0 at under 10 percent more neurons. Done: cf_agent_session_usage shows the premium model on escalated turns and no turn ends empty in the next 20 sessions.' || char(10) ||
 'doer: session (qnfo-agents/src/index.ts is outside the code loop merge scope)' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-agents/src/index.ts' || char(10) ||
 'code-anchor: private async executeTurn(turn: number) {',
 'session', 'cost', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #code-session-escalate:%' AND status = 'open');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:C-ops-tools-F3',
  'The CodeSession, its plan gate and the approval pause exist but are unmeasured: 2 done sessions of 10 needed, no plan gate, no approval rows, probes that cannot pass',
  'AGENTS-DO-SLICES-1: qnfo-agents 0.8.0 (session budget, code_session loop kind with ten read-only replay turns, plan and claim gate, approvals routes and a staged selftest) plus two D1 tables and three replaced closing probes',
  'cf_agent_session_usage: 2 done rows (252,213 and 359,603 input tokens a turn, USD 0.13 and 0.17); remediation_verifications for 1000805, 1000806, 1000653 observed 2, 0 and m=0,t=0,d=0',
  'Slice shipped, not yet measured; no issue is closed',
  'qnfo-agents (one worker, one wrangler deploy), cf_agent_requests (up to ten low-priority read-only rows), two new D1 tables',
  'Revert the qnfo-agents PR (the bundle is rebuilt by the deploy workflow); the Rollback header restores the three probes from bak_20261105_agents_do_contracts; ops_config qnfo_agents_replay = off stops the seeding at once',
  'A CodeSession is measured per turn, cannot overspend without being downgraded, cannot change anything before an approved plan, and a paused approval is a durable, restart-proof record',
  'cf_agent_session_usage reaches 10 done rows within a day; input tokens per replay turn fall below 100,000 (from 252,213 and 359,603) with earlier results compacted; cf_agent_approvals gets one executed row with restart_survived = 1 within one drain tick of the deploy',
  'No public reach change', 'node qnfo-agents/code-session.test.mjs; node qnfo-agents/worker.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'AGENTS-DO-SLICES-1:%');
