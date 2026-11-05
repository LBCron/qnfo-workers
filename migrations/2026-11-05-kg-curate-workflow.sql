-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: INSERT OR REPLACE INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence, issue_id) SELECT component, critical_path, alternate_path, alternate_tested_at, evidence, issue_id FROM bak_20261105_kg_spof; UPDATE agent_issues SET status = 'closed' WHERE status = 'open' AND title LIKE 'ROADMAP-1: QNFO.OPS kg-watchmaker-1:%';
-- BACKUP: bak_20261105_kg_spof
-- spof-review: the curator's critical path moves from the last step of fleet-graph.yml to its own workflow, .github/workflows/kg-curate.yml (push to main, repository_dispatch fleet-graph-tick or kg-curate-tick, workflow_dispatch), and shares the repository CLOUDFLARE_API_TOKEN with fleet-graph.yml. The alternate path is the existing qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 dispatch (fleet-graph-tick also starts kg-curate.yml) and `node scripts/kg_curate.mjs --force` from any machine with the token; GET /kg/health shows the age of the last curation and a stale flag after 180 minutes.
--
-- KG-CURATE-2 (2026-11-05, charter pillar autonomy). KG-CURATE-1 ran the curator as the last step of fleet-graph.yml. That workflow cancels its own
-- run on every newer push to main, and main takes a push every minute or two: of its last 40 runs on 2026-11-05, 34 were cancelled (median 31 s)
-- and 5 finished (median 101 s), so a curation of several minutes would almost never have completed. The curator now has its own workflow with a
-- concurrency group that never cancels a running curation, and a run under 25 minutes after the last good one is skipped after three small reads
-- (the early throttle in scripts/kg_curate.mjs). This file records the new single-point-of-failure review and the decision, and files the one
-- follow-up: the watchmaker index (WATCHMAKER-INDEX-1) must list the new recurring operation.

CREATE TABLE IF NOT EXISTS bak_20261105_kg_spof AS SELECT * FROM spof_registry WHERE component = 'kg curator';

INSERT OR REPLACE INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence, issue_id)
VALUES ('kg curator', '.github/workflows/kg-curate.yml (push to main, repository_dispatch, workflow_dispatch; repository CLOUDFLARE_API_TOKEN; concurrency group kg-curate, never cancelled)',
 'qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 sends repository_dispatch fleet-graph-tick when fleet-graph.yml has not run on main for 60 minutes, and kg-curate.yml listens for it; node scripts/kg_curate.mjs --force runs the same code from any machine with the token; readers see the age in GET /kg/health (stale after 180 minutes); R2 qnfo-backups/kg/latest.json.gz holds a node-link snapshot and kg_tombstone every deleted row',
 NULL, 'KG-CURATE-2 (migrations/2026-11-05-kg-curate-workflow.sql); the same token as the fleet graph, so a lost token stops both; a lease in qnfo-graph.kg_state (6 minutes, renewed per phase) keeps two runs apart; a run past its 8-minute budget defers the remaining phases to the next one', NULL);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
VALUES ('session (claude, KG-CURATE-2)',
 'A job that a newer push cancels cannot be the only home of work that takes several minutes; the early evidence is the run history of fleet-graph.yml on 2026-11-05, 34 of 40 runs cancelled.',
 'Moved the curator to .github/workflows/kg-curate.yml with concurrency cancel-in-progress false, no pull_request trigger (no new PR check), a sparse checkout of scripts/, a 14-minute job timeout over the curator 8-minute budget; fleet_graph.mjs runs it only with --scope kg; the run reads the throttle and the lease before it loads the graph, and skips the schema DDL when the stored schema version is current.',
 'run history of fleet-graph.yml read with gh run list on 2026-11-05 (5 success median 101 s, 34 cancelled median 31 s); the offline suite proves a throttled run reads at most five rows and writes none; a rehearsal through the real D1 REST path on a scratch database (deleted) ran the curator twice with no phase error.',
 'shipped', '.github/workflows/kg-curate.yml (new, push to main only); scripts/fleet_graph.mjs (the curator no longer runs in the default scope); scripts/kg_curate.mjs (early throttle, schema version); qnfo-audit one spof_registry row',
 'revert the pull request (the curator then stops; fleet-graph.yml is unchanged); this file Rollback line restores the spof row from bak_20261105_kg_spof',
 'the curator completes: a cold run of about 400 REST calls is no longer cut off by the next push',
 'within 60 minutes of the merge a kg-curate run completes (conclusion success) and kg_health has a row; GET /kg/health answers 200',
 'run history of the fleet-graph workflow; kg_curate.test.mjs; the scratch-database rehearsal');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS kg-watchmaker-1: the watchmaker index lists the knowledge-graph curator as a recurring operation',
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) || 'code-anchor: var WATCHMAKER_OPS = [' || char(10) || 'code-probe: {"paths": ["qnfo-fleet-dashboard/worker.js"], "contains": "key: \"kg-curate\""}' || char(10) ||
 'Charter pillar: autonomy. WATCHMAKER-INDEX-1: a PR that adds a recurring operation adds it to WATCHMAKER_OPS with the D1 query that proves it ran. The curator (KG-CURATE-1/2) runs from .github/workflows/kg-curate.yml and writes fleet_heartbeat(worker = ''kg-curate'') at the end of every run that got as far as publishing. Add the entry { key: "kg-curate", what: "Content knowledge graph curation (KG-CURATE-1: edges from living-paper, the fleet graph and qnfo-audit, embeddings, prune, entity resolution), scripts/kg_curate.mjs", runner: "gha:kg-curate.yml", cadence_h: 1, sql: "SELECT MAX(ts) AS last FROM fleet_heartbeat WHERE worker = ''kg-curate'' AND ok = 1" } beside the fleet-graph and breach-doctor entries, and give it a first_due after the first real run. Done when: GET /api/watchmaker lists kg-curate with a last time inside its cadence, and watchmaker_index does not rise.',
 'session:kg-curate', 'autonomy', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ROADMAP-1: QNFO.OPS kg-watchmaker-1:%');
