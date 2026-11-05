// SESSION-AUTOCONTINUE-1 (qnfo-ops, 2026-11-05, roadmap RM-DURABLE-AGENT-EXECUTION-1 / RM-TP-6-DURABLE-EXECUTION) and PUBLIC-TURN-CAP-KIND-1, offline. No network.
// Proves, on the REAL AgenticOpsExec (loaded from worker.js with a stubbed upstream fetch, node:sqlite for qnfo-audit and a Map for DO storage):
//   - a background run (op start) that spends its round budget schedules a follow-up run of the same session, one second out, with a fresh budget;
//   - the chain is bounded (SESSION_CONTINUE_MAX_DEPTH follow-ups), each hop writes one cloud_ops_events row of kind ops_session_continue,
//     the last run says plainly that no follow-up was scheduled, and op result on the first id returns the whole chain;
//   - the stored transcript is compacted at each boundary (old tool results shortened, newest ones whole);
//   - a follow-up that finishes ends the chain; the off switch (ops_config ops_session_autocontinue = off, or env OPS_SESSION_AUTOCONTINUE = 0)
//     leaves one partial run and no event; a synchronous run (op run) is never continued and reports budget_exhausted;
//   - the pure helpers (switch parsing, follow-up row, history compaction); a public turn's cap is recorded as ops_public_turn_cap.
// ADVERSARIAL: the model is a stub that asks for a tool until it sees the continuation marker, so this proves the plumbing, not that a real
// model resumes well; the live proof is a cloud_ops_events row of kind ops_session_continue and a run record with continued_by.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; process.stdout.write("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x) : "") + "\n"); } };

// ---- pure helpers
const a = src.indexOf("// ---- SESSION-AUTOCONTINUE-1:BEGIN"), b = src.indexOf("// ---- SESSION-AUTOCONTINUE-1:END");
ok(a > 0 && b > a, "the SESSION-AUTOCONTINUE-1 block is in worker.js");
const lib = new Function("__name", "randId", "iso", "snippet", "VERSION", src.slice(a, b) +
  "\nreturn { flag: opsSessionContinueFlag, cont: opsSessionContinuation, compact: opsCompactHistory, MAX: SESSION_CONTINUE_MAX_DEPTH, MARK: SESSION_CONTINUE_MARKER, DIR: SESSION_CONTINUE_DIRECTIVE };")(
  (f) => f, (p) => p + "x", () => "2026-11-05T00:00:00.000Z", (o) => JSON.stringify(o), "test");
ok(lib.MAX === 3, "three follow-ups at most");
ok(lib.flag(null, undefined) === true && lib.flag("on", "1") === true && lib.flag(undefined, "") === true, "absent or on means on");
ok(lib.flag("off", undefined) === false && lib.flag(null, "0") === false && lib.flag(" OFF ", null) === false && lib.flag("false", null) === false && lib.flag(null, "no") === false, "either source saying off turns it off");
const run0 = { id: "run-aaaa11", sid: "s", run: true, max_iters: 4, depth: 0 };
const exhausted = { ok: true, budget_exhausted: true, max_iters: 4 };
const n1 = lib.cont(run0, exhausted, { enabled: true, now: 1000 });
ok(n1 && n1.id === "run-aaaa11-c1" && n1.depth === 1 && n1.root === "run-aaaa11" && n1.parent === "run-aaaa11", "first follow-up id, depth, root and parent", n1);
ok(n1.schedule.at === 2000 && n1.schedule.run === true && n1.schedule.sid === "s" && n1.schedule.max_iters === 4 && n1.schedule.depth === 1, "scheduled one second out, same session, same budget, as a run row", n1 && n1.schedule);
ok(n1.queued.status === "queued" && n1.queued.continues === "run-aaaa11", "the queued run record points back at its parent", n1 && n1.queued);
ok(n1.schedule.text.indexOf(lib.MARK) === 0 && /ORIGINAL task/.test(n1.schedule.text) && /do not repeat steps/.test(n1.schedule.text), "the follow-up prompt carries the marker and tells the model to continue, not restart");
const n2 = lib.cont(Object.assign({}, n1.schedule), exhausted, { enabled: true, now: 1000 });
ok(n2 && n2.id === "run-aaaa11-c2" && n2.depth === 2 && n2.root === "run-aaaa11", "the root id is kept across hops (no -c1-c2 suffix growth)", n2 && n2.id);
ok(lib.cont({ id: "r", sid: "s", run: true, depth: 3, root: "r" }, exhausted, { enabled: true }) === null, "at the depth limit there is no follow-up");
ok(lib.cont(run0, exhausted, { enabled: false }) === null, "disabled means none");
ok(lib.cont(run0, { ok: true, budget_exhausted: false }, { enabled: true }) === null && lib.cont(run0, { ok: false, budget_exhausted: true }, { enabled: true }) === null && lib.cont(run0, null, { enabled: true }) === null, "only an ok run that exhausted its budget continues");
ok(lib.cont({ id: "x", sid: "s", depth: 0 }, exhausted, { enabled: true }) === null, "only a background run row continues (a schedule or a synchronous call does not)");
ok(lib.cont(run0, exhausted, { enabled: true, maxDepth: 1 }) && lib.cont(n1.schedule, exhausted, { enabled: true, maxDepth: 1 }) === null, "maxDepth overrides the default");
const longId = "r".repeat(70);
ok(lib.cont({ id: longId, sid: "s", run: true, depth: 0 }, exhausted, { enabled: true }).id.length <= 64, "a follow-up id stays within the 64-character run id limit");

const hist = [{ role: "user", content: "task" }];
for (let i = 0; i < 12; i++) { hist.push({ role: "assistant", content: "", tool_calls: [{ id: "c" + i }] }); hist.push({ role: "tool", tool_call_id: "c" + i, name: "kv_get", content: "R" + i + ":" + "x".repeat(4000) }); }
const comp = lib.compact(hist);
ok(comp.length === hist.length && comp.every((m, i) => m.role === hist[i].role), "compaction keeps every message and its role and order");
const toolIdx = comp.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
ok(toolIdx.slice(-8).every((i) => comp[i].content === hist[i].content), "the newest 8 tool results stay whole");
ok(toolIdx.slice(0, 4).every((i) => comp[i].content.length < 1700 && /shortened by SESSION-AUTOCONTINUE-1/.test(comp[i].content) && comp[i].content.startsWith(hist[i].content.slice(0, 20))), "older tool results are cut to the cap and say so");
ok(comp.filter((m) => m.role === "assistant").every((m, i) => m.tool_calls && m.tool_calls[0].id === "c" + i) && hist[2].content.length > 4000, "assistant tool_calls are untouched and the input array is not mutated");
ok(lib.compact(null).length === 0 && lib.compact([{ role: "tool", content: null }]).length === 1, "junk input does not throw");

// ---- source shape
ok(/async runTurn\(sid, userContent, cap, onStep, opts\)/.test(src), "runTurn takes the continuable option");
ok(/content: _cont \? SESSION_CONTINUE_DIRECTIVE : BUDGET_EXHAUSTED_DIRECTIVE/.test(src), "a continuable run's final round says a follow-up carries the rest");
ok(/\(this\.env, messages\.concat/.test(src) && (src.match(/opsAgentChat\(this\.env/g) || []).length === 2, "still exactly two model calls in runTurn");
ok(/opsToolBudgetBail\(env, pub \? "public" : "chat", iter, maxIters, deadlineHit, void 0, pub \? "ops_public_turn_cap" : void 0\)/.test(src), "a public turn's budget cap is recorded as ops_public_turn_cap, an owner turn's as ops_tool_budget_bail");
ok(/kind \|\| "ops_tool_budget_bail"/.test(src), "ops_tool_budget_bail stays the default kind");
ok(/"session-autocontinue"/.test(src), "capability session-autocontinue advertised");

// ---- the real Durable Object
const IMPORT = 'import { WorkflowEntrypoint, DurableObject, tracing } from "cloudflare:workers";';
ok(src.indexOf(IMPORT) >= 0, "worker.js import line is the one this loader replaces");
const mod = await import("data:text/javascript;base64," + Buffer.from(src.replace(IMPORT, "var WorkflowEntrypoint = class {}; var DurableObject = class {}; var tracing = { enterSpan(_name, callback) { return callback({ setAttribute() {} }); } };")).toString("base64"));
const d1w = (db) => ({ prepare(sql) { let a2 = []; const q = { bind(...x) { a2 = x.map((v) => (v === undefined ? null : v)); return q; }, async all() { return { results: db.prepare(sql).all(...a2) }; }, async first() { return db.prepare(sql).get(...a2) || null; }, async run() { const r = db.prepare(sql).run(...a2); return { success: true, meta: { changes: Number(r.changes) } }; } }; return q; } });
const realFetch = globalThis.fetch, say = console.log.bind(console);

function makeDO(label, o) {
  o = o || {};
  const audit = new DatabaseSync(":memory:");
  audit.exec("CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);");
  audit.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);");
  if (o.configOff) audit.prepare("INSERT INTO ops_config (key, value) VALUES ('ops_session_autocontinue', 'off')").run();
  const store = new Map();
  let alarmAt = null;
  const ctx = {
    storage: {
      async get(k) { return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined; },
      async put(k, v) { store.set(k, JSON.parse(JSON.stringify(v))); },
      async delete(k) { store.delete(k); },
      async list(opt) { const m = new Map(); for (const [k, v] of store) if (!opt || !opt.prefix || k.startsWith(opt.prefix)) m.set(k, JSON.parse(JSON.stringify(v))); return m; },
      async setAlarm(t) { alarmAt = t; }, async deleteAlarm() { alarmAt = null; }, async getAlarm() { return alarmAt; }
    },
    acceptWebSocket() {}
  };
  const env = Object.assign({ QNFO_AUDIT: d1w(audit), EQCACHE_KV: { async get(k) { return "v".repeat(5000); } } }, o.env || {});
  const dobj = new mod.AgenticOpsExec(ctx, env);
  return { audit, store, dobj, alarm: () => alarmAt };
}
// A model that asks for kv_get on every tool round and, when it sees the continuation marker and o.finishOnMarker, answers.
function stubUpstream(o) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const sawMarker = JSON.stringify(body.messages).indexOf("[SESSION-AUTOCONTINUE-1] Continuation") >= 0;
    let msg;
    if (body.tools && !(o && o.finishOnMarker && sawMarker) && !(o && o.finishAt && calls.length >= o.finishAt)) msg = { role: "assistant", content: "", tool_calls: [{ id: "c" + calls.length, type: "function", function: { name: "kv_get", arguments: JSON.stringify({ key: "k" + calls.length }) } }] };
    else if (body.tools) msg = { role: "assistant", content: "DONE: finished the task" };
    else msg = { role: "assistant", content: "REPORT: completed so far; remaining steps listed" + (JSON.stringify(body.messages).indexOf("Continuing in the next run") >= 0 ? " [continuable]" : " [plain]") };
    return new Response(JSON.stringify({ choices: [{ message: msg, finish_reason: body.tools && msg.tool_calls ? "tool_calls" : "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}
const post = (dobj, body) => dobj.fetch(new Request("https://do.internal/agents/ops-exec", { method: "POST", body: JSON.stringify(body) })).then((r) => r.json());
async function drain(h, limit) {
  let n = 0;
  while (h.alarm() && n < (limit || 12)) { await h.dobj.alarm(); n++; }
  return n;
}
const events = (h, kind) => h.audit.prepare("SELECT meta FROM cloud_ops_events WHERE kind = ?").all(kind).map((r) => JSON.parse(r.meta));
const runRec = (h, id) => h.store.get("run:" + id);
console.log = () => {};
try {
  // S1: the model never finishes: 1 run + 3 follow-ups, then a plain stop.
  {
    const h = makeDO("s1"); const calls = stubUpstream({});
    const st = await post(h.dobj, { op: "start", text: "investigate the fleet", sid: "s1", run_id: "run-test01", max_iters: 3 });
    ok(st.ok && st.id === "run-test01", "start accepts the run", st);
    const ran = await drain(h);
    const r0 = runRec(h, "run-test01"), c1 = runRec(h, "run-test01-c1"), c2 = runRec(h, "run-test01-c2"), c3 = runRec(h, "run-test01-c3");
    ok(ran === 4, "the alarm ran 4 times (one run and three follow-ups)", ran);
    ok(r0 && r0.status === "done" && r0.partial === true && r0.continued_by === "run-test01-c1" && r0.depth === 0, "the first run is done, partial, and points at its follow-up", r0 && { s: r0.status, p: r0.partial, c: r0.continued_by });
    ok(c1 && c1.continued_by === "run-test01-c2" && c1.continues === "run-test01" && c1.depth === 1, "follow-up 1 continues the first run and is continued by follow-up 2", c1 && { c: c1.continued_by, p: c1.continues });
    ok(c2 && c2.continued_by === "run-test01-c3" && c2.depth === 2, "follow-up 2 is continued by follow-up 3", c2 && c2.continued_by);
    ok(c3 && c3.status === "done" && c3.partial === true && c3.continued_by === undefined && c3.depth === 3, "follow-up 3 is the end of the chain", c3 && { s: c3.status, c: c3.continued_by });
    ok(/continues automatically in run run-test01-c1/.test(r0.reply) && /follow-up limit of 3 is reached/.test(c3.reply), "the first reply names its follow-up, the last says the limit is reached", { r0: r0.reply.slice(-200), c3: c3.reply.slice(-200) });
    ok(/\[continuable\]/.test(r0.reply) && /\[continuable\]/.test(c2.reply) && /\[plain\]/.test(c3.reply), "the final round of a continuable run carries the continuation directive; the last run's carries the plain budget directive", { r0: r0.reply.slice(0, 120), c3: c3.reply.slice(0, 120) });
    ok(h.alarm() === null && [...h.store.keys()].filter((k) => k.startsWith("schedule:")).length === 0, "nothing is left scheduled");
    const ev = events(h, "ops_session_continue");
    ok(ev.length === 3 && ev[0].parent === "run-test01" && ev.map((e) => e.depth).sort().join() === "1,2,3", "three ops_session_continue events with parent, child and depth", ev);
    ok(events(h, "ops_agent_session_budget").length === 4 && events(h, "ops_tool_budget_bail").length === 0, "every exhaustion is still logged as session telemetry, none as an interactive bail");
    const res = await post(h.dobj, { op: "result", id: "run-test01", sid: "s1" });
    ok(res.ok && res.run.id === "run-test01" && res.latest && res.latest.id === "run-test01-c3" && res.chain_len === 4, "op result on the first id returns the whole chain", res && { l: res.latest && res.latest.id, n: res.chain_len });
    const hist1 = (await post(h.dobj, { op: "history", sid: "s1" })).messages;
    const tools = hist1.filter((m) => m.role === "tool");
    ok(tools.length === 12 && tools.slice(-8).every((m) => m.content.length > 4000), "12 tool results in the session, the newest 8 whole", tools.map((m) => m.content.length));
    // Compaction runs at a continuation boundary only: after run 3 of 4 the session held 9 tool results, so the oldest 1 was shortened; run 4 adds 3 whole.
    ok(tools[0].content.length < 1700 && /shortened by SESSION-AUTOCONTINUE-1/.test(tools[0].content) && tools.slice(1).every((m) => m.content.length > 4000), "the oldest tool result was shortened at a boundary, the other 11 are whole", tools.map((m) => m.content.length));
    ok(hist1.some((m) => m.role === "assistant" && /REPORT: completed so far/.test(m.content)), "the run reports joined the stored transcript");
    ok(calls.some((cb) => !cb.tools && JSON.stringify(cb.messages).indexOf("[SESSION-AUTOCONTINUE-1] Continuation 1 of at most 3") < 0), "the first follow-up prompt is not in the first run's own calls");
    ok(calls.filter((cb) => cb.tools && JSON.stringify(cb.messages).indexOf("Continuation 1 of at most 3") >= 0).length > 0, "the follow-up run sees its continuation prompt and gets a fresh tool budget");
  }
  // S2: the follow-up finishes, the chain stops at depth 1.
  {
    const h = makeDO("s2"); stubUpstream({ finishOnMarker: true });
    await post(h.dobj, { op: "start", text: "investigate", sid: "s2", run_id: "run-test02", max_iters: 2 });
    const ran = await drain(h);
    const r0 = runRec(h, "run-test02"), c1 = runRec(h, "run-test02-c1");
    ok(ran === 2 && r0.partial === true && r0.continued_by === "run-test02-c1", "the first run continues once", { ran, c: r0 && r0.continued_by });
    ok(c1 && c1.status === "done" && c1.partial === false && c1.continued_by === undefined && /DONE: finished/.test(c1.reply), "the follow-up finishes and ends the chain", c1 && { s: c1.status, p: c1.partial });
    ok(events(h, "ops_session_continue").length === 1, "one continuation event");
  }
  // S3 / S4: the off switches.
  for (const [label, o] of [["config", { configOff: true }], ["env", { env: { OPS_SESSION_AUTOCONTINUE: "0" } }]]) {
    const h = makeDO("s3" + label, o); stubUpstream({});
    await post(h.dobj, { op: "start", text: "investigate", sid: "s3" + label, run_id: "run-off" + label, max_iters: 2 });
    const ran = await drain(h);
    const r0 = runRec(h, "run-off" + label);
    ok(ran === 1 && r0.partial === true && r0.continued_by === undefined && /automatic continuation is switched off/.test(r0.reply), "off switch (" + label + "): one partial run, no follow-up, the reply says so", { ran, tail: r0 && r0.reply.slice(-160) });
    ok(/\[plain\]/.test(r0.reply) && events(h, "ops_session_continue").length === 0, "off switch (" + label + "): the plain budget directive and no event");
  }
  // S5: a synchronous run is never continued.
  {
    const h = makeDO("s5"); stubUpstream({});
    const r = await post(h.dobj, { op: "run", text: "investigate", sid: "s5", max_iters: 2 });
    ok(r.ok && r.budget_exhausted === true && r.max_iters === 2 && /\[plain\]/.test(r.reply), "a synchronous run reports budget_exhausted and gets the plain directive", r && { b: r.budget_exhausted, m: r.max_iters });
    ok(h.alarm() === null && [...h.store.keys()].filter((k) => k.startsWith("schedule:")).length === 0 && events(h, "ops_session_continue").length === 0, "nothing was scheduled for a synchronous run");
  }
  // S6: a run that finishes inside its budget is not partial.
  {
    const h = makeDO("s6"); stubUpstream({ finishAt: 2 });
    await post(h.dobj, { op: "start", text: "quick", sid: "s6", run_id: "run-test06", max_iters: 5 });
    await drain(h);
    const r0 = runRec(h, "run-test06");
    ok(r0 && r0.status === "done" && r0.partial === false && r0.continued_by === undefined && /DONE: finished/.test(r0.reply), "a run inside its budget is done, not partial", r0 && { s: r0.status, p: r0.partial });
  }
} finally { console.log = say; globalThis.fetch = realFetch; }

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
