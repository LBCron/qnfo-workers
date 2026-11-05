// LOOP-BREAKER-PROBE-TOKEN-1 offline suite: replays migrations/2026-11-05-loop-breaker-probe-tokens.sql on SQLite and runs the two probes against code_tasks fixtures.
// The consumer passes a d1-query contract only when expected equals observed as text; the old probes of issue-1001396 and issue-1001444 held a sentence as expected and a count as
// observed, so they could never pass. Proves: each new probe reads expected = observed = ok when no task with the signature was updated in 6 hours; a task inside the window
// makes observed a reason (never ok); a task outside the window, a different signature, or another path does not count; the contracts are reset; a second apply is a no-op;
// the old probes (kept verbatim in the Rollback line) fail the equality on the same fixture, which is the defect.
// Run: node migrations/loop-breaker-probe-tokens.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-loop-breaker-probe-tokens.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const OLD_1396 = "SELECT 'no HUMAN-ITEMS-AUTOMATIC-1 recurrence on qnfo-fleet-control/worker.js in 6h' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks WHERE path = 'qnfo-fleet-control/worker.js' AND substr(COALESCE(last_error,''),1,24) = 'HUMAN-ITEMS-AUTOMATIC-1:' AND updated_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours')";
const OLD_1444 = "SELECT '0 recurrences in the last 6h' AS expected, CAST(COUNT(*) AS TEXT) || ' in the last 6h (last at ' || COALESCE(MAX(updated_at),'-') || ')' AS observed FROM code_tasks WHERE path = 'qnfo-fleet-dashboard/worker.js' AND status IN ('failed','publish_failed','reverted','needs_human') AND COALESCE(last_error,merge_note,'') LIKE 'NO-PROGRESS-CEILING-1%' AND updated_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours')";

function fresh() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, path TEXT, status TEXT, last_error TEXT, merge_note TEXT, updated_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, attempts INTEGER, last_verdict TEXT, next_due_at TEXT);
`);
  const ins = d.prepare("INSERT INTO remediation_contracts VALUES (?, ?, ?, 'd1-query', 'active', 59, 'fail', '2026-11-04 22:00:00')");
  ins.run("issue-1001396", 1001396, OLD_1396); ins.run("issue-1001444", 1001444, OLD_1444);
  return d;
}
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const task = (d, id, path, status, err, hoursAgo) => d.prepare("INSERT INTO code_tasks (id, path, status, last_error, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, path, status, err, iso(hoursAgo));
const probeOf = (d, cls) => d.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get(cls).verify_probe;
const run = (d, cls) => d.prepare(probeOf(d, cls)).get();

{
  const d = fresh();
  task(d, "a", "qnfo-fleet-control/worker.js", "failed", "HUMAN-ITEMS-AUTOMATIC-1: returned to the fleet, not the owner (was needs_human)", 20);
  task(d, "b", "qnfo-fleet-dashboard/worker.js", "failed", "NO-PROGRESS-CEILING-1: no new failure signature for 51 min (limit 45)", 12);
  // the defect: the old probes never satisfy the comparison, even with nothing to report
  const o1 = d.prepare(OLD_1396).get(), o2 = d.prepare(OLD_1444).get();
  ok(o1.expected !== o1.observed && o2.expected !== o2.observed, "the old probes cannot pass on a clean fixture", { o1, o2 });
  d.exec(sql);
  for (const cls of ["issue-1001396", "issue-1001444"]) {
    const r = run(d, cls);
    ok(r.expected === "ok" && r.observed === "ok", cls + " reads ok = ok when the signature is older than 6 hours", r);
    const c = d.prepare("SELECT attempts, last_verdict, verify_transport, status FROM remediation_contracts WHERE class = ?").get(cls);
    ok(c.attempts === 0 && c.last_verdict === null && c.verify_transport === "d1-query" && c.status === "active", cls + " is reset for the consumer", c);
  }
}
{
  const d = fresh(); d.exec(sql);
  task(d, "c", "qnfo-fleet-control/worker.js", "failed", "HUMAN-ITEMS-AUTOMATIC-1: returned to the fleet, not the owner (was needs_human): x", 2);
  const r = run(d, "issue-1001396");
  ok(r.expected === "ok" && r.observed !== "ok" && /1 HUMAN-ITEMS-AUTOMATIC-1 task\(s\)/.test(r.observed) && /last at 20/.test(r.observed), "a recurrence inside 6 hours makes issue-1001396 read a reason", r);
  ok(run(d, "issue-1001444").observed === "ok", "and does not move the dashboard probe");
}
{
  const d = fresh(); d.exec(sql);
  task(d, "d", "qnfo-fleet-dashboard/worker.js", "failed", "NO-PROGRESS-CEILING-1: no new failure signature for 47 min (limit 45)", 1);
  const r = run(d, "issue-1001444");
  ok(r.expected === "ok" && r.observed !== "ok" && /1 NO-PROGRESS-CEILING-1 task\(s\)/.test(r.observed), "a ceiling event inside 6 hours makes issue-1001444 read a reason", r);
  task(d, "e", "qnfo-fleet-control/worker.js", "failed", "NO-PROGRESS-CEILING-1: other file", 1);
  task(d, "f", "qnfo-fleet-dashboard/worker.js", "queued", "NO-PROGRESS-CEILING-1: a queued row is not a recurrence", 1);
  ok(/1 NO-PROGRESS-CEILING-1 task\(s\)/.test(run(d, "issue-1001444").observed), "another path and a status outside the list do not count");
}
{
  const d = fresh(); d.exec(sql);
  d.prepare("UPDATE remediation_contracts SET attempts = 7, last_verdict = 'fail'").run();
  const before = d.prepare("SELECT class, verify_probe FROM remediation_contracts ORDER BY class").all();
  d.exec(sql);
  const after = d.prepare("SELECT class, verify_probe, attempts, last_verdict FROM remediation_contracts ORDER BY class").all();
  ok(JSON.stringify(before.map((r) => r.verify_probe)) === JSON.stringify(after.map((r) => r.verify_probe)) && after.every((r) => r.attempts === 7 && r.last_verdict === "fail"), "a second apply changes nothing (no reset of a live verdict)");
}
ok(sql.includes(OLD_1396.replace(/'/g, "''")) && sql.includes(OLD_1444.replace(/'/g, "''")), "the Rollback line keeps both old probes verbatim");
ok(/^-- APPLY-BY: ci/m.test(sql) && /^-- DB: qnfo-audit/m.test(sql) && /^-- BACKUP: remediation_contracts/m.test(sql) && /^-- Rollback: UPDATE remediation_contracts/m.test(sql), "header carries APPLY-BY, DB, BACKUP and Rollback");
console.log("loop-breaker-probe-tokens: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
