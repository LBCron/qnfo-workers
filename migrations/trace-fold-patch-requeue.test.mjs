import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-03-trace-fold-patch-requeue.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-ops/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const id = "ct_1b8wspgbpz6fy2";
const error = "patch too large: exceeds verification limit [FAIL-SIGNATURE-STOP-1]";
const anchor = "async function logToolEvent(env, name, args, res, ms) {";
const task = (db) => db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const contract = (db) => db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1001398'").get();
const snapshot = (db) => ["code_tasks", "agent_issues", "remediation_contracts", "failure_modes", "decision_log"]
  .map((table) => db.prepare(`SELECT * FROM ${table}`).all());

function fixture(changes = {}, issue = "open") {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo, path, goal, status, step, attempts,
      model, ctx, branch, pr_url, last_error, lease_until, updated_at);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id, precondition,
      action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h,
      status, module, attempts, last_verdict, last_attempt_at, deferred_since, next_due_at);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode, root_cause,
      remediation, detector, probe_class, first_seen, issue_id);
    CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius,
      rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
    INSERT INTO agent_issues VALUES (1000650, 'open');
    INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, status, module, attempts, last_verdict)
      VALUES ('issue-1001398', 1001398, 'old monitoring action', 'old probe', 'active', 'probe-template-v2d-loop', 27, 'fail');
  `);
  db.prepare("INSERT INTO agent_issues VALUES (1001398, ?)").run(issue);
  const original = {
    id, repo: "qnfo-workers", path: "qnfo-ops/worker.js", goal: "[issue #1000650] RM-TRACE-FOLD-1",
    status: "failed", step: "propose", attempts: 4, model: "last-rung",
    ctx: JSON.stringify({ anchor, base: "stale source", edits: [1], sigs: ["patch too large"], sig_n: 4, claim: { token: "expired-fixture" } }),
    branch: null, pr_url: null, last_error: error, lease_until: null, updated_at: "2026-11-03T00:14:54.177Z",
    ...changes,
  };
  db.prepare(`INSERT INTO code_tasks (${Object.keys(original).join(",")}) VALUES (${Object.keys(original).map(() => "?").join(",")})`)
    .run(...Object.values(original));
  db.exec("INSERT INTO code_tasks SELECT 'unrelated', repo, path, goal, status, step, attempts, model, ctx, branch, pr_url, last_error, lease_until, updated_at FROM code_tasks");
  return db;
}

assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
const db = fixture(), before = task(db), beforeContract = contract(db);
const unrelated = db.prepare("SELECT * FROM code_tasks WHERE id='unrelated'").get();
db.exec(sql);
const recovered = task(db);
assert.equal(recovered.status, "queued");
assert.equal(recovered.step, "read");
assert.equal(recovered.attempts, 0);
for (const key of ["model", "branch", "last_error", "lease_until"]) assert.equal(recovered[key], null, key);
assert.equal(recovered.goal, before.goal, "the feature goal is not narrowed or silently dropped");
assert.deepEqual(JSON.parse(recovered.ctx), { anchor, recovery: "TRACE-FOLD-PATCH-REQUEUE-1" });
assert.equal(source.split(anchor).length, 2, "preserved function anchor occurs exactly once in fresh source");
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_trace_fold_task").get(), before);
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_trace_fold_contract").get(), beforeContract);
assert.deepEqual(db.prepare("SELECT * FROM code_tasks WHERE id='unrelated'").get(), unrelated);
assert.equal(contract(db).attempts, 0);
assert.equal(contract(db).last_verdict, null);
assert.ok(contract(db).next_due_at);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status='open'").get().n, 2);

const once = snapshot(db);
db.exec(sql);
assert.deepEqual(snapshot(db), once, "reapplying does not reset progress or duplicate decisions");
const probe = contract(db).verify_probe;
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='fm-trace-fold-stale-patch-snapshot'").get().verify_probe;
assert.equal(db.prepare(detector).get().observed, "0");
for (const status of ["queued", "failed", "needs_human", "publish_failed", "closed", "superseded",
  "ready_to_publish", "publishing", "published", "pr_open", "merged", "deployed"]) {
  db.prepare("UPDATE code_tasks SET status=?, step='done', last_error=NULL WHERE id=?").run(status, id);
  assert.equal(db.prepare(probe).get().observed,
    ["ready_to_publish", "publishing", "published", "pr_open", "merged", "deployed"].includes(status) ? "ready" : "pending", status);
}
for (const changes of ["step='verify'", "step='done', last_error='still failing'"]) {
  db.exec(`UPDATE code_tasks SET status='ready_to_publish', ${changes} WHERE id='${id}'`);
  assert.equal(db.prepare(probe).get().observed, "pending", "status alone is not verification evidence");
}
for (const status of ["failed", "needs_human", "publish_failed"]) {
  db.prepare("UPDATE code_tasks SET status=?, step='propose', attempts=5, ctx='{}', last_error=?, updated_at='later' WHERE id=?").run(status, error, id);
  assert.equal(db.prepare(detector).get().observed, "1", status + " is detected after recovery");
  const advanced = snapshot(db);
  db.exec(sql);
  assert.deepEqual(snapshot(db), advanced, "a later failure does not receive another reset");
}

for (const [changes, issue] of [
  [{ status: "queued" }], [{ status: "ready_to_publish" }], [{ step: "verify" }],
  [{ last_error: "different failure" }], [{ lease_until: "2999-01-01T00:00:00Z" }],
  [{ pr_url: "https://github.com/QNFO/qnfo-workers/pull/1" }],
  [{ path: "other/worker.js" }], [{ repo: "other" }], [{ id: "another-task" }],
  [{}, "closed"],
]) {
  const other = fixture(changes, issue), original = task(other), originalContract = contract(other);
  other.exec(sql);
  assert.deepEqual(task(other), original, `must not restart ${JSON.stringify([changes, issue])}`);
  assert.deepEqual(contract(other), originalContract, "ineligible tasks keep their completion contract");
  assert.equal(other.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  other.close();
}
const fallback = fixture({ ctx: "{}" });
fallback.exec(sql);
assert.equal(JSON.parse(task(fallback).ctx).anchor, anchor);
fallback.close();

const rollback = /^-- Rollback: (.+)$/m.exec(sql)[1];
const restore = fixture();
const originalTask = task(restore), originalContract = contract(restore);
restore.exec(sql);
restore.exec(rollback);
assert.deepEqual(task(restore), originalTask, "rollback restores the exact task before leasing");
restore.exec(/^-- Rollback \(contract\): (.+)$/m.exec(sql)[1]);
assert.deepEqual(contract(restore), originalContract);
assert.equal(restore.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 0);
restore.close();
for (const changes of ["lease_until='2999-01-01T00:00:00Z'", "step='propose'", "attempts=1", "status='published'"]) {
  const advanced = fixture();
  advanced.exec(sql);
  advanced.exec(`UPDATE code_tasks SET ${changes} WHERE id='${id}'`);
  const progress = task(advanced);
  advanced.exec(rollback);
  assert.deepEqual(task(advanced), progress, "rollback never overwrites a leased or advanced task");
  advanced.close();
}
db.close();
console.log("Trace-fold recovery: fresh read, guarded one-time retry, rollback and evidence probes passed");
