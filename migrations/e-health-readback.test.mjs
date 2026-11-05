// HEALTH-READBACK-1 offline suite. Run: node migrations/e-health-readback.test.mjs
// Every live deployed worker's version credential needs a fresh /health read-back stamped by scripts/fleet-autoaudit.py.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
INSERT INTO remediation_contracts VALUES ('issue-1000982', 1000982, 'OLD', 'active', 68, 'fail', NULL, NULL);
CREATE TABLE service_registry (service TEXT PRIMARY KEY, state TEXT, kind TEXT, version TEXT);
CREATE TABLE worker_live_audit (worker TEXT PRIMARY KEY, http INTEGER, live_version TEXT, note TEXT, probed_at TEXT, health_probed_at TEXT, health_error TEXT);
INSERT INTO service_registry VALUES ('a', 'live', 'worker', '1.0.0'), ('b', 'live', 'worker', '2.0.0-x'), ('m', 'live', 'member', '2.0.7-folded'), ('r', 'retired', 'worker', '3.0.0'), ('u', 'live', 'worker', 'unknown');`);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const sql = readFileSync(new URL("./2026-11-05-e-health-readback.sql", import.meta.url), "utf8");
db.exec(sql);
const probe = () => db.prepare(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1000982'").get().p).get();
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString().slice(0, 19).replace("T", " ");
ok(probe().observed === "2 live version credentials without a health-check read-back", "no audit row: both deployed workers lack a read-back; the member, the retired and the unknown-version rows are out of scope: " + probe().observed);
db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, note, probed_at, health_probed_at) VALUES ('a', 200, '1.0.0', 'SYNC', ?, NULL)").run(ago(0.1));
ok(probe().observed.startsWith("2 "), "an audit row without the stamp is not a read-back (the state of main before the change)");
db.prepare("UPDATE worker_live_audit SET health_probed_at = ? WHERE worker = 'a'").run(ago(0.2));
ok(probe().observed.startsWith("1 "), "a fresh stamp counts for that worker");
db.prepare("INSERT INTO worker_live_audit (worker, http, live_version, note, probed_at, health_probed_at) VALUES ('b', 200, '2.0.1-newer', 'DRIFT', ?, ?)").run(ago(0.1), ago(0.1));
ok(probe().observed === "0 live version credentials without a health-check read-back" && probe().expected === probe().observed, "a worker whose registry label lags its served version still has a read-back (drift is another detector's job): " + probe().observed);
db.prepare("UPDATE worker_live_audit SET health_probed_at = ? WHERE worker = 'b'").run(ago(5));
ok(probe().observed.startsWith("1 "), "a stamp older than 3 hours does not count");
db.prepare("UPDATE worker_live_audit SET health_probed_at = ?, live_version = NULL WHERE worker = 'b'").run(ago(0.1));
ok(probe().observed.startsWith("1 "), "a stamp with no served version does not count");
db.prepare("UPDATE worker_live_audit SET live_version = '2.0.0-x' WHERE worker = 'b'").run();
ok(probe().observed.startsWith("0 "), "back to a clean read-back");
db.prepare("INSERT INTO service_registry VALUES ('c', 'live', 'worker', '9.9.9')").run();
ok(probe().observed.startsWith("1 "), "a newly registered live worker with no audit row is a credential without read-back");
const c = db.prepare("SELECT status, attempts, last_verdict FROM remediation_contracts WHERE class = 'issue-1000982'").get();
ok(c.status === "active" && c.attempts === 0 && c.last_verdict === null, "the contract is re-armed");
ok(db.prepare("SELECT verify_probe p FROM bak_20261105_e_health_readback").get().p === "OLD", "the old probe is saved for the rollback");
// the writer: scripts/fleet-autoaudit.py stamps health_probed_at from the same fields the probe reads
const py = readFileSync(new URL("../scripts/fleet-autoaudit.py", import.meta.url), "utf8");
ok(/health_probed_at=excluded\.health_probed_at, health_error=excluded\.health_error/.test(py) && /def health_stamp\(row, now\)/.test(py) && /hp, he = health_stamp\(r, now\)/.test(py), "fleet-autoaudit.py writes both columns in its upsert");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
