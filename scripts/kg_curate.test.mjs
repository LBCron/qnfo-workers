// KG-CURATE-1 offline suite: the curator runs end to end against three in-memory SQLite databases shaped like qnfo-graph,
// living-paper and qnfo-audit (foreign keys ON, as in D1), with a deterministic fake embedder. Run: node scripts/kg_curate.test.mjs
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import * as K from "./kg_curate.mjs";
import { SCHEMA_SQL } from "./fleet_graph.mjs";

const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return { db, all: async (sql) => db.prepare(sql).all().map((r) => ({ ...r })), run: async (sql) => { db.exec(sql); }, one: (sql) => ({ ...db.prepare(sql).get() }) };
};

// ---- pure helpers ---------------------------------------------------------------------------------------------------------
assert.equal(K.lit(null), "NULL");
assert.equal(K.lit("it's"), "'it''s'");
assert.equal(K.lit(0.123456), "0.1235");
assert.equal(K.lit(NaN), "NULL");
assert.equal(K.normName("  Dé-Dupé  Name!! "), "dé dupé name");
assert.equal(K.familyOf("CloudflareAsset_DEPRECATED"), "CloudflareAsset");
assert.ok(K.isGenericName("untitled") && K.isGenericName("2026 11 04") && !K.isGenericName("adelic physics program"));
assert.equal(K.edgeId("a", "R", "b"), K.edgeId("a", "R", "b"));
assert.notEqual(K.edgeId("a", "R", "b"), K.edgeId("b", "R", "a"));
{
  const parts = K.insertBatches("INSERT INTO t VALUES ", Array.from({ length: 700 }, (_, i) => "(" + i + ")"));
  assert.ok(parts.length >= 3 && parts.every((p) => p.length < 80100), "batches stay under the statement size and 250 rows");
}
assert.equal(K.stripFrontMatter("---\nlicense: x\nemail: y\n---\nBody text"), "Body text");
assert.equal(K.embeddingText("T", "---\nlicense: x\n---\n# QNFO Research Paper\n\nFull text and metadata at https://qnfo.org", ""), null, "a stub is not embedded");
assert.ok(K.embeddingText("Title", "A genuine abstract about ".repeat(12), "").startsWith("Title. A genuine"));
{
  const v = Array.from({ length: 64 }, (_, i) => Math.sin(i * 1.7) * 0.2);
  const { q, sc } = K.quantize(v), back = K.dequantize(q, sc), n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const cos = K.dot(back, v.map((x) => x / n));
  assert.ok(cos > 0.999, "int8 quantisation keeps cosine within 0.001 (got " + cos + ")");
}

// ---- fixture --------------------------------------------------------------------------------------------------------------
const G = mk(), L = mk(), A = mk();
G.db.exec(`
CREATE TABLE nodes (id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT NOT NULL, properties TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE edges (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL, relationship_type TEXT NOT NULL, properties TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT, FOREIGN KEY (source_id) REFERENCES nodes(id), FOREIGN KEY (target_id) REFERENCES nodes(id));
CREATE UNIQUE INDEX idx_edges_triple ON edges(source_id, target_id, relationship_type);`);
for (const s of SCHEMA_SQL) G.db.exec(s);
L.db.exec(`
CREATE TABLE papers (slug TEXT PRIMARY KEY, identifier TEXT, r2_key TEXT, title TEXT, abstract TEXT, body_md TEXT, status TEXT, doi TEXT, version TEXT, updated_at TEXT);
CREATE TABLE paper_tag (slug TEXT, tag TEXT, rank INTEGER, PRIMARY KEY (slug, tag));
CREATE TABLE paper_category (slug TEXT PRIMARY KEY, category TEXT, secondary TEXT, confidence INTEGER);
CREATE TABLE paper_citations (citing_slug TEXT, cited_slug TEXT, cited_kind TEXT, cited_id TEXT, cited_title TEXT, cited_url TEXT, ref_no INTEGER, PRIMARY KEY (citing_slug, ref_no));`);
A.db.exec(`
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, owner TEXT, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE analytics_metric_triggers (metric_key TEXT, action TEXT, enabled INTEGER);
CREATE TABLE program_charters (program_code TEXT, objective TEXT, primary_metric TEXT, guard_metrics TEXT, paths TEXT);
CREATE TABLE goals (goal_key TEXT, statement TEXT, program_code TEXT, status TEXT);
CREATE TABLE failure_modes (fm_key TEXT, failure_mode TEXT, blast_radius TEXT, remediation TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, priority TEXT, category TEXT, description TEXT, status TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, ts TEXT, action TEXT, blast_radius TEXT);
CREATE TABLE capability_ledger (capability TEXT, provenance TEXT, evidence TEXT);
CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);

const long = (topic) => ("This paper studies " + topic + " structure, " + topic + " dynamics and " + topic + " invariants in considerable depth" + (topic === "alpha" ? " on the Bruhat-Tits tree" : "") + ". ").repeat(4);
const slugs = [];
for (let i = 1; i <= 7; i++) slugs.push({ slug: "alpha-" + i, topic: "alpha", cat: "physics" });
for (let i = 1; i <= 7; i++) slugs.push({ slug: "beta-" + i, topic: "beta", cat: "mathematics" });
for (const p of slugs) {
  L.db.exec("INSERT INTO papers (slug, identifier, title, abstract, body_md, status, doi, version, updated_at) VALUES (" + [p.slug, "id-" + p.slug, p.slug.toUpperCase(), long(p.topic), "", "published", "", "1.0.0", "2026-10-01"].map(K.lit).join(",") + ")");
  L.db.exec("INSERT INTO paper_category VALUES (" + [p.slug, p.cat, "[]", 90].map(K.lit).join(",") + ")");
  L.db.exec("INSERT INTO paper_tag VALUES (" + [p.slug, p.topic + " topic", 0].map(K.lit).join(",") + ")");
}
L.db.exec("INSERT INTO papers (slug, identifier, title, abstract, body_md, status, doi, version, updated_at) VALUES ('quar-1', 'id-quar-1', 'Quarantined', '" + long("alpha") + "', '', 'quarantined', '', '1.0.0', '2026-10-01')");
// alpha-1 and alpha-2 both cite two external works and alpha-3 cites alpha-1; beta-1 cites an external work alone.
for (const [c, r, kind, id, no] of [["alpha-1", null, "arxiv", "2401.00001", 1], ["alpha-1", null, "arxiv", "2401.00002", 2], ["alpha-2", null, "arxiv", "2401.00001", 1], ["alpha-2", null, "arxiv", "2401.00002", 2], ["alpha-3", "alpha-1", "qnfo", "alpha-1", 1], ["beta-1", null, "arxiv", "2402.99999", 1], ["quar-1", null, "arxiv", "2401.00001", 1]])
  L.db.exec("INSERT INTO paper_citations VALUES (" + [c, r, kind, id, "Work " + id, "https://arxiv.org/abs/" + id, no].map(K.lit).join(",") + ")");

L.db.exec("UPDATE papers SET r2_key = 'papers/x.json' WHERE slug = 'alpha-1'");
const N = (id, label, name, props = "{}") => G.db.exec("INSERT INTO nodes (id, label, name, properties) VALUES (" + [id, label, name, props].map(K.lit).join(",") + ")");
const E = (id, s, t, r) => G.db.exec("INSERT INTO edges (id, source_id, target_id, relationship_type) VALUES (" + [id, s, t, r].map(K.lit).join(",") + ")");
for (let i = 1; i <= 3; i++) N("paper:alpha-" + i, "Paper", "ALPHA-" + i); // legacy nodes, no edges
N("paper:quar-1", "Paper", "Quarantined"); N("paper:ghost", "Paper", "Ghost paper with no living row"); N("paper:ghost-old", "Paper", "An older ghost");
G.db.exec("UPDATE nodes SET updated_at = '2025-01-01 00:00:00', created_at = '2025-01-01 00:00:00' WHERE id = 'paper:ghost-old'");
N("archive-record-1", "Paper", "https://papers.qnfo.org/papers", '{"type":"archive"}'); N("archive-record-2", "Paper", "https://papers.qnfo.org/papers", '{"type":"archive"}');
N("note-1", "Note", "A note"); N("note-2", "Note", "Another note"); E("e-n", "note-1", "note-2", "CONTAINS");
N("task-1", "Task", "M-001: wire the graph", '{"detail":"needs qnfo-ops and qnfo-memory-mcp changes"}');
N("proj-a", "Project", "Silent Radix Synthesis"); N("proj-b", "Project", "silent radix synthesis!"); N("proj-c", "Project", "Unrelated Project Alpha");
N("dep-1", "CloudflareAsset_DEPRECATED", "old-asset");
N("arch-1", "Project", "Archived Thing", '{"status":"ARCHIVED"}');
N("loop-1", "Project", "Loop Project"); E("e-loop", "loop-1", "loop-1", "RELATES_TO"); // a self-loop the curator must remove
N("prog-1", "Program", "QNFO.ADL — Adelic Physics Program"); N("concept-bt", "Concept", "Bruhat-Tits Tree"); N("r2object-1", "R2Object", "r2-x", '{"arxiv_id":"zzz","r2_key":"papers/x.json"}'); N("r2object-2", "R2Object", "r2-y", '{"arxiv_id":"id-alpha-2","r2_key":"papers/y.json"}'); N("task-2", "Task", "T-9", '{"program":"QNFO.ADL","note":"phase work"}');
const legacyEdges = G.one("SELECT COUNT(*) AS n FROM edges").n;
// the fleet graph (fg_*) as fleet_graph.mjs wrote it
const FG = (sql) => G.db.exec(sql);
for (const [id, kind, name] of [["worker:qnfo-workers", "worker", "qnfo-workers"], ["worker:qnfo-ops", "worker", "qnfo-ops"], ["worker:qnfo-memory-mcp", "worker", "qnfo-memory-mcp"], ["worker:solo", "worker", "solo"], ["d1:qnfo-audit", "d1", "qnfo-audit"], ["domain:ops.qnfo.org", "custom_domain", "ops.qnfo.org"], ["binding:qnfo-ops.AUDIT", "binding", "AUDIT"], ["fn:qnfo-memory-mcp#f", "function", "f"]])
  FG("INSERT INTO fg_node (id, scope, kind, name, worker, source, h, updated_at) VALUES (" + [id, "code", kind, name, kind === "function" ? "qnfo-memory-mcp" : null, "t", "h", "now"].map(K.lit).join(",") + ")");
for (const [s, rel, d] of [["worker:qnfo-ops", "has_binding", "binding:qnfo-ops.AUDIT"], ["binding:qnfo-ops.AUDIT", "binds", "d1:qnfo-audit"], ["fn:qnfo-memory-mcp#f", "http_calls", "worker:qnfo-ops"], ["worker:qnfo-ops", "serves", "route:ops.qnfo.org/*"]])
  FG("INSERT INTO fg_edge (src, rel, dst, scope, confidence, source, h, updated_at) VALUES (" + [s, rel, d, "code", "EXTRACTED", "t", "h", "now"].map(K.lit).join(",") + ")");
// audit
A.db.exec("INSERT INTO metric_registry (metric, layer, kind, owner) VALUES ('fleet_graph_findings_warn', 'fleet', 'guard', 'qnfo-memory-mcp'), ('kg_orphan_share', 'fleet', 'target', 'qnfo-memory-mcp'), ('kg_edge_density', 'fleet', 'target', 'x'), ('kg_giant_component_share', 'fleet', 'target', 'x'), ('kg_paper_unrelated_share', 'fleet', 'target', 'x'), ('kg_duplicate_groups_unresolved', 'fleet', 'target', 'x'), ('kg_sim_category_agreement', 'fleet', 'guard', 'x')");
A.db.exec("INSERT INTO analytics_metric_triggers VALUES ('fleet_graph_findings_warn', 'fix it\ncode-task: repo=qnfo-workers path=qnfo-memory-mcp/worker.js\ncode-anchor: x', 1)");
A.db.exec("INSERT INTO program_charters VALUES ('QNFO.OPS', 'keep it running', 'fleet_graph_findings_warn', 'kg_orphan_share, kg_edge_density', 'qnfo-ops/ qnfo-memory-mcp/')");
A.db.exec("INSERT INTO goals VALUES ('g1', 'Make the graph dense', 'QNFO.OPS', 'active'), ('g2', 'Old goal', 'QNFO.OPS', 'retired')");
A.db.exec("INSERT INTO failure_modes VALUES ('fm-lonely', 'something with no names', '', ''), ('fm-x', 'qnfo-ops loses its binding', 'qnfo-ops and qnfo-memory-mcp stall', 'redeploy')");
A.db.exec("INSERT INTO agent_issues VALUES (4, 'Nothing linkable here', 'low', 'x', 'no names at all', 'open'), (5, 'Ambient repo name', 'low', 'x', 'code-task: repo=qnfo-workers path=qnfo-ops/worker.js', 'open'), (1, 'Fix the router', 'high', 'reliability', 'code-task: repo=qnfo-workers path=qnfo-ops/worker.js', 'open'), (2, 'Closed thing', 'low', 'x', 'd', 'closed'), (3, 'Prose only', 'medium', 'x', 'This concerns qnfo-memory-mcp routes', 'open')");
A.db.exec("INSERT INTO decision_log VALUES (7, '2026-11-04', 'Changed qnfo-ops cron', 'qnfo-ops')");
A.db.exec("INSERT INTO capability_ledger VALUES ('fleet-graph', 'qnfo-memory-mcp 2.1.0', 'served by qnfo-memory-mcp')");

// topic vectors: alpha near e0, beta near e1, plus a deterministic ripple
const fakeEmbed = async (texts) => texts.map((t) => {
  const v = new Array(32).fill(0); v[t.includes("alpha") ? 0 : 1] = 1;
  let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 2; i < 32; i++) { h = (h * 1103515245 + 12345) >>> 0; v[i] += ((h % 1000) / 1000 - 0.5) * 0.3; }
  return v;
});
const base = { graph: G, living: L, audit: A, embed: fakeEmbed, now: "2026-11-05T10:00:00.000Z", force: true, owner: "t" };
const snapshot = () => JSON.stringify([G.db.prepare("SELECT * FROM nodes ORDER BY id").all(), G.db.prepare("SELECT * FROM edges ORDER BY id").all()]);

// ---- a dry run before the schema exists changes nothing -------------------------------------------------------------------
{
  const before = snapshot();
  const rep = await K.runCurate({ ...base, dryRun: true });
  assert.ok(rep.skipped && /schema not applied/.test(rep.skipped), "dry run before the schema is a no-op");
  assert.equal(snapshot(), before);
}

// ---- first real run -------------------------------------------------------------------------------------------------------
const r1 = await K.runCurate({ ...base, ghostMinPapers: 10 });
assert.equal(r1.ok, true, "all phases ran: " + JSON.stringify(Object.entries(r1.phases).filter(([, v]) => v.error)));
const cnt = (sql) => G.one(sql).n;
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source IS NULL"), legacyEdges - 1, "legacy edges are untouched except the self-loop");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = target_id"), 0, "the self-loop is gone");
assert.equal(cnt("SELECT COUNT(*) AS n FROM kg_tombstone WHERE kind = 'edge' AND reason = 'self-loop'"), 1, "and kept whole in the tombstone");
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id LIKE 'archive-record-%'"), 0, "placeholder archive-record nodes are pruned");
assert.equal(cnt("SELECT COUNT(*) AS n FROM kg_tombstone WHERE kind = 'node'"), 2, "the two placeholders are tombstoned; the young deprecated orphan waits for its 30 days");
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'dep-1'"), 1);
{
  const t = G.one("SELECT row FROM kg_tombstone WHERE kind = 'node' AND key = 'archive-record-1'");
  const row = JSON.parse(t.row); assert.equal(row.label, "Paper"); assert.equal(row.name, "https://papers.qnfo.org/papers");
}
assert.equal(G.one("SELECT status FROM nodes WHERE id = 'paper:quar-1'").status, "quarantined", "paper lifecycle follows living-paper");
assert.equal(G.one("SELECT status FROM nodes WHERE id = 'arch-1'").status, "archived", "a node whose own properties say ARCHIVED leaves the active counts");
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'paper:alpha-4'"), 1, "a live paper without a node gets one");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'HAS_TAG' AND source = 'kg:lp-tag'"), 14, "one tag edge per live paper (the quarantined paper has none)");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'IN_CATEGORY'"), 14);
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'CITES' AND source = 'kg:lp-cite' AND target_id = 'paper:alpha-1'"), 1, "internal citations become paper-to-paper CITES");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'CITES' AND target_id = 'work:arxiv:2401.00001'"), 2, "external works are shared nodes; a quarantined paper's citation is dropped");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'COUPLED_WITH'"), 1, "bibliographic coupling: alpha-1 and alpha-2 share two references");
// fleet anchors
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE label = 'Worker'"), 4);
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'BINDS' AND source_id = 'worker:qnfo-ops' AND target_id = 'd1:qnfo-audit'"), 1);
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'CALLS' AND source_id = 'worker:qnfo-memory-mcp' AND target_id = 'worker:qnfo-ops'"), 1, "a function's http_calls is lifted to its worker");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'SERVES' AND target_id = 'domain:ops.qnfo.org'"), 1);
// audit
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'issue:1' AND target_id = 'worker:qnfo-ops' AND confidence = 1"), 1, "a code-task path is EXTRACTED");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'issue:3' AND target_id = 'worker:qnfo-memory-mcp' AND confidence < 1"), 1, "a name in prose is INFERRED");
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'issue:2'"), 0, "closed issues are not nodes");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'metric:fleet_graph_findings_warn' AND relationship_type = 'LEVER_IN' AND target_id = 'worker:qnfo-memory-mcp'"), 1);
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'program:QNFO.OPS' AND relationship_type = 'GUARDED_BY'"), 2);
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'goal:g2'"), 0, "retired goals are skipped");
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id IN ('issue:4', 'failure-mode:fm-lonely')"), 0, "an audit entity with nothing to link to is not made a node (the curator must not create orphans)");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'issue:5' AND target_id = 'worker:qnfo-workers'"), 0, "the monorepo's own name is not a worker mention");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'issue:5' AND target_id = 'worker:qnfo-ops'"), 1);
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'paper:ghost-old' AND status = 'ghost'"), 1, "marking a ghost starts its 30 days: an old node is not deleted in the run that marks it");
assert.equal(G.one("SELECT status FROM nodes WHERE id = 'paper:ghost'").status, "ghost", "a paper node living-paper does not know and no authored edge touches is a ghost");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'HAS_ARTIFACT' AND source_id = 'paper:alpha-1' AND target_id = 'r2object-1'"), 1, "an R2Object is linked to its paper by r2_key");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'HAS_ARTIFACT' AND source_id = 'paper:alpha-2' AND target_id = 'r2object-2'"), 1, "or by identifier when the key differs");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'MENTIONS' AND target_id = 'concept-bt' AND source LIKE 'kg:concept'"), 7, "papers that name a Concept link to it");
// mentions
assert.ok(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'task-1' AND relationship_type = 'MENTIONS'") >= 2, "a legacy Task that names two workers is linked to both");
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'task-2' AND target_id = 'prog-1' AND relationship_type = 'MENTIONS'"), 1, "program codes are aliases");
// semantic
const sim = G.db.prepare("SELECT source_id AS s, target_id AS t, weight FROM edges WHERE relationship_type = 'SIMILAR_TO'").all();
assert.ok(sim.length >= 10, "same-topic papers are linked (" + sim.length + ")");
assert.ok(sim.every((e) => e.s.slice(6, 11) === e.t.slice(6, 11)), "no similarity edge crosses topics");
const degs = new Map(); for (const e of sim) { degs.set(e.s, (degs.get(e.s) || 0) + 1); degs.set(e.t, (degs.get(e.t) || 0) + 1); }
assert.ok([...degs.values()].every((d) => d <= 12), "inferred degree is capped");
assert.equal(G.one("SELECT COUNT(*) AS n FROM kg_embed").n, 14, "every live paper with text is embedded once");
// entity resolution
assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'SAME_AS' AND source_id = 'proj-b'"), 1, "duplicate names get SAME_AS, never a merge");
assert.ok(G.one("SELECT canonical_id AS c FROM nodes WHERE id = 'proj-b'").c === "proj-a" || G.one("SELECT canonical_id AS c FROM nodes WHERE id = 'proj-a'").c === "proj-b");
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id IN ('proj-a', 'proj-b')"), 2, "both survive");
// analytics and publish
assert.ok(r1.health.orphan_share < 40 && r1.health.edge_density > 1, "health is computed: " + JSON.stringify({ o: r1.health.orphan_share, d: r1.health.edge_density }));
assert.equal(G.one("SELECT COUNT(*) AS n FROM kg_health").n, 1);
assert.ok(cnt("SELECT COUNT(*) AS n FROM kg_node_stats WHERE pagerank > 0") > 10);
assert.equal(A.one("SELECT last_value AS v FROM metric_registry WHERE metric = 'kg_orphan_share'").v, String(r1.health.orphan_share));
assert.equal(A.one("SELECT ok FROM fleet_heartbeat WHERE worker = 'kg-curate'").ok, 1);
assert.equal(A.one("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE job = 'kg-curate'").n, 1);

// ---- idempotent: the same input writes (almost) nothing -------------------------------------------------------------------
const r2 = await K.runCurate({ ...base, now: "2026-11-05T10:30:00.000Z" });
assert.equal(r2.ok, true);
assert.ok(r2.writes <= 4, "a second run on unchanged input writes few rows (got " + r2.writes + ")");
assert.equal(G.one("SELECT COUNT(*) AS n FROM edges WHERE status = 'stale'").n, 0);

// ---- throttle and lease -----------------------------------------------------------------------------------------------------
{
  const t = await K.runCurate({ ...base, force: false, now: "2026-11-05T10:35:00.000Z" });
  assert.ok(/min ago/.test(t.skipped), "a run inside the interval is skipped");
  G.db.exec("INSERT OR REPLACE INTO kg_state (k, v, updated_at) VALUES ('lease', '" + JSON.stringify({ owner: "other", until: "2026-11-05T12:00:00.000Z" }) + "', 'x'), ('lastRun', '" + JSON.stringify({ at: "2026-11-05T01:00:00.000Z", ok: true }) + "', 'x')");
  const l = await K.runCurate({ ...base, force: false, now: "2026-11-05T11:00:00.000Z" });
  assert.ok(/lease/.test(l.skipped), "a live lease held by another curator stops the run");
  G.db.exec("DELETE FROM kg_state WHERE k = 'lease'");
}

// ---- sweep: a removed source row goes stale, then is deleted after the grace period, with a tombstone ------------------------
L.db.exec("DELETE FROM paper_tag WHERE slug = 'beta-7'");
const r3 = await K.runCurate({ ...base, now: "2026-11-05T12:00:00.000Z" });
assert.equal(r3.phases.living.tags.stale, 1, "the dropped tag edge is marked stale, not deleted");
assert.equal(G.one("SELECT COUNT(*) AS n FROM edges WHERE status = 'stale' AND source_id = 'paper:beta-7'").n, 1);
G.db.exec("UPDATE nodes SET updated_at = '2026-01-01 00:00:00', created_at = '2026-01-01 00:00:00' WHERE id = 'dep-1'");
const r4 = await K.runCurate({ ...base, now: "2026-11-20T12:00:00.000Z" });
assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'dep-1'"), 0, "a *_DEPRECATED orphan older than 30 days is pruned");
assert.equal(cnt("SELECT COUNT(*) AS n FROM kg_tombstone WHERE kind = 'node' AND key = 'dep-1'"), 1);
assert.equal(G.one("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'paper:beta-7' AND relationship_type = 'HAS_TAG'").n, 0, "stale beyond 14 days is deleted");
assert.ok(G.one("SELECT COUNT(*) AS n FROM kg_tombstone WHERE kind = 'edge' AND reason LIKE 'stale%'").n >= 1);

// ---- shrink guard: a source that returns a quarter of its rows does not sweep the rest -----------------------------------------
{
  const before = G.one("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'HAS_TAG' AND status IS 'active'").n;
  L.db.exec("DELETE FROM paper_tag WHERE slug NOT IN ('alpha-1', 'alpha-2', 'alpha-3')");
  const r = await K.runCurate({ ...base, sweepMinSet: 5, now: "2026-11-21T12:00:00.000Z" });
  assert.ok(/shrink/.test(r.phases.living.tags.guard), "guard names the shrink: " + r.phases.living.tags.guard);
  assert.equal(G.one("SELECT COUNT(*) AS n FROM edges WHERE relationship_type = 'HAS_TAG' AND status IS 'active'").n, before, "nothing was swept");
  await K.runCurate({ ...base, sweepMinSet: 5, now: "2026-11-21T13:00:00.000Z" });
  const r6 = await K.runCurate({ ...base, sweepMinSet: 5, now: "2026-11-21T14:00:00.000Z" });
  assert.ok(r6.phases.living.tags.stale > 0, "the third run in a row accepts a lasting shrink");
}

// ---- tie guard: identical texts must not become a similarity hairball --------------------------------------------------------
{
  const G2 = mk(), L2 = mk(), A2 = mk();
  G2.db.exec(G.db.prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master WHERE type = 'table' AND name IN ('nodes', 'edges')").get().s.replace(/ALTER.*?;/g, ""));
  G2.db.exec("CREATE UNIQUE INDEX idx_edges_triple ON edges(source_id, target_id, relationship_type)");
  for (const s of SCHEMA_SQL) G2.db.exec(s);
  L2.db.exec(L.db.prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master WHERE type = 'table'").get().s);
  A2.db.exec(A.db.prepare("SELECT group_concat(sql, ';') AS s FROM sqlite_master WHERE type = 'table'").get().s);
  const same = ("Identical boilerplate text about alpha. ").repeat(12);
  for (let i = 1; i <= 12; i++) { L2.db.exec("INSERT INTO papers (slug, identifier, title, abstract, body_md, status, doi, version, updated_at) VALUES (" + ["dup-" + i, "id-dup-" + i, "Same title", same, "", "published", "", "1.0.0", "2026-10-01"].map(K.lit).join(",") + ")"); L2.db.exec("INSERT INTO paper_category VALUES ('dup-" + i + "', '" + (i % 2 ? "physics" : "mathematics") + "', '[]', 90)"); }
  const rep = await K.runCurate({ graph: G2, living: L2, audit: A2, embed: async (texts) => texts.map(() => Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : 0.01 * i))), now: "2026-11-05T10:00:00.000Z", force: true, owner: "t2" });
  assert.equal(rep.phases.semantic.edges.inserted, 0, "twelve identical vectors produce no edge at all");
  assert.ok(rep.phases.semantic.degenerateGroups >= 12);
}

// ---- review fixes ----------------------------------------------------------------------------------------------------------------
// an issue that closes, comes back, and the last open issue closing
{
  A.db.exec("UPDATE agent_issues SET status = 'closed' WHERE id IN (1, 3, 5)");
  const r = await K.runCurate({ ...base, now: "2026-11-25T01:00:00.000Z" });
  assert.equal(r.ok, true);
  assert.equal(G.one("SELECT status FROM nodes WHERE id = 'issue:1'").status, "closed", "with no open issue left the last issue nodes close (an empty source still sweeps)");
  assert.ok(cnt("SELECT COUNT(*) AS n FROM edges WHERE source = 'kg:audit-issue' AND status = 'stale'") >= 2, "and their edges go stale");
  A.db.exec("UPDATE agent_issues SET status = 'open' WHERE id = 1");
  await K.runCurate({ ...base, now: "2026-11-25T02:00:00.000Z" });
  assert.equal(G.one("SELECT status FROM nodes WHERE id = 'issue:1'").status, null, "a reopened issue is an active node again");
  assert.equal(cnt("SELECT COUNT(*) AS n FROM edges WHERE source_id = 'issue:1' AND status = 'active'"), 1, "with its edge active again");
}
// the ghost waits 30 days, then goes with a tombstone
{
  const r = await K.runCurate({ ...base, now: "2026-12-10T00:00:00.000Z" });
  assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id IN ('paper:ghost', 'paper:ghost-old')"), 0, "ghosts older than 30 days with no link are deleted");
  assert.equal(cnt("SELECT COUNT(*) AS n FROM kg_tombstone WHERE kind = 'node' AND key = 'paper:ghost-old'"), 1);
  assert.ok(r.phases.prune.ghosts >= 2);
}
// a node is not deleted when an edge has reached it since the graph was read
{
  N("race-1", "Project", "Raced Project"); N("race-2", "Project", "Other Project");
  const ctx = await K.loadContext({ ...base, maxWrites: 1e6, maxDeletes: 100, stats: { writes: 0, deletes: 0 }, phases: {}, warnings: [] });
  E("e-race", "race-2", "race-1", "RELATES_TO");
  await K.deleteRows(ctx, "node", ["race-1"], "test race");
  assert.equal(cnt("SELECT COUNT(*) AS n FROM nodes WHERE id = 'race-1'"), 1, "the database refuses the delete while an edge touches the node");
  assert.equal(cnt("SELECT COUNT(*) AS n FROM kg_tombstone WHERE key = 'race-1'"), 0, "and nothing is tombstoned for a delete that did not happen");
}
// a dry run does not call the paid embedder
{
  let calls = 0;
  await K.runCurate({ ...base, dryRun: true, embed: async (x) => { calls++; return fakeEmbed(x); }, now: "2026-12-11T00:00:00.000Z" });
  assert.equal(calls, 0, "no embedding call in a dry run");
}
// statements are measured in bytes
{
  const parts = K.insertBatches("INSERT INTO t VALUES ", Array.from({ length: 800 }, () => "('" + "é".repeat(120) + "')"));
  assert.ok(parts.every((x) => Buffer.byteLength(x) < 60400), "multi-byte tuples stay under the byte limit");
}

// ---- dry run changes nothing once the schema exists --------------------------------------------------------------------------
{
  const before = snapshot(), health = G.one("SELECT COUNT(*) AS n FROM kg_health").n;
  const rep = await K.runCurate({ ...base, dryRun: true, now: "2026-11-22T00:00:00.000Z" });
  assert.equal(rep.ok, true); assert.ok(rep.writes > 0 || rep.writes === 0);
  assert.equal(snapshot(), before, "dry run leaves nodes and edges byte-identical");
  assert.equal(G.one("SELECT COUNT(*) AS n FROM kg_health").n, health);
}

// ---- analytics -------------------------------------------------------------------------------------------------------------------
{
  const pr = K.pagerank([[{ n: 1, w: 1 }], [{ n: 0, w: 1 }, { n: 2, w: 1 }], [{ n: 1, w: 1 }], []]);
  assert.ok(Math.abs(pr.reduce((s, x) => s + x, 0) - 1) < 1e-9, "pagerank is a distribution");
  assert.ok(pr[1] > pr[0] && pr[1] > pr[2], "the hub ranks highest");
}

// ---- write cap ----------------------------------------------------------------------------------------------------------------------
{
  L.db.exec("INSERT INTO paper_tag VALUES ('alpha-1', 'a brand new tag', 5)");
  const rep = await K.runCurate({ ...base, now: "2026-12-01T00:00:00.000Z", maxWrites: 0 });
  assert.equal(rep.ok, false); assert.ok(Object.values(rep.phases).some((p) => /write cap/.test(p.error || "")), "the cap stops the run with a named reason");
}

// ---- the wall-clock budget: past it the remaining phases wait for the next run, and the run does not count as a good one
{
  const r = await K.runCurate({ ...base, budgetMs: -1, now: "2026-12-20T00:00:00.000Z" });
  assert.ok(r.deferred >= 10 && Object.values(r.phases).filter((p) => p.deferred).length >= 10, "every phase is deferred when the budget is gone");
  assert.equal(JSON.parse(G.one("SELECT v FROM kg_state WHERE k = 'lastRun'").v).ok, false, "so the next run is not throttled");
  const r2 = await K.runCurate({ ...base, force: false, now: "2026-12-20T00:01:00.000Z" });
  assert.ok(!r2.skipped && r2.ok, "and it starts at once");
}
// ---- a throttled run is cheap: a push storm starts one per push
{
  let reads = 0, writes = 0;
  const counted = { all: async (sql) => { reads++; return G.all(sql); }, run: async (sql) => { writes++; return G.run(sql); } };
  const t = await K.runCurate({ ...base, graph: counted, force: false, now: "2026-12-20T00:02:00.000Z" });
  assert.ok(/min ago/.test(t.skipped), "inside the interval the run is skipped");
  assert.ok(reads <= 5 && writes === 0, "and it reads a handful of rows and writes nothing (reads " + reads + ", writes " + writes + ")");
}
console.log("kg_curate suite ok");
