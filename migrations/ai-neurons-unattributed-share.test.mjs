// AI-NEURONS-UNATTRIBUTED-1 migration suite (GitHub 7067): migrations/2026-11-05-ai-neurons-unattributed-share.sql adds the 7-day unattributed-share view and guard metric over the production
// view v_ai_meter_daily (its definition is replayed here verbatim), refreshed from fleet_tick, with a weekly metric trigger and the cause mapping.
// Run: node --no-warnings migrations/ai-neurons-unattributed-share.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-ai-neurons-unattributed-share.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- CAUSE-MAPPED:/m.test(sql), "headers: APPLY-BY, DB, Rollback and CAUSE-MAPPED");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE ai_meter_model_daily (date TEXT, model TEXT, neurons REAL, requests INTEGER, PRIMARY KEY (date, model));
CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER, neurons REAL, PRIMARY KEY (day, worker, purpose, model));
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT, note TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE VIEW v_ai_meter_daily AS
SELECT m.date AS date, CAST(ROUND(SUM(m.neurons)) AS INTEGER) AS neurons, SUM(m.requests) AS requests,
       CAST(ROUND(SUM(m.neurons) - COALESCE((SELECT SUM(c.neurons) FROM ai_call_counters c WHERE c.day = m.date), 0)) AS INTEGER) AS unattributed_neurons
FROM ai_meter_model_daily m
WHERE m.date >= date('now', '-10 days')
GROUP BY m.date;`);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const meter = (n, neurons) => db.prepare("INSERT INTO ai_meter_model_daily VALUES (?, 'm', ?, 10)").run(day(n), neurons);
const counted = (n, neurons) => db.prepare("INSERT INTO ai_call_counters VALUES (?, 'w', 'binding', 'm', 1, ?)").run(day(n), neurons);
db.exec(sql);

const v0 = db.prepare("SELECT * FROM v_ai_neurons_unattributed_7d").get();
ok(v0.days === 0 && v0.value === null, "no meter rows: no verdict (NULL), not 0", v0);
ok(db.prepare("SELECT state s, last_value v FROM metric_registry WHERE metric = 'ai_neurons_unattributed_share_7d'").get().s === "UNMEASURED", "the first reading is UNMEASURED while there is no meter");

for (let n = 1; n <= 4; n++) { meter(n, 1000000); counted(n, 600000); }
ok(db.prepare("SELECT value v FROM v_ai_neurons_unattributed_7d").get().v === null, "four days of meter are under the five-day floor: NULL");
for (let n = 5; n <= 7; n++) { meter(n, 1000000); counted(n, 500000); }
meter(0, 9000000);   // today is partial and is never read
meter(9, 9000000);   // older than the window
const v1 = db.prepare("SELECT * FROM v_ai_neurons_unattributed_7d").get();
// 4 days x 400k + 3 days x 500k = 3.1M of 7M = 44.3
ok(v1.days === 7 && v1.meter_neurons === 7000000 && v1.unattributed_neurons === 3100000 && v1.value === 44.3, "seven complete days: 3.1M of 7M neurons are unattributed = 44.3; today and day 9 are outside", v1);

db.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:test')").run();
const m = db.prepare("SELECT * FROM metric_registry WHERE metric = 'ai_neurons_unattributed_share_7d'").get();
ok(m.kind === "guard" && m.target === "< 20" && m.last_value === "44.3" && m.state === "MEASURED" && m.refresh_class === "computed", "the tick refreshes the guard metric", m);
db.exec("DELETE FROM ai_call_counters");
for (let n = 1; n <= 7; n++) counted(n, 1000000);
db.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:again')").run();
ok(db.prepare("SELECT last_value v FROM metric_registry WHERE metric = 'ai_neurons_unattributed_share_7d'").get().v === "0.0" || db.prepare("SELECT last_value v FROM metric_registry WHERE metric = 'ai_neurons_unattributed_share_7d'").get().v === "0", "everything counted reads 0 (falsifiable)");
db.exec("DELETE FROM ai_call_counters");
for (let n = 1; n <= 7; n++) counted(n, 2000000);
db.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:over')").run();
ok(["0", "0.0"].includes(db.prepare("SELECT last_value v FROM metric_registry WHERE metric = 'ai_neurons_unattributed_share_7d'").get().v), "counters above the meter never read below 0");

const t = db.prepare("SELECT * FROM analytics_metric_triggers WHERE metric_key = 'ai_neurons_unattributed_share_7d'").get();
ok(t && t.operator === "gt" && t.threshold === 20 && t.cooldown_hours === 168 && t.enabled === 1 && t.queue_target === "agent_issues" && /v_ai_meter_vs_counters/.test(t.action) && !/code-task:/.test(t.action), "weekly trigger above 20 with the leaderboard query and no code-task line (the caller is not yet known)", t && { th: t.threshold, cd: t.cooldown_hours });
ok(db.prepare("SELECT cause_key c FROM metric_breach_cause WHERE metric_key = 'ai_neurons_unattributed_share_7d'").get().c === "measurement", "cause mapped to measurement");
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM metric_registry").get().n === 1, "a replay adds no second row");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
