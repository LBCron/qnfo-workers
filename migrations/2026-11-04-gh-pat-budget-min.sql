-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-github-pat-budget-min'; DELETE FROM failure_modes WHERE fm_key = 'github-pat-budget-floor'; DELETE FROM metric_breach_cause WHERE metric_key = 'github_pat_budget_min_24h'; DELETE FROM analytics_metric_triggers WHERE metric_key = 'github_pat_budget_min_24h'; DELETE FROM metric_registry WHERE metric = 'github_pat_budget_min_24h';
--
-- GH-BUDGET-MIN-1 (charter pillar core; follow-up of GH-BUDGET-FLOOR-1, PR 7137, docs/GH-BUDGET-FLOOR.md). The shared GitHub token read 0/5000 at about 16:20Z and
-- 17:20Z on 2026-11-04 and stalled every merge; the sweeps now yield below 600 remaining calls. github_api_remaining is one sample every 10 minutes, so a drain that
-- recovers between samples is invisible and nothing shows whether the floor held. qnfo-cloud-ops 1.45.0 keeps the lowest core.remaining of each hour
-- (scheduler_state gh_budget_min24) and writes the 24-hour minimum to github_pat_budget_min_24h. Target: at least 600 (the floor held).
-- Blind spot: only the watch's own samples, with the watch's token (the primary limit is per user, so it is the bucket the merge lane spends when both tokens are the same user).
-- spof-review: none added; no trigger, cron or credential changes.
-- CAUSE-MAPPED: INSERT OR IGNORE INTO metric_breach_cause below maps github_pat_budget_min_24h in this same file.

INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class)
VALUES ('github_pat_budget_min_24h', 'operational', 'guard',
 'lowest x-ratelimit-remaining of GET /rate_limit seen by the qnfo-cloud-ops GH-TOKEN-WATCH-1 samples in the last 24 UTC hour buckets (scheduler_state gh_budget_min24)',
 'qnfo-cloud-ops GH-BUDGET-MIN-1, every 10 minutes', '0 at 16:20Z and 17:20Z on 2026-11-04 (before GH-BUDGET-FLOOR-1)', '>= 600', 'QNFO.OPS',
 'analytics_metric_triggers github_pat_budget_min_24h -> agent_issues', '*/10', '< 600', '< 100', 'UNMEASURED', 'computed');

INSERT OR IGNORE INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
VALUES ('github_pat_budget_min_24h', 'The shared GitHub token fell below the 600-call floor in the last 24 hours', 'registry', 'lt', 600, 2,
 'Pillar core (GH-BUDGET-MIN-1). The lowest core.remaining of the shared GitHub token in 24 hours is under the GH-BUDGET-FLOOR-1 floor of 600, so a spender that does not yield (a workflow without the budget gate, the merge lane, a worker loop) drained the bucket. Find the spender: GH-BUDGET-YIELD lines in the sweeps'' logs show who stopped; the ones that did not stop are the drain. Wire the next ungated workflow listed in docs/GH-BUDGET-FLOOR.md (request-copilot-review needs a checkout, copilot-pr-lifecycle needs a per-part split) or cut the call volume of the largest loop. Done: github_pat_budget_min_24h >= 600 after a full 24 hours without a drain.
code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js
code-anchor: async function jobGhTokenWatch(env) {',
 'QNFO.OPS', 'agent_issues', 24, 1, 'GH-BUDGET-MIN-1 (migrations/2026-11-04-gh-pat-budget-min.sql)');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('github_pat_budget_min_24h', 'code-loop', 'METRIC-CAUSE-AT-REGISTRATION-1 2026-11-04: the shared GitHub token is drained by workflows and loops that lack the GH-BUDGET-FLOOR-1 gate; the repair is a code change in the spender.');

INSERT OR REPLACE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
('github-pat-budget-floor',
 'the shared GitHub token is drained to 0 of 5000 calls an hour and every PR creation and merge stalls',
 'sweeps and loops spend the lane''s bucket and nothing yields',
 'GH-BUDGET-FLOOR-1 gates the sweeps at 600; GH-BUDGET-MIN-1 measures the 24-hour minimum',
 'github_pat_budget_min_24h >= 600, refreshed within 30 minutes',
 'fm-github-pat-budget-min', '2026-11-04', NULL,
 'core.remaining below 600 at any sample',
 'merges and PR creation return 403 rate limit',
 'every GitHub write of the fleet');

INSERT OR REPLACE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, ts, module, budget_ms, max_items, requires_container, attempts) VALUES
('fm-github-pat-budget-min', NULL, 'GH-BUDGET-MIN-1', 'failure-mode detector',
 'SELECT ''1'' AS expected, CASE WHEN CAST((SELECT last_value FROM metric_registry WHERE metric = ''github_pat_budget_min_24h'') AS INTEGER) >= 600 AND datetime((SELECT last_refreshed FROM metric_registry WHERE metric = ''github_pat_budget_min_24h'')) > datetime(''now'', ''-30 minutes'') THEN ''1'' ELSE ''0'' END AS observed',
 'd1-query', 3, 'qnfo-cloud-ops', 1, 'active', datetime('now'), 'failure-mode', 45000, 5, 0, 0);
