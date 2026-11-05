// FLEET-CRON-GRID-1 offline suite: replays migrations/2026-11-05-families-ops-c.sql on a fleet_crons stub that holds the three live rows read from qnfo-audit on 2026-11-05 00:15Z and proves the three
// crons land on :30, :35 and :40, nothing else moves, a second apply changes nothing, a cron someone moved meanwhile is left alone, and the decision_log row is written once.
// Run: node migrations/families-ops-c.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-families-ops-c.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
function build(extra) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  const ins = db.prepare("INSERT INTO fleet_crons (name, cron_expr, task_id, next_fire) VALUES (?, ?, ?, ?)");
  ins.run("roadmap-self-maintain-goals-hourly", "31 * * * *", "roadmap-self-maintain-goals", "2026-11-05T00:31:00.000Z");
  ins.run("roadmap-self-maintain-roadmap-hourly", "33 * * * *", "roadmap-self-maintain-roadmap", "2026-11-05T00:33:00.000Z");
  ins.run("roadmap-self-maintain-metrics-hourly", "37 * * * *", "roadmap-self-maintain-metrics", "2026-11-05T00:37:00.000Z");
  ins.run("metric-refresh-hourly", "0 * * * *", "metric-refresh", "2026-11-05T01:00:00.000Z");
  ins.run("never-stall-hourly", "5 * * * *", "never-stall", "2026-11-05T01:05:00.000Z");
  if (extra) extra(db);
  return db;
}
const cron = (db, n) => db.prepare("SELECT cron_expr c, next_fire f FROM fleet_crons WHERE name = ?").get(n);
let db = build();
db.exec(sql);
ok(cron(db, "roadmap-self-maintain-goals-hourly").c === "30 * * * *" && cron(db, "roadmap-self-maintain-roadmap-hourly").c === "35 * * * *" && cron(db, "roadmap-self-maintain-metrics-hourly").c === "40 * * * *", "the three crons land on :30, :35 and :40");
ok(cron(db, "metric-refresh-hourly").c === "0 * * * *" && cron(db, "never-stall-hourly").c === "5 * * * *", "other crons are untouched");
ok(cron(db, "roadmap-self-maintain-goals-hourly").f === "2026-11-05T00:31:00.000Z", "next_fire is left to the dispatcher (it recomputes it at the next fire)");
ok(db.prepare("SELECT COUNT(*) c FROM fleet_crons WHERE enabled = 1 AND CAST(substr(cron_expr, 1, instr(cron_expr || ' ', ' ') - 1) AS INTEGER) % 5 <> 0").get().c === 0, "no enabled cron is off the grid afterwards");
const snap = () => JSON.stringify([db.prepare("SELECT name, cron_expr, updated_at FROM fleet_crons ORDER BY name").all(), db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]);
const s1 = snap(); db.exec(sql);
ok(s1 === snap(), "a second apply changes nothing");
ok(db.prepare("SELECT COUNT(*) c FROM decision_log WHERE action LIKE 'FLEET-CRON-GRID-1:%'").get().c === 1, "one decision_log row");
db = build((d) => d.exec("UPDATE fleet_crons SET cron_expr = '20 * * * *' WHERE name = 'roadmap-self-maintain-roadmap-hourly'"));
db.exec(sql);
ok(cron(db, "roadmap-self-maintain-roadmap-hourly").c === "20 * * * *", "a cron that someone has since moved is left alone");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
