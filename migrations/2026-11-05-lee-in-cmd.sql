-- RM-LEE-CMD-1 (2026-11-05, charter pillar autonomy; program QNFO.OPS; GitHub 5482, owner correction: Lee belongs in fleet.qnfo.org/cmd, not on its own host).
-- WHAT THIS SHIPS (qnfo-fleet-dashboard 1.95.0, PR 7627): the read half of Lee in the fleet command line. cf <workers|worker|versions|logs|zones|dns|routes|traffic|pages|deployments|stats> answer with no
-- model; "lee: <question>" runs a read-only Workers AI tool loop as a polled job (cmd_log kind lee); owner session only; the worker's own CF_TOKEN and AI binding (no second secret);
-- GET /api/cmd/lee/health says per area whether that token can read the account. WHAT IT LEAVES ON PURPOSE: Lee's write tools (roll back a Worker, create, edit or delete DNS records and
-- routes, create a Pages project) are not ported (a model that can delete a DNS record on a sentence is the wrong shape; they come back as confirm buttons behind a fresh code), and
-- lee.qnfo.org / the script qnfo-fleet-lee stay up until production is verified to serve Lee. Each leftover is a ROADMAP-1 row below with a doer.
-- FLAG: ops_config cmd_lee (on by default; off switches Lee off at once, no deploy): the rollback.
-- PREDICTION (decision_log): after the deploy GET https://fleet.qnfo.org/api/cmd/lee/health answers can.workers, can.zones and can.pages all true (the dashboard token already reads workers
-- scripts, D1 and GraphQL analytics); any false names the exact token permission to add, which is an IDENTITY-BOUND step (a credential only the owner can mint) and gets its own card then, not before.
-- Falsifier: a false on workers (the token reads the scripts list elsewhere in this worker), which would mean the token is scoped narrower than the code assumes.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = 'off', updated_at = datetime('now') WHERE key = 'cmd_lee'; UPDATE agent_issues SET status = 'closed' WHERE title IN ('ROADMAP-1: QNFO.OPS RM-LEE-CMD-1.2: Lee write tools as confirm buttons behind a fresh code in the command line', 'ROADMAP-1: QNFO.OPS RM-LEE-CMD-1.3: retire qnfo-fleet-lee and lee.qnfo.org once production serves Lee') AND status = 'open' AND source = 'session:C-ops-tools-F2';
-- Rollback note: decision_log is append-only; the flag in the first statement is the switch, the worker rollback is the previous dashboard version.

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('cmd_lee', 'on', 'RM-LEE-CMD-1: Lee (Cloudflare account reads) in the fleet command line; off switches cf <verb> and lee: <question> off without a deploy', datetime('now'));

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS RM-LEE-CMD-1.2: Lee write tools as confirm buttons behind a fresh code in the command line',
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function leeRoute(env, ctx, holder, text, parsed, from) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "LEE-WRITE-CONFIRM-1"}' || char(10) || char(10) ||
 'Charter pillar autonomy and security (program QNFO.OPS). Metric it should move: owner turns that need a Cloudflare change (a DNS record, a route, a Worker rollback) finish in the command line with one confirm tap instead of a session or the Cloudflare dashboard.' || char(10) ||
 'Evidence: RM-LEE-CMD-1 (qnfo-fleet-dashboard 1.95.0) ported Lee''s reads only. The original Lee (rwnq8/qnfo-fleet-dashboard src/index.js) also has rollback_worker, create_dns_record, update_dns_record, delete_dns_record, add_worker_route, delete_worker_route and create_pages_project, guarded only by the model''s own "ask the user to confirm". The fleet console already has the safer pattern: CMD_OPS actions that return a button, run by /api/cmd/run, destructive ones behind a code from the last 15 minutes (cmdApprovedAction).' || char(10) ||
 'EDIT: add Lee write ops to CMD_OPS (lee_dns_create, lee_dns_update, lee_dns_delete, lee_route_add, lee_route_delete, lee_rollback, each destructive except create) that leeRoute offers as buttons with the exact request shown (zone, record, version id), executed by cmdExec through the same Cloudflare helper leeCf with method POST, PUT, PATCH or DELETE; never from the model loop (leeRun keeps no write tool); each run writes cmd_log kind action and audit_trail. A rollback of qnfo-fleet-control, qnfo-ops or qnfo-deploy-guard stays refused (deploys go through the canonical path). Mark the change LEE-WRITE-CONFIRM-1. Test: a write op without the fresh code is refused, with it issues exactly one request, and the model loop still has no write tool.' || char(10) ||
 'Definition of done: merged and verified live by the canonical deploy; a confirm-tap DNS create and delete on a scratch record of a test zone record in cmd_log kind action with the response; record before and after in issue_triage.close_evidence. The dashboard file is claimed by other sessions at the time of filing: take the work claim first.',
 'session:C-ops-tools-F2', 'feature', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ROADMAP-1: QNFO.OPS RM-LEE-CMD-1.2: Lee write tools as confirm buttons behind a fresh code in the command line');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS RM-LEE-CMD-1.3: retire qnfo-fleet-lee and lee.qnfo.org once production serves Lee',
 'Charter pillar cost and security (program QNFO.OPS). Owner correction on GitHub 5482: lee.qnfo.org was a staging host and is retired after cutover. Doer: the fleet through cf-ops-actions (delete-worker, marker-guarded) and a custom-domain removal, under the standing grant to retire an idle worker (OWNER-STANDING-GRANT-1); the owner''s source repository rwnq8/qnfo-fleet-dashboard is untouched and stays the backup.' || char(10) ||
 'Preconditions, all read before the step: (1) GET https://fleet.qnfo.org/api/cmd/lee/health answers cf_token_set true, ai_binding true and can.workers, can.zones, can.pages all true (the live journey fleet-lee / lee-health-live runs the same check after every deploy); (2) at least 5 cmd_log rows of kind lee with status answered since the deploy (the command line was used for Lee); (3) the dependency check: impact on worker:qnfo-fleet-lee shows no binder and no URL caller other than the owner''s bookmark (GET https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/impact?id=worker:qnfo-fleet-lee).' || char(10) ||
 'If (1) shows a false, the missing Cloudflare token permission is named there; adding it to the dashboard token is a credential only the owner can mint: file the human_actions card with an IDENTITY-BOUND: line naming that permission, and keep lee.qnfo.org up meanwhile.' || char(10) ||
 'EDIT (executable, no file change): run cf-ops-actions delete-worker for qnfo-fleet-lee (the marker the action requires is the script name), remove the custom domain lee.qnfo.org, then record both runs and the Workers list without the script in issue_triage.close_evidence.' || char(10) ||
 'Definition of done: https://lee.qnfo.org/ no longer answers the Lee page, the account''s workers list has no qnfo-fleet-lee, and fleet.qnfo.org/cmd answers cf workers; GitHub 5482 is closed with that evidence.',
 'session:C-ops-tools-F2', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'ROADMAP-1: QNFO.OPS RM-LEE-CMD-1.3: retire qnfo-fleet-lee and lee.qnfo.org once production serves Lee');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:C-ops-tools-F2',
  'the owner wants Lee inside the existing command line (GitHub 5482), and the read tools carry the value while the write tools carry the risk',
  'RM-LEE-CMD-1: port Lee''s read tools and tool loop into qnfo-fleet-dashboard /cmd behind ops_config cmd_lee, without its write tools, with a health route that says per area whether the token reaches the account',
  'lee.qnfo.org live (qnfo-fleet-lee, Access-protected /api/*), source read from rwnq8/qnfo-fleet-dashboard src/index.js; the dashboard already holds CF_TOKEN (workers scripts, D1 list, GraphQL analytics reads) and an [ai] binding; the original loop executes rollback_worker and DNS and route deletes on the model''s own confirmation',
  'branch change; verify after CI migration and canonical deployment',
  'the /cmd page and /api/cmd route of qnfo-fleet-dashboard (cf and lee: lines only; every other line takes its old path), cmd_log kind lee, Workers AI neurons of the loop',
  'ops_config cmd_lee = off (immediate); the previous dashboard version; lee.qnfo.org stays up until RM-LEE-CMD-1.3',
  'Cloudflare account reads (workers, versions, zones, DNS, routes, Pages, traffic, worker stats and logs) in the owner''s command line, with no new secret',
  'GET /api/cmd/lee/health answers can.workers, can.zones and can.pages true after the deploy; five owner Lee reads answered in cmd_log within a week',
  'none; owner efficiency, not readers',
  'offline suite qnfo-fleet-dashboard/cmd-lee.test.mjs (parser, argument validation, no write request, 403 as a permission, route, flag, health); phone journeys fleet-lee / cmd-cf-zones, cmd-lee-ask, cmd-lee-chip (local harness) and lee-health-live (live); live reads of lee.qnfo.org and the source repository'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-LEE-CMD-1: port Lee%');
