// PLUS-2 consumer offline suite: replays migrations/2026-11-05-plus-2-usage-weighted-pick.sql on node:sqlite against a fixture step that carries the two live strings
// (prompt text and ORDER BY) and shows the busier of two equally overdue products is picked first, with the number in its prompt. No live state is read.
// Output MUST contain "0 failed" on success.   node migrations/plus-2-usage-pick.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-plus-2-usage-weighted-pick.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE fleet_tasks(id TEXT PRIMARY KEY, definition TEXT, version INT, updated_at TEXT);
CREATE TABLE product_registry(product TEXT PRIMARY KEY, usage_metric TEXT, usage_value INT, usage_window TEXT);
CREATE TABLE cf_agent_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT, instance TEXT);
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
CREATE VIEW v_product_plus_due AS SELECT product, 146 AS hours_since_plus FROM product_registry;
`);
// the live step shape: the two strings the migration replaces, inside a valid statement (the real one has many more clauses)
const step = "INSERT INTO cf_agent_requests (prompt, instance) SELECT 'failure paths). Usage signal: ' || COALESCE(r.usage_metric, 'none yet') || '. Quality measure: none', r.product FROM v_product_plus_due d JOIN product_registry r ON r.product = d.product ORDER BY d.hours_since_plus DESC LIMIT 3";
const def = JSON.stringify({ steps: [{ type: "sql", name: "pl-research", db: "AUDIT", sql: step }, { type: "sql", name: "pl-other", db: "AUDIT", sql: "SELECT 1" }] });
db.prepare("INSERT INTO fleet_tasks VALUES ('management-personas-plus', ?, 6, 'x')").run(def);
const reg = db.prepare("INSERT INTO product_registry VALUES (?,?,?,?)");
reg.run("research-gateway", "worker_requests_7d", 17453, "7d"); reg.run("papers", "worker_requests_7d", 165043, "7d"); reg.run("q08-home", "worker_requests_7d", 45124, "7d");
reg.run("shorts-channel", "youtube_views_total", null, "lifetime"); reg.run("tiny", "worker_requests_7d", 12, "7d");
const run = (sqlText) => { db.exec("DELETE FROM cf_agent_requests"); db.exec(sqlText); return db.prepare("SELECT instance i, prompt p FROM cf_agent_requests ORDER BY id").all(); };

// before: all five tie on age, so the order is whatever the engine returns, the prompt carries no number
const before = run(step);
ok(!/= 165043/.test(before.map((r) => r.p).join("|")), "before: the prompt carries no usage number");

db.exec(body);
const row = db.prepare("SELECT definition d, version v FROM fleet_tasks WHERE id='management-personas-plus'").get();
const steps = JSON.parse(row.d).steps;
ok(row.v === 7 && steps.length === 2 && steps[1].sql === "SELECT 1", "the task keeps its other step and its version rises by one");
const after = run(steps[0].sql);
ok(after.length === 3 && after[0].i === "papers" && after[1].i === "q08-home", "among equally overdue products the busiest goes first: " + after.map((r) => r.i).join(","));
ok(/Usage signal: worker_requests_7d = 165043 over 7d \(Worker requests, cron and calls between workers included, not people\)\. Quality/.test(after[0].p), "the prompt names the number, its window and what it counts: " + after[0].p);
// a NULL usage product is described as unmeasured and is not starved by age
db.exec("UPDATE product_registry SET usage_value = NULL WHERE product IN ('papers', 'q08-home', 'research-gateway', 'tiny')");
db.exec("DELETE FROM cf_agent_requests"); db.exec(steps[0].sql.replace("LIMIT 3", "LIMIT 5"));
const unm = db.prepare("SELECT prompt p FROM cf_agent_requests").all();
ok(unm.length === 5 && unm.every((r) => /= unmeasured over /.test(r.p)), "with no number every product is listed and described as unmeasured");
// age still wins over usage: an overdue small product beats a busy one plussed recently
db.exec("DROP VIEW v_product_plus_due; CREATE VIEW v_product_plus_due AS SELECT product, CASE product WHEN 'tiny' THEN 146 ELSE 130 END AS hours_since_plus FROM product_registry; UPDATE product_registry SET usage_value = 165043 WHERE product = 'papers'; UPDATE product_registry SET usage_value = 900 WHERE product = 'tiny'");
db.exec("DELETE FROM cf_agent_requests"); db.exec(steps[0].sql);
ok(db.prepare("SELECT instance i FROM cf_agent_requests ORDER BY id LIMIT 1").get().i === "tiny", "an overdue product (146 h) still beats a busy one 16 hours younger (the bonus is 12 hours at most)");
// replays do nothing
const v1 = db.prepare("SELECT definition d FROM fleet_tasks WHERE id='management-personas-plus'").get().d;
db.exec(body);
ok(db.prepare("SELECT definition d FROM fleet_tasks WHERE id='management-personas-plus'").get().d === v1 && db.prepare("SELECT version v FROM fleet_tasks").get().v === 7, "a replay changes nothing");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");
// a definition that no longer has the old text is left alone
db.exec("UPDATE fleet_tasks SET definition = replace(definition, 'ORDER BY d.hours_since_plus + CASE', 'ORDER BY d.x + CASE')");
const v2 = db.prepare("SELECT definition d FROM fleet_tasks").get().d;
db.exec(body);
ok(db.prepare("SELECT definition d FROM fleet_tasks").get().d === v2, "a definition without the old ORDER BY is not touched");
console.log(pass + " passed, " + fail + " failed");
