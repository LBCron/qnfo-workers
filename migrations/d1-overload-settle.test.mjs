// D1-OVERLOAD-REFILE-1 / D1-OVERLOAD-UMBRELLA-PROBE-1 offline suite for migrations/2026-11-05-d1-overload-family-settle.sql.
// The migration gives the open umbrella issue a measuring probe (the text scripts/cf_obs_issue_bridge.py writes), supersedes the open per-group
// D1-overload issues once, and registers the detector fm-d1-overload-refile. Run: node --no-warnings migrations/d1-overload-settle.test.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = rd("2026-11-05-d1-overload-family-settle.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 500) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");
ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(sql), "no row-destructive statement (so no BACKUP header is owed)");

const UMB = "CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]";
const FAMILY_PROBE = "SELECT 1 AS expected, CASE WHEN EXISTS (SELECT 1 FROM fleet_issue_dispatch WHERE fingerprint = 'cf-obs-d1-overload') THEN '1' ELSE 'missing' END AS observed";

// the probe the bridge writes, from the python source of truth
let py = null;
for (const cand of ["python3", "python"]) { const r = spawnSync(cand, ["--version"], { encoding: "utf8" }); if (r.status === 0) { py = cand; break; } }
ok(py !== null, "a python interpreter is available");
let bridgeProbe = "";
if (py) {
  const r = spawnSync(py, ["-c", "import sys; sys.path.insert(0, 'scripts'); import cf_obs_issue_bridge as B; sys.stdout.write(B.umbrella_probe() + '\\n' + B.UMBRELLA_MODULE)"], { encoding: "utf8", cwd: new URL("../", import.meta.url) });
  ok(r.status === 0, "the bridge module loads", r.stderr);
  const [probe, mod] = String(r.stdout).split(/\r?\n/);
  bridgeProbe = probe;
  ok(mod === "d1-overload-umbrella", "the umbrella module name is the one the migration writes", mod);
  ok(sql.includes("verify_probe = '" + probe.replace(/'/g, "''") + "'"), "the migration writes exactly the probe scripts/cf_obs_issue_bridge.py umbrella_probe() writes");
}

function mk(withUmbrella) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, reopened_count INTEGER, triaged_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, last_attempt_at TEXT, verify_probe TEXT, verify_transport TEXT, module TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, precondition TEXT, action TEXT);
CREATE TABLE issue_fold_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, rule TEXT NOT NULL, successor_id INTEGER, evidence TEXT NOT NULL, agent_status TEXT, agent_updated_at INTEGER, agent_close_channel TEXT, triage_state TEXT, triage_close_evidence TEXT, triage_reopened_count INTEGER, triage_triaged_at TEXT, contract_class TEXT, contract_status TEXT, contract_last_verdict TEXT, contract_last_attempt_at TEXT, applied INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT NOT NULL, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
-- the production trigger that undid the bridge's probe write (contract_probe_templates_family_reassert), reduced to its guard
CREATE TRIGGER family_reassert AFTER UPDATE OF verify_probe ON remediation_contracts
WHEN NEW.module = 'issue-birth-probe-families' AND instr(NEW.verify_probe, 'ELSE ''missing'' END AS observed') = 0
BEGIN UPDATE remediation_contracts SET verify_probe = '${FAMILY_PROBE.replace(/'/g, "''")}' WHERE class = NEW.class; END;
`);
  const iss = db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, 0, NULL)");
  const tri = db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL, ?, 'x')");
  const con = db.prepare("INSERT INTO remediation_contracts (class, status, last_verdict, last_attempt_at, verify_probe, verify_transport, module) VALUES (?, 'active', 'fail', 'x', ?, 'd1-query', ?)");
  const rows = [
    [100, UMB, "open", 0],
    [1, "CF-OBS-ISSUE-1: qnfo-pdf: {\"error\":\"D1_ERROR: D1 DB is overloaded. Too many resources\"}", "open", 3],
    [2, "LOOP-BREAKER-1: qnfo-code-orchestrator: fleet_tick_heavy: D_ERROR: D DB is overloaded. Too many resources consumed within ", "open", 1],
    [3, "LOOP-BREAKER-1: BRANCH-HYGIENE-1: D1_ERROR: D DB is overloaded. Too many resources consumed within a  second", "open", 1],
    [4, "CF-OBS-ISSUE-1: qnfo-fleet-control: {\"error\":\"d1Run is not defined\"}", "open", 0],
    [5, "LOOP-BREAKER-1: qnfo-ai: D1 DB is overloaded (already closed)", "closed", 0],
    [6, "[fleet] qnfo-fleet-control — worker-observability: D1_ERROR: D1 DB is overloaded", "open", 0],
    [7, "METRIC-TRIGGER-1-FOO: mentions D1 DB is overloaded in a metric title", "open", 0],
  ].filter((r) => withUmbrella || r[0] !== 100);
  for (const [id, title, status, re] of rows) {
    iss.run(id, title, status);
    tri.run(id, re);
    con.run("issue-" + id, id === 100 ? FAMILY_PROBE : "SELECT '1' AS expected, '0' AS observed", id === 100 ? "issue-birth-probe-families" : null);
  }
  return db;
}
const get = (db, q, ...a) => db.prepare(q).get(...a);
const all = (db, q, ...a) => db.prepare(q).all(...a);

// 1. with the umbrella open
const db = mk(true);
db.exec(sql);
ok(all(db, "SELECT id FROM agent_issues WHERE status = 'closed' ORDER BY id").map((r) => r.id).join() === "1,2,3,5,6", "the open per-group overload issues (CF-OBS, LOOP-BREAKER, [fleet]) are closed; the unrelated error, the metric title and the umbrella stay open", all(db, "SELECT id, status FROM agent_issues"));
ok(get(db, "SELECT status FROM agent_issues WHERE id = 100").status === "open", "the umbrella is never closed by the file");
const ev = all(db, "SELECT issue_id, triage_state, close_evidence FROM issue_triage WHERE issue_id IN (1,2,3,6) ORDER BY issue_id");
ok(ev.every((r) => r.triage_state === "closed" && r.close_evidence.startsWith("superseded by 100: ") && r.close_evidence.includes("D1-OVERLOAD-REFILE-1")), "each close names the umbrella as successor and the producer fix", ev);
ok(all(db, "SELECT close_channel FROM agent_issues WHERE id IN (1,2,3,6)").every((r) => r.close_channel === "session:D1-observability"), "close_channel names the session");
ok(all(db, "SELECT class, status FROM remediation_contracts WHERE class IN ('issue-1','issue-2','issue-3','issue-6')").every((r) => r.status === "superseded"), "the closed issues' contracts are superseded");
ok(get(db, "SELECT status FROM remediation_contracts WHERE class = 'issue-4'").status === "active", "the unrelated issue's contract is untouched");
const led = all(db, "SELECT issue_id, applied, agent_status, triage_reopened_count, contract_last_verdict FROM issue_fold_ledger ORDER BY issue_id");
ok(led.map((r) => r.issue_id).join() === "1,2,3,6" && led.every((r) => r.applied === 1 && r.agent_status === "open"), "the ledger holds each before-state and is applied", led);
ok(led[0].triage_reopened_count === 3 && led[0].contract_last_verdict === "fail", "the before-state keeps the reopen count and the contract verdict", led[0]);

// 2. the umbrella's contract: measuring probe, own module, not overwritten by the family trigger
const uc = get(db, "SELECT verify_probe, module, status, attempts FROM remediation_contracts WHERE class = 'issue-100'");
ok(uc.module === "d1-overload-umbrella" && uc.status === "active" && uc.attempts === 0, "the umbrella contract left the family module", uc);
ok(bridgeProbe !== "" && uc.verify_probe === bridgeProbe, "the umbrella contract holds the bridge's probe, not the family probe", uc.verify_probe);
ok(!uc.verify_probe.includes("cf-obs-d1-overload"), "the probe no longer reads the fingerprint that has no row");

// 3. idempotent
db.exec(sql);
ok(get(db, "SELECT COUNT(*) n FROM issue_fold_ledger").n === 4, "re-applying folds nothing twice");
ok(get(db, "SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'D1-OVERLOAD-REFILE-1:%'").n === 1, "the decision is logged once");
ok(get(db, "SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'd1-overload-refile'").n === 1 && get(db, "SELECT issue_id FROM failure_modes WHERE fm_key = 'd1-overload-refile'").issue_id === 100, "the failure mode is registered once and points at the umbrella");
ok(get(db, "SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-d1-overload-refile'").n === 1, "the detector contract is registered once");

// 4. the detector: 0 while nothing but the umbrella is open, 1 when a producer refiles beside the open umbrella, 0 without the umbrella
const det = get(db, "SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-d1-overload-refile'").verify_probe;
const reading = (d) => d.prepare(det).get();
ok(reading(db).expected === "0" && reading(db).observed === "0", "detector reads 0 after the fold", reading(db));
db.prepare("UPDATE agent_issues SET status = 'open' WHERE id = 2").run();
ok(reading(db).observed === "1", "detector reads 1 when a LOOP-BREAKER-1 overload issue is open beside the umbrella", reading(db));
db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = 100").run();
ok(reading(db).observed === "0", "detector reads 0 when the umbrella is not open (the condition is tracked by the per-group issue then)", reading(db));

// 5. no umbrella: nothing is folded, nothing is rewritten
const db2 = mk(false);
db2.exec(sql);
ok(get(db2, "SELECT COUNT(*) n FROM agent_issues WHERE status = 'closed'").n === 1, "without an open umbrella no issue is closed (only the one that was closed already)");
ok(get(db2, "SELECT COUNT(*) n FROM issue_fold_ledger").n === 0, "without an open umbrella the ledger stays empty");
ok(get(db2, "SELECT COUNT(*) n FROM remediation_contracts WHERE module = 'd1-overload-umbrella'").n === 0, "without an open umbrella no contract is moved");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
