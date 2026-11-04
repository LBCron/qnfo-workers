// LIVENESS-ISSUE-BOUND-REARM-1 offline suite: replays migrations/2026-11-05-liveness-issue-bound-rearm.sql on node:sqlite over a red-drain row whose re-arm step is the live one (verbatim from
// fleet_tasks, read 2026-11-04 23:20Z, STANDING-LIVENESS-NEVER-SUPERSEDED-1). Proves: the header opts in and names its BACKUP; the re-arm step stops requiring issue_id IS NULL and still
// re-arms only superseded:probe-unusable liveness contracts, so the three dark issue-bound probes (and a fourth with the same shape) go back to active while the deliberate supersessions
// (REM-A5-RETIRE, RUNTIME-LIVENESS-GAP-2), an ordinary contract and a detector stay; the canonical copy moves with the live one; the detector reads 3 before and 0 after; a replay changes nothing.
// Output MUST contain "0 failed" on success.   node migrations/liveness-issue-bound-rearm.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-liveness-issue-bound-rearm.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1 && header.some((l) => /^-- BACKUP: bak_20261105_liveness_issue_bound_task\s*$/.test(l)), "one single-line Rollback header and a BACKUP header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "no delete or drop");

const REARM = `UPDATE remediation_contracts SET status='active', next_due_at=datetime('now'),
        last_verdict='rearmed: STANDING-LIVENESS-NEVER-SUPERSEDED-1 (was ' || substr(COALESCE(last_verdict,'?'),1,60) || '; a standing liveness probe is never superseded, three straight failures file RUNTIME-PROBE-FAIL-1)'
      WHERE status='superseded' AND issue_id IS NULL AND COALESCE(module,'') = 'runtime-liveness-v1' AND last_verdict LIKE 'superseded:probe-unusable%' /* STANDING-LIVENESS-NEVER-SUPERSEDED-1 */`;
const DEF = JSON.stringify({ steps: Array.from({ length: 10 }, (_, i) => ({ type: "sql", db: "AUDIT", sql: i === 9 ? REARM : "SELECT " + i })) });
const DETECTOR_OLD = `SELECT '0' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE module = 'runtime-liveness-v1' AND issue_id IS NULL AND (status IN ('escalated', 'monitoring') OR (status = 'superseded' AND last_verdict LIKE 'superseded:probe-unusable%'))) AS TEXT) AS observed`;
const DARK = "superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)";

function world() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, status TEXT, module TEXT, last_verdict TEXT, last_attempt_at TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT, repo_path TEXT, exported_at TEXT);`);
  raw.prepare("INSERT INTO fleet_tasks (id, definition, version) VALUES ('red-drain', ?, 7)").run(DEF);
  raw.prepare("INSERT INTO fleet_tasks_canonical (id, definition, repo_path) VALUES ('red-drain', ?, 'migrations/old.sql')").run(DEF);
  const c = (cls, status, module, verdict, issue = null) => raw.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, status, module, last_verdict, attempts) VALUES (?, ?, '{\"url\":\"https://qnfo.org/\",\"status\":200}', ?, ?, ?, 700)").run(cls, issue, status, module, verdict);
  c("rt-live-q08-signal-engine", "superseded", "runtime-liveness-v1", DARK, 1001466);
  c("rt-page-qwav-sitemap", "superseded", "runtime-liveness-v1", DARK, 1000994);
  c("rt-page-fleet-area-reliability", "superseded", "runtime-liveness-v1", DARK, 1001465);
  c("rt-live-qnfo-ops", "superseded", "runtime-liveness-v1", DARK);
  c("rt-page-ideas-feed", "superseded", "runtime-liveness-v1", "superseded:RUNTIME-LIVENESS-GAP-2 (the endpoint takes 3 to 5 s)", 1000990);
  c("rt-live-qnfo-artifacts", "superseded", "runtime-liveness-v1", "superseded:REM-A5-RETIRE-ARTIFACTS-1 (qnfo-artifacts was retired)");
  c("issue-77", "superseded", null, DARK, 77);
  c("rt-page-qwav-home", "active", "runtime-liveness-v1", "pass", 1000986);
  raw.prepare("INSERT INTO remediation_contracts (class, verify_probe, status, module, last_verdict) VALUES ('fm-standing-liveness-parked', ?, 'active', 'failure-mode', 'pass')").run(DETECTOR_OLD);
  return raw;
}
const q1 = (r, s, ...p) => r.prepare(s).get(...p);
const st = (r, cls) => (q1(r, "SELECT status s FROM remediation_contracts WHERE class = ?", cls) || {}).s;
const detectorObserved = (r) => q1(r, q1(r, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-standing-liveness-parked'").p).observed;

const w = world();
const before = q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d;
ok(detectorObserved(w) === "1", "control: the old detector (issue_id IS NULL) reads only the one unbound dark probe, blind to the three issue-bound ones", detectorObserved(w));
w.exec(sql);
const after = JSON.parse(q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d);
ok(after.steps.length === 10 && after.steps.every((s, i) => i === 9 || s.sql === "SELECT " + i), "red-drain keeps its 10 steps; only step 9 changed");
ok(!/issue_id IS NULL/.test(after.steps[9].sql) && /LIVENESS-ISSUE-BOUND-REARM-1/.test(after.steps[9].sql) && /last_verdict LIKE 'superseded:probe-unusable%'/.test(after.steps[9].sql) && /runtime-liveness-v1/.test(after.steps[9].sql), "the re-arm step lost issue_id IS NULL and kept the module and verdict filters", after.steps[9].sql);
ok(q1(w, "SELECT definition d FROM bak_20261105_liveness_issue_bound_task WHERE id = 'red-drain'").d === before, "the backup holds the previous definition byte for byte");
ok(q1(w, "SELECT version v FROM fleet_tasks WHERE id = 'red-drain'").v === 8, "version bumped once");
ok(q1(w, "SELECT definition d FROM fleet_tasks_canonical WHERE id = 'red-drain'").d === q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d, "the canonical copy moved with the live one");

for (const cls of ["rt-live-q08-signal-engine", "rt-page-qwav-sitemap", "rt-page-fleet-area-reliability"]) ok(st(w, cls) === "active", cls + " is re-armed", st(w, cls));
ok(/^rearmed: LIVENESS-ISSUE-BOUND-REARM-1/.test(q1(w, "SELECT last_verdict v FROM remediation_contracts WHERE class = 'rt-page-qwav-sitemap'").v), "the verdict says why");
ok(q1(w, "SELECT attempts a FROM remediation_contracts WHERE class = 'rt-page-qwav-sitemap'").a === 700, "attempts are kept so the history stays readable");
ok(st(w, "rt-live-qnfo-ops") === "superseded", "the one-time UPDATE also re-arms only issue-bound ones; the unbound one is the red-drain step's job at its next run (unchanged behaviour)", st(w, "rt-live-qnfo-ops"));
ok(st(w, "rt-page-ideas-feed") === "superseded" && st(w, "rt-live-qnfo-artifacts") === "superseded", "the deliberate supersessions (RUNTIME-LIVENESS-GAP-2, REM-A5-RETIRE) stay");
ok(st(w, "issue-77") === "superseded", "an ordinary issue contract (not a liveness module) stays superseded");
ok(st(w, "rt-page-qwav-home") === "active" && q1(w, "SELECT last_verdict v FROM remediation_contracts WHERE class = 'rt-page-qwav-home'").v === "pass", "an active liveness contract is untouched");
ok(st(w, "fm-standing-liveness-parked") === "active", "the detector contract stays active");

// the step's own SQL, run on its own over the world the file left behind, re-arms the unbound dark probe and nothing else
w.exec(after.steps[9].sql);
ok(st(w, "rt-live-qnfo-ops") === "active" && st(w, "rt-page-ideas-feed") === "superseded" && st(w, "issue-77") === "superseded", "the new step re-arms an unbound dark liveness probe and leaves the rest", [st(w, "rt-live-qnfo-ops"), st(w, "rt-page-ideas-feed"), st(w, "issue-77")]);

// the detector now sees issue-bound dark probes
const w2 = world();
w2.exec(sql.replace(/UPDATE remediation_contracts SET status = 'active'[\s\S]*?probe-unusable%';\n/, ""));   // without the one-time re-arm: the three stay dark
ok(detectorObserved(w2) === "4", "the new detector reads 4 with the issue-bound probes dark (the old one read 1)", detectorObserved(w2));
ok(detectorObserved(w) === "0", "and 0 once they are re-armed and the unbound one is re-armed by the step", detectorObserved(w));

// a replay changes nothing
const snap = JSON.stringify(w.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) + q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d;
w.exec(sql);
ok(snap === JSON.stringify(w.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()) + q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d && q1(w, "SELECT version v FROM fleet_tasks WHERE id = 'red-drain'").v === 8, "a replay changes nothing");

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
