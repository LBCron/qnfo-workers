// STANDING-LIVENESS-NEVER-SUPERSEDED-1 offline suite: replays migrations/2026-11-04-18-liveness-never-superseded.sql on node:sqlite over a red-drain row whose step 0 is the live one
// (verbatim from fleet_tasks, 2026-11-04). Proves: the header opts in; step 0 supersedes a liveness contract before the file and does not after it, while an ordinary probe-error contract is
// still superseded and a detector is not; the new last step and the one-time UPDATE re-arm only superseded:probe-unusable liveness contracts (the REM-A5-RETIRE and RUNTIME-LIVENESS-GAP-2
// supersessions stay); the canonical copy moves with the live one; the detector reads 1 when a superseded:probe-unusable liveness contract is dark; a replay changes nothing.
// Output MUST contain "0 failed" on success.   node migrations/liveness-never-superseded.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-18-liveness-never-superseded.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "no delete or drop, so no BACKUP header is needed");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+fleet_tick\b/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no write to fleet_tick, no claude.ai link");

const STEP0 = `UPDATE remediation_contracts SET status='superseded',
        last_verdict='superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)',
        last_attempt_at=datetime('now')
      WHERE status IN ('active','holding')
        AND (verify_probe LIKE '%needs-machine-probe%' OR COALESCE(last_verdict,'') IN ('vacuous-probe-result','probe-not-machine-executable','probe-error'))
        AND substr(class,1,3) <> 'fm-' AND substr(class,1,7) <> 'belief-'`;
const DEF = JSON.stringify({ steps: Array.from({ length: 9 }, (_, i) => ({ type: "sql", db: "AUDIT", sql: i === 0 ? STEP0 : "SELECT " + i })) });
const DETECTOR = `SELECT '0' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE module = 'runtime-liveness-v1' AND issue_id IS NULL AND status IN ('escalated', 'monitoring')) AS TEXT) AS observed`;

function world() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, status TEXT, module TEXT, last_verdict TEXT, last_attempt_at TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT, repo_path TEXT, exported_at TEXT);`);
  raw.prepare("INSERT INTO fleet_tasks (id, definition, version) VALUES ('red-drain', ?, 7)").run(DEF);
  raw.prepare("INSERT INTO fleet_tasks_canonical (id, definition, repo_path) VALUES ('red-drain', ?, 'migrations/old.sql')").run(DEF);
  const c = (cls, status, module, verdict, issue = null) => raw.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, status, module, last_verdict, attempts) VALUES (?, ?, '{\"url\":\"https://qnfo.org/\",\"status\":200}', ?, ?, ?, 700)").run(cls, issue, status, module, verdict);
  c("rt-live-qnfo-ops", "superseded", "runtime-liveness-v1", "superseded:probe-unusable (no machine-executable probe; the issue stays open and needs a real one)");
  c("rt-page-ideas-feed", "superseded", "runtime-liveness-v1", "superseded:RUNTIME-LIVENESS-GAP-2 (the endpoint takes 3 to 5 s)");
  c("rt-live-qnfo-artifacts", "superseded", "runtime-liveness-v1", "superseded:REM-A5-RETIRE-ARTIFACTS-1 (qnfo-artifacts was retired)");
  c("rt-live-erroring", "active", "runtime-liveness-v1", "probe-error");
  c("rt-other", "active", null, "probe-error");
  c("fm-some-detector", "active", "failure-mode", "probe-error");
  c("issue-bound-liveness", "superseded", "runtime-liveness-v1", "superseded:probe-unusable (x)", 7);
  raw.prepare("INSERT INTO remediation_contracts (class, verify_probe, status, module, last_verdict) VALUES ('fm-standing-liveness-parked', ?, 'active', 'failure-mode', 'pass')").run(DETECTOR);
  return raw;
}
const q1 = (r, s, ...p) => r.prepare(s).get(...p);
const st = (r, cls) => (q1(r, "SELECT status s FROM remediation_contracts WHERE class = ?", cls) || {}).s;
const stepSql = (r, i) => JSON.parse(q1(r, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d).steps[i].sql;
const detectorObserved = (r) => q1(r, q1(r, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-standing-liveness-parked'").p).observed;

// control: before the file, step 0 supersedes a liveness contract whose last verdict was probe-error
{ const w = world(); w.exec(stepSql(w, 0)); ok(st(w, "rt-live-erroring") === "superseded", "control: the live step 0 supersedes a liveness contract after one probe-error", st(w, "rt-live-erroring")); }

const w = world();
const before = q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d;
w.exec(sql);
const after = JSON.parse(q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d);
ok(after.steps.length === 10, "red-drain has one more step", after.steps.length);
ok(q1(w, "SELECT definition d FROM bak_20261104_liveness_superseded_task WHERE id = 'red-drain'").d === before, "the backup holds the previous definition byte for byte");
ok(q1(w, "SELECT version v FROM fleet_tasks WHERE id = 'red-drain'").v === 8, "version bumped once");
ok(after.steps.every((s, i) => i === 0 || i === 9 || s.sql === "SELECT " + i), "steps other than 0 and the new 9 are untouched");
ok(/COALESCE\(module, ''\) <> 'runtime-liveness-v1' \/\* STANDING-LIVENESS-NEVER-SUPERSEDED-1 \*\//.test(after.steps[0].sql) && after.steps[0].sql.includes("probe-error"), "step 0 gains the liveness exclusion and keeps its rule");
const canon = q1(w, "SELECT definition d, repo_path p FROM fleet_tasks_canonical WHERE id = 'red-drain'");
ok(canon.d === q1(w, "SELECT definition d FROM fleet_tasks WHERE id = 'red-drain'").d && canon.p === "migrations/2026-11-04-18-liveness-never-superseded.sql", "canonical copy moves with the live one");

// re-arm now: only superseded:probe-unusable liveness contracts without an issue
ok(st(w, "rt-live-qnfo-ops") === "active", "the dark liveness contract is active again", st(w, "rt-live-qnfo-ops"));
ok(st(w, "rt-page-ideas-feed") === "superseded" && st(w, "rt-live-qnfo-artifacts") === "superseded", "the two deliberate supersessions are left alone");
ok(st(w, "issue-bound-liveness") === "superseded", "a contract bound to an issue is left alone");
ok(/^rearmed: STANDING-LIVENESS-NEVER-SUPERSEDED-1 \(was superseded:probe-unusable/.test(q1(w, "SELECT last_verdict v FROM remediation_contracts WHERE class = 'rt-live-qnfo-ops'").v), "the verdict says why it was re-armed");

// step 0 after the file
{
  const t = world(); t.exec(sql); t.exec(stepSql(t, 0));
  ok(st(t, "rt-live-erroring") === "active", "after: a liveness contract with probe-error is NOT superseded", st(t, "rt-live-erroring"));
  ok(st(t, "rt-other") === "superseded", "after: an ordinary probe-error contract is still superseded (rule unchanged for them)", st(t, "rt-other"));
  ok(st(t, "fm-some-detector") === "active", "after: a detector is still never superseded");
}
// the new last step re-arms what the old step 0 had already parked
{
  const t = world(); t.exec(sql);
  t.prepare("UPDATE remediation_contracts SET status='superseded', last_verdict='superseded:probe-unusable (y)' WHERE class='rt-live-erroring'").run();
  t.exec(stepSql(t, 9));
  ok(st(t, "rt-live-erroring") === "active" && st(t, "rt-page-ideas-feed") === "superseded", "last step re-arms a newly parked liveness contract and nothing else");
}
// detector: sees superseded
{
  const t = world();
  ok(detectorObserved(t) === "0", "control: the OLD detector reads 0 while a liveness contract is superseded:probe-unusable (the blind spot)", detectorObserved(t));
  t.exec(sql);
  ok(detectorObserved(t) === "0", "the new detector reads 0 once they are re-armed", detectorObserved(t));
  t.prepare("UPDATE remediation_contracts SET status='superseded', last_verdict='superseded:probe-unusable (z)' WHERE class='rt-live-erroring'").run();
  ok(detectorObserved(t) === "1", "the new detector reads 1 when one is dark", detectorObserved(t));
}
// replay is a no-op
{
  const t = world(); t.exec(sql);
  const d1 = q1(t, "SELECT definition d, version v FROM fleet_tasks WHERE id = 'red-drain'");
  t.exec(sql);
  const d2 = q1(t, "SELECT definition d, version v FROM fleet_tasks WHERE id = 'red-drain'");
  ok(d1.d === d2.d && d1.v === d2.v, "a replay does not change the definition or the version");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
