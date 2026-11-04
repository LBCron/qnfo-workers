// scripts/system_map.mjs: SYSTEM-MAP-1 (2026-11-04, pillar core; also cost).
//
// WHY  Owner 2026-11-04: "I do not think we have a good map ... of the entire system", and AI input tokens are about 90% of
//      neurons because agents learn the system by reading large files and tables and re-sending them. The fleet graph
//      (scripts/fleet_graph.mjs) knows the system but answers one node at a time. This turns the same graph into ONE
//      compact page (docs/SYSTEM-MAP.md, under 6k tokens, budget test in scripts/system_map.test.mjs) plus a JSON form
//      (docs/system-map.json): one line per worker, per data store, per AI call path, and the hot paths.
// HOW  fleet_graph.mjs calls buildSystemMap() after it builds the graph (flag --system-map-out <dir>). On a main build it
//      also writes fleet-graph/SYSTEM-MAP.md and system-map.json to R2 qnfo-backups next to latest.json.gz. No new cron or
//      worker: fleet-graph.yml (push to main, remediation-consumer hourly as second path) is the regenerator.
// LIVE  collectMapExtra() reads, with the CI token, what the code graph cannot know: service_registry purposes, D1 sizes,
//      Vectorize vector counts, the per-worker AI neuron ledger and the all-in cost view. Reads only.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const MAP_VERSION = "1.0.0";
export const MAP_TOKEN_BUDGET = 6000;
export const approxTokens = (s) => Math.ceil(String(s).length / 4);

const short = (id) => String(id).replace(/^(d1|vz|r2|kv|worker|queue|do|wf|svc|ae|aisearch):/, "");
const trunc = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "~" : s; };
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n)));
const mb = (b) => (b == null ? "?" : b >= 1e9 ? (b / 1e9).toFixed(1) + "GB" : Math.round(b / 1e6) + "MB");

// The code of one worker, to tell which Vectorize bindings it writes and which it queries.
function vzOps(root, workerPath, bindingNames) {
  const out = {};
  let src = "";
  try { const p = join(root, workerPath || "", "worker.js"); if (existsSync(p)) src = readFileSync(p, "utf8"); } catch (e) { return out; }
  for (const b of bindingNames) {
    const w = new RegExp("\\b" + b + "\\.(upsert|insert)\\b").test(src);
    const r = new RegExp("\\b" + b + "\\.(query|getByIds)\\b").test(src) || new RegExp("\\[\\s*[\"']" + b + "[\"']\\s*\\]").test(src);
    out[b] = (w ? "w" : "") + (r ? "r" : "");
  }
  return out;
}

export function buildSystemMap({ graphs, extra, root, sha, now }) {
  extra = extra || {};
  const nodes = new Map(), edges = [];
  for (const g of graphs) { for (const [id, n] of g.nodes) if (!nodes.has(id) || g.scope === "code") nodes.set(id, n); for (const e of g.edges.values()) edges.push(e); }
  const workers = [...nodes.values()].filter((n) => n.kind === "worker" && n.attrs && n.attrs.version).sort((a, b) => a.name.localeCompare(b.name));
  const byWorker = new Map(workers.map((w) => [w.name, { w, binds: new Set(), svc: new Set(), crons: new Set(), writes: new Map(), reads: new Set(), vz: [] }]));
  const bindingRes = new Map(); // binding id -> resource id
  for (const e of edges) if (e.rel === "binds") bindingRes.set(e.src, e.dst);
  const callers = new Map(); // worker -> set of workers that bind it
  for (const e of edges) {
    if (e.rel === "has_binding") {
      const wn = e.src.slice(7), rec = byWorker.get(wn); if (!rec) continue;
      const res = bindingRes.get(e.dst); if (!res) continue;
      if (res.startsWith("worker:")) { rec.svc.add(short(res)); if (!callers.has(short(res))) callers.set(short(res), new Set()); callers.get(short(res)).add(wn); }
      else if (!res.startsWith("svc:")) rec.binds.add(res);
      else rec.binds.add(res);
      if (res.startsWith("vz:")) rec.vz.push({ b: e.dst.split(".").slice(1).join("."), idx: short(res) });
    } else if (e.rel === "has_cron") { const rec = byWorker.get(e.src.slice(7)); if (rec) rec.crons.add(e.dst); }
  }
  // fn -> worker for reads/writes of D1 tables
  const tableTouch = new Map(); // d1t id -> {w:Set workers, r:Set workers}
  for (const e of edges) {
    if ((e.rel !== "writes" && e.rel !== "reads") || !e.dst.startsWith("d1t:")) continue;
    const src = nodes.get(e.src); const wn = src && src.worker; if (!wn) continue;
    const t = tableTouch.get(e.dst) || { w: new Set(), r: new Set() }; (e.rel === "writes" ? t.w : t.r).add(wn); tableTouch.set(e.dst, t);
    const rec = byWorker.get(wn); if (!rec) continue;
    if (e.rel === "writes") rec.writes.set(e.dst, (rec.writes.get(e.dst) || 0) + 1); else rec.reads.add(e.dst);
  }
  // AI neurons per worker per day (3-day mean, last complete days) from the ledger
  const aiByWorker = new Map(); for (const r of extra.ai_workers || []) aiByWorker.set(r.worker, r);
  const purposes = extra.purposes || {};
  const kvTitles = extra.kv_titles || {};

  const wl = [];
  const wjson = [];
  for (const [name, rec] of byWorker) {
    const d1s = [...rec.binds].filter((x) => x.startsWith("d1:")).map((x) => short(x).replace(/^qnfo-/, "")), vzs = rec.vz.map((x) => x.idx.replace(/^qnfo-/, ""));
    const others = [...rec.binds].filter((x) => /^(r2|kv|queue|do|wf|ae|aisearch):/.test(x)).map((x) => x.split(":")[0] + ":" + (x.startsWith("kv:") && kvTitles[short(x)] ? kvTitles[short(x)] : short(x)).replace(/^qnfo-/, "").slice(0, 24));
    const topW = [...rec.writes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([id]) => id.replace(/^d1t:(qnfo-audit\.)?/, ""));
    const ai = aiByWorker.get(name);
    const p = purposes[name] || "";
    const pillar = rec.w.attrs.pillar || "-";
    const line = "- " + name + " " + String(rec.w.attrs.version || "?").split("-")[0] + " [" + pillar + "] " + trunc(p, 70)
      + (d1s.length ? " | d1:" + d1s.join(",") : "") + (vzs.length ? " | vz:" + vzs.join(",") : "") + (others.length ? " | " + others.slice(0, 5).join(",") : "")
      + (rec.svc.size ? " | svc:" + rec.svc.size : "") + (rec.crons.size ? " | cron:" + rec.crons.size : "")
      + (rec.writes.size ? " | W" + rec.writes.size + ":" + topW.join(",") + (rec.writes.size > 4 ? "+" : "") : "") + (rec.reads.size ? " R" + rec.reads.size : "")
      + (ai ? " | ai:" + k(ai.neurons) + "/d" : "");
    wl.push(line);
    wjson.push({ worker: name, version: rec.w.attrs.version || null, pillar, purpose: p || null, bindings: [...rec.binds].sort(), services: [...rec.svc].sort(), crons: [...rec.crons].map((c) => c.split("@")[1]), writes: [...rec.writes.keys()].sort(), reads_count: rec.reads.size, ai_neurons_per_day: ai ? Math.round(ai.neurons) : null, bytes: rec.w.attrs.bytes || null });
  }

  // data stores
  const d1Rows = [];
  const dbNames = new Set([...nodes.values()].filter((n) => n.kind === "d1").map((n) => n.name));
  for (const db of [...dbNames].sort()) {
    if (/^drill-restore|scratch/.test(db)) continue;
    const size = (extra.d1_sizes || {})[db];
    const ts = [...tableTouch.entries()].filter(([id]) => id.startsWith("d1t:" + db + ".")).map(([id, t]) => ({ id: id.slice(("d1t:" + db + ".").length), w: t.w.size, r: t.r.size })).sort((a, b) => (b.w + b.r) - (a.w + a.r)).slice(0, 5);
    const nt = [...nodes.values()].filter((n) => n.kind === "d1_table" && n.id.startsWith("d1t:" + db + ".")).length;
    const bound = [...byWorker.values()].filter((r) => r.binds.has("d1:" + db)).length;
    d1Rows.push({ db, size, tables: nt, bound, top: ts });
  }
  const dl = d1Rows.filter((r) => r.bound || r.tables).map((r) => "- d1:" + r.db + " " + mb(r.size) + " " + r.tables + "t " + r.bound + "w | hot: " + r.top.map((t) => t.id + "(w" + t.w + "/r" + t.r + ")").join(" "));

  const vzList = (extra.vectorize || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const vl = [], vjson = [];
  for (const v of vzList) {
    const w = [], r = [];
    for (const [wn, rec] of byWorker) {
      const mine = rec.vz.filter((x) => x.idx === v.name); if (!mine.length) continue;
      const ops = vzOps(root, rec.w.path, mine.map((x) => x.b));
      const flags = Object.values(ops).join("");
      if (flags.includes("w")) w.push(wn.replace(/^qnfo-/, "")); if (flags.includes("r")) r.push(wn.replace(/^qnfo-/, ""));
      if (!flags) r.push(wn.replace(/^qnfo-/, "") + "?");
    }
    const writer = v.writers_note ? " ext:" + v.writers_note : "";
    vl.push("- vz:" + v.name + " " + (v.vectors == null ? "?" : k(v.vectors)) + "v q7d:" + (v.queries_7d == null ? "?" : v.queries_7d) + " | W:" + (w.join(",") || "-") + writer + " | R:" + (r.join(",") || "-") + (v.last_write ? " | lastW:" + String(v.last_write).slice(0, 10) : ""));
    vjson.push({ index: v.name, vectors: v.vectors ?? null, queries_7d: v.queries_7d ?? null, writers: w, readers: r, last_write: v.last_write || null, external_writer: v.writers_note || null });
  }
  const r2 = [...nodes.values()].filter((n) => n.kind === "r2").map((n) => n.name).sort();
  const kv = [...nodes.values()].filter((n) => n.kind === "kv").length;
  const queues = [...nodes.values()].filter((n) => n.kind === "queue").map((n) => n.name);
  const dos = [...nodes.values()].filter((n) => n.kind === "durable_object").length;

  // AI call paths
  const al = (extra.ai_paths || []).slice(0, 12).map((a) => "- " + a.worker + " -> " + String(a.model).replace(/^@cf\//, "") + " " + k(a.neurons) + "/d " + a.calls + "c " + k(a.in_tok) + " in-tok");
  const hubs = [...callers.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8).map(([w, s]) => w + "(" + s.size + ")");
  const hotT = [...tableTouch.entries()].sort((a, b) => (b[1].w.size + b[1].r.size) - (a[1].w.size + a[1].r.size)).slice(0, 10).map(([id, t]) => id.replace(/^d1t:(qnfo-audit\.)?/, "") + "(w" + t.w.size + "/r" + t.r.size + ")");
  const cost = extra.cost || null;

  const date = (now || new Date().toISOString()).slice(0, 10);
  const md = [
    "# SYSTEM-MAP: the whole Quniverse on one page",
    "",
    "Generated " + date + " from fleet graph " + MAP_VERSION + (sha ? " @ " + String(sha).slice(0, 8) : "") + " (scripts/system_map.mjs, regenerated by fleet-graph.yml on every main push; live copy: R2 qnfo-backups/fleet-graph/SYSTEM-MAP.md). Do not edit by hand. Stale or wrong? the graph is the source: fix the extractor, not this file.",
    "Read this BEFORE opening any worker.js (500KB-1.6MB each) or scanning a table. Then look up exactly one thing (recipe at the end).",
    "",
    "## Workers (" + wl.length + "): name version [pillar] purpose | bindings | W=tables written (count:top) R=tables read | ai neurons/day",
    ...wl,
    "",
    ...(extra.live_workers ? ["- Live in Cloudflare with no code dir here: " + extra.live_workers.filter((n) => !byWorker.has(n)).join(", ")] : []),
    "",
    "## Data stores",
    ...dl,
    "- r2 (" + r2.length + "): " + r2.join(", "),
    "- kv (" + (Object.keys(kvTitles).length || kv) + "): " + (Object.values(kvTitles).join(", ") || "see graph") + "; queues: " + (queues.join(", ") || "-") + ", durable objects " + dos + " (graph: /fleet-graph/find?query=<name>)",
    "",
    "## Vectorize (768-d bge-base-en-v1.5; v=vectors, q7d=queries last 7 days; W=writers R=readers from worker code)",
    ...vl,
    "- ? = reached through a dynamic binding list (queried by name in code). Rule: personal-life is read and written only by personal-api, personal-companion and intent-orchestrator (domain=personal); never cross-query it with research indexes.",
    "",
    "## AI call paths (mean of last complete days, fleet ai_call_counters)" + (extra.ai_total ? "; total " + k(extra.ai_total.neurons) + " neurons/day, input tokens " + k(extra.ai_total.in_tok) + "/day" : ""),
    ...(al.length ? al : ["- (live ledger not available in this build)"]),
    ...(cost ? ["", "## Cost (D1 v_cost_all_in): month-to-date USD " + cost.mtd_usd + ", forecast USD " + cost.forecast_month_usd + ", budget USD " + cost.budget_month_usd + "; top lines: " + (cost.lines || []).map((l) => l.product + " " + l.mtd_usd).join(", ")] : []),
    "",
    "## Hot paths",
    "- Most-bound workers (service-binding callers): " + (hubs.join(", ") || "-"),
    "- Most-touched D1 tables (w=writer workers, r=reader workers): " + hotT.join(", "),
    "",
    "## Look up ONE thing (open, read-only, https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/...)",
    "- find?query=<text> gives exact node ids (worker:<n>, fn:<w>#<f>, d1t:<db>.<t>, vz:<idx>, binding:<w>.<B>, cron:<w>@<expr>)",
    "- impact?id=<id>&depth=1 = what breaks if it changes (run before changing a binding, table, trigger, cron, route, shared fn); resource?id=<id> = who reads/writes it",
    "- worker?worker=<n> = declared vs live bindings, crons, tables, callers; findings?severity=warn = drift; freshness = graph age",
    "- python scripts/worker_outline.py <worker> --show <fn> reads one function; never Read a worker.js whole. Same calls exist as MCP tools fleet_graph_* and ops tool fleet_graph.",
    "",
  ].join("\n");
  const json = { schema: "system-map/1", version: MAP_VERSION, generated: date, sha: sha || null, workers: wjson, d1: d1Rows, vectorize: vjson, r2, ai_paths: extra.ai_paths || [], ai_total: extra.ai_total || null, cost, hubs, hot_tables: hotT };
  return { md, json, tokens: approxTokens(md) };
}

// Live inputs the code graph cannot know. Every query is a read; each part is soft so one failure leaves the rest.
export async function collectMapExtra(cf, snap, auditDbId) {
  const ex = { collected_at: new Date().toISOString(), errors: [] };
  const soft = async (label, fn) => { try { return await fn(); } catch (e) { ex.errors.push(label + ": " + String(e.message || e).slice(0, 160)); return null; } };
  const q = (sql) => cf.d1(auditDbId, sql);
  const reg = await soft("service_registry", () => q("SELECT service, purpose FROM service_registry WHERE state = 'live'"));
  ex.purposes = Object.fromEntries((reg || []).map((r) => [r.service, r.purpose || ""]));
  ex.d1_sizes = Object.fromEntries(((snap && snap.d1) || []).map((d) => [d.name, d.size]));
  ex.vectorize = (snap && snap.vectorize) || [];
  ex.kv_titles = Object.fromEntries(((snap && snap.kv) || []).map((x) => [x.id, x.title]));
  ex.live_workers = ((snap && snap.workers) || []).map((x) => x.name).sort();
  const w = await soft("ai_workers", () => q("SELECT worker, SUM(neurons) / 3.0 AS neurons FROM ai_call_counters WHERE day >= date('now','-4 day') AND day < date('now') GROUP BY worker ORDER BY 2 DESC"));
  ex.ai_workers = w || [];
  const p = await soft("ai_paths", () => q("SELECT worker, model, SUM(neurons) / 3.0 AS neurons, CAST(SUM(calls) / 3 AS INTEGER) AS calls, CAST(SUM(in_tok) / 3 AS INTEGER) AS in_tok FROM ai_call_counters WHERE day >= date('now','-4 day') AND day < date('now') GROUP BY worker, model ORDER BY 3 DESC LIMIT 12"));
  ex.ai_paths = p || [];
  const t = await soft("ai_total", () => q("SELECT SUM(neurons) / 3.0 AS neurons, SUM(in_tok) / 3.0 AS in_tok FROM ai_call_counters WHERE day >= date('now','-4 day') AND day < date('now')"));
  ex.ai_total = t && t[0] ? t[0] : null;
  const c = await soft("cost", () => q("SELECT mtd_usd, forecast_month_usd, budget_month_usd FROM v_cost_all_in"));
  if (c && c[0]) { const l = await soft("cost_lines", () => q("SELECT product, mtd_usd FROM v_cost_lines_month WHERE mtd_usd > 0 ORDER BY mtd_usd DESC LIMIT 4")); ex.cost = Object.assign({}, c[0], { lines: l || [] }); }
  // vector counts, last write, queries in 7 days
  const a = "/accounts/" + cf.account;
  for (const v of ex.vectorize) {
    const i = await soft("vz info " + v.name, async () => (await cf.req("GET", a + "/vectorize/v2/indexes/" + encodeURIComponent(v.name) + "/info")).j.result);
    if (i) { v.vectors = i.vectorCount; v.last_write = i.processedUpToDatetime; }
  }
  const gq = await soft("vz queries", async () => {
    const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
    const query = "{viewer{accounts(filter:{accountTag:\"" + cf.account + "\"}){vectorizeV2QueriesAdaptiveGroups(limit:100,filter:{datetime_geq:\"" + from.toISOString() + "\",datetime_leq:\"" + to.toISOString() + "\"}){count dimensions{indexName}}}}}";
    const r = await cf.req("POST", "/graphql", { query });
    return (((r.j.data || {}).viewer || {}).accounts || [{}])[0].vectorizeV2QueriesAdaptiveGroups || [];
  });
  const qm = new Map((gq || []).map((g) => [g.dimensions.indexName, g.count]));
  for (const v of ex.vectorize) v.queries_7d = qm.has(v.name) ? qm.get(v.name) : (gq ? 0 : null);
  // writers that are not a Worker binding: scripts that call the Vectorize REST API
  const ext = { "qnfo-repos": "scripts/repo_content_index.py (REST, CI)" };
  for (const v of ex.vectorize) if (ext[v.name]) v.writers_note = ext[v.name];
  return ex;
}
