// D1-CALLER-REJECT-2 (qnfo-ops 2.58.4, agent_issues 1000427, BREACH-DOCTOR-1 rule TD-D1Q-REJECT, charter pillar autonomy) offline suite. Run: node qnfo-ops/d1-query-caller-reject.test.mjs
// D1-CALLER-REJECT-1 (#1925, d1-caller-reject.test.mjs) made ops_d1_write mark D1 refusing the caller's own SQL as rejected, so logToolEvent logs the ops_ai_tool event 'rejected' and no TOOL-FAILURE is
// filed. ops_d1_query had no such treatment: 463 error and 1 rejected events in 7 days (read 2026-10-26). A syntax error, an unrecognized token, a compound SELECT over the D1 limit, a LIKE pattern over
// the D1 limit, a wrong number of parameter bindings, a constraint or a type mismatch is now rejected; an infrastructure failure and a missing column or table (the schema-hint path) stay errors.
// Slices d1Query and its guards, the redaction block and logToolEvent out of worker.js and runs them against in-memory SQLite and stub bindings.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
const ok = (c, m, d) => { if (c) passed++; else { failed++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");

const a = src.indexOf("var D1_READONLY_PRAGMAS =");
const b = src.indexOf('__name(d1Query, "d1Query");');
ok(a > 0 && b > a, "the d1Query block is found in worker.js");
const d1Query = new Function("DB_MAP", "__name", src.slice(a, b) + "\nreturn d1Query;")({ audit: "QNFO_AUDIT", living: "LIVING_PAPER" }, (f) => f);

// The status logToolEvent derives from the result, sliced from worker.js with the redactor it writes meta through.
const rb0 = src.indexOf("var OPS_REDACT_MARK");
const rb1 = src.indexOf("\n__name(redactLooksSecret", rb0);
const l0 = src.indexOf("function opsFitArgs(args, budget) {"); // OPS-TOOL-META-FIT-1: logToolEvent fits its arguments into the 600-character meta
const l1 = src.indexOf('__name(logToolEvent, "logToolEvent");', l0);
ok(rb0 > 0 && rb1 > rb0 && l0 > 0 && l1 > l0, "the redactor and logToolEvent blocks are found in worker.js");
const logToolEvent = new Function("__name", "randId", "iso", "logAuditTrail", src.slice(rb0, rb1) + "\n" + src.slice(l0, l1) + "\nreturn logToolEvent;")((f) => f, (p) => p + "test", () => "2026-10-26T12:00:00.000Z", async () => {});
async function eventOf(res, args) {
  const rows = [];
  const env = { QNFO_AUDIT: { prepare(sql) { return { bind(...x) { return { async run() { rows.push({ sql, x }); } }; } }; } } };
  await logToolEvent(env, "ops_d1_query", args || { sql: "SELECT 1" }, res, 7);
  const r = rows[0];
  return r ? { sql: r.sql, kind: r.x[2], text: r.x[3], meta: r.x[4], status: r.x[6] } : null;
}

// D1-shaped bindings: the live message is "D1_ERROR: <sqlite message> at offset N: SQLITE_ERROR".
function bindDb(dbx) {
  return { prepare(sql) { let args = []; const s = { bind(...x) { args = x; return s; }, async all() {
    try { return { results: dbx.prepare(sql).all(...args) }; } catch (e) { throw new Error("D1_ERROR: " + e.message + ": SQLITE_ERROR"); } } }; return s; } };
}
function throwingEnv(msg) { return { QNFO_AUDIT: { prepare() { const s = { bind() { return s; }, async all() { throw new Error(msg); } }; return s; } } }; }
const audit = new DatabaseSync(":memory:");
audit.exec("CREATE TABLE agent_issues (id INTEGER, title TEXT, status TEXT); INSERT INTO agent_issues VALUES (1, 'a', 'open');"
  + " CREATE TABLE d1_schema_index (db TEXT, tbl TEXT, ord INTEGER, col TEXT, cols TEXT); INSERT INTO d1_schema_index VALUES ('audit', 'agent_issues', 1, 'id', 'id, title, status');");
const env = { QNFO_AUDIT: bindDb(audit) };
const statusOf = (res) => (res && (res.ok || res.not_found) ? "ok" : res && res.rejected ? "rejected" : "error");

// 1. a real SQLite syntax error through the sliced d1Query: rejected, the message is kept, the event is logged rejected and carries the text the closing probe reads
{
  const r = await d1Query(env, { db: "audit", sql: "SELECT id FORM agent_issues" });
  ok(r.ok === false && r.rejected === true && statusOf(r) === "rejected", "a syntax error is a rejected caller error", r);
  ok(/syntax error/.test(r.error || "") && /^D1_ERROR: /.test(r.error || "") && r.db === "QNFO_AUDIT", "the database error and the binding are still returned to the model", r);
  const ev = await eventOf(r, { sql: "SELECT id FORM agent_issues" });
  ok(ev && ev.kind === "ops_ai_tool" && ev.text === "ops_d1_query" && ev.status === "rejected", "logToolEvent logs the syntax error as an ops_ai_tool event with status rejected", ev);
  ok(ev && ev.meta.indexOf("syntax error") >= 0, "the event meta holds the error text (the closing probe of issue 1000427 reads instr(meta, 'syntax error'))", ev && ev.meta);
}

// 2. every other class of the caller's own SQL that D1 refuses, in the live message shape
const callerErrors = [
  ['D1_ERROR: near ".": syntax error at offset 121: SQLITE_ERROR', "syntax error"],
  ["D1_ERROR: unrecognized token: \"'2026-C1...\" at offset 84: SQLITE_ERROR", "unrecognized token"],
  ["D1_ERROR: too many terms in compound SELECT: SQLITE_ERROR", "compound SELECT over the D1 limit"],
  ["D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR", "LIKE pattern over the D1 limit"],
  ["D1_ERROR: Wrong number of parameter bindings for SQL query.", "parameter bindings"],
  ["D1_ERROR: datatype mismatch: SQLITE_MISMATCH", "datatype mismatch"],
  ["D1_ERROR: UNIQUE constraint failed: agent_issues.id: SQLITE_CONSTRAINT", "constraint"],
];
for (const [msg, what] of callerErrors) {
  const r = await d1Query(throwingEnv(msg), { db: "audit", sql: "SELECT id FROM agent_issues" });
  ok(r.ok === false && r.rejected === true && statusOf(r) === "rejected" && r.error === msg, "rejected: " + what, r);
}

// 3. an infrastructure failure and a thrown non-Error stay errors (the doctor and the tool-failure filer must still see them)
for (const msg of ["D1_ERROR: Network connection lost.", "D1_ERROR: D1 DB is overloaded. Requests queued for too long.", "D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.", "internal error; reference = abc123"]) {
  const r = await d1Query(throwingEnv(msg), { db: "audit", sql: "SELECT id FROM agent_issues" });
  ok(r.ok === false && !r.rejected && statusOf(r) === "error", "stays an error: " + msg.slice(0, 50), r);
  const ev = await eventOf(r);
  ok(ev && ev.status === "error", "its event is still logged error: " + msg.slice(0, 40), ev);
}
{
  const env2 = { QNFO_AUDIT: { prepare() { const s = { bind() { return s; }, async all() { throw "boom"; } }; return s; } } };
  const r = await d1Query(env2, { db: "audit", sql: "SELECT id FROM agent_issues" });
  ok(r.ok === false && !r.rejected && r.error === "boom", "a thrown string stays an error", r);
}

// 4. a missing column or table stays an error on purpose and keeps its schema hint (D1-SCHEMA-HINT-1): the failure count is how schema guessing is seen
{
  const r = await d1Query(env, { db: "audit", sql: "SELECT nope FROM agent_issues" });
  ok(r.ok === false && !r.rejected && statusOf(r) === "error", "no such column stays an error", r);
  ok(/no such column/.test(r.error || "") && /id, title, status/.test(r.available_columns || ""), "no such column still carries the live columns", r);
  const t = await d1Query(env, { db: "audit", sql: "SELECT id FROM agent_issue" });
  ok(t.ok === false && !t.rejected && statusOf(t) === "error" && /no such table/.test(t.error || ""), "no such table stays an error", t);
  ok(Array.isArray(t.schema_tables) && t.schema_tables.indexOf("agent_issues") >= 0, "no such table still lists the tables", t);
}

// 5. the paths the change must not touch: a good query, the read-only guard, an unbound database
{
  const r = await d1Query(env, { db: "audit", sql: "SELECT id, title FROM agent_issues" });
  ok(r.ok === true && r.rowCount === 1 && !("rejected" in r) && statusOf(r) === "ok", "a correct query is unchanged", r);
  const w = await d1Query(env, { db: "audit", sql: "DELETE FROM agent_issues" });
  ok(w.ok === false && w.rejected === true, "a write is still refused by the read-only guard", w);
  ok(audit.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1, "no row was removed");
  const u = await d1Query({}, { db: "audit", sql: "SELECT 1" });
  ok(u.ok === false && /db not bound/.test(u.error || "") && !u.rejected, "an unbound database is still a plain error", u);
}

// 6. the source: one marker, placed in d1Query's catch directly after the out object, ahead of the schema-hint branch, the regular expression the issue names, a mirror and a version
{
  const marks = src.split("D1-CALLER-REJECT-2").length - 1;
  ok(marks >= 1, "worker.js carries D1-CALLER-REJECT-2", marks);
  const i0 = src.indexOf("const out = { ok: false, db: bind, error: msg };");
  const i1 = src.indexOf("D1-CALLER-REJECT-2", i0);
  const i2 = src.indexOf("// D1-SCHEMA-HINT-1 (issue #1162", i0);
  ok(i0 > 0 && src.indexOf("const out = { ok: false, db: bind, error: msg };", i0 + 10) < 0, "the anchor line occurs exactly once");
  ok(i1 > i0 && i1 < i2 && i1 - i0 < 120, "the marker sits directly after the out object, ahead of the schema hint", [i0, i1, i2]);
  ok(src.slice(i0, i2).indexOf("/syntax error|SQLITE_CONSTRAINT|datatype mismatch|unrecognized token|too many terms in compound SELECT|LIKE or GLOB pattern too complex|Wrong number of parameter bindings/i.test(msg)) out.rejected = true;") > 0, "the statement is the one the issue names");
  ok(/res && \(res\.ok \|\| res\.not_found\) \? "ok" : res && \(res\.rejected \|\| res\.arg_error \|\| res\.user_code_error\) \? "rejected" : "error"/.test(src), "logToolEvent still maps a rejected result to status rejected (and a not_found result to ok, TOOL-MISS-NOT-FAILURE-1)");
  ok(src.indexOf('else if (name === "ops_d1_query") res = await d1Query(env, args);') > 0, "execTool hands the d1Query result to logToolEvent unchanged");
}
ok(mirror === src, "the deployed-current mirror is identical to worker.js");
const ver = (/^var VERSION = "(\d+)\.(\d+)\.(\d+)/m.exec(src) || []).slice(1).map(Number);
ok(ver.length === 3 && (ver[0] > 2 || (ver[0] === 2 && (ver[1] > 58 || (ver[1] === 58 && ver[2] >= 4)))), "VERSION is at least 2.58.4", ver);

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
