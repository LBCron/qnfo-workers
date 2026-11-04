// ROADMAP-ORIGINATION-MOVES-1 offline suite: replays 2026-11-04-roadmap-origination-moves.sql on a stub fleet_tasks that holds the real step names of
// management-personas and management-personas-c (read live 2026-11-04 19:05Z) and proves the 25 steps move in order, none is lost or doubled, a second apply
// changes nothing, and a definition that already moved is left alone. Run: node migrations/roadmap-origination-moves.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-roadmap-origination-moves.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

const C_STEPS = ["mi-unmeasured-file", "mi-unmeasured-map", "mi-unmeasured-probe", "mi-unmeasured-close-evidence", "mi-unmeasured-close-log", "mi-unmeasured-close", "lever-request", "lever-log", "lever-report", "lever-mark", "brief-audit",
  "rm-research", "rm-parse", "rm-meta", "rm-reject", "rm-file", "rm-filed", "rm-map", "rm-filed-log", "rm-track", "rm-deployed-evidence", "rm-deployed-log", "rm-deployed-contracts", "rm-deployed-close", "rm-deployed", "rm-metric", "rm-brief",
  "rc-probe", "dg-request", "dg-parse", "dg-nofix", "dg-reject", "dg-apply", "dg-mark", "dg-log", "dg-brief", "ns-brief"];
const MAIN_STEPS = ["recur-clear", "plan-snapshot", "restore-mark", "ns-refresh", "ns-pin", "ns-verdict"];
const MOVED = C_STEPS.filter((n) => /^(rm-|dg-|ns-brief)/.test(n));

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  const mk = (id, names) => db.prepare("INSERT INTO fleet_tasks (id, definition) VALUES (?, ?)").run(id, JSON.stringify({ steps: names.map((n) => ({ type: "sql", name: n, db: "AUDIT", sql: "SELECT '" + n + "'" })) }));
  mk("management-personas", MAIN_STEPS);
  mk("management-personas-c", C_STEPS);
  return db;
}
const names = (db, id) => JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = ?").get(id).definition).steps.map((s) => s.name);
const version = (db, id) => db.prepare("SELECT version v FROM fleet_tasks WHERE id = ?").get(id).v;

const db = build();
db.exec(sql);
const main = names(db, "management-personas"), c = names(db, "management-personas-c");
ok(MOVED.length === 25, "25 steps are moved", MOVED.length);
ok(main.slice(0, MAIN_STEPS.length).join() === MAIN_STEPS.join(), "management-personas keeps its steps first, in order", main);
ok(main.slice(MAIN_STEPS.length).join() === MOVED.join(), "the moved steps follow in their original order", main.slice(MAIN_STEPS.length));
ok(c.join() === C_STEPS.filter((n) => !MOVED.includes(n)).join() && c.length === 12, "management-personas-c keeps the 12 other steps in order", c);
ok(new Set(main).size === main.length && new Set(c).size === c.length, "no duplicate step name");
ok(main.indexOf("rm-research") < main.indexOf("rm-parse") && main.indexOf("rm-parse") < main.indexOf("rm-meta") && main.indexOf("rm-meta") < main.indexOf("rm-file"), "rm-research, rm-parse, rm-meta, rm-file keep their order");
ok(main.indexOf("dg-request") < main.indexOf("dg-brief") && main.indexOf("rm-brief") < main.indexOf("ns-brief"), "delegation chain and brief order kept");
ok(version(db, "management-personas") === 2 && version(db, "management-personas-c") === 2, "each definition is bumped once");
const before = JSON.stringify([main, c, version(db, "management-personas"), db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]);
db.exec(sql);
const after = JSON.stringify([names(db, "management-personas"), names(db, "management-personas-c"), version(db, "management-personas"), db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]);
ok(before === after, "a second apply changes nothing (steps, versions, decision_log)", [before, after]);
// every step keeps its body and type
const steps = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").get().definition).steps;
ok(steps.every((s) => s.type === "sql" && s.db === "AUDIT" && s.sql === "SELECT '" + s.name + "'"), "moved steps keep type, db and sql");
// a workflow that lacks the source steps is left alone
const d2 = new DatabaseSync(":memory:");
d2.exec(`CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT); CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
INSERT INTO fleet_tasks (id, definition) VALUES ('management-personas', '{"steps":[{"type":"sql","name":"a","db":"AUDIT","sql":"SELECT 1"}]}'), ('management-personas-c', '{"steps":[{"type":"sql","name":"b","db":"AUDIT","sql":"SELECT 1"}]}');`);
d2.exec(sql);
ok(names(d2, "management-personas").join() === "a" && names(d2, "management-personas-c").join() === "b", "nothing moves when management-personas-c has no rm-research");
console.log(fail ? "FAILED " + fail : "ok " + pass);
process.exit(fail ? 1 : 0);
