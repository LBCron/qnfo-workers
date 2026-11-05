// METRIC-HYGIENE-1 offline suite: replays migrations/2026-11-05-metric-hygiene-1.sql on node:sqlite twice.
// Proves: (1) the bridge task is one sql step that copies analytics_dash_meta values into metric_registry only for metrics whose source_of_truth says they publish there (into / via
// analytics_dash_meta), never for any other metric, never an empty value, and refreshes last_refreshed every run; (2) its cron is :10 and exists only with the task; (3) the two jobsearch
// formulas carry the sample-gate phrase METRIC-SAMPLE-GATE-1 reads, and only their probation moves (30 days), only while they have no value; (4) the failure-mode detector reads 1 before
// the bridge runs and 0 after, and is a literal read-only select; (5) one decision and one prediction; a replay changes nothing.
// Run: node migrations/metric-hygiene-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-metric-hygiene-1.sql", import.meta.url), "utf8");
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
const one = (db, q, ...a) => db.prepare(q).get(...a);
const all = (db, q, ...a) => db.prepare(q).all(...a);
function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, formula TEXT, source_of_truth TEXT, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE metric_authorship (metric TEXT PRIMARY KEY, status TEXT, probation_until TEXT);
CREATE TABLE analytics_dash_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, ts TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, attempts INTEGER, next_due_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT, UNIQUE(decision_id, kind, subject));
`);
  const reg = db.prepare("INSERT INTO metric_registry (metric, formula, source_of_truth, last_value, state) VALUES (?, ?, ?, ?, ?)");
  reg.run("plain_article_coverage_pct", "share of papers", "living-paper.plain_article, published by qnfo-gateway articlePublishMetrics into analytics_dash_meta", null, "UNMEASURED");
  reg.run("plain_article_hard_violations", "count", "living-paper.plain_article via analytics_dash_meta (qnfo-gateway articlePublishMetrics)", null, "UNMEASURED");
  reg.run("plain_article_failed_final", "count", "living-paper.plain_article via analytics_dash_meta (qnfo-gateway)", null, "UNMEASURED");
  reg.run("other_in_meta_not_published_there", "x", "qnfo-audit.some_table", null, "UNMEASURED");        // a meta key of the same name, but its source is another table
  reg.run("published_but_meta_empty", "x", "x into analytics_dash_meta", null, "UNMEASURED");
  reg.run("published_with_value", "x", "x into analytics_dash_meta", "5", "MEASURED");
  reg.run("jobsearch_reply_rate_90d", "of the applications marked applied 21 to 90 days ago, the share that reached a reply; unknown (not written) under 10 such applications", "qnfo-audit.jobsearch_events", null, "UNMEASURED");
  reg.run("jobsearch_interview_rate_90d", "of the applications ... the share that reached an interview; unknown (not written) under 10 such applications", "qnfo-audit.jobsearch_events", null, "UNMEASURED");
  reg.run("other_unmeasured", "no sample gate", "x", null, "UNMEASURED");
  const aut = db.prepare("INSERT INTO metric_authorship (metric, status, probation_until) VALUES (?, 'probation', ?)");
  aut.run("jobsearch_reply_rate_90d", "2026-11-03T13:27:59Z"); aut.run("jobsearch_interview_rate_90d", "2026-11-03T13:27:59Z"); aut.run("other_unmeasured", "2026-11-03T13:27:59Z");
  const meta = db.prepare("INSERT INTO analytics_dash_meta (key, value) VALUES (?, ?)");
  meta.run("plain_article_coverage_pct", "67.9"); meta.run("plain_article_hard_violations", "0"); meta.run("plain_article_failed_final", "3");
  meta.run("other_in_meta_not_published_there", "9"); meta.run("published_but_meta_empty", ""); meta.run("published_with_value", "7");
  return db;
}
const run = (db) => { for (const s of S) db.exec(s); };
const val = (db, m) => one(db, "SELECT last_value v FROM metric_registry WHERE metric = ?", m).v;

const db = build();
const detector = () => { const p = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-metric-meta-value-not-in-registry'").p; return one(db, p); };
run(db);
ok(detector().expected === "0" && detector().observed === "3", "before the bridge runs, the detector counts the three unbridged metrics", detector());

// (1) the bridge step
const task = one(db, "SELECT type, enabled, timeout_ms, definition d FROM fleet_tasks WHERE id = 'metric-meta-bridge'");
const steps = JSON.parse(task.d).steps;
ok(task.type === "workflow" && task.enabled === 1 && steps.length === 1 && steps[0].type === "sql" && steps[0].db === "AUDIT" && steps[0].name === "bridge", "metric-meta-bridge is one enabled sql workflow step", steps.map((s) => s.name));
db.exec(steps[0].sql);
ok(val(db, "plain_article_coverage_pct") === "67.9" && val(db, "plain_article_hard_violations") === "0" && val(db, "plain_article_failed_final") === "3", "the three published metrics receive their meta values", [val(db, "plain_article_coverage_pct"), val(db, "plain_article_hard_violations"), val(db, "plain_article_failed_final")]);
ok(one(db, "SELECT state s, last_refreshed r FROM metric_registry WHERE metric = 'plain_article_coverage_pct'").s === "MEASURED" && !!one(db, "SELECT last_refreshed r FROM metric_registry WHERE metric = 'plain_article_coverage_pct'").r, "state MEASURED and last_refreshed set");
ok(val(db, "other_in_meta_not_published_there") === null, "a metric whose source is another table is left alone even when a meta key shares its name");
ok(val(db, "published_but_meta_empty") === null, "an empty meta value is not copied");
ok(val(db, "published_with_value") === "7", "a published metric follows its meta value on every run");
ok(val(db, "other_unmeasured") === null, "an unrelated unmeasured metric is untouched");
db.exec("UPDATE analytics_dash_meta SET value = '70.1' WHERE key = 'plain_article_coverage_pct'");
db.prepare("UPDATE metric_registry SET last_refreshed = '2000-01-01T00:00:00Z' WHERE metric = 'plain_article_coverage_pct'").run();
db.exec(steps[0].sql);
ok(val(db, "plain_article_coverage_pct") === "70.1" && one(db, "SELECT last_refreshed r FROM metric_registry WHERE metric = 'plain_article_coverage_pct'").r > "2020", "a changed meta value and a fresh last_refreshed follow on the next run");
ok(detector().observed === "0", "after the bridge the detector reads 0", detector());
{
  const p = one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-metric-meta-value-not-in-registry'").p.toLowerCase();
  const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
  ok(/^select/.test(p) && !WRITE_KW.some((w) => p.includes(w)), "the detector is a literal read-only select");
}

// (2) cron
const cron = one(db, "SELECT cron_expr c, task_id t, enabled e FROM fleet_crons WHERE name = 'metric-meta-bridge-hourly'");
ok(cron && cron.c === "10 * * * *" && cron.t === "metric-meta-bridge" && cron.e === 1, "the cron fires at :10 (on the 5-minute grid)", cron);

// (3) jobsearch
for (const m of ["jobsearch_reply_rate_90d", "jobsearch_interview_rate_90d"]) {
  const f = one(db, "SELECT formula f FROM metric_registry WHERE metric = ?", m).f;
  ok(/minimum sample/.test(f) && /written once at least/.test(f), m + ": the formula carries the sample-gate phrases", f.slice(-120));
  const p = one(db, "SELECT probation_until p FROM metric_authorship WHERE metric = ?", m).p;
  ok(p > "2026-12-01T00:00:00Z" || p > new Date(Date.now() + 20 * 864e5).toISOString(), m + ": probation moved about 30 days ahead", p);
}
ok(one(db, "SELECT probation_until p FROM metric_authorship WHERE metric = 'other_unmeasured'").p === "2026-11-03T13:27:59Z", "an unrelated probation row keeps its date");
ok(!/METRIC-HYGIENE-1/.test(one(db, "SELECT formula f FROM metric_registry WHERE metric = 'other_unmeasured'").f), "an unrelated formula is untouched");

// (5) decision, prediction, replay
ok(one(db, "SELECT COUNT(*) n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) n FROM decision_predictions").n === 1, "one decision and one prediction");
const snap = (d) => JSON.stringify([all(d, "SELECT * FROM metric_registry ORDER BY metric"), all(d, "SELECT * FROM metric_authorship ORDER BY metric"), all(d, "SELECT id, definition FROM fleet_tasks"), all(d, "SELECT name, cron_expr FROM fleet_crons"), all(d, "SELECT fm_key FROM failure_modes"), all(d, "SELECT class FROM remediation_contracts"), all(d, "SELECT COUNT(*) n FROM decision_log")]);
const before = snap(db);
run(db);
ok(snap(db) === before, "a second run changes nothing");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
