// PERSONA-VIEWS-ROWS-READ-1 offline suite: applies 2026-11-04-persona-views-rows-read.sql to a minimal SQLite schema and proves
// the cohort view serves the snapshot while fresh, falls back to the live computation when stale, the heavy-tick trigger refreshes
// it, and the rewritten twin and candidate views return the old results. Run: node migrations/persona-views-rows-read.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-persona-views-rows-read.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
db.exec(`
CREATE TABLE output_quality_measures (metric TEXT PRIMARY KEY);
CREATE TABLE metric_history (metric TEXT, day TEXT, value REAL, PRIMARY KEY (metric, day));
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY, issue_id INTEGER, class TEXT, pass INTEGER, verified_at TEXT);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY, ts TEXT, to_status TEXT);
CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, priority TEXT, description TEXT, linked_session TEXT, created_at TEXT);
CREATE TABLE issue_project_map (issue_id INTEGER PRIMARY KEY, program_code TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE remediation_contracts (id INTEGER PRIMARY KEY, issue_id INTEGER, status TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY);
CREATE TABLE program_charters (program_code TEXT PRIMARY KEY, status TEXT, primary_metric TEXT, guard_metrics TEXT);
`);
const today = new Date().toISOString().slice(0, 10);
db.exec(`INSERT INTO metric_history VALUES ('remediation_latest_pass_pct_7d', '${today}', 80);
INSERT INTO remediation_verifications (issue_id, class, pass, verified_at) VALUES (1, NULL, 1, datetime('now', '-1 day')), (1, NULL, 0, datetime('now', '-10 days'));`);
db.exec(sql);
const one = (s) => db.prepare(s).get();
const q = (s) => db.prepare(s).all();
const live = one("SELECT * FROM v_output_quality_remediation_cohort_raw");
ok(live && live.subjects === 1 && live.now_value === 100 && live.prev_value === 0, "raw view keeps the old result", live);
ok(JSON.stringify(one("SELECT * FROM v_output_quality_remediation_cohort")) === JSON.stringify(live), "fresh snapshot equals live");
ok(one("SELECT COUNT(*) c FROM output_quality_cohort_snapshot").c === 1, "migration seeds the snapshot");
db.exec("UPDATE remediation_verifications SET pass = 1 WHERE pass = 0");
ok(one("SELECT prev_value FROM v_output_quality_remediation_cohort").prev_value === 0, "fresh snapshot is served (no recompute)");
db.exec("UPDATE output_quality_cohort_snapshot SET computed_at = '2000-01-01T00:00:00Z'");
ok(one("SELECT prev_value FROM v_output_quality_remediation_cohort").prev_value === 100, "stale snapshot falls back to live");
db.exec("INSERT INTO fleet_tick_heavy (ts, source) VALUES ('x', 'test')");
ok(one("SELECT computed_at FROM output_quality_cohort_snapshot").computed_at > "2001", "heavy tick refreshes the snapshot");
db.exec("DELETE FROM output_quality_cohort_snapshot; DELETE FROM metric_history");
ok(JSON.stringify(q("SELECT * FROM v_output_quality_remediation_cohort")) === JSON.stringify(q("SELECT * FROM v_output_quality_remediation_cohort_raw")), "no anchor behaves as the old view");
// twin supersede
db.exec(`INSERT INTO agent_issues (id, title, status, priority) VALUES (10, 'METRIC-TRIGGER-7-a', 'open', 'low'), (11, 'METRIC-TRIGGER-7-b', 'open', 'low'), (12, 'METRIC-TRIGGER-8-a', 'open', 'low');
INSERT INTO issue_project_map VALUES (10, 'QNFO.OPS');`);
const tw = q("SELECT issue_id, program_code, tid, successor FROM v_persona_twin_supersede");
ok(tw.length === 1 && tw[0].issue_id === 10 && tw[0].successor === 11 && tw[0].tid === 7 && tw[0].program_code === "QNFO.OPS", "twin supersede pairs the older trigger issue", tw);
db.exec("INSERT INTO ops_config VALUES ('persona_actions', 'off')");
ok(q("SELECT * FROM v_persona_twin_supersede").length === 0, "persona_actions=off still silences it");
// candidates
db.exec(`INSERT INTO metric_registry VALUES ('alpha_metric'), ('beta_metric');
INSERT INTO program_charters VALUES ('QNFO.OPS', 'active', 'primary_x', 'alpha_metric, beta_metric');
INSERT INTO agent_issues (id, title, status, priority) VALUES (20, 'x BETA-METRIC breach', 'open', 'low'), (21, 'plain', 'open', 'high');
INSERT INTO issue_project_map VALUES (20, 'QNFO.OPS'), (21, 'QNFO.OPS');`);
const c = q("SELECT id, tier, rn FROM v_program_focus_candidates ORDER BY id");
const t = Object.fromEntries(c.map((r) => [r.id, r.tier]));
ok(t[20] === 1 && t[21] === 3, "guard-metric tier is unchanged", c);
console.log(fail ? "FAILED " + fail : "ok " + pass);
process.exit(fail ? 1 : 0);
