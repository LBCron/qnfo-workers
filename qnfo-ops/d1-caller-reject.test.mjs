// D1-CALLER-REJECT-1 (#1925) offline suite for qnfo-ops d1Write. Run: node qnfo-ops/d1-caller-reject.test.mjs
// D1 refusing the caller's own SQL (NOT NULL / UNIQUE constraint, syntax error, unknown column) returns ok:false with
// rejected:true, so logToolEvent records status 'rejected' and tool_error_files_issue_v2 files no TOOL-FAILURE; an INSERT
// into issue_triage gets a hint to UPDATE the trigger-created row; a write that succeeds or fails for another reason is
// unchanged.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("FAIL " + m); } };

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("async function d1Write(");
const b = src.indexOf('__name(d1Write, "d1Write");', a);
ok(a > 0 && b > a, "d1Write found in worker.js");
const d1Write = new Function("DB_MAP", src.slice(a, b) + "\nreturn d1Write;")({ audit: "QNFO_AUDIT" });

// The status logToolEvent derives from the result (same expression as worker.js logToolEvent).
const statusOf = (res) => (res && (res.ok || res.not_found) ? "ok" : res && res.rejected ? "rejected" : "error");
ok(/res && \(res\.ok \|\| res\.not_found\) \? "ok" : res && \(res\.rejected \|\| res\.arg_error \|\| res\.user_code_error\) \? "rejected" : "error"/.test(src), "logToolEvent still maps rejected results to status rejected (and a not_found result to ok, TOOL-MISS-NOT-FAILURE-1)");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT NOT NULL, triaged_at TEXT); INSERT INTO issue_triage VALUES (1924, 'AUTOTRIAGE-1', 'triaged', 'qnfo-ops', '2026-10-03', '2026-10-03');");
const env = { QNFO_AUDIT: { prepare(sql) { let args = []; const s = { bind(...x) { args = x; return s; }, async run() {
  try { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  // the live D1 message shape, e.g. "D1_ERROR: NOT NULL constraint failed: issue_triage.sla_due_at: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)"
  catch (e) { throw new Error("D1_ERROR: " + e.message + ": " + (/constraint failed/i.test(e.message) ? "SQLITE_CONSTRAINT" : "SQLITE_ERROR")); } } }; return s; } } };

// 1. the filed case: NOT NULL sla_due_at, then UNIQUE issue_id
let r = await d1Write(env, { db: "audit", sql: "INSERT INTO issue_triage (issue_id, rc, triage_state, owner, triaged_at) VALUES (1925, 'AUTOTRIAGE-1', 'triaged', 'qnfo-ops', datetime('now'))" }, "");
ok(r.ok === false && r.rejected === true && statusOf(r) === "rejected", "NOT NULL constraint is a rejected caller error: " + JSON.stringify(r));
ok(/UPDATE issue_triage/.test(r.hint || ""), "issue_triage INSERT gets the UPDATE hint");
r = await d1Write(env, { db: "audit", sql: "INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, triaged_at) VALUES (1924, 'x', 'closed', 'qnfo-ops', 'x', 'x')" }, "");
ok(r.rejected === true && /UNIQUE|PRIMARY/i.test(r.error), "UNIQUE constraint is a rejected caller error: " + JSON.stringify(r));

// 2. syntax error and unknown column are rejected caller errors
r = await d1Write(env, { db: "audit", sql: "UPDATE issue_triage SET triage_state = 'closed' WHERE issue_id = 1924 AND 0 0" }, "");
ok(r.rejected === true && statusOf(r) === "rejected", "syntax error is rejected: " + JSON.stringify(r));
r = await d1Write(env, { db: "audit", sql: "UPDATE issue_triage SET nope = 1 WHERE issue_id = 1924" }, "");
ok(r.rejected === true, "unknown column is rejected: " + JSON.stringify(r));
ok(!("hint" in r), "no issue_triage hint on an UPDATE");

// 3. a correct UPDATE succeeds; a binding failure stays an error
r = await d1Write(env, { db: "audit", sql: "UPDATE issue_triage SET triage_state = 'closed' WHERE issue_id = 1924" }, "");
ok(r.ok === true && r.changes === 1 && statusOf(r) === "ok", "the UPDATE the agent should have sent succeeds");
const broken = { QNFO_AUDIT: { prepare() { return { bind() { return this; }, async run() { throw new Error("D1_ERROR: Network connection lost."); } }; } } };
r = await d1Write(broken, { db: "audit", sql: "UPDATE issue_triage SET triage_state = 'x' WHERE issue_id = 1" }, "");
ok(r.ok === false && !r.rejected && statusOf(r) === "error", "an infrastructure failure is still an error");

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
