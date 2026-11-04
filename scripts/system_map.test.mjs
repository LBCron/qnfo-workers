// SYSTEM-MAP-1 offline suite (scripts/system_map.mjs). Run: node scripts/system_map.test.mjs
// 1. a synthetic graph renders worker, store, Vectorize reader/writer and AI lines;
// 2. the committed docs/SYSTEM-MAP.md stays under the token budget (the point of the map is that an agent loads it for a few
//    thousand tokens instead of reading worker files of 200k-400k) and keeps the sections agents rely on;
// 3. llms.txt and the shared library name the map as the first thing to load.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SM = await import(pathToFileURL(join(ROOT, "scripts", "system_map.mjs")).href);
const FG = await import(pathToFileURL(join(ROOT, "scripts", "fleet_graph.mjs")).href);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };

// 1. synthetic graph
const tmp = mkdtempSync(join(tmpdir(), "sysmap-"));
mkdirSync(join(tmp, "w1"));
writeFileSync(join(tmp, "w1", "worker.js"), "async function a(env){ await env.IDX.upsert([]); } async function b(env){ return env.IDX.query([1]); }");
mkdirSync(join(tmp, "w2"));
writeFileSync(join(tmp, "w2", "worker.js"), "async function c(env){ return env.IDX2.query([1]); }");
const g = new FG.Graph("code");
g.node("worker:w1", "worker", "w1", { worker: "w1", path: "w1", attrs: { version: "1.2.3-x", pillar: "core" } });
g.node("worker:w2", "worker", "w2", { worker: "w2", path: "w2", attrs: { version: "0.1.0", pillar: "research" } });
for (const [w, b, res, kind] of [["w1", "IDX", "vz:idx-a", "vectorize"], ["w2", "IDX2", "vz:idx-a", "vectorize"], ["w1", "DB", "d1:main", "d1"], ["w2", "SVC", "worker:w1", "worker"]]) {
  g.node(res, kind, res.split(":")[1]);
  g.node("binding:" + w + "." + b, "binding", b, { worker: w });
  g.edge("worker:" + w, "has_binding", "binding:" + w + "." + b);
  g.edge("binding:" + w + "." + b, "binds", res);
}
g.node("d1:main", "d1", "main");
g.node("d1t:main.t1", "d1_table", "t1");
g.node("fn:w1#a", "function", "a", { worker: "w1" });
g.edge("fn:w1#a", "writes", "d1t:main.t1");
g.node("fn:w2#c", "function", "c", { worker: "w2" });
g.edge("fn:w2#c", "reads", "d1t:main.t1");
g.node("cron:w1@0 * * * *", "cron", "0 * * * *", { worker: "w1" });
g.edge("worker:w1", "has_cron", "cron:w1@0 * * * *");
const extra = { purposes: { w1: "does the thing" }, d1_sizes: { main: 5e6 }, vectorize: [{ name: "idx-a", vectors: 1200, queries_7d: 33, last_write: "2026-11-04T00:00:00Z" }], ai_workers: [{ worker: "w1", neurons: 12345 }], ai_paths: [{ worker: "w1", model: "@cf/x/y", neurons: 12345, calls: 3, in_tok: 4000 }], ai_total: { neurons: 12345, in_tok: 4000 }, cost: { mtd_usd: 1, forecast_month_usd: 10, budget_month_usd: 300, lines: [{ product: "workers_ai", mtd_usd: 1 }] } };
const m = SM.buildSystemMap({ graphs: [g], extra, root: tmp, sha: "abcdef123456", now: "2026-11-04T00:00:00Z" });
ok(/- w1 1\.2\.3 \[core\] does the thing \| d1:main \| vz:idx-a/.test(m.md), "worker line carries version, pillar, purpose, bindings");
ok(/W1:main.t1/.test(m.md) && /ai:12k\/d/.test(m.md) && /cron:1/.test(m.md), "worker line carries written tables, AI neurons and crons");
ok(/vz:idx-a 1k?v? ?.*q7d:33 \| W:w1 \| R:w1,w2/.test(m.md) || /vz:idx-a 1k.*W:w1 \| R:w1,w2/.test(m.md), "Vectorize line separates writers from readers by code");
ok(/svc:1/.test(m.md) && /w1\(1\)/.test(m.md), "service-binding hub counts");
ok(m.json.workers.length === 2 && m.json.vectorize[0].writers[0] === "w1", "JSON form matches");

// 2. committed map
let doc = "", js = null;
try { doc = readFileSync(join(ROOT, "docs", "SYSTEM-MAP.md"), "utf8"); js = JSON.parse(readFileSync(join(ROOT, "docs", "system-map.json"), "utf8")); } catch (e) { ok(false, "docs/SYSTEM-MAP.md and docs/system-map.json are committed: " + e.message); }
if (doc) {
  const t = SM.approxTokens(doc);
  ok(t <= SM.MAP_TOKEN_BUDGET, "docs/SYSTEM-MAP.md is " + t + " tokens (budget " + SM.MAP_TOKEN_BUDGET + ")");
  for (const h of ["## Workers", "## Data stores", "## Vectorize", "## AI call paths", "## Hot paths", "## Look up ONE thing"]) ok(doc.includes(h), "section " + h);
  ok(js && js.schema === "system-map/1" && js.workers.length >= 30 && js.vectorize.length >= 8, "docs/system-map.json has workers and Vectorize indexes");
  ok(!/\b(sk-|ghp_|Bearer )/.test(doc), "no secret-looking text in the map");
}

// 3. entry points
const llms = readFileSync(join(ROOT, "llms.txt"), "utf8");
ok(llms.indexOf("SYSTEM-MAP") > -1 && llms.indexOf("SYSTEM-MAP") < llms.indexOf("Session rules"), "llms.txt lists SYSTEM-MAP before the session rules");
const lib = readFileSync(join(ROOT, "docs", "agent-library", "README.md"), "utf8");
ok(lib.includes("SYSTEM-MAP.md"), "agent library README points at SYSTEM-MAP.md");
if (fails) process.exit(1);
console.log("system_map.test.mjs ok");
