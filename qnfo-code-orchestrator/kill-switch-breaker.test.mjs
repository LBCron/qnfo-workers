// BP26-KILLSWITCH-READERS-1 and BP26-KILLSWITCH-CAPS-1 offline suite (qnfo-code-orchestrator, pillar autonomy; roadmap rows 1722 and 1723, GitHub 5602 and 5603).
// Proves, by running the real worker against an in-memory D1:
//   A. the kill switch: with ops_config fleet_kill_switch = on a tick starts nothing (no step, no model call, no intake), records ONE kill-switch.observed event per five minutes, leaves a queued
//      task untouched; the flag read is served from a 30 s cache; an unreadable row FAILS OPEN (the tick runs) and the failure is logged; off and absent run the loop.
//   B. the circuit breaker: N consecutive failed steps pause the loop for a bounded time, record code-task.breaker-tripped and file ONE CODE-LOOP-BREAKER-1 issue (deduped against the open
//      one); a paused tick runs no step and makes no model call; an expired pause lets the loop run; a success resets the run; code_loop_breaker = off disables it; N and the pause are bounded.
//   C. the pure helpers (loopControlsParse, breakerStep, breakerPaused) on edge cases: deferred steps count as neither, a trip restarts the run from zero, the state is written only when it changes.
// Run: node --no-warnings qnfo-code-orchestrator/kill-switch-breaker.test.mjs   (exit 0 = all passed)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 500) : "")); } };
let inst = 0;
const load = async () => (await import(pathToFileURL(path.join(here, "worker.js")).href + "?i=" + (++inst))).default;

function makeD1(opts) {
  const db = new DatabaseSync(":memory:");
  const wrap = (sql) => {
    let args = [];
    const st = {
      bind: (...a) => { args = a.map((v) => (v === undefined ? null : v)); return st; },
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      first: async () => { if (opts && opts.failControls && /FROM ops_config WHERE key IN \('fleet_kill_switch'/.test(sql)) throw new Error("D1 DB is overloaded"); return db.prepare(sql).get(...args) || null; },
      all: async () => { if (opts && opts.failControls && /FROM ops_config WHERE key IN \('fleet_kill_switch'/.test(sql)) throw new Error("D1 DB is overloaded"); return { results: db.prepare(sql).all(...args) }; },
    };
    return st;
  };
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);`);
  return { prepare: wrap, _db: db };
}

globalThis.fetch = async () => new Response("nf", { status: 404 });
const logs = [];
const origErr = console.error;
console.error = (m) => { logs.push(String(m)); };

let aiCalls = 0;
const mkEnv = (opts) => ({ ORCH_TOKEN: "t0ken", AUDIT_DB: makeD1(opts), PR_PUBLISH_MODE: "pull", AI: { run: async () => { aiCalls++; return { response: "I would rather explain than edit." }; } } });
const hdr = { authorization: "Bearer t0ken", "content-type": "application/json" };
const tick = async (worker, env, o) => (await worker.fetch(new Request("https://x/v1/tick", { method: "POST", headers: hdr, body: JSON.stringify(Object.assign({ maxSteps: 12, budgetMs: 20000, plan: false, intake: false }, o || {})) }), env)).json();
const addTask = async (worker, env, n) => (await (await worker.fetch(new Request("https://x/v1/tasks", { method: "POST", headers: hdr, body: JSON.stringify({ repo: "qnfo-workers", path: "fx-" + n + "/worker.js", goal: "breaker fixture " + n + ": change something" }) }), env)).json()).id;
const cfg = (env, k, v) => env.AUDIT_DB._db.prepare("INSERT INTO ops_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
const ev = (env, kind) => env.AUDIT_DB._db.prepare("SELECT * FROM cloud_ops_events WHERE kind = ?").all(kind);
const state = (env) => { const r = env.AUDIT_DB._db.prepare("SELECT value FROM ops_config WHERE key = 'code_loop_breaker_state'").get(); return r ? JSON.parse(r.value) : null; };

// ---- A. the kill switch
{
  let worker = await load();
  const env = mkEnv();
  const id = await addTask(worker, env, 1);
  cfg(env, "fleet_kill_switch", "on");
  aiCalls = 0;
  const t1 = await tick(worker, env);
  ok(t1.kill_switch === true && t1.steps === 0 && t1.executed_steps === 0, "A: a tick with the switch on runs nothing", t1);
  ok(aiCalls === 0, "A: no model call while the switch is on", aiCalls);
  const t2 = await tick(worker, env);
  ok(t2.kill_switch === true && ev(env, "kill-switch.observed").length === 1, "A: a second tick inside five minutes adds no second observed event (and is served from the 30 s cache)", ev(env, "kill-switch.observed"));
  const e = ev(env, "kill-switch.observed")[0];
  ok(e && e.job === "qnfo-code-orchestrator" && /fleet_kill_switch = on/.test(e.text) && e.status === "ok", "A: the observed event names the job and the switch", e);
  ok(env.AUDIT_DB._db.prepare("SELECT status, step FROM code_tasks WHERE id = ?").get(id).status === "queued", "A: the queued task is untouched");
  // the same row, a fresh isolate (no cache), switch off: the loop runs
  worker = await load();
  cfg(env, "fleet_kill_switch", "off");
  const t3 = await tick(worker, env);
  ok(!t3.kill_switch && t3.steps >= 1, "A: with the switch off the loop runs a step", t3);
  // absent row: off
  const env2 = mkEnv(); worker = await load(); await addTask(worker, env2, 2);
  const t4 = await tick(worker, env2);
  ok(!t4.kill_switch && t4.steps >= 1, "A: no ops_config row at all is off", t4);
  // an unreadable row fails open
  worker = await load(); logs.length = 0;
  const env3 = mkEnv({ failControls: true }); await addTask(worker, env3, 3);
  const t5 = await tick(worker, env3);
  ok(!t5.kill_switch && t5.steps >= 1, "A: an unreadable controls row fails open: the loop still runs", t5);
  ok(logs.some((l) => /"failed_open":true/.test(l) && /loop-controls/.test(l)), "A: and the failed read is logged", logs.slice(-3));
}

// ---- B. the circuit breaker
{
  let worker = await load();
  const env = mkEnv();
  // tasks forced to the propose step with no window prepared fail at once, without a model call
  const ids = []; for (let i = 10; i < 22; i++) ids.push(await addTask(worker, env, i));
  const dbq = env.AUDIT_DB._db;
  dbq.prepare("UPDATE code_tasks SET step = 'propose'").run();
  cfg(env, "code_loop_breaker_n", "5");
  cfg(env, "code_loop_breaker_pause_min", "20");
  worker = await load();
  const t1 = await tick(worker, env);
  const failed = (t1.results || []).length;
  const st = state(env);
  ok(st && st.trips === 1 && st.until > Date.now() + 15 * 60000 && st.until < Date.now() + 25 * 60000 && st.fails === 0 && !!st.last_trip_at, "B: five consecutive failed steps trip the breaker: a pause of about 20 minutes and a fresh run", { t1: { steps: t1.steps, breaker: t1.breaker }, st });
  ok(t1.breaker && t1.breaker.tripped === true, "B: the tick reports the trip", t1.breaker);
  const trip = ev(env, "code-task.breaker-tripped");
  ok(trip.length === 1 && trip[0].status === "error" && /5 consecutive failed steps/.test(trip[0].text), "B: one code-task.breaker-tripped event", trip);
  const iss = dbq.prepare("SELECT * FROM agent_issues WHERE title LIKE 'CODE-LOOP-BREAKER-1:%'").all();
  ok(iss.length === 1 && iss[0].status === "open" && iss[0].priority === "high" && iss[0].source === "qnfo-code-orchestrator" && !/code-task:/i.test(iss[0].description) && /Owner: qnfo-code-orchestrator/.test(iss[0].description) && /Done:/.test(iss[0].description), "B: one issue is filed with an owner, a lever and a definition of done, and no code-task line", iss.map((i) => i.title));
  const stepsBefore = dbq.prepare("SELECT COALESCE(SUM(attempts), 0) a FROM code_tasks").get().a;

  // paused: a fresh isolate reads the stored state; no step, no model call
  worker = await load(); aiCalls = 0;
  const t2 = await tick(worker, env);
  ok(t2.steps === 0 && t2.executed_steps === 0 && t2.breaker && t2.breaker.paused === true && aiCalls === 0, "B: a paused tick runs no step and makes no model call", t2);
  ok(dbq.prepare("SELECT COALESCE(SUM(attempts), 0) a FROM code_tasks").get().a === stepsBefore, "B: the queue did not move while paused");
  ok(ev(env, "code-task.breaker-tripped").length === 1 && dbq.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'CODE-LOOP-BREAKER-1:%'").get().n === 1, "B: pausing does not re-trip or re-file");

  // pause over: the loop runs again from zero
  const past = JSON.stringify({ fails: 0, until: Date.now() - 1000, trips: 1, last_trip_at: new Date().toISOString() });
  cfg(env, "code_loop_breaker_state", past);
  worker = await load();
  const t3 = await tick(worker, env, { maxSteps: 2 });
  ok(t3.steps >= 1 && !(t3.breaker && t3.breaker.paused), "B: an expired pause lets the loop run", t3);

  // off: the same failures never trip it
  const envOff = mkEnv(); worker = await load();
  for (let i = 30; i < 40; i++) await addTask(worker, envOff, i);
  envOff.AUDIT_DB._db.prepare("UPDATE code_tasks SET step = 'propose'").run();
  cfg(envOff, "code_loop_breaker_n", "5"); cfg(envOff, "code_loop_breaker", "off");
  worker = await load();
  const t4 = await tick(worker, envOff);
  ok(t4.steps >= 5 && state(envOff) === null && ev(envOff, "code-task.breaker-tripped").length === 0, "B: code_loop_breaker = off disables the breaker (steps ran, nothing tripped, no state written)", { steps: t4.steps, st: state(envOff) });

  // the filing is deduped against the open issue: a second trip adds an event, not an issue
  cfg(env, "code_loop_breaker_state", JSON.stringify({ fails: 0, until: 0, trips: 1, last_trip_at: null }));
  dbq.prepare("UPDATE code_tasks SET step = 'propose', status = 'queued', lease_until = NULL").run();
  worker = await load();
  const t5 = await tick(worker, env);
  ok(dbq.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'CODE-LOOP-BREAKER-1:%' AND status = 'open'").get().n === 1, "B: a second trip files no second open issue", { t5: t5.breaker });
}

// ---- C. the pure helpers
{
  const src = readFileSync(path.join(here, "worker.js"), "utf8");
  const tmp = path.join(here, ".kill-switch-breaker-" + process.pid + ".mjs");
  writeFileSync(tmp, src + "\nexport { loopControlsParse as __parse, breakerStep as __step, breakerPaused as __paused, BREAKER_N_DEFAULT as __n, BREAKER_PAUSE_MIN_DEFAULT as __p };\n");
  try {
    const W = await import(pathToFileURL(tmp).href);
    const d = W.__parse([]);
    ok(d.ks === false && d.breakerOn === true && d.n === 30 && d.pauseMin === 30 && d.state.fails === 0 && d.state.until === 0 && W.__n === 30 && W.__p === 30, "C: defaults: switch off, breaker on, N 30, pause 30 minutes", d);
    ok(W.__parse([{ key: "fleet_kill_switch", value: " ON " }]).ks === true && W.__parse([{ key: "fleet_kill_switch", value: "off" }]).ks === false && W.__parse([{ key: "fleet_kill_switch", value: "true" }]).ks === false, "C: only the exact value on (trimmed, any case) is on");
    ok(W.__parse([{ key: "code_loop_breaker", value: "off" }]).breakerOn === false && W.__parse([{ key: "code_loop_breaker", value: "No" }]).breakerOn === false && W.__parse([{ key: "code_loop_breaker", value: "on" }]).breakerOn === true && W.__parse([{ key: "code_loop_breaker", value: "banana" }]).breakerOn === true, "C: the breaker is off only for an explicit off value");
    ok(W.__parse([{ key: "code_loop_breaker_n", value: "3" }]).n === 5 && W.__parse([{ key: "code_loop_breaker_n", value: "5000" }]).n === 200 && W.__parse([{ key: "code_loop_breaker_n", value: "12" }]).n === 12 && W.__parse([{ key: "code_loop_breaker_n", value: "x" }]).n === 30, "C: N is bounded to 5..200");
    ok(W.__parse([{ key: "code_loop_breaker_pause_min", value: "1" }]).pauseMin === 5 && W.__parse([{ key: "code_loop_breaker_pause_min", value: "9999" }]).pauseMin === 240 && W.__parse([{ key: "code_loop_breaker_pause_min", value: "45" }]).pauseMin === 45, "C: the pause is bounded to 5..240 minutes, so a trip is never a permanent stop");
    ok(W.__parse([{ key: "code_loop_breaker_state", value: "{not json" }]).state.fails === 0 && W.__parse([{ key: "code_loop_breaker_state", value: '{"fails":4,"until":99,"trips":2,"last_trip_at":"x"}' }]).state.trips === 2, "C: a garbled state is a clean one; a good one is read");
    const cfg5 = { n: 5, pauseMin: 10 }, T = 1_000_000;
    const fl = (k) => Array.from({ length: k }, () => ({ ok: false, error: "boom" }));
    let r = W.__step(null, fl(4), T, cfg5);
    ok(!r.tripped && r.state.fails === 4 && r.changed, "C: four failures do not trip", r);
    r = W.__step(r.state, fl(1), T, cfg5);
    ok(r.tripped && r.state.fails === 0 && r.state.trips === 1 && r.state.until === T + 600000 && r.errors.length === 1, "C: the fifth, across ticks, trips: the run restarts at zero and the pause is set", r);
    r = W.__step({ fails: 3, until: 0, trips: 0 }, [{ ok: false }, { ok: true }, { ok: false }], T, cfg5);
    ok(!r.tripped && r.state.fails === 1, "C: a success resets the run (3 + fail + success + fail = 1)", r);
    r = W.__step({ fails: 4, until: 0, trips: 0 }, [{ ok: false, deferred: true, error: "claim held" }, { ok: false, deferred: true }], T, cfg5);
    ok(!r.tripped && r.state.fails === 4 && !r.changed, "C: steps deferred behind another session's claim count as neither", r);
    r = W.__step({ fails: 0, until: 0, trips: 0 }, [{ ok: true }, { ok: true }], T, cfg5);
    ok(!r.changed && r.state.fails === 0, "C: only successes on a clean state change nothing, so nothing is written");
    r = W.__step({ fails: 0, until: 0, trips: 3 }, fl(12), T, cfg5);
    ok(r.tripped && r.state.trips === 4 && r.state.fails === 0, "C: a tick of 12 failures trips once and stops counting", r.state);
    ok(W.__paused({ until: T + 1 }, T) === true && W.__paused({ until: T }, T) === false && W.__paused(null, T) === false, "C: paused while until is in the future");
  } finally { try { unlinkSync(tmp); } catch (e) { /* removed */ } }
}

console.error = origErr;
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
