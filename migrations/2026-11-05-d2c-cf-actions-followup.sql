-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'ROADMAP-1: QNFO.OPS D2C-CF-ACTIONS-1:%' AND status = 'open';
-- D2C-CF-ACTIONS-1 (2026-11-05, charter pillar autonomy; OWNER-NO-LOOSE-ENDS-1; follow-up of PR 7365 / decision_log D2C-GATEWAY-RETRIES-1 and D2C-FLEET-LEE-MODEL-1).
-- Two production configuration changes of 2026-11-04 had to be written through the Cloudflare account API from a session because scripts/cf_ops_actions.py (the allowlisted
-- Cloudflare actions that run with the repository token under the secret lock) has no action for them: one plain-text variable of a live Worker (AI_MODEL of qnfo-fleet-lee,
-- every other binding inherited, the pattern of unbind-d1) and one field group of an AI Gateway (retry_max_attempts / retry_delay / retry_backoff of qnfo-infra, every other
-- field returned as read, spend_limits kept). The doer is the code loop: the file is a plain script, the allowlist is its own, and both writes are verified by reading the
-- result back, as unbind-d1 does. The file was held by another session (c6-s2, RM-52/RM-51) at the time of filing, so no edit was made here.
-- The description holds real line breaks (a literal backslash-n in a directive is the defect fm-directive-literal-newline counts).
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS D2C-CF-ACTIONS-1: cf_ops_actions gets set-worker-var and gateway-set-retries, so a Worker variable and a gateway retry policy change through the canonical path',
 'Charter pillar: autonomy. Doer: the code loop (qnfo-code-orchestrator). Two live Cloudflare configuration changes (qnfo-fleet-lee AI_MODEL, AI Gateway qnfo-infra retries) were written through the account API from a session because scripts/cf_ops_actions.py has no action for them. Lever: add two allowlisted actions that follow unbind-d1: set-worker-var WORKER:NAME=VALUE (refused unless the worker and variable are on an explicit allowlist and, for AI_MODEL, the value is an id of scripts/model-policy.json; PATCH settings with every other binding as type inherit, under the secret lock, result read back and compared) and gateway-set-retries GATEWAY (PUT with every other field returned as read, retry_max_attempts 2, retry_delay 1000, retry_backoff exponential, read back; refuses a gateway whose spend_limits would change). Add an offline test with an injected fetch. Metric: the model-floor-guard live sweep and the gatewayConfigAudit drift finding are repaired by a dispatched action instead of a session. Done: both actions exist, are tested, and a dry run on the live account reports already-applied.

code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py
code-anchor: def unbind_d1(target: str, acct: str, token: str) -> int:
code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "set-worker-var"}',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS D2C-CF-ACTIONS-1:%' AND status = 'open');
