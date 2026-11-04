import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-issue-age-repair-stop-generator.sql", import.meta.url), "utf8");
const gen = "INSERT INTO agent_issues (title) SELECT 'ISSUE-AGE-24H-REPAIR-1: issue #' || s.id || ' has no live doer' FROM issue_age_tick_state s";
const keep = ["DELETE FROM issue_age_tick_state", "UPDATE remediation_contracts SET status = 'active' WHERE class LIKE 'issue-%' AND ISSUE_AGE_24H_REPAIR_1_NOTE = 1"];
const def = JSON.stringify({ steps: [{ type: "sql", db: "AUDIT", sql: keep[0] }, { type: "sql", db: "AUDIT", sql: gen }, { type: "sql", db: "AUDIT", sql: keep[1] }] });
const db = new DatabaseSync(":memory:");
db.exec("create table fleet_tasks(id,definition,version); create table fleet_tasks_canonical(id,definition);");
db.prepare("insert into fleet_tasks values('issue-age-live-doers',?,2)").run(def);
db.prepare("insert into fleet_tasks_canonical values('issue-age-live-doers',?)").run(def);
db.exec(sql);
let bad = 0;
const t = db.prepare("select definition d, version v from fleet_tasks").get(), c = db.prepare("select definition d from fleet_tasks_canonical").get();
for (const [name, d] of [["fleet_tasks", t.d], ["canonical", c.d]]) {
  const steps = JSON.parse(d).steps.map((s) => s.sql);
  if (steps.length !== 2 || steps.some((s) => s.includes("INSERT INTO agent_issues")) || steps[0] !== keep[0] || steps[1] !== keep[1]) { console.log("FAIL " + name, steps); bad++; }
}
if (t.v !== 3) { console.log("FAIL version", t.v); bad++; }
if (db.prepare("select count(*) n from bak_20261104_issue_age_live_doers_task").get().n !== 2) { console.log("FAIL backup"); bad++; }
db.exec(sql); // idempotent
if (db.prepare("select version v from fleet_tasks").get().v !== 3) { console.log("FAIL not idempotent"); bad++; }
if (bad) process.exit(1);
console.log("ok issue-age-repair-stop-generator");
