// W2-B Exuvia bar offline suite: replays migrations/2026-11-05-w2b-exuvia-bar.sql on node:sqlite and checks the row evidence, the filed issue (one row, named doer, no code-task line until its worker is watched), the decision row,
// the backup and idempotence. No live state is read. Output MUST contain "0 failed" on success.   node migrations/w2b-exuvia-bar.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-w2b-exuvia-bar.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
ok(/^-- CAUSE-MAPPED: /m.test(sql) && !/INTO metric_registry/i.test(sql), "registers no metric, says so");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE roadmap_implementation(id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE agent_issues(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
`);
db.prepare("INSERT INTO roadmap_implementation VALUES (1690, 'EXUVIA-ENGAGE-1', 'exuvia-2026-10', 'partial', 'base evidence', NULL)").run();
db.prepare("INSERT INTO roadmap_implementation VALUES (1, 'OTHER', 'x', 'planned', 'keep', NULL)").run();
db.exec(body);
const row = db.prepare("SELECT status s, evidence e FROM roadmap_implementation WHERE id = 1690").get();
ok(row.s === "partial" && row.e.startsWith("base evidence | Near-miss reading 2026-11-05T04:35Z") && /0\.67, 0\.668 and 0\.663/.test(row.e) && /bar stays at 0\.82/.test(row.e), "the row keeps its status and gains the reading and the decision");
ok(db.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 1").get().e === "keep", "other rows are untouched");
ok(db.prepare("SELECT evidence e FROM bak_20261105_w2b_exuvia_row WHERE id = 1690").get().e === "base evidence", "the backup holds the prior evidence");
const iss = db.prepare("SELECT title t, description d, status s, priority p FROM agent_issues WHERE title LIKE 'EXUVIA-PUBLISH-1:%'").all();
ok(iss.length === 1 && iss[0].s === "open", "one open publish issue");
ok(/Owner: the QNFO\.REACH program manager/.test(iss[0].d) && /ops_config exuvia_publish/.test(iss[0].d) && /at most 1 post in 24 hours/.test(iss[0].d), "the issue names its doer and the gate and caps of the step");
ok(!/^code-task:/m.test(iss[0].d), "no parseable code-task line (its worker is not yet in WATCHED of code-anchor-once.test.mjs)");
ok(/Definition of done/.test(iss[0].d), "the issue states its definition of done");
const src = readFileSync(new URL("../qnfo-memory-mcp/worker.js", import.meta.url), "utf8");
ok(src.split("async function exuviaCron(env) {").length - 1 === 1, "the function the hand-off names occurs once in qnfo-memory-mcp/worker.js");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'W2-B Exuvia bar:%'").get().n === 1, "one decision row");
db.exec(body);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "a second run adds no issue and no decision");
ok((db.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 1690").get().e.match(/Near-miss reading/g) || []).length === 1, "a second run does not repeat the evidence");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
