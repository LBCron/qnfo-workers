// PAPER-LEARN-STALE-1 offline suite: replays migrations/2026-11-05-c8-paper-learn-stale-metric.sql on node:sqlite. Output MUST contain "0 failed" on success.
// Proves: the guard metric reads 0 when no adopted PAPER-LEARN goal older than 96 hours has a learning still in probation, reads the count when one has, ignores a settled learning (the consumer
// backlog is not this step), a young goal, a completed goal and another goal family; the fleet_tick trigger refreshes the reading in the first ten minutes and on a migration tick; the metric has
// a trigger with code-task and an anchor that occurs once in qnfo-lifecycle/worker.js, a cause mapping, a failure mode and a detector whose needle is in the worker; a replay changes nothing;
// the Rollback removes what the file added.
// Run: node --no-warnings migrations/c8-paper-learn-stale-metric.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-c8-paper-learn-stale-metric.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../qnfo-lifecycle/worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- CAUSE-MAPPED: /m.test(sql), "header opts in and maps the cause");
const d = new DatabaseSync(":memory:");
d.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), source TEXT NOT NULL);
CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_key TEXT UNIQUE NOT NULL, status TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE paper_learnings (id INTEGER PRIMARY KEY, fleet_status TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
const goal = (key, status, ageH, learnSt, id) => { d.prepare("INSERT INTO goals (goal_key, status, created_at) VALUES (?, ?, datetime('now', ?))").run(key, status, "-" + ageH + " hours"); if (id) d.prepare("INSERT INTO paper_learnings VALUES (?, ?)").run(id, learnSt); };
goal("PAPER-LEARN-101", "adopted", 120, "already-in-place", 101);
goal("PAPER-LEARN-102", "adopted", 10, "probation", 102);
goal("PAPER-LEARN-103", "completed", 200, "rejected", 103);
goal("OTHER-GOAL-104", "adopted", 300, "probation", 104);
d.exec(sql);
const reading = () => d.prepare("SELECT last_value v, state s FROM metric_registry WHERE metric = 'paper_learn_goals_stale_96h'").get();
ok(reading().v === "0" && reading().s === "MEASURED", "reads 0 when the old adopted goal has a settled learning, the probation one is young, and the others are not in the family", reading());
goal("PAPER-LEARN-105", "adopted", 100, "probation", 105);
d.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:test')").run();
ok(reading().v === "1", "a goal older than 96 hours whose learning is still in probation counts (the tick on a migration refreshes it)", reading());
d.exec("UPDATE paper_learnings SET fleet_status = 'rejected' WHERE id = 105");
d.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:test')").run();
ok(reading().v === "0", "the reading falls to 0 once the learning is settled (falsifiable)", reading());
d.exec("UPDATE metric_registry SET last_value = 'stale'");
d.prepare("INSERT INTO fleet_tick (source) VALUES ('cron')").run();
const inWindow = new Date().getUTCMinutes() < 10;
ok((reading().v === "0") === inWindow, "a plain tick refreshes only in the first ten minutes of the hour", { inWindow, v: reading().v });
const trg = d.prepare("SELECT * FROM analytics_metric_triggers WHERE metric_key = 'paper_learn_goals_stale_96h'").get();
ok(trg && trg.operator === "gt" && trg.threshold === 0 && trg.enabled === 1 && trg.queue_target === "agent_issues" && /\ncode-task: repo=qnfo-workers path=qnfo-lifecycle\/worker\.js\ncode-anchor: async function plRetriage\(env, o, mechs, now, out\) \{$/.test(trg.action), "the trigger files an issue with a code task and an anchor", trg && trg.action.slice(-160));
ok((worker.match(/async function plRetriage\(env, o, mechs, now, out\) \{/g) || []).length === 1, "the anchor occurs exactly once in qnfo-lifecycle/worker.js");
ok(d.prepare("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'paper_learn_goals_stale_96h'").get().cause_key === "code-loop", "the breach cause is mapped");
const fm = d.prepare("SELECT * FROM failure_modes WHERE fm_key = 'paper-learn-probation-stuck'").get();
const rc = d.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-paper-learn-probation-stuck'").get();
ok(fm && rc && rc.verify_transport === "code-read" && JSON.parse(rc.verify_probe).paths[0] === "qnfo-lifecycle/worker.js" && worker.includes(JSON.parse(rc.verify_probe).contains), "the failure mode has a detector whose needle is in the worker today");
ok(d.prepare("SELECT COUNT(*) n FROM decision_log WHERE capability_gain = 'paper-learn-stale-guard'").get().n === 1, "the decision is logged once");
const snap = () => JSON.stringify([d.prepare("SELECT metric, kind, target FROM metric_registry").all(), d.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get(), d.prepare("SELECT COUNT(*) n FROM failure_modes").get(), d.prepare("SELECT COUNT(*) n FROM remediation_contracts").get(), d.prepare("SELECT COUNT(*) n FROM decision_log").get(), d.prepare("SELECT COUNT(*) n FROM metric_breach_cause").get()]);
const s1 = snap(); d.exec(sql); ok(snap() === s1, "a replay adds nothing");
d.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
ok(d.prepare("SELECT COUNT(*) n FROM metric_registry").get().n === 0 && d.prepare("SELECT COUNT(*) n FROM analytics_metric_triggers").get().n === 0 && d.prepare("SELECT COUNT(*) n FROM failure_modes").get().n === 0 && d.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n === 0 && d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'paper_learn_stale_tick'").get().n === 0, "the rollback removes what the file added");
console.log(pass + " passed, " + fail + " failed");
