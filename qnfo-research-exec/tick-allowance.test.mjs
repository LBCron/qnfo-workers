// RESEARCH-TICK-ALLOWANCE-1 (qnfo-research-exec 0.49.0, pillar cost; BUDGET-SOFT-ROUTE-1: fewer stages per tick, never a hold).
// The daily neuron target (ops_config research_daily_neurons) must bound spend, not only select the lean route: ai_call_counters
// showed 644k, 988k and 996k neurons on 2026-11-01..03 against a 360k target because a tick still ran up to 8 rounds. This suite runs
// researchTickAllowance, researchTickConfig and runLeased from the source against an in-memory qnfo-audit and a scripted clock, over a
// whole UTC day of 144 ticks, once with the governor off (the old drain) and once on.
// Run: node qnfo-research-exec/tick-allowance.test.mjs -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x) : "")); } };
const line = (n) => { const m = new RegExp("\\nvar " + n + " = [^\\n]*").exec(src); if (!m) throw new Error("missing " + n); return m[0]; };
const fn = (h) => { const a = src.indexOf("\n" + h); if (a < 0) throw new Error("missing " + h); return src.slice(a, src.indexOf("\n}\n", a) + 2); };
console.error = () => {};
const consts = ["WORKER", "RESEARCH_DAILY_NEURONS_DEFAULT", "RESEARCH_BUDGET_WORKERS", "RESEARCH_BUDGET_BURST", "RESEARCH_CLAIM_STALE_MIN", "RESEARCH_TICK_MS", "RESEARCH_STAGE_NEURONS_EST_DEFAULT", "RESEARCH_TICK_BURST_DEFAULT", "RESEARCH_FLOOR_EVERY_TICKS", "RESEARCH_INFLIGHT_WINDOW", "RESEARCH_STALE_MAX_MIN", "_researchStageEma"].map(line).join("");
const pure = new Function(consts + fn("function researchTickAllowance(") + fn("async function researchTickConfig(") + fn("async function researchBudget(") + "\nreturn { researchTickAllowance, researchTickConfig, researchBudget };")();
const { researchTickAllowance: allow, researchTickConfig, researchBudget } = pure;

// ---- the allowance, pure ----
const DAY = Date.parse("2026-11-03T00:00:00Z"), TICK = 6e5;
const at = (tick) => DAY + tick * TICK + 5e3;
const bud = (spent, budget = 360000) => ({ ok: true, overBudget: spent >= budget, spent, budget });
let a = allow(bud(0), at(0), {});
ok(a.limited && a.run && a.stages === 3 && a.neurons === 2500, "tick 0, nothing spent: the even share 360k / 144 = 2,500 neurons, 3 stages of 800", a);
a = allow(bud(0), at(0), { est: 800, burst: 1.5 });
ok(a.neurons === 3750 && a.stages === 4, "research_tick_burst 1.5 takes 3,750", a);
a = allow(bud(180000), at(72), {});
ok(a.neurons === 2500 && a.stages === 3, "halfway with half spent: the same even share, 180k / 72 left", a);
a = allow(bud(359000), at(143), {});
ok(a.limited && a.neurons === 1000 && a.stages === 1, "the last tick can spend at most what is left (burst never exceeds the balance)", a);
a = allow(bud(360000), at(10), {});
ok(a.limited && a.duty === 12 && a.stages === 1 && a.neurons === 800, "target spent: a trickle of one stage every 12 ticks, not a hold", a);
ok(allow(bud(360000), at(12), {}).run === true && allow(bud(360000), at(13), {}).run === false && allow(bud(480000), at(24), {}).run === true, "the floor stage lands on every 12th tick, spent past the target or not");
const floorTicks = Array.from({ length: 144 }, (_, t) => allow(bud(400000), at(t), {}).run).filter(Boolean).length;
ok(floorTicks === 12, "a day past its target still runs 12 stages", floorTicks);
a = allow(bud(358800), at(100), {});
ok(a.duty === 12 && a.stages === 1, "1,200 left over 44 ticks (27 neurons a tick, under a twelfth of a stage): the floor, one stage every 12 ticks", a);
a = allow(bud(356000), at(100), {});
ok(a.duty === 9 && a.stages === 1 && a.neurons === 800, "4,000 left over 44 ticks (91 a tick): one stage every 9 ticks, not every tick", a);
ok(allow(bud(0), at(0), { off: true }).limited === false, "research_tick_governor off: no bound");
ok(allow({ ok: true, disabled: true, spent: null, budget: 0 }, at(0), {}).limited === false, "budget 0 disables the bound (explicit override)");
ok(allow({ ok: true, unreadable: true, spent: null, budget: 360000 }, at(0), {}).limited === false, "an unreadable counter never throttles verified work");
ok(allow(bud(0), at(0), {}).staleMin >= 30 && allow(bud(0), at(0), { est: 100000 }).staleMin >= 30, "stale reaper never under 30 minutes");
a = allow(bud(360000), at(12), {});
ok(a.staleMin === 360, "a 12-tick trickle holds the stale reaper at its 360 minute ceiling", a);
ok(allow(bud(0), at(0), {}).staleMin === 120, "3 stages a tick over a 24-row window: rows wait 80 minutes, reaper waits 120", allow(bud(0), at(0), {}).staleMin);

// ---- config ----
const mkDb = (cfg, rows) => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE ai_call_counters (day TEXT, worker TEXT, neurons REAL);");
  for (const [k, v] of Object.entries(cfg || {})) db.prepare("INSERT INTO ops_config VALUES (?, ?)").run(k, String(v));
  for (const r of rows || []) db.prepare("INSERT INTO ai_call_counters VALUES (?,?,?)").run(r[0], r[1], r[2]);
  return db;
};
const envOf = (db, inflight) => ({ QNFO_AUDIT: { prepare(sql) { let args = []; const q = { bind(...x) { args = x; return q; }, async first() { return db.prepare(sql).get(...args) || null; }, async all() { return { results: sql === "INFLIGHT" ? Array.from({ length: args[0] }, (_, i) => ({ id: i })) : db.prepare(sql).all(...args) }; }, async run() { return { meta: {} }; } }; return q; } } });
let c = await researchTickConfig(envOf(mkDb({})));
ok(!c.off && c.est === 800 && c.burst === 1, "defaults", c);
c = await researchTickConfig(envOf(mkDb({ research_tick_governor: "OFF", research_stage_neurons_est: 1200, research_tick_burst: 2 })));
ok(c.off && c.est === 1200 && c.burst === 2, "ops_config overrides, governor off is case-insensitive", c);
c = await researchTickConfig(envOf(mkDb({ research_stage_neurons_est: 3, research_tick_burst: 0.2 })));
ok(c.est === 800 && c.burst === 1, "out-of-range values keep the defaults", c);
c = await researchTickConfig({ QNFO_AUDIT: { prepare() { throw new Error("d1 down"); } } });
ok(!c.off && c.est === 800, "a D1 fault keeps the defaults");

// ---- a whole UTC day through runLeased ----
const DEEP = 1e9;
function mkRunLeased(db, clockRef, cost, calls) {
  class FD extends Date { constructor(...x) { super(...(x.length ? x : [clockRef.t])); } static now() { return clockRef.t; } }
  const addSpend = () => { const n = cost(); db.prepare("INSERT INTO ai_call_counters VALUES (?,?,?)").run(new FD(clockRef.t).toISOString().slice(0, 10), "qnfo-research-exec", n); calls.stages++; calls.neurons += n; };
  const runSlot = async (env, k) => { addSpend(); if (k === 0) clockRef.t += 60000; return { status: "ok", claimed: 1 }; };
  const run = async () => { addSpend(); clockRef.t += 60000; return { status: "ok", claimed: 1 }; };
  const events = [];
  const body = consts + fn("function researchTickAllowance(") + fn("async function researchTickConfig(") + fn("async function researchBudget(") + fn("async function runLeased(") + "\nreturn runLeased;";
  const runLeased = new Function("Date", "logEvent", "leaseAcquire", "leaseRelease", "researchParallel", "researchLeanWidth", "run", "runSlot", "INFLIGHT_SQL", "__attrSlotEnv", body)(
    FD, async (e, kind, text) => { events.push([kind, text]); }, async () => true, async () => {}, async () => 24, async () => 2, run, runSlot, "INFLIGHT", (e) => e);
  return { runLeased, events, FD };
}
function lcg(seed) { let x = seed; return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; }; }
async function simulateDay(cfg, budget) {
  const db = mkDb(Object.assign({ research_daily_neurons: budget }, cfg));
  const clockRef = { t: DAY };
  const rnd = lcg(7);
  const calls = { stages: 0, neurons: 0 };
  const { runLeased, events } = mkRunLeased(db, clockRef, () => Math.round(300 + rnd() * rnd() * 5400), calls);
  const env = envOf(db);
  const perHour = new Array(24).fill(0);
  for (let t = 0; t < 144; t++) {
    clockRef.t = DAY + t * TICK;
    const before = calls.stages;
    await runLeased(env, "t" + t, 8, 4 * 60 * 1e3);
    perHour[Math.floor(t / 6)] += calls.stages - before;
  }
  const spent = db.prepare("SELECT SUM(neurons) AS n FROM ai_call_counters").get().n;
  return { spent, stages: calls.stages, perHour, events };
}
const BUDGET = 360000;
const legacy = await simulateDay({ research_tick_governor: "off" }, BUDGET);
ok(legacy.spent > 2 * BUDGET, "reproduced: with the governor off the lean-width drain spends more than twice the target (width 2 only changes slots per round)", legacy.spent);
const gov = await simulateDay({}, BUDGET);
ok(gov.spent <= BUDGET + 24000, "with the allowance a day stays within the target plus the floor (24k)", gov.spent);
ok(gov.spent >= BUDGET * 0.85, "and still uses the target (throughput is paced, not cut)", gov.spent);
const windows3 = (h) => h.slice(0, 22).every((_, i) => h[i] + h[i + 1] + h[i + 2] >= 1);
ok(windows3(gov.perHour), "every three hours of the day run at least one stage (no hold)", gov.perHour);
ok(gov.events.some((e) => e[0] === "research-budget" && /allowance/.test(e[1])), "the throttle leaves a research-budget event");
const small = await simulateDay({}, 150000);
ok(small.spent <= 150000 + 24000 && windows3(small.perHour), "a smaller target (150k) holds the same way (target plus at most the floor's stages)", [small.spent, small.perHour]);
const early = await simulateDay({ research_stage_neurons_est: 400 }, BUDGET);
ok(early.spent <= BUDGET + 24000 && windows3(early.perHour), "a low stage estimate still holds the day within the target plus the floor", early.spent);
const spentOut = await simulateDay({}, 1000);
ok(spentOut.stages >= 12 && spentOut.stages <= 24, "a target spent in the first minutes keeps its floor (12 stages a day, bounded)", spentOut.stages);
for (const b of [1, 1.25, 1.5]) { const r = await simulateDay({ research_tick_burst: b }, BUDGET); console.log("burst " + b + ": " + Math.round(r.spent) + " neurons, " + r.stages + " stages, per hour " + r.perHour.join(",")); }
console.log("legacy " + Math.round(legacy.spent) + " neurons / " + legacy.stages + " stages; allowance " + Math.round(gov.spent) + " neurons / " + gov.stages + " stages; target " + BUDGET);

// ---- the first round always runs and a manual /run is not metered ----
{
  const db = mkDb({ research_daily_neurons: BUDGET }, [["2026-11-03", "qnfo-research-exec", 359990]]);
  const clockRef = { t: DAY + 6 * 3600e3 };
  const calls = { stages: 0, neurons: 0 };
  const { runLeased } = mkRunLeased(db, clockRef, () => 500, calls);
  const out = await runLeased(envOf(db), "manual", 1, 0);
  ok(calls.stages === 1 && !out.paced, "a one-stage /run is not metered", [calls.stages, out]);
}

// ---- source wiring ----
ok(/rawEnv\.__researchStaleMin = researchTickAllowance\(/.test(src), "scheduled hands the reaper its staleMin");
ok(/var reviserRun = _budTick\.ok && !_budTick\.overBudget && reviserDue\(/.test(src) && /var thinRunP = _budTick\.ok && !_budTick\.overBudget && thinDue\(/.test(src), "reviser and thin-paper steps wait once the target is spent");
ok(/_aiAttempt < _aiMaxRetries/.test(src) && /_aiAttempt = _aiMaxRetries - 1;/.test(src), "aiText retries read the budget-aware cap");

// ---- aiText: a transient failure after the target is spent retries once, not three times ----
{
  const body = fn("async function aiText(");
  const mk = () => new Function("setTimeout", "_aiRateSkip", "aiFallbackFor", "aiSkipLog", "AI_TEXT_MAX_OUT", "aiRunOpts", "logEvent", "AI_TRANSIENT_RE", "AI_TIMEOUT_SKIP", "_costFirst", "MODELS_COST_ORDER", "AI_MODEL_SKIP_MS", "__name", body + "\nreturn aiText;")(
    (f) => { f(); return 0; }, {}, () => null, async () => {}, {}, async () => undefined, async () => {}, /3021|3040|3046|rate limit|capacity temporarily|timeout/i, {}, false, ["a", "b"], 2e4, () => {});
  const callsFor = async (exceeded) => { let n = 0; const env = { __researchDailyBudgetExceeded: exceeded, AI: { run: async () => { n++; throw new Error("3021: rate limit"); } } }; const out = await mk()(env, "@cf/zai-org/glm-5.3-flash", "p", 100, "low"); return { n, out }; };
  const normal = await callsFor(false), lean = await callsFor(true);
  ok(normal.n === 5 && lean.n === 3 && normal.out === "" && lean.out === "", "rate-limited call: 5 attempts normally, 3 once the daily target is spent", [normal, lean]);
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
