// FLEET-CONTROL-WRITES-1 offline suite for migrations/2026-11-05-fleet-control-writes-doer.sql: one doer issue with the code-task / code-anchor / code-probe triple, filed once.
// Run: node --no-warnings migrations/fleet-control-writes-doer.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-fleet-control-writes-doer.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT NOT NULL, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
db.exec(sql);
db.exec(sql);
const rows = db.prepare("SELECT title, description, priority, status, source FROM agent_issues").all();
ok(rows.length === 1 && rows[0].status === "open" && rows[0].priority === "high" && rows[0].source === "session:D1-observability", "the doer is filed once and open", rows.length);
const d = rows[0].description;
ok(/\ncode-task: repo=qnfo-workers path=qnfo-fleet-control\/worker\.js\n/.test(d), "the code-task line names the worker");
ok(/\ncode-anchor: ev\.breaches\.length, JSON\.stringify\(ev\)\.slice\(0, 180000\), sha, commit\.sha \|\| null\n/.test(d), "the code-anchor is the snapshot INSERT binding");
ok(/\ncode-probe: \{"paths":\["qnfo-fleet-control\/worker\.js"\],"contains":"CHARTER-SNAPSHOT-VALID-1"\}$/.test(d), "the code-probe closes it when the fix is on main");
ok(["charterSnapshotJson", "idx_agent_issues_open_title_ci", "ON CONFLICT DO NOTHING", "d1obs/fleet-control-unique-writes"].every((k) => d.includes(k)), "the three changes and the reference branch are named");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'FLEET-CONTROL-WRITES-1:%'").get().n === 1, "the decision is logged once");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
