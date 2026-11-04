// BRIEF-STEPS-AFTER-WRITE-1 offline suite: the three brief-append steps move from management-personas to the end of management-personas-b, once, in order.
// Run: node migrations/brief-steps-after-brief-write.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-brief-steps-after-brief-write.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
const mk = (id, names) => db.prepare("INSERT INTO fleet_tasks (id, definition) VALUES (?, ?)").run(id, JSON.stringify({ steps: names.map((n) => ({ type: "sql", name: n, db: "AUDIT", sql: "SELECT '" + n + "'" })) }));
const MAIN = ["plan-snapshot", "rm-research", "rm-track", "rm-brief", "dg-request", "dg-brief", "ns-refresh", "ns-brief"];
const B = ["brief-programs", "brief-portfolio", "brief-outputs", "prune"];
mk("management-personas", MAIN); mk("management-personas-b", B);
const names = (id) => JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = ?").get(id).definition).steps.map((s) => s.name);
db.exec(sql);
ok(names("management-personas").join() === "plan-snapshot,rm-research,rm-track,dg-request,ns-refresh", "the three steps leave management-personas, the rest keeps its order", names("management-personas"));
ok(names("management-personas-b").join() === B.concat(["rm-brief", "dg-brief", "ns-brief"]).join(), "they follow every brief write in management-personas-b, in their order", names("management-personas-b"));
const snap = JSON.stringify([names("management-personas"), names("management-personas-b"), db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]);
db.exec(sql);
ok(snap === JSON.stringify([names("management-personas"), names("management-personas-b"), db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]), "a second apply changes nothing");
console.log(fail ? "FAILED " + fail : "ok " + pass);
process.exit(fail ? 1 : 0);
