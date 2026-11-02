// WATCHMAKER-TASK-RECOVERY-1: node migrations/watchmaker-task-recovery.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const sql = readFileSync(new URL("./2026-11-02-watchmaker-task-recovery.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-fleet-dashboard/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const id = "ct_o8wx7m353kt900";
let pass = 0;
const ok = (condition, message) => { assert.ok(condition, message); pass++; };
const get = (db, table, column, value) => db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).get(value);

function world({ status = "failed", issueStatus = "open", lease = null, pr = null, error = "PUBLISH-SUITE-CHECK-1: VERSION and by_person assertions" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INTEGER, model TEXT, ctx TEXT, branch TEXT, pr_url TEXT, last_error TEXT, lease_until TEXT, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
  db.prepare("INSERT INTO code_tasks VALUES (?, 'qnfo-workers', 'qnfo-fleet-dashboard/worker.js', '[issue #99909] remove by_person', ?, 'propose', 5, 'old-model', ?, 'old-branch', ?, ?, ?, '2026-11-01T05:02:52Z')")
    .run(id, status, JSON.stringify({ anchor: "stuck_prs + needs_person + by_person + revert_failed AS stuck", edits: ["stale"], sigs: ["same", "same", "same"], repair_round: 3 }), pr, error, lease);
  db.exec(`INSERT INTO code_tasks SELECT 'unrelated', repo, path, goal, status, step, attempts, model, ctx, branch, pr_url, last_error, lease_until, updated_at FROM code_tasks;
INSERT INTO remediation_contracts (class, issue_id, verify_probe, action, module, next_due_at, status) VALUES ('issue-1000972', 1000972, 'SELECT 1', 'old action', 'old module', 'old due', 'active');`);
  db.prepare("INSERT INTO agent_issues VALUES (1000972, ?)").run(issueStatus);
  db.exec("INSERT INTO agent_issues VALUES (99909, 'open')");
  return db;
}

const db = world();
const original = get(db, "code_tasks", "id", id);
const other = get(db, "code_tasks", "id", "unrelated");
const oldContract = get(db, "remediation_contracts", "class", "issue-1000972");
db.exec(sql);
const task = get(db, "code_tasks", "id", id);
ok(task.status === "queued" && task.step === "read" && task.attempts === 0, "failed task starts a fresh read and attempt budget");
ok(task.model === null && task.last_error === null && task.branch === null && task.lease_until === null, "stale proposal metadata is cleared");
const ctx = JSON.parse(task.ctx);
assert.deepEqual(Object.keys(ctx), ["anchor"]); pass++;
ok(source.split(ctx.anchor).length === 2, "fresh context points to one function signature on main");
ok(task.goal.startsWith("[issue #99909]") && task.goal.length < 6000, "intake can still find the parent task within GOAL_MAX");
ok(task.goal.includes("do not remove by_person") && task.goal.includes("target 0") && task.goal.includes("existing dashboard suites pass"), "retry preserves verification and the metric target");
ok(task.goal.includes("Do not edit the VERSION declaration") && !task.goal.includes("SET target"), "retry preserves the current VERSION and drops contradictory target changes");
assert.deepEqual(get(db, "code_tasks", "id", "unrelated"), other); pass++;
assert.deepEqual(get(db, "bak_20261102_watchmaker_task", "id", id), original); pass++;
ok(get(db, "agent_issues", "id", 1000972).status === "open" && get(db, "agent_issues", "id", 99909).status === "open", "neither issue is prematurely closed");

const probe = get(db, "remediation_contracts", "class", "issue-1000972").verify_probe;
const observed = () => db.prepare(probe).get().observed;
ok(observed() === "pending", "queuing is not recovery evidence");
for (const status of ["failed", "closed", "publish_failed", "needs_human", "reverted"]) {
  db.prepare("UPDATE code_tasks SET status = ?, step = 'done', pr_url = 'https://github.com/QNFO/qnfo-workers/pull/1' WHERE id = ?").run(status, id);
  ok(observed() === "pending", status + " with a PR and step done is not success");
}
for (const status of ["ready_to_publish", "published", "merged"]) {
  db.prepare("UPDATE code_tasks SET status = ?, step = 'done', last_error = NULL WHERE id = ?").run(status, id);
  ok(observed() === "ready", status + " meets the exhausted-task definition of done");
}
db.prepare("UPDATE code_tasks SET last_error = 'suite failure' WHERE id = ?").run(id);
ok(observed() === "pending", "a pending suite error cannot close the issue");
db.prepare("UPDATE code_tasks SET status = 'failed' WHERE id = ?").run(id);
const detector = get(db, "remediation_contracts", "class", "fm-watchmaker-task-goal-conflict").verify_probe;
ok(db.prepare(detector).get().observed === "1", "a recurring failure is detected");

const snapshot = (d) => JSON.stringify(["code_tasks", "agent_issues", "remediation_contracts", "decision_log", "failure_modes"].map((t) => d.prepare(`SELECT * FROM ${t}`).all()));
const beforeReplay = snapshot(db);
db.exec(sql);
ok(snapshot(db) === beforeReplay, "replay does not restart a task that failed again or duplicate decisions");
db.prepare("UPDATE code_tasks SET last_error = 'PUBLISH-SUITE-CHECK-1: another failure', pr_url = NULL WHERE id = ?").run(id);
const failedAgain = snapshot(db);
db.exec(sql);
ok(snapshot(db) === failedAgain, "replay cannot reset the retry budget after another publisher suite failure");
for (const opts of [{ status: "queued" }, { status: "merged" }, { issueStatus: "closed" }, { lease: "2099-01-01T00:00:00Z" }, { pr: "existing-pr" }, { error: "unrelated failure" }]) {
  const guarded = world(opts);
  const before = get(guarded, "code_tasks", "id", id);
  guarded.exec(sql);
  assert.deepEqual(get(guarded, "code_tasks", "id", id), before); pass++;
  ok(get(guarded, "remediation_contracts", "class", "issue-1000972").verify_probe === "SELECT 1", "ineligible task leaves completion contract unchanged");
}

const rollback = sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length);
const restored = world();
restored.exec(sql);
restored.exec(rollback);
assert.deepEqual(get(restored, "code_tasks", "id", id), original); pass++;
assert.deepEqual(get(restored, "remediation_contracts", "class", "issue-1000972"), oldContract); pass++;
const leased = world();
leased.exec(sql);
leased.prepare("UPDATE code_tasks SET lease_until = '2099-01-01T00:00:00Z' WHERE id = ?").run(id);
leased.exec(rollback);
ok(get(leased, "code_tasks", "id", id).status === "queued", "rollback cannot overwrite a runner-leased task");

console.log(pass + " passed, 0 failed");
