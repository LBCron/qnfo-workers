/**
 * probe-cadence-column.test.mjs -- offline regression lock for PROBE-ERROR-CADENCE-1, ISSUES-OVER-24H-COLUMN-1 and ASSIGN-DOER-SCHEMA-1
 * (qnfo-fleet-control 0.62.1).
 *  1. cadH is in hours: a probe error must leave a contract due within about an hour, not 60 hours (612 contracts on 2026-11-04).
 *  2. the issues_open_over_24h refresh read v_issue_age.state, a column the view does not have ("no such column: state", 654 errors in 6 h).
 *  3. the audit's "ensure a doer" step read program_focus.id and wrote code_tasks.issue_id/task_type/owner, none of which exist.
 * Run: node qnfo-fleet-control/probe-cadence-column.test.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x) : "")); } };
const line = (k) => { const i = src.indexOf(k); return src.slice(i, src.indexOf("\n", i)); };

// 1. probe-error cadence
ok(/if \((?:out\.probe_error|verdict === "probe-error")\) cadH = Math\.max\(cadH, 1\);/.test(src), "a probe error floors the cadence at 1 hour");
ok(!/Math\.max\(cadH, 60\)/.test(src), "no 60-hour floor on a probe error");
const sb = { Math, Number, __out: null };
vm.createContext(sb);
vm.runInContext(line("var RT_HOLD_D = 7") + "\n" + line("var RT_REPROBE_EARLY_MIN") + "\n" + src.slice(src.indexOf("function rtNextDueOffset("), src.indexOf("\n}\n", src.indexOf("function rtNextDueOffset(")) + 3) + "\n__out = { rtNextDueOffset };", sb);
const off = sb.__out.rtNextDueOffset(Math.max(1, 1));
const minutes = Number(/\+(\d+) minutes/.exec(off)[1]);
ok(minutes > 0 && minutes <= 60, "the next probe after an error is due within an hour", off);

// 2. the over-24h refresh runs against the live view shape
const q = /prepare\("(SELECT COUNT\(\*\) AS n FROM v_issue_age WHERE [^"]*)"\)/.exec(src);
ok(!!q, "the over-24h count query is present");
const db = new DatabaseSync(":memory:");
db.exec("CREATE VIEW v_issue_age AS SELECT 1 AS id, 'high' AS priority, 't' AS title, 2000 AS age_min, 33 AS age_h, NULL AS last_bump");
let n = null, err = null;
try { n = db.prepare(q[1]).get().n; } catch (e) { err = String(e.message); }
ok(err === null && n === 1, "the query runs against the live columns of v_issue_age (id, priority, title, age_min, age_h, last_bump)", err);

// 3. the doer step is gone
ok(!/SELECT id, program_code FROM program_focus/.test(src), "no read of program_focus.id");
ok(!/INSERT INTO code_tasks \(issue_id, task_type, owner/.test(src), "no insert into code_tasks columns that do not exist");

console.log("probe-cadence-column: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
