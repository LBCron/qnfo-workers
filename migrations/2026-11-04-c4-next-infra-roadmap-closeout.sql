-- CF-ESTATE-1 / NEXT-QNFO.INFRA.* closeout (2026-11-05, charter pillars core, cost and security; session c4-next of the 2026-11-04 roadmap completion sweep).
-- roadmap_implementation rows 610 (QNFO.INFRA.WORK), 611 (PAGE), 612 (DNS), 613 (D1) and 614 (R2) were opened by portfolio-self-manage on 2026-10-18 with the definition of done
-- "name the next concrete deliverable and map work to it, or retire the project with a reason": portfolio-execute cannot advance an active curated project that has no issue mapped to
-- it (fleet_tasks portfolio-execute step no-mapped-work). What this file does, for each of the five projects:
--   1. the deliverable of this change is scripts/cf_estate.py (workflow cf-estate, five read-only actions, offline suite scripts/cf_estate_test.py): worker-inventory, pages-inventory,
--      dns-drift, d1-query-report, r2-inventory, plus docs/DOMAINS.md brought in line with the account (11 served hosts were missing from its table);
--   2. files the NEXT slice as an agent_issues row with a code-task, a code-anchor and a code-probe, so a doer exists (the code loop), and maps it to the project in issue_project_map
--      (the steward keeps an open issue on an active catalogue project that is not a W.<worker> project, PS-KEEP-CATALOGUE-PROJECT-1);
--   3. sets the roadmap row to partial with the evidence read on 2026-11-04 (portfolio-self-manage / roadmap-self-maintain verify a NEXT- row on mapped work by themselves; this text is
--      the record of what was built and what is not yet verified live).
-- The note on the rows that agent_issues INSERT failed with "triggers nested too deep" is stale: ids up to 1001850 were inserted on 2026-11-04 (the last at 22:54Z) and this file inserts five.
-- No trigger is added or changed (AGENT-ISSUES-TRIGGER-DEPTH-1). Nothing is deleted.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_c4_next_infra
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_c4_next_infra b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_c4_next_infra b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_c4_next_infra b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_c4_next_infra); DELETE FROM issue_project_map WHERE project_code IN ('QNFO.INFRA.WORK', 'QNFO.INFRA.PAGE', 'QNFO.INFRA.DNS', 'QNFO.INFRA.D1', 'QNFO.INFRA.R2') AND issue_id IN (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA.% #1: %' AND source = 'cf-estate-1'); DELETE FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA.% #1: %' AND source = 'cf-estate-1' AND status = 'open';
-- spof-review: no new cron, trigger, binding, host or credential; scripts/cf_estate.py runs in a dispatch-only workflow with the repository token and writes nothing to Cloudflare.

CREATE TABLE IF NOT EXISTS bak_20261105_c4_next_infra AS
SELECT id, status, evidence, verified_at FROM roadmap_implementation
WHERE id IN (610, 611, 612, 613, 614) AND item LIKE 'NEXT-QNFO.INFRA.%';

-- 1. WORK: the count the cap is compared with must not include the Workers Builds stub
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA.WORK #1: worker_count and worker_count_disagreement must not count the qnfo-workers tombstone',
'Charter pillar: core (worker cap). Metric it should move: worker_count 39 to 38 and worker_count_disagreement 1 to 0 on the first qnfo-fleet-control budgetAudit tick after the deploy. The cap trigger is gt 30, so the breach stays until the fleet is under 30; this removes the one script that is not a fleet worker from the count.

Evidence (python3 scripts/cf_estate.py worker-inventory, workflow cf-estate, replayed on the live account 2026-11-04): 39 account scripts, 1 tombstone (qnfo-workers: worker_live_audit http 410 TOMBSTONE_410, service_registry state retired since 2026-11-04T23:00Z), 38 fleet workers; registry disagreement raw [qnfo-workers], tombstone-aware []. cloud_ops_events worker-count-2026-11-04: worker count: 39 live scripts, 38 registry rows live, disagreement 1: only live qnfo-workers. The stub cannot be deleted: the Workers Builds integration recreates it on every push (agent_issues 1000156 records it, registry side). Two further scripts have no source directory here: qnfo-fleet-lee and voice-stt (classified unmanaged, not changed by this issue).

Change: in qnfo-fleet-control/worker.js give workerCountDiff a third argument tombstones (script names whose worker_live_audit row has http 410 or a TOMBSTONE note and whose service_registry state is retired); remove them from the live list, the registry list and the live count. oneWorkerCount reads SELECT worker FROM worker_live_audit WHERE http = 410 and passes the names; the worker-count event text names the tombstones. Regression test in qnfo-fleet-control/one-worker-count.test.mjs: a live script with http 410 and a retired registry row leaves live, registry and disagreement unchanged; a live script with http 410 and a live registry row is not excluded. Bump with python scripts/worker_release.py bump qnfo-fleet-control.

code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js
code-anchor: function workerCountDiff(liveIds, registryRows) {
code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "function workerCountDiff(liveIds, registryRows, tombstones) {"}',
'cf-estate-1', 'reliability', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'ROADMAP-1: QNFO.INFRA.WORK #1: worker_count and worker_count_disagreement must not count the qnfo-workers tombstone');

-- 2. PAGE: retire what the inventory proves dead, with a backup and a verdict gate
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA.PAGE #1: guarded delete of a Pages project the inventory marks retire-candidate (q08-archive first)',
'Charter pillar: cost (a dead Pages project is a stale public surface and an untracked deploy target). Metric it should move: retire-candidate verdicts of python3 scripts/cf_estate.py pages-inventory, 1 to 0.

Evidence (pages-inventory, replayed on the live account 2026-11-04): 7 Pages projects. q08-archive: no custom domain, last deploy 2026-09-26, no workflow names it, no code names q08-archive.pages.dev; its page is a 1.1 KB q08.org archived notice. Verdict review, not retire: qnfo-landing (radar-hub/worker.js and qnfo-cloud-ops/worker.js name qnfo-landing.pages.dev; repoint or drop those first) and ask-qwav (ask.qwav.tech is answered by the qnfo-ai-search route: the two bodies differ, 51 KB against 11 KB; scripts/attach-ask-qwav-route.py replaced the project; detach the custom domain, then retire). keep: qwav, qnfo-publications, qnfo-hub, active: qwav-demo-bt-qec.

Change: add action delete-pages-project NAME to scripts/cf_ops_actions.py, modelled on delete_vectorize_index: refused unless scripts/cf_estate.py classify_pages gives NAME the verdict retire-candidate (fresh Pages list, fresh repo scan), refused when the project has a custom domain, writes the project latest deployment file list (names and sizes, no content) to R2 qnfo-backups/pages-retired/NAME.json before the DELETE and verifies it by reading it back, prints the project it deleted. Offline test scripts/cf_ops_pages_retire_test.py with a fake API (each refusal, the backup before the delete, the verdict gate). Then run it for q08-archive and attach the pages-inventory re-run to this issue as the closing evidence. Add the action to .github/workflows/cf-ops-actions.yml in the same change.

code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py
code-anchor: def delete_vectorize_index(name: str, acct: str, token: str) -> int:
code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "def delete_pages_project("}',
'cf-estate-1', 'cost', 'low', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'ROADMAP-1: QNFO.INFRA.PAGE #1: guarded delete of a Pages project the inventory marks retire-candidate (q08-archive first)');

-- 3. DNS: remove what dns-drift proves stale
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA.DNS #1: guarded prune of the stale DNS record and redirect rule that dns-drift reports',
'Charter pillar: security (a record that names a deleted worker is a subdomain takeover surface), core. Metric it should move: dns-drift hard findings 1 to 0 and stray_redirect 1 to 0 (python3 scripts/cf_estate.py dns-drift).

Evidence (dns-drift replayed on the live account 2026-11-04, 66 documented hosts, 65 served, 0 missing, 0 undocumented after docs/DOMAINS.md was brought in line): dangling_target analytics.qnfo.org CNAME qnfo-analytics.q08.workers.dev (the script is gone, qnfo-analytics/RETIRED; the route analytics.qnfo.org/* to qnfo-lifecycle answers the host, so the record is dead weight); stray_redirect: zone qnfo.org carries the rule http.host eq primer.qwav.tech, which can never match there (primer.qwav.tech is in zone qwav.tech and has its own rule). delegation_lost qwave.tech and q-wave.tech is the lapsed registration of human_actions 102 (resolved) and is not fixed here. shadowed_pages: archive.qnfo.org, www.qnfo.org and ask.qwav.tech are listed on a Pages project and answered by a worker route (see the PAGE issue).

Change: add action dns-prune to scripts/cf_ops_actions.py, dry run by default (the write needs --model live): for each dangling_target CNAME of cf_estate.evaluate_dns whose host is also answered by a worker route or custom domain, and each stray redirect rule, write the record or rule JSON to R2 qnfo-backups/dns-pruned/ZONE-DATE.json (verified by read-back), then delete it. Refuses any other record, any zone not in the account and a record whose target script exists. Offline test scripts/cf_ops_dns_prune_test.py with a fake API. Run it once live and attach the dns-drift re-run (hard 0) as the closing evidence. Add the action to .github/workflows/cf-ops-actions.yml in the same change.

code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py
code-anchor: def zaraz_remove_tool(zone_name: str, match: str, token: str) -> int:
code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "def dns_prune("}',
'cf-estate-1', 'security', 'low', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'ROADMAP-1: QNFO.INFRA.DNS #1: guarded prune of the stale DNS record and redirect rule that dns-drift reports');

-- 4. D1: keep each report so a change is judged on two of them
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA.D1 #1: keep each d1-query-report in R2 and compare the next one against it',
'Charter pillar: core (D1 reliability), cost. Metric it should move: every D1 change that names a hot statement is verified by a stored same-window comparison (rows read of the top 5 tables), where today it is verified by a report that is gone with its job log.

Evidence: docs/D1-SPLIT-DESIGN-2026-11.md and docs/D1-CLOUD-OPS-EVENTS-2026-11.md both end in "re-run the same d1QueriesAdaptiveGroups query and compare"; until python3 scripts/cf_estate.py d1-query-report nothing ran it. The first reports (2026-11-04) show the hot statement moving between windows: in the 6 h window to about 23:10Z INSERT OR REPLACE INTO cron_fault_seen read 101M rows (857k per call, 121 s of query time); in the last hour it was not in the top 7 (the cron-faults migrations of the same day landed) and UPDATE metric_registry SET last_value = CAST(CASE metric WHEN prd_funnel_missing_transitions read 8M rows in 64 calls. Without a stored baseline the next change cannot show that it helped.

Change: scripts/cf_estate.py d1-query-report gets --save (write the RESULT_JSON to R2 qnfo-backups/d1-query-report/DB/UTC-timestamp.json with the repository token; the one write cf_estate.py makes, limited to that prefix) and --baseline-r2 (read the newest earlier report of the same database and hours and pass it to compare_d1); the cf-estate workflow passes both. scripts/cf-estate.test.mjs is updated to allow that one PUT and nothing else. Test: the fake transport in scripts/cf_estate_test.py (prefix check, newest-baseline choice, a missing baseline is not an error).

code-task: repo=qnfo-workers path=scripts/cf_estate.py
code-anchor: def compare_d1(cur: dict, base: dict) -> list:
code-probe: {"paths": ["scripts/cf_estate.py"], "contains": "--baseline-r2"}',
'cf-estate-1', 'reliability', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'ROADMAP-1: QNFO.INFRA.D1 #1: keep each d1-query-report in R2 and compare the next one against it');

-- 5. R2: a reversible switch for public r2.dev access, used first on the unreferenced bucket
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA.R2 #1: guarded switch for a bucket public r2.dev access, first for the unreferenced qnfo bucket',
'Charter pillar: security. Metric it should move: public_unexpected buckets of python3 scripts/cf_estate.py r2-inventory, 1 to 0.

Evidence (r2-inventory, replayed on the live account 2026-11-04): 19 buckets, 92.1 GB (docs/SYSTEM-MAP.md lists 12: it lists the bound ones). Two have r2.dev public access enabled: qnfo-assets (expected: the calendar .ics bearer URLs of qnfo-lifecycle and personal-companion) and qnfo (641 objects, 11.8 MB, bound by qnfo-gateway; no code, workflow or document in this repository names its r2.dev host pub-426be63219f54be3932467bcbaf805f5). Seven buckets have no worker binding and 50 or fewer requests in 30 days: deepchat 4.67 GB (owner client data), qnfo-ddocs 0.69 GB (its indexer is RETIRED), qnfo-projects, releases, git-repos, palimpsest-research, play-the-ball. The report deletes nothing.

Change: add action r2-public to scripts/cf_ops_actions.py: with no --model it prints the bucket managed r2.dev state; --model off or on sets it (PUT /accounts/ID/r2/buckets/NAME/domains/managed with enabled), prints the previous state so the switch is reversible (turning it on again brings back the same host), and refuses to turn off a bucket in cf_estate.R2_PUBLIC_EXPECTED. Offline test scripts/cf_ops_r2_public_test.py with a fake API. Before turning qnfo off, search the published corpus (living-paper papers.body_md) and the outreach text for the pub-426be63219f54be3932467bcbaf805f5 host and record the result here; if a document names it, leave it on and allowlist it in R2_PUBLIC_EXPECTED with the reason. The seven idle buckets stay with their owners: a delete needs a dependency check (S3 clients on the owner machine, runner scripts) and a backup first. Attach the r2-inventory re-run as the closing evidence. Add the action to .github/workflows/cf-ops-actions.yml in the same change.

code-task: repo=qnfo-workers path=scripts/cf_ops_actions.py
code-anchor: def kv_secret_scan(nsid: str, acct: str, token: str) -> int:
code-probe: {"paths": ["scripts/cf_ops_actions.py"], "contains": "def r2_public("}',
'cf-estate-1', 'security', 'low', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'ROADMAP-1: QNFO.INFRA.R2 #1: guarded switch for a bucket public r2.dev access, first for the unreferenced qnfo bucket');

-- map each issue to its project (one row per issue; portfolio-execute reads issue_project_map)
INSERT OR REPLACE INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at)
SELECT (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %'), 'QNFO.INFRA.WORK', 'QNFO.INFRA', 'enhancement', datetime('now')
WHERE EXISTS (SELECT 1 FROM projects WHERE project_code = 'QNFO.INFRA.WORK') AND (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %') IS NOT NULL;
INSERT OR REPLACE INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at)
SELECT (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.PAGE #1: %'), 'QNFO.INFRA.PAGE', 'QNFO.INFRA', 'enhancement', datetime('now')
WHERE EXISTS (SELECT 1 FROM projects WHERE project_code = 'QNFO.INFRA.PAGE') AND (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.PAGE #1: %') IS NOT NULL;
INSERT OR REPLACE INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at)
SELECT (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.DNS #1: %'), 'QNFO.INFRA.DNS', 'QNFO.INFRA', 'enhancement', datetime('now')
WHERE EXISTS (SELECT 1 FROM projects WHERE project_code = 'QNFO.INFRA.DNS') AND (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.DNS #1: %') IS NOT NULL;
INSERT OR REPLACE INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at)
SELECT (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.D1 #1: %'), 'QNFO.INFRA.D1', 'QNFO.INFRA', 'enhancement', datetime('now')
WHERE EXISTS (SELECT 1 FROM projects WHERE project_code = 'QNFO.INFRA.D1') AND (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.D1 #1: %') IS NOT NULL;
INSERT OR REPLACE INTO issue_project_map (issue_id, project_code, program_code, kind, updated_at)
SELECT (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.R2 #1: %'), 'QNFO.INFRA.R2', 'QNFO.INFRA', 'enhancement', datetime('now')
WHERE EXISTS (SELECT 1 FROM projects WHERE project_code = 'QNFO.INFRA.R2') AND (SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.R2 #1: %') IS NOT NULL;

-- the five roadmap rows: what was built, what was read, what is next, what is not yet verified live
UPDATE roadmap_implementation
SET status = 'partial', verified_at = NULL,
    evidence = 'Deliverable (PR 7413, scripts/cf_estate.py worker-inventory, workflow cf-estate, suite scripts/cf_estate_test.py): account scripts reconciled with repo directories, RETIRED/FOLDED markers, service_registry, worker_live_audit and worker_usage_daily, with tombstone-aware counts. Replayed on the live account 2026-11-04: 39 scripts, 1 tombstone (qnfo-workers), 38 fleet workers against the cap of 30, unmanaged without source here: qnfo-fleet-lee and voice-stt, registry disagreement 1 raw and 0 tombstone-aware. deploy-drift-guard already covers repo version against /health and RETIRED_PRESENT; this adds the registry, usage and tombstone view. Next slice, mapped and with a doer: agent_issues ' || COALESCE((SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.WORK #1: %'), '?') || ' (tombstone-aware worker_count in qnfo-fleet-control, code-task). The note that agent_issues INSERT fails with triggers nested too deep is stale: ids up to 1001850 were inserted on 2026-11-04. Not yet read: a live run of the workflow after the merge.'
WHERE id = 610 AND item = 'NEXT-QNFO.INFRA.WORK' AND status = 'planned';
UPDATE roadmap_implementation
SET status = 'partial', verified_at = NULL,
    evidence = 'Deliverable (PR 7413, scripts/cf_estate.py pages-inventory): every Pages project with domains, days since the last deploy, documented or not in docs/DOMAINS.md, shadowed by a worker route, named by code, and a verdict keep, active, document, review or retire-candidate. Replayed on the live account 2026-11-04: 7 projects; keep qwav, qnfo-publications, qnfo-hub; active qwav-demo-bt-qec; review qnfo-landing (radar-hub and qnfo-cloud-ops name qnfo-landing.pages.dev) and ask-qwav (its domain is answered by the qnfo-ai-search route); retire-candidate q08-archive (no domain, no deploy since 2026-09-26, no reference). docs/DOMAINS.md now names the six qnfo-hub hosts. Nothing is deleted: a shadowing route may still fetch the deployment, so a body comparison and a backup come first. Next slice, mapped and with a doer: agent_issues ' || COALESCE((SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.PAGE #1: %'), '?') || ' (guarded delete-pages-project, q08-archive first). Not yet read: a live run of the workflow after the merge.'
WHERE id = 611 AND item = 'NEXT-QNFO.INFRA.PAGE' AND status = 'planned';
UPDATE roadmap_implementation
SET status = 'partial', verified_at = NULL,
    evidence = 'Deliverable (PR 7413, scripts/cf_estate.py dns-drift and doc-check; docs/DOMAINS.md; docs/domains-doc.test.mjs runs doc-check on every change to that file): the host table is checked against zone routes, worker custom domains, Pages domains, redirect rules, DNS records and public NS. Replayed on the live account 2026-11-04 it found 11 served hosts missing from the table (mind.q08.org, watch.q08.org, agents.qnfo.org, lee.qnfo.org, six qnfo-hub Pages hosts, the spare zones qnfo.net and qnfo.uk), now documented; it also reports a dangling CNAME (analytics.qnfo.org to a deleted worker), a redirect rule in the wrong zone (primer.qwav.tech in qnfo.org), three Pages domains shadowed by a worker route and two zones whose registration lapsed (qwave.tech, q-wave.tech; human_actions 102). Next slice, mapped and with a doer: agent_issues ' || COALESCE((SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.DNS #1: %'), '?') || ' (guarded dns-prune with backup). Not yet read: a live run of the workflow after the merge.'
WHERE id = 612 AND item = 'NEXT-QNFO.INFRA.DNS' AND status = 'planned';
UPDATE roadmap_implementation
SET status = 'partial', verified_at = NULL,
    evidence = 'Deliverable (PR 7413, scripts/cf_estate.py d1-query-report): Cloudflare d1QueriesAdaptiveGroups for one database over a window, rows read, rows written and query time per table and per statement (each statement attributed to its own target table, so the sums equal the total), scan suspects at 100000 rows per call, database sizes, and a delta against an earlier report. It makes the verification step of docs/D1-SPLIT-DESIGN-2026-11.md and docs/D1-CLOUD-OPS-EVENTS-2026-11.md repeatable. Read live 2026-11-04 for qnfo-audit: 6 h to about 23:10Z, INSERT OR REPLACE INTO cron_fault_seen read 101M rows (857k per call); in the last hour the top statement was UPDATE metric_registry SET last_value = CAST(CASE metric WHEN prd_funnel_missing_transitions with 8M rows in 64 calls. Next slice, mapped and with a doer: agent_issues ' || COALESCE((SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.D1 #1: %'), '?') || ' (store each report in R2 and compare the next against it). Not yet read: a live run of the workflow after the merge.'
WHERE id = 613 AND item = 'NEXT-QNFO.INFRA.D1' AND status = 'planned';
UPDATE roadmap_implementation
SET status = 'partial', verified_at = NULL,
    evidence = 'Deliverable (PR 7413, scripts/cf_estate.py r2-inventory): every bucket with size, objects, public r2.dev or custom-domain access, the workers that bind it, the scripts that name it and its requests in 30 days; findings public-unexpected and idle-unbound. Read live 2026-11-04: 19 buckets, 92.1 GB (the system map lists 12); qnfo has r2.dev public access enabled with no reference in the repository (qnfo-assets is public on purpose, for the calendar feeds); 7 buckets have no binding and 50 or fewer requests in 30 days (deepchat 4.67 GB, qnfo-ddocs 0.69 GB, qnfo-projects, releases, git-repos, palimpsest-research, play-the-ball). Nothing is changed or deleted. Next slice, mapped and with a doer: agent_issues ' || COALESCE((SELECT MAX(id) FROM agent_issues WHERE source = 'cf-estate-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA.R2 #1: %'), '?') || ' (reversible r2-public switch, qnfo first after a reference search). Not yet read: a live run of the workflow after the merge.'
WHERE id = 614 AND item = 'NEXT-QNFO.INFRA.R2' AND status = 'planned';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'coding-agent (CF-ESTATE-1, NEXT-QNFO.INFRA.*)',
  'The five QNFO.INFRA projects need a real next deliverable each, not a retirement: the estate they describe exists (39 scripts, 7 Pages projects, 12 zones, 19 buckets, 6 databases) and none had a machine view of itself beyond names and counts.',
  'Shipped scripts/cf_estate.py (five read-only reports and a doc check) with a dispatch-only workflow, brought docs/DOMAINS.md in line with the account, filed one next-slice issue per project with a code-task and mapped it in issue_project_map, set rows 610 to 614 to partial.',
  'Live reads 2026-11-04 with the Cloudflare API: 39 scripts, 7 Pages projects with domains, 12 zones with routes, DNS records and redirect rules, 19 buckets with usage, public access and 30 days of operations, d1QueriesAdaptiveGroups for qnfo-audit; agent_issues ids up to 1001850 inserted on the same day.',
  'partial: code and mapping in this change, the live workflow run is read after the merge',
  'scripts/cf_estate.py, scripts/cf_estate_test.py, scripts/cf-estate.test.mjs, docs/domains-doc.test.mjs, .github/workflows/cf-estate.yml, docs/DOMAINS.md, five agent_issues rows, five issue_project_map rows, rows 610 to 614',
  'Restore the five roadmap rows from bak_20261105_c4_next_infra, remove the five issues and their map rows (the Rollback line), revert the pull request.',
  'estate-reports-per-infra-project',
  'by the next portfolio-execute tick (:50) the no-mapped-work gap for the five QNFO.INFRA projects is not raised again, and the first cf-estate runs reproduce the 2026-11-04 findings: 1 tombstone, 1 retire-candidate Pages project, 0 undocumented hosts, 1 public-unexpected bucket',
  'No reach claim: this is estate hygiene and the evidence the next five slices need.',
  'Cloudflare API reads (scripts, Pages, zones, routes, DNS, rulesets, DoH, R2 usage and operations, D1 analytics), offline suites for every classifier, the real docs/DOMAINS.md parsed'
WHERE EXISTS (SELECT 1 FROM roadmap_implementation WHERE id = 610 AND status = 'partial')
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'coding-agent (CF-ESTATE-1, NEXT-QNFO.INFRA.*)');
