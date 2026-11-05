// D1-LOCK-OVERLOAD-1 offline suite for migrations/2026-11-05-deploy-guard-lock-5xx-probes.sql.
// Contracts issue-1001280 (HTTP 500 group) and issue-1001391 (HTTP 503 group) gain a probe on worker_logs 5xx responses of qnfo-deploy-guard on its lock routes,
// leave the family module (so contract_probe_templates_family_reassert cannot write the family probe back) and a detector contract is registered.
// Run: node --no-warnings migrations/deploy-guard-lock-5xx-probes.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-deploy-guard-lock-5xx-probes.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(sql), "no row-destructive statement (no BACKUP header owed)");

const FAMILY = "SELECT 1 AS expected, CASE WHEN EXISTS (SELECT 1 FROM fleet_issue_dispatch WHERE fingerprint = 'cf-obs-x') THEN '1' ELSE 'missing' END AS observed";
const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, verify_probe TEXT, verify_transport TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0, precondition TEXT, action TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT NOT NULL, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE worker_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER, script_name TEXT, url TEXT, status INTEGER);
CREATE INDEX idx_worker_logs_script_ts ON worker_logs(script_name, ts_ms);
CREATE TRIGGER family_reassert AFTER UPDATE OF verify_probe ON remediation_contracts
WHEN NEW.module = 'issue-birth-probe-families' AND instr(NEW.verify_probe, 'ELSE ''missing'' END AS observed') = 0
BEGIN UPDATE remediation_contracts SET verify_probe = '${FAMILY.replace(/'/g, "''")}' WHERE class = NEW.class; END;
INSERT INTO remediation_contracts (class, status, last_verdict, verify_probe, verify_transport, module) VALUES
  ('issue-1001280', 'active', 'fail', '${FAMILY.replace(/'/g, "''")}', 'd1-query', 'issue-birth-probe-families'),
  ('issue-1001391', 'active', 'fail', '${FAMILY.replace(/'/g, "''")}', 'd1-query', 'issue-birth-probe-families'),
  ('issue-1001305', 'active', 'fail', '${FAMILY.replace(/'/g, "''")}', 'd1-query', 'issue-birth-probe-families');
`);
db.exec(sql);
const c = (k) => db.prepare("SELECT verify_probe, module, status, attempts FROM remediation_contracts WHERE class = ?").get(k);
ok(c("issue-1001280").module === "deploy-guard-lock-5xx" && c("issue-1001391").module === "deploy-guard-lock-5xx", "both contracts left the family module");
ok(c("issue-1001280").verify_probe.includes("status = 500") && c("issue-1001391").verify_probe.includes("status = 503"), "the 500 group measures 500, the 503 group measures 503");
ok(!c("issue-1001280").verify_probe.includes("missing"), "the family trigger did not write the family probe back");
ok(c("issue-1001305").module === "issue-birth-probe-families" && c("issue-1001305").verify_probe === FAMILY, "an unrelated contract is untouched");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_deploy_guard_5xx_contracts").get().n === 2, "the before-state of the two contracts is kept");

const now = Date.now();
const log = (minAgo, url, status) => db.prepare("INSERT INTO worker_logs (ts_ms, script_name, url, status) VALUES (?, 'qnfo-deploy-guard', ?, ?)").run(now - minAgo * 60000, url, status);
const read = (k) => db.prepare(c(k).verify_probe).get();
// no telemetry in the last hour: a deferral, not a vacuous zero
ok(String(read("issue-1001280").observed).startsWith("pending:"), "with no telemetry in the last hour the probe defers", read("issue-1001280"));
log(10, "https://qnfo-deploy-guard.internal/work-lock/acquire", 200);
ok(read("issue-1001280").observed === "0" && read("issue-1001391").observed === "0" && read("issue-1001280").expected === "0", "healthy telemetry and no 5xx reads 0");
log(20, "https://qnfo-deploy-guard.internal/work-lock/acquire", 500);
log(25, "https://qnfo-deploy-guard.internal/work-locks", 503);
log(30, "https://qnfo-deploy-guard.internal/work-lock/release", 500);
log(400, "https://qnfo-deploy-guard.internal/work-lock/acquire", 500);   // outside the 6 hour window
log(15, "https://qnfo-deploy-guard.internal/scan", 500);                  // not a lock route
ok(read("issue-1001280").observed === "2", "two 500s on lock routes inside six hours are counted; the old one and the non-lock route are not", read("issue-1001280"));
ok(read("issue-1001391").observed === "1", "one 503 on a lock route is counted", read("issue-1001391"));

// the detector: 24 hour window, any 5xx on a lock route
const det = db.prepare("SELECT verify_probe, verify_transport, status FROM remediation_contracts WHERE class = 'fm-deploy-guard-lock-5xx'").get();
ok(det && det.verify_transport === "d1-query" && det.status === "active", "the detector contract is registered");
ok(db.prepare(det.verify_probe).get().observed === "4", "the detector counts 5xx on lock routes over 24 hours (3 inside six hours plus the one at 400 minutes)", db.prepare(det.verify_probe).get());
ok(db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'deploy-guard-lock-overload-5xx' AND probe_class = 'fm-deploy-guard-lock-5xx' AND issue_id = 1001280").get().n === 1, "the failure mode is registered with its detector");

// idempotent
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-deploy-guard-lock-5xx'").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'D1-LOCK-OVERLOAD-1:%'").get().n === 1, "re-applying changes nothing");
ok(db.prepare("SELECT attempts FROM remediation_contracts WHERE class = 'issue-1001280'").get().attempts === 0, "a second apply does not re-arm the contracts");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
