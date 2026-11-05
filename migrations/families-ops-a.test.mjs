// CRON-FAULT-FAMILY-1 offline suite: replays migrations/2026-11-05-families-ops-a.sql on SQLite (node:sqlite) over stubs that hold the live schemas and the live step texts read from qnfo-audit
// on 2026-11-04 (plus_ledger DDL with the older CHECK, its index and two views, the five bulk-close steps, fleet_crons rows, the live trigger issue_close_evidence_required).
// Proves: (1) plus_ledger keeps its rows, ids, index, views and sequence and now accepts every status the plussing steps write, still refuses others and still enforces the products FK;
// (2) the old close step aborts a whole batch when one issue has a failing contract and the patched step closes the rest; (3) each patched step gains the guard once and the other steps are
// byte-identical; (4) the three crons sit on the 5-minute grid; (5) a second apply changes nothing; (6) every detector reads 0 after the file and non-zero on the broken fixture.
// Run: node migrations/families-ops-a.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-families-ops-a.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

const CLOSE_HEAD = "UPDATE agent_issues SET status = 'closed', close_channel = 'auto:management-personas', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id IN ";
const STEPS = {
  "rc-close": CLOSE_HEAD + "(SELECT issue_id FROM v_root_cause_quiet)",
  "rm-deployed-close": CLOSE_HEAD + "(SELECT issue_id FROM (SELECT p.id, p.issue_id, p.program_code, t.id AS task_id, t.pr_url FROM roadmap_proposals p JOIN code_tasks t ON t.id = p.task_id JOIN agent_issues a ON a.id = p.issue_id WHERE p.status = 'building' AND t.status = 'merged' AND t.merge_state = 'verified' AND a.status = 'open'))",
  "recovered-close": CLOSE_HEAD + "(SELECT issue_id FROM v_persona_recovered_close)",
  "twin-close": CLOSE_HEAD + "(SELECT issue_id FROM v_persona_twin_supersede)",
  "mi-unmeasured-close": "UPDATE agent_issues SET status = 'closed', close_channel = 'auto:management-personas', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id IN (SELECT a.id FROM agent_issues a WHERE a.status = 'open' AND a.title LIKE 'METRIC-UNMEASURED-1: % has metrics with no value' AND NOT EXISTS (SELECT 1 FROM metric_improvement_now m WHERE m.verdict = 'unmeasured' AND m.bp26 = 0 AND a.title = 'METRIC-UNMEASURED-1: ' || m.owner || ' has metrics with no value'))"
};
const TASK_OF = { "rc-close": "management-personas", "rm-deployed-close": "management-personas", "recovered-close": "management-personas-b", "twin-close": "management-personas-b", "mi-unmeasured-close": "management-personas-c" };
const OTHER = "SELECT 1";
const step = (name, s) => ({ type: "sql", name, db: "AUDIT", sql: s });

// the live trigger text (qnfo-audit sqlite_master, 2026-11-04)
const TRIGGER = `CREATE TRIGGER issue_close_evidence_required
BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT,'close-while-contract-fails')
    WHERE NEW.status IN ('closed','resolved')
      AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
                    AND c.status IN ('active','holding')
                    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'));
END;`;

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE products (slug TEXT PRIMARY KEY, name TEXT NOT NULL, surface TEXT NOT NULL, owner_worker TEXT, repo TEXT NOT NULL DEFAULT 'QNFO/qnfo-workers', path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE product_registry (product TEXT PRIMARY KEY, host TEXT, program_code TEXT, last_plus_at TEXT, plus_cadence_h INTEGER NOT NULL DEFAULT 168, misses_in_row INTEGER NOT NULL DEFAULT 0, pluses_since_simplify INTEGER NOT NULL DEFAULT 0, rest_until TEXT, state TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT NOT NULL REFERENCES products(slug), plus TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','shipped','kept','reverted')), metric TEXT, predicted TEXT, measured TEXT, shipped_at TEXT, decided_at TEXT NOT NULL DEFAULT (datetime('now')), product TEXT, kind TEXT, title TEXT, evidence TEXT, predicted_outcome TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT, created_at TEXT);
CREATE INDEX idx_plus_ledger_product ON plus_ledger(product_slug, status);
CREATE VIEW v_product_plus_debt AS SELECT p.slug, p.name, p.surface, p.owner_worker, MAX(COALESCE(l.shipped_at, p.created_at)) AS last_plus_at, CAST((julianday('now') - julianday(MAX(COALESCE(l.shipped_at, p.created_at)))) / 7 AS INTEGER) AS weeks_since_plus FROM products p LEFT JOIN plus_ledger l ON l.product_slug = p.slug AND l.status IN ('shipped','kept') GROUP BY p.slug;
CREATE VIEW v_product_plus_due AS SELECT p.product, p.host, p.program_code, p.last_plus_at, CAST((julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 AS INTEGER) AS hours_since_plus, p.plus_cadence_h, p.misses_in_row, p.pluses_since_simplify, CASE WHEN p.pluses_since_simplify >= 4 THEN 'simplify' ELSE 'plus' END AS next_kind, (SELECT COUNT(*) FROM plus_ledger l WHERE l.product = p.product AND l.status IN ('proposed','building','reverting')) AS in_flight FROM product_registry p WHERE p.state = 'active' AND (p.rest_until IS NULL OR p.rest_until <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) AND (julianday('now') - julianday(COALESCE(p.last_plus_at, p.created_at))) * 24 >= p.plus_cadence_h ORDER BY hours_since_plus DESC;
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
CREATE TABLE metric_improvement_now (owner TEXT, verdict TEXT, bp26 INTEGER);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, last_verdict TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`);
  db.exec(TRIGGER);
  db.exec(`INSERT INTO products (slug, name, surface) VALUES ('companion-today', 'Companion', 'me.q08.org'), ('jobs', 'Jobs', 'jobs.q08.org');
INSERT INTO product_registry (product, host, program_code, created_at) VALUES ('jobs', 'jobs.q08.org', 'QNFO.PERSONAL', '2026-01-01T00:00:00Z');
INSERT INTO plus_ledger (product_slug, plus, status, product, kind, title, evidence, issue_id, decided_at) VALUES ('companion-today', 'PLUS-1', 'proposed', 'companion-today', 'plus', 'PLUS-1', 'Migrated from the legacy product plus ledger', NULL, '2026-10-29 12:29:00');
INSERT INTO plus_ledger (product_slug, plus, status, product, kind, title, evidence, issue_id, decided_at) VALUES ('jobs', 'Group stretch matches', 'proposed', 'jobs', 'plus', 'Group stretch matches', 'proposal #2152 (roadmap-QNFO.PERSONAL-plus-jobs-20261104): qnfo-jobsearch/worker.js', 1001801, '2026-11-04 19:52:46');`);
  const mk = (id, steps) => db.prepare("INSERT INTO fleet_tasks (id, definition) VALUES (?, ?)").run(id, JSON.stringify({ steps }));
  mk("management-personas", [step("recur-clear", OTHER), step("rc-close", STEPS["rc-close"]), step("rm-deployed-close", STEPS["rm-deployed-close"]), step("promote", OTHER)]);
  mk("management-personas-b", [step("recovered-evidence", OTHER), step("recovered-close", STEPS["recovered-close"]), step("twin-close", STEPS["twin-close"])]);
  mk("management-personas-c", [step("lever-request", OTHER), step("mi-unmeasured-close", STEPS["mi-unmeasured-close"]), step("lever-report", OTHER)]);
  const cron = db.prepare("INSERT INTO fleet_crons (name, cron_expr, task_id, next_fire) VALUES (?, ?, ?, ?)");
  cron.run("management-personas-b-hourly", "42 * * * *", "management-personas-b", "2026-11-04T23:42:00.000Z");
  cron.run("management-personas-c-hourly", "49 * * * *", "management-personas-c", "2026-11-04T23:49:00.000Z");
  cron.run("staff-roster-hourly", "52 * * * *", "staff-roster", "2026-11-04T23:52:00.000Z");
  cron.run("metric-refresh-hourly", "0 * * * *", "metric-refresh", "2026-11-05T00:00:00.000Z");
  cron.run("never-stall-hourly", "5 * * * *", "never-stall", "2026-11-05T00:05:00.000Z");
  return db;
}
const stepSql = (db, task, name) => JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = ?").get(task).definition).steps.find((s) => s.name === name)?.sql;
const GUARD = " AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = agent_issues.id AND c.status IN ('active', 'holding') AND COALESCE(c.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'))";
const detector = (db, cls) => { const r = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get(cls); const row = db.prepare(r.verify_probe).get(); return [row.expected, row.observed]; };

// 0. the fixture is the live shape: the old CHECK refuses the status pl-sync writes
let db = build();
let threw = null;
try { db.exec("UPDATE plus_ledger SET status = 'building' WHERE id = 2"); } catch (e) { threw = String(e.message); }
ok(/CHECK constraint failed/.test(threw || ""), "fixture: the older CHECK refuses building, the failure of management-personas-plus", threw);

// 1. plus_ledger
db.exec(sql);
const rows = db.prepare("SELECT id, product_slug, status, issue_id, decided_at, evidence FROM plus_ledger ORDER BY id").all();
ok(rows.length === 2 && rows[0].id === 1 && rows[1].id === 2 && rows[1].issue_id === 1001801 && rows[0].decided_at === "2026-10-29 12:29:00", "plus_ledger keeps both rows with ids, issue_id and decided_at", rows);
ok(db.prepare("SELECT COUNT(*) c FROM bak_20261105_plus_ledger").get().c === 2, "the backup holds both rows");
for (const st of ["proposed", "building", "deployed", "shipped", "kept", "reverting", "reverted", "rejected"]) {
  db.exec("UPDATE plus_ledger SET status = '" + st + "' WHERE id = 2");
  ok(db.prepare("SELECT status FROM plus_ledger WHERE id = 2").get().status === st, "plus_ledger accepts " + st);
}
threw = null; try { db.exec("UPDATE plus_ledger SET status = 'bogus' WHERE id = 2"); } catch (e) { threw = String(e.message); }
ok(/CHECK constraint failed/.test(threw || ""), "plus_ledger still refuses an unknown status", threw);
threw = null; try { db.exec("INSERT INTO plus_ledger (product_slug, plus) VALUES ('no-such-product', 'x')"); } catch (e) { threw = String(e.message); }
ok(/FOREIGN KEY/.test(threw || ""), "the products foreign key is still enforced", threw);
db.exec("INSERT INTO plus_ledger (product_slug, plus, status, product) VALUES ('jobs', 'third', 'building', 'jobs')");
ok(db.prepare("SELECT MAX(id) m FROM plus_ledger").get().m === 3, "the sequence continues at 3");
ok(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'index' AND name = 'idx_plus_ledger_product' AND tbl_name = 'plus_ledger'").get().c === 1, "the index is back on the new table");
ok(db.prepare("SELECT COUNT(*) c FROM v_product_plus_debt").get().c === 2, "v_product_plus_debt reads");
db.exec("UPDATE plus_ledger SET status = 'building' WHERE id = 2");
ok(db.prepare("SELECT in_flight f FROM v_product_plus_due WHERE product = 'jobs'").get()?.f === 2, "v_product_plus_due counts building rows (in_flight)", db.prepare("SELECT * FROM v_product_plus_due").all());
// the step that failed in production, against the stub: pl-sync's CASE writes building/deployed/rejected
db.exec("UPDATE plus_ledger SET status = CASE 'deployed' WHEN 'building' THEN 'building' WHEN 'deployed' THEN 'deployed' WHEN 'rejected' THEN 'rejected' ELSE status END WHERE id = 1");
ok(db.prepare("SELECT status FROM plus_ledger WHERE id = 1").get().status === "deployed", "the pl-sync assignment now lands");

// 2. the bulk close: old step aborts the batch, patched step closes the rest
function closeFixture(patched) {
  const d = build();
  if (patched) d.exec(sql);
  d.exec(`INSERT INTO agent_issues (id, title, status) VALUES (1, 'METRIC-UNMEASURED-1: qnfo-a has metrics with no value', 'open'), (2, 'METRIC-UNMEASURED-1: qnfo-b has metrics with no value', 'open');
INSERT INTO issue_triage (issue_id, close_evidence) VALUES (1, 'every metric of this owner holds a value'), (2, 'every metric of this owner holds a value');
INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, status, last_verdict) VALUES ('issue-1', 1, 'p', 'a', 'SELECT 1', 'd1-query', 3, 'x', 'active', 'pass'), ('issue-2', 2, 'p', 'a', 'SELECT 1', 'd1-query', 3, 'x', 'active', 'fail');`);
  return d;
}
{
  const old = closeFixture(false);
  let err = null; try { old.exec(stepSql(old, "management-personas-c", "mi-unmeasured-close")); } catch (e) { err = String(e.message); }
  ok(/close-while-contract-fails/.test(err || ""), "the old step aborts with close-while-contract-fails (the live failure)", err);
  ok(old.prepare("SELECT COUNT(*) c FROM agent_issues WHERE status = 'closed'").get().c === 0, "the old step closed nothing: one failing contract held the whole batch");
  const fixed = closeFixture(true);
  fixed.exec(stepSql(fixed, "management-personas-c", "mi-unmeasured-close"));
  const st = Object.fromEntries(fixed.prepare("SELECT id, status FROM agent_issues").all().map((r) => [r.id, r.status]));
  ok(st[1] === "closed" && st[2] === "open", "the patched step closes the issue whose contract passes and leaves the failing one open", st);
}

// 3. every patched step gains the guard once, the other steps are untouched, versions bump once
db = build();
const before = {}; for (const n of Object.keys(STEPS)) before[n] = stepSql(db, TASK_OF[n], n);
const otherBefore = [stepSql(db, "management-personas", "recur-clear"), stepSql(db, "management-personas", "promote"), stepSql(db, "management-personas-b", "recovered-evidence"), stepSql(db, "management-personas-c", "lever-request"), stepSql(db, "management-personas-c", "lever-report")];
db.exec(sql);
for (const n of Object.keys(STEPS)) {
  const s = stepSql(db, TASK_OF[n], n);
  ok(s === before[n] + GUARD, n + " gains the guard at its end, byte-exact");
  ok((s.match(/FROM remediation_contracts c WHERE c\.issue_id = agent_issues\.id/g) || []).length === 1, n + " has the guard once");
}
ok(JSON.stringify(otherBefore) === JSON.stringify([stepSql(db, "management-personas", "recur-clear"), stepSql(db, "management-personas", "promote"), stepSql(db, "management-personas-b", "recovered-evidence"), stepSql(db, "management-personas-c", "lever-request"), stepSql(db, "management-personas-c", "lever-report")]), "the other steps are byte-identical");
const ver = (id) => db.prepare("SELECT version v FROM fleet_tasks WHERE id = ?").get(id).v;
ok(ver("management-personas") === 3 && ver("management-personas-b") === 3 && ver("management-personas-c") === 2, "versions bump once per patched step", [ver("management-personas"), ver("management-personas-b"), ver("management-personas-c")]);
ok(JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'management-personas'").get().definition).steps.map((s) => s.name).join() === "recur-clear,rc-close,rm-deployed-close,promote", "step order is unchanged");
ok(db.prepare("SELECT COUNT(*) c FROM bak_20261105_personas_close_steps").get().c === 3, "the definitions are backed up first");

// 4. the crons
const cr = Object.fromEntries(db.prepare("SELECT name, cron_expr FROM fleet_crons").all().map((r) => [r.name, r.cron_expr]));
ok(cr["management-personas-b-hourly"] === "45 * * * *" && cr["management-personas-c-hourly"] === "50 * * * *" && cr["staff-roster-hourly"] === "55 * * * *", "the three crons sit on the 5-minute grid", cr);
ok(cr["metric-refresh-hourly"] === "0 * * * *" && cr["never-stall-hourly"] === "5 * * * *", "other crons are untouched");

// 5. a second apply changes nothing that matters (rows, steps, versions, crons, counts)
const snap = () => JSON.stringify([db.prepare("SELECT * FROM plus_ledger ORDER BY id").all(), db.prepare("SELECT id, definition, version FROM fleet_tasks ORDER BY id").all(), db.prepare("SELECT name, cron_expr FROM fleet_crons ORDER BY name").all(), db.prepare("SELECT COUNT(*) c FROM failure_modes").get().c, db.prepare("SELECT COUNT(*) c FROM remediation_contracts").get().c, db.prepare("SELECT COUNT(*) c FROM decision_log").get().c]);
const s1 = snap();
db.exec(sql);
ok(s1 === snap(), "a second apply changes nothing");

// 6. detectors
ok(db.prepare("SELECT COUNT(*) c FROM failure_modes WHERE fm_key IN ('plus-ledger-check-rejects-steps', 'personas-bulk-close-aborted-by-failing-contract', 'fleet-cron-off-grid')").get().c === 3, "three failure modes are written");
for (const cls of ["fm-plus-ledger-check-rejects-steps", "fm-personas-bulk-close-aborted-by-failing-contract", "fm-fleet-cron-off-grid"]) {
  const [e, o] = detector(db, cls);
  ok(e === "0" && o === "0", cls + " reads 0 after the file", [e, o]);
}
const broken = build();
broken.exec(sql);
broken.exec("UPDATE fleet_crons SET cron_expr = '37 * * * *' WHERE name = 'staff-roster-hourly'");
ok(detector(broken, "fm-fleet-cron-off-grid")[1] === "1", "fm-fleet-cron-off-grid reads 1 for a :37 cron");
broken.exec("UPDATE fleet_crons SET cron_expr = '*/5 * * * *' WHERE name = 'staff-roster-hourly'");
ok(detector(broken, "fm-fleet-cron-off-grid")[1] === "0", "a */5 cron is on the grid");
const unguarded = build();
unguarded.exec(sql);
unguarded.exec("UPDATE fleet_tasks SET definition = replace(definition, 'FROM remediation_contracts c WHERE c.issue_id = agent_issues.id', 'FROM remediation_contracts c WHERE c.issue_id = 0') WHERE id = 'management-personas-c'");
ok(detector(unguarded, "fm-personas-bulk-close-aborted-by-failing-contract")[1] === "1", "the bulk-close detector reads 1 when a step loses the exclusion");
const narrow = build();
narrow.exec(sql);
narrow.exec("DROP VIEW v_product_plus_due; DROP VIEW v_product_plus_debt; ALTER TABLE plus_ledger RENAME TO plus_ledger_x; CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY, status TEXT CHECK (status IN ('proposed','shipped','kept','reverted')));");
ok(detector(narrow, "fm-plus-ledger-check-rejects-steps")[1] === "1", "the plus_ledger detector reads 1 when the table has the older CHECK");
ok(db.prepare("SELECT COUNT(*) c FROM decision_log WHERE action LIKE 'CRON-FAULT-FAMILY-1:%'").get().c === 1, "one decision_log row");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
