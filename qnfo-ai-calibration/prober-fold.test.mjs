// PROBER-FOLD-1 (qnfo-ai-calibration 1.3.0) and PROBER-ON-CAL-TICK-1 (1.3.1, agent_issues 1756) offline suite. No network,
// no production data. Proves: the ai-health-prober code runs unchanged as the member proberMod (only its version constant
// and its limitation text differ from ai-health-prober/worker.js); the */30 tick runs the calibration AND the prober, and
// the handler does not resolve before the prober's waitUntil work is done (the */20 trigger declared for it never fired, and
// waitUntil alone leaves 30 seconds after the handler returns); a legacy */20 event runs the prober only; the member still
// writes as "ai-health-prober" with the member version; /prober/health and /prober/freshness are public, /prober/run needs
// the calibration key and spends nothing without it; /health lists the member and the one cron; wrangler.toml declares
// only */30 and the AI binding.
// Run: node qnfo-ai-calibration/prober-fold.test.mjs   -> prints "N passed, 0 failed"
import fs from "node:fs";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const prober = fs.readFileSync(new URL("../ai-health-prober/worker.js", import.meta.url), "utf8");
const toml = fs.readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const api = new Function(src.replace(/export \{\s*(?:worker_default|__fk_\w+_default) as default\s*\};?/, "") +
  "\nreturn { worker_default, proberMod, PROBER_CRON, PROBER_VERSION, VERSION };")();
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 300) : "")); } };

// 1. the member is the prober's code
{
  const lines = prober.split("\n");
  const body = lines.slice(lines.indexOf('var WORKER = "ai-health-prober";'), lines.indexOf("export {"));
  // AMH-COVERAGE-ROSTER-1 (host 1.3.2): the member's checkHealthCoverage body is the one function rewritten in the host.
  const cs = body.findIndex((l) => l.includes("async function checkHealthCoverage(")), ce = body.findIndex((l) => l.includes("__name(checkHealthCoverage"));
  const inCov = (l) => { const i = body.indexOf(l); return cs >= 0 && i > cs && i < ce; };
  // AMH-ROSTER-PRUNE-1 (host 1.3.3, lever T5.11): the member's dead per-tick prune in checkFreshness (wrong bind receiver,
  // never ran) is removed in the host; the folded prober source keeps it, so those lines are the second rewritten region.
  const fs0 = body.findIndex((l) => l.includes("async function checkFreshness(")), fe = body.findIndex((l) => l.includes("__name(checkFreshness"));
  const ps = body.findIndex((l, i) => i > fs0 && l.includes("var _roster = []")) - 1, pe = body.findIndex((l, i) => i > ps && l.trim() === "} catch (e) {}");
  const inPrune = (l) => { const i = body.indexOf(l); return ps > fs0 && pe > ps && pe < fe && i >= ps && i <= pe; };
  const changed = body.filter((l) => l.trim() && !src.includes(l.trim()) && !inCov(l) && !inPrune(l));
  ok(cs > 0 && ce > cs && changed.length === 3 && changed.some((l) => l.startsWith("var VERSION = ")) && changed.some((l) => l.startsWith("var LIMS = ")) && changed.some((l) => l.startsWith("var SIGNALS = ")), "every prober line is in the host except its VERSION, LIMS and SIGNALS lines (SIGNALS drops the retired kaizen register, FOLD-HYGIENE-1)", changed.map((l) => l.slice(0, 60)));
  ok(versionAtLeast(api.VERSION, "1.3.1") && versionAtLeast(api.PROBER_VERSION, "2.3.15") && api.PROBER_CRON === "*/20 * * * *", "host 1.3.1+, member 2.3.15 or later, legacy member cron */20 kept for dispatch");
  ok(!/"kaizen", "kaizen_candidates"/.test(src), "the prober SIGNALS in the host no longer grade the retired kaizen register (FOLD-HYGIENE-1)");
  ok(src.includes('["version_queue", "version_queue", "created_at", 336, "event"]') && !src.includes('["version_queue", "version_queue", "created_at", 72, "heartbeat"]'), "version_queue is an event register with a 336 h window (#2028)");
  ok((src.match(/var VERSION = "/g) || []).length === 1, "one quoted VERSION constant in the bundle (FM7 parity applies to the host)");
  ok(fs0 > 0 && fe > fs0 && body.slice(fs0, fe).some((l) => l.includes("_del.bind.apply")) && !src.includes("_del.bind.apply") && !/DELETE FROM ai_model_health/.test(src) && src.includes("AMH-ROSTER-PRUNE-1"), "the host carries no ai_model_health delete: the dead prune is removed, not fixed with raw ids (AMH-ROSTER-PRUNE-1)");
}

// a recording D1 and AI
function mkEnv() {
  const sql = [], ai = [];
  const stmt = (q) => { let a = []; const s = { bind(...x) { a = x; return s; }, async run() { sql.push({ q, a }); return { success: true, meta: { changes: 1 } }; }, async first() { sql.push({ q, a }); return null; }, async all() { sql.push({ q, a }); return { results: [] }; } }; return s; };
  const env = {
    QNFO_AUDIT: { prepare: stmt, batch: async (xs) => xs.map(() => ({ results: [] })) },
    AI: { async run(model, input) { ai.push(model); return { response: "ok", data: [[0.1, 0.2]] }; } },
    QNFO_AI: { async fetch() { return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], data: [] }), { status: 200 }); } },
    QNFO_OPS: { async fetch() { return new Response("{}", { status: 200 }); } },
    PT_API: { async fetch() { return new Response("{}", { status: 200 }); } },
    QNFO_ROUTER_KEY: "calib-key"
  };
  return { env, sql, ai };
}
globalThis.fetch = async () => new Response("{}", { status: 200 });
// The handler's own promise is awaited and the host ctx's waitUntil is NOT: the member's work must finish inside the handler.
const runCron = async (cron) => {
  const t = mkEnv(); t.hostWaits = 0;
  await api.worker_default.scheduled({ cron, scheduledTime: Date.now() }, t.env, { waitUntil: () => { t.hostWaits++; } });
  return t;
};

// 2. cron dispatch
{
  const t = await runCron("*/30 * * * *");
  const hb = t.sql.find((x) => /INSERT INTO fleet_heartbeat/.test(x.q) && x.a[0] === "ai-health-prober");
  ok(t.sql.some((x) => /ai_calibration_(runs|results)/.test(x.q)), "*/30 runs the calibration");
  ok(hb && hb.a[1] === api.PROBER_VERSION, "*/30 also runs the prober member: heartbeat as ai-health-prober with the member version", hb && hb.a);
  ok(t.hostWaits === 0, "the member's waitUntil work is awaited inside the handler, not handed to the host's waitUntil", t.hostWaits);
}
{
  const t = await runCron("*/20 * * * *");
  const hb = t.sql.find((x) => /INSERT INTO fleet_heartbeat/.test(x.q));
  ok(hb && hb.a[0] === "ai-health-prober", "a legacy */20 event runs the prober member", hb && hb.a);
  // BUDGET-PROBE-1: the member records its own budget verdicts in ai_calibration_results (probe model-budget); a calibration run writes ai_calibration_runs and other probes
  ok(!t.sql.some((x) => /INSERT INTO ai_calibration_runs/.test(x.q) || (/INSERT INTO ai_calibration_results/.test(x.q) && x.a[2] !== "model-budget")), "a legacy */20 event does not run the calibration (no extra model calls)");
}

// 3. routes
const get = (path, headers, envv) => api.worker_default.fetch(new Request("https://qnfo-ai-calibration.q08.workers.dev" + path, { headers: headers || {} }), envv || mkEnv().env, { waitUntil() {} });
{
  const r = await get("/prober/health"); const j = await r.json();
  ok(r.status === 200 && j.worker === "ai-health-prober" && j.version === api.PROBER_VERSION && /inside qnfo-ai-calibration/.test(j.limitations[0]), "/prober/health answers as the member", j);
  const f = await get("/prober/freshness");
  ok(f.status === 200, "/prober/freshness is public", f.status);
  const t = mkEnv();
  const run = await get("/prober/run", {}, t.env);
  ok(run.status === 401 && t.ai.length === 0, "/prober/run without the key is refused and calls no model", [run.status, t.ai.length]);
  const t2 = mkEnv();
  const run2 = await get("/prober/run", { Authorization: "Bearer calib-key" }, t2.env);
  ok(run2.status === 200, "/prober/run with the calibration key runs", run2.status);
  ok((await get("/prober/other")).status === 404, "other /prober paths are 404");
  const h = await (await get("/health")).json();
  ok(h.version === api.VERSION && h.members && h.members["ai-health-prober"] === api.PROBER_VERSION && JSON.stringify(h.crons) === JSON.stringify(["*/30 * * * *"]), "/health lists the member and the one cron", h);
}

// 4. wrangler
ok(/\ncrons = \["\*\/30 \* \* \* \*"\]\n/.test(toml) && /\n\[ai\]\nbinding = "AI"/.test(toml), "wrangler.toml declares only the */30 cron (the */20 is dropped) and the AI binding");
ok(fs.existsSync(new URL("../ai-health-prober/FOLDED", import.meta.url)), "ai-health-prober carries a FOLDED marker");

// AMH-COVERAGE-ROSTER-1 (#2028): amh_coverage grades the probe roster only and names the ids it leaves out.
{
  const now = Date.now();
  const roster = ["qwen3.8-27b", "bge-base-en-v1.5"];
  const mkCov = (rows) => {
    const writes = [];
    const stmt = (q) => { let a = []; const s = { bind(...x) { a = x; return s; }, async run() { writes.push({ q, a }); return { success: true }; }, async first() { return null; }, async all() { return { results: /FROM ai_model_health/.test(q) ? rows : [] }; } }; return s; };
    return { env: { QNFO_AUDIT: { prepare: stmt } }, writes };
  };
  const fresh = now - 3600e3, old = now - 40 * 3600e3;
  const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };
  const lib = new Function("__name", grab("  var MODELS = [", "\n") + "\n" + grab("  function canonicalId(m) {", "__name(canonicalId") + grab("  async function checkHealthCoverage(env, now) {", "__name(checkHealthCoverage") +
    "\nreturn { cov: checkHealthCoverage, roster: function () { var r = []; for (var i = 0; i < MODELS.length; i++) { var id = canonicalId(MODELS[i].internal || MODELS[i].id); if (r.indexOf(id) < 0) r.push(id); } return r; } };")(function (f) { return f; });
  // Every roster model fresh, 24 external never-probed ids outside the roster: fresh, and the 24 are named.
  const ext = Array.from({ length: 24 }, (_, i) => ({ model_id: "openai/x-" + i, last_probe_ts: null }));
  const cov = await lib.cov(mkCov(lib.roster().map((m) => ({ model_id: m, last_probe_ts: fresh })).concat(ext)).env, now);
  ok(cov.status === "fresh" && cov.stale === 0 && cov.outside_roster === 24 && cov.total === lib.roster().length, "external ids outside the roster are counted, not graded", cov);
  const one = lib.roster();
  const c2 = await lib.cov(mkCov(one.slice(1).map((m) => ({ model_id: m, last_probe_ts: fresh })).concat([{ model_id: one[0], last_probe_ts: old }])).env, now);
  ok(c2.status === "stale" && c2.stale === 1, "a roster model probed 40 h ago is stale", c2);
  const c3 = await lib.cov(mkCov(one.slice(1).map((m) => ({ model_id: m, last_probe_ts: fresh }))).env, now);
  ok(c3.status === "stale" && c3.neverProbed === 1, "a roster model with no row at all counts as never probed", c3);
  ok(lib.roster().length >= 4, "the roster is read from MODELS", lib.roster());
  void roster;
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
