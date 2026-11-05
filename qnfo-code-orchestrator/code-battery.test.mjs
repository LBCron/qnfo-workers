// CODE-BATTERY-1 (RM-S4-BENCHMARK-1) offline suite. Replays the CODE-BATTERY-1 block of worker.js. Proves, with no network and no live state:
//  - every task has a reference solution that passes all of its hidden tests, a starter (where there is one) that fails at least one, and a trivial
//    wrong answer that fails (so a task can be neither unsolvable nor already solved);
//  - the answer extractor, the prompt (the tests never reach the model) and the pure grader;
//  - the scheduled state machine against an in-memory SQLite D1 and a stand-in sandbox: a run starts, one pair per tick, a lease stops a second tick,
//    an AI error is retried and then recorded as not answered (not as a wrong answer), the run finishes into benchmark_results, report_card_inputs and the
//    two metric rows, the switch ops_config code_battery = off stops it, and an idle battery keeps its age metric.
// Run: node qnfo-code-orchestrator/code-battery.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };

const a = src.indexOf("// ---- CODE-BATTERY-1:BEGIN");
const b = src.indexOf("// ---- CODE-BATTERY-1:END ----");
if (a < 0 || b < a) throw new Error("CODE-BATTERY-1 block not found in worker.js");
const block = src.slice(a, b);
const auditEvents = [];
const aiCalls = [];
let aiImpl = async () => "";
const mod = new Function("ai", "audit", block + "\nreturn { CB_TASKS, CB_DEFAULT_MODELS, cbHarness, cbExtractCode, cbPrompt, cbGrade, cbExec, codeBatteryTick };")(
  async (env, model, messages) => { aiCalls.push({ model, messages }); return aiImpl(model, messages); },
  async (env, kind, text, meta, status) => { auditEvents.push({ kind, text, meta, status }); });
const { CB_TASKS, cbHarness, cbExtractCode, cbPrompt, cbGrade, cbExec, codeBatteryTick } = mod;

// ---- reference solutions (never shipped in worker.js) ----------------------------------------------------------------------------
function extractInt(text) { var m = String(text == null ? "" : text).replace(/(\d),(?=\d{3}(?!\d))/g, "$1").match(/-?\d+/g); return m && m.length ? String(parseInt(m[m.length - 1], 10)) : null; }
function cmpVersion(a, b) { function p(v) { var m = /^\s*v?(\d+(?:\.\d+)*)/.exec(String(v)); return m ? m[1].split(".").map(Number) : []; } var x = p(a), y = p(b), n = Math.max(x.length, y.length); for (var i = 0; i < n; i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; }
function cronMatches(field, value, min, max) {
  return String(field).split(",").some(function (part) {
    var step = 1, range = part, slash = part.indexOf("/");
    if (slash >= 0) { step = parseInt(part.slice(slash + 1), 10); range = part.slice(0, slash); }
    var lo = min, hi = max;
    if (range !== "*") {
      var dash = range.indexOf("-");
      if (dash >= 0) { lo = parseInt(range.slice(0, dash), 10); hi = parseInt(range.slice(dash + 1), 10); }
      else { lo = parseInt(range, 10); hi = slash >= 0 ? max : lo; }
    }
    if (value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}
function splitSql(text) {
  var s = String(text), out = [], cur = "", i = 0, q = "";
  while (i < s.length) {
    var c = s[i], d = s[i + 1];
    if (q) { cur += c; if (c === q) { if (d === q) { cur += d; i += 2; continue; } q = ""; } i++; continue; }
    if (c === "-" && d === "-") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { var e = s.indexOf("*" + "/", i + 2); i = e < 0 ? s.length : e + 2; cur += " "; continue; }
    if (c === "'" || c === '"' || c === "`") { q = c; cur += c; i++; continue; }
    if (c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function utmLink(url, source, medium, campaign) { var u = new URL(url); u.searchParams.set("utm_source", source); u.searchParams.set("utm_medium", medium); u.searchParams.set("utm_campaign", campaign); return u.toString(); }
function cleanPath(raw) { var s = String(raw).trim(), prev; do { prev = s; s = s.replace(/^[`'"(]+/, "").replace(/[`'"]+$/, "").replace(/[.,;:)\]]+$/, "").trim(); } while (s !== prev); return s; }
class TtlLru {
  constructor(max, ttlMs, now) { this.max = max; this.ttl = ttlMs; this.now = now; this.m = new Map(); }
  sweep() { var n = this.now(); Array.from(this.m).forEach(function (kv) { if (n - kv[1].t >= this.ttl) this.m.delete(kv[0]); }, this); }
  get(k) { var e = this.m.get(k); if (!e) return undefined; if (this.now() - e.t >= this.ttl) { this.m.delete(k); return undefined; } this.m.delete(k); this.m.set(k, e); return e.v; }
  put(k, v) { if (this.m.has(k)) this.m.delete(k); else { this.sweep(); if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value); } this.m.set(k, { v: v, t: this.now() }); }
  get size() { return this.m.size; }
}
function run(ops) {
  var t = 0, c = new TtlLru(ops.max, ops.ttl, function () { return t; }), out = [];
  ops.steps.forEach(function (s) {
    if (s[0] === "put") c.put(s[1], s[2]);
    else if (s[0] === "get") { var v = c.get(s[1]); out.push(v === undefined ? null : v); }
    else if (s[0] === "tick") t += s[1];
    else if (s[0] === "size") out.push(c.size);
  });
  return out;
}
function topCounts(lines, n) {
  var c = new Map();
  lines.forEach(function (l) { if (String(l).trim() === "") return; c.set(l, (c.get(l) || 0) + 1); });
  return Array.from(c.entries()).sort(function (x, y) { return y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0); }).slice(0, n).map(function (e) { return e[1] + " " + e[0]; });
}
function parseEnv(text) {
  var out = {};
  String(text).split(/\r?\n/).forEach(function (line) {
    var t = line.trim();
    if (!t || t[0] === "#") return;
    t = t.replace(/^export\s+/, "");
    var eq = t.indexOf("=");
    if (eq < 0) return;
    var key = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    var v = t.slice(eq + 1).replace(/^\s+/, ""), val;
    if (v[0] === '"') {
      var r = "";
      for (var i = 1; i < v.length; i++) {
        var c = v[i];
        if (c === "\\" && i + 1 < v.length) { var d = v[i + 1]; if (d === "n") { r += "\n"; i++; continue; } if (d === '"' || d === "\\") { r += d; i++; continue; } r += c; continue; }
        if (c === '"') break;
        r += c;
      }
      val = r;
    } else if (v[0] === "'") { var j = v.indexOf("'", 1); val = j < 0 ? v.slice(1) : v.slice(1, j); }
    else { var h = v.search(/\s#/); val = (h < 0 ? v : v.slice(0, h)).trim(); }
    out[key] = val;
  });
  return out;
}
function cutFields(lines, delim, spec) {
  var ranges = String(spec).split(",").map(function (p) { var m = /^(\d*)-(\d*)$/.exec(p); if (m) return [m[1] ? +m[1] : 1, m[2] ? +m[2] : Infinity]; var n = +p; return [n, n]; });
  return lines.map(function (l) {
    if (l.indexOf(delim) < 0) return l;
    var f = l.split(delim), o = [];
    for (var i = 0; i < f.length; i++) { var k = i + 1; if (ranges.some(function (r) { return k >= r[0] && k <= r[1]; })) o.push(f[i]); }
    return o.join(delim);
  });
}
function globMatch(pattern, path) {
  var re = "^", i = 0, p = String(pattern), special = "\\^$.*+?()[]{}|/";
  while (i < p.length) {
    var c = p[i];
    if (c === "*") { if (p[i + 1] === "*") { if (p[i + 2] === "/") { re += "(?:.*/)?"; i += 3; } else { re += ".*"; i += 2; } } else { re += "[^/]*"; i++; } }
    else if (c === "?") { re += "[^/]"; i++; }
    else if (c === "[") { var j = p.indexOf("]", i + 2); if (j < 0) { re += "\\["; i++; } else { var cls = p.slice(i + 1, j); if (cls[0] === "!") cls = "^" + cls.slice(1); re += "[" + cls + "]"; i = j + 1; } }
    else { re += special.indexOf(c) >= 0 ? "\\" + c : c; i++; }
  }
  return new RegExp(re + "$").test(String(path));
}
function parseDuration(s) {
  s = String(s).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return +s;
  var re = /(\d+(?:\.\d+)?)\s*([dhms])/gi, tot = 0, m, last = 0;
  while ((m = re.exec(s))) { if (s.slice(last, m.index).trim()) return null; tot += { d: 86400, h: 3600, m: 60, s: 1 }[m[2].toLowerCase()] * +m[1]; last = re.lastIndex; }
  if (!last || s.slice(last).trim()) return null;
  return tot;
}
function unsafeEntries(paths) {
  return paths.filter(function (p) {
    var s = String(p);
    if (s[0] === "/") return true;
    var d = 0, parts = s.split(/[\/\\]/);
    for (var i = 0; i < parts.length; i++) { var seg = parts[i]; if (seg === "" || seg === ".") continue; if (seg === "..") { d--; if (d < 0) return true; } else d++; }
    return false;
  });
}
const REF = {
  "swe-extract-int": extractInt.toString(), "swe-cmp-version": cmpVersion.toString(), "swe-cron-field": cronMatches.toString(), "swe-split-sql": splitSql.toString(),
  "swe-utm-link": utmLink.toString(), "swe-clean-path": cleanPath.toString(), "swe-ttl-lru": TtlLru.toString() + "\n" + run.toString(),
  "term-top-counts": topCounts.toString(), "term-parse-env": parseEnv.toString(), "term-cut-fields": cutFields.toString(), "term-glob-match": globMatch.toString(),
  "term-parse-duration": parseDuration.toString(), "term-tar-unsafe": unsafeEntries.toString()
};

// ---- a stand-in for the Dynamic Worker: the same module text, loaded as a data: module ---------------------------------------------
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
async function runHarness(code, task) {
  // like cbExec: a module that does not compile is an error answer, not a crash
  try {
    const m = await import("data:text/javascript;base64," + b64(cbHarness(code, task.fn, task.tests)));
    return await (await m.default.fetch()).json();
  } catch (e) { return { err: "run: " + String((e && e.message) || e).slice(0, 120) }; }
}
const LOADER = { load(opts) { return { getEntrypoint() { return { fetch: async () => { const m = await import("data:text/javascript;base64," + b64(opts.modules["m.js"])); return m.default.fetch(); } }; } }; } };

// ---- tasks -------------------------------------------------------------------------------------------------------------------------
ok(CB_TASKS.length >= 12, "at least 12 tasks", CB_TASKS.length);
ok(new Set(CB_TASKS.map((t) => t.id)).size === CB_TASKS.length, "task ids are unique");
ok(CB_TASKS.some((t) => t.kind === "swe") && CB_TASKS.some((t) => t.kind === "term"), "both kinds are present");
for (const t of CB_TASKS) {
  ok(typeof REF[t.id] === "string", "reference solution exists for " + t.id);
  ok(t.tests.length >= 4, t.id + " has at least 4 hidden tests", t.tests.length);
  const good = await runHarness(REF[t.id], t);
  ok(Array.isArray(good.r) && good.r.length === t.tests.length && good.r.every((x) => x === 1), t.id + ": the reference passes every test", good);
  ok(cbGrade(good, t.tests.length).pass === 1, t.id + ": the reference grades as pass");
  if (t.starter) {
    const bad = await runHarness(t.starter, t);
    ok(Array.isArray(bad.r) && bad.r.some((x) => x === 0), t.id + ": the starter fails at least one test", bad);
    ok(cbGrade(bad, t.tests.length).pass === 0, t.id + ": the starter grades as fail");
  }
  const wrong = await runHarness("function " + t.fn + "() { return 0; }", t);
  ok(cbGrade(wrong, t.tests.length).pass === 0, t.id + ": a trivial wrong answer fails");
  const missing = await runHarness("var unrelated = 1;", t);
  ok(missing.err && /no function/.test(missing.err) && cbGrade(missing, t.tests.length).pass === 0, t.id + ": no function is a fail", missing);
  const p = cbPrompt(t);
  const text = JSON.stringify(p);
  ok(p.length === 2 && p[1].content.indexOf(t.fn) >= 0, t.id + ": the prompt names the function");
  ok(!/tests:|__tests/.test(text), t.id + ": the prompt carries no test table");
}
// a syntax error and a thrown error are fails, not crashes
const t0 = CB_TASKS[0];
const synt = await runHarness("function extractInt( {", t0);
ok(synt.err && cbGrade(synt, t0.tests.length).pass === 0, "a syntax error is a load failure and a fail", synt);
const thrower = await runHarness("function extractInt() { throw new Error('x'); }", t0);
ok(thrower.r.every((x) => x === 0) && cbGrade(thrower, t0.tests.length).pass === 0, "a thrown error fails every test");

// ---- extractor, grader ---------------------------------------------------------------------------------------------------------------
ok(cbExtractCode("Here:\n```js\nfunction f(){return 1}\n```\nDone") === "function f(){return 1}", "fenced block");
ok(cbExtractCode("```javascript\nexport function f(){return 1}\nmodule.exports = f;\n```") === "function f(){return 1}", "export and module.exports lines are dropped");
ok(cbExtractCode("export default class A {}") === "class A {}", "a bare reply that looks like code is used, export default dropped");
ok(cbExtractCode("I cannot do that.") === "", "prose is no code");
ok(cbExtractCode("```ts\nimport x from 'y';\nconst f = () => 1;\n```") === "const f = () => 1;", "an import line is dropped");
ok(cbGrade({ r: [1, 1, 0] }, 3).pass === 0 && cbGrade({ r: [1, 1, 0] }, 3).actual === "2/3", "grade partial");
ok(cbGrade({ r: [1, 1] }, 3).pass === 0, "a short result is a fail");
ok(cbGrade({ err: "load: boom" }, 3).actual.indexOf("load: boom") >= 0, "an error keeps its text");
ok(cbGrade(null, 3).pass === 0, "no answer is a fail");
const noLoader = await cbExec({}, "export default {}");
ok(noLoader.noLoader === true, "no LOADER binding is reported, not run");
const viaLoader = await cbExec({ LOADER }, cbHarness(REF["swe-extract-int"], "extractInt", CB_TASKS[0].tests));
ok(viaLoader.r && viaLoader.r.every((x) => x === 1), "cbExec returns the harness answer through the loader", viaLoader);

// ---- the state machine ---------------------------------------------------------------------------------------------------------------
function makeEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE benchmark_results (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, task_id TEXT, model TEXT, expected TEXT, actual TEXT, pass INTEGER)");
  db.exec("CREATE TABLE report_card_inputs (key TEXT PRIMARY KEY, value TEXT, source TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT)");
  db.exec("INSERT INTO metric_registry (metric, state) VALUES ('coding_battery_pass_rate','UNMEASURED'), ('coding_battery_age_days','UNMEASURED')");
  const stmt = (sql, args) => ({
    bind(...x) { return stmt(sql, x); },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; }
  });
  const AUDIT_DB = { prepare: (sql) => stmt(sql, []), async batch(list) { for (const s of list) await s.run(); return []; } };
  return { db, env: { AUDIT_DB, AI: {}, LOADER } };
}
const MODELS = ["m-a", "m-b"];
const solveAll = async (model, messages) => {
  const user = messages[1].content;
  const task = CB_TASKS.find((t) => user.indexOf(t.brief) >= 0);
  return "```js\n" + REF[task.id] + "\n```";
};
{
  const { db, env } = makeEnv();
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('code_battery_models', ?1)").run(MODELS.join(","));
  aiImpl = solveAll;
  let now = Date.parse("2026-11-05T00:00:00Z");
  const r0 = await codeBatteryTick(env, now);
  ok(r0.ran && /^cb-1-2026-11-05$/.test(r0.started), "the first tick starts a run", r0);
  const st0 = JSON.parse(db.prepare("SELECT value FROM ops_config WHERE key = 'code_battery_state'").get().value);
  ok(st0.n === MODELS.length * CB_TASKS.length && st0.i === 0, "the run holds models x tasks pairs", st0);
  const held = await codeBatteryTick(env, now + 1000);
  ok(!held.ran && held.reason === "lease-held", "a second tick inside the lease does nothing", held);
  now += 7 * 60000;
  const r1 = await codeBatteryTick(env, now);
  ok(r1.ran && r1.task === CB_TASKS[0].id && r1.model === "m-a" && r1.pass === 1, "tick 1 runs the first pair and the reference passes", r1);
  ok(aiCalls[aiCalls.length - 1].model === "m-a", "the model of the pair is asked");
  // an AI error is retried twice, then recorded as not answered
  aiImpl = async () => { throw new Error("upstream 5xx"); };
  const before = db.prepare("SELECT COUNT(*) n FROM benchmark_results").get().n;
  for (let k = 0; k < 2; k++) { now += 7 * 60000; const r = await codeBatteryTick(env, now); ok(r.ran && r.retry === true && r.pass === null, "ai error " + k + " is retried", r); }
  ok(db.prepare("SELECT COUNT(*) n FROM benchmark_results").get().n === before, "a retried pair writes no row");
  now += 7 * 60000;
  const r3 = await codeBatteryTick(env, now);
  ok(r3.ran && r3.retry === false && r3.pass === null, "the third failure is recorded as not answered", r3);
  const na = db.prepare("SELECT pass, actual FROM benchmark_results ORDER BY id DESC LIMIT 1").get();
  ok(na.pass === null && /^ai-error/.test(na.actual), "pass is NULL and the error is kept", na);
  aiImpl = solveAll;
  // the model for the second half is m-b: a model that always answers wrong
  let guard = 0;
  while (guard++ < 200) {
    now += 7 * 60000;
    const cur = JSON.parse(db.prepare("SELECT value FROM ops_config WHERE key = 'code_battery_state'").get().value);
    if (cur.done) break;
    if (cur.i >= CB_TASKS.length) aiImpl = async () => "```js\nfunction nothing() { return 0; }\n```";
    await codeBatteryTick(env, now);
  }
  const fin = JSON.parse(db.prepare("SELECT value FROM ops_config WHERE key = 'code_battery_state'").get().value);
  ok(!!fin.done && fin.i === fin.n, "the run finishes", fin);
  const rows = db.prepare("SELECT model, COUNT(*) n, SUM(pass) ok, SUM(pass IS NULL) na FROM benchmark_results WHERE task_id LIKE 'cb-1:%' GROUP BY model ORDER BY model").all();
  ok(rows.length === 2 && rows[0].model === "m-a" && rows[0].n === CB_TASKS.length, "one row per pair", rows);
  ok(rows[0].na === 1 && rows[0].ok === CB_TASKS.length - 1, "model a: every answered pair passes, the error pair is NULL", rows[0]);
  ok(rows[1].ok === 0 && rows[1].n === CB_TASKS.length, "model b: every pair fails", rows[1]);
  const rate = db.prepare("SELECT value, source FROM report_card_inputs WHERE key = 'coding_battery_pass_rate'").get();
  ok(rate && Math.abs(Number(rate.value) - 0.5) < 1e-9, "the pass rate is the mean over models, errors left out", rate);
  ok(/proxy/.test(rate.source), "the source labels the battery a proxy");
  const detail = JSON.parse(db.prepare("SELECT value FROM report_card_inputs WHERE key = 'coding_battery_detail'").get().value);
  ok(detail.models.length === 2 && detail.models[0].answered === CB_TASKS.length - 1, "the detail row lists answered and passed per model", detail);
  const m1 = db.prepare("SELECT last_value, state FROM metric_registry WHERE metric = 'coding_battery_pass_rate'").get();
  const m2 = db.prepare("SELECT last_value, state FROM metric_registry WHERE metric = 'coding_battery_age_days'").get();
  ok(m1.state === "MEASURED" && Number(m1.last_value) === 0.5 && m2.last_value === "0", "both metric rows are written", { m1, m2 });
  ok(auditEvents.some((e) => e.kind === "code-battery.finished" && e.status === "ok"), "a finished event is audited");
  // idle: nothing runs for 7 days, the age metric follows
  const idle = await codeBatteryTick(env, now + 3 * 86400000);
  ok(!idle.ran && idle.reason === "idle" && idle.age_days === 3, "an idle battery reports its age", idle);
  ok(db.prepare("SELECT last_value FROM metric_registry WHERE metric = 'coding_battery_age_days'").get().last_value === "3", "the age metric is refreshed");
  // after the interval a new run starts
  const again = await codeBatteryTick(env, now + 8 * 86400000);
  ok(again.ran && !!again.started, "a new run starts after the interval", again);
  // the switch
  db.prepare("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('code_battery', 'off')").run();
  const off = await codeBatteryTick(env, now + 9 * 86400000);
  ok(!off.ran && off.reason === "off", "ops_config code_battery = off stops it", off);
}
{
  // no LOADER: the pair is not answered (NULL), never a wrong answer
  const { db, env } = makeEnv();
  delete env.LOADER;
  aiImpl = solveAll;
  let now = Date.parse("2026-11-05T00:00:00Z");
  await codeBatteryTick(env, now);
  for (let k = 0; k < 3; k++) { now += 7 * 60000; await codeBatteryTick(env, now); }
  const r = db.prepare("SELECT pass, actual FROM benchmark_results LIMIT 1").get();
  ok(r && r.pass === null && r.actual === "no-loader", "a missing sandbox is recorded as not answered", r);
}
{
  // no code in the reply is a wrong answer
  const { db, env } = makeEnv();
  aiImpl = async () => "I would rather not.";
  let now = Date.parse("2026-11-05T00:00:00Z");
  await codeBatteryTick(env, now);
  now += 7 * 60000;
  const r = await codeBatteryTick(env, now);
  ok(r.pass === 0 && r.actual === "no-code", "a reply without code is a fail", r);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
