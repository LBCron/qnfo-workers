-- AUTOROUTER-SHADOW-SCHEDULE-1 follow-up (2026-11-05, agent W2-C; charter pillar cost; roadmap row 1695, issue 1002052): the first scheduled run (qnfo-ai-calibration 1.9.0, PR 7762, tick of 2026-11-05T05:00:30Z)
-- wrote 3 autorouter-shadow rows and all three are status skipped_budget. autoRouterShadowRun asks spendGovern for "gateway" / "cloudflare/auto" and skips unless the answer is allow; with the Workers AI cap
-- breached for days (ai_spend:workers-ai 858.89 of 95) the answer is a downgrade, so the evaluation can never produce an ok row while the cap stays breached. BUDGET-SOFT-ROUTE-1 says a breached spend cap steers the
-- model and never skips a run; three replays a day cost cents. Two repairs here: (1) the closing probe of issue 1002052 counted skipped_budget as success, so nine skipped rows would have closed it with no result;
-- it now counts ok rows only. (2) the issue now targets the real cause: only a refusal skips, a downgrade proceeds (the replay measures what Auto Router would pick, a cheaper substitute is not the measurement).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description = (SELECT b.description FROM bak_20261105_w2c_autorouter_ok b WHERE b.id = agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_w2c_autorouter_ok); UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_w2c_autorouter_ok_c b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_w2c_autorouter_ok_c)
-- BACKUP: bak_20261105_w2c_autorouter_ok

CREATE TABLE IF NOT EXISTS bak_20261105_w2c_autorouter_ok AS SELECT * FROM agent_issues WHERE title LIKE 'AUTOROUTER-SHADOW-SCHEDULE-1:%';
CREATE TABLE IF NOT EXISTS bak_20261105_w2c_autorouter_ok_c AS SELECT * FROM remediation_contracts WHERE class IN (SELECT 'issue-' || id FROM agent_issues WHERE title LIKE 'AUTOROUTER-SHADOW-SCHEDULE-1:%');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''9'' AS expected, CAST(MIN(9, (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''autorouter-shadow'' AND status = ''ok'' AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-4 days''))) AS TEXT) AS observed',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
    precondition = 'AUTOROUTER-SHADOW-SCHEDULE-1: the calibration tick calls the route daily (PR 7762); the route skips every replay while the Workers AI cap is breached',
    action = 'the code loop changes autoRouterShadowRun so that only a refusal skips and a downgrade proceeds; ok rows are the evidence'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'AUTOROUTER-SHADOW-SCHEDULE-1:%' AND status = 'open' ORDER BY id DESC LIMIT 1);

UPDATE agent_issues
SET description = replace(replace(description, 'code-task: repo=qnfo-workers path=qnfo-ai-calibration/worker.js', 'code-task: repo=qnfo-workers path=qnfo-ai/worker.js'), 'code-anchor: async function calibration(env, trigger) {', 'code-anchor: async function autoRouterShadowRun(env, limit) {')
              || char(10) || 'DELTA-NOTE (W2-C, 2026-11-05) skipped: the calibration side is done and live (qnfo-ai-calibration 1.9.0, PR 7762; tick 2026-11-05T05:00:30Z wrote 3 rows). All 3 are status skipped_budget: autoRouterShadowRun skips unless spendGovern(env, "gateway", "cloudflare/auto") answers allow, and with ai_spend:workers-ai at 858.89 of 95 it answers downgrade. The remaining change is in qnfo-ai/worker.js autoRouterShadowRun: skip only when the decision is refuse; on a downgrade run the replay anyway (it measures what Auto Router would choose; three replays of at most 512 output tokens a day cost cents, BUDGET-SOFT-ROUTE-1 says a cap steers the model and never skips a run), keep the spendRecord of the call, add an offline test with a fake spendDecide for allow, downgrade and refuse. The closing probe counts ok rows only (9 in 4 days).',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE title LIKE 'AUTOROUTER-SHADOW-SCHEDULE-1:%' AND status = 'open' AND description NOT LIKE '%DELTA-NOTE (W2-C, 2026-11-05) skipped%';

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (W2-C, 2026-11-05) order: AUTOROUTER-SHADOW-SCHEDULE-1 (only a refusal skips) and this issue (an in-run judge) edit the same function, autoRouterShadowRun; land the skip change first, the judge second, and read the first ok rows before writing the judge.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE title LIKE 'AUTOROUTER-QUALITY-1:%' AND status = 'open' AND description NOT LIKE '%DELTA-NOTE (W2-C, 2026-11-05) order%';
