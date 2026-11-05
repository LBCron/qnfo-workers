// PLUS-QUALITY-MEASURE-1 offline suite: replays migrations/2026-11-05-plus-quality-measures.sql on node:sqlite and runs the PLUS-4 baseline join the way the step does,
// to show a papers plus now gets a pending outcome check where it used to be unmeasured. No live state is read.
// Output MUST contain "0 failed" on success.   node migrations/plus-quality-measures.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../migrations/2026-11-05-plus-quality-measures.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "header opts in");
ok(/^-- CAUSE-MAPPED: /m.test(sql) && !/INTO metric_registry/i.test(sql), "registers no metric, says so");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE product_registry(product TEXT PRIMARY KEY, quality_measure TEXT, state TEXT DEFAULT 'active');
CREATE TABLE output_quality_measures(metric TEXT, surface TEXT, role TEXT, polarity INT, tol_rel REAL, tol_abs REAL, judged_by TEXT, caveat TEXT);
CREATE TABLE metric_registry(metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
CREATE TABLE plus_ledger(id INTEGER PRIMARY KEY, product TEXT, status TEXT, outcome TEXT, decided_at TEXT);
CREATE TABLE plus_outcome_checks(plus_id INTEGER PRIMARY KEY, product TEXT, metric TEXT, baseline REAL, baseline_at TEXT, guard_baseline REAL, outcome TEXT, evidence TEXT);
CREATE TABLE decision_log(id INTEGER PRIMARY KEY, actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
`);
db.exec("INSERT INTO product_registry(product, quality_measure) VALUES ('papers',NULL),('jobs',NULL),('shorts-channel',NULL),('q08-home','engaged_human_sessions_28d'),('travel',NULL)");
db.exec("INSERT INTO output_quality_measures VALUES ('engaged_reader_sessions_7d','papers','outcome',1,0.2,10,'people','c'),('jobsearch_reply_rate_90d','job applications','outcome',1,0.3,0.03,'recruiters','c'),('engaged_human_sessions_28d','site','outcome',1,0.1,200,'cf','c')");
db.exec("INSERT INTO metric_registry VALUES ('engaged_reader_sessions_7d','44','2026-11-05T01:00:00Z'),('jobsearch_reply_rate_90d',NULL,NULL),('output_quality_outcomes_worse','0','2026-11-05T01:00:00Z'),('youtube_avg_view_duration_s',NULL,NULL)");
db.exec("INSERT INTO plus_ledger VALUES (1,'papers','deployed','deployed ok','2026-11-05 01:00:00'),(2,'jobs','deployed','deployed ok','2026-11-05 01:00:00'),(3,'travel','deployed','deployed ok','2026-11-05 01:00:00')");
// the PLUS-4 baseline step, as it is in fleet_tasks management-personas-plus (pl-outcome-baseline)
const BASE = "INSERT OR IGNORE INTO plus_outcome_checks (plus_id, product, metric, baseline, baseline_at, guard_baseline, outcome, evidence) SELECT l.id, l.product, r.quality_measure, CASE WHEN q.role = 'outcome' THEN CAST(m.last_value AS REAL) END, COALESCE(m.last_refreshed, l.decided_at), CAST(g.last_value AS REAL), CASE WHEN q.role = 'outcome' AND m.last_value IS NOT NULL AND g.last_value IS NOT NULL THEN 'pending' ELSE 'unmeasured' END, 'x' FROM plus_ledger l JOIN product_registry r ON r.product = l.product LEFT JOIN output_quality_measures q ON q.metric = r.quality_measure AND q.role = 'outcome' LEFT JOIN metric_registry m ON m.metric = r.quality_measure LEFT JOIN metric_registry g ON g.metric = 'output_quality_outcomes_worse' WHERE l.status = 'deployed' AND l.outcome LIKE 'deployed%' AND NOT EXISTS (SELECT 1 FROM plus_outcome_checks c WHERE c.plus_id = l.id)";
db.exec(BASE);
const O = (p) => db.prepare("SELECT outcome o FROM plus_outcome_checks WHERE product=?").get(p).o;
ok(O("papers") === "unmeasured" && O("jobs") === "unmeasured" && O("travel") === "unmeasured", "before: every plus on these products is unmeasured");
db.exec("DELETE FROM plus_outcome_checks");
db.exec(body);
const Q = (p) => db.prepare("SELECT quality_measure q FROM product_registry WHERE product=?").get(p).q;
ok(Q("papers") === "engaged_reader_sessions_7d" && Q("jobs") === "jobsearch_reply_rate_90d" && Q("shorts-channel") === "youtube_avg_view_duration_s", "three products take their existing outcome measure");
ok(Q("q08-home") === "engaged_human_sessions_28d" && Q("travel") === null, "a product that has one keeps it, one with no outcome measure stays NULL");
db.exec(BASE);
ok(O("papers") === "pending", "after: a papers plus gets a pending outcome check");
ok(O("jobs") === "unmeasured", "a jobs plus stays unmeasured while the reply rate is unmeasured (never a pass)");
ok(O("travel") === "unmeasured", "a product with no outcome measure stays unmeasured");
const m = db.prepare("SELECT * FROM output_quality_measures WHERE metric='youtube_avg_view_duration_s'").all();
ok(m.length === 1 && m[0].role === "outcome" && m[0].polarity === 1 && m[0].surface === "shorts" && /unmeasured is not a pass/.test(m[0].caveat), "the Shorts outcome measure is registered once, with its caveat");
db.exec("UPDATE product_registry SET quality_measure = 'custom' WHERE product = 'papers'");
db.exec(body);
ok(Q("papers") === "custom" && db.prepare("SELECT COUNT(*) n FROM output_quality_measures WHERE metric='youtube_avg_view_duration_s'").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "a replay never overwrites a set measure, adds no second row");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_plus_qm").get().n === 5, "backup holds every product");
console.log(pass + " passed, " + fail + " failed");
