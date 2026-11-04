// REAL-PROBE-NEVER-SUPERSEDED-1 offline suite: red-drain step 0 keeps a contract that produced a real reading in the last 24 hours, supersedes the rest as before,
// the contracts lost in the last day are re-armed, and the detector counts what is left.
// Run: node --no-warnings migrations/real-probe-never-superseded.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-04-real-probe-never-superseded.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");

// red-drain step 0 as live on 2026-11-04T19:05Z (after STANDING-LIVENESS-NEVER-SUPERSEDED-1)
const STEP0 = `UPDATE remediation_contracts SET status='superseded',
        last_verdict='superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)',
        last_attempt_at=datetime('now')
      WHERE status IN ('active','holding')
        AND (verify_probe LIKE '%needs-machine-probe%' OR COALESCE(last_verdict,'') IN ('vacuous-probe-result','probe-not-machine-executable','probe-error'))
        AND substr(class,1,3) <> 'fm-' AND substr(class,1,7) <> 'belief-' AND COALESCE(module, '') <> 'runtime-liveness-v1' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */`;
const definition = JSON.stringify({ steps: [{ type: "sql", db: "AUDIT", sql: STEP0 }, { type: "sql", db: "AUDIT", sql: "SELECT 1" }] });

const SCHEMA = `
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT, repo_path TEXT, exported_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT, last_verdict TEXT, last_attempt_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, observed TEXT, pass INTEGER, verified_at TEXT);
CREATE INDEX idx_rv_class_verified ON remediation_verifications (class, verified_at);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`;
const db = new DatabaseSync(":memory:");
db.exec(SCHEMA);
db.prepare("INSERT INTO fleet_tasks VALUES ('red-drain', ?, 8, '2026-11-04T17:06:41Z')").run(definition);
db.prepare("INSERT INTO fleet_tasks_canonical VALUES ('red-drain', ?, 'migrations/2026-11-04-18-liveness-never-superseded.sql', 'x')").run(definition);
for (const [id, st] of [[1, "open"], [2, "open"], [3, "open"], [4, "open"], [5, "closed"], [6, "open"], [7, "open"], [8, "open"]]) db.prepare("INSERT INTO agent_issues VALUES (?, 't', ?)").run(id, st);
const probe = "SELECT '0' AS expected, '1' AS observed";
const contract = (cls, issue, status, verdict, extra = {}) =>
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, module, last_verdict, attempts, last_attempt_at) VALUES (?, ?, ?, 'd1-query', ?, ?, ?, 50, datetime('now', '-3 hours'))")
    .run(cls, issue, extra.probe || probe, status, extra.module || "probe-template-v3-generic", verdict);
const reading = (cls, issue, observed, hoursAgo) =>
  db.prepare("INSERT INTO remediation_verifications (issue_id, class, observed, pass, verified_at) VALUES (?, ?, ?, 0, datetime('now', ?))").run(issue, cls, observed, "-" + hoursAgo + " hours");

// lost in the last day: superseded, open issue, real reading
contract("issue-1", 1, "superseded", "superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)"); reading("issue-1", 1, "budget state is not ok", 5);
contract("issue-2", 2, "superseded", "superseded:probe-unusable (x)"); reading("issue-2", 2, "pending: waiting", 2);                  // only a deferral: not a real reading
contract("issue-3", 3, "superseded", "superseded:probe-unusable (x)"); reading("issue-3", 3, "186", 30);                              // reading too old
contract("issue-4", 4, "superseded", "superseded:probe-unusable (x)");                                                               // no reading at all
contract("issue-5", 5, "superseded", "superseded:probe-unusable (x)"); reading("issue-5", 5, "24 cmd failures", 4);                  // issue closed
contract("issue-6", 6, "superseded", "superseded:deliberate (REM-A5-RETIRE)"); reading("issue-6", 6, "x", 1);                         // other supersede reason
// live contracts that step 0 would see
contract("issue-7", 7, "active", "probe-error"); reading("issue-7", 7, "12", 2);                                                     // transient error, real reading 2 h ago: kept
contract("issue-8", 8, "active", "vacuous-probe-result"); reading("issue-8", 8, "7", 26);                                            // reading 26 h ago: superseded
contract("issue-9", 8, "active", "probe-not-machine-executable");                                                                    // never read: superseded
contract("issue-10", 8, "active", "fail", { probe: "needs-machine-probe" });                                                         // placeholder: superseded
contract("fm-x", null, "active", "probe-error"); contract("issue-11", 8, "active", "pass");

db.exec(sql);
const st = (c) => db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = ?").get(c);
ok(st("issue-1").status === "active" && st("issue-1").last_verdict.startsWith("rearmed: REAL-PROBE-NEVER-SUPERSEDED-1"), "a contract lost in the last day with a real reading on an open issue is re-armed", st("issue-1"));
ok(st("issue-2").status === "superseded", "a pending deferral is not a real reading", st("issue-2"));
ok(st("issue-3").status === "superseded", "a reading older than 24 hours is not enough", st("issue-3"));
ok(st("issue-4").status === "superseded", "no reading, no re-arm", st("issue-4"));
ok(st("issue-5").status === "superseded", "a closed issue is left alone", st("issue-5"));
ok(st("issue-6").status === "superseded" && st("issue-6").last_verdict.includes("REM-A5-RETIRE"), "another supersede reason is left alone", st("issue-6"));
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261104_real_probe_contracts").get().n === 1, "only the re-armed contract is in the backup table");

const t = db.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'red-drain'").get();
const step0 = JSON.parse(t.definition).steps[0].sql;
ok(t.version === 9 && step0.includes("REAL-PROBE-NEVER-SUPERSEDED-1") && step0.includes("STANDING-LIVENESS-NEVER-SUPERSEDED-1") && JSON.parse(t.definition).steps.length === 2, "red-drain step 0 carries the new clause next to the liveness clause", { v: t.version });
ok(db.prepare("SELECT definition = (SELECT definition FROM fleet_tasks WHERE id = 'red-drain') eq FROM fleet_tasks_canonical WHERE id = 'red-drain'").get().eq === 1, "the canonical row moved with the live one");

// run the new step 0 against the live-state contracts
db.exec(step0);
ok(st("issue-7").status === "active", "a transient probe-error with a real reading 2 hours ago is kept", st("issue-7"));
ok(st("issue-8").status === "superseded", "a vacuous verdict with a reading 26 hours ago is superseded", st("issue-8"));
ok(st("issue-9").status === "superseded", "a never-read non-executable probe is superseded", st("issue-9"));
ok(st("issue-10").status === "superseded", "a needs-machine-probe placeholder is superseded", st("issue-10"));
ok(st("fm-x").status === "active" && st("issue-11").status === "active", "detectors and passing contracts are untouched");

// detector
const det = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-real-probe-superseded'").get().verify_probe;
ok(!det.includes(";") && db.prepare(det).get().observed === "0", "the detector reads 0 after the re-arm and holds no semicolon", db.prepare(det).get());
db.prepare("UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:probe-unusable (x)' WHERE class = 'issue-7'").run();
ok(db.prepare(det).get().observed === "1", "the detector counts a lost contract with a recent real reading");
db.prepare("UPDATE remediation_contracts SET status = 'active' WHERE class = 'issue-7'").run();

// idempotent
db.exec(sql);
ok(db.prepare("SELECT version FROM fleet_tasks WHERE id = 'red-drain'").get().version === 9, "re-applying does not bump the task version again");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'REAL-PROBE-NEVER-SUPERSEDED-1:%'").get().n === 1 && db.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'real-probe-superseded'").get().n === 1, "re-applying duplicates no decision and no failure mode");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261104_real_probe_task").get().n === 1, "the red-drain backup holds the original definition once");
ok(!JSON.parse(db.prepare("SELECT definition FROM bak_20261104_real_probe_task").get().definition).steps[0].sql.includes("REAL-PROBE-NEVER-SUPERSEDED-1"), "the backup is the pre-change text");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
