// Q08-TICK-ALLOWANCE-1 (q08-signal-engine 0.43.0, pillar cost; BUDGET-SOFT-ROUTE-1: fewer attempts per day, never a hold).
// ops_config q08_daily_neurons (50,000) steered the first writer model but bounded nothing: ai_call_counters showed 119,552, 129,547 and
// 110,450 neurons on 2026-11-01..03 because every tick started an attempt up to the cap of 40 a day (about 2,760 neurons each).
// This suite runs q08Budget, q08TickConfig, q08LastAttemptMs, q08TickAllowance, q08TickMore and governedGenerate from the source against an
// in-memory sqlite (ops_config, ai_call_counters, engine_runs) and a scripted clock, over a whole UTC day of 48 cron ticks (:00 and :30), once
// with the governor off (the old drain) and once on, and pins that no gate, panel or fact-check function was touched by the governor.
// Run: node q08-signal-engine/tick-allowance.test.mjs -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x) : "")); } };
const line = (n) => { const m = new RegExp("\\nvar " + n + " = [^\\n]*").exec(src); if (!m) throw new Error("missing " + n); return m[0]; };
const oneLine = (h) => { const a = src.indexOf("\n" + h); if (a < 0) throw new Error("missing " + h); const b = src.indexOf("\n", a + 1); return src.slice(a, b < 0 ? src.length : b); };
const fn = (h) => { const a = src.indexOf("\n" + h); if (a < 0) throw new Error("missing " + h); return src.slice(a, src.indexOf("\n}\n", a) + 2); };
const consts = ["Q08_DAILY_NEURONS_DEFAULT", "Q08_BUDGET_BURST", "Q08_TICK_MS", "Q08_TICKS_PER_DAY", "Q08_FLOOR_EVERY_TICKS"].map(line).join("");
const govSrc = [fn("async function q08Budget("), fn("async function q08TickConfig("), fn("async function q08LastAttemptMs("), fn("function q08PaceLine("), fn("function q08TickAllowance("), oneLine("function q08Paced("), fn("async function governedGenerate("), fn("async function q08TickMore(")];
const build = (DateImpl, generate) => new Function("Date", "generate", consts + govSrc.join("") + "\nreturn { q08Budget, q08TickConfig, q08LastAttemptMs, q08PaceLine, q08TickAllowance, q08Paced, governedGenerate, q08TickMore };")(DateImpl, generate);
let events = [];
const realErr = console.error;
console.error = (...a) => { events.push(a.map(String).join(" ")); };
const lib0 = build(Date, async () => ({ ok: true }));
const allow = lib0.q08TickAllowance;

// ---- the allowance, pure ----
const DAY = Date.parse("2026-11-03T00:00:00Z"), TICK = 18e5;
const at = (slot, s = 5) => DAY + slot * TICK + s * 1000;
const bud = (spent, budget = 50000) => ({ ok: true, spent, budget, pace: 0 });
const recent = (slot, minAgo = 10) => at(slot) - minAgo * 6e4;
let a = allow(bud(0), at(0), {}, null, 0);
ok(a.limited && a.run && a.behind && a.slot === 0 && a.line === 1042, "tick 0, nothing spent: under the first pace line (50,000 / 48 = 1,042)", a);
a = allow(bud(1042), at(0), {}, recent(0), 0);
ok(a.limited && !a.run && !a.behind && !a.floor && /ahead/.test(a.why), "tick 0 with the line spent and an attempt 10 minutes ago: this tick starts nothing", a);
a = allow(bud(11457), at(10), {}, recent(10), 0);
ok(a.run && a.behind && a.line === 11458 && a.slot === 10, "tick 10: the line is 50,000 x 11 / 48 = 11,458; 11,457 spent is still under it", a);
a = allow(bud(11458), at(10), {}, recent(10), 0);
ok(!a.run && !a.behind, "11,458 spent is on the line, not under it: no attempt", a);
a = allow(bud(49999), at(47, 1799), {}, recent(47), 0);
ok(a.run && a.line === 50000 && a.slot === 47, "the last tick of the day (23:30 to 23:59:59) carries the whole target as its line", a);
a = allow(bud(50000), at(47), {}, recent(47), 0);
ok(!a.run, "the target spent and an attempt 10 minutes ago: no attempt on the last tick", a);
ok(lib0.q08PaceLine(50000, DAY + 864e5 - 1).slot === 47 && lib0.q08PaceLine(50000, DAY + 864e5).slot === 0, "slot 47 ends at midnight and the next UTC day restarts at slot 0");
a = allow(bud(80000), at(20), {}, at(20) - 149 * 6e4, 0);
ok(!a.run && !a.floor, "past the target, 149 minutes after the last attempt: still waiting", a);
a = allow(bud(80000), at(20), {}, at(20) - 150 * 6e4, 0);
ok(a.run && a.floor && a.gapMin === 150 && /floor/.test(a.why), "past the target, 150 minutes after the last attempt: the floor starts one", a);
a = allow(bud(80000), at(20), {}, null, 0);
ok(a.run && a.floor, "no attempt on record (or the table unreadable): the floor reads as due", a);
a = allow(bud(80000), at(20), {}, at(20) - 600 * 6e4, 3000);
ok(!a.run && !a.floor, "a tick that has already spent model calls never takes a floor attempt for its second unit", a);
a = allow(bud(3000), at(20), {}, at(20) - 600 * 6e4, 3000);
ok(a.run && a.behind, "a second unit starts while the day is still under the line", a);
ok(allow(bud(0), at(0), { off: true }, null, 0).limited === false, "q08_tick_governor off: no bound");
ok(allow({ ok: true, disabled: true, spent: null, budget: 0 }, at(0), {}, null, 0).limited === false, "budget 0 disables the bound (explicit override)");
ok(allow({ ok: true, unreadable: true, spent: null, budget: 50000 }, at(0), {}, null, 0).limited === false, "an unreadable counter never throttles verified work");
ok(allow(null, at(0), {}, null, 0).run === true, "no budget reading at all: runs");
const floorSlotsOnly = Array.from({ length: 48 }, (_, k) => k).filter((k) => allow(bud(90000), at(k), {}, at(k) - 150 * 6e4, 0).run).length;
ok(floorSlotsOnly === 48, "the floor is a function of the gap alone: any tick 150 minutes after the last attempt takes it", floorSlotsOnly);

// ---- config and last attempt ----
const mkDb = (cfg) => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE ai_call_counters (day TEXT, worker TEXT, neurons REAL); CREATE TABLE engine_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT, status TEXT, error TEXT);");
  for (const [k, v] of Object.entries(cfg || {})) db.prepare("INSERT INTO ops_config VALUES (?, ?)").run(k, String(v));
  return db;
};
const shim = (db) => ({ prepare(sql) { let args = []; const st = { bind(...x) { args = x; return st; }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { db.prepare(sql).run(...args); return { meta: {} }; } }; return st; } });
const envOf = (db) => ({ AUDIT: shim(db), DB: shim(db) });
ok(!(await lib0.q08TickConfig(envOf(mkDb({})))).off, "governor defaults on");
ok((await lib0.q08TickConfig(envOf(mkDb({ q08_tick_governor: " OFF " })))).off, "ops_config q08_tick_governor = off (any case) turns it off");
ok(!(await lib0.q08TickConfig(envOf(mkDb({ q08_tick_governor: "on" })))).off && !(await lib0.q08TickConfig({})).off, "on and no AUDIT binding keep it on");
ok(!(await lib0.q08TickConfig({ AUDIT: { prepare() { throw new Error("d1 down"); } } })).off, "a D1 fault keeps it on");
{
  const db = mkDb({});
  ok((await lib0.q08LastAttemptMs(envOf(db))) === null, "no engine_runs row: null");
  db.prepare("INSERT INTO engine_runs (ran_at, status) VALUES ('2026-11-03 04:03:09', 'gate_failed'), ('2026-11-03 05:00:00', 'skipped'), ('2026-11-03 05:10:00', 'deferred'), ('2026-11-03 03:00:00', 'ok')").run();
  ok((await lib0.q08LastAttemptMs(envOf(db))) === Date.parse("2026-11-03T04:03:09Z"), "the newest ok or gate_failed row is the last attempt; skipped and deferred rows (no model call) are not");
  ok((await lib0.q08LastAttemptMs({ DB: { prepare() { throw new Error("no such table"); } } })) === null, "an unreadable table reads as null");
}
{
  const db = mkDb({});
  const b1 = await lib0.q08Budget(envOf(db), Date.UTC(2026, 10, 3, 11, 30));
  ok(b1.ok === true && b1.budget === 150000 && b1.pace === Math.round(150000 * (12 / 24 + 0.1)) && b1.spent === 0 && Object.keys(b1).sort().join() === "budget,ok,pace,spent", "q08Budget() contract is unchanged: { ok, spent, budget, pace } with the hourly pace and the 10 percent burst", b1);
  db.prepare("INSERT INTO ops_config VALUES ('q08_daily_neurons', '50000')").run();
  db.prepare("INSERT INTO ai_call_counters VALUES ('2026-11-03', 'q08-signal-engine', 40000), ('2026-11-03', 'qnfo-ai', 99999), ('2026-11-02', 'q08-signal-engine', 99999)").run();
  const b2 = await lib0.q08Budget(envOf(db), Date.UTC(2026, 10, 3, 11, 30));
  ok(b2.budget === 50000 && b2.spent === 40000 && b2.ok === false, "the count is q08's own, for the day only, and over the hourly pace it reads not ok", b2);
}

// ---- a whole UTC day through governedGenerate ----
const lcg = (seed) => { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; };
const MAXC = 8400; // an attempt costs 900 + u1 * u2 * 7500 neurons: mean 2,775 (measured 2,761 on 2026-11-03 and 3,239 on 11-02), tail 8,400
const ATTEMPT_CAP = 40; // cap 10 x 4, the daily attempt cap of generate()
const AUDITS = { 13: 1200, 29: 1200, 41: 1200 }; // auditPublished() calls: unbounded, counted in the day's spend
async function simulateDay({ budget = 50000, governor = "on", seed = 7, stall = true, forecast = true } = {}) {
  const db = mkDb(Object.assign({ q08_daily_neurons: budget }, governor === "off" ? { q08_tick_governor: "off" } : {}));
  const clock = { t: DAY };
  class FD extends Date { constructor(...x) { super(...(x.length ? x : [clock.t])); } static now() { return clock.t; } }
  const rnd = lcg(seed);
  const stamp = () => new FD(clock.t).toISOString().replace("T", " ").slice(0, 19);
  const dayOf = () => new FD(clock.t).toISOString().slice(0, 10);
  const spend = (n) => db.prepare("INSERT INTO ai_call_counters VALUES (?, 'q08-signal-engine', ?)").run(dayOf(), n);
  const row = (status, error) => db.prepare("INSERT INTO engine_runs (ran_at, status, error) VALUES (?, ?, ?)").run(stamp(), status, error || "");
  const starts = [];
  let lib = null;
  const unit = async () => { // one attempt: spends its models' neurons over a few minutes, then writes its row
    const c = Math.round(900 + rnd() * rnd() * 7500);
    spend(c); clock.t += Math.min(780000, 60000 + c * 80);
    row(rnd() < 0.05 ? "ok" : "gate_failed", "gate");
    return c;
  };
  const generate = async (env) => { // the shape of the real generate(): cap check, an optional forecast unit, then the essay unit
    const n = db.prepare("SELECT COUNT(*) AS n FROM engine_runs WHERE status IN ('ok','gate_failed') AND substr(ran_at,1,10) = ?").get(dayOf()).n;
    if (n >= ATTEMPT_CAP) { row("skipped", "daily attempt cap reached"); return { ok: false, reason: "daily attempt cap" }; }
    starts.push(clock.t);
    if (forecast && rnd() < 0.3) {
      if (rnd() < 0.4) { await unit(); if (!(await lib.q08TickMore(env))) return lib.q08Paced("the essay waits"); }
      else row("deferred", "forecast research: 4 usable sources; need 6");
    }
    await unit();
    return { ok: false, reason: "gate failed" };
  };
  lib = build(FD, generate);
  const env = envOf(db);
  events = [];
  let paced = 0, pacedWithRows = 0, secondBlocked = 0;
  for (let slot = 0; slot < 48; slot++) {
    clock.t = DAY + slot * TICK + 5000;
    if (AUDITS[slot]) spend(AUDITS[slot]);
    if (slot % 2 === 1 && !stall) continue;
    const rowsBefore = db.prepare("SELECT COUNT(*) AS n FROM engine_runs").get().n;
    const out = await lib.governedGenerate(env);
    if (out && out.paced) {
      if (/essay waits/.test(out.reason)) secondBlocked++;
      else { paced++; if (db.prepare("SELECT COUNT(*) AS n FROM engine_runs").get().n !== rowsBefore) pacedWithRows++; }
    }
  }
  const spent = db.prepare("SELECT SUM(neurons) AS n FROM ai_call_counters WHERE worker = 'q08-signal-engine'").get().n;
  const attempts = db.prepare("SELECT COUNT(*) AS n FROM engine_runs WHERE status IN ('ok','gate_failed')").get().n;
  const startSlots = starts.map((t) => Math.floor((t - DAY) / TICK));
  const windows3 = Array.from({ length: 43 }, (_, w) => startSlots.some((s) => s >= w && s <= w + 5)).every(Boolean);
  const floors = events.filter((e) => /q08-tick-allowance/.test(e) && /"why":"floor/.test(e)).length;
  const allowanceEvents = events.filter((e) => /q08-tick-allowance/.test(e)).length;
  return { spent, attempts, startSlots, windows3, floors, paced, pacedWithRows, secondBlocked, allowanceEvents, rows: db.prepare("SELECT status, COUNT(*) AS n FROM engine_runs GROUP BY status").all().map((r) => r.status + ":" + r.n).join(" ") };
}
const BUDGET = 50000, AUDIT_TOTAL = 3600;
const summary = [];
for (const seed of [7, 11, 23, 42, 99]) {
  const off = await simulateDay({ governor: "off", seed });
  ok(off.spent > 2 * BUDGET && off.attempts === ATTEMPT_CAP, "seed " + seed + ": reproduced, with the governor off the day spends more than twice the target and runs to the attempt cap (2.2 to 2.6 times on 2026-11-01..03)", [off.spent, off.attempts]);
  ok(off.allowanceEvents === 0 && off.paced === 0, "seed " + seed + ": governor off makes no decision and logs nothing", off);
  const on = await simulateDay({ governor: "on", seed });
  summary.push("seed " + seed + ": off " + Math.round(off.spent) + " neurons / " + off.attempts + " attempts; on " + Math.round(on.spent) + " / " + on.attempts + " (floors " + on.floors + ", ticks that waited " + on.paced + ", essays that waited " + on.secondBlocked + ")");
  ok(on.spent <= BUDGET + AUDIT_TOTAL + MAXC * (1 + on.floors), "seed " + seed + ": with the allowance the day stays within the target plus the unbounded audits plus one attempt over the line plus the floor attempts", [on.spent, on.floors]);
  ok(on.spent >= BUDGET * 0.8, "seed " + seed + ": and still uses the target (attempts are spaced, not cut)", on.spent);
  ok(on.attempts >= 8 && on.attempts <= 26, "seed " + seed + ": about 18 attempts a day instead of 40", on.attempts);
  ok(on.windows3, "seed " + seed + ": every three hours of the day (6 ticks) start at least one attempt", on.startSlots);
  ok(on.pacedWithRows === 0 && on.paced > 0, "seed " + seed + ": a tick that waits writes no engine_runs row (no skipped, no deferred)", on);
  ok(!/skipped/.test(on.rows), "seed " + seed + ": the day never reaches the attempt cap, so no skipped row exists at all", on.rows);
}
for (const [label, opts] of [["a smaller target (25,000)", { budget: 25000 }], ["a larger target (100,000)", { budget: 100000 }], ["only the :00 cron (no stall retry)", { stall: false }], ["no forecast attempts", { forecast: false }]]) {
  const on = await simulateDay(Object.assign({ governor: "on", seed: 5 }, opts));
  const b = opts.budget || BUDGET;
  ok(on.spent <= b + AUDIT_TOTAL + MAXC * (1 + on.floors) && on.windows3, label + ": within the target plus one attempt, the audits and the floor, and no three hours without an attempt", [on.spent, on.floors, on.windows3]);
}
{
  const spentOut = await simulateDay({ governor: "on", seed: 5, budget: 1000 });
  ok(spentOut.attempts >= 7 && spentOut.attempts <= 9 && spentOut.windows3, "a target spent in the first minutes keeps its floor: one attempt, then one every three hours (8 a day), never a quiet day", [spentOut.attempts, spentOut.startSlots]);
  ok(spentOut.floors === spentOut.attempts - 1 || spentOut.floors === spentOut.attempts - 2, "and those attempts are the logged floor attempts", [spentOut.floors, spentOut.attempts]);
}
for (const line_ of summary) realErr(line_);

// ---- the second unit of a tick ----
{
  const db = mkDb({ q08_daily_neurons: 50000 });
  const clock = { t: at(0) };
  class FD extends Date { constructor(...x) { super(...(x.length ? x : [clock.t])); } static now() { return clock.t; } }
  const lib = build(FD, async () => ({}));
  const env = Object.assign(envOf(db), { __q08Gov: { limited: true, run: true, spent: 0 } });
  ok(await lib.q08TickMore(env) === true, "a forecast attempt that made no model call (deferred for lack of sources) leaves the essay free to start");
  db.prepare("INSERT INTO ai_call_counters VALUES ('2026-11-03', 'q08-signal-engine', 3000)").run();
  ok(await lib.q08TickMore(env) === false, "a forecast attempt that spent 3,000 neurons at tick 0 (line 1,042) leaves the essay waiting");
  clock.t = at(20);
  ok(await lib.q08TickMore(env) === true, "at tick 20 (line 21,875) the same 3,000 neurons are still under the line");
  ok(await lib.q08TickMore({ AUDIT: env.AUDIT, DB: env.DB }) === true, "outside the governor (no __q08Gov) the question is always yes");
  const off = Object.assign(envOf(mkDb({ q08_daily_neurons: 50000, q08_tick_governor: "off" })), { __q08Gov: { limited: false, run: true } });
  ok(await lib.q08TickMore(off) === true, "an unlimited tick is never held back");
}

// ---- governedGenerate: a waiting tick calls nothing and writes nothing; /run and /regen are not governed ----
{
  const db = mkDb({ q08_daily_neurons: 50000 });
  db.prepare("INSERT INTO ai_call_counters VALUES ('2026-11-03', 'q08-signal-engine', 20000)").run();
  db.prepare("INSERT INTO engine_runs (ran_at, status) VALUES ('2026-11-03 00:20:00', 'gate_failed')").run();
  const clock = { t: at(1) };
  class FD extends Date { constructor(...x) { super(...(x.length ? x : [clock.t])); } static now() { return clock.t; } }
  let called = 0, seenGov = null;
  const lib = build(FD, async (env) => { called++; seenGov = env.__q08Gov; return { ok: true }; });
  const env = envOf(db);
  const out = await lib.governedGenerate(env);
  ok(out.ok === false && out.paced === true && /tick allowance/.test(out.reason) && called === 0 && db.prepare("SELECT COUNT(*) AS n FROM engine_runs").get().n === 1, "ahead of the line: generate() is not called, the result says paced, no engine_runs row is written", out);
  ok(/work slows, it does not stop/.test(out.reason), "the reason names the rule");
  clock.t = at(30);
  const out2 = await lib.governedGenerate(env);
  ok(out2.ok === true && called === 1 && seenGov && seenGov.limited && seenGov.run, "under the line: generate() runs with the decision on its env", [out2, called]);
  db.prepare("INSERT INTO ops_config VALUES ('q08_tick_governor', 'off')").run();
  clock.t = at(1);
  const out3 = await lib.governedGenerate(env);
  ok(out3.ok === true && called === 2 && seenGov === undefined, "q08_tick_governor = off: generate() runs as before, with no decision on its env", [out3, called]);
  const broken = build(FD, async () => ({ ok: true }));
  const out4 = await broken.governedGenerate({ AUDIT: { prepare() { throw new Error("d1 down"); } }, DB: { prepare() { throw new Error("d1 down"); } } });
  ok(out4.ok === true, "a D1 fault never throttles: the attempt runs");
}

// ---- source wiring: the budget logic writes nothing, the gates are untouched ----
const govFns = ["async function q08TickConfig(", "async function q08LastAttemptMs(", "function q08PaceLine(", "function q08TickAllowance(", "async function governedGenerate(", "async function q08TickMore("].map(fn).join("") + oneLine("function q08Paced(");
ok(!/INSERT|UPDATE|DELETE|insertRun|quit\(|"deferred"|"skipped"|'deferred'|'skipped'/.test(govFns.replace(/status IN \('ok','gate_failed'\)/, "")), "the budget logic never writes: no INSERT, UPDATE, insertRun, quit(), deferred or skipped in the governor functions");
const sched = src.slice(src.indexOf("async function q08Scheduled("), src.indexOf("export default __wm_default;"));
ok((sched.match(/governedGenerate\(env\)/g) || []).length === 2 && !/[^d]generate\(env\)/.test(sched.replace(/governedGenerate\(env\)/g, "")), "both scheduled paths (the :00 cron and the :30 stall retry) go through governedGenerate and call generate() nowhere else");
const runRoute = src.slice(src.indexOf('if (path === "/run" && req.method === "POST") {'), src.indexOf('if (path === "/regen" && req.method === "POST") {'));
ok(/await generate\(env\)/.test(runRoute) && !/governedGenerate/.test(runRoute), "/run (behind x-loop-token) is an operator's kick and stays unmetered");
const gen = src.slice(src.indexOf("async function generate(env) {"), src.indexOf("// Q08-FORECAST-1 (v0.9.0"));
const govRefs = gen.match(/__q08Gov|q08Tick\w*|governedGenerate|q08Paced|q08PaceLine/g) || [];
ok(govRefs.length === 2 && /if \(fout\) return fout;\s*\n[^\n]*\n\s*if \(!\(await q08TickMore\(env\)\)\) return q08Paced\(/.test(gen) && gen.indexOf("q08TickMore(env)") < gen.indexOf("ESSAY_AFTER_FORECAST_MS) return await quit"), "generate() touches the governor in exactly one place: the essay after a spent forecast attempt, ahead of the existing time-based deferral", govRefs);
ok(/if \(Date\.now\(\) - t0 > ESSAY_AFTER_FORECAST_MS\) return await quit\("deferred"/.test(gen) && /daily attempt cap reached/.test(gen) && /daily cap reached/.test(gen), "generate() keeps its own caps and rows");
const gateFns = ["function gate(", "async function verifyPiece(", "async function factCheck(", "async function factCheckOne(", "async function verifyAndRevise(", "async function runLevels(", "async function finalRead(", "async function panelRead(", "async function readerTest(", "async function compose(", "async function auditPublished(", "async function repairPublished(", "async function judgeForecast(", "async function resolveForecasts(", "async function aiGatewayRun(", "function aggregatePanel(", "function groundPreCheck(", "async function generateForecast("];
for (const h of gateFns) {
  let body = "";
  try { body = fn(h); } catch (e) { body = ""; }
  ok(body.length > 200, "the gate path still exists: " + h, body.length);
  ok(!/__q08Gov|q08Tick\w*|governedGenerate|q08Paced|q08PaceLine/.test(body), "the governor does not reach into " + h);
}
ok(/var PANEL_PASS_MEAN = /.test(src) && /var PUBLISH_MIN_CHARS = 2800, FINAL_PASS_MEAN = 4;/.test(src) && /var CLOSE_MISS_MEAN = /.test(src), "the panel and final-read bars are still defined where they were");
ok(/var VERSION = "0\.(4[3-9]|[5-9]\d)\.\d+"/.test(src) || /var VERSION = "[1-9]/.test(src), "VERSION is at least 0.43.0");
ok((src.split("\n").find((l) => l.startsWith("var VERSION")) || "").length < 200, "the VERSION line stays short: the release note lives in the block below it");
ok(!/\*\/[^\n]*\*\//.test((src.split("\n").find((l) => /^\/\* 0\.43\.0 Q08-TICK-ALLOWANCE-1/.test(l)) || "").slice(0, -2)), "the 0.43.0 release note holds its comment close only at the end of its line");

console.error = realErr;
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
