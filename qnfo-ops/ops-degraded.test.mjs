// OPS-DEGRADED-1 (qnfo-ops 2.65.0, agent_issues 1001911, roadmap RM-S1-REDUNDANCY-1 second half), offline. No network, no live state.
// Proves, on the REAL worker (worker.js loaded with the cloudflare:workers import stubbed; a fake qnfo-audit D1 that answers "D1 DB is overloaded"):
//   - three D1 overload errors inside 60 s trip the breaker; fewer, or errors that only look like rate limits (a GitHub 403 "rate limit"), do not;
//   - while degraded, POST /v1/tools/call for a tool that writes qnfo-audit answers HTTP 503 with Retry-After and {degraded:true, d1:"overloaded", retry_after_s}, and the tool never starts;
//   - a tool that does not need D1 (kv_get) keeps running in the same window, and reads on D1 still reach D1 (a read is how an operator sees the recovery);
//   - GET /health carries a degraded block (state, since, retry_after_s, refused, trips) and the capability is advertised;
//   - after the window the next call goes through (half open), three new errors are needed to trip again, and a recovered D1 serves the write;
//   - the pure helpers (classification, window pruning, gate, health) behave as written; the hooks sit at the right places in execTool and the REST route.
// ADVERSARIAL: the breaker is per isolate. This proves one isolate's behaviour, not that every isolate trips together; the live proof is a ops-degraded-trip / ops-degraded-refusal line
// in the Workers logs and /health degraded.trips during the next qnfo-audit overload window.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; process.stdout.write("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "") + "\n"); } };

// ---- the block and its hooks are in the source
const a = src.indexOf("// ---- OPS-DEGRADED-1:BEGIN"), b = src.indexOf("// ---- OPS-DEGRADED-1:END");
ok(a > 0 && b > a, "the OPS-DEGRADED-1 block is in worker.js");
const execStart = src.indexOf("async function execTool(env, name, rawArgs, userText, resultCap) {");
const execEnd = src.indexOf('__name(execTool, "execTool");');
const execBody = src.slice(execStart, execEnd);
ok(execStart > 0 && execEnd > execStart, "execTool is found");
const gateAt = execBody.indexOf("opsD1Gate("), policyAt = execBody.indexOf("policyGateShadow(env, name, args)"), logAt = execBody.indexOf("await logToolEvent(");
ok(gateAt > 0 && policyAt > gateAt && logAt > policyAt, "execTool refuses before the policy gate shadow write and before logToolEvent (a refusal writes nothing to D1)");
ok(/opsD1Note\(/.test(execBody) && execBody.indexOf("opsD1Note(") > policyAt && execBody.indexOf("opsD1Note(") < logAt, "execTool feeds the breaker from the tool result before it logs");
ok(/degraded: true/.test(execBody) && /retry_after_s/.test(execBody), "the refusal result is marked degraded and carries retry_after_s");
ok(/"Retry-After"/.test(src.slice(src.indexOf("async function ownerRestRoutes("), src.indexOf("async function ownerRestRoutes(") + 6000)), "POST /v1/tools/call answers Retry-After");
ok(/ops-degraded-mode/.test(src), "the capability ops-degraded-mode is advertised");
ok(/degraded: opsD1Health\(\)/.test(src), "GET /health carries the degraded block");

// ---- pure helpers
const DBM = { audit: "QNFO_AUDIT", living: "LIVING_PAPER", graph: "QNFO_GRAPH", portfolio: "PORTFOLIO", outreach: "QNFO_OUTREACH", cms: "QNFO_CMS", ipatent: "IPATENT", personal: "PERSONAL" };
ok(new RegExp("var DB_MAP = \\{ audit: \"QNFO_AUDIT\", living: \"LIVING_PAPER\", graph: \"QNFO_GRAPH\", portfolio: \"PORTFOLIO\", outreach: \"QNFO_OUTREACH\", cms: \"QNFO_CMS\", ipatent: \"IPATENT\", personal: \"PERSONAL\" \\};").test(src), "the DB_MAP the helper tests use is the one in worker.js");
const lib = new Function("console", "DB_MAP", src.slice(a, b) + "\nreturn { isOverload: opsD1IsOverload, note: opsD1Note, gate: opsD1Gate, health: opsD1Health, reset: opsD1Reset, targets: opsD1TargetsAudit, writesNow: opsD1WritesNow, WRITING: OPS_D1_WRITING_TOOLS, N: OPS_D1_TRIP_ERRORS, W: OPS_D1_WINDOW_MS, D: OPS_D1_DEGRADED_MS };")({ error() {}, log() {} }, DBM);
const OVER = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window: SQLITE_ERROR";
ok(lib.N === 3 && lib.W === 60000 && lib.D === 60000, "three errors in 60 s, degraded for 60 s");
ok(lib.isOverload(OVER) && lib.isOverload("D1 DB is overloaded") && lib.isOverload("SQLITE_BUSY: too many resources consumed (D1)") && lib.isOverload("D1_ERROR: query timed out"), "D1 overload texts are classified");
ok(!lib.isOverload("D1_ERROR: no such column: timeout_ms at offset 12: SQLITE_ERROR") && !lib.isOverload("model overloaded (request d1f3a9, try later)") && !lib.isOverload("D1_ERROR: table x has no column named timeout"), "a SQL typo naming timeout_ms and a non-D1 text with d1 inside a word are not D1 overload (word boundaries)");
ok(!lib.isOverload("GitHub API rate limit exceeded") && !lib.isOverload("request timed out") && !lib.isOverload("model overloaded, try later") && !lib.isOverload("") && !lib.isOverload(null) && !lib.isOverload("D1_ERROR: syntax error"), "a rate limit, a plain timeout, an overloaded model and a SQL syntax error are not D1 overload");
ok(["ops_d1_write", "ops_issue_run", "ops_research_kick", "research_queue", "idea_submit"].every((t) => lib.WRITING.indexOf(t) >= 0) && ["cf_worker_deploy", "kv_get", "r2_put", "ops_d1_query", "fleet_status", "git_op", "workspace_write", "email_mark", "email_respond"].every((t) => lib.WRITING.indexOf(t) < 0), "the refused set is the qnfo-audit writers and the work they start; deploy, cf, r2, kv, vcs, workspace, the email service tools and reads stay available");
lib.reset();
const T0 = 1_800_000_000_000;
ok(lib.gate(T0, "ops_d1_write") === null && lib.health(T0).state === "ok", "closed: no refusal, state ok");
ok(lib.note(T0, OVER) === false && lib.note(T0 + 1000, OVER) === false && lib.gate(T0 + 2000, "ops_d1_write") === null, "two errors do not trip");
ok(lib.note(T0 + 3000, "GitHub API rate limit exceeded") === false && lib.health(T0 + 3000).state === "ok", "a non-D1 error does not count");
ok(lib.note(T0 + 4000, OVER) === true, "the third D1 error inside 60 s trips");
const g = lib.gate(T0 + 5000, "ops_d1_write");
ok(g && g.retry_after_s === 59 && g.body.degraded === true && g.body.d1 === "overloaded" && g.body.ok === false && g.body.retry_after_s === 59 && /OPS-DEGRADED-1/.test(g.body.error), "open: the write is refused with Retry-After 59 and a degraded body", g);
ok(lib.gate(T0 + 5000, "ops_d1_query") === null && lib.gate(T0 + 5000, "kv_get") === null && lib.gate(T0 + 5000, "cf_worker_deploy") === null, "open: reads and D1-free tools pass");
ok(lib.gate(T0 + 5000, "ops_d1_write", { db: "living" }) === null && lib.gate(T0 + 5000, "ops_d1_write", { db: "graph" }) === null && lib.gate(T0 + 5000, "ops_d1_write", { db: "audit" }) !== null && lib.gate(T0 + 5000, "ops_d1_write", {}) !== null, "open: ops_d1_write is refused for the audit database (named or default) and passes for another database");
ok(lib.gate(T0 + 5000, "ops_d1_write", { db: "qnfo-audit" }) !== null && lib.gate(T0 + 5000, "ops_d1_write", { db: "Audit" }) !== null && lib.gate(T0 + 5000, "ops_d1_write", { db: "QNFO_AUDIT" }) !== null, "open: an unknown or aliased db name resolves to audit exactly as d1Write does, so it is refused too");
ok(lib.gate(T0 + 5000, "ops_issue_run", { confirm: false }) === null && lib.gate(T0 + 5000, "ops_issue_run", {}) === null && lib.gate(T0 + 5000, "ops_issue_run", { confirm: true }) !== null, "open: ops_issue_run is refused only when it would really drain (confirm), its dry run passes");
ok(lib.gate(T0 + 5000, "research_queue", { idea: "x", express: false }) === null && lib.gate(T0 + 5000, "research_queue", { idea: "x" }) !== null, "open: research_queue is refused unless express is false (the read-only related-paper lookup)");
ok(lib.targets("ops_d1_write", { db: "living" }) === false && lib.targets("ops_d1_query", { db: "graph" }) === false && lib.targets("ops_d1_query", {}) === true && lib.targets("kv_get", { db: "living" }) === true, "the target resolver: a write or read on another database is not an audit error, any other tool counts as audit");
const h = lib.health(T0 + 5000);
ok(h.state === "degraded" && h.d1 === "overloaded" && h.trips === 1 && h.refused === 8 && h.retry_after_s === 59 && typeof h.since === "string", "health shows the state, the trip and the refusal", h);
ok(lib.note(T0 + 6000, OVER) === false && lib.health(T0 + 6000).trips === 1, "errors while open do not extend or re-trip it");
ok(lib.gate(T0 + 64000, "ops_issue_run") === null && lib.health(T0 + 64000).state === "ok", "after 60 s it is half open: the call goes through");
ok(lib.note(T0 + 65000, OVER) === false && lib.note(T0 + 66000, OVER) === false && lib.gate(T0 + 66500, "ops_d1_write") === null, "half open needs three new errors, not one");
ok(lib.note(T0 + 67000, OVER) === true && lib.health(T0 + 67000).trips === 2, "and trips again on the third");
lib.reset();
lib.note(T0, OVER); lib.note(T0 + 30000, OVER);
ok(lib.note(T0 + 61000, OVER) === false, "errors older than 60 s fall out of the window");
{ // reads keep erroring while the breaker is open (they are never refused): those errors must not pre-load the half-open window
  lib.reset();
  lib.note(T0, OVER); lib.note(T0 + 1000, OVER);
  ok(lib.note(T0 + 2000, OVER) === true, "(setup) trips at the third error");
  lib.note(T0 + 20000, OVER); lib.note(T0 + 40000, OVER); lib.note(T0 + 60000, OVER);
  ok(lib.gate(T0 + 63000, "ops_d1_write") === null, "(setup) the window has passed");
  ok(lib.note(T0 + 63500, OVER) === false && lib.health(T0 + 63500).trips === 1, "errors that arrived while it was open do not count: one new error after the window does not re-trip");
  ok(lib.note(T0 + 64000, OVER) === false && lib.note(T0 + 64500, OVER) === true && lib.health(T0 + 64500).trips === 2, "three new errors do");
}

// ---- the real worker
const IMPORT = 'import { WorkflowEntrypoint, DurableObject, tracing } from "cloudflare:workers";';
ok(src.indexOf(IMPORT) >= 0, "worker.js import line is the one this loader replaces");
const mod = await import("data:text/javascript;base64," + Buffer.from(src.replace(IMPORT, "var WorkflowEntrypoint = class {}; var DurableObject = class {}; var tracing = { enterSpan(_name, callback) { return callback({ setAttribute() {} }); } };")).toString("base64"));
const worker = mod.default;
const realError = console.error, logs = [];
console.error = (...x) => { logs.push(x.join(" ")); };
let d1State = "overloaded", d1Calls = 0, writeStarted = 0, scratchWrites = 0;
const fakeD1 = {
  prepare(sql) {
    d1Calls++;
    if (/scratch_test/.test(sql) && d1State !== "overloaded") scratchWrites++;
    const q = {
      bind() { return q; },
      async all() { if (/^\s*(insert|update|delete|create)/i.test(sql)) writeStarted++; if (d1State === "overloaded") throw new Error(OVER); return { results: [] }; },
      async run() { if (/^\s*(insert|update|delete|create)/i.test(sql)) writeStarted++; if (d1State === "overloaded") throw new Error(OVER); return { success: true, meta: { changes: 0 } }; },
      async first() { if (d1State === "overloaded") throw new Error(OVER); return null; }
    };
    return q;
  }
};
const kv = { async get(k) { return "value-of-" + k; } };
let livingCalls = 0;
const fakeLiving = { prepare() { livingCalls++; const q = { bind() { return q; }, async all() { throw new Error(OVER); }, async run() { throw new Error(OVER); }, async first() { throw new Error(OVER); } }; return q; } };
const env = { OPS_ROUTER_AUTH_KEY: "test-key", QNFO_AUDIT: fakeD1, LIVING_PAPER: fakeLiving, EQCACHE_KV: kv, OPS_CACHE_KV: kv };
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
const call = (name, args) => worker.fetch(new Request("https://ops.qnfo.org/v1/tools/call", { method: "POST", headers: { Authorization: "Bearer test-key", "content-type": "application/json" }, body: JSON.stringify({ name, arguments: args || {} }) }), env, ctx);
const health = async () => (await (await worker.fetch(new Request("https://ops.qnfo.org/health"), env, ctx)).json());

const baseline = await health();
ok(baseline.degraded && baseline.degraded.state === "ok" && baseline.degraded.trips === 0 && /ops-degraded-mode/.test(JSON.stringify(baseline.capabilities)), "health: state ok, no trips, capability advertised", baseline.degraded);

// an overload on ANOTHER database (here the living-paper D1) must not trip the audit breaker, read or write
for (let i = 0; i < 4; i++) {
  await call("ops_d1_query", { sql: "SELECT 1 AS x", db: "living" });
  await call("ops_d1_write", { sql: "INSERT INTO scratch_test (a) VALUES (1)", db: "living" });
}
const afterLiving = await health();
ok(livingCalls >= 4 && afterLiving.degraded.state === "ok" && afterLiving.degraded.trips === 0, "overload errors of the living database do not trip the audit breaker (8 failing calls)", { livingCalls, d: afterLiving.degraded });

// three reads that hit the overloaded D1 feed the breaker
for (let i = 0; i < 3; i++) {
  const r = await call("ops_d1_query", { sql: "SELECT 1 AS x" });
  const j = await r.json();
  ok(r.status === 200 && j.ok === false && /overloaded/i.test(JSON.stringify(j.result)), "read " + (i + 1) + " reaches D1 and reports the overload (reads are never refused)", { status: r.status, j });
}
const afterTrip = await health();
ok(afterTrip.degraded.state === "degraded" && afterTrip.degraded.trips === 1 && afterTrip.degraded.retry_after_s > 0, "three overload errors trip the breaker in the real worker", afterTrip.degraded);

const callsBefore = d1Calls, writesBefore = writeStarted;
const refused = await call("ops_d1_write", { sql: "INSERT INTO scratch_test (a) VALUES (1)", db: "qnfo-audit" });
const rj = await refused.json();
ok(rj.ok === false && rj.result && rj.result.degraded === true && rj.degraded === true && rj.retry_after_s >= 1, "the 503 keeps the {ok, result} envelope of /v1/tools/call and the degraded fields at the top level", rj);
const ideas = await worker.fetch(new Request("https://ops.qnfo.org/v1/ideas", { method: "POST", headers: { Authorization: "Bearer test-key", "content-type": "application/json" }, body: JSON.stringify({ idea: "x" }) }), env, ctx);
ok(ideas.status === 503 && /^\d+$/.test(ideas.headers.get("Retry-After") || ""), "POST /v1/ideas (which calls ideaSubmit directly) is refused the same way", ideas.status);
const mcp = await worker.fetch(new Request("https://ops.qnfo.org/mcp", { method: "POST", headers: { Authorization: "Bearer test-key", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ops_d1_write", arguments: { sql: "INSERT INTO scratch_test (a) VALUES (1)" } } }) }), env, ctx);
const mj = await mcp.json();
ok(mcp.status === 200 && mj.result && mj.result.isError === true && /degraded/.test(JSON.stringify(mj.result.content)), "the MCP tools/call carries the refusal as an error result", mj);
ok(refused.status === 503 && /^\d+$/.test(refused.headers.get("Retry-After") || "") && Number(refused.headers.get("Retry-After")) >= 1, "a qnfo-audit write answers 503 with Retry-After", { status: refused.status, ra: refused.headers.get("Retry-After") });
ok(rj.degraded === true && rj.d1 === "overloaded" && rj.retry_after_s >= 1 && rj.ok === false, "and a body that says degraded, d1 overloaded, retry_after_s", rj);
ok(d1Calls === callsBefore && writeStarted === writesBefore, "the refused tool never touched D1 and nothing was written (not even a tool event row)", { d1Calls, callsBefore });
ok(logs.some((l) => l.indexOf("ops-degraded-refusal") >= 0 && l.indexOf("ops_d1_write") >= 0), "the refusal is logged as one counted line");

const kvRes = await call("kv_get", { namespace: "eqcache", key: "abc" });
const kvj = await kvRes.json();
ok(kvRes.status === 200 && kvj.ok === true && !(kvj.result && kvj.result.degraded), "a tool that does not need D1 still runs in the same window and succeeds", { status: kvRes.status, kvj });
const readRes = await call("ops_d1_query", { sql: "SELECT 1 AS x" });
ok(readRes.status === 200, "a D1 read is still served so an operator can watch the recovery", readRes.status);
const mid = await health();
ok(mid.degraded.refused >= 1 && mid.degraded.state === "degraded", "health counts the refusal", mid.degraded);

// recovery: the window passes and D1 is healthy again
const realNow = Date.now;
Date.now = () => realNow() + 61000;
d1State = "ok";
const rec = await health();
ok(rec.degraded.state === "ok" && rec.degraded.trips === 1, "after the window the gateway reads ok again", rec.degraded);
scratchWrites = 0;
const wr = await call("ops_d1_write", { sql: "INSERT INTO scratch_test (a) VALUES (1)", db: "audit" });
const wrj = await wr.json();
ok(wr.status === 200 && wrj.ok === true && scratchWrites >= 1, "and the write goes through to a recovered D1 (the statement itself reached it)", { status: wr.status, wrj, scratchWrites });
Date.now = realNow;

console.error = realError;
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
