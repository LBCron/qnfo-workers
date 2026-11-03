import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-03-ipatent-task-recovery.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-fleet-dashboard/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const id = "ct_im1000598";
const task = (db) => db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const contract = (db) => db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1001426'").get();
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
    INSERT INTO agent_issues VALUES (1000598, 'open');
    INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, status, module, attempts)
      VALUES ('issue-1001426', 1001426, 'old monitoring action', 'old probe', 'parked', 'probe-template-v2d-loop', 9);
  `);
  db.prepare("INSERT INTO agent_issues VALUES (1001426, ?)").run(issue);
  const original = {
    id, repo: "qnfo-workers", path: "qnfo-fleet-dashboard/worker.js",
    goal: "[issue #1000598] NET-ZERO-1: remove dashboard reads; later retirement remains open",
    status: "failed", step: "propose", attempts: 9, model: "last-rung",
    ctx: JSON.stringify({ anchor: '"  ipatent help",', win_text: "old window", sigs: ["SEARCH occurs 0 times"], sig_n: 9 }),
    branch: null, pr_url: null, last_error: "edit 1: SEARCH text occurs 0 times in the shown content",
    lease_until: null, updated_at: "2026-11-03T04:50:56.321Z", ...changes,
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
assert.equal(recovered.goal, before.goal, "the retirement goal and obligations are preserved");
const ctx = JSON.parse(recovered.ctx);
assert.deepEqual(ctx, { anchor: "async function ipatentUsage(env) {", recovery: "IPATENT-TASK-RECOVERY-1" });
assert.equal(source.split(ctx.anchor).length, 2, "fresh function anchor is unique");
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_ipatent_task").get(), before);
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_ipatent_contract").get(), beforeContract);
assert.deepEqual(db.prepare("SELECT * FROM code_tasks WHERE id='unrelated'").get(), unrelated);
assert.equal(contract(db).status, "active");
assert.equal(contract(db).attempts, 0);
assert.ok(contract(db).next_due_at);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status='open'").get().n, 2);
const once = snapshot(db);
db.exec(sql);
assert.deepEqual(snapshot(db), once, "migration is idempotent");

const probe = contract(db).verify_probe;
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='fm-ipatent-task-search-recovery'").get().verify_probe;
assert.equal(db.prepare(probe).get().observed, "pending", "queuing is not delivery");
assert.equal(db.prepare(detector).get().observed, "0");
const delivered = ["ready_to_publish", "publishing", "published", "pr_open", "merged", "deployed"];
for (const status of ["queued", "failed", "needs_human", "publish_failed", "closed", "superseded", ...delivered]) {
  db.prepare("UPDATE code_tasks SET status=?, step='done', last_error=NULL WHERE id=?").run(status, id);
  assert.equal(db.prepare(probe).get().observed, delivered.includes(status) ? "ready" : "pending", status);
}
for (const changes of ["step='verify'", "step='done', last_error='still failing'"]) {
  db.exec(`UPDATE code_tasks SET status='ready_to_publish', ${changes} WHERE id='${id}'`);
  assert.equal(db.prepare(probe).get().observed, "pending", "status alone is not verified completion");
}
for (const status of ["failed", "needs_human", "publish_failed"]) {
  db.prepare("UPDATE code_tasks SET status=?, step='propose', attempts=10, ctx='{}', updated_at='later', last_error=? WHERE id=?")
    .run(status, before.last_error, id);
  assert.equal(db.prepare(detector).get().observed, "1");
  const advanced = snapshot(db);
  db.exec(sql);
  assert.deepEqual(snapshot(db), advanced, "later failures cannot receive another reset");
}

for (const [changes, issue] of [
  [{ status: "queued" }], [{ status: "ready_to_publish" }], [{ step: "verify" }],
  [{ last_error: "different failure" }], [{ lease_until: "2999-01-01T00:00:00Z" }],
  [{ pr_url: "https://github.com/QNFO/qnfo-workers/pull/1" }],
  [{ path: "other/worker.js" }], [{ repo: "other" }], [{ id: "another-task" }],
  [{}, "closed"],
]) {
  const other = fixture(changes, issue), original = snapshot(other);
  other.exec(sql);
  // The new recurrence detector may be registered, but no existing work or issue is changed.
  assert.deepEqual(snapshot(other).slice(0, 2), original.slice(0, 2), JSON.stringify([changes, issue]));
  assert.deepEqual(contract(other), original[2][0]);
  assert.equal(other.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  other.close();
}

const restore = fixture(), original = task(restore), originalContract = contract(restore);
restore.exec(sql);
restore.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
assert.deepEqual(task(restore), original);
restore.exec(/^-- Rollback \(contract\): (.+)$/m.exec(sql)[1]);
assert.deepEqual(contract(restore), originalContract);
restore.close();
for (const changes of ["lease_until='2999-01-01T00:00:00Z'", "step='propose'", "attempts=1", "status='published'"]) {
  const advanced = fixture();
  advanced.exec(sql);
  advanced.exec(`UPDATE code_tasks SET ${changes} WHERE id='${id}'`);
  const progress = task(advanced);
  advanced.exec(/^-- Rollback: (.+)$/m.exec(sql)[1]);
  assert.deepEqual(task(advanced), progress, "rollback never overwrites progressed work");
  advanced.close();
}
db.close();
console.log("iPatent recovery: guarded fresh read, rollback, idempotency and evidence probes passed");
