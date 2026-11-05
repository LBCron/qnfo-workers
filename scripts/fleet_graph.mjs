#!/usr/bin/env node
// scripts/fleet_graph.mjs: FLEET-GRAPH-1 (2026-10-19, pillar autonomy; also core and cost).
//
// WHAT   Builds one queryable graph of the fleet's code AND its live Cloudflare topology, the open-source equivalent of a
//        Graphify-style code knowledge graph extended with what no code-graph tool models (bindings, D1 tables, triggers,
//        crons, routes, queues, secrets by NAME). Two scopes, each owning its own rows:
//          code  from the checkout: every live worker directory (worker.js + wrangler.toml, no RETIRED/FOLDED marker),
//                migrations/*.sql, .github/workflows/*.yml and scripts/*. worker.js is parsed with acorn (MIT, pinned in
//                .github/workflows/fleet-graph.yml): top-level functions and handlers, calls between them, env.<BINDING>
//                reads, SQL table reads/writes from string literals, fetch() hosts. wrangler.toml with smol-toml (BSD-3).
//          live   from the Cloudflare API (read-only calls): scripts, bindings, crons, workers.dev, routes, custom domains,
//                D1/KV/R2/queues/Vectorize/Workflows, and the live schema of each D1 database (tables, views, triggers and
//                what each trigger and view reads and writes). Secrets are kept by NAME only: bindings pass an allow-list of
//                fields (never `text` or `json`), and the selftest fails if a value could reach the graph.
//        Findings are computed from both: binding and cron drift between wrangler.toml and the account, env.X reads with no
//        binding/var/secret behind them, SQL against a table the bound database does not have, untracked or undeployed
//        workers, orphaned resources, unused bindings, trigger-cascade depth per database.
// WHERE  qnfo-graph D1 tables fg_node, fg_edge, fg_finding, fg_state (created here, idempotent). Writes are a diff against
//        what is stored (content hash per row), so a push that touches one worker writes a few hundred rows, not the graph.
//        A gzipped node-link JSON snapshot (NetworkX node_link_data shape: directed multigraph, links keyed by relation;
//        readable by NetworkX, Graphify-compatible tooling, Gephi, or a 20-line script) goes to R2 qnfo-backups
//        fleet-graph/latest.json.gz and fleet-graph/<yyyymmdd>.json.gz. Nothing depends on Cloudflare to read it back.
//        A heartbeat row fleet_heartbeat(worker='fleet-graph') and metric fleet_graph_findings_warn go to qnfo-audit.
// WHO    .github/workflows/fleet-graph.yml on every push to main that changes code (paths filter); the second path is
//        qnfo-cloud-ops FLEET-GRAPH-CADENCE-1, whose 10-minute tick sends repository_dispatch fleet-graph-tick when the
//        workflow has not run on main for 60 minutes (live changes made outside git reach the graph while main is quiet).
//        qnfo-memory-mcp serves the graph: MCP tools fleet_graph_* and open read-only GET /fleet-graph/* routes.
// LIMIT  Static analysis, not data flow. Calls are resolved by name within one file (top-level units; nested functions
//        count as their enclosing unit). env access through a parameter not named env is caught only for names the worker
//        declares. SQL built at run time (table names in ${...}) is skipped and counted. A finding is a line to read, not a
//        verdict; INFERRED edges are heuristics and say so in `confidence`.
// USAGE  node scripts/fleet_graph.mjs [--scope all|code|live] [--dry-run] [--json-out FILE] [--if-older-than MIN]
//                                     [--live-fixture FILE] [--root DIR] [--max-writes N]
//        node scripts/fleet_graph.mjs --selftest
//        Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (or CF_ACCOUNT_ID) for the live scope and for writes.
//        Exit 0 on success or a skipped run, 1 on a failed build (the heartbeat row records ok = 0).
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { buildSystemMap, collectMapExtra } from "./system_map.mjs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { addRepoDocs, loadManifest, repoFindings, fetchGithubRepos, selftestRepos } from "./fleet_graph_repos.mjs";
import { curateWithCloudflare } from "./kg_curate.mjs";

export const VERSION = "1.2.0"; // release notes sit next to their code and in git history (VERSION-LINE-NOTES-1): 1.2.0 KG-CURATE-1 runs the content-graph curator; 1.1.1 GUARDED-TABLE-READ-1; 1.1.0 root-level Workers are inventoried by wrangler.toml name
export const GRAPH_DB_ID = "a1954b92-d681-4d02-b1f6-f9a2eb4c265d"; // qnfo-graph (also in qnfo-memory-mcp/wrangler.toml)
export const AUDIT_DB_ID = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"; // qnfo-audit
export const SNAPSHOT_BUCKET = "qnfo-backups";
// Databases whose schema is never read: the run log of a public repository must not list them (PROBE-SYSTEMWIDE-1).
export const SCHEMA_REFUSED = ["qnfo-identity", "qnfo-outreach"];
const API = "https://api.cloudflare.com/client/v4";
const FLEET_SUBDOMAIN = "q08.workers.dev";

// ---------------------------------------------------------------------------------------------------------------------------
// Pure helpers (no dependencies; the repository suite imports these without npm install).
// ---------------------------------------------------------------------------------------------------------------------------
export function hashOf(obj) { return createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 16); }
export const EDGE_SEP = "\u0001";
export function edgeKey(e) { return e.src + EDGE_SEP + e.rel + EDGE_SEP + e.dst; }
export function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.trunc(v)) : "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Fields a binding may carry into the graph. Anything else (above all `text`, `json`) is dropped. FLEET-GRAPH-SECRET-1.
export const BINDING_FIELDS = ["name", "type", "database_id", "database_name", "id", "namespace_id", "bucket_name", "index_name",
  "service", "environment", "queue_name", "class_name", "script_name", "workflow_name", "dataset", "project", "binding"];
export function safeBinding(b) {
  const out = {};
  for (const k of BINDING_FIELDS) if (b && b[k] !== undefined && b[k] !== null && typeof b[k] !== "object") out[k] = String(b[k]);
  return out;
}

// SQL: strip comments, then the tables a statement reads and writes. Dynamic parts (${...}) arrive as __DYN__.
// Keywords are matched in upper case on purpose (the fleet writes SQL that way); prose such as "Select the best option from
// the list" is not SQL. Lower-case SQL is a known miss, counted nowhere.
const SQL_START = /^\s*(?:WITH\b|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|REPLACE\b|CREATE\s+(?:TABLE|VIEW|TRIGGER|INDEX|UNIQUE)|ALTER\s+TABLE|DROP\s+(?:TABLE|VIEW|TRIGGER|INDEX))/;
export function looksLikeSql(s) { return typeof s === "string" && s.length >= 12 && s.length <= 200000 && SQL_START.test(s) && /\b(?:FROM|INTO|UPDATE|TABLE|VIEW|TRIGGER|INDEX|SET)\b/.test(s); }
const NOT_TABLES = new Set(["select", "values", "set", "where", "json_each", "json_tree", "sqlite_master", "sqlite_schema",
  "sqlite_sequence", "sqlite_temp_master", "pragma_table_info", "pragma_index_list", "dual", "new", "old", "excluded", "__dyn__", "if", "not", "exists", "lateral", "d1_schema_index"]);
const IDENT = String.raw`["\x60\[]?([A-Za-z_][A-Za-z0-9_]*)["\x60\]]?`;
export function sqlTables(sqlIn) {
  // SQL-LITERAL-TEXT-1 (2026-10-26, fleet_graph_findings_warn): text inside a single-quoted SQL string literal is data, not SQL. Prose such as 'the owner replied from
  // fleet.qnfo.org', 'came from a fleet address' or 'absent from live catalog' was read as FROM <word> and filed sql-table-missing for the "tables" fleet, a and live
  // (qnfo-fleet-dashboard conMailReply and refreshEngagedHumanSessions, qnfo-model-eval syncCatalog). Literals are blanked after comments are stripped; a doubled quote
  // ('it''s') stays inside its literal. Identifiers use double quotes or backticks here, never single quotes.
  const sql = String(sqlIn || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''");
  const ctes = new Set();
  for (const m of sql.matchAll(/(?:\bWITH(?:\s+RECURSIVE)?|,)\s*["\x60]?([A-Za-z_]\w*)["\x60]?\s*(?:\([^)]*\))?\s+AS\s*\(/gi)) ctes.add(m[1].toLowerCase());
  const reads = new Set(), writes = new Set(), creates = new Set(), drops = new Set();
  let dynamic = 0;
  const add = (set, name) => {
    if (!name) return;
    const n = name.toLowerCase();
    if (n.includes("__dyn__")) { dynamic++; return; }
    if (NOT_TABLES.has(n) || ctes.has(n) || /^pragma_/.test(n)) return;
    set.add(name);
  };
  for (const m of sql.matchAll(new RegExp(String.raw`\b(?:FROM|JOIN)\s+` + IDENT, "gi"))) add(reads, m[1]);
  for (const m of sql.matchAll(new RegExp(String.raw`\b(?:INSERT|REPLACE)(?:\s+OR\s+\w+)?\s+INTO\s+` + IDENT, "gi"))) add(writes, m[1]);
  for (const m of sql.matchAll(new RegExp(String.raw`\bUPDATE(?:\s+OR\s+\w+)?\s+` + IDENT + String.raw`\s+SET\b`, "gi"))) add(writes, m[1]);
  for (const m of sql.matchAll(new RegExp(String.raw`\bDELETE\s+FROM\s+` + IDENT, "gi"))) { add(writes, m[1]); reads.delete(m[1]); }
  for (const m of sql.matchAll(new RegExp(String.raw`\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?` + IDENT, "gi"))) add(creates, m[1]);
  for (const m of sql.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+` + IDENT, "gi"))) add(writes, m[1]);
  for (const m of sql.matchAll(new RegExp(String.raw`\bDROP\s+(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?` + IDENT, "gi"))) add(drops, m[1]);
  for (const c of creates) { reads.delete(c); }
  return { reads: [...reads], writes: [...writes], creates: [...creates], drops: [...drops], dynamic };
}

export function optionalTableProbe(sqlIn) {
  const sql = String(sqlIn || "");
  if (!/\bFROM\s+(?:main\.)?sqlite_master\b/i.test(sql)) return null;
  const where = /\bWHERE\b([\s\S]*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/i.exec(sql);
  if (!where) return null;
  const predicates = where[1].split(/\bAND\b/i).map((part) => part.trim().replace(/^\(+|\)+$/g, ""));
  if (!predicates.some((part) => /^(?:sqlite_master\.)?type\s*=\s*(['"])table\1$/i.test(part))) return null;
  for (const part of predicates) {
    const match = /^(?:sqlite_master\.)?name\s*=\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1$/i.exec(part);
    if (match) return match[2];
  }
  return null;
}

// A CREATE TRIGGER statement: its table, event and the tables its body reads and writes.
export function parseTrigger(sql) {
  const m = /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?["\x60]?(\w+)["\x60]?\s+(BEFORE|AFTER|INSTEAD\s+OF)?\s*(INSERT|DELETE|UPDATE(?:\s+OF\s+[\w\s,"\x60]+?)?)\s+ON\s+["\x60]?(\w+)["\x60]?/i.exec(String(sql || ""));
  if (!m) return null;
  const bodyStart = String(sql).search(/\bBEGIN\b/i);
  const body = bodyStart >= 0 ? String(sql).slice(bodyStart + 5).replace(/\bEND\s*;?\s*$/i, "") : "";
  const t = sqlTables(body);
  return { name: m[1], timing: (m[2] || "").toUpperCase(), event: m[3].split(/\s+/)[0].toUpperCase(), table: m[4], reads: t.reads, writes: t.writes };
}

export function hostOf(url) {
  const m = /^https?:\/\/([A-Za-z0-9.-]+)(?::\d+)?(?:[\/?#]|$)/.exec(String(url || ""));
  return m ? m[1].toLowerCase() : null;
}
export function routeHost(pattern) {
  const p = String(pattern || "").replace(/^https?:\/\//, "").replace(/^\*\.?/, "");
  const h = p.split("/")[0].split(":")[0].toLowerCase();
  return h && /\./.test(h) && !h.includes("*") ? h : null;
}

// Cron expressions, normalised so "0 * * * *" from wrangler.toml equals the API's "0 * * * *".
export function normCron(c) { return String(c || "").trim().replace(/\s+/g, " "); }

// The diff that keeps D1 writes proportional to the change: rows whose hash changed or that are new are upserted,
// rows that are gone are deleted.
export function diffRows(current, stored) {
  const upsert = [], del = [];
  for (const [k, row] of current) { const h = stored.get(k); if (h !== row.h) upsert.push(row); }
  for (const k of stored.keys()) if (!current.has(k)) del.push(k);
  return { upsert, del };
}

// Longest trigger cascade per database: writing table T fires triggers ON T, whose bodies write further tables.
export function triggerDepth(triggers) {
  const on = new Map();
  for (const t of triggers) { if (!on.has(t.table)) on.set(t.table, []); on.get(t.table).push(t); }
  const memo = new Map(); const cycles = new Set();
  function depth(table, stack) {
    if (stack.has(table)) { cycles.add([...stack, table].slice([...stack].indexOf(table)).join(" -> ")); return { d: 0, path: [table] }; }
    if (memo.has(table)) return memo.get(table);
    stack.add(table);
    let best = { d: 0, path: [table] };
    for (const t of on.get(table) || []) for (const w of t.writes) {
      const sub = depth(w, stack);
      if (sub.d + 1 > best.d) best = { d: sub.d + 1, path: [table, t.name].concat(sub.path) };
    }
    stack.delete(table); memo.set(table, best);
    return best;
  }
  let max = { d: 0, path: [] };
  for (const table of on.keys()) { const r = depth(table, new Set()); if (r.d > max.d) max = r; }
  return { depth: max.d, path: max.path, cycles: [...cycles].slice(0, 10) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The graph container.
// ---------------------------------------------------------------------------------------------------------------------------
export class Graph {
  constructor(scope) { this.scope = scope; this.nodes = new Map(); this.edges = new Map(); this.stats = {}; }
  node(id, kind, name, extra = {}) {
    const prev = this.nodes.get(id);
    const attrs = Object.assign({}, prev ? prev.attrs : {}, extra.attrs || {});
    const n = { id, kind, name: String(name), worker: extra.worker ?? prev?.worker ?? null, path: extra.path ?? prev?.path ?? null,
      line: extra.line ?? prev?.line ?? null, attrs, source: extra.source || prev?.source || this.scope };
    this.nodes.set(id, n);
    return id;
  }
  edge(src, rel, dst, extra = {}) {
    if (!src || !dst || src === dst && rel === "calls") return;
    const e = { src, rel, dst, confidence: extra.confidence || "EXTRACTED", source: extra.source || this.scope, path: extra.path ?? null, attrs: extra.attrs || {} };
    const k = edgeKey(e);
    const prev = this.edges.get(k);
    if (prev) { prev.attrs.n = (prev.attrs.n || 1) + 1; if (rank(e.confidence) > rank(prev.confidence)) prev.confidence = e.confidence; return; }
    this.edges.set(k, e);
  }
  bump(key, n = 1) { this.stats[key] = (this.stats[key] || 0) + n; }
  finalize(now) {
    const nodes = new Map(), edges = new Map();
    for (const [id, n] of this.nodes) {
      const row = { id, scope: this.scope, kind: n.kind, name: n.name, worker: n.worker, path: n.path, line: n.line, attrs: JSON.stringify(n.attrs), source: n.source };
      row.h = hashOf([row.kind, row.name, row.worker, row.path, row.line, row.attrs, row.source]); row.updated_at = now;
      nodes.set(id, row);
    }
    for (const [k, e] of this.edges) {
      // occurrence counts are kept out of the hash so an unrelated edit does not rewrite every edge of a worker
      const { n, ...rest } = e.attrs;
      const row = { src: e.src, rel: e.rel, dst: e.dst, scope: this.scope, confidence: e.confidence, source: e.source, path: e.path, attrs: JSON.stringify(e.attrs) };
      row.h = hashOf([row.confidence, row.source, row.path, JSON.stringify(rest)]); row.updated_at = now;
      edges.set(k, row);
    }
    return { nodes, edges };
  }
}
function rank(c) { return { AMBIGUOUS: 0, INFERRED: 1, EXTRACTED: 2, OBSERVED: 3 }[c] ?? 0; }

// ---------------------------------------------------------------------------------------------------------------------------
// Code scope.
// ---------------------------------------------------------------------------------------------------------------------------
export function liveWorkerDirs(root) {
  const out = [];
  if (existsSync(join(root, "worker.js")) && existsSync(join(root, "wrangler.toml"))) out.push(".");
  for (const d of readdirSync(root).sort()) {
    if (d.startsWith(".") || d === "node_modules") continue;
    const p = join(root, d);
    try { if (!statSync(p).isDirectory()) continue; } catch (e) { continue; }
    if (!existsSync(join(p, "worker.js")) || !existsSync(join(p, "wrangler.toml"))) continue;
    if (existsSync(join(p, "RETIRED")) || existsSync(join(p, "FOLDED"))) continue;
    out.push(d);
  }
  return out;
}

const RESOURCE_OF = {
  d1_databases: (b) => ({ binding: b.binding, type: "d1", res: "d1:" + b.database_name, resKind: "d1", resName: b.database_name, attrs: { database_id: b.database_id } }),
  kv_namespaces: (b) => ({ binding: b.binding, type: "kv_namespace", res: "kv:" + b.id, resKind: "kv", resName: b.id }),
  r2_buckets: (b) => ({ binding: b.binding, type: "r2_bucket", res: "r2:" + b.bucket_name, resKind: "r2", resName: b.bucket_name }),
  vectorize: (b) => ({ binding: b.binding, type: "vectorize", res: "vz:" + b.index_name, resKind: "vectorize", resName: b.index_name }),
  services: (b) => ({ binding: b.binding, type: "service", res: "worker:" + b.service, resKind: "worker", resName: b.service, attrs: b.entrypoint ? { entrypoint: b.entrypoint } : {} }),
  analytics_engine_datasets: (b) => ({ binding: b.binding, type: "analytics_engine", res: "ae:" + (b.dataset || b.binding), resKind: "analytics_engine", resName: b.dataset || b.binding }),
  workflows: (b) => ({ binding: b.binding, type: "workflow", res: "wf:" + b.name, resKind: "workflow", resName: b.name, attrs: { class_name: b.class_name, script_name: b.script_name } }),
  send_email: (b) => ({ binding: b.name, type: "send_email", res: "svc:send-email", resKind: "platform", resName: "send_email" }),
  worker_loaders: (b) => ({ binding: b.binding, type: "worker_loader", res: "svc:worker-loader", resKind: "platform", resName: "worker_loader" }),
  ai_search_namespaces: (b) => ({ binding: b.binding, type: "ai_search", res: "aisearch:" + (b.namespace || b.binding), resKind: "ai_search", resName: b.namespace || b.binding }),
};

// Parse one worker's wrangler.toml into the graph; returns the declared binding names and vars.
export function addWrangler(g, worker, toml, path) {
  const wid = "worker:" + worker;
  const declared = new Map(); // name -> type
  const bindRes = (spec) => {
    if (!spec || !spec.binding) return;
    const bid = "binding:" + worker + "." + spec.binding;
    g.node(spec.res, spec.resKind, spec.resName, { attrs: spec.attrs || {} });
    g.node(bid, "binding", spec.binding, { worker, path, attrs: { type: spec.type } });
    g.edge(wid, "has_binding", bid, { path });
    g.edge(bid, "binds", spec.res, { path });
    declared.set(spec.binding, spec.type);
  };
  for (const [key, fn] of Object.entries(RESOURCE_OF)) for (const b of [].concat(toml[key] || [])) bindRes(fn(b));
  if (toml.ai && toml.ai.binding) bindRes({ binding: toml.ai.binding, type: "ai", res: "svc:workers-ai", resKind: "platform", resName: "workers_ai" });
  for (const b of [].concat(toml.browser || [])) if (b && b.binding) bindRes({ binding: b.binding, type: "browser", res: "svc:browser-run", resKind: "platform", resName: "browser_run" });
  const dos = toml.durable_objects && toml.durable_objects.bindings || [];
  for (const b of dos) bindRes({ binding: b.name, type: "durable_object_namespace", res: "do:" + (b.script_name || worker) + "." + b.class_name, resKind: "durable_object", resName: b.class_name, attrs: { script: b.script_name || worker } });
  const q = toml.queues || {};
  for (const p of [].concat(q.producers || [])) bindRes({ binding: p.binding, type: "queue", res: "queue:" + p.queue, resKind: "queue", resName: p.queue });
  for (const c of [].concat(q.consumers || [])) { g.node("queue:" + c.queue, "queue", c.queue); g.edge(wid, "consumes", "queue:" + c.queue, { path, attrs: c.dead_letter_queue ? { dlq: c.dead_letter_queue } : {} }); if (c.dead_letter_queue) { g.node("queue:" + c.dead_letter_queue, "queue", c.dead_letter_queue); g.edge("queue:" + c.queue, "dead_letters_to", "queue:" + c.dead_letter_queue, { path }); } }
  for (const c of [].concat(toml.containers || [])) if (c && c.class_name) { const id = "container:" + worker + "." + c.class_name; g.node(id, "container", c.class_name, { worker, attrs: { image: c.image || null } }); g.edge(wid, "runs_container", id, { path }); }
  const vars = Object.keys(toml.vars || {});
  for (const v of vars) declared.set(v, "plain_text");
  for (const c of [].concat((toml.triggers && toml.triggers.crons) || [])) { const cid = "cron:" + worker + "@" + normCron(c); g.node(cid, "cron", normCron(c), { worker }); g.edge(wid, "has_cron", cid, { path }); }
  for (const r of [].concat(toml.routes || []).concat(toml.route ? [toml.route] : [])) {
    const pat = typeof r === "string" ? r : r && r.pattern;
    if (!pat) continue;
    const custom = typeof r === "object" && r.custom_domain;
    const id = custom ? "domain:" + routeHost(pat) : "route:" + pat;
    g.node(id, custom ? "custom_domain" : "route", custom ? routeHost(pat) : pat, { attrs: { host: routeHost(pat), zone: (r && r.zone_name) || null } });
    g.edge(wid, "serves", id, { path });
  }
  return { declared, vars, compat: toml.compatibility_date || null, workersDev: toml.workers_dev, crons: [].concat((toml.triggers && toml.triggers.crons) || []).map(normCron) };
}

// Map hostnames to fleet workers: <name>.q08.workers.dev, plus every declared or observed route and custom domain.
export function hostIndex(workers, routes) {
  const idx = new Map();
  for (const w of workers) idx.set(w + "." + FLEET_SUBDOMAIN, w);
  for (const [host, w] of routes) if (host && !idx.has(host)) idx.set(host, w);
  return idx;
}

// AST pass over one worker.js. `acorn` and `walk` are injected so the suite can run without them.
export function addWorkerCode(g, worker, src, path, ctx) {
  const { acorn, walk, declared, hosts, d1ByBinding, liveTables } = ctx;
  const wid = "worker:" + worker;
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true, locations: true }); }
  catch (e) { g.bump("parse_errors"); g.node(wid, "worker", worker, { attrs: { parse_error: String(e.message).slice(0, 200) } }); return { envReads: new Map(), computedEnv: false, optionalEnv: new Set() }; }
  const lineOf = (n) => (n && n.loc ? n.loc.start.line : null);
  // 1. Top-level units.
  const units = []; // {name, node, line, kind}
  const topConsts = new Map();
  const unitByName = new Map();
  const addUnit = (name, node, kind) => { if (!name || !node) return; const u = { name, node, line: lineOf(node), kind }; units.push(u); if (!unitByName.has(name)) unitByName.set(name, u); else unitByName.get(name).dup = true; };
  const objectHandlers = (obj, prefix) => {
    if (!obj || obj.type !== "ObjectExpression") return;
    for (const p of obj.properties) {
      if (p.type !== "Property" || p.computed) continue;
      const key = p.key.name || p.key.value;
      if (p.value && /Function/.test(p.value.type)) addUnit(prefix + key, p.value, ["fetch", "scheduled", "queue", "email", "tail", "trace"].includes(key) ? "handler" : "method");
    }
  };
  let defaultExportName = null;
  for (const st of ast.body) {
    const s = st.type === "ExportNamedDeclaration" && st.declaration ? st.declaration : st;
    if (s.type === "FunctionDeclaration" && s.id) addUnit(s.id.name, s, "function");
    else if (s.type === "ClassDeclaration" && s.id) {
      for (const m of s.body.body) if (m.type === "MethodDefinition" && m.key && !m.computed) addUnit(s.id.name + "." + (m.key.name || m.key.value), m.value, "method");
      g.node("class:" + worker + "." + s.id.name, "class", s.id.name, { worker, path, line: lineOf(s), attrs: { extends: s.superClass && (s.superClass.name || (s.superClass.property && s.superClass.property.name)) || null } });
      g.edge(wid, "contains", "class:" + worker + "." + s.id.name, { path });
    }
    else if (s.type === "VariableDeclaration") for (const d of s.declarations) {
      if (d.id.type !== "Identifier" || !d.init) continue;
      if (/Function/.test(d.init.type)) addUnit(d.id.name, d.init, "function");
      else if (d.init.type === "ObjectExpression" && /default/.test(d.id.name)) { objectHandlers(d.init, "default."); }
      else if (d.init.type === "Literal" && typeof d.init.value === "string") topConsts.set(d.id.name, d.init.value);
      else if (d.init.type === "TemplateLiteral" && d.init.quasis.length) topConsts.set(d.id.name, d.init.quasis[0].value.cooked || "");
    }
    else if (s.type === "ExportDefaultDeclaration") {
      if (s.declaration.type === "ObjectExpression") objectHandlers(s.declaration, "default.");
      else if (s.declaration.type === "Identifier") defaultExportName = s.declaration.name;
    }
    if (st.type === "ExportNamedDeclaration" && !st.declaration) for (const sp of st.specifiers || []) if (sp.exported && (sp.exported.name === "default" || sp.exported.value === "default")) defaultExportName = sp.local.name;
  }
  if (defaultExportName) for (const st of ast.body) if (st.type === "VariableDeclaration") for (const d of st.declarations) if (d.id.type === "Identifier" && d.id.name === defaultExportName && d.init && d.init.type === "ObjectExpression") objectHandlers(d.init, "default.");
  g.bump("units", units.length);
  // 2. Unit nodes.
  const unitId = (u) => "fn:" + worker + "#" + u.name + (u.dup && unitByName.get(u.name) !== u ? "@" + u.line : "");
  for (const u of units) { const id = unitId(u); g.node(id, u.kind === "handler" ? "handler" : "function", u.name, { worker, path, line: u.line, attrs: { kind: u.kind } }); g.edge(wid, "contains", id, { path }); }
  // 3. Body pass.
  const envReads = new Map(); // NAME -> first line
  // OPTIONAL-ENV-1: a name is optional only when EVERY recorded read of it supplies its own fallback. noteRead counts each read and
  // each defaulted read; a single bare read (env.X alone, env.X && f(), typeof env.X, an assignment) keeps the name a real finding.
  const envReadCount = new Map(), envDefaultedCount = new Map();
  const noteRead = (name, line, defaulted) => {
    if (!envReads.has(name)) envReads.set(name, line);
    envReadCount.set(name, (envReadCount.get(name) || 0) + 1);
    if (defaulted) envDefaultedCount.set(name, (envDefaultedCount.get(name) || 0) + 1);
  };
  let computedEnv = false;
  const declaredNames = declared;
  const ENV_OBJ = new Set(["env", "ENV", "environment", "bindings"]);
  for (const u of units) {
    const uid = unitId(u);
    const aliases = new Map(); // local var -> binding name
    const localConsts = new Map();
    const usedD1 = new Set();
    const isEnvObject = (o) => (o.type === "Identifier" && ENV_OBJ.has(o.name)) || (o.type === "MemberExpression" && !o.computed && o.object.type === "ThisExpression" && o.property.name === "env") || (o.type === "MemberExpression" && !o.computed && o.property.name === "env" && o.object.type === "Identifier");
    const bindingOf = (expr) => {
      if (!expr) return null;
      if (expr.type === "ChainExpression") expr = expr.expression;
      if (expr.type === "MemberExpression" && !expr.computed && expr.property.type === "Identifier") {
        const name = expr.property.name;
        if (isEnvObject(expr.object)) return name;
        if (expr.object.type === "Identifier" && declaredNames.has(name) && /^[A-Z][A-Z0-9_]+$/.test(name)) return name;
      }
      if (expr.type === "Identifier" && aliases.has(expr.name)) return aliases.get(expr.name);
      return null;
    };
    const strValue = (n) => {
      if (!n) return null;
      if (n.type === "Literal" && typeof n.value === "string") return n.value;
      if (n.type === "TemplateLiteral") return n.quasis.map((q, i) => (q.value.cooked || "") + (i < n.expressions.length ? "__DYN__" : "")).join("");
      if (n.type === "BinaryExpression" && n.operator === "+") { const a = strValue(n.left), b = strValue(n.right); return a === null && b === null ? null : (a ?? "__DYN__") + (b ?? "__DYN__"); }
      if (n.type === "Identifier") return localConsts.get(n.name) ?? topConsts.get(n.name) ?? null;
      return null;
    };
    const sqlSeen = [];
    // OPTIONAL-ENV-1 pre-pass (acorn-walk's `full` visits children before parents, so a read cannot see its parent): the left side of
    // `a ?? d` / `a || d` is a defaulted read when d is a real fallback, including through a guard (`(env && env.X) || d`) and a
    // chain (`env.A ?? env.B ?? "x"` defaults both). A fallback that is itself an env read (`env.A ?? env.B`) is not one, and
    // neither is the undefined identifier. A coercion wrapper (`Number(env.X) || 5`) is not recognised: such a name stays a finding.
    const envLike = (x) => { if (x && x.type === "ChainExpression") x = x.expression; return !!x && x.type === "MemberExpression" && isEnvObject(x.object); };
    const isLogical = (x) => !!x && x.type === "LogicalExpression";
    const isFallbackOp = (x) => isLogical(x) && (x.operator === "??" || x.operator === "||");
    const isFallback = (x) => {
      if (!x) return false;
      if (isLogical(x)) return isFallback(x.right);
      if (envLike(x)) return false;
      return !(x.type === "Identifier" && x.name === "undefined");
    };
    const defaulted = new Set();
    const markDefaulted = (x) => {
      if (!x) return;
      defaulted.add(x);
      if (x.type === "ChainExpression") defaulted.add(x.expression);
      if (isLogical(x)) { markDefaulted(x.left); markDefaulted(x.right); }
    };
    walk.full(u.node, (n) => { if (isFallbackOp(n) && isFallback(n.right)) markDefaulted(n.left); });
    walk.full(u.node, (n) => {
      if (n.type === "VariableDeclarator" && n.init) {
        const b = bindingOf(n.init);
        if (n.id.type === "Identifier" && b) aliases.set(n.id.name, b);
        if (n.id.type === "Identifier" && (n.init.type === "Literal" || n.init.type === "TemplateLiteral")) { const v = strValue(n.init); if (v !== null) localConsts.set(n.id.name, v); }
        if (n.id.type === "ObjectPattern" && isEnvObject(n.init.type === "ChainExpression" ? n.init.expression : n.init)) for (const p of n.id.properties) if (p.type === "Property" && !p.computed && p.key.type === "Identifier") { const nm = p.key.name; noteRead(nm, lineOf(p), p.value.type === "AssignmentPattern" && isFallback(p.value.right)); if (p.value.type === "Identifier") aliases.set(p.value.name, nm); g.edge(uid, "uses_binding", "binding:" + worker + "." + nm, { path }); }
      }
      if (n.type === "MemberExpression") {
        if (n.computed && isEnvObject(n.object) && !(n.property.type === "Literal")) computedEnv = true;
        if (!n.computed && n.property.type === "Identifier" && /^[A-Z][A-Z0-9_]*$/.test(n.property.name)) {
          const name = n.property.name;
          const strict = (n.object.type === "Identifier" && n.object.name === "env") || (n.object.type === "MemberExpression" && !n.object.computed && n.object.object.type === "ThisExpression" && n.object.property.name === "env");
          if (strict) noteRead(name, lineOf(n), defaulted.has(n));
          if (strict || (isEnvObject(n.object) || declaredNames.has(name)) && bindingOf(n) === name) {
            g.edge(uid, "uses_binding", "binding:" + worker + "." + name, { path });
            if (declared.get(name) === "d1") usedD1.add(name);
          }
        }
      }
      if (n.type === "CallExpression") {
        const c = n.callee;
        if (c.type === "Identifier" && c.name !== "__name" && unitByName.has(c.name)) g.edge(uid, "calls", unitId(unitByName.get(c.name)), { path });
        if (c.type === "MemberExpression" && !c.computed && c.object.type === "ThisExpression" && u.name.includes(".")) { const cls = u.name.split(".")[0]; const t = unitByName.get(cls + "." + c.property.name); if (t) g.edge(uid, "calls", unitId(t), { path }); }
        // SQL through .prepare / .exec on a binding (alias or env.X)
        if (c.type === "MemberExpression" && !c.computed && (c.property.name === "prepare" || c.property.name === "exec") && n.arguments.length) {
          const s = strValue(n.arguments[0]);
          if (s && looksLikeSql(s) && /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH|CREATE|ALTER|DROP|PRAGMA)\b/i.test(s)) sqlSeen.push({ sql: s, binding: bindingOf(c.object), line: lineOf(n) });
        }
        // fetch to a literal (or constant) URL
        const isFetch = (c.type === "Identifier" && c.name === "fetch") || (c.type === "MemberExpression" && !c.computed && c.property.name === "fetch" && !bindingOf(c.object));
        if (isFetch && n.arguments.length) {
          const s = strValue(n.arguments[0]);
          const h = s && hostOf(s);
          if (h) {
            const target = hosts.get(h);
            const conf = n.arguments[0].type === "Literal" ? "EXTRACTED" : "INFERRED";
            if (target) { if (target !== worker) g.edge(uid, "http_calls", "worker:" + target, { path, confidence: conf, attrs: { host: h } }); }
            else { g.node("host:" + h, "external_host", h); g.edge(uid, "http_calls", "host:" + h, { path, confidence: conf }); }
          }
        }
        if (c.type === "Identifier" && c.name === "__name") return;
      }
      if (n.type === "Identifier" && unitByName.has(n.name) && n.name !== u.name.split(".").pop()) {
        // a function passed as a value (step lists, callbacks); recorded once per unit as an INFERRED reference
        const t = unitByName.get(n.name); if (t !== u) g.edge(uid, "refs", unitId(t), { path, confidence: "INFERRED" });
      }
      if ((n.type === "Literal" && typeof n.value === "string") || n.type === "TemplateLiteral") {
        const s = strValue(n);
        if (s && s.length > 20 && looksLikeSql(s) && !sqlSeen.some((x) => x.sql === s)) sqlSeen.push({ sql: s, binding: null, line: lineOf(n) });
        if (s && s.includes(FLEET_SUBDOMAIN)) for (const m of s.matchAll(/([a-z0-9-]+)\.q08\.workers\.dev/g)) if (m[1] !== worker && hosts.get(m[0])) g.edge(uid, "references", "worker:" + m[1], { path, confidence: "INFERRED" });
      }
    });
    // GUARDED-TABLE-READ-1 (issue 100084, METRIC-TRIGGER-9262): optionalTableProbe was exported with its tests but nothing called it, so a read that its own function
    // guards with `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'T'` (research-exec floorRearmTick on bak_20261019_research_parked, publishStage on
    // bibliography) was still filed as warn sql-table-missing. Edges of the tables a function probes for carry guarded = 1; computeFindings lists them as info.
    const guardedTables = new Set(sqlSeen.map((x) => optionalTableProbe(x.sql)).filter(Boolean).map((x) => x.toLowerCase()));
    for (const q of sqlSeen) {
      const t = sqlTables(q.sql);
      if (t.dynamic) g.bump("sql_dynamic_names", t.dynamic);
      let db = q.binding && declared.get(q.binding) === "d1" ? d1ByBinding.get(q.binding) : null;
      let conf = db ? "EXTRACTED" : "INFERRED";
      const resolve = (table) => {
        if (db) return db;
        if (usedD1.size === 1) return d1ByBinding.get([...usedD1][0]);
        const bound = [...d1ByBinding.values()];
        if (bound.length === 1) return bound[0];
        const having = bound.filter((d) => liveTables && liveTables.get(d) && liveTables.get(d).has(table.toLowerCase()));
        return having.length === 1 ? having[0] : null;
      };
      const emit = (table, rel) => {
        const d = resolve(table);
        if (!d) { g.bump("sql_unresolved_db"); return; }
        const tid = "d1t:" + d + "." + table;
        g.node(tid, "d1_table", table, { attrs: { database: d } });
        g.edge(uid, rel, tid, { path, confidence: conf, attrs: Object.assign({ binding: q.binding || null }, guardedTables.has(table.toLowerCase()) && rel !== "creates" ? { guarded: 1 } : {}) });
      };
      for (const x of t.reads) emit(x, "reads");
      for (const x of t.writes) emit(x, "writes");
      for (const x of t.creates) emit(x, "creates");
      g.bump("sql_statements");
    }
  }
  const optionalEnv = new Set();
  for (const [name, count] of envReadCount) if (count > 0 && envDefaultedCount.get(name) === count && !isCredentialLikeEnvName(name)) optionalEnv.add(name);
  return { envReads, computedEnv, optionalEnv };
}

// OPTIONAL-ENV-1 (issue 100084): the rule that demotes an undeclared env name from warn `env-undeclared` to info `env-optional-unset`.
//   1. EVERY recorded read of the name supplies its own fallback: `env.X ?? d`, `env.X || d`, `(env && env.X) || d`, or the destructure
//      default `const { X = d } = env`, where d is not itself an env read. One bare read (`env.X`, `if (env.X)`, `typeof env.X`, an
//      assignment, a coercion wrapper such as `Number(env.X) || 5`) keeps the name a finding.
//   2. The name is not credential-shaped. A defaulted read of a token, key, secret or password (`env.EVENTS_TOKEN || ""`) silently
//      turns authentication or a call off when the secret is missing; that is exactly what a finding exists to show, so such a name
//      stays a warn whatever its fallback.
// The demoted finding is not dropped: it stays listed (info) with the line of its first read.
export const CREDENTIAL_SEGMENTS = new Set(["TOKEN", "TOKENS", "KEY", "KEYS", "SECRET", "SECRETS", "PASS", "PASSWORD", "PASSWD", "PWD", "PAT", "CREDENTIAL", "CREDENTIALS", "COOKIE", "SALT", "PRIVATE", "CERT", "BEARER", "HMAC", "SIGNATURE"]);
export function isCredentialLikeEnvName(name) {
  return String(name).toUpperCase().split(/[^A-Z0-9]+/).some((seg) => CREDENTIAL_SEGMENTS.has(seg));
}

export function addMigrations(g, root) {
  const dir = join(root, "migrations");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".sql")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    const db = (/^--\s*DB:\s*([\w-]+)/m.exec(text) || [])[1] || "qnfo-audit";
    const mid = "migration:" + f;
    g.node(mid, "migration", f, { path: "migrations/" + f, attrs: { database: db, applied_by_ci: /^--\s*APPLY-BY:\s*ci/m.test(text) } });
    for (const m of text.matchAll(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(TABLE|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["\x60]?(\w+)/gi)) {
      const kind = m[1].toUpperCase();
      const id = (kind === "TABLE" ? "d1t:" : kind === "VIEW" ? "d1v:" : "d1trg:") + db + "." + m[2];
      g.node(id, kind === "TABLE" ? "d1_table" : kind === "VIEW" ? "d1_view" : "d1_trigger", m[2], { attrs: { database: db } });
      g.edge(mid, "defines", id, { path: "migrations/" + f });
    }
    for (const m of text.matchAll(/\bDROP\s+(TABLE|VIEW|TRIGGER)\s+(?:IF\s+EXISTS\s+)?["\x60]?(\w+)/gi)) {
      const kind = m[1].toUpperCase();
      const id = (kind === "TABLE" ? "d1t:" : kind === "VIEW" ? "d1v:" : "d1trg:") + db + "." + m[2];
      g.edge(mid, "drops", id, { path: "migrations/" + f });
    }
    g.bump("migrations");
  }
}

export function addWorkflows(g, root, liveTables) {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return;
  const byName = new Map(); const pending = [];
  for (const f of readdirSync(dir).sort()) {
    if (!/\.ya?ml$/.test(f)) continue;
    const text = readFileSync(join(dir, f), "utf8");
    const name = ((/^name:\s*["']?(.+?)["']?\s*$/m.exec(text) || [])[1] || f).trim();
    const id = "gha:" + f;
    const on = [];
    for (const ev of ["push", "pull_request", "schedule", "workflow_dispatch", "workflow_run", "repository_dispatch"]) if (new RegExp("^\\s{0,4}" + ev + ":", "m").test(text)) on.push(ev);
    g.node(id, "gh_workflow", name, { path: ".github/workflows/" + f, attrs: { on } });
    byName.set(name, id);
    for (const m of new Set([...text.matchAll(/\bscripts\/[\w.\/-]+\.(?:py|mjs|js|sh)\b/g)].map((x) => x[0]))) { g.node("script:" + m, "script", m, { path: m }); g.edge(id, "runs", "script:" + m, { path: ".github/workflows/" + f }); }
    const wr = /workflow_run:\s*\n\s*workflows:\s*\[([^\]]*)\]/.exec(text);
    if (wr) for (const w of wr[1].split(",")) pending.push([id, w.replace(/["'\s]/g, "")]);
    g.bump("workflows");
  }
  for (const [id, wname] of pending) { const t = byName.get(wname); if (t) g.edge(id, "chained_after", t, { path: null }); }
  // scripts: SQL against qnfo-audit tables that exist (INFERRED; the runners' scripts talk to qnfo-audit by default)
  const sdir = join(root, "scripts");
  if (!existsSync(sdir)) return;
  const audit = liveTables && liveTables.get("qnfo-audit");
  for (const f of readdirSync(sdir).sort()) {
    if (!/\.(py|mjs|js)$/.test(f) || /test/.test(f)) continue;
    const p = "scripts/" + f;
    let text; try { text = readFileSync(join(sdir, f), "utf8"); } catch (e) { continue; }
    if (text.length > 600000) continue;
    const sid = "script:" + p;
    let any = false;
    const t = sqlTables(text.replace(/\$\{[^}]*\}|%s|\{[a-z_]*\}/g, "__DYN__"));
    for (const [rel, list] of [["reads", t.reads], ["writes", t.writes]]) for (const table of list) {
      if (!audit || !audit.has(table.toLowerCase())) continue;
      any = true; g.edge(sid, rel, "d1t:qnfo-audit." + table, { path: p, confidence: "INFERRED" });
    }
    for (const m of new Set([...text.matchAll(/([a-z0-9-]+)\.q08\.workers\.dev/g)].map((x) => x[1]))) { any = true; g.edge(sid, "references", "worker:" + m, { path: p, confidence: "INFERRED" }); }
    if (any) g.node(sid, "script", p, { path: p });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Live scope (Cloudflare API, read-only calls).
// ---------------------------------------------------------------------------------------------------------------------------
export function cfClient(token, account, fetchImpl = globalThis.fetch) {
  async function req(method, path, body, ctype, raw) {
    let last;
    for (let i = 0; i < 4; i++) {
      let r;
      // A dropped connection (ECONNRESET, a socket timeout) is retried like a 5xx: it ended a rehearsal of the knowledge-graph curator that the 429/5xx path never saw.
      try { r = await fetchImpl(API + path, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body !== undefined ? { "Content-Type": ctype || "application/json" } : {}), body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) }); }
      catch (e) { last = "network " + String(e && (e.cause && e.cause.code || e.message) || e).slice(0, 40); await new Promise((s) => setTimeout(s, 800 * (i + 1) * (i + 1))); continue; }
      if (r.status === 429 || r.status >= 500) { last = r.status; await new Promise((s) => setTimeout(s, 800 * (i + 1) * (i + 1))); continue; }
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch (e) { j = { success: r.ok, raw: text.slice(0, 300) }; }
      return { status: r.status, ok: r.ok && j.success !== false, j };
    }
    return { status: last || 0, ok: false, j: { errors: [{ message: "retries exhausted (" + last + ")" }] } };
  }
  async function list(path, key) {
    let out = [];
    for (let page = 1; page < 50; page++) {
      const r = await req("GET", path + (path.includes("?") ? "&" : "?") + "per_page=100&page=" + page);
      if (!r.ok) throw new Error("GET " + path + " -> " + r.status + " " + JSON.stringify(r.j.errors || r.j).slice(0, 200));
      const res = key ? (r.j.result || {})[key] : r.j.result;
      const items = Array.isArray(res) ? res : [];
      out = out.concat(items);
      const ri = r.j.result_info;
      if (!ri || !ri.total_pages || page >= ri.total_pages || !items.length) break;
    }
    return out;
  }
  async function d1(dbId, sql, params) {
    const r = await req("POST", "/accounts/" + account + "/d1/database/" + dbId + "/query", { sql, params: params || [] });
    if (!r.ok) throw new Error("D1 " + dbId.slice(0, 8) + " -> " + r.status + " " + JSON.stringify(r.j.errors || r.j).slice(0, 300));
    const res = r.j.result || [];
    return res.length ? (res[res.length - 1].results || []) : [];
  }
  return { req, list, d1, account };
}

export async function crawlLive(cf) {
  const a = "/accounts/" + cf.account;
  const snap = { at: new Date().toISOString(), workers: [], d1: [], kv: [], r2: [], queues: [], vectorize: [], workflows: [], domains: [], routes: [], schema: {}, errors: [] };
  const soft = async (label, fn) => { try { return await fn(); } catch (e) { snap.errors.push(label + ": " + String(e.message || e).slice(0, 200)); return null; } };
  const scripts = await cf.list(a + "/workers/scripts");
  for (const s of scripts) {
    const name = s.id;
    const w = { name, modified_on: s.modified_on, handlers: s.handlers || [], usage_model: s.usage_model || null, bindings: [], crons: [], workers_dev: null, compatibility_date: null, observability: null };
    const st = await soft("settings " + name, async () => (await cf.req("GET", a + "/workers/scripts/" + name + "/settings")).j.result);
    if (st) { w.bindings = (st.bindings || []).map(safeBinding); w.compatibility_date = st.compatibility_date || null; w.observability = st.observability ? { enabled: !!st.observability.enabled, logs: !!(st.observability.logs && st.observability.logs.enabled), traces: !!(st.observability.traces && st.observability.traces.enabled) } : null; w.tail_consumers = (st.tail_consumers || []).map((t) => t.service).filter(Boolean); }
    const sc = await soft("schedules " + name, async () => (await cf.req("GET", a + "/workers/scripts/" + name + "/schedules")).j.result);
    if (sc) w.crons = (sc.schedules || []).map((x) => normCron(x.cron));
    const sd = await soft("subdomain " + name, async () => (await cf.req("GET", a + "/workers/scripts/" + name + "/subdomain")).j.result);
    if (sd) w.workers_dev = !!sd.enabled;
    snap.workers.push(w);
  }
  snap.d1 = (await soft("d1", () => cf.list(a + "/d1/database")) || []).map((d) => ({ name: d.name, id: d.uuid, size: d.file_size || null }));
  snap.kv = (await soft("kv", () => cf.list(a + "/storage/kv/namespaces")) || []).map((k) => ({ id: k.id, title: k.title }));
  snap.r2 = ((await soft("r2", async () => (await cf.req("GET", a + "/r2/buckets?per_page=1000")).j.result)) || {}).buckets?.map((b) => ({ name: b.name })) || [];
  snap.queues = (await soft("queues", () => cf.list(a + "/queues")) || []).map((q) => ({ name: q.queue_name, producers: (q.producers || []).map((p) => p.script || p.service).filter(Boolean), consumers: (q.consumers || []).map((c) => c.script || c.service).filter(Boolean) }));
  snap.vectorize = (await soft("vectorize", async () => (await cf.req("GET", a + "/vectorize/v2/indexes")).j.result) || []).map((v) => ({ name: v.name, dimensions: v.config && v.config.dimensions || null }));
  snap.workflows = (await soft("workflows", () => cf.list(a + "/workflows")) || []).map((w) => ({ name: w.name, script: w.script_name || null, class_name: w.class_name || null }));
  snap.domains = (await soft("domains", () => cf.list(a + "/workers/domains")) || []).map((d) => ({ hostname: d.hostname, service: d.service, zone: d.zone_name }));
  const zones = await soft("zones", () => cf.list("/zones?account.id=" + cf.account)) || [];
  for (const z of zones) {
    const rs = await soft("routes " + z.name, async () => (await cf.req("GET", "/zones/" + z.id + "/workers/routes")).j.result);
    for (const r of rs || []) if (r.script) snap.routes.push({ pattern: r.pattern, script: r.script, zone: z.name });
  }
  for (const d of snap.d1) {
    if (SCHEMA_REFUSED.includes(d.name)) continue;
    const rows = await soft("schema " + d.name, () => cf.d1(d.id, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','view','trigger') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"));
    if (rows) snap.schema[d.name] = rows.map((r) => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: r.type === "table" ? null : r.sql }));
  }
  return snap;
}

const LIVE_RES = {
  d1: (b) => ({ res: "d1:" + (b.database_name || b.database_id), kind: "d1" }),
  kv_namespace: (b) => ({ res: "kv:" + b.namespace_id, kind: "kv" }),
  r2_bucket: (b) => ({ res: "r2:" + b.bucket_name, kind: "r2" }),
  vectorize: (b) => ({ res: "vz:" + b.index_name, kind: "vectorize" }),
  service: (b) => ({ res: "worker:" + b.service, kind: "worker" }),
  queue: (b) => ({ res: "queue:" + b.queue_name, kind: "queue" }),
  durable_object_namespace: (b, w) => ({ res: "do:" + (b.script_name || w) + "." + b.class_name, kind: "durable_object" }),
  workflow: (b) => ({ res: "wf:" + b.workflow_name, kind: "workflow" }),
  ai: () => ({ res: "svc:workers-ai", kind: "platform" }),
  browser: () => ({ res: "svc:browser-run", kind: "platform" }),
  send_email: () => ({ res: "svc:send-email", kind: "platform" }),
  worker_loader: () => ({ res: "svc:worker-loader", kind: "platform" }),
  analytics_engine: (b) => ({ res: "ae:" + (b.dataset || b.name), kind: "analytics_engine" }),
};

export function addLive(g, snap) {
  const d1Name = new Map(snap.d1.map((d) => [d.id, d.name]));
  for (const d of snap.d1) g.node("d1:" + d.name, "d1", d.name, { attrs: { database_id: d.id, size_bytes: d.size } });
  for (const k of snap.kv) g.node("kv:" + k.id, "kv", k.title, { attrs: { namespace_id: k.id } });
  for (const r of snap.r2) g.node("r2:" + r.name, "r2", r.name);
  for (const v of snap.vectorize) g.node("vz:" + v.name, "vectorize", v.name, { attrs: { dimensions: v.dimensions } });
  for (const w of snap.workflows) { g.node("wf:" + w.name, "workflow", w.name, { attrs: { script: w.script, class_name: w.class_name } }); if (w.script) g.edge("worker:" + w.script, "hosts_workflow", "wf:" + w.name, { confidence: "OBSERVED" }); }
  for (const q of snap.queues) {
    g.node("queue:" + q.name, "queue", q.name);
    for (const c of q.consumers) g.edge("worker:" + c, "consumes", "queue:" + q.name, { confidence: "OBSERVED" });
    for (const p of q.producers) g.edge("worker:" + p, "produces", "queue:" + q.name, { confidence: "OBSERVED" });
  }
  for (const w of snap.workers) {
    const wid = "worker:" + w.name;
    g.node(wid, "worker", w.name, { worker: w.name, attrs: { live: true, modified_on: w.modified_on, handlers: w.handlers, compatibility_date: w.compatibility_date, workers_dev: w.workers_dev, observability: w.observability, tail_consumers: w.tail_consumers || [] } });
    for (const b of w.bindings) {
      if (!b.name) continue;
      if (b.type === "secret_text" || b.type === "secret_key") {
        const sid = "secret:" + w.name + "." + b.name;
        g.node(sid, "secret", b.name, { worker: w.name, attrs: { type: b.type } });
        g.edge(wid, "has_secret", sid, { confidence: "OBSERVED" });
        continue;
      }
      const bid = "binding:" + w.name + "." + b.name;
      g.node(bid, "binding", b.name, { worker: w.name, attrs: { type: b.type } });
      g.edge(wid, "has_binding", bid, { confidence: "OBSERVED" });
      const spec = LIVE_RES[b.type] && LIVE_RES[b.type](b.type === "d1" ? Object.assign({}, b, { database_name: d1Name.get(b.database_id) || b.database_id }) : b, w.name);
      if (spec) { if (!g.nodes.has(spec.res)) g.node(spec.res, spec.kind, spec.res.split(":").slice(1).join(":")); g.edge(bid, "binds", spec.res, { confidence: "OBSERVED" }); }
    }
    for (const c of w.crons) { const cid = "cron:" + w.name + "@" + c; g.node(cid, "cron", c, { worker: w.name }); g.edge(wid, "has_cron", cid, { confidence: "OBSERVED" }); }
    for (const t of w.tail_consumers || []) g.edge(wid, "tails_to", "worker:" + t, { confidence: "OBSERVED" });
  }
  for (const r of snap.routes) { const id = "route:" + r.pattern; g.node(id, "route", r.pattern, { attrs: { host: routeHost(r.pattern), zone: r.zone } }); g.edge("worker:" + r.script, "serves", id, { confidence: "OBSERVED" }); }
  for (const d of snap.domains) { const id = "domain:" + d.hostname; g.node(id, "custom_domain", d.hostname, { attrs: { host: d.hostname, zone: d.zone } }); g.edge("worker:" + d.service, "serves", id, { confidence: "OBSERVED" }); }
  const triggersByDb = {};
  for (const [db, objs] of Object.entries(snap.schema)) {
    triggersByDb[db] = [];
    for (const o of objs) {
      if (o.type === "table") { g.node("d1t:" + db + "." + o.name, "d1_table", o.name, { attrs: { database: db, live: true } }); g.edge("d1:" + db, "contains", "d1t:" + db + "." + o.name, { confidence: "OBSERVED" }); }
      else if (o.type === "view") {
        const id = "d1v:" + db + "." + o.name;
        g.node(id, "d1_view", o.name, { attrs: { database: db, live: true } }); g.edge("d1:" + db, "contains", id, { confidence: "OBSERVED" });
        for (const t of sqlTables(o.sql).reads) g.edge(id, "reads", (t.toLowerCase().startsWith("v_") ? "d1v:" : "d1t:") + db + "." + t, { confidence: "OBSERVED" });
      } else if (o.type === "trigger") {
        const p = parseTrigger(o.sql);
        const id = "d1trg:" + db + "." + o.name;
        g.node(id, "d1_trigger", o.name, { attrs: { database: db, live: true, event: p && p.event, timing: p && p.timing } });
        g.edge("d1:" + db, "contains", id, { confidence: "OBSERVED" });
        if (p) {
          g.edge(id, "fires_on", "d1t:" + db + "." + p.table, { confidence: "OBSERVED", attrs: { event: p.event } });
          for (const t of p.writes) g.edge(id, "writes", "d1t:" + db + "." + t, { confidence: "OBSERVED" });
          for (const t of p.reads) g.edge(id, "reads", "d1t:" + db + "." + t, { confidence: "OBSERVED" });
          triggersByDb[db].push(p);
        }
      }
    }
  }
  return { triggersByDb };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Findings (need both scopes for the drift kinds; each kind is skipped when its inputs are missing).
// ---------------------------------------------------------------------------------------------------------------------------
export function computeFindings(ctx) {
  const { codeWorkers, snap, triggersByDb, codeSql, liveTables } = ctx;
  const out = [];
  const add = (kind, subject, severity, detail) => out.push({ id: kind + ":" + subject, kind, subject, severity, detail });
  const liveByName = snap ? new Map(snap.workers.map((w) => [w.name, w])) : null;
  if (liveByName) {
    for (const [name, cw] of codeWorkers) {
      const lw = liveByName.get(name);
      if (!lw) { add("undeployed-dir", name, "warn", "worker directory has worker.js and wrangler.toml and no RETIRED/FOLDED marker, but no script of that name is deployed"); continue; }
      const live = new Map(lw.bindings.filter((b) => b.name).map((b) => [b.name, b.type]));
      for (const [b, type] of cw.declared) {
        if (type === "plain_text") continue; // vars are compared by presence only below
        const lt = live.get(b);
        if (!lt) add("binding-declared-not-live", name + "." + b, "warn", "wrangler.toml declares " + b + " (" + type + ") but the deployed script has no binding of that name");
      }
      for (const [b, lt] of live) {
        if (lt === "secret_text" || lt === "secret_key" || lt === "plain_text" || lt === "json" || lt === "inherit" || lt === "version_metadata") continue;
        if (!cw.declared.has(b)) add("binding-live-not-declared", name + "." + b, "info", "the deployed script carries " + b + " (" + lt + ") that wrangler.toml does not declare; the next canonical deploy may drop it");
      }
      const lc = new Set(lw.crons), dc = new Set(cw.crons);
      const missing = [...dc].filter((c) => !lc.has(c)), extra = [...lc].filter((c) => !dc.has(c));
      if (missing.length || extra.length) add("cron-drift", name, "warn", "declared " + JSON.stringify([...dc]) + " live " + JSON.stringify([...lc]));
      for (const [env, line] of cw.envReads) {
        if (live.has(env) || cw.declared.has(env)) continue;
        if (["CF_PAGES", "CF_VERSION_METADATA"].includes(env)) continue;
        // Demote optional config reads to info env-optional-unset.
        const optional = !!(cw.optionalEnv && cw.optionalEnv.has(env));
        add(
          optional ? "env-optional-unset" : "env-undeclared",
          name + "." + env,
          optional ? "info" : "warn",
          optional
            ? "worker.js reads env." + env + " (line " + line + ") only as an optional config read with a default; neither wrangler.toml nor the deployed script defines it, so the default is used"
            : "worker.js reads env." + env + " (line " + line + ") but neither wrangler.toml nor the deployed script defines it (no binding, var or secret of that name), so it is undefined at run time"
        );
      }
      if (!cw.computedEnv) for (const [b, type] of live) {
        if (["secret_text", "secret_key", "plain_text", "json"].includes(type)) continue;
        if (!cw.envReads.has(b) && !cw.bindingUses.has(b)) add("binding-unused", name + "." + b, "info", "binding " + b + " (" + type + ") is never read in worker.js");
      }
    }
    const codeNames = new Set(codeWorkers.keys());
    for (const w of snap.workers) if (!codeNames.has(w.name)) add("untracked-worker", w.name, "warn", "deployed script with no live directory in the repository (no tracked source the canonical path can redeploy)");
    const bound = new Set();
    for (const w of snap.workers) for (const b of w.bindings) {
      if (b.type === "d1") bound.add("d1:" + b.database_id);
      if (b.type === "kv_namespace") bound.add("kv:" + b.namespace_id);
      if (b.type === "r2_bucket") bound.add("r2:" + b.bucket_name);
      if (b.type === "vectorize") bound.add("vz:" + b.index_name);
      if (b.type === "queue") bound.add("queue:" + b.queue_name);
    }
    for (const q of snap.queues) for (const c of q.consumers) bound.add("queue:" + q.name);
    for (const d of snap.d1) if (!bound.has("d1:" + d.id)) add("resource-orphan", "d1:" + d.name, "info", "D1 database bound to no deployed worker");
    for (const k of snap.kv) if (!bound.has("kv:" + k.id)) add("resource-orphan", "kv:" + k.title, "info", "KV namespace bound to no deployed worker");
    for (const r of snap.r2) if (!bound.has("r2:" + r.name)) add("resource-orphan", "r2:" + r.name, "info", "R2 bucket bound to no deployed worker (it may still be read through the API)");
    for (const v of snap.vectorize) if (!bound.has("vz:" + v.name)) add("resource-orphan", "vz:" + v.name, "info", "Vectorize index bound to no deployed worker");
    for (const q of snap.queues) if (!bound.has("queue:" + q.name)) add("resource-orphan", "queue:" + q.name, "info", "queue with no producer binding and no consumer");
  }
  if (codeSql && liveTables) {
    // GUARDED-TABLE-READ-1: a table is only demoted when every unit that touches it probes for it first; one unguarded reader keeps the warn.
    const unguardedTable = new Set(codeSql.filter((x) => !x.guarded).map((x) => x.worker + ":" + x.db + "." + x.table.toLowerCase()));
    for (const s of codeSql) {
      const known = liveTables.get(s.db);
      // FLEET-GRAPH-FINDINGS-1: only treat a string as a SQL statement (and its tables as real references)
      // when it starts with a statement keyword; prose or example strings that merely look like SQL are skipped.
      if (!known || known.has(s.table.toLowerCase()) || s.createdInCode) continue;
      if (s.sql && !/^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH|CREATE|ALTER|DROP|PRAGMA)\b/i.test(s.sql)) continue;
      const guarded = !!s.guarded && !unguardedTable.has(s.worker + ":" + s.db + "." + s.table.toLowerCase());
      add("sql-table-missing", s.worker + ":" + s.db + "." + s.table, s.confidence === "EXTRACTED" && !guarded ? "warn" : "info", s.unit + " " + s.rel + " " + s.table + " in " + s.db + ", which has no table or view of that name" + (guarded ? " (guarded: the function checks sqlite_master for the table first and skips the read while it is absent)" : ""));
    }
  }
  if (triggersByDb) for (const [db, trs] of Object.entries(triggersByDb)) {
    if (!trs.length) continue;
    const r = triggerDepth(trs);
    add("trigger-depth", db, r.cycles.length ? "warn" : "info", "longest trigger cascade " + r.depth + " (" + r.path.join(" -> ") + ")" + (r.cycles.length ? "; cycles: " + r.cycles.join(" | ") : "") + "; " + trs.length + " triggers");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Storage (qnfo-graph D1) and export.
// ---------------------------------------------------------------------------------------------------------------------------
export const SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS fg_node (id TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, worker TEXT, path TEXT, line INTEGER, attrs TEXT, source TEXT NOT NULL, h TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (id, scope))",
  "CREATE INDEX IF NOT EXISTS fg_node_kind_name ON fg_node(kind, name)",
  "CREATE INDEX IF NOT EXISTS fg_node_worker ON fg_node(worker)",
  "CREATE INDEX IF NOT EXISTS fg_node_name ON fg_node(name)",
  "CREATE TABLE IF NOT EXISTS fg_edge (src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, scope TEXT NOT NULL, confidence TEXT NOT NULL, source TEXT NOT NULL, path TEXT, attrs TEXT, h TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (src, rel, dst, scope))",
  "CREATE INDEX IF NOT EXISTS fg_edge_dst ON fg_edge(dst, rel)",
  "CREATE TABLE IF NOT EXISTS fg_finding (id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, severity TEXT NOT NULL, detail TEXT, h TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS fg_state (scope TEXT PRIMARY KEY, sha TEXT, built_at TEXT NOT NULL, nodes INTEGER, edges INTEGER, written INTEGER, deleted INTEGER, ms INTEGER, status TEXT NOT NULL, detail TEXT, version TEXT)",
];
const NODE_COLS = ["id", "scope", "kind", "name", "worker", "path", "line", "attrs", "source", "h", "updated_at"];
const EDGE_COLS = ["src", "rel", "dst", "scope", "confidence", "source", "path", "attrs", "h", "updated_at"];
const MAX_STMT = 90000;
const DELETE_TERMS = 80; // under D1's expression depth limit of 100 (FLEET-GRAPH-DELETE-DEPTH-1)

export function insertStatements(table, cols, rows) {
  const out = []; let cur = []; let size = 0;
  const head = "INSERT OR REPLACE INTO " + table + " (" + cols.join(", ") + ") VALUES ";
  for (const r of rows) {
    const v = "(" + cols.map((c) => sqlStr(r[c])).join(", ") + ")";
    if (cur.length && size + v.length > MAX_STMT) { out.push(head + cur.join(", ")); cur = []; size = 0; }
    cur.push(v); size += v.length + 2;
  }
  if (cur.length) out.push(head + cur.join(", "));
  return out;
}
export function deleteStatements(table, where, keyCols, keys, terms = DELETE_TERMS) {
  const out = []; let cur = []; let size = 0;
  const flush = () => { if (!cur.length) return; out.push("DELETE FROM " + table + " WHERE " + where + " AND (" + cur.join(" OR ") + ")"); cur = []; size = 0; };
  for (const k of keys) {
    const parts = keyCols.length === 1 ? [k] : k.split(EDGE_SEP);
    const cond = "(" + keyCols.map((c, i) => c + " = " + sqlStr(parts[i])).join(" AND ") + ")";
    // FLEET-GRAPH-DELETE-DEPTH-1: SQLite parses "a OR b OR ..." as a tree as deep as its terms, and D1 refuses depth over 100
    // ("Expression tree is too large"), so a run deleting more than ~99 rows failed every push from 2026-10-19 11:15Z (760a20a).
    if (size + cond.length > MAX_STMT || cur.length >= terms) flush();
    cur.push(cond); size += cond.length + 4;
  }
  flush();
  return out;
}

// FLEET-GRAPH-DELETE-ADAPT-1 (1.0.2, agent_issues 100146): 1.0.1 fixed the depth at 80 terms, a number that came from one live measurement
// (96 terms of a three-column key pass, 99 fail). A DELETE D1 still refuses with "Expression tree is too large" (its limit moved, or a
// WHERE grew) now retries the same keys with half the terms per statement, down to one, instead of failing every push until someone
// edits DELETE_TERMS. DELETE of a key that is already gone changes nothing, so a retried chunk is safe. Any other error is thrown at once.
export const DEPTH_ERR = /Expression tree is too large/i;
export async function runDeletes(cf, dbId, table, where, keyCols, keys, terms = DELETE_TERMS) {
  let n = Math.max(1, terms), done = 0, shrunk = 0;
  while (done < keys.length) {
    const chunk = keys.slice(done, done + n);
    try {
      for (const st of deleteStatements(table, where, keyCols, chunk, n)) await cf.d1(dbId, st);
      done += chunk.length;
    } catch (e) {
      if (!DEPTH_ERR.test(String((e && e.message) || e)) || n <= 1) throw e;
      n = Math.max(1, Math.floor(n / 2)); shrunk++;
    }
  }
  return { terms: n, shrunk };
}

async function storedHashes(cf, scope) {
  const nodes = new Map(), edges = new Map();
  // A dry run before the first build finds no fg_* tables: that is an empty store, not an error.
  try { await cf.d1(GRAPH_DB_ID, "SELECT 1 FROM fg_node LIMIT 1"); } catch (e) { if (/no such table/i.test(String(e.message))) return { nodes, edges }; throw e; }
  for (let off = 0; ; off += 10000) {
    const rows = await cf.d1(GRAPH_DB_ID, "SELECT id, h FROM fg_node WHERE scope = ?1 ORDER BY id LIMIT 10000 OFFSET " + off, [scope]);
    for (const r of rows) nodes.set(r.id, r.h);
    if (rows.length < 10000) break;
  }
  for (let off = 0; ; off += 10000) {
    const rows = await cf.d1(GRAPH_DB_ID, "SELECT src, rel, dst, h FROM fg_edge WHERE scope = ?1 ORDER BY src, rel, dst LIMIT 10000 OFFSET " + off, [scope]);
    for (const r of rows) edges.set(r.src + EDGE_SEP + r.rel + EDGE_SEP + r.dst, r.h);
    if (rows.length < 10000) break;
  }
  return { nodes, edges };
}

export async function writeScope(cf, scope, built, opts) {
  const stored = await storedHashes(cf, scope);
  const dn = diffRows(built.nodes, stored.nodes), de = diffRows(built.edges, stored.edges);
  const whereScope = "scope = " + sqlStr(scope);
  const inserts = [...insertStatements("fg_node", NODE_COLS, dn.upsert), ...insertStatements("fg_edge", EDGE_COLS, de.upsert)];
  const stmts = [
    ...deleteStatements("fg_node", whereScope, ["id"], dn.del),
    ...deleteStatements("fg_edge", whereScope, ["src", "rel", "dst"], de.del),
    ...inserts,
  ];
  const planned = dn.upsert.length + de.upsert.length + dn.del.length + de.del.length;
  const res = { scope, upsert_nodes: dn.upsert.length, upsert_edges: de.upsert.length, del_nodes: dn.del.length, del_edges: de.del.length, statements: stmts.length, planned };
  if (planned > opts.maxWrites) { res.refused = "planned " + planned + " row changes > --max-writes " + opts.maxWrites; return res; }
  if (opts.dryRun) { res.dry_run = true; return res; }
  const dnr = await runDeletes(cf, GRAPH_DB_ID, "fg_node", whereScope, ["id"], dn.del);
  const der = await runDeletes(cf, GRAPH_DB_ID, "fg_edge", whereScope, ["src", "rel", "dst"], de.del);
  if (dnr.shrunk || der.shrunk) res.delete_terms_shrunk = { nodes: dnr.terms, edges: der.terms };
  for (const s of inserts) await cf.d1(GRAPH_DB_ID, s);
  return res;
}

export async function writeFindings(cf, findings, now, dryRun) {
  const stored = new Map((await cf.d1(GRAPH_DB_ID, "SELECT id, h, first_seen FROM fg_finding").catch((e) => { if (dryRun && /no such table/i.test(String(e.message))) return []; throw e; })).map((r) => [r.id, r]));
  const rows = findings.map((f) => { const h = hashOf([f.kind, f.subject, f.severity, f.detail]); const prev = stored.get(f.id); return { id: f.id, kind: f.kind, subject: f.subject, severity: f.severity, detail: f.detail, h, first_seen: prev ? prev.first_seen : now, last_seen: now, changed: !prev || prev.h !== h }; });
  const keep = new Set(rows.map((r) => r.id));
  const del = [...stored.keys()].filter((k) => !keep.has(k));
  // last_seen is refreshed on every run only for changed rows; unchanged rows keep their stored last_seen (fg_state says when the run was).
  const up = rows.filter((r) => r.changed);
  const inserts = insertStatements("fg_finding", ["id", "kind", "subject", "severity", "detail", "h", "first_seen", "last_seen"], up);
  if (!dryRun) {
    await runDeletes(cf, GRAPH_DB_ID, "fg_finding", "1 = 1", ["id"], del);
    for (const s of inserts) await cf.d1(GRAPH_DB_ID, s);
  }
  return { findings: rows.length, changed: up.length, removed: del.length, warn: rows.filter((r) => r.severity === "warn").length };
}

export function nodeLink(graphs, meta) {
  const nodes = new Map(); const links = [];
  for (const g of graphs) {
    for (const [id, n] of g.nodes) { const prev = nodes.get(id); nodes.set(id, Object.assign({}, prev || {}, { id, kind: n.kind, name: n.name, worker: n.worker, path: n.path, line: n.line }, { scopes: [...new Set([...(prev ? prev.scopes : []), g.scope])] })); }
    for (const e of g.edges.values()) links.push({ source: e.src, target: e.dst, key: e.rel, confidence: e.confidence, scope: g.scope, path: e.path });
  }
  return { directed: true, multigraph: true, graph: meta, nodes: [...nodes.values()], links };
}

// Portable copy: the same fg_* schema in a local SQLite file (node:sqlite, Node >= 22.5), queryable with sqlite3 or
// served by qnfo-memory-mcp's queries through a D1-shaped shim. Moving off Cloudflare means pointing the queries here.
export async function writeSqlite(file, built, findings, now, sha) {
  const { DatabaseSync } = await import("node:sqlite");
  if (existsSync(file)) { const { unlinkSync } = await import("node:fs"); unlinkSync(file); }
  const db = new DatabaseSync(file);
  for (const st of SCHEMA_SQL) db.exec(st);
  db.exec("BEGIN");
  for (const [scope, b] of Object.entries(built)) {
    for (const st of insertStatements("fg_node", NODE_COLS, [...b.nodes.values()])) db.exec(st);
    for (const st of insertStatements("fg_edge", EDGE_COLS, [...b.edges.values()])) db.exec(st);
    db.prepare("INSERT OR REPLACE INTO fg_state (scope, sha, built_at, nodes, edges, written, deleted, ms, status, detail, version) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'ok', 'sqlite export', ?)").run(scope, sha, now, b.nodes.size, b.edges.size, b.nodes.size + b.edges.size, VERSION);
  }
  for (const st of insertStatements("fg_finding", ["id", "kind", "subject", "severity", "detail", "h", "first_seen", "last_seen"], findings.map((f) => Object.assign({}, f, { h: hashOf([f.kind, f.subject, f.severity, f.detail]), first_seen: now, last_seen: now })))) db.exec(st);
  db.exec("COMMIT");
  db.close();
}

async function r2Put(cf, key, buf, ctype) {
  const r = await cf.req("PUT", "/accounts/" + cf.account + "/r2/buckets/" + SNAPSHOT_BUCKET + "/objects/" + key.split("/").map(encodeURIComponent).join("/"), buf, ctype || "application/gzip", true);
  if (!r.ok) throw new Error("R2 PUT " + key + " -> " + r.status);
}

async function auditHeartbeat(cf, ok, detail, warn) {
  const ts = new Date().toISOString();
  await cf.d1(AUDIT_DB_ID, "INSERT INTO fleet_heartbeat (worker, version, ts, ok) VALUES ('fleet-graph', ?1, ?2, ?3) ON CONFLICT(worker) DO UPDATE SET version = excluded.version, ts = excluded.ts, ok = excluded.ok", [VERSION, ts, ok ? 1 : 0]);
  if (warn !== null && warn !== undefined) await cf.d1(AUDIT_DB_ID, "UPDATE metric_registry SET last_value = ?1, last_refreshed = ?2, state = 'MEASURED' WHERE metric = 'fleet_graph_findings_warn'", [String(warn), ts]);
  await cf.d1(AUDIT_DB_ID, "INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'fleet-graph', ?3, NULL, 'fleet-graph', ?4)", ["fleet-graph-" + Date.now().toString(36), ts, String(detail).slice(0, 1800), ok ? "ok" : "error"]).catch((e) => console.error("cloud_ops_events insert failed: " + String(e.message || e).slice(0, 200)));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------------------------------------------------------
function arg(argv, name, dflt) { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; }

export async function buildCode(root, deps, live) {
  const g = new Graph("code");
  const workers = liveWorkerDirs(root);
  const codeWorkers = new Map();
  const routes = [];
  const parsedToml = new Map();
  for (const w of workers) {
    const dir = w === "." ? "" : w;
    const toml = deps.TOML.parse(readFileSync(join(root, dir, "wrangler.toml"), "utf8"));
    parsedToml.set(w, toml);
    for (const r of [].concat(toml.routes || [])) { const pat = typeof r === "string" ? r : r && r.pattern; if (pat) routes.push([routeHost(pat), toml.name || w]); }
  }
  // SYSTEM-MAP-1: a d1_databases entry with only database_id (personal-companion PERSONAL) became node "d1:undefined" and lost its table edges; resolve the name from the other tomls and the live list.
  const d1NameById = new Map();
  for (const d of live ? live.d1 : []) d1NameById.set(d.id, d.name);
  for (const w of workers) for (const b of [].concat(parsedToml.get(w).d1_databases || [])) if (b.database_id && b.database_name) d1NameById.set(b.database_id, b.database_name);
  for (const w of workers) for (const b of [].concat(parsedToml.get(w).d1_databases || [])) if (!b.database_name && b.database_id && d1NameById.has(b.database_id)) b.database_name = d1NameById.get(b.database_id);
  const codeNames = workers.map((w) => parsedToml.get(w).name || w);
  if (live) { for (const r of live.routes) routes.push([routeHost(r.pattern), r.script]); for (const d of live.domains) routes.push([d.hostname.toLowerCase(), d.service]); }
  const hosts = hostIndex(codeNames.concat(live ? live.workers.map((x) => x.name) : []), routes);
  const liveTables = liveTableIndex(live);
  const codeSql = [];
  for (const w of workers) {
    const dir = w === "." ? "" : w;
    const worker = parsedToml.get(w).name || w;
    const src = readFileSync(join(root, dir, "worker.js"), "utf8");
    const path = dir ? dir + "/worker.js" : "worker.js";
    const ver = (/var VERSION\s*=\s*["']([^"']+)["']/.exec(src) || [])[1] || null;
    const pillar = (/#\s*charter-pillar:\s*([\w-]+)/.exec(readFileSync(join(root, dir, "wrangler.toml"), "utf8")) || [])[1] || null;
    g.node("worker:" + worker, "worker", worker, { worker, path: dir || ".", attrs: { version: ver, pillar, bytes: src.length } });
    const wr = addWrangler(g, worker, parsedToml.get(w), (dir ? dir + "/" : "") + "wrangler.toml");
    const d1ByBinding = new Map();
    for (const b of [].concat(parsedToml.get(w).d1_databases || [])) d1ByBinding.set(b.binding, b.database_name);
    const before = new Set(g.edges.keys());
    const r = addWorkerCode(g, worker, src, path, { acorn: deps.acorn, walk: deps.walk, declared: wr.declared, hosts, d1ByBinding, liveTables });
    const bindingUses = new Set();
    for (const [k, e] of g.edges) {
      if (before.has(k)) continue;
      if (e.rel === "uses_binding") bindingUses.add(e.dst.split(".").slice(1).join("."));
      if ((e.rel === "reads" || e.rel === "writes" || e.rel === "creates") && e.dst.startsWith("d1t:")) {
        const [db, ...t] = e.dst.slice(4).split(".");
        codeSql.push({ worker, unit: e.src.split("#")[1], rel: e.rel, db, table: t.join("."), confidence: e.confidence, guarded: !!(e.attrs && e.attrs.guarded) });
      }
    }
    const created = new Set(codeSql.filter((s) => s.worker === worker && s.rel === "creates").map((s) => s.db + "." + s.table.toLowerCase()));
    for (const s of codeSql) if (s.worker === worker && created.has(s.db + "." + s.table.toLowerCase())) s.createdInCode = true;
    codeWorkers.set(worker, { declared: wr.declared, crons: wr.crons, envReads: r.envReads, computedEnv: r.computedEnv, optionalEnv: r.optionalEnv, bindingUses });
  }
  addMigrations(g, root);
  addWorkflows(g, root, liveTables);
  const retired = readdirSync(root).filter((d) => !d.startsWith(".") && (existsSync(join(root, d, "RETIRED")) || existsSync(join(root, d, "FOLDED"))));
  const repoDocs = addRepoDocs(g, root, codeNames, retired); // REPO-GRAPH-1: repo:* and doc:* nodes from repos.json and the Markdown tree
  g.stats.workers = workers.length; g.stats.repos = repoDocs.repos; g.stats.docs = repoDocs.docs;
  return { g, codeWorkers, codeSql, liveTables, repoDocs };
}

export function liveTableIndex(live) {
  if (!live) return null;
  const m = new Map();
  for (const [db, objs] of Object.entries(live.schema || {})) m.set(db, new Set(objs.filter((o) => o.type === "table" || o.type === "view").map((o) => o.name.toLowerCase())));
  return m;
}

async function loadDeps() {
  const acorn = await import("acorn"); const walk = await import("acorn-walk"); const TOML = await import("smol-toml");
  return { acorn, walk, TOML };
}

export async function main(argv) {
  const t0 = Date.now();
  const root = arg(argv, "--root", join(fileURLToPath(new URL(".", import.meta.url)), ".."));
  const scope = arg(argv, "--scope", "all");
  const dryRun = argv.includes("--dry-run");
  const maxWrites = Number(arg(argv, "--max-writes", "150000"));
  const olderThan = arg(argv, "--if-older-than", null);
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "";
  const cf = token && account ? cfClient(token, account) : null;
  const sha = process.env.GITHUB_SHA || null;
  const report = { marker: "FLEET-GRAPH-1", version: VERSION, scope, dry_run: dryRun, sha };
  if (cf && olderThan !== null) {
    const rows = await cf.d1(GRAPH_DB_ID, "SELECT (julianday('now') - julianday(MAX(built_at))) * 1440 AS age_min FROM fg_state WHERE status = 'ok' AND scope = 'live'").catch(() => []);
    const age = rows[0] && rows[0].age_min;
    if (age !== null && age !== undefined && age < Number(olderThan)) { report.skipped = "last ok live build " + Math.round(age) + " min ago (< " + olderThan + ")"; console.log(JSON.stringify(report)); return 0; }
  }
  // KG-CURATE-2: the content knowledge graph's curator has its own workflow (.github/workflows/kg-curate.yml), because this job is cancelled by
  // every newer push to main (34 of its last 40 runs on 2026-11-05). `--scope kg` still runs it from here, alone.
  const runKg = async () => {
    if (!cf || scope !== "kg") return;
    try { report.kg = await curateWithCloudflare(cf, { dryRun, force: argv.includes("--kg-force") }); }
    catch (e) { report.kg = { ok: false, error: String(e && e.stack || e).slice(0, 600) }; }
  };
  if (scope === "kg") { await runKg(); console.log(JSON.stringify(report)); return report.kg && report.kg.ok === false ? 1 : 0; }
  if (cf && !dryRun) for (const s of SCHEMA_SQL) await cf.d1(GRAPH_DB_ID, s);
  const now = new Date().toISOString();
  let live = null, liveGraph = null, triggersByDb = null;
  try {
    if (scope === "all" || scope === "live") {
      const fixture = arg(argv, "--live-fixture", null);
      if (fixture) live = JSON.parse(readFileSync(fixture, "utf8"));
      else if (cf) live = await crawlLive(cf);
      if (live) { liveGraph = new Graph("live"); ({ triggersByDb } = addLive(liveGraph, live)); report.live = { workers: live.workers.length, d1: live.d1.length, schema_dbs: Object.keys(live.schema).length, errors: live.errors.slice(0, 10) }; }
      else report.live = { skipped: "no CLOUDFLARE_API_TOKEN / account and no --live-fixture" };
    }
    let code = null;
    if (scope === "all" || scope === "code") {
      const deps = await loadDeps();
      code = await buildCode(root, deps, live);
      report.code = code.g.stats;
    }
    const findings = computeFindings({ codeWorkers: code ? code.codeWorkers : new Map(), snap: code ? live : null, triggersByDb, codeSql: code ? code.codeSql : null, liveTables: code ? code.liveTables : null });
    if (code && code.repoDocs) {
      let liveRepos = null;
      try { liveRepos = await fetchGithubRepos([{ kind: "org", name: "QNFO" }, { kind: "user", name: "rwnq8" }], process.env.GITHUB_TOKEN || "", null); } catch (eGh) { report.repo_registry = { skipped: String(eGh && eGh.message || eGh).slice(0, 120) }; }
      for (const f of repoFindings(loadManifest(root), code.repoDocs, liveRepos)) findings.push(f);
    }
    report.findings = findings.reduce((m, f) => { m[f.kind] = (m[f.kind] || 0) + 1; return m; }, {});
    report.findings_warn = findings.filter((f) => f.severity === "warn").length;
    const built = {};
    if (code) built.code = code.g.finalize(now);
    if (liveGraph) built.live = liveGraph.finalize(now);
    report.size = Object.fromEntries(Object.entries(built).map(([k, v]) => [k, { nodes: v.nodes.size, edges: v.edges.size }]));
    // SYSTEM-MAP-1: the whole system on one page (docs/SYSTEM-MAP.md + docs/system-map.json), built from this same graph.
    const mapOut = arg(argv, "--system-map-out", null), mapExtraFile = arg(argv, "--map-extra", null);
    let sysMap = null;
    if (code && (mapOut || (cf && !dryRun))) {
      let extra = mapExtraFile ? JSON.parse(readFileSync(mapExtraFile, "utf8")) : (cf ? await collectMapExtra(cf, live, AUDIT_DB_ID) : {});
      sysMap = buildSystemMap({ graphs: [code.g, liveGraph].filter(Boolean), extra, root, sha, now });
      report.system_map = { tokens: sysMap.tokens, errors: (extra.errors || []).slice(0, 5) };
      if (mapOut) { writeFileSync(join(mapOut, "SYSTEM-MAP.md"), sysMap.md); writeFileSync(join(mapOut, "system-map.json"), JSON.stringify(sysMap.json, null, 1) + "\n"); }
    }
    const jsonOut = arg(argv, "--json-out", null);
    const graphs = [code && code.g, liveGraph].filter(Boolean);
    const nl = nodeLink(graphs, { name: "qnfo-fleet-graph", version: VERSION, built_at: now, sha, findings: findings.length });
    if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(Object.assign({}, nl, { findings }), null, 0)); report.json_out = jsonOut; }
    const sqliteOut = arg(argv, "--sqlite-out", null);
    if (sqliteOut) { await writeSqlite(sqliteOut, built, findings, now, sha); report.sqlite_out = sqliteOut; }
    if (cf) {
      report.writes = [];
      for (const [sc, b] of Object.entries(built)) report.writes.push(await writeScope(cf, sc, b, { dryRun, maxWrites }));
      if (code && live) report.findings_store = await writeFindings(cf, findings, now, dryRun);
      if (!dryRun) {
        const ms = Date.now() - t0;
        for (const w of report.writes) {
          const st = w.refused ? "refused" : "ok";
          await cf.d1(GRAPH_DB_ID, "INSERT OR REPLACE INTO fg_state (scope, sha, built_at, nodes, edges, written, deleted, ms, status, detail, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            [w.scope, sha, now, built[w.scope].nodes.size, built[w.scope].edges.size, w.upsert_nodes + w.upsert_edges, w.del_nodes + w.del_edges, ms, st, JSON.stringify(Object.assign({}, w, { stats: w.scope === "code" ? report.code : report.live })).slice(0, 4000), VERSION]);
        }
        if (code && live) await cf.d1(GRAPH_DB_ID, "INSERT OR REPLACE INTO fg_state (scope, sha, built_at, nodes, edges, written, deleted, ms, status, detail, version) VALUES ('findings', ?1, ?2, ?3, 0, ?4, ?5, ?6, 'ok', ?7, ?8)",
          [sha, now, findings.length, report.findings_store.changed, report.findings_store.removed, ms, JSON.stringify({ by_kind: report.findings, warn: report.findings_warn }), VERSION]);
        const gz = gzipSync(Buffer.from(JSON.stringify(nl)));
        report.snapshot_bytes = gz.length;
        try { await r2Put(cf, "fleet-graph/latest.json.gz", gz); await r2Put(cf, "fleet-graph/" + now.slice(0, 10).replace(/-/g, "") + ".json.gz", gz); report.snapshot = SNAPSHOT_BUCKET + "/fleet-graph/latest.json.gz"; }
        catch (e) { report.snapshot_error = String(e.message || e); }
        if (sysMap) { try { await r2Put(cf, "fleet-graph/SYSTEM-MAP.md", Buffer.from(sysMap.md), "text/markdown"); await r2Put(cf, "fleet-graph/system-map.json", Buffer.from(JSON.stringify(sysMap.json)), "application/json"); report.system_map.r2 = "fleet-graph/SYSTEM-MAP.md"; } catch (e) { report.system_map.r2_error = String(e.message || e); } }
        const refused = report.writes.some((w) => w.refused);
        await auditHeartbeat(cf, !refused, JSON.stringify({ version: VERSION, sha, size: report.size, findings_warn: report.findings_warn, ms }), code && live ? report.findings_warn : null).catch((e) => { report.heartbeat_error = String(e.message || e); });
        if (refused) { report.ok = false; console.log(JSON.stringify(report)); return 1; }
      }
    }
    await runKg();
    report.ok = true; report.ms = Date.now() - t0;
    console.log(JSON.stringify(report));
    return 0;
  } catch (e) {
    report.ok = false; report.error = String(e && e.stack || e).slice(0, 1500);
    if (cf && !dryRun) await auditHeartbeat(cf, false, "error: " + report.error.slice(0, 600), null).catch(() => null);
    console.log(JSON.stringify(report));
    return 1;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Selftest (pure parts always; AST parts when acorn and acorn-walk resolve).
// ---------------------------------------------------------------------------------------------------------------------------
export async function selftest(log = console.log) {
  let fail = 0;
  const ok = (c, m) => { if (!c) { fail++; log("FAIL " + m); } };
  await selftestRepos(log, ok);
  const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  ok(liveWorkerDirs(repoRoot).includes("."), "root-level Worker source is inventoried");
  // FLEET-GRAPH-SECRET-1: a secret's value can never reach the graph.
  const canary = "fg-canary-" + "9f3c1a7e";
  const sb = safeBinding({ name: "X_TOKEN", type: "secret_text", text: canary, json: { v: canary }, extra: { deep: canary } });
  ok(!JSON.stringify(sb).includes(canary), "safeBinding drops text/json/objects");
  // FLEET-GRAPH-DELETE-DEPTH-1: no DELETE carries more OR terms than D1's expression depth allows.
  const manyDel = deleteStatements("fg_edge", "scope = 'code'", ["src", "rel", "dst"], Array.from({ length: 250 }, (_, i) => "s" + i + EDGE_SEP + "r" + EDGE_SEP + "d"));
  ok(manyDel.length === 4 && manyDel.every((s) => s.split(" OR ").length <= DELETE_TERMS), "250 edge deletes split into statements of at most " + DELETE_TERMS + " OR terms");
  // FLEET-GRAPH-DELETE-ADAPT-1: a fake D1 that refuses a DELETE deeper than its limit (measured live: a three-column key passes at 96
  // OR terms and fails at 99, so depth is about terms + 4). At the 100 limit nothing is retried; at a limit that moved to 30 the
  // runner halves 80 -> 40 -> 20, every key is still deleted, and an unrelated error is thrown at once.
  const depthErr = () => new Error("D1 a1954b92 -> 400 " + JSON.stringify([{ code: 7500, message: "Expression tree is too large (maximum depth 100): SQLITE_ERROR" }]));
  const fakeD1 = (limit) => { const seen = []; const cf = { seen, refused: 0, async d1(db, sql) { if (sql.split(" OR ").length + 4 > limit) { cf.refused++; throw depthErr(); } for (const m of sql.matchAll(/src = 's(\d+)'/g)) seen.push(Number(m[1])); return []; } }; return cf; };
  const edgeKeys = Array.from({ length: 250 }, (_, i) => "s" + i + EDGE_SEP + "r" + EDGE_SEP + "d");
  const cf100 = fakeD1(100);
  const r100 = await runDeletes(cf100, "db", "fg_edge", "scope = 'code'", ["src", "rel", "dst"], edgeKeys);
  ok(cf100.refused === 0 && r100.shrunk === 0 && r100.terms === DELETE_TERMS && cf100.seen.length === 250, "at D1's depth limit of 100 the 250 deletes need no retry");
  const cf30 = fakeD1(30);
  const r30 = await runDeletes(cf30, "db", "fg_edge", "scope = 'code'", ["src", "rel", "dst"], edgeKeys);
  ok(cf30.refused === 2 && r30.shrunk === 2 && r30.terms === 20 && cf30.seen.length === 250 && new Set(cf30.seen).size === 250, "a limit that moved to 30 halves 80 -> 40 -> 20 and still deletes all 250 keys once: " + JSON.stringify({ refused: cf30.refused, r30, seen: cf30.seen.length }));
  const cf5 = fakeD1(4);
  let tooDeep = null; try { await runDeletes(cf5, "db", "fg_edge", "scope = 'code'", ["src", "rel", "dst"], edgeKeys.slice(0, 3)); } catch (e) { tooDeep = e; }
  ok(tooDeep && DEPTH_ERR.test(tooDeep.message) && cf5.refused > 3, "a limit nothing satisfies ends in the original error after reaching one term per statement");
  let other = null; const cfBad = { n: 0, async d1() { cfBad.n++; throw new Error("D1 a1954b92 -> 400 no such table: fg_edge"); } };
  try { await runDeletes(cfBad, "db", "fg_edge", "scope = 'code'", ["src", "rel", "dst"], edgeKeys); } catch (e) { other = e; }
  ok(other && /no such table/.test(other.message) && cfBad.n === 1, "an error that is not about depth is thrown at once, not retried");
  ok((await runDeletes({ d1: async () => { throw new Error("must not run"); } }, "db", "fg_node", "scope = 'code'", ["id"], [])).shrunk === 0, "no keys, no statements");
  // writeScope and writeFindings use the adaptive runner: a stored scope with 300 stale nodes and edges is deleted under a limit of 30.
  const cfW = { stmts: [], async d1(db, sql) { if (/^DELETE/.test(sql) && sql.split(" OR ").length + 4 > 30) throw depthErr(); if (/SELECT 1 FROM fg_node/.test(sql)) return [{ 1: 1 }]; if (/^SELECT id, h FROM fg_node/.test(sql)) return Array.from({ length: 300 }, (_, i) => ({ id: "n" + i, h: "x" })); if (/^SELECT src, rel, dst, h FROM fg_edge/.test(sql)) return Array.from({ length: 300 }, (_, i) => ({ src: "s" + i, rel: "r", dst: "d", h: "x" })); this.stmts.push(sql); return []; } };
  const wr = await writeScope(cfW, "code", { nodes: new Map(), edges: new Map() }, { maxWrites: 1000, dryRun: false });
  const delStmts = cfW.stmts.filter((s) => /^DELETE/.test(s));
  ok(!wr.refused && wr.del_nodes === 300 && wr.del_edges === 300 && delStmts.length >= 30 && delStmts.every((s) => s.split(" OR ").length + 4 <= 30) && wr.delete_terms_shrunk && wr.delete_terms_shrunk.edges <= 20, "writeScope deletes 300 stale nodes and 300 stale edges under a limit of 30: " + JSON.stringify({ stmts: delStmts.length, shrunk: wr.delete_terms_shrunk, refused: wr.refused }));
  ok(sb.name === "X_TOKEN" && sb.type === "secret_text", "safeBinding keeps name and type");
  const gl = new Graph("live");
  addLive(gl, { workers: [{ name: "w1", bindings: [safeBinding({ name: "S", type: "secret_text", text: canary }), safeBinding({ name: "V", type: "plain_text", text: canary }), safeBinding({ name: "DB", type: "d1", database_id: "id1" })], crons: ["0 * * * *"], handlers: [] }], d1: [{ name: "db1", id: "id1" }], kv: [], r2: [], queues: [], vectorize: [], workflows: [], domains: [], routes: [], schema: { db1: [{ type: "table", name: "t1" }, { type: "trigger", name: "tr1", sql: "CREATE TRIGGER tr1 AFTER INSERT ON t1 BEGIN INSERT INTO t2 (a) SELECT a FROM t3; END" }] } });
  ok(!JSON.stringify([...gl.nodes.values(), ...gl.edges.values()]).includes(canary), "live graph carries no secret or var value");
  ok(gl.edges.has(edgeKey({ src: "binding:w1.DB", rel: "binds", dst: "d1:db1" })), "d1 binding resolves to the database name");
  ok(gl.edges.has(edgeKey({ src: "d1trg:db1.tr1", rel: "writes", dst: "d1t:db1.t2" })), "trigger body writes parsed");
  ok(gl.nodes.has("secret:w1.S") && !gl.nodes.has("binding:w1.S"), "secret is a name-only secret node");
  // SQL extraction
  const t = sqlTables("WITH x AS (SELECT * FROM a) INSERT OR REPLACE INTO b (c) SELECT c FROM x JOIN \"d\" ON 1 WHERE e IN (SELECT 1 FROM json_each(?1))");
  ok(t.reads.includes("a") && t.reads.includes("d") && !t.reads.includes("x") && !t.reads.includes("json_each") && t.writes.includes("b"), "sqlTables reads/writes/cte: " + JSON.stringify(t));
  const u = sqlTables("UPDATE OR IGNORE agent_issues SET status = 'x' WHERE id IN (SELECT id FROM issue_triage)");
  ok(u.writes[0] === "agent_issues" && u.reads.includes("issue_triage"), "sqlTables update");
  ok(sqlTables("SELECT * FROM __DYN__ WHERE 1").dynamic === 1, "dynamic table name counted, not emitted");
  // SQL-LITERAL-TEXT-1: prose inside a string literal is not a table reference
  const lit = sqlTables("UPDATE email_reply_queue SET skip_reason = 'INBOX-REPLY-1: the owner replied from fleet.qnfo.org', note = 'it''s from a bot' WHERE email_id = ?1 AND decision <> 'sent'");
  ok(lit.reads.length === 0 && lit.writes.join() === "email_reply_queue", "sqlTables ignores prose in string literals (from fleet.qnfo.org, from a bot): " + JSON.stringify(lit));
  const lit2 = sqlTables("UPDATE cf_model_catalog SET status='vanished', notes=COALESCE(notes,'')||' | absent from live catalog' WHERE slug=?1");
  ok(lit2.reads.length === 0 && lit2.writes.join() === "cf_model_catalog", "sqlTables ignores 'absent from live catalog' in a SET expression: " + JSON.stringify(lit2));
  const lit3 = sqlTables("SELECT a.id FROM agent_issues a JOIN issue_triage t ON t.issue_id = a.id WHERE a.title LIKE 'from x%' AND t.rc = 'join y'");
  ok(lit3.reads.slice().sort().join() === "agent_issues,issue_triage", "sqlTables keeps real FROM and JOIN tables when literals hold the words from and join: " + JSON.stringify(lit3));
  const d = sqlTables("DELETE FROM work_claims WHERE expires_at < ?1");
  ok(d.writes.includes("work_claims") && !d.reads.includes("work_claims"), "delete is a write");
  ok(looksLikeSql("SELECT id FROM agent_issues WHERE id = ?1") && !looksLikeSql("Select the best option from the list"), "looksLikeSql");
  const p = parseTrigger("CREATE TRIGGER IF NOT EXISTS t_a AFTER UPDATE OF status ON agent_issues WHEN 1 BEGIN UPDATE issue_triage SET x = 1; DELETE FROM work_claims; END");
  ok(p && p.table === "agent_issues" && p.event === "UPDATE" && p.writes.includes("issue_triage") && p.writes.includes("work_claims"), "parseTrigger " + JSON.stringify(p));
  const td = triggerDepth([{ name: "a", table: "t1", writes: ["t2"] }, { name: "b", table: "t2", writes: ["t3"] }, { name: "c", table: "t3", writes: ["t1"] }]);
  ok(td.cycles.length === 1, "trigger cycle detected " + JSON.stringify(td));
  const td2 = triggerDepth([{ name: "a", table: "t1", writes: ["t2"] }, { name: "b", table: "t2", writes: ["t3"] }]);
  ok(td2.depth === 2 && td2.path.join(",") === "t1,a,t2,b,t3", "trigger depth " + JSON.stringify(td2));
  ok(hostOf("https://qnfo-ops.q08.workers.dev/ops/x") === "qnfo-ops.q08.workers.dev" && hostOf("/x") === null, "hostOf");
  ok(routeHost("fleet.qnfo.org/*") === "fleet.qnfo.org" && routeHost("*.qnfo.org/*") === "qnfo.org", "routeHost");
  // diff keeps writes proportional
  const cur = new Map([["a", { h: "1" }], ["b", { h: "2" }]]), st = new Map([["a", "1"], ["b", "x"], ["c", "3"]]);
  const df = diffRows(cur, st);
  ok(df.upsert.length === 1 && df.del.length === 1 && df.del[0] === "c", "diffRows");
  const ins = insertStatements("fg_node", ["id", "name"], [{ id: "a'b", name: "x" }]);
  ok(ins.length === 1 && ins[0].includes("'a''b'"), "sql escaping");
  const del = deleteStatements("fg_edge", "scope = 'code'", ["src", "rel", "dst"], ["s" + EDGE_SEP + "r" + EDGE_SEP + "d"]);
  ok(del[0].includes("src = 's' AND rel = 'r' AND dst = 'd'"), "delete statement for an edge key");
  // findings
  const cw = new Map([["w1", { declared: new Map([["DB", "d1"], ["GONE", "kv_namespace"]]), crons: ["5 * * * *"], envReads: new Map([["DB", 3], ["NOPE", 9], ["S", 4]]), computedEnv: false, bindingUses: new Set(["DB"]) }], ["w9", { declared: new Map(), crons: [], envReads: new Map(), computedEnv: false, bindingUses: new Set() }], ["qnfo-workers", { declared: new Map(), crons: [], envReads: new Map(), computedEnv: false, bindingUses: new Set() }]]);
  const snap = { workers: [{ name: "w1", bindings: [{ name: "DB", type: "d1", database_id: "id1" }, { name: "S", type: "secret_text" }, { name: "EXTRA", type: "r2_bucket", bucket_name: "b" }], crons: ["0 * * * *"] }, { name: "w2", bindings: [], crons: [] }, { name: "qnfo-workers", bindings: [], crons: [] }], d1: [{ name: "db1", id: "id1" }, { name: "lonely", id: "id2" }], kv: [], r2: [], queues: [], vectorize: [] };
  const f = computeFindings({ codeWorkers: cw, snap, triggersByDb: { db1: [{ name: "a", table: "t1", writes: ["t2"] }] }, codeSql: [{ worker: "w1", unit: "u", rel: "reads", db: "db1", table: "missing_t", confidence: "EXTRACTED" }, { worker: "w1", unit: "u", rel: "reads", db: "db1", table: "t1", confidence: "EXTRACTED" }], liveTables: new Map([["db1", new Set(["t1"])]]) });
  const ids = new Set(f.map((x) => x.id));
  for (const want of ["env-undeclared:w1.NOPE", "binding-declared-not-live:w1.GONE", "binding-live-not-declared:w1.EXTRA", "cron-drift:w1", "untracked-worker:w2", "undeployed-dir:w9", "resource-orphan:d1:lonely", "sql-table-missing:w1:db1.missing_t", "trigger-depth:db1", "binding-unused:w1.EXTRA"]) ok(ids.has(want), "finding " + want);
  ok(!ids.has("untracked-worker:qnfo-workers"), "root-level Worker with tracked source is not untracked");
  ok(!ids.has("env-undeclared:w1.S") && !ids.has("env-undeclared:w1.DB") && !ids.has("sql-table-missing:w1:db1.t1"), "no false findings for a secret, a binding or an existing table");
  // GUARDED-TABLE-READ-1: a table every reader probes for in sqlite_master is an info finding (still listed); one unguarded reader keeps the warn
  {
    const live = new Map([["db1", new Set(["t1"])]]);
    const base = { codeWorkers: new Map(), snap: { workers: [], d1: [], kv: [], r2: [], queues: [], vectorize: [] }, triggersByDb: {}, liveTables: live };
    const one = new Map(computeFindings(Object.assign({}, base, { codeSql: [{ worker: "w1", unit: "u", rel: "reads", db: "db1", table: "maybe_t", confidence: "EXTRACTED", guarded: true }] })).map((x) => [x.id, x]));
    ok(one.get("sql-table-missing:w1:db1.maybe_t") && one.get("sql-table-missing:w1:db1.maybe_t").severity === "info" && /guarded/.test(one.get("sql-table-missing:w1:db1.maybe_t").detail), "a read guarded by a sqlite_master probe is an info finding that says so");
    const mixed = new Map(computeFindings(Object.assign({}, base, { codeSql: [{ worker: "w1", unit: "u", rel: "reads", db: "db1", table: "maybe_t", confidence: "EXTRACTED", guarded: true }, { worker: "w1", unit: "v", rel: "reads", db: "db1", table: "maybe_t", confidence: "EXTRACTED", guarded: false }] })).map((x) => [x.id, x]));
    ok(mixed.get("sql-table-missing:w1:db1.maybe_t") && mixed.get("sql-table-missing:w1:db1.maybe_t").severity === "warn", "one unguarded reader of the same table keeps the warn");
    const bare = new Map(computeFindings(Object.assign({}, base, { codeSql: [{ worker: "w1", unit: "u", rel: "reads", db: "db1", table: "gone_t", confidence: "EXTRACTED" }] })).map((x) => [x.id, x]));
    ok(bare.get("sql-table-missing:w1:db1.gone_t") && bare.get("sql-table-missing:w1:db1.gone_t").severity === "warn", "a codeSql row from an older shape (no guarded field) is a warn");
  }
  // OPTIONAL-ENV-1: a name the extractor marked optional is an info env-optional-unset (still listed), never a warn; an unmarked one stays a warn
  {
    const cwo = new Map([["w1", { declared: new Map(), crons: [], envReads: new Map([["OPT_KNOB", 5], ["REAL_MISSING", 6]]), computedEnv: false, optionalEnv: new Set(["OPT_KNOB"]), bindingUses: new Set() }], ["w3", { declared: new Map(), crons: [], envReads: new Map([["NO_SET_FIELD", 2]]), computedEnv: false, bindingUses: new Set() }]]);
    const fo = new Map(computeFindings({ codeWorkers: cwo, snap: { workers: [{ name: "w1", bindings: [], crons: [] }, { name: "w3", bindings: [], crons: [] }], d1: [], kv: [], r2: [], queues: [], vectorize: [] }, triggersByDb: {}, codeSql: null, liveTables: null }).map((x) => [x.id, x]));
    ok(fo.has("env-optional-unset:w1.OPT_KNOB") && fo.get("env-optional-unset:w1.OPT_KNOB").severity === "info" && !fo.has("env-undeclared:w1.OPT_KNOB") && /line 5/.test(fo.get("env-optional-unset:w1.OPT_KNOB").detail), "an optional undeclared name is an info env-optional-unset that keeps its line");
    ok(fo.get("env-undeclared:w1.REAL_MISSING") && fo.get("env-undeclared:w1.REAL_MISSING").severity === "warn", "an undeclared name the extractor did not mark optional stays a warn");
    ok(fo.get("env-undeclared:w3.NO_SET_FIELD") && fo.get("env-undeclared:w3.NO_SET_FIELD").severity === "warn", "a worker entry with no optionalEnv at all (older shape) keeps every undeclared name a warn");
    ok(["EVENTS_TOKEN", "OPS_KEY", "API_KEY", "GMAIL_PASS", "BSKY_APP_PASS", "MS_CLIENT_SECRET", "QNFO_GH_PAT", "x.token"].every(isCredentialLikeEnvName) && ["OPS_PUBLIC_READ", "PLAN_MODEL", "MS_TENANT", "KEYWORDS", "MONKEY_MODE", "OWNER_AUTH_MODE", "QUALITY_MIN_LEN"].every((n) => !isCredentialLikeEnvName(n)), "credential-shaped names are recognised by whole segment (KEYWORDS and MONKEY are not keys)");
  }
  // AST part
  let deps = null;
  try { deps = { acorn: await import("acorn"), walk: await import("acorn-walk") }; } catch (e) { log("skip AST cases: acorn/acorn-walk not installed (the fleet-graph workflow installs them)"); }
  if (deps) {
    const g = new Graph("code");
    const declared = new Map([["AUDIT", "d1"], ["OPS", "service"]]);
    const src = [
      'var VERSION = "1.0.0";',
      'var OPS_URL = "https://qnfo-ops.q08.workers.dev/ops/x";',
      "async function helper(env) { const db = env.AUDIT; return db.prepare(`SELECT id FROM agent_issues WHERE status = ?1`).bind('open').all(); }",
      "async function writer(env) { const { AUDIT } = env; await AUDIT.prepare('INSERT INTO decision_log (actor) VALUES (?1)').bind('x').run(); return fetch(OPS_URL); }",
      "function statements() { return ['SELECT id FROM missing_t WHERE active = 1', 'Documentation: SELECT id FROM prose_table WHERE active = 1', `Instructions: UPDATE prose_table SET active = 1`]; }",
      "function steps() { return [helper, writer]; }",
      "async function probed(env) { const t = await env.AUDIT.prepare(\"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'maybe_t'\").first(); if (!t) return null; return env.AUDIT.prepare('SELECT a FROM maybe_t WHERE b = 1').all(); }",
      "async function unprobed(env) { return env.AUDIT.prepare('SELECT a FROM other_t WHERE b = 1').all(); }",
      "var worker_default = { async fetch(req, env) { await helper(env); env.MISSING_THING; return env.OPS.fetch(req); }, async scheduled(e, env, ctx) { ctx.waitUntil(writer(env)); await fetch('https://api.github.com/repos/x'); } };",
      "export { worker_default as default };",
    ].join("\n");
    const hosts = hostIndex(["w1", "qnfo-ops"], []);
    const r = addWorkerCode(g, "w1", src, "w1/worker.js", { acorn: deps.acorn, walk: deps.walk, declared, hosts, d1ByBinding: new Map([["AUDIT", "qnfo-audit"]]), liveTables: null });
    const has = (s, rel, dd) => g.edges.has(edgeKey({ src: s, rel, dst: dd }));
    ok(has("fn:w1#default.fetch", "calls", "fn:w1#helper"), "handler calls helper");
    ok(has("fn:w1#default.scheduled", "calls", "fn:w1#writer"), "scheduled calls writer");
    ok(has("fn:w1#helper", "reads", "d1t:qnfo-audit.agent_issues"), "alias db.prepare read resolved to qnfo-audit");
    ok(has("fn:w1#writer", "writes", "d1t:qnfo-audit.decision_log"), "destructured AUDIT write");
    ok(has("fn:w1#statements", "reads", "d1t:qnfo-audit.missing_t"), "standalone SQL literal keeps its table reference");
    ok(!g.nodes.has("d1t:qnfo-audit.prose_table"), "prose containing SQL keywords in literals and templates is not a table reference");
    ok(has("fn:w1#writer", "http_calls", "worker:qnfo-ops"), "fetch through a URL constant maps to a fleet worker");
    ok(has("fn:w1#default.scheduled", "http_calls", "host:api.github.com"), "external host");
    ok(has("fn:w1#default.fetch", "uses_binding", "binding:w1.OPS"), "service binding use");
    ok(has("fn:w1#steps", "refs", "fn:w1#helper"), "function reference");
    const edgeOf = (s, rel, dd) => g.edges.get(edgeKey({ src: s, rel, dst: dd }));
    ok(edgeOf("fn:w1#probed", "reads", "d1t:qnfo-audit.maybe_t") && edgeOf("fn:w1#probed", "reads", "d1t:qnfo-audit.maybe_t").attrs.guarded === 1, "GUARDED-TABLE-READ-1: a read in a function that probes sqlite_master for the table carries guarded = 1");
    ok(edgeOf("fn:w1#unprobed", "reads", "d1t:qnfo-audit.other_t") && !edgeOf("fn:w1#unprobed", "reads", "d1t:qnfo-audit.other_t").attrs.guarded, "a read with no probe is not guarded");
    ok(r.envReads.has("MISSING_THING") && r.envReads.has("AUDIT"), "env reads collected");
    ok(r.optionalEnv instanceof Set && !r.optionalEnv.has("MISSING_THING") && !r.optionalEnv.has("AUDIT"), "a bare read is never optional");
    // OPTIONAL-ENV-1: which names the extractor calls optional. Every read of a name must carry its own fallback.
    const g2 = new Graph("code");
    const osrc = [
      "async function a(env) { const n = env.OPT_NULLISH ?? 5; const s = env.OPT_OR || 'x'; const t = String((env && env.OPT_GUARDED) || 'd'); const c = env?.OPT_CHAIN ?? 2; return [n, s, t, c]; }",
      "async function b(env) { const { OPT_DESTRUCT = 3, BARE_DESTRUCT } = env; return [OPT_DESTRUCT, BARE_DESTRUCT]; }",
      "async function c(env) { return env.MIXED ?? 1; }",
      "async function d(env) { return env.MIXED; }",
      "async function e(env) { return [env.CHAIN_A ?? env.CHAIN_B, env.CHAIN_C ?? env.CHAIN_D ?? 'z']; }",
      "async function f(env) { return [env.SECRET_TOKEN || '', env.PLAN_KEY ?? '', env.UNDEF_FALLBACK ?? undefined, Number(env.COERCED) || 5, typeof env.TYPEOF_ONLY, env.AND_ONLY && 1]; }",
      "async function h(env) { return env.TWICE_A ?? 1; } async function i(env) { return (env.TWICE_A || 'q').length; }",
      "var worker_default = { async fetch(req, env) { return new Response(String(env.FLAG_ON || '') + (env.OPTIONAL_URL ?? '')); } };",
      "export { worker_default as default };",
    ].join("\n");
    const ro = addWorkerCode(g2, "w2", osrc, "w2/worker.js", { acorn: deps.acorn, walk: deps.walk, declared: new Map(), hosts: hostIndex(["w2"], []), d1ByBinding: new Map(), liveTables: null });
    const opt = (n) => ro.optionalEnv.has(n);
    ok(["OPT_NULLISH", "OPT_OR", "OPT_GUARDED", "OPT_CHAIN", "OPT_DESTRUCT", "TWICE_A", "FLAG_ON", "OPTIONAL_URL", "CHAIN_C", "CHAIN_D"].every(opt), "?? , ||, a guarded (env && env.X) ||, a chained env?.X ??, a destructure default and a fallback chain are optional reads", [...ro.optionalEnv]);
    ok(!opt("MIXED") && !opt("BARE_DESTRUCT"), "one bare read among defaulted reads keeps the name a finding (every read must carry a fallback)");
    ok(!opt("CHAIN_A") && !opt("CHAIN_B"), "env.A ?? env.B is not a defaulted read: the fallback is itself an env read");
    ok(!opt("SECRET_TOKEN") && !opt("PLAN_KEY") && ro.envReads.has("SECRET_TOKEN") && ro.envReads.has("PLAN_KEY"), "a credential-shaped name stays a finding whatever its fallback");
    ok(!opt("UNDEF_FALLBACK") && !opt("COERCED") && !opt("TYPEOF_ONLY") && !opt("AND_ONLY"), "an undefined fallback, a coercion wrapper, typeof and a bare && test are not fallbacks");
  }
  log(fail ? fail + " selftest case(s) failed" : "fleet_graph selftest ok");
  return fail;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) selftest().then((f) => process.exit(f ? 1 : 0));
  else main(argv).then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
