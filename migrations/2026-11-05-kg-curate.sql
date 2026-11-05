-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM metric_breach_cause WHERE metric_key IN ('kg_orphan_share', 'kg_giant_component_share', 'kg_paper_unrelated_share', 'kg_edge_density', 'kg_duplicate_groups_unresolved', 'kg_sim_category_agreement'); DELETE FROM analytics_metric_triggers WHERE metric_key IN ('kg_orphan_share', 'kg_giant_component_share', 'kg_paper_unrelated_share', 'kg_edge_density', 'kg_duplicate_groups_unresolved', 'kg_sim_category_agreement'); DELETE FROM metric_registry WHERE metric IN ('kg_orphan_share', 'kg_giant_component_share', 'kg_paper_unrelated_share', 'kg_edge_density', 'kg_duplicate_groups_unresolved', 'kg_sim_category_agreement'); DELETE FROM capability_ledger WHERE capability = 'knowledge-graph-curation'; DELETE FROM spof_registry WHERE component = 'kg curator'; UPDATE agent_issues SET status = 'closed' WHERE status = 'open' AND (title LIKE 'KG-%' OR title LIKE 'ROADMAP-1: QNFO.% kg-%');
-- spof-review: the curator runs inside the fleet-graph build, so it has that build's two paths (fleet-graph.yml on push to main; qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 repository_dispatch when main is quiet 60 minutes). It adds no path of its own: a defect in scripts/kg_curate.mjs stops only the kg phase (the fleet graph build isolates it and still writes its heartbeat), and /kg/health reports the age of the last curation and a stale flag after 180 minutes.
-- CAUSE-MAPPED: the six metrics below map to the existing cause key `structure` in metric_breach_cause in this same file.
--
-- KG-CURATE-1 (2026-11-05, charter pillar autonomy; also research and reach). Owner directive 2026-11-05: the QNFO knowledge graph needs much
-- denser, more connected edges and nodes from all possible sources and must be curated, pruned, updated and maintained automatically by the
-- fleet; research best practice, audit shortcomings and failure modes, code and deploy the enhancements, make the Quniverse more connected and
-- self-aware. Measured 2026-11-05 before this change: qnfo-graph nodes 8,705, edges 9,423 (1.08 per node), 60% of edges structural CONTAINS,
-- 1,626 nodes (19%) with no edge, 1,192 of 1,855 Paper nodes isolated, 159 duplicate-name groups, 457 placeholder archive-record Paper nodes, no
-- provenance on any edge, and no writer that ever revised or removed an edge. What shipped in the same pull request:
--   scripts/kg_curate.mjs        the curator (lifecycle, living-paper edges, fleet topology anchors, audit entities, mentions, concept links,
--                                bibliographic coupling, embeddings and similarity, prune, entity resolution, analytics, publish), called by
--                                scripts/fleet_graph.mjs (1.2.0) inside fleet-graph.yml, or alone with `--scope kg`;
--   qnfo-memory-mcp 2.9.0        open read-only GET /kg/* (health, find, node, neighbors, path, central, gaps, orphans, communities), the kg_*
--                                MCP tools and the canvas viewer /kg/view;
--   docs/KNOWLEDGE-GRAPH.md      the model, the sources, the guards, the measured failure modes and the research behind them.
-- This file registers the six measures the curator writes every run (runner-written, like fleet_graph_findings_warn), each with its trigger
-- and breach cause, records the capability and its single-point-of-failure review, logs the decision, and files the follow-ups the audit found
-- as issues with a doer (OWNER-NO-LOOSE-ENDS-1). The curator writes fleet_heartbeat('kg-curate') every run.

INSERT OR IGNORE INTO metric_registry (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, state, refresh_class) VALUES
 ('kg_orphan_share', 'fleet', 'target',
  'percent of active nodes in qnfo-graph (status NULL) with no active edge (status NULL or active) in either direction; the Note vault, deprecated, archived, quarantined and ghost nodes are not active',
  'qnfo-graph.kg_health (scripts/kg_curate.mjs); GET https://qnfo-memory-mcp.q08.workers.dev/kg/health',
  '19.2 on 2026-11-05 (1,626 of 8,705 nodes) before KG-CURATE-1', '3', 'qnfo-memory-mcp', 'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control) files the breach', 'hourly', '> 8', '> 15', 'NEW', 'runner'),
 ('kg_giant_component_share', 'fleet', 'target',
  'percent of active non-Note nodes in the largest connected component over all active edges (the Note vault is a metadata-only island, 5,616 notes whose bodies live on a local drive, and is reported separately as notes_bridged)',
  'qnfo-graph.kg_health (scripts/kg_curate.mjs); GET https://qnfo-memory-mcp.q08.workers.dev/kg/health',
  'measured by the first run (83.7 in the 2026-11-05 shadow run on a copy of the live data)', '95', 'qnfo-memory-mcp', 'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control) files the breach', 'hourly', '< 80', '< 60', 'NEW', 'runner'),
 ('kg_paper_unrelated_share', 'fleet', 'target',
  'percent of active Paper nodes with no content relation (CITES, SIMILAR_TO, COUPLED_WITH, NEAR_DUPLICATE, SUPERSEDES, REFINES, BUILDS_ON, LINKS_TO, RELATES_TO, REFERENCES) to another paper or a cited work; tags and categories do not count',
  'qnfo-graph.kg_health (scripts/kg_curate.mjs); GET https://qnfo-memory-mcp.q08.workers.dev/kg/gaps?kind=isolated-paper',
  '64 on 2026-11-05 (1,192 of 1,855 Paper nodes had no edge at all)', '25', 'qnfo-memory-mcp', 'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control) files the breach', 'hourly', '> 50', '> 70', 'NEW', 'runner'),
 ('kg_edge_density', 'fleet', 'target',
  'active edges per active node in qnfo-graph (all relationships); 1.08 before KG-CURATE-1, of which 60% were structural CONTAINS',
  'qnfo-graph.kg_health (scripts/kg_curate.mjs); GET https://qnfo-memory-mcp.q08.workers.dev/kg/health',
  '1.08 on 2026-11-05', '2.5', 'qnfo-memory-mcp', 'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control) files the breach', 'hourly', '< 1.4', '< 1.1', 'NEW', 'runner'),
 ('kg_duplicate_groups_unresolved', 'fleet', 'target',
  'duplicate-name groups (same label family, same normalised name, not generic) in which a member has no canonical_id / SAME_AS link to the group canonical; resolution is a link, never a destructive merge',
  'qnfo-graph.kg_health (scripts/kg_curate.mjs); nodes.canonical_id',
  '159 groups on 2026-11-05, none linked', '0', 'qnfo-memory-mcp', 'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control) files the breach', 'hourly', '> 0', '> 20', 'NEW', 'runner'),
 ('kg_sim_category_agreement', 'fleet', 'guard',
  'percent of SIMILAR_TO edges (non-rescue) whose two papers share a primary category: a free precision proxy for the embedding edges, used to tune the cutoff by +-0.01 per run within +-0.05; a proxy is not a target (OUTPUT-QUALITY-LEDGER-1)',
  'qnfo-graph.kg_health (scripts/kg_curate.mjs); kg_state simAdjust',
  '69.7 in the 2026-11-05 shadow run', '60', 'qnfo-memory-mcp', 'analytics_metric_triggers -> evaluateMetricTriggers (qnfo-fleet-control) files the breach', 'hourly', '< 55', '< 40', 'NEW', 'runner');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('kg_orphan_share', 'structure', 'KG-CURATE-1: nodes the curator could not link'),
 ('kg_giant_component_share', 'structure', 'KG-CURATE-1: islands in the content graph'),
 ('kg_paper_unrelated_share', 'structure', 'KG-CURATE-1: papers with no content relation'),
 ('kg_edge_density', 'structure', 'KG-CURATE-1: too few edges per node'),
 ('kg_duplicate_groups_unresolved', 'structure', 'KG-CURATE-1: duplicate names not linked'),
 ('kg_sim_category_agreement', 'structure', 'KG-CURATE-1: similarity edges that cross categories');

INSERT OR IGNORE INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, priority, action, owner, queue_target, cooldown_hours, enabled, notes) VALUES
 ('kg_orphan_share', 'KG-ORPHANS-1: more than 8 percent of active knowledge-graph nodes have no edge', 'metric_registry', 'gt', 8, 5,
  'Pillar autonomy (KG-CURATE-1). Read GET https://qnfo-memory-mcp.q08.workers.dev/kg/health (orphans_by_label) and /kg/orphans?label=<label>, then give the largest label a deterministic link: a mention alias in phaseMentions, a source table in phaseLiving, an anchor in phaseFleet or phaseAudit. Do not add similarity edges to hide orphans, and do not delete nodes to lower the share (every delete is tombstoned and capped).' || char(10) || 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseMentions(ctx) {',
  'qnfo-fleet-control', 'agent_issues', 12, 1, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql)'),
 ('kg_giant_component_share', 'KG-ISLANDS-1: the knowledge graph has split into islands (largest component under 80 percent of non-Note nodes)', 'metric_registry', 'lt', 80, 5,
  'Pillar autonomy (KG-CURATE-1). Read /kg/health (components, giant_component_share, orphans_by_label) and /kg/communities. A drop usually means a source stopped (fleet topology, audit entities, living-paper tables) or a sweep removed a bridge: read kg_state shrink:* keys and the report of the last fleet-graph run (report.kg.phases). Fix the source phase; never merge islands with unlabelled edges.' || char(10) || 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseFleet(ctx) {',
  'qnfo-fleet-control', 'agent_issues', 12, 1, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql)'),
 ('kg_paper_unrelated_share', 'KG-PAPERS-UNRELATED-1: more than half of the active papers have no content relation in the knowledge graph', 'metric_registry', 'gt', 50, 4,
  'Pillar research (KG-CURATE-1). Read /kg/gaps?kind=isolated-paper. Check kg_embed coverage (phaseSemantic report: embedded, noText, pending), the cutoff and rescue count, and the citation tables (paper_citations). Lower the cutoff only while sim_category_agreement stays above 60.' || char(10) || 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseSemantic(ctx) {',
  'qnfo-fleet-control', 'agent_issues', 12, 1, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql)'),
 ('kg_edge_density', 'KG-DENSITY-1: the knowledge graph has fewer than 1.4 edges per node', 'metric_registry', 'lt', 1.4, 4,
  'Pillar autonomy (KG-CURATE-1). Read /kg/health (by_source, by_relationship): a source that returned few rows or was held by its shrink guard explains a drop. Add a source (a living-paper or audit table not yet read) before loosening any threshold.' || char(10) || 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseLiving(ctx) {',
  'qnfo-fleet-control', 'agent_issues', 12, 1, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql)'),
 ('kg_duplicate_groups_unresolved', 'KG-DUPLICATES-1: duplicate-name knowledge-graph nodes are not linked to a canonical node', 'metric_registry', 'gt', 0, 5,
  'Pillar autonomy (KG-CURATE-1). phaseEntities writes SAME_AS and canonical_id for every group of up to 10; a group above 10 is skipped on purpose (a shared placeholder name). Read the groups with SELECT label, name, COUNT(*) FROM nodes GROUP BY label, lower(name) HAVING COUNT(*) > 1 and fix the group the phase skipped, by a rule, never a manual merge.' || char(10) || 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseEntities(ctx) {',
  'qnfo-fleet-control', 'agent_issues', 12, 1, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql)'),
 ('kg_sim_category_agreement', 'KG-SIM-PRECISION-1: similarity edges cross categories more than 45 percent of the time', 'metric_registry', 'lt', 55, 4,
  'Pillar research (KG-CURATE-1), guard. The cutoff self-tunes by +0.01 per run up to +0.05; below 55 percent after that the embedding text or the model is the cause. Read the phaseSemantic report (null mean and sd, cutoff, rescued, degenerateGroups) and sample 20 edges from /kg/node?id=<paper> before changing the model.' || char(10) || 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export function embeddingText(title, abstract, body) {',
  'qnfo-fleet-control', 'agent_issues', 12, 1, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql)');

INSERT OR REPLACE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
VALUES ('knowledge-graph-curation',
 'KG-CURATE-1 (2026-11-05): scripts/kg_curate.mjs inside fleet-graph.yml, qnfo-memory-mcp 2.9.0 /kg/*, fleet_graph.mjs 1.2.0; no new worker, cron, binding or paid service beyond Workers AI embeddings of changed papers',
 'repository CLOUDFLARE_API_TOKEN (D1 read/write on qnfo-graph and qnfo-audit, D1 read on living-paper, Workers AI run, R2 write qnfo-backups)',
 'new: graded by metrics kg_orphan_share, kg_giant_component_share, kg_paper_unrelated_share, kg_edge_density, kg_duplicate_groups_unresolved, kg_sim_category_agreement and fleet_heartbeat(kg-curate)',
 strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
 'The content knowledge graph is curated on every build: deterministic edges from living-paper (tags, categories, citations), fleet topology anchors (workers, databases, buckets, domains), audit entities (metrics, programs, goals, failure modes, open issues, decisions, capabilities) linked to the workers they name, concept and program mentions in papers, bibliographic coupling, embedding similarity with a mutual-kNN cutoff calibrated against a null and tuned by category agreement, SAME_AS for duplicate names, and a tombstoned, capped prune. Every derived edge carries source, confidence, weight, evidence and last_seen; every source is reconciled as a set (add, update, mark stale, delete after 14 days). A shadow run on a copy of the live data on 2026-11-05 took edges from 9,423 to 17,281 and the orphan share from 19.2 to 6.6 percent.');

INSERT OR REPLACE INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence, issue_id)
VALUES ('kg curator', 'scripts/kg_curate.mjs inside fleet-graph.yml (push to main; repository CLOUDFLARE_API_TOKEN)',
 'the fleet-graph build own second path: qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 sends repository_dispatch fleet-graph-tick when the workflow has not run on main for 60 minutes; node scripts/kg_curate.mjs --force runs it alone from any machine with the token; readers see the age in GET /kg/health (stale after 180 minutes); R2 qnfo-backups/kg/latest.json.gz holds a node-link snapshot and kg_tombstone holds every deleted row',
 NULL, 'KG-CURATE-1 (migrations/2026-11-05-kg-curate.sql); the same runner and token as the fleet graph, so a lost token stops both; the curator isolates its phases and the fleet-graph build isolates the curator', NULL);

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
VALUES ('session (claude, KG-CURATE-1)',
 'A graph is only as useful as its connectivity and trust: edges need provenance, a way to expire, and a guard against hubs and feedback; the existing content graph had none of the three and nothing curated it. Embedding edges from the shared Vectorize index would be wrong: on 2026-11-05 a nearest-neighbour query on qwav-research-v2 returned twenty different papers at one identical score, because chunk 0 is each paper YAML front matter.',
 'Built the curator as a phase of the existing fleet-graph build (two triggers already, no new cron or worker), embedding cleaned title and abstract itself with bge-base-en-v1.5 and comparing in memory; every derived source is reconciled as a set with a shrink guard (80 percent), a stale cap (10 percent per run) and a 14-day grace; deletes are tombstoned and capped at 800 per run; legacy edges are never modified; the audit entities become nodes only when they link to something.',
 'Shadow run on a copy of the live data 2026-11-05 (16 s, 523 of 855 papers embedded in the first pass): nodes 8,705 to 10,953, edges 9,423 to 17,281, orphan share 19.2 to 6.6 percent, non-Note giant component 83.7 percent, SAME_AS for 125 duplicate groups, 287 placeholder and deprecated nodes tombstoned, similarity edges 450 with a category agreement of 69.7 percent.',
 'shipped', 'qnfo-graph D1 (nodes and edges gain nullable columns status, source, confidence, weight, evidence, last_seen, invalidated_at, canonical_id, h; new kg_* tables; legacy writers unchanged); qnfo-memory-mcp new routes and tools (existing unchanged); qnfo-audit six metrics, triggers and one heartbeat; Workers AI embeddings of changed papers',
 'revert the pull request; the curator then stops. To undo its data: DELETE FROM edges WHERE source LIKE ''kg:%''; DELETE FROM nodes WHERE source LIKE ''kg:%''; restore tombstoned rows with INSERT INTO nodes SELECT json_extract(row, ''$.id''), ... FROM kg_tombstone WHERE kind = ''node'' (the row column holds the whole row as JSON); this file Rollback line for qnfo-audit',
 'connectivity, provenance and self-maintenance for the content graph; one graph that joins papers, concepts, workers, databases, metrics, issues, failure modes and decisions',
 'within 60 minutes of the merge kg_health has a row and the six kg_ metrics are MEASURED; kg_orphan_share under 8 and kg_edge_density above 1.4 on the first real run',
 'shadow run on a local copy of production data (all phases, real embeddings); the offline suites scripts/kg_curate.test.mjs and qnfo-memory-mcp/kg.test.mjs; the existing fleet-graph suites');

-- Follow-ups the audit found, each with a doer (a code-task line for the code loop) or, where only the owner can act, an IDENTITY-BOUND line.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'KG-VECTORIZE-STUB-1: qwav-research-v2 holds identical vectors for different papers because chunk 0 is YAML front matter',
 'code-task: repo=qnfo-workers path=qnfo-paper-indexer/worker.js' || char(10) || 'code-anchor: function chunkText(text) {' || char(10) || 'code-probe: {"paths": ["qnfo-paper-indexer/worker.js"], "contains": "stripFrontMatter"}' || char(10) ||
 'Charter pillar: research (also reach: ask and search retrieval read this index). Measured 2026-11-05 by KG-CURATE-1: a nearest-neighbour query seeded with paper:infomatics:0 on Vectorize qwav-research-v2 (59,110 vectors, 768 dimensions) returned 20 matches at the identical score 0.89843285 for 20 different papers; the metadata of the matches shows why: chunk 0 is the paper YAML front matter (license, email, ORCID, robots lines) or the stub text "QNFO Research Paper / Full text and metadata at https://q...", not the paper. Two id shapes coexist (32-hex md5 ids with {chunk, slug, total} metadata, and slug ids with {abstract, authors, body_text} metadata); paper_ids.vectorize_id (paper:<slug>:0) matches neither. Effect: semantic search and the ask pipeline retrieve front matter for many papers, and any similarity built on this index is a hairball. KG-CURATE-1 therefore embeds cleaned title and abstract itself (scripts/kg_curate.mjs embeddingText) instead of reading this index.' || char(10) ||
 'Fix: qnfo-paper-indexer handleIndex and handleWebhook call chunkText(row.body_md) on the raw body. Add a stripFrontMatter(text) helper (drop a leading ---...--- block, as scripts/kg_curate.mjs stripFrontMatter does), call it before chunkText, drop chunks that are only license or boilerplate lines, hash the cleaned text so index_state re-indexes, and purge the slug-shaped legacy vectors with handlePurge. Done when: a nearest-neighbour query on a random paper returns scores that differ (no 4 equal scores in the top 20) on 20 random papers, and index_state.body_hash covers the cleaned text.',
 'session:kg-curate', 'quality', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'KG-VECTORIZE-STUB-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH kg-related-papers-1: every paper page on papers.qnfo.org shows its related papers from the knowledge graph',
 'code-task: repo=qnfo-workers path=qnfo-gateway/worker.js' || char(10) || 'code-anchor: function lpPaperHTML(paper) {' || char(10) || 'code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "kg/neighbors"}' || char(10) ||
 'Charter pillar: reach. Program QNFO.REACH. Metric to move: engaged_reader_sessions_7d (READER-YIELD-1: readers are engaged sessions, not clicks). A reader who finishes a paper has nowhere to go; the curated graph now knows, for each paper, its content neighbours (SIMILAR_TO, COUPLED_WITH, CITES both ways) with weights. Add a short "Related papers" block to lpPaperHTML: up to 5 neighbours from GET https://qnfo-memory-mcp.q08.workers.dev/kg/neighbors?id=paper:<slug>&depth=1 (non-structural, hubs hidden by default), ordered by weight, each a link to its papers.qnfo.org page, fetched through a service binding or fetch with a 60 second cache and no block at all when the call fails or returns fewer than 2 papers. Done when: three paper pages show the block live, the page still renders with the graph unreachable, and engaged_reader_sessions_7d is read again 14 days later with the result recorded on this issue.',
 'session:kg-curate', 'reach', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ROADMAP-1: QNFO.REACH kg-related-papers-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.RSCH kg-research-gaps-1: the research queue takes topics from the knowledge graph gaps',
 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseAnalytics(ctx) {' || char(10) || 'code-probe: {"paths": ["scripts/kg_curate.mjs"], "contains": "research_queue"}' || char(10) ||
 'Charter pillar: research. Program QNFO.RSCH. Metrics to move: kg_paper_unrelated_share and publications_30d. phaseAnalytics writes kg_gap rows (isolated-paper, bridge-paper, link-candidate) every run. Close the loop (CORE-PROMPT-1 rule 6, learn-apply-verify; core rule 12, research is queued, never run inline): once a day, take the 3 highest-score open gaps of kind link-candidate (two papers with shared neighbours and no link) and the communities with the fewest members, and queue each as a research idea in qnfo-audit research_queue with source kg-gap and the two paper slugs, deduplicated against open rows; record the idea in the gap detail. Done when: research_queue rows with source kg-gap exist, the intent orchestrator takes one, and 14 days later the share of those papers that gained a content relation is recorded on this issue.',
 'session:kg-curate', 'research', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ROADMAP-1: QNFO.RSCH kg-research-gaps-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.RSCH kg-precision-audit-1: a different-family model audits a sample of inferred knowledge-graph edges every week',
 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phasePublish(ctx, ok, detail) {' || char(10) || 'code-probe: {"paths": ["scripts/kg_curate.mjs"], "contains": "kg_inferred_edge_precision"}' || char(10) ||
 'Charter pillar: research (OUTPUT-QUALITY-LEDGER-1, ENSEMBLE-POLICY-1). The only precision signal for the inferred edges today is sim_category_agreement, a label proxy. Accuracy is the one knowledge-graph quality dimension that SQL cannot measure. Once a week, sample 50 inferred edges at random (kg:semantic, kg:mention, kg:concept, kg:bib-coupling, 10 each, plus 10 kg:audit-*), ask a model from a different family than the one that wrote the embedding text (glm-5.3-flash or llama-3.3-70b, the cheapest leg while a cap is breached) whether the two endpoints are really related given both names and the evidence column, store the verdicts in a kg_audit table, and write metric kg_inferred_edge_precision per source with a trigger. A source below 80 percent is switched off by a kg_state flag the phase reads (the sweep then marks its edges stale). Done when: one weekly run exists with 50 verdicts, the per-source precision is on /kg/health, and the metric has its trigger.',
 'session:kg-curate', 'quality', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ROADMAP-1: QNFO.RSCH kg-precision-audit-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.RSCH kg-archive-records-1: 271 Zenodo archive-record Paper nodes with real titles are linked to the papers they record',
 'code-task: repo=qnfo-workers path=scripts/kg_curate.mjs' || char(10) || 'code-anchor: export async function phaseEntities(ctx) {' || char(10) || 'code-probe: {"paths": ["scripts/kg_curate.mjs"], "contains": "unlinked-archive-record"}' || char(10) ||
 'Charter pillar: research. Metric to move: kg_orphan_share (orphans_by_label.Paper). After the placeholder archive-record nodes are pruned, about 270 archive-record Paper nodes remain that carry a real title and a harvest source (properties.source archive-pg37-2026-07-05) but no edge: patent applications and Zenodo records. Link each to the living paper or other record whose normalised title is the closest (token Jaccard at least 0.8, or equal after removing a version suffix), as SAME_AS with confidence set to the Jaccard and the evidence column holding both titles; a record with no match stays an orphan and is listed as a kg_gap of kind unlinked-archive-record. Done when: kg_orphan_share excludes the matched records and the unmatched ones are listed in /kg/gaps.',
 'session:kg-curate', 'quality', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'ROADMAP-1: QNFO.RSCH kg-archive-records-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'KG-NOTES-VAULT-1: the 5,616 Note nodes are one metadata-only island because the vault bodies live on the owner machine',
 'IDENTITY-BOUND: the notes are the owner personal Obsidian vault (properties.vault D:/Obsidian/notes/v1); the graph holds only path, year, body length and link count for each, and the bodies exist nowhere the fleet can read. Reading them is an act on the owner machine and personal data, which no loop does on its own (personal and research planes stay separate). Measured 2026-11-05: 5,616 Note nodes, 5,616 CONTAINS edges from one Vault node, 1,773 Note-to-Note LINKS_TO edges, no edge to any paper, concept, program or worker (notes_bridged 0); the connectivity metric excludes the vault for this reason.' || char(10) ||
 'Closing step, the owner only: export the markdown of the notes to be connected (all, or a folder) to R2 bucket qnfo-backups under vault/, as plain .md files with their relative path. The fleet then does the rest: a vault phase in scripts/kg_curate.mjs reads vault/*.md, takes wikilinks and the same alias index phaseMentions uses (workers, programs, phases, domains) and phasePaperConcepts uses (concepts, people), and writes MENTIONS / LINKS_TO edges with the note path as evidence; notes_bridged on /kg/health is the closing measure (above 0 closes this).' || char(10) ||
 'Until then: the vault stays a labelled island, kg_giant_component_share excludes it, and nothing is blocked.',
 'session:kg-curate', 'research', 'low', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'KG-NOTES-VAULT-1:%');
