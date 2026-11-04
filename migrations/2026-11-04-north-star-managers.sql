-- NORTH-STAR-MANAGERS-1 (2026-11-04, charter pillars autonomy, cost and reach; programs QNFO.OPS, QNFO.INFRA, QNFO.REACH, QNFO.RSCH, QNFO.PERSONAL).
-- Owner directive 2026-11-04: managers think in strategy, features and quality, not only bug fixes. Goals: people actually read the research, fleet AI cost inside USD 200-300 a month,
-- a fast simple control surface where the owner is asked for almost nothing.
-- WHAT WAS MEASURED (qnfo-audit 2026-11-04 17:00-18:00Z):
--  * The scoreboard is permanently red (94 of 297 metrics hit a trigger) and the managers rank focus by percent past threshold: v_program_focus_plan orders by breach_ratio DESC, so a
--    metric with threshold 0 and value 1512 (content_items_over_stage_sla) is rank 1 of QNFO.OPS and issues_unprobed_60m is rank 12. None of the owner's four goals has a trigger:
--    engaged_reader_sessions_7d has none, cost is judged by five overlapping metrics (workers_ai_cost_30d_usd 508, cost_usd_30d 740, fleet_cost_pace_30d_usd 1151, monthly_cost_run_rate_usd
--    1249, fleet_cost_run_rate_usd 799), dashboard load time is not measured at all.
--  * Manager agent spend: program-manager requests to the Cloudflare agent were 142 in the last 24 h (137 the day before). 115 of the 142 are lever reviews (fleet_tasks management-personas-c
--    lever-request): 332 in 7 days, 44 with a usable reply (13 percent), asked again every hour for the same metric until a reply parses (trigger 14606 doctor_taint_violations_24h: 29 asks in 7 days).
--  * Roadmap origination (ROADMAP-ORIGINATE-1): 13 proposals in 7 days, 17 in 14, 14 deployed. ops_config roadmap_originate = on and code_merge_trusted_sources holds
--    management-personas|ROADMAP-1: (both read live). The throttle is not the switch: rm-research counts ALL open ROADMAP-1 issues of the program against a limit of 3, and
--    session-filed items from 10-26 still sit open (QNFO.RSCH 3 of 3, QNFO.REACH 6, QNFO.INFRA 2, QNFO.OPS 2), so RSCH has asked nothing since 10-31 and REACH answers every day while
--    OPS and INFRA get a preface-only reply ("I will research the program's data before proposing") that rm-research counts as an answer and never asks again that day.
--  * Dashboard: the new dashboard-load journey (scripts/fleet_journeys.py, this change) measured fleet.qnfo.org/ 909 ms and /api/managers 3344 ms from the runner on 2026-11-04.
-- WHAT THIS CHANGES (all in D1, one switch per behaviour, no worker edited, no cron added because fleet_budget caps are breached):
--  (1) FOUR NORTH STAR MEASURES (north_star_measures, v_north_star_state): readers = ns_readers_engaged_per_day (engaged_reader_sessions_7d / 7, target >= 12, now 6.3) with
--      ns_ext_visits_per_paper_30d (external-referrer loads per paper, target >= 0.25, now 0.07); cost = ns_fleet_cost_usd_month (fleet-scope cost_daily, 7 day run rate x 30, target <= 300,
--      now 799; the Cloudflare meter, because ai_call_counters holds 37 percent of it; owner-direct provider spend is excluded); owner load = ns_owner_urgent_cards (open IDENTITY-BOUND
--      cards above severity low, target <= 2, now 3); reliability = ns_dashboard_load_ms_p75_24h (dashboard-load journey, target <= 3000, unmeasured until the first runner pass) with
--      runtime_verified_share_24h. Each has a trigger and a cause mapping below. Their program owners are in north_star_program.
--  (2) FOCUS: v_program_focus_plan puts North Star metric issues first, then drivers (north_star_links tier driver, and strategic roadmap items), then everything else in the old order, and
--      keeps demoted hygiene metrics last and at most north_star_hygiene_slots (2) per program. Slots: a program that owns a breached North Star measure gets north_star_slot_bonus (2) more.
--      A trigger issue of a North Star metric or driver is pinned to its owner program (ns-pin). A guard-kind metric never ranks as hygiene and ranks right after the North Star drivers. ops_config north_star_focus = off restores the old order.
--  (3) ROADMAP: rm-research asks for ONE strategic proposal with NORTHSTAR and PREDICT lines, counts only manager-originated open items against its limit of 3, and asks again (up to 3 times a day)
--      when the reply has no TITLE and code-anchor; rm-meta records the North Star and the prediction (roadmap_proposal_meta); rm-file puts them in the issue; the product plus flow carries the
--      same two lines. Metrics roadmap_proposals_7d, roadmap_strategic_proposals_7d and programs_without_strategic_proposal_7d (trigger: any program without a strategic proposal in 7 days).
--  (4) SPEND: lever-request skips demoted hygiene metrics, asks at most lever_per_trigger_daily (2) times a day per metric and lever_daily_cap (24) a day in all, North Star metrics first.
--      ops_config north_star_lever_gate = off restores the old asks. Ten metrics are reviewed in control_registry (ns-review:*): six demoted (applied), three retire recommendations (planned).
--  (5) KEEP OR REVERT: north_star_experiments north-star-managers-1 reads on 2026-11-11 and writes keep, partial or revert (revert switches (2) and (4) off when a guard metric worsened);
--      decision_log carries the prediction below and the verdict.
-- PREDICTIONS (decision_log): within 7 days (a) lever asks per day fall from 115 to 40 or fewer and manager agent requests from 142 to 60 or fewer, (b) at least 3 of the 4 researching programs originate a strategic
-- proposal in a week (0 do now), (c) at least 25 percent of focus slots hold North Star linked issues (at baseline: see north_star_experiments.baseline), with no guard worse: metrics_in_breach (not counting the nine metrics this file registers) not more
-- than 8 above baseline, open_agent_issues not 20 percent above, issue_wontfix_share_7d not 5 points above (it is a percent), remediation_latest_pass_pct_7d not 5 points below. Falsifier: any guard worse, or
-- lever asks not below 35 percent of baseline, reads partial and opens a second window.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_ns_tasks
-- Rollback: UPDATE ops_config SET value = 'off', updated_at = datetime('now') WHERE key IN ('north_star_focus', 'north_star_lever_gate'); UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_ns_tasks b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = datetime('now') WHERE id IN (SELECT id FROM bak_20261104_ns_tasks); UPDATE analytics_metric_triggers SET enabled = 0 WHERE metric_key IN ('ns_readers_engaged_per_day', 'ns_ext_visits_per_paper_30d', 'ns_fleet_cost_usd_month', 'ns_owner_urgent_cards', 'ns_dashboard_load_ms_p75_24h', 'roadmap_proposals_7d', 'roadmap_strategic_proposals_7d', 'programs_without_strategic_proposal_7d', 'manager_agent_requests_24h'); UPDATE metric_registry SET state = 'RETIRED' WHERE metric IN ('ns_readers_engaged_per_day', 'ns_ext_visits_per_paper_30d', 'ns_fleet_cost_usd_month', 'ns_owner_urgent_cards', 'ns_dashboard_load_ms_p75_24h', 'roadmap_proposals_7d', 'roadmap_strategic_proposals_7d', 'programs_without_strategic_proposal_7d', 'manager_agent_requests_24h'); DELETE FROM control_registry WHERE control LIKE 'ns-review:%'. The two views read ops_config north_star_focus and rank and allocate exactly as before while it is off.
-- spof-review: the new steps run inside the existing hourly management-personas workflows (one producer each, :35 and :49); a missed run leaves the North Star values one hour older.
-- runtime-probe (D1): SELECT metric, last_value, last_refreshed FROM metric_registry WHERE metric = 'ns_fleet_cost_usd_month' -- expected a number and a refresh within 3 h
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps the nine metrics in this same file.

-- ---- backups ---------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bak_20261104_ns_tasks AS
SELECT id, definition, version FROM fleet_tasks WHERE id IN ('management-personas', 'management-personas-c', 'management-personas-plus');

CREATE TABLE IF NOT EXISTS bak_20261104_ns_views AS
SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name IN ('v_program_focus_plan', 'v_portfolio_allocation_plan');

-- ---- tables ----------------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS north_star_measures (
  key TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  metric TEXT NOT NULL,
  companion_metric TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  target REAL NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS north_star_program (
  program_code TEXT NOT NULL,
  north_star TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'contributor')),
  PRIMARY KEY (program_code, north_star)
);

CREATE TABLE IF NOT EXISTS north_star_links (
  metric_key TEXT PRIMARY KEY,
  north_star TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('northstar', 'driver', 'hygiene')),
  weight REAL NOT NULL DEFAULT 1.0,
  pin_program TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS roadmap_proposal_meta (
  proposal_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('strategic', 'tactical')),
  north_star TEXT,
  prediction TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS north_star_experiments (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  check_at TEXT NOT NULL,
  predicted TEXT NOT NULL,
  baseline TEXT NOT NULL,
  verdict TEXT,
  verdict_at TEXT,
  evidence TEXT
);

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at) VALUES
  ('north_star_focus', 'on', 'NORTH-STAR-MANAGERS-1 focus order and slot bonus; off restores the old order', datetime('now')),
  ('north_star_lever_gate', 'on', 'NORTH-STAR-MANAGERS-1 lever-request gate; off restores the old asks', datetime('now')),
  ('north_star_slot_bonus', '2', 'focus slots a program gets per breached North Star measure it owns', datetime('now')),
  ('north_star_hygiene_slots', '2', 'focus slots a program spends on demoted hygiene metrics at most', datetime('now')),
  ('lever_daily_cap', '24', 'lever reviews the managers may ask the Cloudflare agent for in 24 h', datetime('now')),
  ('lever_per_trigger_daily', '2', 'lever reviews per metric trigger in 24 h', datetime('now')),
  ('north_star_since', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'proposals created from here on get a roadmap_proposal_meta row', datetime('now'));

-- ---- the four North Star measures ------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO north_star_measures (key, goal, metric, companion_metric, direction, target, note) VALUES
  ('readers', 'People actually read the research: engaged sessions from outside the fleet, not clicks', 'ns_readers_engaged_per_day', 'ns_ext_visits_per_paper_30d', 'up', 12,
   'baseline 6.3 a day on 2026-11-04 (44 externally sourced engaged GA4 sessions in 7 days, flat while output rose 10x); STRATEGY s9 asks for x2 by 2026-12-31'),
  ('cost', 'Fleet AI cost inside USD 200-300 a month', 'ns_fleet_cost_usd_month', NULL, 'down', 300,
   'fleet-scope cost_daily (the Cloudflare meter) 7 day run rate x 30, baseline 799 on 2026-11-04; owner-direct provider spend (15 USD a day, unverified) is not fleet-controlled and is excluded; ai_call_counters holds about 37 percent of the meter'),
  ('owner_load', 'The owner is asked for almost nothing: urgent IDENTITY-BOUND cards open', 'ns_owner_urgent_cards', 'human_wait_oldest_days', 'down', 2,
   'open human_actions with an IDENTITY-BOUND line and severity above low, baseline 3 on 2026-11-04'),
  ('reliability', 'A fast, verified control surface: dashboard load time and the share of closes seen by an independent runtime probe', 'ns_dashboard_load_ms_p75_24h', 'runtime_verified_share_24h', 'down', 3000,
   'p75 of the dashboard-load journey (fleet.qnfo.org/ plus /api/managers from the GitHub runner), first measured 4254 ms on 2026-11-04; runtime_verified_share_24h is 11.9 against its target of 25');

INSERT OR IGNORE INTO north_star_program (program_code, north_star, role) VALUES
  ('QNFO.REACH', 'readers', 'owner'),
  ('QNFO.RSCH', 'readers', 'contributor'),
  ('QNFO.RSCH', 'cost', 'contributor'),
  ('QNFO.INFRA', 'cost', 'owner'),
  ('QNFO.INFRA', 'reliability', 'owner'),
  ('QNFO.OPS', 'owner_load', 'owner'),
  ('QNFO.OPS', 'reliability', 'contributor'),
  ('QNFO.PERSONAL', 'owner_load', 'contributor');

INSERT OR IGNORE INTO north_star_links (metric_key, north_star, tier, weight, pin_program, reason) VALUES
  ('ns_readers_engaged_per_day', 'readers', 'northstar', 10, NULL, 'North Star readers'),
  ('ns_ext_visits_per_paper_30d', 'readers', 'northstar', 9, NULL, 'North Star readers, per paper'),
  ('ns_fleet_cost_usd_month', 'cost', 'northstar', 10, NULL, 'North Star cost'),
  ('ns_owner_urgent_cards', 'owner_load', 'northstar', 10, NULL, 'North Star owner load'),
  ('ns_dashboard_load_ms_p75_24h', 'reliability', 'northstar', 10, NULL, 'North Star reliability'),
  ('engaged_reader_sessions_7d', 'readers', 'driver', 6, NULL, 'the number ns_readers_engaged_per_day is built from'),
  ('social_engaged_sessions_7d', 'readers', 'driver', 4, NULL, 'promotion outcome that replaces counted clicks'),
  ('outreach_engaged_per_100_clicks_7d', 'readers', 'driver', 4, NULL, 'how much of outreach is reading'),
  ('reader_signal_7d', 'readers', 'driver', 3, NULL, 'reader reports and ask feedback'),
  ('product_task_share_7d', 'readers', 'driver', 4, 'QNFO.OPS', 'share of code work that reaches products and research'),
  ('plus_shipped_7d', 'readers', 'driver', 4, 'QNFO.OPS', 'plussing is how products get better for readers'),
  ('product_plus_rate_7d', 'readers', 'driver', 4, 'QNFO.OPS', 'plussing cadence per product'),
  ('plus_keep_rate_30d', 'readers', 'driver', 3, 'QNFO.OPS', 'plusses that stayed'),
  ('dmarc_aligned_pass_rate', 'readers', 'driver', 5, NULL, 'subscribers only read what the mailbox accepts'),
  ('a11y_violations_serious', 'readers', 'driver', 3, NULL, 'readers who cannot use the page do not read it'),
  ('q08_gate_pass_rate_7d', 'readers', 'driver', 3, NULL, 'q08 pieces that reach readers'),
  ('q08_verified_votes_7d', 'readers', 'driver', 3, NULL, 'reader votes on q08'),
  ('correction_latency_p95_h', 'readers', 'driver', 3, 'QNFO.RSCH', 'trust in published papers'),
  ('pageviews_30d', 'readers', 'driver', 3, NULL, 'visits, a proxy for readers'),
  ('subscribers_growth_monthly', 'readers', 'driver', 3, NULL, 'return readers'),
  ('referral_30d', 'readers', 'driver', 3, NULL, 'outsiders who arrived'),
  ('programs_without_strategic_proposal_7d', 'readers', 'driver', 4, 'QNFO.OPS', 'the managers originate strategy: no program may go a week without a strategic proposal'),
  ('fleet_cost_pace_30d_usd', 'cost', 'driver', 6, NULL, 'all-in cost pace against the 300 USD ceiling'),
  ('workers_ai_cost_30d_usd', 'cost', 'driver', 6, NULL, 'the largest cost line'),
  ('workers_ai_attribution_coverage_pct', 'cost', 'driver', 5, NULL, 'spend that is not attributed cannot be cut'),
  ('ai_cache_hit_rate', 'cost', 'driver', 5, NULL, 'AI Gateway cache hits are free calls'),
  ('gateway_coverage', 'cost', 'driver', 5, NULL, 'calls outside the gateway are not cached or capped'),
  ('research_neurons_per_publication_7d', 'cost', 'driver', 5, 'QNFO.RSCH', 'research cost per paper'),
  ('research_neurons_per_engaged_session_7d', 'cost', 'driver', 5, 'QNFO.RSCH', 'research cost per engaged reader'),
  ('q08_neurons_per_published_piece_7d', 'cost', 'driver', 4, 'QNFO.REACH', 'q08 cost per piece'),
  ('ask_cost_per_answer_usd_7d', 'cost', 'driver', 3, 'QNFO.RSCH', 'ask cost per answer'),
  ('unmanaged_direct_spend_share', 'cost', 'driver', 3, NULL, 'spend outside the managed route'),
  ('cost_attribution_gap_pct', 'cost', 'driver', 3, NULL, 'paid requests with no caller'),
  ('manager_agent_requests_24h', 'cost', 'driver', 6, 'QNFO.OPS', 'the managers own agent calls are a cost line'),
  ('human_wait_oldest_days', 'owner_load', 'driver', 5, NULL, 'how long the oldest owner card has waited'),
  ('human_wait_oldest_min', 'owner_load', 'driver', 3, NULL, 'oldest owner card age in minutes'),
  ('owner_dispatched_items_7d', 'owner_load', 'driver', 5, NULL, 'items routed to the owner'),
  ('human_actions_open', 'owner_load', 'driver', 4, NULL, 'open owner cards'),
  ('owner_queue_live_open', 'owner_load', 'driver', 4, NULL, 'live owner queue'),
  ('session_dependent_issues_open', 'owner_load', 'driver', 3, NULL, 'issues that wait for a person or a session'),
  ('runtime_verified_share_24h', 'reliability', 'driver', 6, NULL, 'closes seen by an independent runtime probe'),
  ('attributed_runtime_verified_share_24h', 'reliability', 'driver', 4, NULL, 'same, attributed'),
  ('mttr_h_7d', 'reliability', 'driver', 4, NULL, 'time to repair'),
  ('slo_attainment_28d_min', 'reliability', 'driver', 4, NULL, 'the worst SLO'),
  ('post_deploy_error_workers', 'reliability', 'driver', 4, NULL, 'workers that error after a deploy'),
  ('ask_p95_total_ms_7d', 'reliability', 'driver', 4, 'QNFO.RSCH', 'the ask surface latency'),
  ('fleet_journeys_failing', 'reliability', 'driver', 4, NULL, 'user journeys that fail'),
  ('content_items_over_stage_sla', NULL, 'hygiene', 0, NULL, 'target 0 against 1512 can never be the day''s work and it held rank 1 of QNFO.OPS with no doer; the content backlog follows the research volume that READER-YIELD-1 and SPEND-ENFORCE-1 deliberately cut'),
  ('fleet_quality_change_7d', NULL, 'hygiene', 0, NULL, 'a derived index of other metrics (metrics about metrics)'),
  ('issues_open_over_120m', NULL, 'hygiene', 0, NULL, 'counts the same open backlog as sla_breaches_over_120m, issues_over_24h_no_doer and open_agent_issues'),
  ('sla_breaches_over_120m', NULL, 'hygiene', 0, NULL, 'counts the same open backlog as issues_open_over_120m and stuck_items_over_sla'),
  ('tracker_drift', NULL, 'hygiene', 0, NULL, 'GitHub mirror drift, which ISSUE-HYGIENE-1 already treats as not work'),
  ('idea_to_publish_h_p50_7d', NULL, 'hygiene', 0, NULL, 'latency of research output, which the owner wants fewer of until readers follow'),
  ('orphan_issues_no_live_path', NULL, 'hygiene', 0, NULL, 'third metric for issues without a doer, with issues_over_24h_no_doer and breaches_undiagnosed_over_60m'),
  ('metrics_worsening_7d', NULL, 'hygiene', 0, NULL, 'a count over other metrics (metrics about metrics)'),
  ('breaches_undiagnosed_over_60m', NULL, 'hygiene', 0, NULL, 'second metric for issues without a doer, with issues_over_24h_no_doer'),
  ('monthly_cost_run_rate_usd', NULL, 'hygiene', 0, NULL, 'superseded by ns_fleet_cost_usd_month and fleet_cost_pace_30d_usd, and it adds 450 USD of unverified owner-direct spend');

-- ---- metrics, their values, cause mapping and triggers ---------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, target, owner, disposition_actor, refresh_cadence, state) VALUES
  ('ns_readers_engaged_per_day', 'outcome', 'target', 'engaged_reader_sessions_7d / 7 (GA4 engaged sessions from sources outside the fleet)', 'metric_registry engaged_reader_sessions_7d', '>= 12 (North Star readers: x2 of the 2026-11-04 baseline of 6.3)', 'program-manager:QNFO.REACH', 'managers', 'hourly', 'MEASURED'),
  ('ns_ext_visits_per_paper_30d', 'outcome', 'target', 'sum of external-referrer page loads in 30 days / papers in paper_readership', 'paper_readership.ext_30d', '>= 0.25 (North Star readers, per paper: x3 of 0.07)', 'program-manager:QNFO.REACH', 'managers', 'hourly', 'MEASURED'),
  ('ns_fleet_cost_usd_month', 'outcome', 'cost', 'fleet-scope cost_daily usd over the last 7 complete days / days x 30', 'cost_daily scope fleet (Cloudflare meter)', '<= 300 (North Star cost: owner 2026-11-04 USD 200-300 a month)', 'program-manager:QNFO.INFRA', 'managers', 'hourly', 'MEASURED'),
  ('ns_owner_urgent_cards', 'outcome', 'target', 'open human_actions with an IDENTITY-BOUND line and severity above low', 'human_actions', '<= 2 (North Star owner load)', 'program-manager:QNFO.OPS', 'managers', 'hourly', 'MEASURED'),
  ('ns_dashboard_load_ms_p75_24h', 'outcome', 'target', 'p75 of journey_runs.ms for journey dashboard-load, runner gha, last 24 h (home plus /api/managers fetched in turn)', 'journey_runs', '<= 3000 (North Star reliability)', 'program-manager:QNFO.INFRA', 'managers', 'hourly', 'MEASURED'),
  ('roadmap_proposals_7d', 'operational', 'leading', 'roadmap_proposals created in the last 7 days', 'roadmap_proposals', 'reported weekly; no absolute gate (see roadmap_strategic_proposals_7d)', 'program-manager:QNFO.OPS', 'managers', 'hourly', 'MEASURED'),
  ('roadmap_strategic_proposals_7d', 'operational', 'leading', 'roadmap_proposals with a roadmap_proposal_meta row of kind strategic (NORTHSTAR and PREDICT lines) created in 7 days', 'roadmap_proposal_meta', '>= 4 (one a week for each of four researching programs)', 'program-manager:QNFO.OPS', 'managers', 'hourly', 'MEASURED'),
  ('programs_without_strategic_proposal_7d', 'operational', 'target', 'active programs other than QNFO.PERSONAL with no strategic roadmap proposal in 7 days (PERSONAL is covered by the product plus flow and shows in roadmap_proposals_7d)', 'program_charters, roadmap_proposal_meta', '0', 'program-manager:QNFO.OPS', 'managers', 'hourly', 'MEASURED'),
  ('manager_agent_requests_24h', 'operational', 'cost', 'cf_agent_requests from program-manager:* in the last 24 h', 'cf_agent_requests', '<= 60 (was 142 on 2026-11-04, 115 of them lever reviews)', 'program-manager:QNFO.OPS', 'managers', 'hourly', 'MEASURED');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('ns_readers_engaged_per_day', 'publishing', 'North Star readers'),
  ('ns_ext_visits_per_paper_30d', 'publishing', 'North Star readers, per paper'),
  ('ns_fleet_cost_usd_month', 'spend', 'North Star cost'),
  ('ns_owner_urgent_cards', 'owner-routing', 'North Star owner load'),
  ('ns_dashboard_load_ms_p75_24h', 'structure', 'North Star reliability'),
  ('roadmap_proposals_7d', 'code-loop', 'roadmap origination volume'),
  ('roadmap_strategic_proposals_7d', 'code-loop', 'strategic roadmap origination'),
  ('programs_without_strategic_proposal_7d', 'code-loop', 'strategic roadmap origination'),
  ('manager_agent_requests_24h', 'spend', 'manager agent spend');

-- values now (the same statement is the ns-refresh step of the hourly management-personas workflow)
UPDATE metric_registry SET last_value = CAST(CASE metric WHEN 'ns_readers_engaged_per_day' THEN (SELECT ROUND(CAST(e.last_value AS REAL) / 7.0, 2) FROM metric_registry e WHERE e.metric = 'engaged_reader_sessions_7d' AND trim(COALESCE(e.last_value, '')) <> '' AND rtrim(trim(e.last_value), '% ') NOT GLOB '*[^0-9.+-]*') WHEN 'ns_ext_visits_per_paper_30d' THEN (SELECT ROUND(1.0 * SUM(ext_30d) / MAX(COUNT(*), 1), 3) FROM paper_readership) WHEN 'ns_fleet_cost_usd_month' THEN (SELECT ROUND(SUM(usd) * 30.0 / COUNT(DISTINCT date), 2) FROM cost_daily WHERE scope = 'fleet' AND date >= date('now', '-7 day') AND date < date('now')) WHEN 'ns_owner_urgent_cards' THEN (SELECT COUNT(*) FROM human_actions WHERE status = 'open' AND COALESCE(sev, 'normal') <> 'low' AND instr(COALESCE(why, ''), 'IDENTITY-BOUND:') > 0) WHEN 'ns_dashboard_load_ms_p75_24h' THEN (SELECT ms FROM journey_runs WHERE journey = 'dashboard-load' AND runner = 'gha' AND ok = 1 AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day') ORDER BY ms LIMIT 1 OFFSET (SELECT CAST(0.75 * (COUNT(*) - 1) AS INTEGER) FROM journey_runs WHERE journey = 'dashboard-load' AND runner = 'gha' AND ok = 1 AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day'))) WHEN 'roadmap_proposals_7d' THEN (SELECT COUNT(*) FROM roadmap_proposals WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) WHEN 'roadmap_strategic_proposals_7d' THEN (SELECT COUNT(*) FROM roadmap_proposals p JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = 'strategic' WHERE p.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')) WHEN 'programs_without_strategic_proposal_7d' THEN (SELECT COUNT(*) FROM program_charters c WHERE c.status = 'active' AND c.program_code <> 'QNFO.PERSONAL' AND NOT EXISTS (SELECT 1 FROM roadmap_proposals p JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = 'strategic' WHERE p.program_code = c.program_code AND p.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days'))) WHEN 'manager_agent_requests_24h' THEN (SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= 'program-manager:' AND requester < 'program-manager;' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')) END AS TEXT), last_refreshed = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), state = 'MEASURED' WHERE metric IN ('ns_readers_engaged_per_day', 'ns_ext_visits_per_paper_30d', 'ns_fleet_cost_usd_month', 'ns_owner_urgent_cards', 'ns_dashboard_load_ms_p75_24h', 'roadmap_proposals_7d', 'roadmap_strategic_proposals_7d', 'programs_without_strategic_proposal_7d', 'manager_agent_requests_24h');

INSERT OR IGNORE INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes) VALUES
  ('ns_readers_engaged_per_day', 'North Star readers: externally sourced engaged reader sessions a day are below the target of 12', 'registry', 'lt', 12, 2, 'Pillar reach. North Star readers (owner 2026-11-04: people actually read the research). Engaged GA4 sessions from sources outside the fleet are engaged_reader_sessions_7d / 7 (6.3 a day on 2026-11-04). Lever: pick ONE move from v_paper_readers_top and v_reader_yield_by_source (the papers and sources that did bring an outsider): give those papers a second post, a feed entry or a better landing page (ROADMAP-1 READER-YIELD-1.3 and 1.4 are the open builders). Do not raise research output to raise this number: it did not move when output rose 10x (READER-YIELD-1). Definition of done: ns_readers_engaged_per_day >= 12 on 7 consecutive days.', 'program-manager:QNFO.REACH', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04'),
  ('ns_ext_visits_per_paper_30d', 'North Star readers: external visits per paper in 30 days are below the target of 0.25', 'registry', 'lt', 0.25, 3, 'Pillar reach. Page loads with a referrer outside the fleet per paper (paper_readership.ext_30d, 0.07 on 2026-11-04) are the only per-paper count that is not a floor of automated visits. Lever: see v_paper_readers_top for the few papers an outsider reached and extend what worked (title, summary, channel). Definition of done: >= 0.25 for 7 days.', 'program-manager:QNFO.REACH', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04'),
  ('ns_fleet_cost_usd_month', 'North Star cost: the fleet-controlled AI cost run rate is above USD 300 a month', 'registry', 'gt', 300, 2, 'Pillar cost. Owner 2026-11-04: fleet AI cost inside USD 200-300 a month. The number is the fleet-scope cost_daily meter (7 day run rate x 30), 799 on 2026-11-04. Lever: read the meter by model and caller (AI-METER-MODEL-1, ai_gateway logs metadata.caller) and cut the largest share: qnfo-agents loops (issue-probe-agent, the managers lever reviews, now capped), research-exec, q08. A breached cap steers to cheaper models and never stops work (BUDGET-SOFT-ROUTE-1). Definition of done: ns_fleet_cost_usd_month <= 300 for 7 days.', 'program-manager:QNFO.INFRA', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04'),
  ('ns_owner_urgent_cards', 'North Star owner load: more than 2 urgent IDENTITY-BOUND cards are open', 'registry', 'gt', 2, 2, 'Pillar autonomy. Owner 2026-11-04: the owner is asked for almost nothing. Open human_actions with an IDENTITY-BOUND line and severity above low: SELECT id, slug, title, created_at FROM human_actions WHERE status = ''open'' ORDER BY id. Lever: for each card run the red-team (blocker_redteam): is there another surface that does the step without the owner (never a way past a refused check)? Close what the fleet can do with its closing probe, and write what only the owner can do as one short card. Definition of done: <= 2 on 7 consecutive days.', 'program-manager:QNFO.OPS', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04'),
  ('ns_dashboard_load_ms_p75_24h', 'North Star reliability: the dashboard takes more than 3000 ms to load', 'registry', 'gt', 3000, 2, 'Pillar reliability. The dashboard-load journey (scripts/fleet_journeys.py, runner gha) fetches fleet.qnfo.org/ and /api/managers in turn from outside Cloudflare. First reading 2026-11-04: 909 ms and 3344 ms. Lever: read journey_runs.path_json per request, find the slow hop, then cache or precompute it (the managers API reads persona_briefs and program views: a view that scans is the usual cause, see D1-OVERLOAD-1). The dashboard code is qnfo-fleet-dashboard: review open pull requests and live claims before editing. Definition of done: ns_dashboard_load_ms_p75_24h <= 3000 for 3 days.', 'program-manager:QNFO.INFRA', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04'),
  ('programs_without_strategic_proposal_7d', 'A researching program manager has not originated a strategic roadmap proposal in 7 days', 'registry', 'gt', 0, 3, 'Pillar autonomy (ROADMAP-ORIGINATE-1). Every researching program (OPS, INFRA, REACH, RSCH) originates at least one strategic proposal a week: TITLE, WHY, NORTHSTAR, PREDICT, code-task and code-anchor. Lever: SELECT instance, status, substr(result, 1, 120) FROM cf_agent_requests WHERE instance LIKE ''roadmap-%'' ORDER BY id DESC LIMIT 12. A reply with a preface only is discarded and asked again up to 3 times a day by rm-research. If every attempt fails the agent loop (qnfo-agents) is the cause and the lever is its reply format, not the program. Definition of done: 0 for 7 consecutive days.', 'program-manager:QNFO.OPS', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04'),
  ('manager_agent_requests_24h', 'The program managers spent more than 60 Cloudflare agent requests in 24 hours', 'registry', 'gt', 60, 3, 'Pillar cost. The knobs are ops_config lever_daily_cap, lever_per_trigger_daily and north_star_links tier hygiene (the lever-request step of management-personas-c). Top askers: SELECT substr(instance, 1, 10) AS kind, COUNT(*) FROM cf_agent_requests WHERE requester >= ''program-manager:'' AND requester < ''program-manager;'' AND created_at >= datetime(''now'', ''-1 day'') GROUP BY 1 ORDER BY 2 DESC. Definition of done: <= 60 for 3 consecutive days.', 'program-manager:QNFO.OPS', 'agent_issues', 2, 1, 'NORTH-STAR-MANAGERS-1 2026-11-04');

-- metric-exemption: roadmap_proposals_7d and roadmap_strategic_proposals_7d have no trigger of their own. They report weekly proposals (the second one is the numerator the
-- programs_without_strategic_proposal_7d trigger judges), and a trigger on a count of the managers own output would only file the managers a task about themselves.

-- ---- views -----------------------------------------------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_north_star_state;
CREATE VIEW v_north_star_state AS
SELECT x.*,
  CASE WHEN x.val IS NULL THEN NULL WHEN x.direction = 'up' THEN x.val < x.target ELSE x.val > x.target END AS breached,
  CASE WHEN x.val IS NULL THEN NULL
       WHEN x.direction = 'up' THEN ROUND(MAX(0, x.target - x.val) / MAX(ABS(x.target), 1.0), 4)
       ELSE ROUND(MAX(0, x.val - x.target) / MAX(ABS(x.target), 1.0), 4) END AS gap
FROM (
  SELECT s.key, s.goal, s.metric, s.direction, s.target, s.companion_metric,
    CASE WHEN r.last_value IS NOT NULL AND trim(r.last_value) <> '' AND rtrim(trim(r.last_value), '% ') NOT GLOB '*[^0-9.+-]*' THEN CAST(r.last_value AS REAL) END AS val,
    r.last_refreshed
  FROM north_star_measures s LEFT JOIN metric_registry r ON r.metric = s.metric
) x;

DROP VIEW IF EXISTS v_issue_north_star;
CREATE VIEW v_issue_north_star AS
SELECT a.id AS issue_id, t.metric_key, l.north_star AS ns_key, l.tier AS ns_tier, l.weight AS ns_weight, l.pin_program, mr.kind AS metric_kind
FROM agent_issues a
JOIN analytics_metric_triggers t ON a.title LIKE 'METRIC-TRIGGER-%' AND t.id = CAST(substr(a.title, 16, instr(substr(a.title, 16), '-') - 1) AS INTEGER)
LEFT JOIN north_star_links l ON l.metric_key = t.metric_key
LEFT JOIN metric_registry mr ON mr.metric = t.metric_key
WHERE a.status = 'open'
UNION ALL
SELECT p.issue_id, NULL, m.north_star, 'driver', 5.0, p.program_code, NULL
FROM roadmap_proposals p
JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = 'strategic'
JOIN agent_issues a ON a.id = p.issue_id AND a.status = 'open'
WHERE p.issue_id IS NOT NULL;

DROP VIEW IF EXISTS v_north_star_focus_mix;
CREATE VIEW v_north_star_focus_mix AS
SELECT f.program_code, COUNT(*) AS focus_total,
  SUM(CASE WHEN n.ns_tier IN ('northstar', 'driver') THEN 1 ELSE 0 END) AS ns_linked,
  SUM(CASE WHEN n.ns_tier = 'hygiene' THEN 1 ELSE 0 END) AS hygiene,
  SUM(CASE WHEN f.has_doer = 0 THEN 1 ELSE 0 END) AS no_doer
FROM program_focus f LEFT JOIN v_issue_north_star n ON n.issue_id = f.issue_id
GROUP BY f.program_code;

DROP VIEW IF EXISTS v_program_focus_plan;
CREATE VIEW v_program_focus_plan AS
WITH cfg AS (
  SELECT COALESCE((SELECT value FROM ops_config WHERE key = 'north_star_focus'), 'on') = 'on' AS on_,
    COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = 'north_star_hygiene_slots'), 2) AS hy_slots
),
scored AS (
  SELECT c.program_code, c.id, c.tier, c.has_doer, c.primary_metric, c.rn,
    t.metric_key, v.val, v.threshold, v.operator,
    CASE WHEN v.hit = 1 AND v.val IS NOT NULL AND v.threshold IS NOT NULL
      THEN ROUND(
        CASE WHEN v.operator IN ('gt', 'gte') THEN MAX(0, v.val - v.threshold)
             WHEN v.operator IN ('lt', 'lte') THEN MAX(0, v.threshold - v.val)
             WHEN v.operator = 'eq' THEN 0
             ELSE MAX(0, v.val - v.threshold) END
        / MAX(ABS(v.threshold), 1.0), 6)
    END AS breach_ratio,
    CASE WHEN NOT (SELECT on_ FROM cfg) THEN 2
         WHEN n.ns_tier = 'northstar' THEN 0
         WHEN n.ns_tier = 'driver' THEN 1
         WHEN n.ns_tier = 'hygiene' AND COALESCE(n.metric_kind, '') <> 'guard' THEN 3
         WHEN COALESCE(n.metric_kind, '') = 'guard' THEN 1
         ELSE 2 END AS ns_class,
    CASE WHEN (SELECT on_ FROM cfg) THEN COALESCE(n.ns_weight, 0) ELSE 0 END AS ns_weight,
    n.ns_key
  FROM v_program_focus_candidates c
  LEFT JOIN analytics_metric_triggers t
    ON c.title LIKE 'METRIC-TRIGGER-%'
   AND t.id = CAST(substr(c.title, 16, instr(substr(c.title, 16), '-') - 1) AS INTEGER)
  LEFT JOIN v_metric_trigger_state v ON v.id = t.id
  LEFT JOIN v_issue_north_star n ON n.issue_id = c.id
),
ranked AS (
  SELECT scored.*,
    ROW_NUMBER() OVER (
      PARTITION BY program_code
      ORDER BY ns_class, -ns_weight,
        CASE WHEN breach_ratio IS NULL THEN 1 ELSE 0 END,
        breach_ratio DESC, rn, id
    ) AS manager_rank,
    ROW_NUMBER() OVER (
      PARTITION BY program_code, ns_class
      ORDER BY CASE WHEN breach_ratio IS NULL THEN 1 ELSE 0 END, breach_ratio DESC, rn, id
    ) AS class_rank
  FROM scored
)
SELECT r.program_code, r.id AS issue_id, r.manager_rank AS rank, r.tier, r.has_doer,
  CASE WHEN r.breach_ratio IS NOT NULL
    THEN 'worst off-target metric ' || r.metric_key || ' (' ||
      CASE WHEN ABS(r.threshold) < 1
        THEN ROUND(r.breach_ratio, 1) || ' normalized units beyond threshold'
        ELSE ROUND(r.breach_ratio * 100, 1) || '% beyond threshold'
      END || ')'
    ELSE CASE r.tier WHEN 0 THEN 'primary metric ' || r.primary_metric
                     WHEN 1 THEN 'guard metric' WHEN 2 THEN 'critical'
                     WHEN 3 THEN 'high' ELSE 'oldest open' END
  END
  || CASE WHEN r.ns_class <= 1 AND r.ns_key IS NOT NULL THEN ' [north star: ' || r.ns_key || ']'
          WHEN r.ns_class = 1 THEN ' [guard metric]'
          WHEN r.ns_class = 3 THEN ' [hygiene metric: demoted]' ELSE '' END AS reason
FROM ranked r
JOIN portfolio_allocations pa
  ON pa.program_code = r.program_code
 AND pa.tick = (SELECT MAX(tick) FROM portfolio_allocations)
WHERE r.manager_rank <= pa.slots
  AND (r.ns_class < 3 OR r.class_rank <= (SELECT hy_slots FROM cfg));

DROP VIEW IF EXISTS v_portfolio_allocation_plan;
CREATE VIEW v_portfolio_allocation_plan AS
WITH cfg AS (
  SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = 'persona_focus_slots' AND CAST(value AS INTEGER) > 0), 25) AS slots,
    CASE WHEN COALESCE((SELECT value FROM ops_config WHERE key = 'north_star_focus'), 'on') = 'on'
         THEN COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = 'north_star_slot_bonus'), 2) ELSE 0 END AS bonus
),
r AS (
  SELECT p.program_code, p.manager_persona, p.verdict, p.risk, p.open_issues,
    (SELECT a.risk_score FROM portfolio_allocations a WHERE a.program_code = p.program_code
       AND a.tick <= strftime('%Y-%m-%dT%H:00Z', 'now', '-24 hours') ORDER BY a.tick DESC LIMIT 1) AS risk_24h,
    (SELECT q.quality_index FROM quality_trend q WHERE q.scope = p.program_code AND q.tick = strftime('%Y-%m-%dT%H:00Z', 'now')) AS q_now,
    (SELECT q.quality_index FROM quality_trend q WHERE q.scope = p.program_code AND q.tick <= strftime('%Y-%m-%dT%H:00Z', 'now', '-24 hours') ORDER BY q.tick DESC LIMIT 1) AS q_24h,
    (SELECT COUNT(*) FROM north_star_program sp JOIN v_north_star_state ns ON ns.key = sp.north_star
      WHERE sp.program_code = p.program_code AND sp.role = 'owner' AND ns.breached = 1) AS ns_breached
  FROM program_risk_now p
),
tot AS (
  SELECT COALESCE(SUM(risk), 0) AS t, MAX(risk) AS mx, COUNT(*) AS n FROM program_risk_now WHERE open_issues > 0
),
d AS (
  SELECT r.program_code, r.manager_persona, r.verdict, r.risk, r.risk_24h, r.q_now, r.q_24h, r.open_issues, tot.t AS total_risk,
    r.ns_breached * cfg.bonus AS ns_extra,
    CASE WHEN r.open_issues = 0 THEN 'idle'
         WHEN r.risk = tot.mx AND r.risk > 0 THEN 'constrain'
         WHEN r.risk_24h IS NOT NULL AND r.risk > r.risk_24h * 1.1 THEN 'escalate'
         WHEN r.q_24h IS NOT NULL AND r.q_now IS NOT NULL AND r.q_now <= r.q_24h - 5 THEN 'escalate'
         WHEN r.risk_24h IS NOT NULL AND r.risk < r.risk_24h * 0.8 THEN 'accelerate'
         WHEN r.verdict = 'GREEN' THEN 'maintain'
         ELSE 'steady' END AS decision,
    CASE WHEN r.open_issues = 0 THEN 0
         ELSE MAX(1, (cfg.slots / 2) / MAX(1, tot.n) + CAST(ROUND((cfg.slots - cfg.slots / 2) * r.risk / MAX(tot.t, 0.0001)) AS INTEGER)) + r.ns_breached * cfg.bonus END AS base_slots
  FROM r, tot, cfg
)
SELECT program_code, manager_persona, verdict, risk, risk_24h, open_issues, decision,
  MIN(open_issues, CASE decision WHEN 'escalate' THEN base_slots + (base_slots + 1) / 2 WHEN 'maintain' THEN 1 + ns_extra WHEN 'idle' THEN 0 ELSE base_slots END) AS slots,
  CASE decision
    WHEN 'constrain' THEN 'highest risk in the portfolio (' || risk || ' of ' || ROUND(total_risk, 1) || '): it is the constraint and gets the largest share of focus'
    WHEN 'escalate' THEN CASE WHEN risk_24h IS NOT NULL AND risk > risk_24h * 1.1 THEN 'risk rose from ' || risk_24h || ' to ' || risk || ' in 24h' ELSE 'quality fell from ' || q_24h || ' to ' || q_now || ' of 100 in 24h' END || ': focus raised by half'
    WHEN 'accelerate' THEN 'risk fell from ' || risk_24h || ' to ' || risk || ' in 24h: keep the current focus moving'
    WHEN 'maintain' THEN 'GREEN: one focus slot keeps the program watched'
    WHEN 'idle' THEN 'no open issue mapped to the program'
    ELSE verdict || ', risk ' || risk || ': focus in proportion to risk' END
  || CASE WHEN ns_extra > 0 THEN '; +' || ns_extra || ' slots for the North Star measures it owns that are off target' ELSE '' END AS reason
FROM d;

-- ---- workflow steps (fleet_tasks) ------------------------------------------------------------------------------------------------------------------------------
-- rm-research v2: one strategic proposal with NORTHSTAR and PREDICT lines, North Star state in the prompt, only manager-originated open items count against the limit of 3, a discarded reply is asked again up to 3 times a day
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-research' LIMIT 1) || '].sql', 'INSERT INTO cf_agent_requests (requester, kind, prompt, instance, priority) SELECT ''program-manager:'' || c.program_code, ''run'', ''You are the program manager of '' || c.program_code || '' in the QNFO fleet (repository QNFO/qnfo-workers, Cloudflare Workers plus the D1 database qnfo-audit). The owner wants strategy and features that move four North Star measures, not more hygiene and not another fix. North Star state now: '' || COALESCE((SELECT group_concat(s.key || '' '' || COALESCE(CAST(ROUND(s.val, 2) AS TEXT), ''n/a'') || '' (target '' || CASE s.direction WHEN ''up'' THEN ''>= '' ELSE ''<= '' END || s.target || '')'', '', '') FROM v_north_star_state s), ''unknown'') || ''. This program serves: '' || COALESCE((SELECT group_concat(sp.north_star || '' ('' || sp.role || '')'', '', '') FROM north_star_program sp WHERE sp.program_code = c.program_code), ''readers'') || ''. Aim of the program: '' || COALESCE(c.objective, '''') || '' Roadmap items already open from the managers: '' || COALESCE((SELECT group_concat(substr(i.title, 1, 90), '' / '') FROM agent_issues i WHERE i.status = ''open'' AND i.source = ''management-personas'' AND i.title LIKE ''ROADMAP-1: '' || c.program_code || '' #%''), ''none'') || ''. Research with tools first: read qnfo-audit (v_north_star_state, metric_improvement_now, roadmap_implementation, v_reader_yield_source, the papers the fleet published) and the code of the workers of this program in the repository. Then propose ONE strategic feature or quality improvement that a single worker file can deliver and that moves one of your North Star measures by a size you can state. It is not a fix for an open issue and not a hygiene metric. Hard limits: never propose or route to traditional journal submission, publication goes only to papers.qnfo.org (NO-JOURNALS-1), and never cross-pollinate personal-api work into research endpoints (PERSONAL-QNFO-SEPARATION-1). Your reply must be ONLY these lines, with no preface, no plan and no tool-status text (a reply with anything else is discarded and asked again):'' || char(10) || ''TITLE: <under 80 characters>'' || char(10) || ''WHY: <what it improves and who notices it, under 80 words>'' || char(10) || ''NORTHSTAR: <one of readers, cost, owner_load, reliability>'' || char(10) || ''PREDICT: <the metric, the direction and size, and the day you will read it, under 40 words>'' || char(10) || ''code-task: repo=qnfo-workers path=<one worker.js, never qnfo-fleet-control, qnfo-ops, qnfo-deploy-guard, qnfo-code-orchestrator or .github>'' || char(10) || ''code-anchor: <verbatim text that occurs exactly once in that file, next to the edit>'' || char(10) || ''EDIT: <the exact change, under 120 words>'', ''roadmap-'' || c.program_code || ''-'' || strftime(''%Y%m%d'', ''now''), ''medium'' FROM program_charters c WHERE c.status = ''active'' AND c.program_code <> ''QNFO.PERSONAL'' AND (SELECT COUNT(*) FROM agent_issues i WHERE i.status = ''open'' AND i.source = ''management-personas'' AND i.title LIKE ''ROADMAP-1: '' || c.program_code || '' #%'') < 3 AND NOT EXISTS (SELECT 1 FROM cf_agent_requests r WHERE r.instance = ''roadmap-'' || c.program_code || ''-'' || strftime(''%Y%m%d'', ''now'') AND (r.status IN (''queued'', ''running'') OR (r.status = ''done'' AND instr(COALESCE(r.result, ''''), ''TITLE:'') > 0 AND instr(COALESCE(r.result, ''''), ''code-task:'') > 0 AND instr(COALESCE(r.result, ''''), ''code-anchor:'') > 0))) AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.requester = ''program-manager:'' || c.program_code AND q.instance = ''roadmap-'' || c.program_code || ''-'' || strftime(''%Y%m%d'', ''now'')) < 3 AND COALESCE((SELECT value FROM ops_config WHERE key = ''persona_actions''), ''on'') <> ''off'' AND COALESCE((SELECT value FROM ops_config WHERE key = ''roadmap_originate''), ''on'') <> ''off'''), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-research' LIMIT 1), ''), 'Roadmap items already open') > 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-research' LIMIT 1), ''), 'NORTHSTAR:') = 0;

-- rm-meta: record the North Star and the prediction of each new proposal (kind strategic needs both lines)
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps', json((SELECT json_group_array(json(s.v)) FROM (
  SELECT CAST(j.key AS INTEGER) * 2 AS k, j.value AS v FROM json_each(fleet_tasks.definition, '$.steps') j
  UNION ALL SELECT (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-parse' LIMIT 1) * 2 + 1, json_object('type', 'sql', 'name', 'rm-meta', 'db', 'AUDIT', 'sql', 'INSERT OR IGNORE INTO roadmap_proposal_meta (proposal_id, kind, north_star, prediction, source) SELECT p.id, CASE WHEN x.ns IS NOT NULL AND length(x.pred) > 8 THEN ''strategic'' ELSE ''tactical'' END, x.ns, substr(x.pred, 1, 300), p.request_instance FROM roadmap_proposals p JOIN (SELECT q.id AS pid, (SELECT s.key FROM north_star_measures s WHERE instr(lower(substr(q.rationale, instr(lower(q.rationale), ''northstar:''), 40)), s.key) > 0 ORDER BY s.key LIMIT 1) AS ns, trim(substr(q.rationale, instr(lower(q.rationale), ''predict:'') + 8, CASE WHEN instr(substr(q.rationale, instr(lower(q.rationale), ''predict:'') + 8), char(10)) > 0 THEN instr(substr(q.rationale, instr(lower(q.rationale), ''predict:'') + 8), char(10)) - 1 ELSE 300 END)) AS pred FROM roadmap_proposals q WHERE instr(lower(q.rationale), ''northstar:'') > 0 AND instr(lower(q.rationale), ''predict:'') > 0) x ON x.pid = p.id WHERE p.created_at >= COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_since''), ''9999'') AND NOT EXISTS (SELECT 1 FROM roadmap_proposal_meta m WHERE m.proposal_id = p.id)')
  ORDER BY k) s))), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-parse' LIMIT 1) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-meta');

-- rm-file: join the meta row and count only manager-originated open items against the limit of 3
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1) || '].sql', replace(json_extract(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1) || '].sql'), 'FROM roadmap_proposals p WHERE p.status = ''proposed'' AND (SELECT COUNT(*) FROM agent_issues i WHERE i.status = ''open'' AND i.title LIKE ''ROADMAP-1: '' || p.program_code || '' #%'') < 3', 'FROM roadmap_proposals p LEFT JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = ''strategic'' WHERE p.status = ''proposed'' AND (SELECT COUNT(*) FROM agent_issues i WHERE i.status = ''open'' AND i.source = ''management-personas'' AND i.title LIKE ''ROADMAP-1: '' || p.program_code || '' #%'') < 3')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1), ''), 'FROM roadmap_proposals p WHERE p.status = ''proposed'' AND (SELECT COUNT(*) FROM agent_issues i WHERE i.status = ''open'' AND i.title LIKE ''ROADMAP-1: '' || p.program_code || '' #%'') < 3') > 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1), ''), 'FROM roadmap_proposals p LEFT JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = ''strategic'' WHERE p.status = ''proposed'' AND (SELECT COUNT(*) FROM agent_issues i WHERE i.status = ''open'' AND i.source = ''management-personas'' AND i.title LIKE ''ROADMAP-1: '' || p.program_code || '' #%'') < 3') = 0;

-- rm-file: the issue carries the north-star and prediction lines of a strategic proposal (needs the join of the edit above)
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1) || '].sql', replace(json_extract(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1) || '].sql'), 'char(10) || char(10) || p.rationale, ''management-personas''', 'char(10) || char(10) || p.rationale || COALESCE(char(10) || char(10) || ''north-star: '' || m.north_star || char(10) || ''prediction: '' || m.prediction, ''''), ''management-personas''')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1), ''), 'char(10) || char(10) || p.rationale, ''management-personas''') > 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1), ''), 'char(10) || char(10) || p.rationale || COALESCE(char(10) || char(10) || ''north-star: '' || m.north_star || char(10) || ''prediction: '' || m.prediction, ''''), ''management-personas''') = 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'rm-file' LIMIT 1), ''), 'LEFT JOIN roadmap_proposal_meta m') > 0;

-- lever-request: skip demoted hygiene metrics, at most lever_per_trigger_daily asks a day per metric and lever_daily_cap a day in all
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1) || '].sql', replace(json_extract(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1) || '].sql'), 'FROM metric_improvement_now m WHERE m.verdict IN (''breach-worsening'', ''breach-flat'') AND m.open_issue_id IS NOT NULL AND NOT EXISTS (', 'FROM metric_improvement_now m WHERE m.verdict IN (''breach-worsening'', ''breach-flat'') AND m.open_issue_id IS NOT NULL AND (COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_lever_gate''), ''on'') <> ''on'' OR (COALESCE((SELECT l.tier FROM north_star_links l WHERE l.metric_key = m.metric_key), ''other'') <> ''hygiene'' AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.requester = ''program-manager:'' || m.program_code AND q.instance >= ''lever-'' || m.trigger_id || ''-'' AND q.instance < ''lever-'' || m.trigger_id || ''.'' AND q.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')) < COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = ''lever_per_trigger_daily''), 2) AND (SELECT COUNT(*) FROM cf_agent_requests q2 WHERE q2.requester IN (''program-manager:QNFO.OPS'', ''program-manager:QNFO.INFRA'', ''program-manager:QNFO.REACH'', ''program-manager:QNFO.RSCH'', ''program-manager:QNFO.PERSONAL'') AND q2.instance >= ''lever-'' AND q2.instance < ''lever.'' AND q2.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')) < COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = ''lever_daily_cap''), 24))) AND NOT EXISTS (')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1), ''), 'FROM metric_improvement_now m WHERE m.verdict IN (''breach-worsening'', ''breach-flat'') AND m.open_issue_id IS NOT NULL AND NOT EXISTS (') > 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1), ''), 'FROM metric_improvement_now m WHERE m.verdict IN (''breach-worsening'', ''breach-flat'') AND m.open_issue_id IS NOT NULL AND (COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_lever_gate''), ''on'') <> ''on'' OR (COALESCE((SELECT l.tier FROM north_star_links l WHERE l.metric_key = m.metric_key), ''other'') <> ''hygiene'' AND (SELECT COUNT(*) FROM cf_agent_requests q WHERE q.requester = ''program-manager:'' || m.program_code AND q.instance >= ''lever-'' || m.trigger_id || ''-'' AND q.instance < ''lever-'' || m.trigger_id || ''.'' AND q.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')) < COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = ''lever_per_trigger_daily''), 2) AND (SELECT COUNT(*) FROM cf_agent_requests q2 WHERE q2.requester IN (''program-manager:QNFO.OPS'', ''program-manager:QNFO.INFRA'', ''program-manager:QNFO.REACH'', ''program-manager:QNFO.RSCH'', ''program-manager:QNFO.PERSONAL'') AND q2.instance >= ''lever-'' AND q2.instance < ''lever.'' AND q2.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')) < COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = ''lever_daily_cap''), 24))) AND NOT EXISTS (') = 0;

-- lever-request: North Star metrics first, then drivers, then the rest
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1) || '].sql', replace(json_extract(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1) || '].sql'), 'ORDER BY m.priority, CASE m.verdict WHEN ''breach-worsening'' THEN 0 ELSE 1 END, m.trigger_id LIMIT 5', 'ORDER BY CASE WHEN COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_lever_gate''), ''on'') = ''on'' THEN CASE COALESCE((SELECT l.tier FROM north_star_links l WHERE l.metric_key = m.metric_key), ''other'') WHEN ''northstar'' THEN 0 WHEN ''driver'' THEN 1 ELSE 2 END ELSE 0 END, m.priority, CASE m.verdict WHEN ''breach-worsening'' THEN 0 ELSE 1 END, m.trigger_id LIMIT CASE WHEN COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_lever_gate''), ''on'') = ''on'' THEN MAX(0, MIN(5, COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = ''lever_daily_cap''), 24) - (SELECT COUNT(*) FROM cf_agent_requests q3 WHERE q3.requester IN (''program-manager:QNFO.OPS'', ''program-manager:QNFO.INFRA'', ''program-manager:QNFO.REACH'', ''program-manager:QNFO.RSCH'', ''program-manager:QNFO.PERSONAL'') AND q3.instance >= ''lever-'' AND q3.instance < ''lever.'' AND q3.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')))) ELSE 5 END')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1), ''), 'ORDER BY m.priority, CASE m.verdict WHEN ''breach-worsening'' THEN 0 ELSE 1 END, m.trigger_id LIMIT 5') > 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'lever-request' LIMIT 1), ''), 'ORDER BY CASE WHEN COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_lever_gate''), ''on'') = ''on'' THEN CASE COALESCE((SELECT l.tier FROM north_star_links l WHERE l.metric_key = m.metric_key), ''other'') WHEN ''northstar'' THEN 0 WHEN ''driver'' THEN 1 ELSE 2 END ELSE 0 END, m.priority, CASE m.verdict WHEN ''breach-worsening'' THEN 0 ELSE 1 END, m.trigger_id LIMIT CASE WHEN COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_lever_gate''), ''on'') = ''on'' THEN MAX(0, MIN(5, COALESCE((SELECT CAST(value AS INTEGER) FROM ops_config WHERE key = ''lever_daily_cap''), 24) - (SELECT COUNT(*) FROM cf_agent_requests q3 WHERE q3.requester IN (''program-manager:QNFO.OPS'', ''program-manager:QNFO.INFRA'', ''program-manager:QNFO.REACH'', ''program-manager:QNFO.RSCH'', ''program-manager:QNFO.PERSONAL'') AND q3.instance >= ''lever-'' AND q3.instance < ''lever.'' AND q3.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')))) ELSE 5 END') = 0;

-- ns-brief: the portfolio brief (fleet.qnfo.org/api/managers) opens with the four North Star values and the weekly strategic proposal count
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-brief', 'db', 'AUDIT', 'sql', 'UPDATE persona_briefs SET summary = ''North Star: '' || COALESCE((SELECT group_concat(s.key || '' '' || COALESCE(CAST(ROUND(s.val, 2) AS TEXT), ''n/a'') || '' (target '' || CASE s.direction WHEN ''up'' THEN ''>= '' ELSE ''<= '' END || s.target || '')'', '' | '') FROM v_north_star_state s), ''unmeasured'') || ''. Strategic roadmap proposals in 7 days: '' || COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''roadmap_strategic_proposals_7d''), ''0'') || '' (programs without one: '' || COALESCE((SELECT last_value FROM metric_registry WHERE metric = ''programs_without_strategic_proposal_7d''), ''?'') || ''). '' || summary WHERE persona_key = ''portfolio-manager'' AND tick = (SELECT MAX(tick) FROM portfolio_allocations) AND summary NOT LIKE ''North Star:%''')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-brief');

-- pl-research: the product plus flow also names its North Star and its prediction
UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'pl-research' LIMIT 1) || '].sql', replace(json_extract(definition, '$.steps[' || (SELECT CAST(j.key AS INTEGER) FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'pl-research' LIMIT 1) || '].sql'), '''EDIT: <the exact change, under 120 words>'', ''roadmap-'' || r.program_code || ''-plus-''', '''NORTHSTAR: <one of readers, cost, owner_load, reliability: the North Star measure this plus moves>'' || char(10) || ''PREDICT: <the metric, the direction and size, and the day you will read it, under 40 words>'' || char(10) || ''EDIT: <the exact change, under 120 words>'', ''roadmap-'' || r.program_code || ''-plus-''')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus' AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'pl-research' LIMIT 1), ''), '''EDIT: <the exact change, under 120 words>'', ''roadmap-'' || r.program_code || ''-plus-''') > 0 AND instr(COALESCE((SELECT json_extract(j.value, '$.sql') FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'pl-research' LIMIT 1), ''), '''NORTHSTAR: <one of readers, cost, owner_load, reliability: the North Star measure this plus moves>'' || char(10) || ''PREDICT: <the metric, the direction and size, and the day you will read it, under 40 words>'' || char(10) || ''EDIT: <the exact change, under 120 words>'', ''roadmap-'' || r.program_code || ''-plus-''') = 0;

-- ns-refresh: hourly values of the North Star and weekly proposal metrics
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-refresh', 'db', 'AUDIT', 'sql', 'UPDATE metric_registry SET last_value = CAST(CASE metric WHEN ''ns_readers_engaged_per_day'' THEN (SELECT ROUND(CAST(e.last_value AS REAL) / 7.0, 2) FROM metric_registry e WHERE e.metric = ''engaged_reader_sessions_7d'' AND trim(COALESCE(e.last_value, '''')) <> '''' AND rtrim(trim(e.last_value), ''% '') NOT GLOB ''*[^0-9.+-]*'') WHEN ''ns_ext_visits_per_paper_30d'' THEN (SELECT ROUND(1.0 * SUM(ext_30d) / MAX(COUNT(*), 1), 3) FROM paper_readership) WHEN ''ns_fleet_cost_usd_month'' THEN (SELECT ROUND(SUM(usd) * 30.0 / COUNT(DISTINCT date), 2) FROM cost_daily WHERE scope = ''fleet'' AND date >= date(''now'', ''-7 day'') AND date < date(''now'')) WHEN ''ns_owner_urgent_cards'' THEN (SELECT COUNT(*) FROM human_actions WHERE status = ''open'' AND COALESCE(sev, ''normal'') <> ''low'' AND instr(COALESCE(why, ''''), ''IDENTITY-BOUND:'') > 0) WHEN ''ns_dashboard_load_ms_p75_24h'' THEN (SELECT ms FROM journey_runs WHERE journey = ''dashboard-load'' AND runner = ''gha'' AND ok = 1 AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'') ORDER BY ms LIMIT 1 OFFSET (SELECT CAST(0.75 * (COUNT(*) - 1) AS INTEGER) FROM journey_runs WHERE journey = ''dashboard-load'' AND runner = ''gha'' AND ok = 1 AND ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day''))) WHEN ''roadmap_proposals_7d'' THEN (SELECT COUNT(*) FROM roadmap_proposals WHERE created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'')) WHEN ''roadmap_strategic_proposals_7d'' THEN (SELECT COUNT(*) FROM roadmap_proposals p JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = ''strategic'' WHERE p.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'')) WHEN ''programs_without_strategic_proposal_7d'' THEN (SELECT COUNT(*) FROM program_charters c WHERE c.status = ''active'' AND c.program_code <> ''QNFO.PERSONAL'' AND NOT EXISTS (SELECT 1 FROM roadmap_proposals p JOIN roadmap_proposal_meta m ON m.proposal_id = p.id AND m.kind = ''strategic'' WHERE p.program_code = c.program_code AND p.created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days''))) WHEN ''manager_agent_requests_24h'' THEN (SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= ''program-manager:'' AND requester < ''program-manager;'' AND created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')) END AS TEXT), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric IN (''ns_readers_engaged_per_day'', ''ns_ext_visits_per_paper_30d'', ''ns_fleet_cost_usd_month'', ''ns_owner_urgent_cards'', ''ns_dashboard_load_ms_p75_24h'', ''roadmap_proposals_7d'', ''roadmap_strategic_proposals_7d'', ''programs_without_strategic_proposal_7d'', ''manager_agent_requests_24h'')')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-refresh');

-- ns-pin: a trigger issue of a North Star metric or driver belongs to the program that owns that measure
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-pin', 'db', 'AUDIT', 'sql', 'INSERT INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at) SELECT n.issue_id, ''W.'' || COALESCE(n.pin_program, sp.program_code), COALESCE(n.pin_program, sp.program_code), ''fix'', datetime(''now'') FROM v_issue_north_star n LEFT JOIN north_star_program sp ON sp.north_star = n.ns_key AND sp.role = ''owner'' WHERE n.ns_tier IN (''northstar'', ''driver'') AND COALESCE(n.pin_program, sp.program_code) IS NOT NULL AND COALESCE((SELECT value FROM ops_config WHERE key = ''north_star_focus''), ''on'') = ''on'' AND NOT EXISTS (SELECT 1 FROM issue_project_map m WHERE m.issue_id = n.issue_id AND m.program_code = COALESCE(n.pin_program, sp.program_code) AND m.project_code = ''W.'' || COALESCE(n.pin_program, sp.program_code)) ON CONFLICT(issue_id) DO UPDATE SET project_code = excluded.project_code, program_code = excluded.program_code, updated_at = excluded.updated_at')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-pin');

-- ns-verdict: the 7 day keep-or-revert reading of the North Star managers change
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-verdict', 'db', 'AUDIT', 'sql', 'UPDATE north_star_experiments SET verdict = CASE WHEN (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''metrics_in_breach'') - (SELECT COUNT(*) FROM v_metric_trigger_state s WHERE s.hit = 1 AND s.metric_key IN (''ns_readers_engaged_per_day'', ''ns_ext_visits_per_paper_30d'', ''ns_fleet_cost_usd_month'', ''ns_owner_urgent_cards'', ''ns_dashboard_load_ms_p75_24h'', ''roadmap_proposals_7d'', ''roadmap_strategic_proposals_7d'', ''programs_without_strategic_proposal_7d'', ''manager_agent_requests_24h'')) > json_extract(baseline, ''$.metrics_in_breach'') + 8 OR (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''open_agent_issues'') > json_extract(baseline, ''$.open_agent_issues'') * 1.2 OR (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''issue_wontfix_share_7d'') > json_extract(baseline, ''$.issue_wontfix_share_7d'') + 5 OR (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''remediation_latest_pass_pct_7d'') < json_extract(baseline, ''$.remediation_latest_pass_pct_7d'') - 5 THEN ''revert'' WHEN COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''programs_without_strategic_proposal_7d''), 4) <= 1 AND (SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= ''program-manager:'' AND requester < ''program-manager;'' AND instance >= ''lever-'' AND instance < ''lever.'' AND created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')) <= json_extract(baseline, ''$.lever_asks_24h'') * 0.35 AND (SELECT 1.0 * COALESCE(SUM(ns_linked), 0) / MAX(COALESCE(SUM(focus_total), 0), 1) FROM v_north_star_focus_mix) >= 0.25 THEN ''keep'' ELSE ''partial'' END, verdict_at = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), evidence = json_object(''strategic_proposals_7d'', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''roadmap_strategic_proposals_7d''), ''lever_asks_24h'', (SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= ''program-manager:'' AND requester < ''program-manager;'' AND instance >= ''lever-'' AND instance < ''lever.'' AND created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'')), ''focus_ns_share'', (SELECT ROUND(1.0 * COALESCE(SUM(ns_linked), 0) / MAX(COALESCE(SUM(focus_total), 0), 1), 3) FROM v_north_star_focus_mix), ''metrics_in_breach'', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''metrics_in_breach''), ''open_agent_issues'', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''open_agent_issues''), ''issue_wontfix_share_7d'', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''issue_wontfix_share_7d''), ''remediation_latest_pass_pct_7d'', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''remediation_latest_pass_pct_7d''), ''baseline'', json(baseline)) WHERE verdict IS NULL AND check_at <= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'')')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-verdict');

-- ns-verdict-apply: a revert verdict switches north_star_focus and north_star_lever_gate off
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-verdict-apply', 'db', 'AUDIT', 'sql', 'UPDATE ops_config SET value = ''off'', updated_at = datetime(''now'') WHERE key IN (''north_star_focus'', ''north_star_lever_gate'') AND value <> ''off'' AND EXISTS (SELECT 1 FROM north_star_experiments e WHERE e.verdict = ''revert'' AND NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.assumption = ''north-star-verdict:'' || e.id))')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-verdict-apply');

-- ns-verdict-log: the verdict is a decision_log row
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-verdict-log', 'db', 'AUDIT', 'sql', 'INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, outcome_matched) SELECT ''management-personas (NORTH-STAR-MANAGERS-1)'', ''north-star-verdict:'' || e.id, CASE e.verdict WHEN ''revert'' THEN ''switched north_star_focus and north_star_lever_gate off after a guard worsened'' WHEN ''keep'' THEN ''kept the North Star focus ranking and the lever gate'' ELSE ''kept the switches on: the prediction was only partly met'' END, COALESCE(e.evidence, ''''), e.verdict, ''manager focus order, manager lever spend and roadmap origination'', ''UPDATE ops_config SET value = ''''off'''' WHERE key IN (''''north_star_focus'''', ''''north_star_lever_gate'''')'', ''north-star-keep-or-revert'', e.predicted, CASE e.verdict WHEN ''keep'' THEN 1 WHEN ''revert'' THEN 0 ELSE NULL END FROM north_star_experiments e WHERE e.verdict IS NOT NULL AND NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.assumption = ''north-star-verdict:'' || e.id)')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-verdict-log');

-- ns-verdict-next: a partial reading opens one second 7 day window
UPDATE fleet_tasks SET definition = json_insert(definition, '$.steps[#]', json_object('type', 'sql', 'name', 'ns-verdict-next', 'db', 'AUDIT', 'sql', 'INSERT INTO north_star_experiments (id, started_at, check_at, predicted, baseline) SELECT ''north-star-managers-2'', strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''+7 days''), e.predicted || '' (second window: the first read partial)'', json_extract(e.evidence, ''$'') FROM north_star_experiments e WHERE e.id = ''north-star-managers-1'' AND e.verdict = ''partial'' AND NOT EXISTS (SELECT 1 FROM north_star_experiments x WHERE x.id = ''north-star-managers-2'')')), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas' AND NOT EXISTS (SELECT 1 FROM json_each(fleet_tasks.definition, '$.steps') j WHERE json_extract(j.value, '$.name') = 'ns-verdict-next');

-- ---- the spend review: ten breached metrics with the least distinct owner value (control_registry, ns-review:*) ----------------------------------------------------
-- Rubric: a breached metric has little distinct owner value when another breached metric already says the same thing, when it is a count over other metrics, or when its target contradicts a
-- standing owner decision (research volume was cut on purpose). Spend is the lever-request asks of the last 7 days (one ask is about 3.3k neurons, workers-ai-real-spend memory 2026-11-04, an estimate).
-- demote = applied here by north_star_links tier hygiene (no lever asks, last in focus, at most 2 slots per program): the metric, its trigger and its issue stay and keep measuring.
-- remove = a retire recommendation only (disposition_state planned): a retirement is a separate migration with its own rollback line once the owner replacement has 7 days of data.
-- The three owner-directive metrics of ISSUE-SLA-2H-1 and ISSUE-AGE-24H-1 (open_agent_issues, issue_drain_ratio_24h, issues_over_24h_no_doer) are NOT demoted.
INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, evidence) VALUES
  ('ns-review:content_items_over_stage_sla', 'analytics_metric_triggers id 5915', 'guard', 'a content backlog', 0, 'demote', 'applied',
   '1512 against a target of 0, rank 1 of QNFO.OPS focus with no doer, 14 lever asks in 7 days. The backlog follows research volume that was cut on purpose. Recalibrate the target before it is a focus item again.'),
  ('ns-review:fleet_quality_change_7d', 'analytics_metric_triggers id 14559', 'guard', 'a drop of the derived quality index', 0, 'remove', 'planned',
   'A derived index of other metrics (-2.3 against -2), 11 lever asks in 7 days, no distinct reading. Retire once metrics_in_breach and the North Star state carry the verdict.'),
  ('ns-review:issues_open_over_120m', 'analytics_metric_triggers id 5937', 'guard', 'open backlog age', 0, 'demote', 'applied',
   '302 against 215, 10 lever asks in 7 days. Same backlog as sla_breaches_over_120m, issues_over_24h_no_doer and open_agent_issues, which stay as the owner-directive readings.'),
  ('ns-review:tracker_drift', 'analytics_metric_triggers id 8559', 'guard', 'GitHub mirror drift', 0, 'demote', 'applied',
   '14 against 0, 10 lever asks in 7 days. ISSUE-HYGIENE-1 says the mirror is not the work.'),
  ('ns-review:idea_to_publish_h_p50_7d', 'analytics_metric_triggers id 8558', 'guard', 'research output latency', 0, 'demote', 'applied',
   '351.8 h against 100 h, 8 lever asks in 7 days. The owner wants readers before more output (READER-YIELD-1).'),
  ('ns-review:sla_breaches_over_120m', 'analytics_metric_triggers id 5929', 'guard', 'items past an SLA', 0, 'demote', 'applied',
   '1838 against 565, 7 lever asks in 7 days. Counts the same queue as issues_open_over_120m and stuck_items_over_sla.'),
  ('ns-review:orphan_issues_no_live_path', 'analytics_metric_triggers id 14730', 'guard', 'issues without a doer', 0, 'demote', 'applied',
   '56 against 0, 6 lever asks in 7 days. Third metric for issues without a doer; issues_over_24h_no_doer stays the owner-directive reading.'),
  ('ns-review:metrics_worsening_7d', 'analytics_metric_triggers id 14558', 'guard', 'count of worsening metrics', 0, 'remove', 'planned',
   '69 against 10, 4 lever asks in 7 days. A count over other metrics. Retire once the North Star state carries the verdict.'),
  ('ns-review:breaches_undiagnosed_over_60m', 'analytics_metric_triggers id 14602', 'guard', 'issues without a diagnosis', 0, 'demote', 'applied',
   '386 against 0. Second metric for issues without a doer, with issues_over_24h_no_doer.'),
  ('ns-review:monthly_cost_run_rate_usd', 'analytics_metric_triggers id 3689', 'guard', 'all-in cost run rate', 0, 'remove', 'planned',
   '1248.54 against 650. Superseded by ns_fleet_cost_usd_month (fleet-controlled, 799) and fleet_cost_pace_30d_usd, and it adds 450 USD of owner-direct spend nobody verified. Retire after 7 days of the North Star cost reading.');

-- ---- the four proposals the reader-yield session filed on 2026-11-04 name a metric and a prediction (decision_log READER-YIELD-1), so they count as strategic for QNFO.REACH --------
INSERT OR IGNORE INTO roadmap_proposal_meta (proposal_id, kind, north_star, prediction, source)
SELECT p.id, 'strategic', 'readers', 'see decision_log READER-YIELD-1: engaged_reader_sessions_7d stays at or above 35 for 14 days, outreach_engaged_per_100_clicks_7d rises', 'session:reader-yield'
FROM roadmap_proposals p WHERE p.id IN (2131, 2132, 2133, 2134) AND p.program_code = 'QNFO.REACH';

-- ---- the keep-or-revert experiment: baseline is read at apply time --------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO north_star_experiments (id, started_at, check_at, predicted, baseline)
SELECT 'north-star-managers-1', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+7 days'),
  'within 7 days lever asks fall to 35 percent of baseline or less, at least 3 of the 4 researching programs originate a strategic roadmap proposal in a week, at least 25 percent of focus slots hold North Star linked issues, and no guard metric worsens',
  json_object(
    'lever_asks_24h', (SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= 'program-manager:' AND requester < 'program-manager;' AND instance >= 'lever-' AND instance < 'lever.' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')),
    'manager_requests_24h', (SELECT COUNT(*) FROM cf_agent_requests WHERE requester >= 'program-manager:' AND requester < 'program-manager;' AND created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')),
    'proposals_7d', (SELECT COUNT(*) FROM roadmap_proposals WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')),
    'focus_total', (SELECT COUNT(*) FROM program_focus),
    'focus_ns_linked', (SELECT COUNT(*) FROM program_focus f JOIN v_issue_north_star n ON n.issue_id = f.issue_id WHERE n.ns_tier IN ('northstar', 'driver')),
    'focus_hygiene', (SELECT COUNT(*) FROM program_focus f JOIN v_issue_north_star n ON n.issue_id = f.issue_id WHERE n.ns_tier = 'hygiene'),
    'metrics_in_breach', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'metrics_in_breach'),
    'open_agent_issues', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'open_agent_issues'),
    'issue_wontfix_share_7d', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'issue_wontfix_share_7d'),
    'remediation_latest_pass_pct_7d', (SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = 'remediation_latest_pass_pct_7d'))
WHERE NOT EXISTS (SELECT 1 FROM north_star_experiments WHERE id = 'north-star-managers-1');

INSERT OR IGNORE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES ('managers-rank-by-north-star', 'migrations/2026-11-04-north-star-managers.sql',
  'management-personas hourly workflows; north_star_measures, north_star_links, v_north_star_state',
  'the focus plan ranks North Star issues first, the lever gate caps manager agent spend, and a 7 day check keeps or reverts both',
  '2026-11-04', 'v_program_focus_plan, v_portfolio_allocation_plan and the management-personas-c steps rm-research, rm-meta, rm-file, lever-request');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'portfolio-manager (NORTH-STAR-MANAGERS-1)',
  'the managers should rank work by what the owner wants (readers, cost, owner load, reliability) and not by percent past threshold, and their agent spend should follow the same order',
  'registered four North Star measures with triggers, ranked focus and allocated slots by them, gated lever reviews, made roadmap origination strategic with a weekly floor, and queued a 7 day keep-or-revert reading',
  '2026-11-04: 94 of 297 metrics in breach; manager focus ranked by breach_ratio; 332 lever asks in 7 days with 44 usable replies; 142 manager agent requests in 24 h; 13 roadmap proposals in 7 days; readers 6.3 a day, cost 799 USD a month, 3 urgent owner cards, dashboard 4254 ms',
  'pending the 7 day reading north-star-managers-1', 'manager focus order and slot split, lever-request spend, roadmap-originate prompts, the portfolio brief',
  'Rollback line of migrations/2026-11-04-north-star-managers.sql, or ops_config north_star_focus and north_star_lever_gate = off',
  'managers-rank-by-north-star',
  'lever asks per day 115 -> 40 or fewer, manager agent requests 142 -> 60 or fewer, at least 3 of the 4 researching programs originate a strategic proposal in a week, at least 25 percent of focus holds North Star linked issues, no guard worse',
  'readers and cost are the first two measures to move: lever spend is about 4 USD a day (115 asks x 3.3k neurons x 0.011 USD per 1000) and strategic proposals are the reader-facing work',
  'SQLite replay of the migration, synthetic focus ranking with the switch on and off against the old view text, lever-request SQL against synthetic asks, live read-only checks of every edited anchor'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'portfolio-manager (NORTH-STAR-MANAGERS-1)');
