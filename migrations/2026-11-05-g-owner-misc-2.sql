-- OWNER-SECURITY-CLUSTER-2 (2026-11-05, pillar autonomy; cluster G-owner-security of the 2026-11-04 open-issue sweep).
-- Read live 2026-11-05 03:30Z (qnfo-audit SELECT, GitHub REST, repository token):
--  1. GitHub 5552 (open the two prepared QNFO/.github pull requests): the cause is not the identity. QNFO/.github has has_pull_requests = false (GET /repos/QNFO/.github), so a
--     pull request cannot be created by any credential: POST /pulls answers 404 and gh pr create answers "does not have the correct permissions to execute CreatePullRequest" for the
--     admin-scope fleet token too. The branches fleet-audit/security-policy (1 commit, SECURITY.md, 28 lines) and fleet-audit/hygiene (1 commit, 4 files) exist and diverge from master.
--     Turning a feature on in the owner's repository settings is a settings change in the owner's own account: an IDENTITY-BOUND card with a closing probe on the setting itself. The two
--     pull requests are opened from the fleet credential as soon as the setting is on (commands in the card).
--  2. agent_issues 1001749 (the owner's hand-back of the jobsearch ledger card 198): its contract is the closure-observing birth template (superseded, CLOSE-PROBE-CIRCULAR-1), so the
--     issue has no probe that measures its subject. The measuring probe already exists on the owner-step contract owner-card-jobsearch-ledger (jobsearch_meta ledger_open_questions = 0);
--     the issue now carries the same probe.
--  3. Six CODE-LOOP-EXHAUSTED-1 tickets record that the code loop could not finish a task for an issue that is still open and carries the defect, the lever, the doer and the closing
--     probe itself (RED-DRAIN-1 re-dispatches from the parent). The ticket adds no second path: it is superseded by its parent (ISSUE-HYGIENE-1 lists CODE-LOOP-EXHAUSTED-1 among the
--     tickets that close with the fact that resolved them or with the successor's id). The parent keeps the work; what blocks each parent is written on its triage row.
--  4. OWNER-TASK 1000941 (route every AI consumer through the dynamic gateway routes): the verification the card asks for is done (routes premium, standard and value exist, each with an
--     active version and a deployment, read by gateway-routes in workflow run 41939424916, PR 7381); the consumer conversion and the one-week cost audit are written on its triage row with the
--     measured inventory. It stays open.
-- No cap, guard or probe is weakened. Every changed row is backed up and the Rollback restores it.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_g_owner_misc b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_g_owner_misc b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_g_owner_misc b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class) WHERE class IN (SELECT k FROM bak_20261105_g_owner_misc WHERE kind = 'contract'); UPDATE issue_triage SET triage_state = (SELECT b.status FROM bak_20261105_g_owner_misc b WHERE b.kind = 'triage' AND b.k = CAST(issue_triage.issue_id AS TEXT)), close_evidence = (SELECT b.last_verdict FROM bak_20261105_g_owner_misc b WHERE b.kind = 'triage' AND b.k = CAST(issue_triage.issue_id AS TEXT)), remediation = (SELECT b.verify_probe FROM bak_20261105_g_owner_misc b WHERE b.kind = 'triage' AND b.k = CAST(issue_triage.issue_id AS TEXT)) WHERE CAST(issue_id AS TEXT) IN (SELECT k FROM bak_20261105_g_owner_misc WHERE kind = 'triage'); UPDATE agent_issues SET status = 'open', close_channel = NULL WHERE id IN (1000751, 1000754, 1000972, 1000995, 1001426, 1001577); UPDATE human_actions SET status = 'resolved', resolution = 'rolled back' WHERE slug = 'dotgithub-enable-pull-requests'; UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'rolled back' WHERE class = 'owner-card-dotgithub-pull-requests';

CREATE TABLE IF NOT EXISTS bak_20261105_g_owner_misc (kind TEXT NOT NULL, k TEXT NOT NULL, verify_probe TEXT, status TEXT, last_verdict TEXT, PRIMARY KEY (kind, k));
INSERT OR IGNORE INTO bak_20261105_g_owner_misc (kind, k, verify_probe, status, last_verdict)
SELECT 'contract', class, verify_probe, status, last_verdict FROM remediation_contracts
WHERE class IN ('issue-1001749', 'issue-1000751', 'issue-1000754', 'issue-1000972', 'issue-1000995', 'issue-1001426', 'issue-1001577');
INSERT OR IGNORE INTO bak_20261105_g_owner_misc (kind, k, verify_probe, status, last_verdict)
SELECT 'triage', CAST(issue_id AS TEXT), remediation, triage_state, close_evidence FROM issue_triage
WHERE issue_id IN (1000751, 1000754, 1000972, 1000995, 1001426, 1001577, 1000941, 1000652, 1000019, 99909, 100226, 1000598, 1000744);

-- (1) 5552: the owner card for the repository setting, with a probe on the setting.
INSERT INTO human_actions (slug, title, why, default_in_effect, action, url, sev, status, source, created_at, updated_at)
SELECT 'dotgithub-enable-pull-requests', 'Turn on Pull requests for QNFO/.github so the two prepared fleet-audit pull requests can be opened',
 'IDENTITY-BOUND: the Pull requests feature of QNFO/.github is switched off in the repository settings (the repository API reports has_pull_requests false), so no credential can open a pull request there, the fleet token included; switching a feature on or off in your own repository is a change to your own account settings, which the fleet does not make for you. The two prepared branches (fleet-audit/security-policy: a SECURITY.md of 28 lines; fleet-audit/hygiene: two pinned actions, a Dependabot file and the licence name in two READMEs) are ready and diverge from master by 94 and 38 commits.',
 'No pull request is opened. The branches stay prepared in QNFO/.github, the organisation has no SECURITY.md of its own, and nothing else is blocked.',
 'Open https://github.com/QNFO/.github/settings, section Features, and tick Pull requests. The fleet then opens both pull requests (gh pr create --repo QNFO/.github --base master --head fleet-audit/security-policy, then --head fleet-audit/hygiene) and the normal lane reviews them; the card closes when the repository reports the feature on.',
 'https://github.com/QNFO/.github/settings', 'low', 'open', 'session:G-owner-security', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM human_actions WHERE slug = 'dotgithub-enable-pull-requests');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('owner-card-dotgithub-pull-requests', NULL, 'OWNER-SECURITY-CLUSTER-2', 'closes the human_actions card dotgithub-enable-pull-requests when QNFO/.github reports Pull requests on',
  '{"url": "https://api.github.com/repos/QNFO/.github", "status": 200, "contains": "\"has_pull_requests\": true"}',
  'runner-https', 3, 'qnfo-cloud-ops', 2, 'active', 'owner-step', datetime('now'));

-- (2) 1001749: the issue carries the probe that measures the ledger questions.
UPDATE remediation_contracts
SET verify_probe = (SELECT verify_probe FROM remediation_contracts WHERE class = 'owner-card-jobsearch-ledger'),
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1001749' AND issue_id = 1001749 AND status = 'superseded' AND last_verdict LIKE 'superseded:closure-observing-probe-at-birth%'
  AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'owner-card-jobsearch-ledger' AND verify_probe LIKE '%ledger_open_questions%');

-- (3) CODE-LOOP-EXHAUSTED-1 tickets with an open parent: contract first, then the triage close naming the parent.
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-SECURITY-CLUSTER-2 by agent_issues 1000652'
WHERE class = 'issue-1000751' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000652 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-SECURITY-CLUSTER-2 by agent_issues 1000019'
WHERE class = 'issue-1000754' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000019 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-SECURITY-CLUSTER-2 by agent_issues 99909'
WHERE class = 'issue-1000972' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 99909 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-SECURITY-CLUSTER-2 by agent_issues 100226'
WHERE class = 'issue-1000995' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100226 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-SECURITY-CLUSTER-2 by agent_issues 1000598'
WHERE class = 'issue-1001426' AND status IN ('active', 'holding', 'monitoring', 'deferred') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000598 AND status = 'open');
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:OWNER-SECURITY-CLUSTER-2 by agent_issues 1000744'
WHERE class = 'issue-1001577' AND status IN ('active', 'holding', 'monitoring') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000744 AND status = 'open');

UPDATE agent_issues SET close_channel = 'session:G-owner-security' WHERE id IN (1000751, 1000754, 1000972, 1000995, 1001426, 1001577) AND status = 'open' AND close_channel IS NULL;

UPDATE issue_triage SET triage_state = 'closed',
 close_evidence = 'superseded by agent_issues 1000652 (RM-AUTOROUTER-EVAL-1, open, critical): the cf_ops_actions.py half of this task landed as PR 7381 (gateway-routes reads the live data.routes shape; read-only run 41939424916 found three dynamic routes and no Auto Router) and the missing shadow-replay caller is ROADMAP-1 AUTOROUTER-EVAL-1.2; the parent holds the probe (three autorouter-shadow events in 14 days). The ticket that the proposal was over the 80000-char verify cap is moot: the slice is small and separate (OWNER-SECURITY-CLUSTER-2)'
WHERE issue_id = 1000751 AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000751' AND status = 'superseded');
UPDATE issue_triage SET triage_state = 'closed',
 close_evidence = 'superseded by agent_issues 1000019 (INTERNAL-ERRATA-DEAD-END-1, open, critical): the code loop failed three times on "no SEARCH/REPLACE block found" (the model answered 8192 exclamation marks) in qnfo-research-exec/worker.js, a 1.6 MB file; the defect, the lever and the closing probe (internal errata settled per 24 h, errata-watch tick age) are on the parent, which the code loop re-dispatches. Read 2026-11-05: parent contract last verdict "stale: the errata-watch tick has not run since 2026-11-04T20:01Z" (OWNER-SECURITY-CLUSTER-2)'
WHERE issue_id = 1000754 AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000754' AND status = 'superseded');
UPDATE issue_triage SET triage_state = 'closed',
 close_evidence = 'superseded by agent_issues 99909 (METRIC-TRIGGER-357-WATCHMAKER-INDEX, open, critical): the same metric; GET https://fleet.qnfo.org/api/watchmaker read 2026-11-05T01:45Z gives index 2 (counted: errata-publish stalled 3.3 h, code-task-merge 78 code-loop PRs or tasks that needed a person) against 42 on the 2026-11-04 snapshot. The failed task patch broke the dashboard suites cmd-agent, cmd-voice, psr-narrative-cap-soft and watchmaker, the parent carries the lever and the metric-condition probe (OWNER-SECURITY-CLUSTER-2)'
WHERE issue_id = 1000972 AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000972' AND status = 'superseded');
UPDATE issue_triage SET triage_state = 'closed',
 close_evidence = 'superseded by agent_issues 100226 (METRIC-TRIGGER-354-WORKERS-AI-COST-30D-USD, open, critical): the same cost gap (workers_ai_cost_30d_usd 514.04 against 95 on 2026-11-05) with the lever and probe on the parent. The failed qnfo-research-exec patch broke budget-gate, internal-appendix and park-rearm-cap suites; the research cost breakdown by step is on agent_issues 1000778 trigger papers_per_100usd_7d (revise 1.23M, ensemble 0.98M, review 0.77M neurons in 7 days) (OWNER-SECURITY-CLUSTER-2)'
WHERE issue_id = 1000995 AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000995' AND status = 'superseded');
UPDATE issue_triage SET triage_state = 'closed',
 close_evidence = 'superseded by agent_issues 1000598 (NET-ZERO-1: retire qnfo-ipatent to fund qnfo-youtube-shorts, open, critical): the code loop made nine attempts in three rounds and the last failed because its SEARCH text did not occur in the 1.4 MB dashboard worker; the parent holds the net-zero rule (39 live workers against the cap of 30), the dependency check (fleet-graph impact on worker:qnfo-ipatent) and the closing probe. qnfo-ipatent is live and serving /health (version 3.20.2) on 2026-11-05, so the retirement needs its own measured case first (OWNER-SECURITY-CLUSTER-2)'
WHERE issue_id = 1001426 AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001426' AND status = 'superseded');
UPDATE issue_triage SET triage_state = 'closed',
 close_evidence = 'superseded by agent_issues 1000744 (MONITORING-PASS-1, open, critical): the patch needed qnfo-fleet-control/worker.js and remediation-evidence-fallback.test.mjs (which pinned exactly three verification inserts) in one change and was over the verifier limit. The test now derives the count (shipped in the pull request that carries this migration), so the worker change is a single-file patch on the parent, whose probe counts open monitoring contracts without a monitoring-pass verification row (115 on 2026-11-04T23:51Z)'
WHERE issue_id = 1001577 AND EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1001577' AND status = 'superseded');

-- What blocks the parents (written once, on their triage rows).
UPDATE issue_triage SET remediation = 'OWNER-SECURITY-CLUSTER-2 2026-11-05: the monitoring pass is specified on the issue (limited pass in remediationContractsTick, own LIMIT 60, verifier qnfo-fleet-control/monitoring-pass@VERSION, never mutates a contract). The test that made it a two-file patch is fixed; the worker change is waiting for the qnfo-fleet-control/worker.js work claim (held by another session). Next doer: the first session or code task that takes the claim.' WHERE issue_id = 1000744;
UPDATE issue_triage SET remediation = 'OWNER-SECURITY-CLUSTER-2 2026-11-05: confirmInternalErrata still defers its candidates; the parent contract reads stale (errata-watch tick not run since 2026-11-04T20:01Z) and 3 errata settled in 24 h. The code loop failed on the 1.6 MB qnfo-research-exec/worker.js (reply of 8192 exclamation marks, no SEARCH/REPLACE block). Needs a one-function task with an anchor from worker_outline.py; qnfo-research-exec/worker.js was held by code task ct_im1001450 when this was written.' WHERE issue_id = 1000019;
UPDATE issue_triage SET remediation = 'OWNER-SECURITY-CLUSTER-2 2026-11-05: Workers AI cost 514.04 USD over 30 days against 95; the largest research-exec buckets over 7 days are revise, ensemble and review, and the glm-5.3-flash ensemble, reconcile and revise calls fail 27, 21 and 18 percent of the time (ai_call_counters). The patch the loop built broke budget-gate, internal-appendix and park-rearm-cap suites. The lever is the papers_per_100usd_7d trigger text (agent_issues from migrations/2026-11-05-g-owner-act-1.sql).' WHERE issue_id = 100226;
UPDATE issue_triage SET remediation = 'OWNER-SECURITY-CLUSTER-2 2026-11-05: qnfo-ipatent is live (3.20.1, /health ok) and the fleet has 39 workers against the cap of 30, so the net-zero rule asks for a retirement; ipatent keeps a Vectorize corpus, a D1 and an R2 bucket and serves users, so the first step is the fleet-graph impact check on worker:qnfo-ipatent and a same-class choice (the idle workers first), not this task as worded.' WHERE issue_id = 1000598;
UPDATE issue_triage SET remediation = 'OWNER-SECURITY-CLUSTER-2 2026-11-05: the watchmaker index read 2 (from 42): errata-publish is gated off by pipeline_flags.errata_publish_enabled and its errata-hub tick stalled 3.3 h; code-task-merge counts 78 code-loop PRs or tasks that needed a person. Both are named on GET https://fleet.qnfo.org/api/watchmaker; the metric-condition probe on this issue closes it at 0.' WHERE issue_id = 99909;
UPDATE issue_triage SET remediation = 'OWNER-SECURITY-CLUSTER-2 2026-11-05: PR 7381 fixed the read-only gateway-routes action (routes premium, standard and value exist, no Auto Router) and its probe now measures the definition of done (three autorouter-shadow events in 14 days); the shadow-replay caller is ROADMAP-1 AUTOROUTER-EVAL-1.2 on qnfo-cloud-ops.' WHERE issue_id = 1000652;
UPDATE issue_triage SET remediation = 'OWNER-TASK 2026-11-05: (1) verification done: gateway-routes (PR 7381, workflow run 41939424916, repository token, read-only) lists the dynamic routes premium, standard and value, each with an active version and a deployment (created 2026-10-31T16:02Z); no Auto Router exists. (2) conversion: qnfo-agents already runs agent turns and CodeSession on dynamic/standard; the callers that still name a Workers AI model id are the research pipeline (qnfo-research-exec about 3.9M neurons in 7 days), qnfo-code-orchestrator, q08-signal-engine, qnfo-paper-reviser and errata-hub (ai_call_counters, 7 days to 2026-11-04); gateway_coverage reads 0.54 (trigger issue 1000529). Each conversion is a change to a 0.5-1.6 MB worker behind a per-request fallback to the model id, so it is one pull request per worker, highest neurons first. (3) cost audit: gateway-cache-share and papers_per_100usd_7d / research_neurons_per_publication_7d read a week after each conversion.' WHERE issue_id = 1000941;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:G-owner-security',
       'a CODE-LOOP-EXHAUSTED-1 ticket whose parent issue is open adds no second path and no information the parent lacks; the cause of GitHub 5552 is a repository setting, not an identity',
       'OWNER-SECURITY-CLUSTER-2: supersede 6 exhausted-task tickets by their open parents, give 1001749 the ledger probe, add the QNFO/.github pull-request owner card with a probe on the setting, write what blocks each parent',
       'live reads 2026-11-05: GET /repos/QNFO/.github has_pull_requests false and POST /pulls 404 with an admin-scope token; parents 1000652 1000019 99909 100226 1000598 1000744 open with contracts; 1001749 contract born superseded on a closure-observing probe',
       'six tickets close as superseded with their parents named; the owner sees one card for the one setting that blocks 5552',
       'qnfo-audit remediation_contracts (8 rows), issue_triage (13 rows), human_actions (1 row), agent_issues close_channel (6 rows)',
       'Rollback restores every contract and triage row from bak_20261105_g_owner_misc and reopens the six tickets (header)',
       'the owner queue says exactly what is blocked and the setting that clears it',
       'the six tickets leave the open list; contract owner-card-dotgithub-pull-requests passes within 2 hours of the owner turning Pull requests on',
       'no external reach change',
       'live D1 and GitHub reads of every row touched; offline suite migrations/g-owner-misc-2.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'OWNER-SECURITY-CLUSTER-2: supersede%');
