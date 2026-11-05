// DATA-SPINE-LAKE-1 (2026-11-05, pillars reliability and cost; roadmap row 3258): the cursor and drift tables, the flag, the view, two failure modes with their closing probes and the two next-slice issues.
// The copy itself is tested by qnfo-infra/lake-spine.test.mjs; the stream/sink/pipeline by `python scripts/lake_spine.py --check` against the account.
// Run: node --no-warnings migrations/data-spine-lake-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const mig = readFileSync(new URL("./2026-11-05-data-spine-lake-1.sql", import.meta.url), "utf8");
assert.match(mig, /^-- APPLY-BY: ci$/m);
assert.match(mig, /^-- DB: qnfo-audit$/m);
assert.match(mig, /^-- Rollback: /m);
assert.match(mig, /^-- CAUSE-MAPPED: /m);
const bare = mig.replace(/^--.*$/gm, "");
assert.ok(!/^\s*(DROP|DELETE\s+FROM)\b/mi.test(bare), "the migration destroys nothing");

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);" +
  "CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);" +
  "CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, expected_cadence_h INTEGER, status TEXT, precondition TEXT, action TEXT, escalate_to TEXT, module TEXT, next_due_at TEXT);" +
  "CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);" +
  "CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('hold', 'filter', 'pause', 'kill-switch', 'gate', 'cap', 'guard', 'lease')), guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL CHECK (disposition IN ('remove', 'demote', 'replace', 'keep')), disposition_state TEXT NOT NULL DEFAULT 'planned', alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT);" +
  "CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, window_note TEXT, enabled INTEGER DEFAULT 1, last_run_at TEXT);" +
  "CREATE TABLE spof_registry (component TEXT PRIMARY KEY, critical_path TEXT NOT NULL, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT);" +
  "CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER);");
db.exec(mig);
db.exec(mig);   // idempotent: a second run adds nothing
const n = (sql) => db.prepare(sql).get().n;
assert.equal(db.prepare("SELECT value FROM ops_config WHERE key = 'lake_spine'").get().value, "shadow");
assert.equal(n("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'DATA-SPINE-LAKE-1:%'"), 1);
assert.equal(n("SELECT COUNT(*) n FROM failure_modes WHERE fm_key IN ('lake-spine-stalled', 'lake-spine-drift')"), 2);
assert.equal(n("SELECT COUNT(*) n FROM remediation_contracts WHERE class IN ('fm-lake-spine-stalled', 'fm-lake-spine-drift')"), 2);
assert.equal(n("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA LAKE-SPINE-2.%'"), 2);
assert.equal(n("SELECT COUNT(*) n FROM control_registry WHERE control = 'ops_config.lake_spine' AND kind = 'kill-switch' AND critical_path = 0 AND disposition = 'keep' AND alternate_path IS NOT NULL"), 1, "the kill switch is registered with its alternate path");
assert.equal(n("SELECT COUNT(*) n FROM spof_registry WHERE component LIKE 'pipelines-ingest-and-basin-sql%' AND alternate_path IS NOT NULL"), 1, "the new dependency names its second path");
assert.equal(n("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA INFRA-AUTH-AWAIT-1:%'"), 1);
const dl = db.prepare("SELECT predicted_outcome, rollback_path FROM decision_log").get();
assert.ok(dl.predicted_outcome.length > 100 && dl.rollback_path.includes("lake_spine = off"), "the decision carries a prediction and a revert path");

// the state and drift tables have the columns the worker reads and writes
const cols = (t) => db.prepare("PRAGMA table_info(" + t + ")").all().map((x) => x.name);
for (const c of ["tbl", "cursor_id", "start_id", "start_day", "rows_sent", "batches", "last_run_at", "last_error", "updated_at"]) assert.ok(cols("lake_spine_state").includes(c), c);
for (const c of ["tbl", "day", "d1_rows", "lake_rows", "lake_distinct", "missing", "duplicates", "drift_pct", "verdict", "first_checked_at", "checked_at", "note"]) assert.ok(cols("lake_spine_drift").includes(c), c);

// the closing probes: both read 0 when healthy and 1 when not
const probe = (cls) => ({ ...db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p).get() });
const z = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d+Z$/, "Z");
const H = 3600 * 1000;
db.prepare("UPDATE ops_config SET updated_at = ? WHERE key = 'lake_spine'").run(z(1 * H));
assert.deepEqual(probe("fm-lake-spine-stalled"), { expected: "0", observed: "0" }, "a flag turned on an hour ago has a grace period");
db.prepare("UPDATE ops_config SET updated_at = ? WHERE key = 'lake_spine'").run(z(5 * H));
assert.deepEqual(probe("fm-lake-spine-stalled"), { expected: "0", observed: "1" }, "on for 5 hours with no cursor row is stalled");
db.prepare("INSERT INTO lake_spine_state (tbl, cursor_id, start_id, start_day, last_run_at) VALUES ('fleet_probe_log', 10, 11, '2026-11-04', ?)").run(z(1 * H));
assert.deepEqual(probe("fm-lake-spine-stalled"), { expected: "0", observed: "0" }, "a run an hour ago is healthy");
db.prepare("UPDATE lake_spine_state SET last_run_at = ?").run(z(4 * H));
assert.deepEqual(probe("fm-lake-spine-stalled"), { expected: "0", observed: "1" }, "no run for 4 hours is stalled");
db.prepare("UPDATE ops_config SET value = 'paused' WHERE key = 'lake_spine'").run();
assert.deepEqual(probe("fm-lake-spine-stalled"), { expected: "0", observed: "0" }, "a paused copy is not reported as stalled (the drift contract carries it)");

assert.deepEqual(probe("fm-lake-spine-drift"), { expected: "0", observed: "0" });
db.prepare("INSERT INTO lake_spine_drift (tbl, day, verdict, checked_at) VALUES ('fleet_probe_log', '2026-11-04', 'ok', ?)").run(z(1 * H));
assert.deepEqual(probe("fm-lake-spine-drift"), { expected: "0", observed: "0" }, "an ok day is healthy");
db.prepare("UPDATE lake_spine_drift SET verdict = 'breach'").run();
assert.deepEqual(probe("fm-lake-spine-drift"), { expected: "0", observed: "1" }, "a breach inside 3 days is reported");
db.prepare("UPDATE lake_spine_drift SET checked_at = ?").run(z(80 * H));
assert.deepEqual(probe("fm-lake-spine-drift"), { expected: "0", observed: "0" }, "a breach older than 3 days is not (a later ok row replaces it)");

// the alternate-path probe of the kill switch reads ok in a sane state and names the problem otherwise
const alt = () => db.prepare(db.prepare("SELECT probe_sql p FROM control_alternate_probes WHERE control = 'ops_config.lake_spine'").get().p).get();
db.prepare("UPDATE ops_config SET value = 'shadow' WHERE key = 'lake_spine'").run();
assert.deepEqual({ ...alt() }, { expected: "ok", observed: "ok" });
db.prepare("UPDATE ops_config SET value = 'dual' WHERE key = 'lake_spine'").run();
assert.match(alt().observed, /other than off, shadow or paused/);
db.prepare("UPDATE ops_config SET value = 'paused' WHERE key = 'lake_spine'").run();
db.prepare("UPDATE lake_spine_drift SET verdict = 'ok'").run();
assert.match(alt().observed, /no recorded reason/);
db.prepare("UPDATE lake_spine_drift SET verdict = 'breach'").run();
assert.deepEqual({ ...alt() }, { expected: "ok", observed: "ok" }, "a pause with a breach on record is explained");
db.prepare("DELETE FROM ops_config WHERE key = 'lake_spine'").run();
assert.match(alt().observed, /row lake_spine is missing/);
db.prepare("INSERT INTO ops_config (key, value) VALUES ('lake_spine', 'paused')").run();

const v = db.prepare("SELECT * FROM v_lake_spine_status").get();
assert.equal(v.tbl, "fleet_probe_log");
assert.equal(v.mode, "paused");
assert.match(v.latest_drift, /^2026-11-04 breach$/);
assert.ok(v.minutes_since_run >= 239 && v.minutes_since_run <= 241, "minutes_since_run is the age of last_run_at");

// the next-slice issues carry a code-task, a code-anchor that occurs once in its file, and a code-probe
const root = new URL("../", import.meta.url);
const issues = db.prepare("SELECT title, description FROM agent_issues ORDER BY id").all();
const want = {
  "LAKE-SPINE-2.1": ["qnfo-infra/worker.js", "async function lakeRoute(request, env, url, path, method, cors) {"],
  "LAKE-SPINE-2.2": ["qnfo-fleet-dashboard/worker.js", "async function healthProbes(env, liveNames) {"],
  "INFRA-AUTH-AWAIT-1": ["qnfo-infra/worker.js", "async function auth(token, env) {"]
};
assert.equal(issues.length, 3);
for (const iss of issues) {
  const key = Object.keys(want).find((k) => iss.title.includes(k));
  assert.ok(key, iss.title);
  const [path, anchor] = want[key];
  assert.ok(iss.description.includes("code-task: repo=qnfo-workers path=" + path), key + " names its file");
  assert.ok(iss.description.includes("code-anchor: " + anchor), key + " names its anchor");
  assert.ok(iss.description.includes('"contains":"' + (key.startsWith("LAKE") ? key.replace("LAKE-SPINE-", "LAKE-SPINE-") : key) + '"'), key + " has a code-probe on its own marker");
  const text = readFileSync(new URL(path, root), "utf8");
  assert.equal(text.split(anchor).length - 1, 1, key + ": the anchor occurs exactly once in " + path);
}
console.log("data-spine-lake-1: ok");
