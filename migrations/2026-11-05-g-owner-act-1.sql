-- OWNER-ACT-REVIEW-1 (2026-11-05, pillar autonomy; owner directive HUMAN-ITEMS-AUTOMATIC-1: the fleet does owner-queue cards). Cluster G-owner-security, sweep of 2026-11-04.
-- Agent issues 1000778 1000779 1000780 1000781 1000802 1000803 1000812 1000813 1000814 1000817 1000819 1000822 1000823 1000824 1000825 (GitHub 5427 5428 5429 5430 5440 5441 5445 5446
-- 5447 5450 5451 5452 5453 5454 5455) are the dashboard's "fix it" taps. Each has a contract that measures the figure the card names. Read live 2026-11-05 00:00Z:
--  * 1000778 asks for the missing outcome measure for papers: papers_per_100usd_7d did not exist, so its probe could never pass. This registers it (scripts/cost_ledger.py write_paper_yield, same
--    7-day window and published count as research_neurons_per_publication_7d), with a floor trigger and its cause mapping.
--  * 1000780 yield side is met (issue closures per $100 7d: 324.69 against the 251.8 baseline, remedy quality 0.53 against 0.53) but the contract sat 'superseded:probe-unusable' although its probe is
--    machine-executable; it is re-armed so the one open condition (monthly spend 1151.13 against a 300 budget, within_monthly_budget 0) is measured, not hidden.
--  * 1000817 (cause:unmapped): three breaching metrics still have no metric_breach_cause row after LEDGER-TRUTH-E-1 (PR 7347) mapped nine: mapped here.
--  * 1000824 (program QNFO.OPS): its probe counted 'unmeasured' metrics (exempt, tracked by METRIC-UNMEASURED-1) and triggers whose queue_target is a loop or the owner alert channel (human_wait_*,
--    the PLUS-PHILOSOPHY-1 rates, queue_target qnfo-fleet-control / alerts), none of which is a missing issue-doer. It now counts breaching metrics whose trigger files agent_issues and that have neither a
--    code-task lever nor an open issue.
--  * 1001338 1001343 1001348 (INTENT-TASK cards for research topics): their probes measured three global properties of every type='task' intent (19 legacy untriaged rows, 6 research-feed intents
--    with no research_queue row, 218 intents with no task_dod_register row), not the item. The three topics are already in the research intake as owner-authored idea_proposals 2564 (substrate
--    geometry and chess boards), 2567 (convolution and Fourier operators) and 2568 (interstellar messaging), held by the 50 percent diversity cap by design (idea-hub diversity-cap.test.mjs: an
--    owner idea cannot bypass the cap) and released best score first. The probes now read that state per item.
--  * 1000781 1000802 1000812 1000814 1000819 duplicate an open metric-trigger issue that carries the same measure, lever and doer (100222, 100464, 1000979, 1798, 99939). They are superseded by
--    those issues with the measured values in the evidence; the survivors stay open and are the closing probes.
-- No cap, guard or probe is weakened; every changed contract is backed up and the Rollback restores it.
-- CAUSE-MAPPED: the new metric papers_per_100usd_7d is mapped in this file (publishing), as are three existing breaching metrics.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_g_owner_act b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_g_owner_act b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_g_owner_act b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class) WHERE class IN (SELECT k FROM bak_20261105_g_owner_act WHERE kind = 'contract'); UPDATE issue_triage SET triage_state = (SELECT b.status FROM bak_20261105_g_owner_act b WHERE b.kind = 'triage' AND b.k = CAST(issue_triage.issue_id AS TEXT)), close_evidence = (SELECT b.last_verdict FROM bak_20261105_g_owner_act b WHERE b.kind = 'triage' AND b.k = CAST(issue_triage.issue_id AS TEXT)), remediation = (SELECT b.verify_probe FROM bak_20261105_g_owner_act b WHERE b.kind = 'triage' AND b.k = CAST(issue_triage.issue_id AS TEXT)) WHERE CAST(issue_id AS TEXT) IN (SELECT k FROM bak_20261105_g_owner_act WHERE kind = 'triage'); UPDATE agent_issues SET status = 'open', close_channel = NULL WHERE id IN (1000781, 1000802, 1000812, 1000814, 1000819); DELETE FROM analytics_metric_triggers WHERE metric_key = 'papers_per_100usd_7d'; DELETE FROM metric_breach_cause WHERE note LIKE 'OWNER-ACT-REVIEW-1:%'; DELETE FROM metric_registry WHERE metric = 'papers_per_100usd_7d';

-- Backup of everything this file changes: contracts (probe, status, verdict) and triage rows (state, evidence, remediation).
CREATE TABLE IF NOT EXISTS bak_20261105_g_owner_act (kind TEXT NOT NULL, k TEXT NOT NULL, verify_probe TEXT, status TEXT, last_verdict TEXT, PRIMARY KEY (kind, k));
INSERT OR IGNORE INTO bak_20261105_g_owner_act (kind, k, verify_probe, status, last_verdict)
SELECT 'contract', class, verify_probe, status, last_verdict FROM remediation_contracts
WHERE class IN ('issue-1000780', 'issue-1000781', 'issue-1000802', 'issue-1000812', 'issue-1000814', 'issue-1000819', 'issue-1000824', 'issue-1001338', 'issue-1001343', 'issue-1001348');
INSERT OR IGNORE INTO bak_20261105_g_owner_act (kind, k, verify_probe, status, last_verdict)
SELECT 'triage', CAST(issue_id AS TEXT), remediation, triage_state, close_evidence FROM issue_triage
WHERE issue_id IN (1000779, 1000780, 1000781, 1000802, 1000803, 1000812, 1000813, 1000814, 1000819, 1000822, 1000823);

-- (1000778) The papers outcome measure. Written by scripts/cost_ledger.py write_paper_yield on the hourly cost ledger run.
INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class)
VALUES ('papers_per_100usd_7d', 'system', 'leading',
  'published versions (research_queue.published_at) over the 7 complete UTC days before today / (v_cost_run_rate total:all-billing daily mean x 7) x 100: the push side of the dashboard card "Yield: papers published per $100", read together with research_neurons_per_publication_7d (the trim side)',
  'qnfo-audit research_queue + cost_daily (computed by scripts/cost_ledger.py write_paper_yield)', 'new 2026-11-05 (about 12.8 on the 7 days to 2026-11-04: 39 versions, 305.52 USD)',
  'floor 10 per $100; no growth target until two weeks of readings exist', 'qnfo-research-exec', 'analytics_metric_triggers papers_per_100usd_7d -> agent_issues', 'hourly', '< 10', '< 5', 'PENDING', 'runner');

INSERT INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes)
SELECT 'papers_per_100usd_7d', 'Papers published per $100 of fleet spend fell below the floor', 'registry', 'lt', 10, 3,
 'Pillar research and cost (OWNER-ACT-REVIEW-1, agent_issues 1000778). Published versions per $100 of all-billing spend, 7 days. Read it with research_neurons_per_publication_7d: yield falls when the pipeline spends on layers that do not end in a publication. Per-step cost of the last 7 days (ai_call_counters, qnfo-research-exec): revise 1.23M neurons, ensemble 0.98M, review 0.77M, complete 0.42M, reconcile 0.31M, verify 0.19M; error rates glm-5.3-flash ensemble 27 percent, reconcile 21 percent, revise 18 percent. Lever: cut the wasted calls first (errors that are retried at full price, duplicate review layers per ENSEMBLE-POLICY-1), then move the most expensive step to a cheaper capable model, and keep the output-quality measures (v_output_quality_by_surface) from falling. Definition of done: the metric is above the floor for 7 days with no guard worse.',
 'qnfo-research-exec', 'agent_issues', 2, 1, 'OWNER-ACT-REVIEW-1 (migrations/2026-11-05-g-owner-act-1.sql)'
WHERE NOT EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE metric_key = 'papers_per_100usd_7d');

-- Cause mappings: the new metric, and three breaching metrics still unmapped after LEDGER-TRUTH-E-1.
INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('papers_per_100usd_7d', 'publishing', 'OWNER-ACT-REVIEW-1: published versions per $100 of spend, 7 days'),
 ('human_wait_oldest_days', 'owner-routing', 'OWNER-ACT-REVIEW-1: age of the oldest open owner-queue item (cards that need the owner wait here by design)'),
 ('human_wait_oldest_min', 'owner-routing', 'OWNER-ACT-REVIEW-1: age in minutes of the oldest open owner-queue item'),
 ('plain_article_coverage_pct', 'publishing', 'OWNER-ACT-REVIEW-1: share of published papers with a current plain-language article'),
 ('cf_agent_requests_over_120m', 'heartbeat', 'OWNER-ACT-REVIEW-1: qnfo-agents requests queued or running over 120 minutes, a scheduled loop that did not finish');

-- (1000824) Off-target OPS metrics that really lack an issue-doer: the trigger files agent_issues, the metric breaches, and neither a code-task lever nor an open issue exists.
UPDATE remediation_contracts
SET verify_probe = 'WITH off_target AS (SELECT n.trigger_id, n.metric_key, n.has_code_task, n.open_issue_id FROM metric_improvement_now n JOIN analytics_metric_triggers t ON t.id = n.trigger_id WHERE n.program_code = ''QNFO.OPS'' AND n.verdict LIKE ''breach%'' AND t.queue_target = ''agent_issues''), lacking AS (SELECT * FROM off_target WHERE has_code_task = 0 AND open_issue_id IS NULL) SELECT ''0 off-target QNFO.OPS metrics without a doer'' AS expected, CAST((SELECT COUNT(*) FROM lacking) AS TEXT) || '' off-target QNFO.OPS metrics without a doer'' AS observed',
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000824' AND issue_id = 1000824;

-- (1001338 1001343 1001348) Item-specific probes: the research topic is in the intake (owner-authored idea_proposals) and not rejected.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''queued'' AS expected, COALESCE((SELECT CASE WHEN status IN (''triaged_accepted'', ''deferred_diversity'') THEN ''queued'' ELSE ''not queued: '' || COALESCE(status, ''?'') END FROM idea_proposals WHERE id = 2564), ''not queued: idea_proposals 2564 is missing'') AS observed',
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001338' AND issue_id = 1001338;
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''queued'' AS expected, COALESCE((SELECT CASE WHEN status IN (''triaged_accepted'', ''deferred_diversity'') THEN ''queued'' ELSE ''not queued: '' || COALESCE(status, ''?'') END FROM idea_proposals WHERE id = 2567), ''not queued: idea_proposals 2567 is missing'') AS observed',
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001343' AND issue_id = 1001343;
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''queued'' AS expected, COALESCE((SELECT CASE WHEN status IN (''triaged_accepted'', ''deferred_diversity'') THEN ''queued'' ELSE ''not queued: '' || COALESCE(status, ''?'') END FROM idea_proposals WHERE id = 2568), ''not queued: idea_proposals 2568 is missing'') AS observed',
    status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001348' AND issue_id = 1001348;

-- (1000780) Re-arm the issue-yield contract: its probe is machine-executable, the 'probe-unusable' parking was wrong.
UPDATE remediation_contracts
SET status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000780' AND issue_id = 1000780 AND status = 'superseded' AND last_verdict LIKE 'superseded:probe-unusable%' AND verify_probe LIKE 'WITH baseline AS%';

-- Measured reviews on the cards that stay open (the closing probe is each card's own contract; the doer is named).
UPDATE issue_triage SET remediation = 'OWNER-ACT review 2026-11-05 (unit:code): merges per $100 over 7 days 345 against 529 the week before; code_task_success_rate_30d 0.52; monthly spend guard open (ai_spend:workers-ai 793.53 over its 95 cap). Largest waste in the code loop: tickets that die on "patch too large: exceeds verification limit" or "python proposal too large to verify (103725 > 80000)" on the 0.8-1.6 MB workers (CODE-LOOP-EXHAUSTED-1 tickets 1000751, 1001295, 1001344, 1001577), and suites that break on the first edit. Doer qnfo-code-orchestrator; closes when contract issue-1000779 passes (yield rising, quality held, budget held).' WHERE issue_id = 1000779;
UPDATE issue_triage SET remediation = 'OWNER-ACT review 2026-11-05 (unit:issue): issue closures with evidence per $100 over 7 days 324.69 against the 251.8 baseline (met), remedy quality 0.53 against 0.53 (held). Open condition: monthly spend 1151.13 against the 300 budget (within_monthly_budget 0), a fleet-wide cost overage owned by the cost loops, not by this card. Contract issue-1000780 is active again and closes this card when the budget guard recovers.' WHERE issue_id = 1000780;
UPDATE issue_triage SET remediation = 'OWNER-ACT review 2026-11-05 (program QNFO.RSCH): breaching RSCH metrics that have an open issue but no active code task: correction_latency_p95_h 322 h (target 24; the likely cause is INTERNAL-ERRATA-DEAD-END-1, 613 internal errata deferred since 2026-10-23, whose code task ct_l4c73r15tvkj4x is exhausted), paper_version_immutability, forecast_resolution_criteria_complete, a11y_violations_serious (BP26 issues 1000670 1000671 1000672 1000518 are the doers). The program manager files code tasks worst-first; this card closes when contract issue-1000803 reads 0.' WHERE issue_id = 1000803;
UPDATE issue_triage SET remediation = 'OWNER-ACT review 2026-11-05 (cause:structure): debt = workers over the 30 cap (39 live, 9 over) + 18 single points of failure + 0 graph drift + recurring failure modes; each part has its own metric trigger issue (worker_count 99923, spofs_total 99933, failure_modes_recurring 3002). Doer qnfo-fleet-control; closes when contract issue-1000813 reads 0.' WHERE issue_id = 1000813;
UPDATE issue_triage SET remediation = 'OWNER-ACT review 2026-11-05 (program QNFO.REACH): four breaching REACH metrics have an open trigger issue and no code-task lever: social_bot_label_enabled (1000519), dmarc_aligned_pass_rate (1000524), ns_readers_engaged_per_day 6.29 against 12 (1001767), ns_ext_visits_per_paper_30d 0.07 against 0.25 (1001768). The first two are BP26 catalogue predicates; the last two name their lever (v_paper_readers_top, v_reader_yield_by_source). Closes when contract issue-1000822 reads none.' WHERE issue_id = 1000822;
UPDATE issue_triage SET remediation = 'OWNER-ACT review 2026-11-05 (program QNFO.INFRA): seven breaching INFRA triggers have an open issue and no code-task lever: kv_used_for_locking, gateway_coverage 0.54, ai_cache_hit_rate 0.06, deploys_via_gradual 0.003, secrets_in_repo 10, turnstile_on_public_forms 0.85, ns_fleet_cost_usd_month 798.53 against 300. The BP26 ones are catalogue predicates; the cost one is the top task of every session while a fleet_budget cap is breached. Closes when contract issue-1000823 reads 0.' WHERE issue_id = 1000823;

-- Supersessions (a duplicate of an open metric-trigger issue that carries the same measure, lever and doer). Contract first, then the triage close (REMEDIATION-REOPEN-2 reads 'superseded by agent_issues N').
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-ACT-REVIEW-1 by agent_issues 100222'
WHERE class = 'issue-1000781' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100222 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-ACT-REVIEW-1 by agent_issues 100464'
WHERE class = 'issue-1000802' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100464 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-ACT-REVIEW-1 by agent_issues 1000979'
WHERE class = 'issue-1000812' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000979 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-ACT-REVIEW-1 by agent_issues 1798'
WHERE class = 'issue-1000814' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1798 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-ACT-REVIEW-1 by agent_issues 99939'
WHERE class = 'issue-1000819' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 99939 AND status = 'open');

UPDATE agent_issues SET close_channel = 'session:G-owner-security' WHERE id IN (1000781, 1000802, 1000812, 1000814, 1000819) AND status = 'open' AND close_channel IS NULL;

UPDATE issue_triage
SET close_evidence = 'superseded by agent_issues 100222 (METRIC-TRIGGER-1519-EXTERNAL-IMPACT-PER-DOLLAR, open, critical): the same measure, external_impact_per_dollar 0.02359 against the 0.012 target on 2026-11-05, with the lever and the doer (qnfo-fleet-control, program QNFO.REACH) on that issue; the owner tap is carried there, not dropped (OWNER-ACT-REVIEW-1)',
    triage_state = 'closed'
WHERE issue_id = 1000781 AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100222 AND status = 'open') AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000781' AND status = 'superseded');
UPDATE issue_triage
SET close_evidence = 'superseded by agent_issues 100464 (METRIC-TRIGGER-10931-RESEARCH-NEURONS-PER-PUBLICATION-7D, open, critical): the same measure, research_neurons_per_publication_7d 117570.7 against the 20000 target on 2026-11-05, with its code-task lever and doer (qnfo-research-exec) on that issue (OWNER-ACT-REVIEW-1)',
    triage_state = 'closed'
WHERE issue_id = 1000802 AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100464 AND status = 'open') AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000802' AND status = 'superseded');
UPDATE issue_triage
SET close_evidence = 'superseded by agent_issues 1000979 (METRIC-TRIGGER-19106-LARGEST-ISSUE-FAMILY-NET-INFLOW-24H, open, critical): the same measure, the families whose net inflow is above 0 (13 families on 2026-11-05, largest ROADMAP-1 +25, BLINDSPOT-1 +10, LOOP-BREAKER-1 +8, v_issue_family_throughput), with the lever and the doer (qnfo-fleet-control) on that issue (OWNER-ACT-REVIEW-1)',
    triage_state = 'closed'
WHERE issue_id = 1000812 AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000979 AND status = 'open') AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000812' AND status = 'superseded');
UPDATE issue_triage
SET close_evidence = 'superseded by agent_issues 1798 (METRIC-TRIGGER-362-OPEN-AGENT-ISSUES, open, critical): the same measure, open_agent_issues 513 against the 260 trigger threshold on 2026-11-05 (this card read 400 without a close channel), with the lever and the doer (qnfo-fleet-control, issue-meta-fold, remediation consumer) on that issue; the 2026-11-04 remediation sweep (cluster reports under .claude/worktrees/remediation-2026-11-04) is the lever in motion (OWNER-ACT-REVIEW-1)',
    triage_state = 'closed'
WHERE issue_id = 1000814 AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1798 AND status = 'open') AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000814' AND status = 'superseded');
UPDATE issue_triage
SET close_evidence = 'superseded by agent_issues 99939 (METRIC-TRIGGER-4650-CODE-GOAL-SUCCESS-RATE-30D, open, critical): the same cause (the code loop finishes too few tasks; code_task_success_rate_30d 0.52, code_goal_success_rate_30d 0.603 against 0.9 on 2026-11-05), with the lever and the doer (qnfo-code-orchestrator) on that issue (OWNER-ACT-REVIEW-1)',
    triage_state = 'closed'
WHERE issue_id = 1000819 AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 99939 AND status = 'open') AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000819' AND status = 'superseded');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'the dashboard owner-act cards are fleet work (HUMAN-ITEMS-AUTOMATIC-1): each is either a missing measure, a mis-aimed probe, a duplicate of a metric-trigger issue, or an outcome that only moves with the open levers',
       'OWNER-ACT-REVIEW-1: register papers_per_100usd_7d with a floor trigger, map 4 unmapped breach metrics, narrow the 1000824 probe, give the 3 INTENT-TASK cards item probes, re-arm 1000780, supersede 5 duplicate cards, write measured reviews on 6 cards',
       'live qnfo-audit reads 2026-11-05 00:00Z: 1000778 probe expected a metric that did not exist; 1000780 yield 324.69 vs 251.8 baseline with a parked contract; 1000817 had 12 unmapped breach metrics, 9 mapped by PR 7347; 1000824 counted unmeasured and loop-owned triggers; 1001338 1001343 1001348 probes measured all task intents',
       'cards 1000778 1000817 1000824 1001338 1001343 1001348 pass their contracts or sit pending on a real measure; 1000781 1000802 1000812 1000814 1000819 close as superseded with survivors open',
       'qnfo-audit remediation_contracts (10 rows), issue_triage (11 rows), metric_registry and analytics_metric_triggers (1 row each), metric_breach_cause (5 rows)',
       'Rollback restores every contract and triage row from bak_20261105_g_owner_act and deletes the new metric, trigger and cause rows (header)',
       'the paper yield per $100 becomes a measured figure that the research pipeline cost work can be judged against',
       'papers_per_100usd_7d reads MEASURED within 2 hours of the merge (about 12.8); contracts issue-1000817 and issue-1000824 pass on their next run',
       'no external reach change',
       'live D1 reads of every contract, view and trigger touched; offline selftest of write_paper_yield (scripts/cost_ledger.py --selftest)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'OWNER-ACT-REVIEW-1: register%');
