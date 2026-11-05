// OPS-ARG-ALIAS-1 offline suite (qnfo-ops 2.62.20; issues 5775, 5780, 6173, 6193, 6671, 6792, 6767, 6826, 6015, 6860). No network.
// Caller-input mistakes are answered with aliases or a hint (arg_error) and logged as status rejected, not error, so they file no TOOL-FAILURE / LOOP-BREAKER issue.
// Run: node qnfo-ops/tool-arg-alias.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };

const pieces = [
  grab("function opsArgPick(args, keys) {", "\nasync function fleetGraphTool"),
  grab("var FPA_GRAPH_OPS =", "\n// OPS-ARG-ALIAS-1"),
  grab("function fpaCap(s, n) {", "\nfunction fpaIssueRow"),
  grab("async function fleetGraphTool(env, args) {", "\nasync function dashboardFeed"),
  grab("async function cfWorkerRead(env, args) {", "\n__name(cfWorkerRead"),
  grab("async function workspaceGrep(env, args) {", "\n__name(workspaceGrep"),
  grab("var OPS_USER_CODE_RE =", "\nasync function runCodeTool"),
  grab("async function runCodeNet(env, args) {", "\n__name(runCodeNet"),
  grab("var EDC_BATCH = 25;", "\nasync function errorDetailCapture"),
  grab("async function errorDetailCapture(env, windowMs) {", "\n__name(errorDetailCapture"),
];
ok(pieces.every((p) => p.length > 10), "all functions found in worker.js", pieces.map((p) => p.length));
const logSrc = grab("async function logToolEvent(env, name, args, res, ms) {", "\n__name(logToolEvent");
ok(/res\.rejected \|\| res\.arg_error \|\| res\.user_code_error\) \? "rejected"/.test(logSrc), "logToolEvent records arg_error and user_code_error as rejected");
ok(/OPS_USER_CODE_RE\.test\(cm\)/.test(pieces[7]) && /user_code_error: !!\(j && j\.error\)/.test(pieces[7]), "run_code_net marks user code errors");
ok(/user_code_error: !!\(j && j\.error\)/.test(grab("async function runCodeTool(env, args) {", "\n__name(runCodeTool")), "run_code marks user code errors");

const harness = pieces.join("\n").replace(/\n__name\w*\([^\n]*\);?/g, "") + "\nreturn { fleetGraphTool, cfWorkerRead, workspaceGrep, runCodeNet, errorDetailCapture, fpaGraphArgs, opsArgPick, OPS_USER_CODE_RE };";
const iso = () => "2026-11-04T00:00:00.000Z";
const randId = (p) => p + Math.random().toString(36).slice(2);
const calls = [];
globalThis.fetch = async (url, init) => { calls.push(String(url)); return new Response(JSON.stringify({ result: { worker: { id: "w" }, bundle: "" }, success: true }), { status: 200 }); };
const t = new Function("iso", "randId", "CF_ACCOUNT_ID", "EDC_WINDOW_MS", "edcRow", harness)(iso, randId, "acct", 3e5, (ev) => ev && { hash: ev.h, ts: 1, ingestedAt: "x", script: ev.s, type: "t", outcome: "exception", url: null, method: null, status: null, cpu: null, wall: null, exc: "[]" });

// fleet_graph (6173, 6193): {filter:"reading"} with no op
const seen = [];
const env = { MEMORY: { fetch: async (u) => { seen.push(u); return new Response(JSON.stringify({ nodes: [] }), { status: 200 }); } } };
let r = await t.fleetGraphTool(env, { filter: "reading" });
ok(r.ok && r.op === "find" && /fleet-graph\/find\?.*query=reading/.test(seen[0]), "fleet_graph {filter} infers op=find with query", [r, seen]);
r = await t.fleetGraphTool(env, {});
ok(r.ok && r.op === "freshness", "fleet_graph {} infers freshness", r);
r = await t.fleetGraphTool(env, { id: "worker:qnfo-ops" });
ok(r.ok && r.op === "node", "id alone infers node", r);
r = await t.fleetGraphTool(env, { id: "worker:qnfo-ops", direction: "up" });
ok(r.ok && r.op === "impact", "id + direction infers impact", r);
r = await t.fleetGraphTool(env, { from: "a", to: "b" });
ok(r.ok && r.op === "path", "from+to infers path", r);
r = await t.fleetGraphTool(env, { op: "search", q: "x" });
ok(r.ok && r.op === "find", "op alias search -> find", r);
r = await t.fleetGraphTool(env, { op: "bogus" });
ok(r.ok === true && r.op === "freshness" && /op 'bogus' is not a fleet_graph op/.test(r.note), "an invented op is coerced from the other arguments and the answer says so (OPS-TOOL-ERRSHAPE-1; was an arg_error that the model retried)", r);

// cf_worker_read (6671, 6792): {name, maxChars}
const rEnv = { CF_API_TOKEN: "t" };
r = await t.cfWorkerRead(rEnv, { name: "qnfo-research-exec", maxChars: 200000 });
ok(!/worker name required/.test(String(r.error)) && calls.some((u) => /scripts\/qnfo-research-exec/.test(u)), "cf_worker_read accepts name alias", [r, calls]);
r = await t.cfWorkerRead(rEnv, { script_name: "qnfo-x" });
ok(calls.some((u) => /scripts\/qnfo-x/.test(u)), "cf_worker_read accepts script_name alias", calls);
r = await t.cfWorkerRead(rEnv, {});
ok(!r.ok && r.arg_error === true && r.error === "worker name required" && r.hint, "missing worker is arg_error with hint", r);

// workspace_grep (5775, 5780): {query}
let prefixSeen = null;
const gEnv = { BACKUPS_R2: { list: async (o) => { prefixSeen = o; return { objects: [], truncated: false }; }, get: async () => null } };
r = await t.workspaceGrep(gEnv, { query: "stuck_items_over_sla" });
ok(r.error !== "pattern required" && !r.arg_error, "workspace_grep accepts query alias", r);
r = await t.workspaceGrep(gEnv, { regex: "x", path: "/notes/" });
ok(r.error !== "pattern required" && prefixSeen && /notes/.test(JSON.stringify(prefixSeen)), "workspace_grep accepts regex and path aliases", [r, prefixSeen]);
r = await t.workspaceGrep(gEnv, {});
ok(!r.ok && r.arg_error === true && r.error === "pattern required" && r.hint, "missing pattern is arg_error with hint", r);

// run_code_net (6767, 6826): the caller's own TypeError
const codeEnv = (resp) => ({ LOADER: { load: () => ({ getEntrypoint: () => ({ fetch: async () => new Response(JSON.stringify(resp)) }) }) } });
r = await t.runCodeNet(codeEnv({ ok: false, error: "(intermediate value).map is not a function", elapsed_ms: 28 }), { code: "x" });
ok(!r.ok && r.user_code_error === true && /map/.test(r.hint), "user TypeError is user_code_error with hint", r);
r = await t.runCodeNet({}, { code: "x" });
ok(!r.ok && !r.user_code_error, "missing LOADER stays a real error", r);
ok(t.OPS_USER_CODE_RE.test("x is not defined") && !t.OPS_USER_CODE_RE.test("D1_ERROR: overloaded"), "user-code matcher is narrow");

// error capture (6860): batched, overload is a deferral
const mkEvs = (n) => Array.from({ length: n }, (_, i) => ({ h: "h" + i, s: "w" + (i % 3) }));
const runCapture = async (batchImpl) => {
  const events = [];
  const db = {
    prepare: (sql) => ({ bind: (...a) => ({ sql, a, run: async () => { events.push({ sql, a }); return { meta: { changes: 1 } }; } }) }),
    batch: batchImpl,
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, result: { events: { events: mkEvs(60) } } }), { status: 200 });
  const out = await t.errorDetailCapture({ CF_API_TOKEN: "t", QNFO_AUDIT: db }, 6e4);
  return { out, events };
};
let batchSizes = [];
let res = await runCapture(async (stmts) => { batchSizes.push(stmts.length); return stmts.map(() => ({ meta: { changes: 1 } })); });
ok(res.out.inserted === 60 && batchSizes.join() === "25,25,10", "60 rows are written in 3 batches", [res.out, batchSizes]);
ok(res.events.length === 1 && /error-capture-tick/.test(res.events[0].sql) && res.events[0].a[3] === "ok" || res.events.some((e) => e.a && e.a.includes("ok")), "tick row is status ok after batched writes", res.events.map((e) => e.a.slice(-1)));
batchSizes = [];
res = await runCapture(async (stmts) => { batchSizes.push(stmts.length); throw new Error("D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window"); });
ok(batchSizes.length === 1 && res.out.deferred === 60 && !res.out.write_error, "overload stops after one batch and defers the rest", [batchSizes, res.out]);
const tick = res.events.find((e) => /error-capture-tick/.test(e.sql));
ok(tick && tick.a[tick.a.length - 1] === "ok" && /deferred 60/.test(tick.a[2]), "an overload tick is recorded as status ok with the deferral text", tick && tick.a);
res = await runCapture(async () => { throw new Error("SQLITE_ERROR: no such table"); });
const tick2 = res.events.find((e) => /error-capture-tick/.test(e.sql));
ok(res.out.write_error && tick2 && tick2.a[tick2.a.length - 1] === "error", "a non-overload write failure is still status error", tick2 && tick2.a);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
