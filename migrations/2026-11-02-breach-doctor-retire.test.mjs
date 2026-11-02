import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-02-breach-doctor-retire.sql", import.meta.url), "utf8");
const lines = sql.split(/\r?\n/);
const header = lines.filter((line) => line.startsWith("--"));
const body = lines.filter((line) => !line.startsWith("--")).join("\n");
const rollback = header.find((line) => line.startsWith("-- Rollback:"))?.slice("-- Rollback:".length).trim();
let pass = 0, fail = 0;
const ok = (condition, message, detail) => {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL " + message + (detail === undefined ? "" : " :: " + JSON.stringify(detail).slice(0, 500)));
  }
};

ok(header.some((line) => /^-- APPLY-BY: ci\s*$/.test(line)) && header.some((line) => /^-- DB: qnfo-audit\s*$/.test(line)), "migration targets qnfo-audit through CI");
ok(header.filter((line) => line.startsWith("-- Rollback:")).length === 1 && rollback, "migration has one rollback line");
ok(header.some((line) => line === "-- BACKUP: bak_20261102_breach_doctor_retired_triggers"), "migration names its trigger-definition backup");
ok(/issue-age-live-doers/.test(sql) && /breachDoctorTick/.test(sql) && /BREACH-DOCTOR-WATCH-2/.test(sql), "migration names the replacement duties");
ok(/issue_age_replans/.test(sql) && /breach_selfheal_actions/.test(sql) && /DEPLOY-ALL-MERGES-1/.test(sql), "migration retains the tables used by existing readers");
ok(/COUNT\(\*\)\s*=\s*0/.test(sql) && /deploy_merge_age_tick/.test(sql) && /breach_selfheal_heavy_tick/.test(sql), "closing probe checks that neither retired trigger remains");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE fleet_tick (id INTEGER);
  CREATE TABLE fleet_tick_heavy (id INTEGER);
  CREATE TABLE issue_age_replans (id INTEGER PRIMARY KEY, issue_id INTEGER);
  CREATE TABLE breach_selfheal_actions (id INTEGER PRIMARY KEY, action TEXT);
  CREATE TABLE decision_log (
    actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
    rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
`);
db.exec(rollback);
const original = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
db.exec(body);
const backup = db.prepare("SELECT name, sql FROM bak_20261102_breach_doctor_retired_triggers ORDER BY name").all();
const remains = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('deploy_merge_age_tick','breach_selfheal_heavy_tick')").all();
ok(backup.length === 2 && backup.every((row, i) => row.name === original[i].name && row.sql === original[i].sql), "backup preserves both original trigger definitions", backup);
ok(remains.length === 0, "migration removes both legacy trigger entry points", remains);
ok(db.prepare("SELECT COUNT(*) AS n FROM issue_age_replans").get().n === 0 && db.prepare("SELECT COUNT(*) AS n FROM breach_selfheal_actions").get().n === 0, "both history tables remain readable after migration");
ok(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'BREACH-DOCTOR-RETIRE-1:%'").get().n === 1, "migration records its decision and prediction");

try {
  db.exec(rollback);
  const restored = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  ok(restored.length === original.length && restored.every((row, i) => row.name === original[i].name && row.sql === original[i].sql), "rollback restores both exact stored trigger definitions", restored.map((row) => row.name));
} catch (error) {
  ok(false, "rollback SQL recreates both trigger definitions", String(error));
}

console.log(`breach-doctor-retire: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
