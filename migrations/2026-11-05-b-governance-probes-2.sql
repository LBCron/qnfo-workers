-- B-GOVERNANCE-2 (2026-11-05, charter pillar autonomy and cost; sweep cluster B-governance-code): two closing probes that could not pass, replaced by probes on the outcome their issue names.
--
-- agent_issues 746 (GitHub 5432), FIX-ORDERING-HAZARD, 2026-09-13: "deploying the repo registry.js to restore the 44-probe roster would blind the fleet to 13 scheduled workers". The probe asks for more
-- than 80 distinct probe names in an hour and 40 scheduled workers, constants read off the September roster of 55 workers. The fleet now holds 39 live service_registry rows (38 workers and one folded member,
-- qnfo-backlog-exec, a route of qnfo-lifecycle with no worker of its own), so 80 distinct names cannot exist and the probe has failed 178 times for a reason that is not a defect. Read 2026-11-05 00:50Z:
-- fleet_probe_log holds 38 distinct names in the last 24 hours and every live non-member worker of service_registry is among them (0 unprobed); worker_activity_daily measured 29 scheduled workers on 2026-11-04;
-- and nothing deploys qnfo-fleet-dashboard/registry.js any more (the dashboard worker does not import it; only qnfo-agent-ws/archive.test.mjs and a path test read the file), so the hazard the issue names
-- cannot be triggered. What stays worth guarding is the coverage collapse of 2026-09-12 (82 names down to 10): the new probe counts live workers with no probe row in the last 24 hours, expected 0.
-- It is stronger than a constant, not weaker: it fails when any single live worker loses its probe, and it follows the roster instead of a 55-worker snapshot.
--
-- agent_issues 1000696 (GitHub 5402), route Workers AI spend through the cache and the cheaper-model ladder: its probe is anchored on date('2026-11-04', '-29 days') with no upper bound, so the window never
-- rolls: it counts every day since 2026-10-06 forever and can only rise. The probe is the right measure (30-day Workers AI USD against the cap of 95) and now rolls on date('now'). Its failure text also names
-- the run rate of the last three complete days and the top model, so the doer reads the lever. Read 2026-11-05: 30 days 438.98 USD (the filing read 348.33), last three complete days 19.81 USD/day. The drivers
-- of 2026-11-02..04 (ai_call_counters, neurons a day): qnfo-research-exec glm-5.3-flash 460k + gpt-oss-120b 372k, qnfo-agents deepseek-v4.1-flash 315k (before AGENTS-INPUT-CUT-1, PR 7273), qnfo-code-orchestrator
-- kimi-k2.7-code 188k + glm-5.3 111k + gpt-oss-120b 52k, q08-signal-engine kimi-k2.6 53k. The issue stays open: the lever is the spend governor (ROADMAP-1 INFRA #2174, issue 1001813) and the research budget governor
-- (READER-YIELD-1); this file moves no budget and no model.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_b_gov_probes_2 b WHERE b.class = remediation_contracts.class) WHERE class IN ('issue-746', 'issue-1000696'); DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'probes-measure-outcomes-not-snapshot-constants';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_b_gov_probes_2 AS SELECT class, verify_probe, precondition, action, status, last_verdict FROM remediation_contracts WHERE class IN ('issue-746', 'issue-1000696');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM service_registry WHERE state = ''live'' AND kind <> ''member'' AND service NOT IN (SELECT DISTINCT name FROM fleet_probe_log WHERE ts >= datetime(''now'', ''-1 day''))) AS TEXT) AS observed',
    precondition = 'B-GOVERNANCE-2 (issue 746): every live standalone worker of service_registry has a probe row in fleet_probe_log within 24 hours; the September constants (more than 80 names, 40 scheduled) belonged to a 55-worker roster.',
    action = 'Count live non-member service_registry workers with no fleet_probe_log row in the last 24 hours; expected 0.',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-746' AND status IN ('active', 'holding', 'escalated', 'superseded', 'probe-review-refused')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 746 AND status = 'open');

UPDATE remediation_contracts
SET verify_probe = 'WITH s AS (SELECT max(0, sum(neurons) - 300000)/1000.0*0.011 AS usd FROM ai_call_counters WHERE day >= date(''now'',''-29 days'')), m AS (SELECT model, sum(neurons) AS n FROM ai_call_counters WHERE day >= date(''now'',''-29 days'') GROUP BY model ORDER BY n DESC LIMIT 1), d AS (SELECT round(sum(neurons)/3.0/1000.0*0.011, 2) AS usd_day FROM ai_call_counters WHERE day >= date(''now'',''-3 days'') AND day < date(''now'')), c AS (SELECT coalesce(sum(cached_tok),0) AS ct FROM ai_spend_ledger WHERE provider=''workers-ai'' AND day >= date(''now'',''-29 days'')) SELECT ''workers-ai 30d <= 95 USD'' AS expected, CASE WHEN s.usd <= 95 THEN ''workers-ai 30d <= 95 USD'' ELSE printf(''workers-ai 30d %.2f USD vs cap 95 | last 3 complete days %.2f USD/day | top model %s %.2f USD | workers-ai cached_tok %d'', s.usd, d.usd_day, m.model, m.n/1000.0*0.011, c.ct) END AS observed FROM s, m, c, d',
    next_due_at = datetime('now')
WHERE class = 'issue-1000696' AND status IN ('active', 'holding')
  AND instr(verify_probe, 'date(''2026-11-04''') > 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000696 AND status = 'open');

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'B-GOVERNANCE-2 (2026-11-05): the closing probe was anchored on the literal date 2026-11-04 and never rolled; it now rolls on date(now) and names the run rate of the last three complete days. Read 2026-11-05: workers-ai 30 days 438.98 USD (filing read 348.33), 19.81 USD a day over 2026-11-02..04. Drivers, neurons a day (ai_call_counters): qnfo-research-exec glm-5.3-flash 460k and gpt-oss-120b 372k; qnfo-agents deepseek-v4.1-flash 315k (before AGENTS-INPUT-CUT-1, PR 7273); qnfo-code-orchestrator kimi-k2.7-code 188k, glm-5.3 111k, gpt-oss-120b 52k; q08-signal-engine kimi-k2.6 53k. Levers owned elsewhere: spend governor (issue 1001813, ROADMAP-1 INFRA #2174) and the research budget governor (READER-YIELD-1, ops_config research_daily_neurons). Closes when the rolling 30-day figure is at or under the cap.'
WHERE id = 1000696 AND status = 'open' AND instr(description, 'B-GOVERNANCE-2') = 0;

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'B-GOVERNANCE-2 (2026-11-05): the September constants (more than 80 probe names, 40 scheduled workers) belonged to a 55-worker roster; the fleet is 38 workers plus the folded member qnfo-backlog-exec. Read 2026-11-05: fleet_probe_log holds 38 distinct names in 24 hours, 0 live workers unprobed, 29 scheduled workers measured on 2026-11-04. Nothing deploys qnfo-fleet-dashboard/registry.js (the dashboard worker does not import it), so the hazard cannot be triggered. The contract now counts live workers without a probe row in 24 hours, expected 0.'
WHERE id = 746 AND status = 'open' AND instr(description, 'B-GOVERNANCE-2') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a closing probe that can never pass (constants from a 55-worker roster; a window anchored on a literal date) is replaced by a probe on the outcome its issue names, not left to fail for ever',
  'remediation_contracts issue-746 and issue-1000696 re-pointed; both issues annotated with the reading',
  'issue-746 probe failed 178 times asking for more than 80 distinct names from 38 workers; issue-1000696 window start fixed at 2026-10-06; live reads 2026-11-05 listed in the file header',
  'pending', 'two remediation contracts and two issue descriptions', 'the Rollback line of migrations/2026-11-05-b-governance-probes-2.sql restores both probes from bak_20261105_b_gov_probes_2',
  'probes-measure-outcomes-not-snapshot-constants',
  'issue 746 closes on its next passing run (0 unprobed live workers); issue 1000696 stays open until the rolling 30-day Workers AI figure is at or under 95 USD and its failure text now carries the run rate',
  'none (closing existing work)', 'node migrations/b-governance-probes-2.test.mjs (SQLite fixtures, both probes falsifiable)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'probes-measure-outcomes-not-snapshot-constants');
