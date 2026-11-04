// LEDGER-TRUTH-E-1 offline suite. Run: node migrations/e-ledger-truth.test.mjs
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, sha256 TEXT, commit_sha TEXT, db TEXT, status TEXT, statements INTEGER, error TEXT, applied_by TEXT, applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
INSERT INTO metric_registry VALUES ('breaches_unmapped', '9', NULL);
CREATE VIEW v_breach_by_cause AS SELECT 'unmapped' AS cause_key, 0 AS breaches;
INSERT INTO metric_breach_cause VALUES ('secrets_in_repo', 'measurement', 'earlier mapping');
CREATE TABLE product_plus_registry (key TEXT PRIMARY KEY, name TEXT);
INSERT INTO remediation_contracts VALUES ('issue-1000811', 1000811, 'OLD811', 'active', 110, 'fail', NULL, NULL), ('issue-1000793', 1000793, 'OLD793', 'active', 210, 'fail', NULL, NULL);
-- the live shape: three files, each with a CI error row newer than its ok or superseding row
INSERT INTO migration_runs (id, file, sha256, status, applied_by, applied_at) VALUES
 (1050, 'migrations/2026-11-02-management-personas-metric-intake.sql', '458757ac', 'ok', 'ci:apply-migrations', '2026-11-02T17:41:49Z'),
 (1121, 'migrations/2026-11-02-management-personas-metric-intake.sql', '880f5283', 'error', 'ci:apply-migrations', '2026-11-04T15:55:14Z'),
 (60, 'migrations/2026-10-13-fleet-journeys.sql', 'aaa', 'ok', 'ci:apply-migrations', '2026-10-14T03:53:00Z'),
 (61, 'migrations/2026-10-13-fleet-journeys.sql', 'bbb', 'error', 'ci:apply-migrations', '2026-10-14T03:54:20Z'),
 (296, 'migrations/2026-10-18-issue-sla-window-retry.sql', 'ccc', 'error', 'ci:apply-migrations', '2026-10-18T13:12:49Z'),
 (333, 'migrations/2026-10-18-issue-sla-window-retry.sql', 'superseded', 'superseded', 'RESOLVE-ALL-OPEN-1', '2026-10-19T05:34:44Z'),
 (900, 'migrations/2026-11-01-healthy.sql', 'ddd', 'ok', 'ci:apply-migrations', '2026-11-01T01:00:00Z');`);
const OLD_PROBE = "SELECT '0' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM (SELECT file, MAX(CASE WHEN status IN ('ok','superseded') THEN applied_at END) AS ok_at, MAX(CASE WHEN status = 'error' THEN applied_at END) AS err_at FROM migration_runs WHERE applied_by LIKE 'ci:%' GROUP BY file) WHERE err_at IS NOT NULL AND (ok_at IS NULL OR err_at > ok_at)";
let fail = 0;
function ok_(c, m) { if (!c) { fail++; console.log("FAIL " + m); } }
ok_(db.prepare(OLD_PROBE).get().observed === "3", "before the migration the old probe reads the three live files");
const sql = readFileSync(new URL("./2026-11-05-e-ledger-truth.sql", import.meta.url), "utf8");
db.exec(sql);
const probe = (cls) => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p).get();
ok_(probe("issue-1000811").observed === "0" && probe("issue-1000811").expected === "0", "after the migration the loop-breaker probe reads 0 files: " + JSON.stringify(probe("issue-1000811")));
ok_(db.prepare("SELECT COUNT(*) n FROM migration_runs WHERE status = 'error'").get().n === 3, "no error row is deleted (nothing is hidden)");
ok_(db.prepare("SELECT COUNT(*) n FROM migration_runs WHERE status = 'superseded' AND applied_by = 'ci:superseded-record'").get().n === 2, "two supersession records are written");
db.exec(sql);
ok_(db.prepare("SELECT COUNT(*) n FROM migration_runs WHERE status = 'superseded' AND applied_by = 'ci:superseded-record'").get().n === 2, "re-running writes no second record");
// a NEW error after the records is a breach again, and the probe sees it
db.exec("INSERT INTO migration_runs (file, sha256, status, applied_by, applied_at) VALUES ('migrations/2026-11-02-management-personas-metric-intake.sql', 'zzz', 'error', 'ci:apply-migrations', '2099-01-01T00:00:00Z')");
ok_(probe("issue-1000811").observed === "1", "a later CI error is counted again");
// the superseded record is written only while its ok row exists
const db2 = new DatabaseSync(":memory:");
db2.exec(`CREATE TABLE migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, sha256 TEXT, commit_sha TEXT, db TEXT, status TEXT, statements INTEGER, error TEXT, applied_by TEXT, applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT); CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT); CREATE VIEW v_breach_by_cause AS SELECT 'unmapped' AS cause_key, 0 AS breaches;
CREATE TABLE product_plus_registry (key TEXT PRIMARY KEY, name TEXT);`);
db2.exec(sql);
ok_(db2.prepare("SELECT COUNT(*) n FROM migration_runs").get().n === 0, "no supersession is recorded for a file without its ok row");
// 1000793: the probe reads the table the file creates
for (let i = 0; i < 5; i++) db.prepare("INSERT INTO product_plus_registry VALUES (?, 'x')").run("k" + i);
ok_(probe("issue-1000793").observed !== probe("issue-1000793").expected, "five registry rows are not enough: " + probe("issue-1000793").observed);
db.prepare("INSERT INTO product_plus_registry VALUES ('k5', 'x')").run();
ok_(probe("issue-1000793").observed === probe("issue-1000793").expected, "six registry rows pass");
// 1000706: nine metrics mapped with the fleet's causes, an earlier mapping kept
const causes = new Set(["spend","issue-backlog","code-loop","owner-routing","publishing","heartbeat","structure","measurement","breach-doctor"]);
const mapped = db.prepare("SELECT metric_key, cause_key FROM metric_breach_cause WHERE note = 'LEDGER-TRUTH-E-1'").all();
ok_(mapped.length === 8, "eight new mappings plus one earlier mapping kept: " + mapped.length);
ok_(mapped.every((r) => causes.has(r.cause_key)), "every cause_key is one of the fleet's nine causes");
ok_(db.prepare("SELECT cause_key FROM metric_breach_cause WHERE metric_key = 'secrets_in_repo'").get().cause_key === "measurement", "an earlier mapping is not overwritten");
ok_(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
