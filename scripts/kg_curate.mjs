#!/usr/bin/env node
// scripts/kg_curate.mjs: KG-CURATE-1 (2026-11-05, pillar autonomy; also research and reach).
//
// WHAT   The fleet's own curator for the content knowledge graph (qnfo-graph D1 `nodes` / `edges`). Measured 2026-11-05 before
//        this existed: 8,705 nodes and 9,423 edges (1.08 per node), 60% of the edges structural CONTAINS, 1,626 nodes (19%) with
//        no edge at all (64% of the Paper nodes), 159 duplicate-name groups, 457 placeholder "archive-record" Paper nodes, and
//        nothing that added, checked or removed an edge after the writer had moved on. Every run does, in this order and each
//        phase isolated (one failing never stops the others):
//          lifecycle   Paper node status follows living-paper (quarantined, duplicate, retracted ... leave the active counts);
//          living      deterministic edges from living-paper tables: tags, categories, internal and external citations;
//          fleet       the topology as graph anchors: Worker, Database, Bucket, Queue, Domain nodes and BINDS / CALLS / SERVES
//                      edges read from the fleet code graph (fg_node / fg_edge);
//          audit       Metric, Program, Goal, FailureMode, Issue (open), Decision, Capability nodes from qnfo-audit, linked to
//                      the workers they name (a `code-task: ... path=<dir>/` line is EXTRACTED, a name in prose INFERRED);
//          mentions    legacy nodes (Task, Decision, Project, Skill, CloudflareAsset ...) that name a worker, program, phase or
//                      domain get a MENTIONS edge to it;
//          coupling    bibliographic coupling between papers (IDF-weighted shared references);
//          semantic    title + abstract embedded here (bge-base-en-v1.5), similarity computed in memory, mutual-kNN with a degree
//                      cap, near-duplicates split off, the cutoff calibrated against a null and tuned by category agreement;
//          entities    duplicate-name groups get SAME_AS edges and `canonical_id` (never a destructive merge);
//          prune       self-loops, dangling and stale edges, placeholder and deprecated orphans, tombstoned and capped;
//          analytics   components, PageRank, communities, bridges, link candidates, gaps (kg_node_stats, kg_gap);
//          publish     kg_health row, metrics and heartbeat in qnfo-audit, a node-link snapshot in R2.
// WHY    Why the shape (docs/KNOWLEDGE-GRAPH.md has the sources): every derived edge carries source, confidence, weight, evidence
//        and last_seen, so a reader can tell a fact from a guess; a source is reconciled as a SET (add, update, mark stale what a
//        complete pass no longer derives, delete stale rows after 14 days with a tombstone copy) instead of a write-only
//        pile; sweeps refuse to run when a source shrinks by more than 20% or would invalidate more than 10% in one run; nothing
//        inferred is used as input to inference (phases read tables and the legacy graph, never `kg:` edges, except analytics);
//        a legacy edge (source IS NULL) is never modified, only read (the one exception is a self-loop or dangling edge, tombstoned first).
// WHERE  Run by scripts/fleet_graph.mjs after the fleet graph (same workflow, same two triggers: push to main and the
//        qnfo-cloud-ops repository_dispatch), or alone: node scripts/kg_curate.mjs [--dry-run] [--force].
//        Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. No Claude call anywhere; the only paid call is Workers AI
//        embeddings (about USD 0.03 for the first full pass, then only changed papers).
// LIMIT  Similarity is a lead, not a fact (confidence is the cosine, source says `kg:semantic`); name-based links are INFERRED
//        and labelled. Communities come from label propagation split into connected parts, not Leiden. The vector index
//        qwav-research-v2 is deliberately NOT used: on 2026-11-05 a query returned twenty different papers at one identical
//        score (stub text, not paper text), so embeddings are computed here from cleaned title and abstract.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

export const VERSION = "1.0.0";
export const GRAPH_DB_ID = "a1954b92-d681-4d02-b1f6-f9a2eb4c265d";
export const LIVING_DB_ID = "70a58cb3-b2cd-498d-877f-ecca86859a22";
export const AUDIT_DB_ID = "35e2e573-92f3-46ac-83c6-22f6429fc5e5";
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
export const SNAPSHOT_BUCKET = "qnfo-backups";

// ---------------------------------------------------------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------------------------------------------------------
export const STRUCTURAL = new Set(["CONTAINS", "CONTAINS_PHASE", "CONTAINS_TASK", "ULTRA_CONTAINS", "HAS_ROUTE", "HAS_ENDPOINT", "HAS_DOMAIN", "SAME_AS"]);
export const CONTENT_RELS = new Set(["CITES", "SIMILAR_TO", "COUPLED_WITH", "NEAR_DUPLICATE", "SUPERSEDES", "REFINES", "BUILDS_ON", "LINKS_TO", "RELATES_TO", "REFERENCES"]);
export const ACTIVE_LP = new Set(["published", "distributed", "external_preprint", "kg-backfill"]);
const LP_STATUS_NODE = new Set(["quarantined", "duplicate", "retracted", "superseded", "draft", "ghost"]);
export const SOURCES = {
  lpPaper: "kg:lp-paper", lpTag: "kg:lp-tag", lpCat: "kg:lp-cat", lpCite: "kg:lp-cite", fleet: "kg:fleet", auditMetric: "kg:audit-metric",
  auditProgram: "kg:audit-program", auditGoal: "kg:audit-goal", auditFm: "kg:audit-fm", auditIssue: "kg:audit-issue",
  auditDecision: "kg:audit-decision", auditCap: "kg:audit-capability", artifact: "kg:artifact", concept: "kg:concept", mention: "kg:mention", coupling: "kg:bib-coupling", semantic: "kg:semantic", er: "kg:er",
};
const STALE_DELETE_DAYS = 14;
const AMBIENT_WORKERS = new Set(["qnfo-workers"]); // the monorepo's own name is in nearly every code-task line; it names no one worker
const SWEEP_MIN_KEEP = 0.8;    // a pass that derives fewer than 80% of the previous set is treated as partial: no sweep
const SWEEP_MAX_STALE = 0.1;   // one run marks at most 10% of a source stale
const EK = "\u0001";
export const ekey = (s, r, t) => s + EK + r + EK + t;

// ---------------------------------------------------------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------------------------------------------------------
export const sha = (s) => createHash("sha1").update(String(s)).digest("hex");
export const edgeId = (s, r, t) => "kg:" + sha(ekey(s, r, t)).slice(0, 20);
export function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return Number.isFinite(v) ? String(+v.toFixed(4)) : "NULL";
  return "'" + String(v).replace(/\u0000/g, "").replace(/'/g, "''") + "'";
}
export function normName(s) {
  return String(s == null ? "" : s).normalize("NFKC").toLowerCase().replace(/[‐-―]/g, "-").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
export const familyOf = (label) => String(label || "").replace(/_DEPRECATED$/, "");
const GENERIC_NAME = /^(untitled|unknown|test|todo|tbd|none|n a|note|notes|draft|new|readme|index|home|overview|summary|introduction|\d+|\d{4} \d{2} \d{2})$/;
export const isGenericName = (norm) => norm.length < 4 || GENERIC_NAME.test(norm);
export function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
const inList = (ids) => ids.map(lit).join(", ");
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
export function insertBatches(head, tuples, tail = "", maxLen = 60000, maxRows = 250) {
  const out = []; let cur = []; let size = 0;
  for (const t of tuples) {
    const len = Buffer.byteLength(t); // D1 limits a statement in bytes, and names are not all ASCII
    if (cur.length && (size + len > maxLen || cur.length >= maxRows)) { out.push(head + cur.join(", ") + tail); cur = []; size = 0; }
    cur.push(t); size += len + 2;
  }
  if (cur.length) out.push(head + cur.join(", ") + tail);
  return out;
}
export function stripFrontMatter(s) {
  s = String(s || "").replace(/^﻿/, "").trimStart();
  if (s.startsWith("---")) { const m = s.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/); if (m) s = s.slice(m[0].length); }
  return s;
}
export function cleanForEmbedding(raw) {
  return stripFrontMatter(raw).replace(/<[^>]+>/g, " ").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ").replace(/[#>*_`~|]+/g, " ").replace(/\s+/g, " ").trim();
}
const STUB_TEXT = /full text and metadata at|qnfo research paper\s*(full|$)|by accessing this content, you agree/i;
export function embeddingText(title, abstract, body) {
  let t = cleanForEmbedding(abstract);
  if (t.length < 150 && body) t = cleanForEmbedding(body);
  if (t.length < 120 || (STUB_TEXT.test(t) && t.length < 400)) return null;
  return (String(title || "").trim() + ". " + t).slice(0, 2000);
}
export function quantize(v) {
  let max = 0; for (const x of v) if (Math.abs(x) > max) max = Math.abs(x);
  const sc = max || 1, b = Buffer.alloc(v.length);
  for (let i = 0; i < v.length; i++) b.writeInt8(Math.max(-127, Math.min(127, Math.round(v[i] / sc * 127))), i);
  return { q: b.toString("base64"), sc: +sc.toFixed(6) };
}
export function dequantize(q, sc) {
  const b = Buffer.from(q, "base64"), out = new Float32Array(b.length); let n = 0;
  for (let i = 0; i < b.length; i++) { out[i] = b.readInt8(i) / 127 * sc; n += out[i] * out[i]; }
  n = Math.sqrt(n) || 1; for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
const isActiveEdge = (e) => e.status == null || e.status === "active";

// ---------------------------------------------------------------------------------------------------------------------------
// Schema (idempotent; qnfo-graph is not a migration-runner target, so the curator owns it like fleet_graph.mjs owns fg_*).
// ---------------------------------------------------------------------------------------------------------------------------
export const NODE_COLUMNS = [["status", "TEXT"], ["source", "TEXT"], ["canonical_id", "TEXT"], ["last_seen", "TEXT"], ["h", "TEXT"]];
export const EDGE_COLUMNS = [["source", "TEXT"], ["confidence", "REAL"], ["weight", "REAL"], ["status", "TEXT"], ["evidence", "TEXT"], ["last_seen", "TEXT"], ["invalidated_at", "TEXT"]];
export const KG_TABLES_SQL = [
  "CREATE TABLE IF NOT EXISTS kg_state (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS kg_health (ts TEXT PRIMARY KEY, version TEXT, metrics TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS kg_tombstone (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, key TEXT NOT NULL, row TEXT NOT NULL, reason TEXT NOT NULL, deleted_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS kg_node_stats (node_id TEXT PRIMARY KEY, degree INTEGER, deg_sem INTEGER, pagerank REAL, component INTEGER, community TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS kg_gap (id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT, score REAL, status TEXT NOT NULL DEFAULT 'open', first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS kg_embed (slug TEXT PRIMARY KEY, h TEXT NOT NULL, model TEXT NOT NULL, q TEXT NOT NULL, sc REAL NOT NULL, updated_at TEXT NOT NULL)",
];
export const KG_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_edges_kg_source ON edges(source, status)",
  "CREATE INDEX IF NOT EXISTS idx_nodes_kg_source ON nodes(source)",
  "CREATE INDEX IF NOT EXISTS idx_nodes_kg_status ON nodes(status)",
  "CREATE INDEX IF NOT EXISTS idx_kg_tombstone_key ON kg_tombstone(kind, key)",
  "CREATE INDEX IF NOT EXISTS idx_kg_gap_kind ON kg_gap(kind, status)",
];
export async function missingColumns(graph) {
  const have = async (t) => new Set((await graph.all("PRAGMA table_info(" + t + ")")).map((r) => r.name));
  const n = await have("nodes"), e = await have("edges");
  return { nodes: NODE_COLUMNS.filter(([c]) => !n.has(c)), edges: EDGE_COLUMNS.filter(([c]) => !e.has(c)) };
}
export async function ensureSchema(graph, dryRun) {
  const miss = await missingColumns(graph);
  const pending = miss.nodes.length + miss.edges.length;
  if (dryRun) return { pending, applied: false };
  for (const s of KG_TABLES_SQL) await graph.run(s);
  for (const [c, t] of miss.nodes) await graph.run("ALTER TABLE nodes ADD COLUMN " + c + " " + t);
  for (const [c, t] of miss.edges) await graph.run("ALTER TABLE edges ADD COLUMN " + c + " " + t);
  for (const s of KG_INDEX_SQL) await graph.run(s);
  return { pending, applied: true };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Context: the whole graph in memory (ids, labels, names and edge keys only; properties stay in D1), plus guarded writes.
// ---------------------------------------------------------------------------------------------------------------------------
export async function loadContext(opts) {
  const ctx = Object.assign({ stats: { writes: 0, deletes: 0 }, phases: {}, warnings: [] }, opts);
  ctx.nodes = new Map(); ctx.edges = new Map(); ctx.state = new Map();
  for (const r of await ctx.graph.all("SELECT id, label, name, status, source, canonical_id, h, created_at, updated_at FROM nodes")) ctx.nodes.set(r.id, r);
  for (const r of await ctx.graph.all("SELECT id, source_id AS s, target_id AS t, relationship_type AS r, source, confidence AS c, weight AS w, status, invalidated_at AS inv, last_seen AS seen FROM edges")) ctx.edges.set(ekey(r.s, r.r, r.t), r);
  for (const r of await ctx.graph.all("SELECT k, v FROM kg_state")) ctx.state.set(r.k, r.v);
  return ctx;
}
function bump(ctx, n) {
  ctx.stats.writes += n;
  if (ctx.stats.writes > ctx.maxWrites) throw new Error("write cap " + ctx.maxWrites + " reached");
}
async function w(ctx, sql, rows = 1) {
  ctx.stats.writes += rows;
  if (ctx.stats.writes > ctx.maxWrites) throw new Error("write cap " + ctx.maxWrites + " reached");
  if (!ctx.dryRun) await ctx.graph.run(sql);
}
// Independent statements (inserts and upserts of one table) go four at a time: D1 serialises the writes, but the round trip is most of the cost.
async function runMany(ctx, stmts) {
  for (let i = 0; i < stmts.length; i += 4) await Promise.all(stmts.slice(i, i + 4).map((st) => w(ctx, st, 0)));
}
async function setState(ctx, k, v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  ctx.state.set(k, s);
  if (!ctx.dryRun) await ctx.graph.run("INSERT INTO kg_state (k, v, updated_at) VALUES (" + lit(k) + ", " + lit(s) + ", " + lit(ctx.now) + ") ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at");
}
const getState = (ctx, k, dflt) => { try { return ctx.state.has(k) ? JSON.parse(ctx.state.get(k)) : dflt; } catch (e) { return dflt; } };
const NODE_COLS = "id, label, name, properties, created_at, updated_at, status, source, last_seen, h";

// Nodes owned by a source: insert the missing, update the changed (by content hash `h`, or by a status that differs: a node that came back
// is no longer closed or stale), never touch a node another writer owns. The in-memory map follows the database only after the statements ran.
export async function putNodes(ctx, source, nodes, opts = {}) {
  const rep = { inserted: 0, updated: 0, kept: 0, foreign: 0, closed: 0 };
  const tuples = [], upserts = [], seen = new Set(), apply = [];
  for (const n of nodes) {
    if (!n.id || seen.has(n.id)) continue; seen.add(n.id);
    const props = JSON.stringify(n.props || {}), h = sha([n.label, n.name, n.status || "", props].join(EK)).slice(0, 12), ex = ctx.nodes.get(n.id);
    const status = n.status === undefined ? null : n.status;
    const tuple = "(" + [n.id, n.label, String(n.name || n.id).slice(0, 300), props, ctx.now, ctx.now, status, source, ctx.now, h].map(lit).join(", ") + ")";
    if (!ex) { tuples.push(tuple); rep.inserted++; apply.push(() => ctx.nodes.set(n.id, { id: n.id, label: n.label, name: n.name, status, source, h, canonical_id: null, created_at: ctx.now, updated_at: ctx.now })); }
    else if (ex.source !== source) rep.foreign++;
    else if (ex.h !== h || (ex.status || null) !== status) { upserts.push(tuple); rep.updated++; apply.push(() => Object.assign(ex, { label: n.label, name: n.name, status, h, updated_at: ctx.now })); }
    else rep.kept++;
  }
  bump(ctx, rep.inserted + rep.updated); // the cap is checked before the first statement runs
  await runMany(ctx, insertBatches("INSERT OR IGNORE INTO nodes (" + NODE_COLS + ") VALUES ", tuples));
  await runMany(ctx, insertBatches("INSERT INTO nodes (" + NODE_COLS + ") VALUES ", upserts, " ON CONFLICT(id) DO UPDATE SET label = excluded.label, name = excluded.name, properties = excluded.properties, status = excluded.status, h = excluded.h, last_seen = excluded.last_seen, updated_at = excluded.updated_at"));
  for (const f of apply) f();
  if (opts.close) {
    const keep = new Set(nodes.map((n) => n.id)), gone = [];
    for (const n of ctx.nodes.values()) if (n.source === source && !keep.has(n.id) && n.status !== opts.close) gone.push(n.id);
    for (const c of chunks(gone, 150)) {
      await w(ctx, "UPDATE nodes SET status = " + lit(opts.close) + ", updated_at = " + lit(ctx.now) + " WHERE source = " + lit(source) + " AND id IN (" + inList(c) + ")", c.length);
      for (const id of c) { const n = ctx.nodes.get(id); n.status = opts.close; n.updated_at = ctx.now; }
    }
    rep.closed = gone.length;
  }
  return rep;
}

// Edges owned by a source, reconciled as a set. desired: [{s, t, r, w, c, ev}]. Endpoints must already be nodes.
export async function reconcileEdges(ctx, source, desired, opts = {}) {
  const rep = { desired: 0, inserted: 0, updated: 0, stale: 0, collisions: 0, skipped: 0, guard: null };
  const want = new Map();
  for (const d of desired) {
    if (d.s === d.t || !ctx.nodes.has(d.s) || !ctx.nodes.has(d.t)) { rep.skipped++; continue; }
    const k = ekey(d.s, d.r, d.t); if (!want.has(k)) want.set(k, d);
  }
  rep.desired = want.size;
  const mine = []; for (const e of ctx.edges.values()) if (e.source === source) mine.push(e);
  const priorActive = mine.filter(isActiveEdge).length;
  const ins = [], upd = [], apply = [];
  const cols = "id, source_id, target_id, relationship_type, properties, created_at, updated_at, source, confidence, weight, status, evidence, last_seen";
  for (const [k, d] of want) {
    const ex = ctx.edges.get(k);
    const wv = d.w == null ? null : round(d.w), cv = d.c == null ? null : round(d.c), ev = d.ev ? JSON.stringify(d.ev) : null;
    const tuple = "(" + [edgeId(d.s, d.r, d.t), d.s, d.t, d.r, "{}", ctx.now, ctx.now, source, cv, wv, "active", ev, ctx.now].map(lit).join(", ") + ")";
    if (!ex) { ins.push(tuple); apply.push(() => ctx.edges.set(k, { id: edgeId(d.s, d.r, d.t), s: d.s, t: d.t, r: d.r, source, c: cv, w: wv, status: "active", inv: null, seen: ctx.now })); rep.inserted++; }
    else if (ex.source !== source) rep.collisions++;
    else if (!isActiveEdge(ex) || Math.abs((ex.w || 0) - (wv || 0)) > 0.002 || Math.abs((ex.c || 0) - (cv || 0)) > 0.002) { upd.push(tuple); apply.push(() => Object.assign(ex, { w: wv, c: cv, status: "active", inv: null, seen: ctx.now })); rep.updated++; }
  }
  bump(ctx, rep.inserted + rep.updated);
  await runMany(ctx, insertBatches("INSERT OR IGNORE INTO edges (" + cols + ") VALUES ", ins));
  await runMany(ctx, insertBatches("INSERT INTO edges (" + cols + ") VALUES ", upd, " ON CONFLICT(id) DO UPDATE SET confidence = excluded.confidence, weight = excluded.weight, status = 'active', invalidated_at = NULL, evidence = excluded.evidence, last_seen = excluded.last_seen, updated_at = excluded.updated_at"));
  for (const f of apply) f();
  if (opts.sweep !== false) {
    const gone = mine.filter((e) => isActiveEdge(e) && !want.has(ekey(e.s, e.r, e.t)));
    const shrinkKey = "shrink:" + source, shrinks = getState(ctx, shrinkKey, 0), shrank = priorActive >= (ctx.sweepMinSet == null ? 20 : ctx.sweepMinSet) && want.size < SWEEP_MIN_KEEP * priorActive;
    // A real, lasting shrink (a queue drained, a table cleaned) would otherwise freeze the sweep for good: the third run in a row accepts it.
    if (shrank && shrinks < 2) { rep.guard = "shrink: derived " + want.size + " of " + priorActive + " (< " + SWEEP_MIN_KEEP * 100 + "%), no sweep (" + (shrinks + 1) + " of 3)"; ctx.warnings.push(source + " " + rep.guard); await setState(ctx, shrinkKey, shrinks + 1); }
    else if (gone.length) {
      if (shrinks) await setState(ctx, shrinkKey, 0);
      const cap = Math.max(10, Math.ceil(SWEEP_MAX_STALE * priorActive));
      const take = gone.slice(0, cap);
      if (gone.length > cap) { rep.guard = "capped: " + gone.length + " stale candidates, marked " + cap; ctx.warnings.push(source + " " + rep.guard); }
      for (const c of chunks(take, 150)) await w(ctx, "UPDATE edges SET status = 'stale', invalidated_at = " + lit(ctx.now) + ", updated_at = " + lit(ctx.now) + " WHERE id IN (" + inList(c.map((e) => e.id)) + ")", c.length);
      for (const e of take) { e.status = "stale"; e.inv = ctx.now; }
      rep.stale = take.length;
    } else if (shrinks) await setState(ctx, shrinkKey, 0);
  }
  return rep;
}

// Delete rows after copying them whole into kg_tombstone (restorable with one INSERT ... SELECT json_extract). A node is only deleted while
// no edge of any kind touches it, checked by the database in the same statement, so an edge another writer added a moment ago keeps its node.
export async function deleteRows(ctx, kind, ids, reason) {
  if (!ids.length) return 0;
  const room = ctx.maxDeletes - ctx.stats.deletes;
  ids = ids.slice(0, Math.max(0, room));
  const table = kind === "edge" ? "edges" : "nodes";
  const guard = kind === "edge" ? "" : " AND NOT EXISTS (SELECT 1 FROM edges x WHERE x.source_id = nodes.id OR x.target_id = nodes.id)";
  const obj = kind === "edge"
    ? "json_object('id', id, 'source_id', source_id, 'target_id', target_id, 'relationship_type', relationship_type, 'properties', properties, 'created_at', created_at, 'updated_at', updated_at, 'source', source, 'confidence', confidence, 'weight', weight, 'status', status, 'evidence', evidence, 'last_seen', last_seen, 'invalidated_at', invalidated_at)"
    : "json_object('id', id, 'label', label, 'name', name, 'properties', properties, 'created_at', created_at, 'updated_at', updated_at, 'status', status, 'source', source, 'canonical_id', canonical_id, 'last_seen', last_seen, 'h', h)";
  for (const c of chunks(ids, 100)) {
    const list = inList(c);
    await w(ctx, "INSERT INTO kg_tombstone (kind, key, row, reason, deleted_at) SELECT " + lit(kind) + ", id, " + obj + ", " + lit(reason) + ", " + lit(ctx.now) + " FROM " + table + " WHERE id IN (" + list + ")" + guard, c.length);
    await w(ctx, "DELETE FROM " + table + " WHERE id IN (" + list + ")" + guard, 0);
    ctx.stats.deletes += c.length;
    const gone = new Set(c);
    if (kind === "edge") { for (const [k, e] of ctx.edges) if (gone.has(e.id)) ctx.edges.delete(k); }
    else for (const id of c) ctx.nodes.delete(id);
  }
  return ids.length;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Phases. Each returns a small report object; the orchestrator times and isolates them.
// ---------------------------------------------------------------------------------------------------------------------------
const paperNodeId = (slug) => "paper:" + slug;

async function loadLiving(ctx) {
  if (ctx.lp) return ctx.lp;
  // papers.slug has no index and sits after the large body columns of each row: this is the one scan of the table per run; every other read of
  // paper text goes by the primary key (identifier).
  const papers = await ctx.living.all("SELECT slug, identifier, r2_key, title, status, doi, updated_at, version FROM papers WHERE slug IS NOT NULL AND slug <> ''");
  const status = new Map(papers.map((p) => [p.slug, p.status]));
  const lp = { papers, status, tags: [], cats: [], cites: [] };
  lp.tags = await ctx.living.all("SELECT slug, tag, rank FROM paper_tag");
  lp.cats = await ctx.living.all("SELECT slug, category, secondary, confidence FROM paper_category");
  lp.cites = await ctx.living.all("SELECT citing_slug, cited_slug, cited_kind, cited_id, cited_title, cited_url FROM paper_citations");
  ctx.lp = lp;
  return lp;
}
const lpActive = (lp, slug) => ACTIVE_LP.has(lp.status.get(slug));

export async function phaseLifecycle(ctx) {
  const lp = await loadLiving(ctx), rep = { set: 0, cleared: 0, archived: 0, deprecated: 0 };
  const byStatus = new Map(), clear = [];
  // A paper:<slug> node whose slug living-paper does not know, and that no authored (legacy) edge touches, is a ghost: out of the active counts,
  // deleted after 30 days if nothing ever links it. Only when living-paper answered in full (a short read must not ghost the whole corpus).
  const legacyDeg = new Map(); for (const e of ctx.edges.values()) if (!e.source) { legacyDeg.set(e.s, 1); legacyDeg.set(e.t, 1); }
  const complete = lp.papers.length >= (ctx.ghostMinPapers == null ? 500 : ctx.ghostMinPapers);
  for (const n of ctx.nodes.values()) {
    if (n.label !== "Paper" || !n.id.startsWith("paper:")) continue;
    let st = lp.status.get(n.id.slice(6));
    if (st === undefined) { if (!complete || legacyDeg.get(n.id) || n.source) continue; st = "ghost"; }
    if (LP_STATUS_NODE.has(st) && n.status !== st) { if (!byStatus.has(st)) byStatus.set(st, []); byStatus.get(st).push(n.id); }
    else if (ACTIVE_LP.has(st) && n.status && LP_STATUS_NODE.has(n.status)) clear.push(n.id);
  }
  for (const [st, ids] of byStatus) for (const c of chunks(ids, 150)) { await w(ctx, "UPDATE nodes SET status = " + lit(st) + ", updated_at = " + lit(ctx.now) + " WHERE id IN (" + inList(c) + ")", c.length); for (const id of c) { const n = ctx.nodes.get(id); n.status = st; n.updated_at = ctx.now; } rep.set += c.length; }
  for (const c of chunks(clear, 150)) { await w(ctx, "UPDATE nodes SET status = NULL, updated_at = " + lit(ctx.now) + " WHERE id IN (" + inList(c) + ")", c.length); for (const id of c) { const n = ctx.nodes.get(id); n.status = null; n.updated_at = ctx.now; } rep.cleared += c.length; }
  // Legacy lifecycle markers: a node its own properties call ARCHIVED / DEPRECATED / RETIRED, and the *_DEPRECATED labels.
  const arch = await ctx.graph.all("SELECT id FROM nodes WHERE status IS NULL AND CASE WHEN json_valid(properties) THEN upper(COALESCE(json_extract(properties, '$.status'), '')) ELSE '' END IN ('ARCHIVED', 'DEPRECATED', 'RETIRED')");
  for (const c of chunks(arch.map((r) => r.id), 150)) { await w(ctx, "UPDATE nodes SET status = 'archived', updated_at = " + lit(ctx.now) + " WHERE id IN (" + inList(c) + ")", c.length); for (const id of c) if (ctx.nodes.has(id)) { const n = ctx.nodes.get(id); n.status = "archived"; n.updated_at = ctx.now; } rep.archived += c.length; }
  const dep = [...ctx.nodes.values()].filter((n) => n.status == null && /_DEPRECATED$/.test(n.label)).map((n) => n.id);
  for (const c of chunks(dep, 150)) { await w(ctx, "UPDATE nodes SET status = 'deprecated', updated_at = " + lit(ctx.now) + " WHERE id IN (" + inList(c) + ")", c.length); for (const id of c) { const n = ctx.nodes.get(id); n.status = "deprecated"; n.updated_at = ctx.now; } rep.deprecated += c.length; }
  return rep;
}

export async function phaseLiving(ctx) {
  const lp = await loadLiving(ctx), rep = {};
  // Paper nodes the graph lacks for papers that are live.
  const missing = lp.papers.filter((p) => ACTIVE_LP.has(p.status) && !ctx.nodes.has(paperNodeId(p.slug))).map((p) => ({ id: paperNodeId(p.slug), label: "Paper", name: p.title || p.slug, props: { slug: p.slug, status: p.status, doi: p.doi || "", source: "living-paper" } }));
  rep.papers = await putNodes(ctx, SOURCES.lpPaper, missing);
  const paperOk = (slug) => lpActive(lp, slug) && ctx.nodes.has(paperNodeId(slug)) && ctx.nodes.get(paperNodeId(slug)).status == null;
  // Tags.
  const tagNodes = new Map(), tagEdges = [];
  for (const r of lp.tags) {
    if (!r.tag || !paperOk(r.slug)) continue;
    const tid = "tag:" + normName(r.tag).replace(/ /g, "-"); if (tid === "tag:") continue;
    tagNodes.set(tid, { id: tid, label: "Tag", name: r.tag, props: {} });
    tagEdges.push({ s: paperNodeId(r.slug), t: tid, r: "HAS_TAG", w: 1, c: 1, ev: { rank: r.rank } });
  }
  rep.tagNodes = await putNodes(ctx, SOURCES.lpTag, [...tagNodes.values()]);
  rep.tags = await reconcileEdges(ctx, SOURCES.lpTag, tagEdges);
  // Categories (primary full weight, secondary half).
  const catNodes = new Map(), catEdges = [];
  for (const r of lp.cats) {
    if (!r.category || !paperOk(r.slug)) continue;
    const add = (cat, wt) => { const cid = "category:" + normName(cat).replace(/ /g, "-"); if (cid === "category:") return; catNodes.set(cid, { id: cid, label: "Category", name: cat, props: {} }); catEdges.push({ s: paperNodeId(r.slug), t: cid, r: "IN_CATEGORY", w: wt, c: wt === 1 ? Math.min(1, (r.confidence || 100) / 100) : 0.5, ev: { primary: wt === 1 } }); };
    add(r.category, 1);
    let sec = []; try { sec = JSON.parse(r.secondary || "[]"); } catch (e) { sec = []; }
    for (const s of Array.isArray(sec) ? sec.slice(0, 3) : []) if (typeof s === "string" && s && s !== r.category) add(s, 0.5);
  }
  rep.catNodes = await putNodes(ctx, SOURCES.lpCat, [...catNodes.values()]);
  rep.cats = await reconcileEdges(ctx, SOURCES.lpCat, catEdges);
  // Citations: internal papers, external works by kind and id.
  const workNodes = new Map(), citeEdges = [];
  for (const r of lp.cites) {
    if (!paperOk(r.citing_slug)) continue;
    const from = paperNodeId(r.citing_slug);
    if (r.cited_kind === "qnfo" || (r.cited_slug && ctx.nodes.has(paperNodeId(r.cited_slug)))) {
      const to = paperNodeId(r.cited_slug || r.cited_id || "");
      if (ctx.nodes.has(to) && ctx.nodes.get(to).status == null) citeEdges.push({ s: from, t: to, r: "CITES", w: 1, c: 1, ev: { internal: true } });
    } else if (r.cited_id && r.cited_kind) {
      const wid = "work:" + String(r.cited_kind).toLowerCase() + ":" + String(r.cited_id).toLowerCase();
      workNodes.set(wid, { id: wid, label: "ExternalWork", name: String(r.cited_title || r.cited_id).slice(0, 200), props: { kind: String(r.cited_kind).slice(0, 40), id: String(r.cited_id).slice(0, 200), url: String(r.cited_url || "").slice(0, 400) } });
      citeEdges.push({ s: from, t: wid, r: "CITES", w: 1, c: 1, ev: { kind: r.cited_kind } });
    }
  }
  rep.workNodes = await putNodes(ctx, SOURCES.lpCite, [...workNodes.values()]);
  rep.cites = await reconcileEdges(ctx, SOURCES.lpCite, citeEdges);
  return rep;
}

// -- worker-name index shared by the fleet, audit and mention phases ----------------------------------------------------------
export function workerIndex(ctx) {
  const names = [];
  for (const n of ctx.nodes.values()) if (n.label === "Worker" && n.id.startsWith("worker:") && n.status == null && !AMBIENT_WORKERS.has(n.id.slice(7))) names.push(n.id.slice(7));
  names.sort((a, b) => b.length - a.length);
  const hyphen = names.filter((n) => n.includes("-"));
  const rx = hyphen.length ? new RegExp("(?<![A-Za-z0-9_-])(" + hyphen.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Za-z0-9_-])", "g") : null;
  const all = new Set(names);
  return {
    names: all,
    // [{name, strong}]: strong = a code-task path or worker: reference (EXTRACTED), otherwise a hyphenated name in prose (INFERRED).
    find(text) {
      const out = new Map(); const t = String(text || "");
      for (const m of t.matchAll(/(?:path=|worker:|\b)([A-Za-z0-9][A-Za-z0-9_-]*)\/(?:worker\.js|wrangler\.toml)/g)) if (all.has(m[1])) out.set(m[1], true);
      for (const m of t.matchAll(/\bworker:([A-Za-z0-9][A-Za-z0-9_-]*)/g)) if (all.has(m[1])) out.set(m[1], true);
      if (rx) { rx.lastIndex = 0; for (const m of t.matchAll(rx)) if (!out.has(m[1])) out.set(m[1], false); }
      return [...out.entries()].map(([name, strong]) => ({ name, strong }));
    },
  };
}

export async function phaseFleet(ctx) {
  const rep = {};
  const wk = await ctx.graph.all("SELECT DISTINCT id, name FROM fg_node WHERE kind = 'worker'");
  if (!wk.length) return { skipped: "fg_node holds no worker rows (the fleet graph has not been built yet)" };
  const KIND = { d1: "Database", r2: "Bucket", vectorize: "VectorIndex", queue: "Queue", kv: "KVNamespace", custom_domain: "Domain", workflow: "Workflow", durable_object: "DurableObject" };
  const res = await ctx.graph.all("SELECT DISTINCT id, kind, name FROM fg_node WHERE kind IN ('d1', 'r2', 'vectorize', 'queue', 'kv', 'custom_domain', 'workflow', 'durable_object')");
  const nodes = wk.map((r) => ({ id: r.id, label: "Worker", name: r.name, props: { fg: r.id } }));
  const resIds = new Set(res.map((r) => r.id));
  for (const r of res) nodes.push({ id: r.id, label: KIND[r.kind], name: r.name, props: { fg: r.id, kind: r.kind } });
  const wids = new Set(wk.map((r) => r.id));
  const edges = [];
  for (const r of await ctx.graph.all("SELECT DISTINCT a.src AS w, b.dst AS d FROM fg_edge a JOIN fg_edge b ON b.src = a.dst AND b.scope = a.scope AND b.rel = 'binds' WHERE a.rel = 'has_binding'")) {
    if (!wids.has(r.w)) continue;
    if (resIds.has(r.d)) edges.push({ s: r.w, t: r.d, r: "BINDS", w: 1, c: 1 });
    else if (wids.has(r.d) && r.d !== r.w) edges.push({ s: r.w, t: r.d, r: "CALLS", w: 1, c: 1, ev: { via: "service-binding" } });
  }
  for (const r of await ctx.graph.all("SELECT n.worker AS w, e.dst AS d, MAX(CASE WHEN e.rel = 'http_calls' THEN 1 ELSE 0 END) AS hard FROM fg_edge e JOIN fg_node n ON n.id = e.src AND n.scope = e.scope WHERE e.rel IN ('http_calls', 'references') AND e.dst LIKE 'worker:%' AND n.worker IS NOT NULL GROUP BY n.worker, e.dst")) {
    const src = "worker:" + r.w;
    if (wids.has(src) && wids.has(r.d) && src !== r.d) edges.push({ s: src, t: r.d, r: "CALLS", w: 1, c: r.hard ? 1 : 0.7, ev: { via: r.hard ? "http" : "url-reference" } });
  }
  for (const r of await ctx.graph.all("SELECT DISTINCT src, rel, dst FROM fg_edge WHERE rel IN ('consumes', 'produces') AND src LIKE 'worker:%'")) if (wids.has(r.src) && resIds.has(r.dst)) edges.push({ s: r.src, t: r.dst, r: r.rel === "consumes" ? "CONSUMES" : "PRODUCES", w: 1, c: 1 });
  for (const r of await ctx.graph.all("SELECT DISTINCT src, dst FROM fg_edge WHERE rel = 'serves' AND src LIKE 'worker:%'")) {
    let dst = r.dst;
    if (dst.startsWith("route:")) { const m = dst.slice(6).match(/^([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})(?:[/*]|$)/); if (!m) continue; dst = "domain:" + m[1].toLowerCase(); if (!resIds.has(dst)) { nodes.push({ id: dst, label: "Domain", name: m[1].toLowerCase(), props: { fg: dst, via: "route" } }); resIds.add(dst); } }
    if (wids.has(r.src) && resIds.has(dst)) edges.push({ s: r.src, t: dst, r: "SERVES", w: 1, c: 1 });
  }
  rep.nodes = await putNodes(ctx, SOURCES.fleet, nodes, { close: "stale" });
  rep.edges = await reconcileEdges(ctx, SOURCES.fleet, edges);
  return rep;
}

const CODE_TASK_DIR = /code-task:\s*repo=[\w-]+\s+path=([A-Za-z0-9_-]+)\//;
const METRIC_TOKEN = /[a-z][a-z0-9]*_[a-z0-9_]{5,}/g;
// Audit entities become nodes only when they link to something: an Issue, FailureMode, Decision, Capability or Metric with no edge is an
// orphan the curator itself would have created (the first shadow run on 2026-11-05 made 800 of them before this rule).
export async function phaseAudit(ctx) {
  const idx = workerIndex(ctx), rep = {}, sets = {};
  const S = (src) => (sets[src] = sets[src] || { nodes: [], edges: [] });
  // A source whose query succeeded gets its set even when the result is empty: the last open issue closing must close its node and sweep its edge.
  const rows = async (src, sql) => { const r = await ctx.audit.all(sql); S(src); return r; };
  let metricKeys = new Set();
  const link = (src, from, text, rel, strongOnly, metricRel) => {
    const out = S(src).edges, t = String(text || "").replace(/repo=[\w-]+/g, " ");
    if (rel) for (const f of idx.find(t).filter((x) => !AMBIENT_WORKERS.has(x.name)).slice(0, 3)) { if (strongOnly && !f.strong) continue; out.push({ s: from, t: "worker:" + f.name, r: rel, w: f.strong ? 1 : 0.7, c: f.strong ? 1 : 0.7 }); }
    if (metricRel) { const seen = new Set(); for (const m of t.match(METRIC_TOKEN) || []) if (metricKeys.has(m) && !seen.has(m) && seen.size < 3) { seen.add(m); out.push({ s: from, t: "metric:" + m, r: metricRel, w: 0.7, c: 0.7 }); } }
  };
  try {
    const metrics = await rows(SOURCES.auditMetric, "SELECT metric, layer, kind, owner FROM metric_registry");
    metricKeys = new Set(metrics.map((m) => m.metric));
    const trig = await ctx.audit.all("SELECT metric_key, substr(action, 1, 1800) AS a FROM analytics_metric_triggers WHERE enabled = 1");
    for (const m of metrics) { S(SOURCES.auditMetric).nodes.push({ id: "metric:" + m.metric, label: "Metric", name: m.metric, props: { layer: m.layer, kind: m.kind, owner: m.owner || "" } }); link(SOURCES.auditMetric, "metric:" + m.metric, m.owner, "OWNED_BY", false); }
    for (const t of trig) { const mm = CODE_TASK_DIR.exec(t.a || ""); if (mm && idx.names.has(mm[1]) && !AMBIENT_WORKERS.has(mm[1]) && metricKeys.has(t.metric_key)) S(SOURCES.auditMetric).edges.push({ s: "metric:" + t.metric_key, t: "worker:" + mm[1], r: "LEVER_IN", w: 1, c: 1 }); }
    const prog = await rows(SOURCES.auditProgram, "SELECT program_code, objective, primary_metric, guard_metrics, paths FROM program_charters");
    for (const p of prog) {
      const pid = "program:" + p.program_code, P = S(SOURCES.auditProgram);
      P.nodes.push({ id: pid, label: "Program", name: p.program_code, props: { objective: String(p.objective || "").slice(0, 300) } });
      if (p.primary_metric && metricKeys.has(String(p.primary_metric).trim())) P.edges.push({ s: pid, t: "metric:" + String(p.primary_metric).trim(), r: "PRIMARY_METRIC", w: 1, c: 1 });
      for (const g of String(p.guard_metrics || "").split(/[,;\s]+/).filter((x) => metricKeys.has(x)).slice(0, 8)) P.edges.push({ s: pid, t: "metric:" + g, r: "GUARDED_BY", w: 1, c: 1 });
      link(SOURCES.auditProgram, pid, p.paths, "OWNS_PATH", true);
    }
    const goals = await rows(SOURCES.auditGoal, "SELECT goal_key, substr(statement, 1, 240) AS st, program_code, status FROM goals WHERE COALESCE(status, '') NOT IN ('retired', 'completed', 'closed')");
    for (const g of goals) { const G = S(SOURCES.auditGoal); G.nodes.push({ id: "goal:" + g.goal_key, label: "Goal", name: g.st || g.goal_key, props: { key: g.goal_key, status: g.status || "" } }); if (g.program_code) G.edges.push({ s: "goal:" + g.goal_key, t: "program:" + g.program_code, r: "PART_OF", w: 1, c: 1 }); }
  } catch (e) { rep.metricsError = String(e.message || e).slice(0, 200); }
  try {
    for (const f of await rows(SOURCES.auditFm, "SELECT fm_key, substr(failure_mode, 1, 300) AS fm, substr(COALESCE(blast_radius, ''), 1, 500) AS br, substr(COALESCE(remediation, ''), 1, 500) AS rem FROM failure_modes")) {
      S(SOURCES.auditFm).nodes.push({ id: "failure-mode:" + f.fm_key, label: "FailureMode", name: f.fm || f.fm_key, props: { key: f.fm_key } });
      link(SOURCES.auditFm, "failure-mode:" + f.fm_key, f.fm + " " + f.br + " " + f.rem, "AFFECTS", false, "ABOUT");
    }
  } catch (e) { rep.fmError = String(e.message || e).slice(0, 200); }
  try {
    for (const i of await rows(SOURCES.auditIssue, "SELECT id, substr(title, 1, 240) AS title, priority, category, substr(COALESCE(description, ''), 1, 1600) AS d FROM agent_issues WHERE status = 'open'")) {
      const id = "issue:" + i.id, I = S(SOURCES.auditIssue), before = I.edges.length, mm = CODE_TASK_DIR.exec(i.d);
      I.nodes.push({ id, label: "Issue", name: i.title, props: { id: i.id, priority: i.priority || "", category: i.category || "" } });
      if (mm && idx.names.has(mm[1]) && !AMBIENT_WORKERS.has(mm[1])) I.edges.push({ s: id, t: "worker:" + mm[1], r: "AFFECTS", w: 1, c: 1 });
      if (I.edges.length === before) link(SOURCES.auditIssue, id, i.title + " " + i.d, "AFFECTS", false);
      link(SOURCES.auditIssue, id, i.title, null, true, "ABOUT");
    }
  } catch (e) { rep.issueError = String(e.message || e).slice(0, 200); }
  try {
    for (const d of await rows(SOURCES.auditDecision, "SELECT id, substr(COALESCE(action, ''), 1, 200) AS action, substr(COALESCE(blast_radius, ''), 1, 500) AS br, ts FROM decision_log ORDER BY id DESC LIMIT 300")) {
      S(SOURCES.auditDecision).nodes.push({ id: "decisionlog:" + d.id, label: "Decision", name: d.action || ("decision " + d.id), props: { id: d.id, ts: d.ts || "" } });
      link(SOURCES.auditDecision, "decisionlog:" + d.id, d.action + " " + d.br, "AFFECTS", false, "ABOUT");
    }
    for (const c of await rows(SOURCES.auditCap, "SELECT capability, substr(COALESCE(provenance, ''), 1, 500) AS pr, substr(COALESCE(evidence, ''), 1, 500) AS ev FROM capability_ledger")) {
      S(SOURCES.auditCap).nodes.push({ id: "capability:" + c.capability, label: "Capability", name: c.capability, props: {} });
      link(SOURCES.auditCap, "capability:" + c.capability, c.pr + " " + c.ev, "PROVIDED_BY", false);
    }
  } catch (e) { rep.decisionError = String(e.message || e).slice(0, 200); }
  const linked = new Set(); for (const v of Object.values(sets)) for (const e of v.edges) { linked.add(e.s); linked.add(e.t); }
  rep.dropped = 0;
  for (const [src, v] of Object.entries(sets)) {
    const keep = v.nodes.filter((n) => linked.has(n.id)); rep.dropped += v.nodes.length - keep.length;
    const close = src === SOURCES.auditIssue ? "closed" : (src === SOURCES.auditGoal || src === SOURCES.auditFm || src === SOURCES.auditMetric ? "stale" : undefined);
    rep[src] = { nodes: await putNodes(ctx, src, keep, close ? { close } : {}) };
  }
  for (const [src, v] of Object.entries(sets)) rep[src].edges = await reconcileEdges(ctx, src, v.edges, src === SOURCES.auditDecision ? { sweep: false } : {});
  return rep;
}

// R2Object nodes carry the object key (papers/obsidian-<hash>.json, the same string living-paper keeps in papers.r2_key) and the paper's
// identifier (arxiv_id, the 16-hex hash in papers.identifier): a deterministic link, by key first.
export async function phaseArtifacts(ctx) {
  const lp = await loadLiving(ctx), byKey = new Map(lp.papers.filter((p) => p.r2_key).map((p) => [p.r2_key, p.slug])), byId = new Map(lp.papers.filter((p) => p.identifier).map((p) => [p.identifier, p.slug]));
  const rows = await ctx.graph.all("SELECT id, CASE WHEN json_valid(properties) THEN json_extract(properties, '$.r2_key') END AS k, CASE WHEN json_valid(properties) THEN json_extract(properties, '$.arxiv_id') END AS aid FROM nodes WHERE label = 'R2Object' AND status IS NULL");
  const edges = [];
  for (const r of rows) { const slug = byKey.get(r.k) || byId.get(r.aid); if (slug && lpActive(lp, slug)) edges.push({ s: paperNodeId(slug), t: r.id, r: "HAS_ARTIFACT", w: 1, c: 1, ev: { via: byKey.get(r.k) ? "r2_key" : "identifier" } }); }
  return { objects: rows.length, edges: await reconcileEdges(ctx, SOURCES.artifact, edges) };
}

// Papers name the vault's concepts, programs and people. The 68 Concept nodes, the programs and the people were authored by hand and
// connected to each other only; a paper that says "Bruhat-Tits tree" or "Spencer-Brown" now links to them (bridges the two islands).
export async function phasePaperConcepts(ctx) {
  const lp = await loadLiving(ctx), alias = new Map();
  const add = (a, id) => { const n = normName(String(a).replace(/\([^)]*\)/g, " ").replace(/^thread:\s*/i, "")); if (n.length < 7 || isGenericName(n) || /^(qnfo|qwav|living papers|publications|research|program|archive|hub)/.test(n) && n.split(" ").length < 2) return; if (!alias.has(n)) alias.set(n, new Set()); alias.get(n).add(id); };
  for (const n of ctx.nodes.values()) {
    if (n.status != null || n.source) continue;
    if (n.label === "Concept" || n.label === "Person") add(n.name, n.id);
    else if (n.label === "Program") { add(n.name, n.id); add(String(n.name).replace(/\s+Program$/i, ""), n.id); }
  }
  const anchors = [...alias.entries()].filter(([, ids]) => ids.size === 1).map(([a, ids]) => [" " + a + " ", [...ids][0], a]);
  const active = lp.papers.filter((p) => ACTIVE_LP.has(p.status) && ctx.nodes.has(paperNodeId(p.slug)) && ctx.nodes.get(paperNodeId(p.slug)).status == null);
  const found = new Map(), idToSlug = new Map(lp.papers.map((p) => [p.identifier, p.slug]));
  for (const group of chunks(active, 200)) {
    const rows = await ctx.living.all("SELECT identifier, title, substr(COALESCE(abstract, ''), 1, 1800) AS ab FROM papers WHERE identifier IN (" + inList(group.map((p) => p.identifier)) + ")");
    for (const r of rows) {
      r.slug = idToSlug.get(r.identifier);
      const text = " " + normName(r.title + " " + cleanForEmbedding(r.ab)) + " ";
      for (const [a, id, raw] of anchors) if (text.includes(a)) { if (!found.has(id)) found.set(id, []); found.get(id).push({ s: paperNodeId(r.slug), alias: raw }); }
    }
  }
  const edges = [], per = new Map(), hubs = [];
  for (const [id, list] of found) {
    if (list.length > 250) { hubs.push(id + " (" + list.length + ")"); continue; } // an anchor in a third of all papers separates nothing
    for (const m of list) { const n = per.get(m.s) || 0; if (n >= 8) continue; per.set(m.s, n + 1); edges.push({ s: m.s, t: id, r: "MENTIONS", w: 0.8, c: 0.8, ev: { alias: m.alias } }); }
  }
  return { anchors: anchors.length, papers: active.length, hubsDropped: hubs.slice(0, 8), edges: await reconcileEdges(ctx, SOURCES.concept, edges) };
}

export async function phaseMentions(ctx) {
  const idx = workerIndex(ctx);
  // Aliases: hyphenated workers, domains, program codes and names, phase numbers; an alias that names two anchors is dropped.
  const alias = new Map(), add = (a, id) => { const n = normName(a); if (n.length < 5 || isGenericName(n) || /^(qnfo|qwav|research|program|phase)$/.test(n)) return; if (!alias.has(n)) alias.set(n, new Set()); alias.get(n).add(id); };
  for (const n of idx.names) if (n.includes("-")) add(n, "worker:" + n);
  for (const n of ctx.nodes.values()) {
    if (n.status != null) continue;
    if (n.label === "Domain" && n.id.startsWith("domain:")) add(n.name, n.id);
    else if (n.label === "Program" && !n.source) { add(n.name, n.id); const code = /^((?:QNFO|QWAV)\.[A-Z]{2,4})\b/.exec(n.name || ""); if (code) add(code[1], n.id); add(String(n.name).replace(/\s+Program$/i, ""), n.id); }
    else if (n.label === "Phase" && !n.source) { const ph = /^(Phase \d+)\b/i.exec(n.name || ""); if (ph) add(ph[1], n.id); }
  }
  const anchors = [...alias.entries()].filter(([, ids]) => ids.size === 1).map(([a, ids]) => [" " + a + " ", [...ids][0]]);
  const rows = await ctx.graph.all("SELECT id, name, substr(properties, 1, 1200) AS p FROM nodes WHERE source IS NULL AND status IS NULL AND label NOT IN ('Note', 'Paper', 'Tag', 'Category', 'ExternalWork')");
  const found = new Map(); // alias id -> [{s, a}]
  for (const r of rows) {
    const text = " " + normName((r.name || "") + " " + (r.p || "")) + " ";
    for (const [a, id] of anchors) { if (id === r.id) continue; if (text.includes(a)) { if (!found.has(a)) found.set(a, []); found.get(a).push({ s: r.id, id, a: a.trim() }); } }
  }
  // Hub guard: an alias that matches more than 60 nodes (a domain such as qnfo.org) says nothing about any one of them.
  const edges = [], perNode = new Map(), hubs = [];
  for (const [a, list] of found) {
    if (list.length > (list[0].id.startsWith("domain:") ? 60 : 400)) { hubs.push(a.trim() + " (" + list.length + ")"); continue; }
    for (const m of list) { const n = perNode.get(m.s) || 0; if (n >= 6) continue; perNode.set(m.s, n + 1); edges.push({ s: m.s, t: m.id, r: "MENTIONS", w: 0.7, c: 0.7, ev: { alias: m.a } }); }
  }
  return { anchors: anchors.length, scanned: rows.length, hubAliasesDropped: hubs.slice(0, 10), edges: await reconcileEdges(ctx, SOURCES.mention, edges) };
}

export async function phaseCoupling(ctx) {
  const lp = await loadLiving(ctx);
  const refs = new Map(); // citing node -> Set(cited key)
  for (const r of lp.cites) {
    const from = paperNodeId(r.citing_slug); const n = ctx.nodes.get(from);
    if (!lpActive(lp, r.citing_slug) || !n || n.status != null) continue;
    const key = r.cited_kind === "qnfo" ? paperNodeId(r.cited_slug || r.cited_id || "") : r.cited_id ? "work:" + String(r.cited_kind).toLowerCase() + ":" + String(r.cited_id).toLowerCase() : null;
    if (!key) continue;
    if (!refs.has(from)) refs.set(from, new Set()); refs.get(from).add(key);
  }
  const N = refs.size, df = new Map();
  for (const set of refs.values()) for (const k of set) df.set(k, (df.get(k) || 0) + 1);
  const idf = (k) => Math.log((N + 1) / (df.get(k) || 1));
  const norm = new Map(); for (const [p, set] of refs) { let s = 0; for (const k of set) s += idf(k) ** 2; norm.set(p, Math.sqrt(s) || 1); }
  const inv = new Map(); for (const [p, set] of refs) for (const k of set) { if (!inv.has(k)) inv.set(k, []); inv.get(k).push(p); }
  const pair = new Map();
  for (const [k, citers] of inv) {
    if (citers.length < 2 || citers.length > 40) continue;
    const x = idf(k) ** 2;
    for (let i = 0; i < citers.length; i++) for (let j = i + 1; j < citers.length; j++) {
      const a = citers[i] < citers[j] ? citers[i] : citers[j], b = citers[i] < citers[j] ? citers[j] : citers[i], pk = a + EK + b;
      const e = pair.get(pk) || { a, b, dot: 0, shared: 0, minDf: 1e9 }; e.dot += x; e.shared++; e.minDf = Math.min(e.minDf, citers.length); pair.set(pk, e);
    }
  }
  const cand = [];
  for (const e of pair.values()) {
    const wt = e.dot / (norm.get(e.a) * norm.get(e.b));
    const ok = e.shared >= 2 || (e.shared === 1 && e.minDf === 2 && refs.get(e.a).size <= 30 && refs.get(e.b).size <= 30);
    if (ok && wt >= 0.15) cand.push({ a: e.a, b: e.b, wt, shared: e.shared });
  }
  const per = new Map(), keep = new Set(), sorted = cand.sort((x, y) => y.wt - x.wt);
  for (const e of sorted) for (const p of [e.a, e.b]) { const c = per.get(p) || []; if (c.length < 6) { c.push(e); per.set(p, c); keep.add(e); } }
  const edges = [...keep].map((e) => ({ s: e.a, t: e.b, r: "COUPLED_WITH", w: e.wt, c: Math.min(1, e.wt), ev: { shared: e.shared } }));
  return { citingPapers: N, pairs: pair.size, edges: await reconcileEdges(ctx, SOURCES.coupling, edges) };
}

// -- semantic similarity ---------------------------------------------------------------------------------------------------
export async function phaseSemantic(ctx) {
  if (!ctx.embed) return { skipped: "no embedder (no Workers AI access in this run)" };
  if (ctx.dryRun) return { skipped: "a dry run does not embed (nothing would be stored)" };
  const lp = await loadLiving(ctx), rep = {};
  const eligible = lp.papers.filter((p) => ACTIVE_LP.has(p.status) && ctx.nodes.has(paperNodeId(p.slug)) && ctx.nodes.get(paperNodeId(p.slug)).status == null);
  const meta = new Map(lp.papers.map((r) => [r.slug, r])), idToSlug = new Map(lp.papers.map((p) => [p.identifier, p.slug]));
  const stored = new Map((await ctx.graph.all("SELECT slug, h FROM kg_embed WHERE model = " + lit(EMBED_MODEL))).map((r) => [r.slug, r.h]));
  const noTextMap = getState(ctx, "noText", {}), recent = new Date(Date.parse(ctx.now) - 7 * 86400000).toISOString().slice(0, 10); // a paper with no usable text is retried after a week
  const todo = eligible.filter((p) => { const m = meta.get(p.slug); return m && p.identifier && stored.get(p.slug) !== sha(EMBED_MODEL + "|" + (m.updated_at || "") + "|" + (m.version || "")).slice(0, 12) && !(noTextMap[p.slug] && noTextMap[p.slug] > recent); });
  const batchCap = ctx.maxEmbed;
  let embedded = 0, noText = 0;
  for (const group of chunks(todo.slice(0, batchCap), 25)) {
    const rows = (await ctx.living.all("SELECT identifier, title, substr(abstract, 1, 3500) AS ab, CASE WHEN length(COALESCE(abstract, '')) < 400 THEN substr(body_md, 1, 3500) END AS body FROM papers WHERE identifier IN (" + inList(group.map((p) => p.identifier)) + ")")).map((r) => Object.assign(r, { slug: idToSlug.get(r.identifier) }));
    const texts = [], slugs = [];
    for (const r of rows) { const t = embeddingText(r.title, r.ab, r.body); if (!t) { noTextMap[r.slug] = ctx.now.slice(0, 10); noText++; } else { texts.push(t); slugs.push(r.slug); } }
    if (!texts.length) continue;
    const vecs = await ctx.embed(texts);
    const tuples = [];
    for (let i = 0; i < slugs.length; i++) {
      const m = meta.get(slugs[i]), { q, sc } = quantize(vecs[i]);
      tuples.push("(" + [slugs[i], sha(EMBED_MODEL + "|" + (m.updated_at || "") + "|" + (m.version || "")).slice(0, 12), EMBED_MODEL, q, sc, ctx.now].map(lit).join(", ") + ")");
    }
    await runMany(ctx, insertBatches("INSERT OR REPLACE INTO kg_embed (slug, h, model, q, sc, updated_at) VALUES ", tuples, "", 60000, 60));
    bump(ctx, tuples.length); embedded += tuples.length;
  }
  if (noText) await setState(ctx, "noText", noTextMap);
  rep.embedded = embedded; rep.noText = noText; rep.pending = Math.max(0, todo.length - embedded - noText);
  // Load every stored vector (about 1 KB each) and compare in memory.
  const vecRows = await ctx.graph.all("SELECT slug, q, sc FROM kg_embed WHERE model = " + lit(EMBED_MODEL));
  const okSlug = new Set(eligible.map((p) => p.slug));
  const items = []; for (const r of vecRows) if (okSlug.has(r.slug)) items.push({ slug: r.slug, id: paperNodeId(r.slug), v: dequantize(r.q, r.sc) });
  rep.vectors = items.length; rep.eligible = eligible.length;
  if (items.length < 10) return Object.assign(rep, { skipped: "fewer than 10 vectors" });
  // Primary category per paper (for the null and for the agreement check).
  const cat = new Map(); for (const r of lp.cats) cat.set(r.slug, r.category);
  // Null distribution: cosines between papers of different primary categories (a proxy for unrelated).
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const nulls = [];
  for (let k = 0; k < 4000 && nulls.length < 1500; k++) { const a = items[Math.floor(rnd() * items.length)], b = items[Math.floor(rnd() * items.length)]; if (a === b) continue; const ca = cat.get(a.slug), cb = cat.get(b.slug); if (ca && cb && ca !== cb) nulls.push(dot(a.v, b.v)); }
  const mu = nulls.length ? nulls.reduce((s, x) => s + x, 0) / nulls.length : 0.55, sd = nulls.length > 1 ? Math.sqrt(nulls.reduce((s, x) => s + (x - mu) ** 2, 0) / (nulls.length - 1)) : 0.05;
  const adjust = Math.max(-0.05, Math.min(0.05, getState(ctx, "simAdjust", 0)));
  const cutoff = Math.max(0.7, Math.min(0.92, mu + 3.09 * sd + adjust));
  rep.null = { n: nulls.length, mean: round(mu, 3), sd: round(sd, 3) }; rep.cutoff = round(cutoff, 3); rep.adjust = adjust;
  // Top-K per paper above the cutoff (n is a few hundred papers, so all pairs are compared: about 0.3 s for 850 x 768).
  const K = 8, top = new Map(), floor = Math.max(0.72, cutoff - 0.08);
  for (const it of items) top.set(it.id, []);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const c = dot(items[i].v, items[j].v);
    if (c < floor) continue;
    top.get(items[i].id).push({ id: items[j].id, c }); top.get(items[j].id).push({ id: items[i].id, c });
  }
  for (const [id, arr] of top) { arr.sort((x, y) => y.c - x.c || (x.id < y.id ? -1 : 1)); top.set(id, arr.slice(0, K)); }
  // Tie guard: four or more neighbours at one identical score mean identical text (a stub or a copied paper), not similarity.
  const degenerate = new Set();
  for (const [id, arr] of top) { const tally = new Map(); for (const x of arr) { const k = x.c.toFixed(5); tally.set(k, (tally.get(k) || 0) + 1); } for (const [k, cnt] of tally) if (cnt >= 4) degenerate.add(id + "|" + k); }
  // Accept a pair when both list each other (mutual kNN) or when either ranks the other in its top two; each pair once.
  const pairs = new Map();
  for (const [id, arr] of top) arr.forEach((x, rank) => {
    if (degenerate.has(id + "|" + x.c.toFixed(5))) return;
    const a = id < x.id ? id : x.id, b = id < x.id ? x.id : id, k = a + EK + b, e = pairs.get(k) || { a, b, c: x.c, ra: 99, rb: 99 };
    if (id === a) e.ra = Math.min(e.ra, rank); else e.rb = Math.min(e.rb, rank);
    pairs.set(k, e);
  });
  const cand = [...pairs.values()].map((e) => Object.assign(e, { mutual: e.ra < 99 && e.rb < 99 })).filter((e) => e.c >= cutoff && (e.mutual || Math.min(e.ra, e.rb) < 2)).sort((x, y) => y.c - x.c);
  const deg = new Map(), edges = [], CAP = 12;
  for (const e of cand) {
    if ((deg.get(e.a) || 0) >= CAP || (deg.get(e.b) || 0) >= CAP) continue;
    deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1);
    edges.push({ s: e.a, t: e.b, r: e.c >= 0.985 ? "NEAR_DUPLICATE" : "SIMILAR_TO", w: e.c, c: e.c, ev: { cos: round(e.c, 4), mutual: e.mutual, cutoff: round(cutoff, 3), model: "bge-base-en-v1.5" } });
  }
  // Rescue (mutual-kNN leaves nodes alone: Ozaki 2011 adds a spanning link): a paper with no edge yet gets its single best neighbour above the floor.
  let rescued = 0;
  for (const it of items) {
    if (deg.get(it.id)) continue;
    const best = (top.get(it.id) || []).find((x) => !degenerate.has(it.id + "|" + x.c.toFixed(5)) && (deg.get(x.id) || 0) < CAP);
    if (!best) continue;
    const a = it.id < best.id ? it.id : best.id, b = it.id < best.id ? best.id : it.id;
    deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); rescued++;
    edges.push({ s: a, t: b, r: "SIMILAR_TO", w: best.c, c: round(best.c * 0.9, 4), ev: { cos: round(best.c, 4), rescue: true, floor: round(floor, 3), model: "bge-base-en-v1.5" } });
  }
  rep.rescued = rescued; rep.degenerateGroups = degenerate.size; rep.candidates = cand.length;
  const partial = items.length < 0.7 * eligible.length;
  rep.edges = await reconcileEdges(ctx, SOURCES.semantic, edges, { sweep: !partial });
  if (partial) rep.edges.guard = (rep.edges.guard ? rep.edges.guard + "; " : "") + "partial: " + items.length + " of " + eligible.length + " papers embedded, no sweep";
  // Precision proxy: share of SIMILAR_TO edges whose endpoints share a primary category; tune the cutoff by it, bounded.
  let n = 0, agree = 0;
  for (const e of edges) { if (e.r !== "SIMILAR_TO" || (e.ev && e.ev.rescue)) continue; const ca = cat.get(e.s.slice(6)), cb = cat.get(e.t.slice(6)); if (!ca || !cb) continue; n++; if (ca === cb) agree++; }
  rep.categoryAgreement = n >= 40 ? round(agree / n, 3) : null; rep.agreementN = n;
  ctx.agreement = rep.categoryAgreement;
  if (n >= 40) {
    let adj = adjust; if (agree / n < 0.6) adj = Math.min(0.05, adj + 0.01); else if (agree / n > 0.85 && edges.length < eligible.length) adj = Math.max(-0.05, adj - 0.01);
    if (adj !== adjust) await setState(ctx, "simAdjust", adj);
  }
  return rep;
}

// -- entity resolution -----------------------------------------------------------------------------------------------------
export function dupGroups(ctx) {
  const groups = new Map();
  const deg = new Map(); for (const e of ctx.edges.values()) if (isActiveEdge(e) && e.r !== "SAME_AS") { deg.set(e.s, (deg.get(e.s) || 0) + 1); deg.set(e.t, (deg.get(e.t) || 0) + 1); }
  for (const n of ctx.nodes.values()) {
    if (n.label === "Note" || n.label === "Tag" || n.label === "Category" || n.label === "Issue") continue;
    const norm = normName(n.name); if (isGenericName(norm)) continue;
    if (n.label === "Paper" && norm.length < 12) continue;
    const k = familyOf(n.label) + EK + norm;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  const out = [];
  for (const [k, list] of groups) {
    if (list.length < 2 || list.length > 10) continue;
    const score = (n) => (deg.get(n.id) || 0) + (/_DEPRECATED$/.test(n.label) ? 0 : 5) + (n.status == null ? 5 : 0) + (n.source ? 0 : 1);
    list.sort((a, b) => score(b) - score(a) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || (a.id < b.id ? -1 : 1));
    out.push({ key: k, canonical: list[0], dups: list.slice(1) });
  }
  return out;
}
export async function phaseEntities(ctx) {
  const groups = dupGroups(ctx), edges = [], canon = new Map();
  for (const g of groups) for (const d of g.dups) {
    const sameLabel = d.label === g.canonical.label;
    edges.push({ s: d.id, t: g.canonical.id, r: "SAME_AS", w: sameLabel ? 1 : 0.8, c: g.canonical.label === "Paper" ? 0.7 : (sameLabel ? 0.9 : 0.8), ev: { norm: g.key.split(EK)[1].slice(0, 80) } });
    if (d.canonical_id !== g.canonical.id) canon.set(d.id, g.canonical.id);
  }
  const rep = { groups: groups.length, edges: await reconcileEdges(ctx, SOURCES.er, edges), canonicalSet: canon.size };
  const stillDup = new Set(groups.flatMap((g) => g.dups.map((d) => d.id)));
  const cleared = [...ctx.nodes.values()].filter((n) => n.canonical_id && !stillDup.has(n.id)).map((n) => n.id);
  for (const part of chunks(cleared, 150)) { await w(ctx, "UPDATE nodes SET canonical_id = NULL WHERE id IN (" + inList(part) + ")", part.length); for (const id of part) ctx.nodes.get(id).canonical_id = null; }
  const byCanon = new Map(); for (const [id, c] of canon) { if (!byCanon.has(c)) byCanon.set(c, []); byCanon.get(c).push(id); }
  for (const [c, ids] of byCanon) for (const part of chunks(ids, 150)) { await w(ctx, "UPDATE nodes SET canonical_id = " + lit(c) + " WHERE id IN (" + inList(part) + ")", part.length); for (const id of part) ctx.nodes.get(id).canonical_id = c; }
  return rep;
}

// -- prune -----------------------------------------------------------------------------------------------------------------
export async function phasePrune(ctx) {
  const rep = { selfLoops: 0, dangling: 0, staleEdges: 0, junkPapers: 0, ghosts: 0, deprecatedOrphans: 0, kgOrphans: 0 };
  const day = 86400000, nowMs = Date.parse(ctx.now);
  const old = (iso, days) => { const t = Date.parse(String(iso || "").replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) ? "" : "Z")); return Number.isFinite(t) && nowMs - t > days * day; };
  // 1. self-loops, any source (they carry no information and distort degree).
  rep.selfLoops = await deleteRows(ctx, "edge", [...ctx.edges.values()].filter((e) => e.s === e.t).map((e) => e.id), "self-loop");
  // 2. dangling edges (the foreign key normally prevents them; a restored backup or a writer with the pragma off would not).
  rep.dangling = await deleteRows(ctx, "edge", [...ctx.edges.values()].filter((e) => !ctx.nodes.has(e.s) || !ctx.nodes.has(e.t)).map((e) => e.id), "dangling");
  // 3. stale edges older than the grace period.
  rep.staleEdges = await deleteRows(ctx, "edge", [...ctx.edges.values()].filter((e) => e.status === "stale" && old(e.inv, STALE_DELETE_DAYS)).map((e) => e.id), "stale > " + STALE_DELETE_DAYS + " days");
  // Degree for pruning ignores SAME_AS: a duplicate link must not keep a placeholder alive.
  const degree = new Map(); for (const e of ctx.edges.values()) if (e.r !== "SAME_AS") { degree.set(e.s, (degree.get(e.s) || 0) + 1); degree.set(e.t, (degree.get(e.t) || 0) + 1); }
  const dropNodes = async (ids, reason) => {
    const set = new Set(ids), same = [...ctx.edges.values()].filter((e) => e.r === "SAME_AS" && (set.has(e.s) || set.has(e.t))).map((e) => e.id);
    await deleteRows(ctx, "edge", same, reason + " (its SAME_AS links)");
    return deleteRows(ctx, "node", ids, reason);
  };
  // 4. placeholder Paper nodes: "archive-record-<n>" named by a URL, no edge, no content (457 on 2026-11-05).
  rep.junkPapers = await dropNodes([...ctx.nodes.values()].filter((n) => n.label === "Paper" && ((/^archive-record-/.test(n.id) && /^https?:/i.test(n.name || "")) || /^archive record \d+$/i.test(n.name || "")) && !degree.get(n.id)).map((n) => n.id).slice(0, 500), "placeholder archive-record Paper node without edges");
  // 4b. ghost papers (not in living-paper, no authored edge) once they have waited 30 days without any link.
  rep.ghosts = await dropNodes([...ctx.nodes.values()].filter((n) => n.label === "Paper" && n.status === "ghost" && !degree.get(n.id) && old(n.updated_at, 30)).map((n) => n.id).slice(0, 300), "ghost paper node: no living-paper row and no edge for 30 days");
  // 5. *_DEPRECATED nodes with no edge, untouched for 30 days.
  rep.deprecatedOrphans = await dropNodes([...ctx.nodes.values()].filter((n) => /_DEPRECATED$/.test(n.label) && !degree.get(n.id) && old(n.updated_at || n.created_at, 30)).map((n) => n.id).slice(0, 200), "deprecated-label node without edges");
  // 6. nodes a source created that no longer have any edge, after the grace period.
  rep.kgOrphans = await dropNodes([...ctx.nodes.values()].filter((n) => n.source && String(n.source).startsWith("kg:") && !degree.get(n.id) && n.status !== null && old(n.updated_at, STALE_DELETE_DAYS)).map((n) => n.id).slice(0, 200), "source node without edges after grace");
  return rep;
}

// -- analytics -------------------------------------------------------------------------------------------------------------
export function computeGraph(ctx) {
  const act = []; for (const n of ctx.nodes.values()) if (n.status == null) act.push(n);
  const ids = new Set(act.map((n) => n.id)), idx = new Map(act.map((n, i) => [n.id, i]));
  const adj = act.map(() => []), sem = act.map(() => []), parent = act.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  let nEdges = 0, nSem = 0;
  for (const e of ctx.edges.values()) {
    if (!isActiveEdge(e) || !ids.has(e.s) || !ids.has(e.t)) continue;
    const a = idx.get(e.s), b = idx.get(e.t); nEdges++;
    adj[a].push({ n: b, r: e.r, w: e.w == null ? 1 : e.w }); adj[b].push({ n: a, r: e.r, w: e.w == null ? 1 : e.w });
    parent[find(a)] = find(b);
    if (!STRUCTURAL.has(e.r)) { nSem++; sem[a].push({ n: b, r: e.r, w: e.w == null ? 1 : e.w }); sem[b].push({ n: a, r: e.r, w: e.w == null ? 1 : e.w }); }
  }
  const comp = act.map((_, i) => find(i)), size = new Map(); for (const c of comp) size.set(c, (size.get(c) || 0) + 1);
  return { act, idx, adj, sem, comp, size, nEdges, nSem };
}
export function pagerank(sem, iters = 40, d = 0.85) {
  const n = sem.length; if (!n) return [];
  let pr = new Float64Array(n).fill(1 / n);
  const out = sem.map((l) => l.reduce((s, x) => s + x.w, 0));
  for (let it = 0; it < iters; it++) {
    const nx = new Float64Array(n).fill((1 - d) / n); let dang = 0;
    for (let i = 0; i < n; i++) { if (!out[i]) { dang += pr[i]; continue; } for (const x of sem[i]) nx[x.n] += d * pr[i] * x.w / out[i]; }
    const add = d * dang / n; for (let i = 0; i < n; i++) nx[i] += add;
    pr = nx;
  }
  return pr;
}
export function communities(act, sem, ids) {
  const rel = new Set(["CITES", "SIMILAR_TO", "COUPLED_WITH"]), label = act.map((_, i) => i), order = ids.slice().sort((a, b) => (act[a].id < act[b].id ? -1 : 1));
  for (let it = 0; it < 15; it++) {
    let changed = 0;
    for (const i of order) {
      const tally = new Map();
      for (const x of sem[i]) if (rel.has(x.r) && act[x.n].label === "Paper") tally.set(label[x.n], (tally.get(label[x.n]) || 0) + x.w);
      if (!tally.size) continue;
      let best = label[i], bw = -1; for (const [l, wt] of [...tally.entries()].sort((a, b) => a[0] - b[0])) if (wt > bw) { best = l; bw = wt; }
      if (best !== label[i]) { label[i] = best; changed++; }
    }
    if (!changed) break;
  }
  // Split each label into connected parts so a community is always connected.
  const seen = new Set(), out = new Map();
  for (const i of order) {
    if (seen.has(i)) continue; seen.add(i);
    const q = [i], members = [i];
    while (q.length) { const c = q.pop(); for (const x of sem[c]) if (rel.has(x.r) && !seen.has(x.n) && label[x.n] === label[i] && act[x.n].label === "Paper") { seen.add(x.n); q.push(x.n); members.push(x.n); } }
    for (const m of members) out.set(m, members);
  }
  return out;
}
export async function phaseAnalytics(ctx) {
  const g = computeGraph(ctx), n = g.act.length, rep = {};
  const deg = g.adj.map((l) => l.length), degSem = g.sem.map((l) => l.length);
  const orphans = deg.filter((d) => d === 0).length;
  let giant = 0; for (const s of g.size.values()) if (s > giant) giant = s;
  // The Note vault (metadata of a local Obsidian vault, no bodies in the fleet) is one island by construction; the headline connectivity
  // is measured without it, and notes_bridged says how many notes link to anything outside the vault.
  const isNote = g.act.map((x) => x.label === "Note"), nonNote = isNote.filter((x) => !x).length, compNon = new Map();
  g.act.forEach((x, i) => { if (!isNote[i]) compNon.set(g.comp[i], (compNon.get(g.comp[i]) || 0) + 1); });
  let giantNon = 0; for (const c of compNon.values()) if (c > giantNon) giantNon = c;
  const notesBridged = g.act.filter((x, i) => isNote[i] && g.adj[i].some((e) => e.r !== "CONTAINS" && e.r !== "LINKS_TO")).length;
  const orphansByLabel = {}; g.act.forEach((x, i) => { if (!deg[i]) orphansByLabel[x.label] = (orphansByLabel[x.label] || 0) + 1; });
  const papers = g.act.map((x, i) => [x, i]).filter(([x]) => x.label === "Paper");
  const unrelated = papers.filter(([, i]) => !g.sem[i].some((x) => CONTENT_RELS.has(x.r))).length;
  const groups = dupGroups(ctx), unresolved = groups.filter((gr) => gr.dups.some((d) => d.canonical_id !== gr.canonical.id)).length;
  const stale = [...ctx.edges.values()].filter((e) => e.status === "stale").length;
  const srcCount = {}; for (const e of ctx.edges.values()) if (isActiveEdge(e)) { const k = e.source || "legacy"; srcCount[k] = (srcCount[k] || 0) + 1; }
  const semByRel = {}; for (const e of ctx.edges.values()) if (isActiveEdge(e)) semByRel[e.r] = (semByRel[e.r] || 0) + 1;
  const health = {
    nodes_total: ctx.nodes.size, nodes_active: n, edges_active: g.nEdges, edges_stale: stale, edges_non_structural: g.nSem,
    orphans, orphan_share: n ? round(100 * orphans / n, 2) : 0, components: g.size.size, giant_component_share: nonNote ? round(100 * giantNon / nonNote, 2) : 0, giant_component_share_all: n ? round(100 * giant / n, 2) : 0, notes_total: isNote.filter(Boolean).length, notes_bridged: notesBridged,
    orphans_by_label: Object.fromEntries(Object.entries(orphansByLabel).sort((a, b) => b[1] - a[1]).slice(0, 12)),
    edge_density: n ? round(g.nEdges / n, 3) : 0, non_structural_density: n ? round(g.nSem / n, 3) : 0,
    papers_active: papers.length, paper_unrelated_share: papers.length ? round(100 * unrelated / papers.length, 2) : 0,
    dup_groups: groups.length, dup_groups_unresolved: unresolved, sim_category_agreement: ctx.agreement == null ? null : round(100 * ctx.agreement, 1),
    by_source: srcCount, by_relationship: Object.fromEntries(Object.entries(semByRel).sort((a, b) => b[1] - a[1]).slice(0, 25)),
    tombstones_total: null,
  };
  rep.health = health;
  const pr = pagerank(g.sem), compOf = new Map(), cs = [...g.size.entries()].sort((a, b) => b[1] - a[1]).map(([c], i) => [c, i + 1]); for (const [c, i] of cs) compOf.set(c, i);
  const paperIdx = papers.map(([, i]) => i), comm = communities(g.act, g.sem, paperIdx);
  const commLabel = new Map();
  for (const members of new Set(comm.values())) { let best = members[0]; for (const m of members) if (pr[m] > pr[best] || (pr[m] === pr[best] && g.act[m].id < g.act[best].id)) best = m; for (const m of members) commLabel.set(m, members.length > 1 ? g.act[best].id : null); }
  rep.communities = new Set([...commLabel.values()].filter(Boolean)).size;
  // kg_node_stats: nodes with a semantic edge, plus every Paper; written as a diff.
  const prev = new Map((await ctx.graph.all("SELECT node_id, degree, deg_sem, pagerank, component, community FROM kg_node_stats")).map((r) => [r.node_id, r]));
  const want = new Map();
  for (let i = 0; i < n; i++) { const x = g.act[i]; if (degSem[i] > 0 || x.label === "Paper") want.set(x.id, { degree: deg[i], deg_sem: degSem[i], pagerank: +(pr[i] * n).toFixed(4), component: compOf.get(g.comp[i]) || 0, community: commLabel.get(i) || null }); }
  const tuples = [];
  for (const [id, v] of want) { const p = prev.get(id); if (p && p.degree === v.degree && p.deg_sem === v.deg_sem && Math.abs((p.pagerank || 0) - v.pagerank) < 0.01 && p.component === v.component && (p.community || null) === v.community) continue; tuples.push("(" + [id, v.degree, v.deg_sem, v.pagerank, v.component, v.community, ctx.now].map(lit).join(", ") + ")"); }
  await runMany(ctx, insertBatches("INSERT OR REPLACE INTO kg_node_stats (node_id, degree, deg_sem, pagerank, component, community, updated_at) VALUES ", tuples, "", 60000, 200));
  bump(ctx, tuples.length); rep.statsWritten = tuples.length;
  const gone = [...prev.keys()].filter((id) => !want.has(id));
  for (const c of chunks(gone, 150)) await w(ctx, "DELETE FROM kg_node_stats WHERE node_id IN (" + inList(c) + ")", c.length);
  // Gaps: papers that relate to nothing, bridges between communities, and link candidates (Adamic-Adar over paper neighbours).
  const gaps = new Map(), gid = (k, s) => k + ":" + s;
  for (const [x, i] of papers) if (!g.sem[i].some((e) => CONTENT_RELS.has(e.r))) gaps.set(gid("isolated-paper", x.id), { kind: "isolated-paper", subject: x.id, score: 1, detail: { name: String(x.name).slice(0, 120) } });
  const pn = (i) => g.sem[i].filter((e) => CONTENT_RELS.has(e.r) && g.act[e.n].label === "Paper").map((e) => e.n);
  const bridges = [];
  for (const [x, i] of papers) { const cs2 = new Set(pn(i).map((j) => commLabel.get(j)).filter(Boolean)); if (cs2.size >= 3) bridges.push({ x, c: cs2.size, p: pr[i] }); }
  bridges.sort((a, b) => b.c - a.c || b.p - a.p); for (const b of bridges.slice(0, 25)) gaps.set(gid("bridge-paper", b.x.id), { kind: "bridge-paper", subject: b.x.id, score: b.c, detail: { name: String(b.x.name).slice(0, 120), communities: b.c } });
  const aa = new Map();
  for (const [, i] of papers) { const nb = pn(i); if (nb.length < 2 || nb.length > 15) continue; const wgt = 1 / Math.log(2 + nb.length); for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) { const lo = Math.min(nb[a], nb[b]), hi = Math.max(nb[a], nb[b]), k = lo + "," + hi; aa.set(k, (aa.get(k) || 0) + wgt); } }
  const linked = new Set(); for (const [, i] of papers) for (const j of pn(i)) linked.add(Math.min(i, j) + "," + Math.max(i, j));
  const cand = [...aa.entries()].filter(([k]) => !linked.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 40);
  for (const [k, sc] of cand) { const [a, b] = k.split(",").map(Number); gaps.set(gid("link-candidate", g.act[a].id + "|" + g.act[b].id), { kind: "link-candidate", subject: g.act[a].id + "|" + g.act[b].id, score: round(sc, 3), detail: { a: String(g.act[a].name).slice(0, 100), b: String(g.act[b].name).slice(0, 100) } }); }
  const oldGaps = new Map((await ctx.graph.all("SELECT id, status, first_seen, score, detail FROM kg_gap")).map((r) => [r.id, r]));
  const gt = [];
  for (const [id, v] of gaps) {
    const o = oldGaps.get(id), detail = JSON.stringify(v.detail).slice(0, 400);
    if (o && o.status === "open" && o.detail === detail && Math.abs((o.score || 0) - v.score) < 0.0005) continue; // an unchanged gap is not rewritten
    gt.push("(" + [id, v.kind, v.subject, detail, v.score, "open", o ? o.first_seen : ctx.now, ctx.now].map(lit).join(", ") + ")");
  }
  await runMany(ctx, insertBatches("INSERT OR REPLACE INTO kg_gap (id, kind, subject, detail, score, status, first_seen, last_seen) VALUES ", gt, "", 60000, 150));
  const closed = [...oldGaps.keys()].filter((id) => !gaps.has(id) && oldGaps.get(id).status === "open");
  for (const c of chunks(closed, 150)) await w(ctx, "UPDATE kg_gap SET status = 'resolved', last_seen = " + lit(ctx.now) + " WHERE id IN (" + inList(c) + ")", c.length);
  bump(ctx, gt.length); rep.gaps = { open: gaps.size, resolved: closed.length };
  ctx.health = health;
  return rep;
}

// -- publish -----------------------------------------------------------------------------------------------------------------
export const METRICS = {
  kg_orphan_share: (h) => h.orphan_share, kg_giant_component_share: (h) => h.giant_component_share, kg_paper_unrelated_share: (h) => h.paper_unrelated_share,
  kg_edge_density: (h) => h.edge_density, kg_duplicate_groups_unresolved: (h) => h.dup_groups_unresolved, kg_sim_category_agreement: (h) => h.sim_category_agreement,
};
export async function phasePublish(ctx, ok, detail) {
  const rep = {};
  const h = ctx.health;
  if (!h) return { skipped: "analytics did not run" };
  const tomb = await ctx.graph.all("SELECT COUNT(*) AS n FROM kg_tombstone"); h.tombstones_total = tomb[0] ? tomb[0].n : null;
  if (!ctx.dryRun) {
    await ctx.graph.run("INSERT OR REPLACE INTO kg_health (ts, version, metrics) VALUES (" + [ctx.now, VERSION, JSON.stringify(h)].map(lit).join(", ") + ")");
    await ctx.graph.run("DELETE FROM kg_health WHERE ts < " + lit(new Date(Date.parse(ctx.now) - 90 * 86400000).toISOString()));
    if (ctx.audit) {
      try {
        for (const [m, f] of Object.entries(METRICS)) { const v = f(h); if (v !== null && v !== undefined) await ctx.audit.run("UPDATE metric_registry SET last_value = " + lit(String(v)) + ", last_refreshed = " + lit(ctx.now) + ", state = 'MEASURED' WHERE metric = " + lit(m)); }
        await ctx.audit.run("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES ('kg-curate', " + lit(VERSION) + ", " + lit(ctx.now) + ", " + (ok ? 1 : 0) + ") ON CONFLICT(worker) DO UPDATE SET version = excluded.version, ts = excluded.ts, ok = excluded.ok");
        await ctx.audit.run("INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (" + [("kg-curate-" + Date.parse(ctx.now).toString(36)), ctx.now, "kg-curate", String(detail).slice(0, 1800), null, "kg-curate", ok ? "ok" : "error"].map(lit).join(", ") + ")");
        rep.audit = "metrics and heartbeat written";
      } catch (e) { rep.auditError = String(e.message || e).slice(0, 200); }
    }
    if (ctx.r2) {
      const last = getState(ctx, "snapshotAt", null);
      if (!last || Date.parse(ctx.now) - Date.parse(last) > 6 * 3600000 || ctx.force) {
        try {
          const nodes = [...ctx.nodes.values()].map((n) => ({ id: n.id, label: n.label, name: n.name, status: n.status || null, source: n.source || null, canonical_id: n.canonical_id || null }));
          const links = [...ctx.edges.values()].map((e) => ({ source: e.s, target: e.t, key: e.r, weight: e.w, confidence: e.c, origin: e.source || "legacy", status: e.status || "active" }));
          const buf = gzipSync(Buffer.from(JSON.stringify({ directed: true, multigraph: true, graph: { name: "qnfo-kg", version: VERSION, built_at: ctx.now }, nodes, links })));
          await ctx.r2("kg/latest.json.gz", buf); await ctx.r2("kg/" + ctx.now.slice(0, 10).replace(/-/g, "") + ".json.gz", buf);
          await setState(ctx, "snapshotAt", ctx.now); rep.snapshotBytes = buf.length;
        } catch (e) { rep.snapshotError = String(e.message || e).slice(0, 160); }
      }
    }
  }
  return rep;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------------------------------------------------------
export const PHASES = [
  ["lifecycle", phaseLifecycle], ["living", phaseLiving], ["artifacts", phaseArtifacts], ["fleet", phaseFleet], ["audit", phaseAudit], ["mentions", phaseMentions],
  ["concepts", phasePaperConcepts], ["coupling", phaseCoupling], ["semantic", phaseSemantic], ["prune", phasePrune], ["entities", phaseEntities], ["analytics", phaseAnalytics],
];
export async function runCurate(opts) {
  const t0 = Date.now(), now = opts.now || new Date().toISOString();
  const o = Object.assign({ dryRun: false, force: false, minIntervalMin: 25, maxWrites: 60000, maxDeletes: 800, maxEmbed: 1000, budgetMs: 8 * 60000, log: () => {} }, opts, { now });
  const report = { marker: "KG-CURATE-1", version: VERSION, dry_run: o.dryRun };
  const schema = await ensureSchema(o.graph, o.dryRun);
  if (o.dryRun && schema.pending) { report.skipped = "schema not applied yet (" + schema.pending + " columns missing); a dry run does not alter qnfo-graph"; report.ok = true; return report; }
  const ctx = await loadContext(o);
  const last = getState(ctx, "lastRun", null);
  if (!o.force && last && last.ok && Date.parse(now) - Date.parse(last.at) < o.minIntervalMin * 60000) { report.skipped = "last ok run " + Math.round((Date.parse(now) - Date.parse(last.at)) / 60000) + " min ago (< " + o.minIntervalMin + ")"; report.ok = true; return report; }
  const held = getState(ctx, "lease", null);
  if (!o.dryRun && held && Date.parse(held.until) > Date.parse(now) && held.owner !== o.owner) { report.skipped = "another curator holds the lease until " + held.until; report.ok = true; return report; }
  // A short lease renewed before every phase: a run cancelled by the next push (fleet-graph.yml cancels in progress) blocks the next run for
  // at most six minutes, not fifteen.
  const lease = async () => { if (!o.dryRun) await setState(ctx, "lease", { owner: o.owner || "kg-curate", until: new Date(Date.parse(now) + (Date.now() - t0) + 6 * 60000).toISOString() }); };
  await lease();
  report.before = { nodes: ctx.nodes.size, edges: ctx.edges.size };
  let failed = 0;
  // The fleet-graph job has 12 minutes in all and its own build comes first: past the budget the remaining phases wait for the next run (every
  // phase is idempotent), and the run does not count as a good one for the 25-minute throttle.
  let deferred = 0;
  for (const [name, fn] of PHASES) {
    if (Date.now() - t0 > o.budgetMs) { ctx.phases[name] = { deferred: "past the " + Math.round(o.budgetMs / 1000) + " s budget" }; deferred++; continue; }
    const p0 = Date.now();
    await lease();
    try { ctx.phases[name] = await fn(ctx); }
    catch (e) { failed++; ctx.phases[name] = { error: String(e && e.message || e).slice(0, 300) }; if (/write cap/.test(String(e.message))) break; }
    ctx.phases[name].ms = Date.now() - p0;
  }
  const ok = failed === 0;
  report.deferred = deferred;
  if (!ctx.health && !o.dryRun && o.audit) { try { await o.audit.run("INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES ('kg-curate', " + lit(VERSION) + ", " + lit(now) + ", 0) ON CONFLICT(worker) DO UPDATE SET version = excluded.version, ts = excluded.ts, ok = 0"); } catch (e) { ctx.warnings.push("heartbeat: " + String(e.message || e).slice(0, 100)); } }
  try { ctx.phases.publish = await phasePublish(ctx, ok, JSON.stringify({ version: VERSION, failed, writes: ctx.stats.writes, health: ctx.health && { orphan_share: ctx.health.orphan_share, density: ctx.health.edge_density, giant: ctx.health.giant_component_share } })); }
  catch (e) { ctx.phases.publish = { error: String(e.message || e).slice(0, 300) }; }
  if (!o.dryRun) { await setState(ctx, "lastRun", { at: now, ok: ok && !deferred }); await setState(ctx, "lease", { owner: o.owner || "kg-curate", until: now }); }
  report.phases = ctx.phases; report.writes = ctx.stats.writes; report.deletes = ctx.stats.deletes; report.warnings = ctx.warnings.slice(0, 20);
  report.after = { nodes: ctx.nodes.size, edges: ctx.edges.size }; report.health = ctx.health || null; report.ok = ok; report.ms = Date.now() - t0;
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Cloudflare adapters and the command line.
// ---------------------------------------------------------------------------------------------------------------------------
export function cfDbs(cf) {
  const mk = (id) => ({ all: (sql) => cf.d1(id, sql), run: async (sql) => { await cf.d1(id, sql); } });
  return { graph: mk(GRAPH_DB_ID), living: mk(LIVING_DB_ID), audit: mk(AUDIT_DB_ID) };
}
export function cfEmbedder(cf) {
  return async (texts) => {
    const r = await cf.req("POST", "/accounts/" + cf.account + "/ai/run/" + EMBED_MODEL, { text: texts });
    if (!r.ok || !r.j.result || !Array.isArray(r.j.result.data)) throw new Error("AI embed -> " + r.status + " " + JSON.stringify(r.j.errors || r.j).slice(0, 200));
    if (r.j.result.data.length !== texts.length) throw new Error("AI embed returned " + r.j.result.data.length + " vectors for " + texts.length + " texts");
    return r.j.result.data;
  };
}
export function cfR2(cf) {
  return async (key, buf) => {
    const r = await cf.req("PUT", "/accounts/" + cf.account + "/r2/buckets/" + SNAPSHOT_BUCKET + "/objects/" + key.split("/").map(encodeURIComponent).join("/"), buf, "application/gzip", true);
    if (!r.ok) throw new Error("R2 PUT " + key + " -> " + r.status);
  };
}
export async function curateWithCloudflare(cf, extra = {}) {
  const dbs = cfDbs(cf);
  return runCurate(Object.assign({ graph: dbs.graph, living: dbs.living, audit: dbs.audit, embed: cfEmbedder(cf), r2: cfR2(cf), owner: "gha:" + (process.env.GITHUB_RUN_ID || "local") }, extra));
}
async function cli(argv) {
  const token = process.env.CLOUDFLARE_API_TOKEN || "", account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "";
  if (!token || !account) { console.log(JSON.stringify({ marker: "KG-CURATE-1", ok: true, skipped: "no CLOUDFLARE_API_TOKEN / account" })); return 0; }
  const { cfClient } = await import("./fleet_graph.mjs");
  const rep = await curateWithCloudflare(cfClient(token, account), { dryRun: argv.includes("--dry-run"), force: argv.includes("--force") });
  console.log(JSON.stringify(rep));
  return rep.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.log(JSON.stringify({ marker: "KG-CURATE-1", ok: false, error: String(e && e.stack || e).slice(0, 800) })); process.exit(1); });
