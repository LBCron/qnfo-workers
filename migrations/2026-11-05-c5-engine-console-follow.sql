-- C5-ENGINE-CONSOLE-FOLLOW-1 (2026-11-05, charter pillar autonomy; roadmap RM-DURABLE-AGENT-EXECUTION-1 id 10 and RM-TP-6-DURABLE-EXECUTION id 131; pairs with qnfo-ops SESSION-AUTOCONTINUE-1, PR 7552).
-- qnfo-ops 2.64.0 continues a background agent run that spends its round budget in a follow-up run of the same session and answers op result with run (the first run), latest and chain_len.
-- The fleet console reads only run, so it would settle the first partial reply as the final answer. This files the console half as a ROADMAP-1 issue with a code-task line, a code-anchor and a
-- code-read closing probe that fails until the change is on main, and arms its contract (the birth template supersedes it; the update below re-arms it, as in migrations/2026-11-05-c5-engine-contracts-active.sql).
-- Prediction: the code loop (or a session) lands the two-line read of latest in cmdAgentPoll and v3CodeStatus; after that no answered console agent row ends with the line "the task continues automatically in run".
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', next_due_at = NULL WHERE class IN (SELECT 'issue-' || id FROM agent_issues WHERE source = 'session:c5-engine' AND title LIKE 'ROADMAP-1: autonomy #T6.1b:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: autonomy #T6.1b: the fleet console follows a continued agent run (op result latest) instead of settling the first partial run as the final answer',
'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js
code-anchor: async function cmdAgentPoll(env, id) {
code-probe: {"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "SESSION-AUTOCONTINUE-1: follow"}

Charter pillar autonomy (roadmap rows RM-DURABLE-AGENT-EXECUTION-1, roadmap_implementation id 10, and RM-TP-6-DURABLE-EXECUTION, id 131). Guard: console agent runs answered with a partial reply.
Evidence (read 2026-11-05): qnfo-ops 2.64.0 (PR 7552, SESSION-AUTOCONTINUE-1) continues a background agent run that spends its round budget in a follow-up run of the same session. op result on the first run id now returns run (the first run: status done, partial true, continued_by the next id, a reply that ends with "[SESSION-AUTOCONTINUE-1] The round budget of this run is spent; the task continues automatically in run <id>") plus latest (the last run of the chain, up to 5 hops) and chain_len. cmdAgentPoll and v3CodeStatus in qnfo-fleet-dashboard/worker.js read only r.json.run, so the console settles the first partial reply as the final answer (cmd_log status answered) and never shows the continuation. The Code screen starts runs with max_iters 24 (v3CodeStart); the command line starts them too (op start at the cmd agent call sites).
EDIT: in cmdAgentPoll and in v3CodeStatus read the run as r.json && (r.json.latest || r.json.run), so a chain is polled until its last run settles; while a chain runs, progress says the run number (chain_len); the settled answer is the last run reply with its own step trace. Mark the change SESSION-AUTOCONTINUE-1: follow, cover it in the dashboard cmd agent test, bump with scripts/worker_release.py (mirror deployed-current.worker.js).
Definition of done: merged and verified live: a console agent run that spent its budget settles on the last run of its chain, and no answered cmd_log agent row ends with the line "the task continues automatically in run".',
'session:c5-engine', 'feature', 'medium', 'open', CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: autonomy #T6.1b:%' AND status = 'open');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
SELECT 'issue-' || id, id, 'issue open; the code loop executes the code-task line of the issue', 'the probe reads the dashboard worker on main for the SESSION-AUTOCONTINUE-1: follow marker; it passes by itself once the change has merged', '{"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "SESSION-AUTOCONTINUE-1: follow"}', 'code-read', 3, 'qnfo-code-orchestrator', 1, 'active', 'roadmap'
FROM agent_issues WHERE title LIKE 'ROADMAP-1: autonomy #T6.1b:%' AND status = 'open' ORDER BY id DESC LIMIT 1;

UPDATE remediation_contracts
SET status = 'active',
    attempts = 0,
    last_verdict = NULL,
    last_attempt_at = NULL,
    next_due_at = datetime('now'),
    verify_probe = '{"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "SESSION-AUTOCONTINUE-1: follow"}',
    verify_transport = 'code-read',
    precondition = 'issue open; the code loop executes the code-task line of the issue',
    action = 'the probe reads the dashboard worker on main for the SESSION-AUTOCONTINUE-1: follow marker; it passes by itself once the change has merged',
    escalate_to = 'qnfo-code-orchestrator',
    module = 'roadmap'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: autonomy #T6.1b:%' AND status = 'open' ORDER BY id DESC LIMIT 1);
