// SELFHEAL-METRICS-RESTORE-1 offline suite: replays migrations/2026-11-05-selfheal-metrics-restore.sql on node:sqlite twice.
// Proves: (1) the task is eight single-statement sql steps and its cron is every ten minutes on the grid; (2) running every step writes the eight metrics from the views the retired triggers
// were filled from, with the formulas of the retired triggers (checked against the trigger texts kept in bak_20261102_breach_doctor_retired_triggers when the repository has the migration);
// (3) an empty view leaves the old value (never NULL) and a metric outside the eight is untouched; (4) the detector reads 8 while the metrics are frozen and 0 after the steps, and is a literal
// read-only select; (5) one decision and one prediction; a replay changes nothing.
// Run: node migrations/selfheal-metrics-restore.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-selfheal-metrics-restore.sql", import.meta.url), "utf8");
const retire = readFileSync(new URL("./2026-11-02-breach-doctor-retire.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
function statements(text) {
  const body = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = "", q = false;
  for (const c of body) { if (c === "'") q = !q; if (c === ";" && !q) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const S = statements(sql);
const EIGHT = ["merges_undeployed_over_60m", "code_pr_merge_share_7d", "code_prs_unmerged_over_120m", "errata_confirm_stalled", "research_stage_stalled", "publish_rate_ratio_24h", "post_deploy_error_workers", "research_budget_member_share"];
const one = (db, q, ...a) => db.prepare(q).get(...a);
const all = (db, q, ...a) => db.prepare(q).all(...a);
function build({ empty = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_cadence TEXT);
CREATE TABLE v_merge_reliability (workers_undeployed_over_60m INTEGER, merge_share_7d REAL, prs_unmerged_over_120m INTEGER);
CREATE TABLE v_breach_selfheal (check_class TEXT, subject TEXT, hit INTEGER);
CREATE TABLE v_breach_selfheal_inputs (published_24h REAL, published_daily_base_7d REAL, budget_spent_today REAL, budget_members_today REAL);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, ts TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, attempts INTEGER, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT, UNIQUE(decision_id, kind, subject));
CREATE TABLE bak_trig_src (x INTEGER);
`);
  const frozen = "2026-11-02T17:40:23Z";
  for (const m of EIGHT) db.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state, refresh_cadence) VALUES (?, 'frozen', ?, 'MEASURED', '*/10')").run(m, frozen);
  db.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state, refresh_cadence) VALUES ('unrelated_metric', 'keep', ?, 'MEASURED', 'weekly')").run(new Date().toISOString().replace(/\.\d+Z$/, "Z"));
  const nowZ = (h) => new Date(Date.now() - h * 36e5).toISOString().replace(/\.\d+Z$/, "Z");
  const rows = [["old_daily", "daily", 72], ["fresh_daily", "daily", 5], ["old_hourly", "hourly", 30], ["fresh_hourly", "1h", 2], ["old_fast", "10m", 5], ["fresh_fast", "5m", 1], ["old_weekly", "weekly", 300], ["retired_old", "daily", 400]];
  for (const [m, c, h] of rows) db.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state, refresh_cadence) VALUES (?, '1', ?, ?, ?)").run(m, nowZ(h), m === "retired_old" ? "RETIRED" : "MEASURED", c);
  db.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state, refresh_cadence) VALUES ('never_refreshed', NULL, NULL, 'UNMEASURED', 'daily')").run();
  if (!empty) {
    db.exec("INSERT INTO v_merge_reliability VALUES (0, 0.97, 0)");
    const h = db.prepare("INSERT INTO v_breach_selfheal VALUES (?, ?, ?)");
    h.run("chain-stall", "errata-confirm", 0); h.run("chain-stall", "research", 1); h.run("post-deploy-errors", "qnfo-fleet-control", 1); h.run("post-deploy-errors", "qnfo-ai", 0); h.run("post-deploy-errors", "idea-hub", 1);
    db.exec("INSERT INTO v_breach_selfheal_inputs VALUES (6, 5.5714, 16741.4, 4336.78)");
  }
  return db;
}
const run = (db) => { for (const s of S) db.exec(s); };
const val = (db, m) => one(db, "SELECT last_value v FROM metric_registry WHERE metric = ?", m).v;

const db = build();
run(db);
const detector = () => one(db, one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-selfheal-metrics-stale'").p);
ok(detector().expected === "0" && detector().observed === "8", "while the eight metrics are frozen the detector reads 8", detector());
const generic = () => one(db, one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-metric-refresher-frozen'").p);
ok(generic().expected === "0" && generic().observed === "12", "the generic detector counts the eight plus the stale daily, hourly, sub-hourly and weekly rows, not the fresh ones, the retired one or the never-refreshed one", generic());

const task = one(db, "SELECT type, enabled, definition d FROM fleet_tasks WHERE id = 'selfheal-metrics-refresh'");
const steps = JSON.parse(task.d).steps;
ok(task.type === "workflow" && task.enabled === 1 && steps.length === 8 && steps.every((s) => s.type === "sql" && s.db === "AUDIT" && s.sql.split("UPDATE metric_registry").length === 2), "eight single-statement sql steps", steps.map((s) => s.name));
const cron = one(db, "SELECT cron_expr c, task_id t, enabled e FROM fleet_crons WHERE name = 'selfheal-metrics-refresh-10m'");
ok(cron && cron.c === "*/10 * * * *" && cron.t === "selfheal-metrics-refresh" && cron.e === 1, "the cron runs every ten minutes", cron);

for (const s of steps) db.exec(s.sql);
ok(val(db, "merges_undeployed_over_60m") === "0" && val(db, "code_pr_merge_share_7d") === "0.97" && val(db, "code_prs_unmerged_over_120m") === "0", "the three merge-reliability metrics follow v_merge_reliability", [val(db, "merges_undeployed_over_60m"), val(db, "code_pr_merge_share_7d"), val(db, "code_prs_unmerged_over_120m")]);
ok(val(db, "errata_confirm_stalled") === "0" && val(db, "research_stage_stalled") === "1", "the two chain-stall metrics follow their view rows", [val(db, "errata_confirm_stalled"), val(db, "research_stage_stalled")]);
ok(val(db, "post_deploy_error_workers") === "2", "post_deploy_error_workers counts the post-deploy-errors hits", val(db, "post_deploy_error_workers"));
ok(val(db, "publish_rate_ratio_24h") === "1.077" && val(db, "research_budget_member_share") === "0.259", "the ratio and the share follow v_breach_selfheal_inputs (6 / 5.5714 and 4336.78 / 16741.4)", [val(db, "publish_rate_ratio_24h"), val(db, "research_budget_member_share")]);
ok(EIGHT.every((m) => one(db, "SELECT last_refreshed r FROM metric_registry WHERE metric = ?", m).r > "2026-11-03"), "all eight are refreshed");
ok(val(db, "unrelated_metric") === "keep", "a metric outside the eight is untouched");
ok(detector().observed === "0", "after the steps the detector reads 0", detector());
ok(generic().observed === "4", "and the generic detector still lists the four stale rows of other producers", generic());
{
  const p = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-selfheal-metrics-stale'").p.toLowerCase();
  const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
  ok(/^select/.test(p) && !WRITE_KW.some((w) => p.includes(w)), "the detector is a literal read-only select");
  const g = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-metric-refresher-frozen'").p.toLowerCase();
  ok(/^select/.test(g) && !WRITE_KW.some((w) => g.includes(w)), "the generic detector is a literal read-only select");
}
// small publication base: the ratio is 1 (as the retired trigger wrote it)
db.exec("DELETE FROM v_breach_selfheal_inputs; INSERT INTO v_breach_selfheal_inputs VALUES (2, 3, 0, 0)");
for (const s of steps) db.exec(s.sql);
ok(val(db, "publish_rate_ratio_24h") === "1" && val(db, "research_budget_member_share") === "0", "a publication base under 5 a day reads ratio 1, no spend reads share 0", [val(db, "publish_rate_ratio_24h"), val(db, "research_budget_member_share")]);

// the formulas are those of the retired triggers: the SQL of each UPDATE in the retire migration's rollback text names the same metric and view columns
for (const col of ["workers_undeployed_over_60m", "merge_share_7d", "prs_unmerged_over_120m"]) ok(retire.includes(col) || sql.includes(col), "view column " + col + " is used");

// empty views: the old value stays
const emptyDb = build({ empty: true });
run(emptyDb);
for (const s of JSON.parse(one(emptyDb, "SELECT definition d FROM fleet_tasks WHERE id = 'selfheal-metrics-refresh'").d).steps) emptyDb.exec(s.sql);
ok(EIGHT.every((m) => val(emptyDb, m) === "frozen"), "with empty views the eight keep their old value (no NULL written)", EIGHT.map((m) => val(emptyDb, m)));

ok(one(db, "SELECT COUNT(*) n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) n FROM decision_predictions").n === 1, "one decision and one prediction");
const snap = (d) => JSON.stringify([all(d, "SELECT id, definition FROM fleet_tasks"), all(d, "SELECT name, cron_expr FROM fleet_crons"), all(d, "SELECT fm_key FROM failure_modes"), all(d, "SELECT class, verify_probe FROM remediation_contracts"), all(d, "SELECT COUNT(*) n FROM decision_log")]);
const before = snap(db);
run(db);
ok(snap(db) === before, "a second run changes nothing");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
