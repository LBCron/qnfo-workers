-- COST-D1-DRILL-1 (charter pillar cost): follow-ups from docs/COST-AND-D1-ANALYSIS-2026-11-04.md.
-- Read replication on qnfo-audit was enabled 2026-11-04 15:36Z (mode auto); no read path uses a replica yet.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: agent_issues
-- Rollback: DELETE FROM agent_issues WHERE source = 'session:cost-d1-drill' AND title LIKE 'COST-D1-DRILL-1%';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COST-D1-DRILL-1a: dashboard read-only queries use a D1 read replica (d1all)',
 'QNFO.OPS; charter pillar cost. Read replication on qnfo-audit is on (mode auto, 2026-11-04 15:36Z) and every query still runs on the primary (errors name D1DatabaseSessionAlwaysPrimary). In qnfo-fleet-dashboard d1all() takes only SELECT statements for page builds: run them through db.withSession("first-unconstrained") when the binding has withSession, falling back to db.prepare otherwise, and keep every write on the primary. Prediction: primary read queries from the dashboard worker -30% or more per day (d1QueriesAdaptiveGroups, SELECT statements, before and after), no stale-read complaint (the headline and status data move hourly). Closing marker: the fix carries the text COST-D1-DRILL-1a in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function d1all(db, sql, params) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"COST-D1-DRILL-1a"}',
 'session:cost-d1-drill', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'COST-D1-DRILL-1a: dashboard read-only queries use a D1 read replica (d1all)' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COST-D1-DRILL-1b: Workers AI calls the ledger does not see (kimi-k2.7-code 6,571 meter calls vs 873 counted, kimi-k2.6 7,599 vs 1,107)',
 'QNFO.OPS; charter pillar cost. Cloudflare aiInferenceAdaptiveGroups, 7 days to 2026-11-04: kimi-k2.7-code 6,571 calls ($42.8), kimi-k2.6 7,599 calls ($32.0), gpt-oss-120b 16,313 calls ($31.5) against ai_call_counters 873, 1,107 and 3,682. About $35 a week has no named caller, so no cut can be aimed at it. The same gap on deepseek-v4.1-flash-1017 was qnfo-agents (PR 6936). Owner loop: the AI-spend session and the qnfo-cloud-ops cost step. Work: list every Workers AI binding caller (grep env.AI.run and the AI binding in wrangler.toml across the fleet), route each through the metered wrapper or add AI-METER-1 style ledger rows, then re-read the meter against the ledger. Done when ledger calls are within 20 percent of the meter per model for three consecutive days.',
 'session:cost-d1-drill', 'reliability', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'COST-D1-DRILL-1b:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'COST-D1-DRILL-1c: a queued code task holds its file claim for hours (ct_9qc46synuv7idd holds qnfo-fleet-dashboard/worker.js since 14:06Z, renewed to 17:22Z, status queued, step read, 4 h in the queue)',
 'QNFO.OPS; charter pillar autonomy. Measured 2026-11-04 15:42Z: code task ct_9qc46synuv7idd (METRIC-TRIGGER-357, an issue its own triage calls time-gated until 2026-11-18) is queued at step read with attempts 1 and a claim on file:qnfo-fleet-dashboard/worker.js since 14:06:51Z, renewed once, expiry 17:22Z. Every other session and task that needs the dashboard (D1-OVERLOAD-1b/1d/1e, COST-D1-DRILL-1a, the reader screens) is refused for the whole period. ENQUEUE-CLAIM-RESERVATION-1 reserves a file for 15 minutes at enqueue; the step renewal after that keeps a task that makes no progress on the file. Fix in claimTake: renew only while the task has advanced a step in the last 20 minutes or has an open pull request; otherwise let the claim lapse and take a new one when the task actually runs. Prediction: no queued task holds a file claim for more than 35 minutes (GET /work-locks, kind code-loop holders, since older than 35 minutes and status queued: 0). Closing marker: the fix carries the text COST-D1-DRILL-1c in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-code-orchestrator/worker.js' || char(10) ||
 'code-anchor: async function claimTake(env, task, claim, ttlSec) {' || char(10) ||
 'code-probe: {"paths":["qnfo-code-orchestrator/worker.js"],"contains":"COST-D1-DRILL-1c"}',
 'session:cost-d1-drill', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'COST-D1-DRILL-1c:%' AND status = 'open');
