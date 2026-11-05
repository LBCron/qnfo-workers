-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'AI-CAL-ECHO-1: %' AND status = 'open';
-- AI-CAL-ECHO-1 (2026-11-05, charter pillar autonomy; OWNER-NO-LOOSE-ENDS-1; follow-up of PR 7338 for GitHub issue 6178 / agent_issues 1001002).
-- PR 7338 (qnfo-ai-calibration 1.6.13, REASONING-PING-1) removed the cause of the 504: the 16-token ping of a reasoning-only id came back as an empty leg. Live read 2026-11-05T00:30Z,
-- first sweep after the deploy: probe = model, target deepseek-v4-flash-thinking, http=200, content "OK", 3.2 s (before: http=504, 2.1 s, 91 of 91 sweeps). The probe still
-- fails, now on `echo=false`: the router answers with a model field that is not the id that was asked for, and the detail does not say which one. Reading qnfo-ai did not settle it
-- (the response model is routedModel; a spend, fleet-steer or quality-floor decision may re-route a pinned id), and the worker file was held by another session (breach-cost-retire,
-- WORKER-COUNT-1.3, until 02:22Z) when this was filed. The fix is to put the served model into the failure detail first (got=, served_by=, model_resolution= from _router), read the
-- next sweep, then decide in one place whether the id is an alias of another model (retire it from ALL_MODELS and the router registry) or a route to repair.
-- The description holds real line breaks.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'AI-CAL-ECHO-1: the [ai-cal] ping of deepseek-v4-flash-thinking answers 200 with content but the router echoes another model; name it in the probe detail',
 'Charter pillar: autonomy. Doer: the code loop (qnfo-ai-calibration). Follows PR 7338 (REASONING-PING-1) for GitHub 6178 / agent_issues 1001002. Since 1.6.13 the thinking id answers http=200 "OK" in 3.2 s instead of 504, but probeCompletion still fails it on echo=false and its detail does not name the model the router put in the response. Lever: in probeCompletion, when r.status is 200 and the reply is not an echo, append the response model, _router.served_by and _router.model_resolution to the detail (a marker comment ECHO-DETAIL-1 on the change). Then read the next */30 sweep: if the router serves the id from another model on purpose, drop the id from ALL_MODELS (and the router registry entry if it is an alias); if it is a route to repair, repair it. Do not weaken the echo check for the other ids. Done: the next sweep row of probe model for the id names the served model, and issue 1001002 closes by its own contract (latest probe row = pass) or the id is retired with the reason recorded.

code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js
code-anchor: function pingMaxTokens(model) {
code-probe: {"paths": ["qnfo-ai-calibration/worker.js"], "contains": "ECHO-DETAIL-1"}',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'AI-CAL-ECHO-1: %' AND status = 'open');
