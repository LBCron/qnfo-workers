// D1-LOCK-OVERLOAD-1 follow-up offline suite for migrations/2026-11-05-deploy-guard-fm-since-deploy.sql: the detector fm-deploy-guard-lock-5xx counts from the later of
// 24 hours ago and the deploy, so it does not read red for a day because of the 5xx that the fix removed.
// Run: node --no-warnings migrations/deploy-guard-fm-since-deploy.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const base = rd("2026-11-05-deploy-guard-lock-5xx-probes.sql"), follow = rd("2026-11-05-deploy-guard-fm-since-deploy.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(follow) && /^-- DB: qnfo-audit$/m.test(follow) && /^-- Rollback: .+/m.test(follow), "migration opts in with APPLY-BY, DB and Rollback headers");

const CUT = 1793839500000;
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, verify_probe TEXT, verify_transport TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0, precondition TEXT, action TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT NOT NULL, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE worker_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER, script_name TEXT, url TEXT, status INTEGER);
INSERT INTO remediation_contracts (class, status, last_verdict, verify_probe, verify_transport, module) VALUES ('issue-1001280', 'active', 'fail', 'x', 'd1-query', 'issue-birth-probe-families'), ('issue-1001391', 'active', 'fail', 'x', 'd1-query', 'issue-birth-probe-families');`);
db.exec(base);
const before = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-deploy-guard-lock-5xx'").get().p;
ok(!before.includes(String(CUT)), "before the follow-up the detector has no deploy cutoff");
db.exec(follow);
const after = db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-deploy-guard-lock-5xx'").get().p;
ok(after.includes("MAX((CAST(strftime('%s', 'now') AS INTEGER) - 86400) * 1000, " + CUT + ")"), "the detector counts from the later of 24 h ago and the deploy");
db.exec(follow);
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-deploy-guard-lock-5xx'").get().p === after, "re-applying changes nothing");
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001280'").get().p.includes("21600") && !db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1001280'").get().p.includes(String(CUT)), "the issue contracts keep their 6-hour window without a cutoff");

// behaviour: a 5xx before the cutoff is not counted, one after it is (clock-independent: rows are placed relative to the cutoff and to now)
const now = Date.now();
const log = (ts, url, status) => db.prepare("INSERT INTO worker_logs (ts_ms, script_name, url, status) VALUES (?, 'qnfo-deploy-guard', ?, ?)").run(ts, url, status);
log(now - 60000, "https://qnfo-deploy-guard.internal/work-lock/acquire", 200);        // telemetry is alive
log(CUT - 3600000, "https://qnfo-deploy-guard.internal/work-lock/acquire", 500);      // before the deploy
const read = () => db.prepare(after).get();
if (now > CUT + 3600000 && now < CUT + 20 * 3600000) {
  ok(read().observed === "0", "a 5xx from before the deploy is not counted", read());
  log(now - 1000, "https://qnfo-deploy-guard.internal/work-lock/release", 503);
  ok(read().observed === "1", "a 5xx after it is", read());
} else {
  ok(true, "outside the window in which the cutoff is the binding bound the behavioural check is skipped");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
