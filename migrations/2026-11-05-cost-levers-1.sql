-- COST-LEVERS-1 (2026-11-05, charter pillar: cost). Breach metrics: manager_agent_requests_24h (agent_issues 1001771), workers_ai_cost_30d_usd, fleet_cost_pace_30d_usd, fleet_cost_bound_month_usd,
-- monthly_cost_run_rate_usd, ns_fleet_cost_usd_month, external_impact_per_dollar (all driven by the Cloudflare neuron meter, v_ai_meter_daily / cost_daily source workers_ai).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS cf_agent_requests_manager_cap_bi; DELETE FROM ops_config WHERE key = 'manager_agent_daily_cap'; UPDATE control_registry SET disposition = 'remove', disposition_state = 'applied' WHERE control = 'manager-agent-request-cap'; UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'COST-GATEWAY-ARTICLE-1:%' AND status = 'open';
-- CAUSE-MAPPED: registers no metric_registry row.
--
-- Measured 2026-11-04/05 (Cloudflare GraphQL aiInferenceAdaptiveGroups by hour and model, AI Gateway request bodies, qnfo-audit, living-paper):
--   after the qnfo-agents budget and lean-turn PRs the account still burns 80 to 100k neurons an hour (about USD 22 a day against the owner's USD 200-300 a month).
--   The two largest unbudgeted streams were:
--   (1) qnfo-gateway articleFill (PLAIN-ARTICLE-1): 10 Quick Read plain-language articles an hour, 268 in 24 h, 266 of them for papers published more than a day earlier. Every
--       public paper already has an article (728 of 728) but 352 are marked stale because the paper's version or body length differs from the article's, and research keeps
--       revising papers, so the kimi-k2.6 writer plus the gpt-oss-120b verifier rebuild an article for every revision: counters show 105 kimi calls (68.8k neurons) and
--       462 gpt-oss calls (32.6k) in 3.3 h, about 21k neurons an hour, 500k a day. That is the "unattributed kimi-k2.6" stream of v_ai_meter_vs_counters (385k a day on 11-03 and 11-04).
--       qnfo-gateway/worker.js is under live work claims of five code-loop tasks, so the code side is filed below as a code task with its closing probe.
--   (2) personal-companion hourly retries and the glm-5.3 reviewer: shipped as pull request COST-COMPANION-1 (personal-companion 1.45.3), no migration needed.
--   (3) program-manager requests to the Cloudflare agent: 116 in 24 h against the threshold of 60 (issue 1001771). The lever-request gate (NORTH-STAR-MANAGERS-1) holds the lever
--       reviews to 0 since 18:00Z, but root-cause, roadmap, doer-gap and parked-task requests of management-personas, -b and -plus carry no cap of their own and run 3 to 4 an hour.
--       Each request is a multi-step qnfo-agents run (about 2.4k neurons).
-- How: one BEFORE INSERT trigger on cf_agent_requests ignores a program-manager:* request when ops_config manager_agent_daily_cap (default 48, under the threshold of 60) such requests
--   exist in the last 24 hours (counted over the newest 700 request ids, a rowid range read). Nothing else changes: the same steps run, an ignored insert changes no row, the next
--   tick asks again once the rolling window has room (a rate, not a hold: BUDGET-SOFT-ROUTE-1). Other requesters (issue-probe-agent, code sessions) are untouched.
-- Prediction: manager_agent_requests_24h from 116 (11-05 03:15Z) to at most 48 within 24 h and at or under 60 from the first tick after the lever hours leave the window;
--   qnfo-agents manager runs about 2.4k neurons each: about -160k neurons a day at the 2026-11-04 rate. Verify: the metric, and
--   SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= 'program-manager:' AND requester < 'program-manager;' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day').
-- Guard watch: v_doctrine_scorecard_v2 and the managers' focus issues are unchanged; a manager that is capped logs nothing new, so the cap shows only as fewer cf_agent_requests rows.

INSERT INTO ops_config (key, value, note, updated_at)
VALUES ('manager_agent_daily_cap', '48', 'COST-LEVERS-1 2026-11-05: most program-manager:* requests to the Cloudflare agent in a rolling 24 h (threshold of manager_agent_requests_24h is 60; each request is a multi-step qnfo-agents run of about 2.4k neurons). Raise or lower here; 100000 turns it off.', datetime('now'))
ON CONFLICT(key) DO NOTHING;

CREATE TRIGGER IF NOT EXISTS cf_agent_requests_manager_cap_bi BEFORE INSERT ON cf_agent_requests
WHEN NEW.requester >= 'program-manager:' AND NEW.requester < 'program-manager;'
 AND (SELECT COUNT(*) FROM cf_agent_requests
      WHERE id > (SELECT COALESCE(MAX(id), 0) FROM cf_agent_requests) - 700
        AND requester >= 'program-manager:' AND requester < 'program-manager;'
        AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'))
     >= CAST(COALESCE((SELECT value FROM ops_config WHERE key = 'manager_agent_daily_cap'), '48') AS INTEGER)
BEGIN
  SELECT RAISE(IGNORE);
END;

INSERT INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, alternate_tested_at, evidence, issue_id)
SELECT 'manager-agent-request-cap', 'qnfo-audit trigger cf_agent_requests_manager_cap_bi (COST-LEVERS-1), ops_config manager_agent_daily_cap',
  'cap',
  'program managers asking the Cloudflare agent (multi-step qnfo-agents runs, about 2.4k neurons each) without a shared bound: 116 requests in 24 h on 2026-11-05 against a threshold of 60, root-cause, roadmap, doer-gap and parked-task steps carrying no cap of their own',
  0, 'keep', 'applied',
  'a rate, not a hold: the same fleet_tasks steps run every tick and an ignored insert is retried by the next tick once the rolling 24 h window has room; ops_config manager_agent_daily_cap raises or lowers it (100000 turns it off) and DROP TRIGGER cf_agent_requests_manager_cap_bi removes it with no deploy; the lever gate (NORTH-STAR-MANAGERS-1) is untouched',
  NULL,
  'cf_agent_requests 2026-11-04/05: lever 60, roadmap 19, doer-gap 16, parked 13, root-cause 5 in 24 h; the lever gate cut lever asks to 0 from 18:00Z while the other kinds continued at 3 to 4 an hour; qnfo-agents runs cost about 2.4k neurons',
  1001771
WHERE NOT EXISTS (SELECT 1 FROM control_registry WHERE control = 'manager-agent-request-cap');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('manager-agent-request-cap',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''manager_agent_daily_cap'') = 0 THEN ''the ops_config row manager_agent_daily_cap is missing, so the cap cannot be tuned'' WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name = ''cf_agent_requests_manager_cap_bi'') = 0 THEN ''the trigger cf_agent_requests_manager_cap_bi is missing, so manager requests have no shared bound'' ELSE ''ok'' END AS observed',
  'state probe, no window: the ops_config key that moves the cap and the trigger that applies it; the alternate (the next tick asking again once the rolling window has room) is the steps of management-personas, -b, -c and -plus themselves', 1);

INSERT INTO agent_issues (title, description, source, category, priority, status)
SELECT 'COST-GATEWAY-ARTICLE-1: qnfo-gateway rebuilds a Quick Read article for every paper revision (about 500k neurons a day, 352 of 728 articles marked stale)',
 'Charter pillar: cost. Metrics: workers_ai_cost_30d_usd, fleet_cost_pace_30d_usd, workers_ai_attribution_coverage_pct (the kimi-k2.6 stream of v_ai_meter_vs_counters).
Measured 2026-11-05 (living-paper, AI Gateway, qnfo-audit counters): plain_article holds 728 articles for 728 public papers, 352 of them stale, and articleFill builds about 10 an hour all day (268 in 24 h, 266 for papers more than a day old). The selection treats ANY change of the paper version or of LENGTH(body_md) as stale, so the research revision loop (format standardisation, errata, reviser) makes the gateway rewrite a plain-language article that still describes the same paper. Each rebuild is a kimi-k2.6 write plus a gpt-oss-120b verify and repair: counters qnfo-gateway 105 kimi calls (68.8k neurons) and 462 gpt-oss calls (32.6k) in 3.3 h, about 21k neurons an hour, 500k a day (USD 5.5).
Change (qnfo-gateway/worker.js, articleFill): (1) before the selection run one UPDATE of plain_article for ok rows whose paper changed only immaterially: SET version = the paper version and body_len = LENGTH(paper body_md) where the article is younger than 30 days and the length differs by at most 20 percent (a constant ARTICLE_MATERIAL_PCT = 20), no model call; (2) the selection treats a row as stale only when the version or length change is material (more than ARTICLE_MATERIAL_PCT percent of the article body_len) or the article is older than 30 days; keep the plainRefusalSql re-trigger, the attempts cap, ARTICLE_FILL_MAX and the newest-first order unchanged; a paper with no article is still built first. (3) log built, tried, failed and refreshed in the existing articleFill line. Add a test in qnfo-gateway that replays the two SQL statements on node:sqlite (immaterial revision refreshed without a build, material revision selected, old article selected, missing article selected first). Bump VERSION with scripts/worker_release.py bump and keep deployed-current.worker.js identical.
Prediction: stale articles 352 to under 60 within a day of deploy (the refresh clears the immaterial ones at once), articleFill builds from 10 an hour to about 1 (new papers and material rewrites), qnfo-gateway kimi-k2.6 neurons from about 21k an hour to under 3k an hour, the account total about -450k neurons a day.
Closing probe: the code-probe below (the old unconditional staleness test must be absent from the selection). Live check after the deploy: the stale count of plain_article against papers (version or body length differs) read from living-paper falls from 352 to under 80.
code-probe: {"paths": ["qnfo-gateway/worker.js"], "absent": "a.version IS NOT COALESCE(p.version, '''') OR a.body_len IS NOT LENGTH(p.body_md) OR "}
code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: async function articleFill(env, only) {',
 'session:breach-cost', 'cost', 'high', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'COST-GATEWAY-ARTICLE-1:%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-breach-cost', 'a Workers AI stream that nobody budgets and that produces no new reader-facing value (a rewrite of an unchanged paper summary, a retry every hour at a 4 percent accept rate, a manager request beyond what the focus slots can act on) is cheaper to rate-limit than to run; the owner target is USD 200-300 a month all-in (spend-enforcement notes 2026-11-04)',
 'COST-LEVERS-1: manager_agent_daily_cap trigger on cf_agent_requests (48 a rolling 24 h); code task COST-GATEWAY-ARTICLE-1 filed for the qnfo-gateway article rebuild policy; with PR COST-COMPANION-1 (personal-companion 1.45.3: an empty fact-check reply counts as a reviewer error, a collapsed accept rate retries every third tick)',
 'Cloudflare GraphQL aiInferenceAdaptiveGroups hourly by model 11-04T15 to 11-05T03 (80 to 100k neurons an hour; kimi-k2.6 17 to 27k an hour, glm-5.3 22 to 25k an hour at 00-02Z, deepseek-v4.1-flash 44 to 75k an hour until 20Z and 1 to 3k after); AI Gateway logs: the same ~9k-token fact-check draft sent to 5 families at :04-:08 each hour, glm-5.3 tout 8000 in 5 of 5; companion_runs: steward collapse alert 3-5 percent over 17-30 attempts; living-paper plain_article 728 ok/failed rows, 352 stale; cf_agent_requests: 116 program-manager requests in 24 h',
 'applied by migration', 'cf_agent_requests inserts by program-manager:* only; one filed code task; no gate, cap or score is weakened (the accuracy gate of the companion is untouched)',
 'the Rollback line of migrations/2026-11-05-cost-levers-1.sql; ops_config manager_agent_daily_cap = 100000 turns the trigger off at once',
 'a shared rate on manager agent requests; the neuron meter now has an owner for each large stream',
 'manager_agent_requests_24h 116 to 48 or fewer; account neurons 2.0M to about 1.2M a day after the gateway change and COST-COMPANION-1 (meter 11-06 against 11-05)',
 'cost: workers_ai_cost_30d_usd and the 7 and 3 day paces fall as the 11-01..04 days leave their windows',
 'trigger replayed on node:sqlite by migrations/cost-levers-1.test.mjs; live reads of cf_agent_requests, living-paper and the Cloudflare meter'
WHERE NOT EXISTS (SELECT 1 FROM decision_log x WHERE x.action LIKE 'COST-LEVERS-1:%');
