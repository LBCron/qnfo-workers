import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-03-codemode-patch-recovery.sql", import.meta.url), "utf8");
const task = "ct_zh51q9gmwza5gw";
const error = "patch too large: exceeds verification limit [FAIL-SIGNATURE-STOP-1]";
function fixture(status = "failed", lastError = error, lease = null, path = "qnfo-ops/worker.js") {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo, path, status, step, attempts,
      ctx, last_error, lease_until, updated_at);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode, root_cause,
      remediation, detector, probe_class, first_seen, issue_id);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id, precondition,
      action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status);
    INSERT INTO remediation_contracts (class, issue_id) VALUES ('issue-1001341', 1001341);
  `);
  db.prepare("INSERT INTO code_tasks VALUES (?, 'qnfo-workers', ?, ?, 'propose', 3, ?, ?, ?, '2026-11-02T16:24:49Z')")
    .run(task, path, status, JSON.stringify({ anchor: "var OPS_TOOLS = [", base: "stale source", edits: [1], sig_n: 3 }), lastError, lease);
  db.exec("INSERT INTO code_tasks SELECT 'unrelated', repo, path, status, step, attempts, ctx, last_error, lease_until, updated_at FROM code_tasks");
  return db;
}
const row = (db, id = task) => db.prepare("SELECT * FROM code_tasks WHERE id = ?").get(id);
const db = fixture(), before = row(db), unrelated = row(db, "unrelated");
db.exec(sql);
const recovered = row(db);
assert.equal(recovered.status, "queued");
assert.equal(recovered.step, "read");
assert.equal(recovered.attempts, 0);
assert.equal(recovered.lease_until, null);
assert.equal(recovered.last_error, null);
assert.deepEqual(JSON.parse(recovered.ctx), { anchor: "var OPS_TOOLS = [", recovery: "CODEMODE-PATCH-RECOVERY-1" });
assert.deepEqual(row(db, "unrelated"), unrelated);
assert.deepEqual({ ...db.prepare("SELECT * FROM bak_20261103_codemode_patch").get() },
  Object.fromEntries(["id", "status", "step", "attempts", "ctx", "last_error", "lease_until", "updated_at"].map((key) => [key, before[key]])));
db.exec(sql);
assert.deepEqual(row(db), recovered, "reapplying must not reset progress");
db.prepare("UPDATE code_tasks SET status = 'failed', ctx = '{}', last_error = ?, updated_at = '2026-11-03T10:00:00Z' WHERE id = ?").run(error, task);
const advanced = row(db);
db.exec(sql);
assert.deepEqual(row(db), advanced, "do not requeue a newer failure using the old backup");
db.prepare("UPDATE code_tasks SET ctx = ? WHERE id = ?").run(recovered.ctx, task);

const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1001341'").get().verify_probe;
for (const status of ["queued", "failed", "needs_human", "superseded", "ready_to_publish", "publishing", "pr_open", "merged", "deployed"]) {
  db.prepare("UPDATE code_tasks SET status = ? WHERE id = ?").run(status, task);
  assert.equal(db.prepare(probe).get().observed,
    ["ready_to_publish", "publishing", "pr_open", "merged", "deployed"].includes(status) ? "1" : "0", status);
}
for (const args of [
  ["ready_to_publish"], ["queued"], ["failed", "different failure"],
  ["failed", error, "2999-01-01T00:00:00Z"], ["failed", error, null, "other/worker.js"]
]) {
  const other = fixture(...args), original = row(other);
  other.exec(sql);
  assert.deepEqual(row(other), original, `must not restart ${JSON.stringify(args)}`);
  other.close();
}
const rollback = /^-- Rollback: (.+)$/m.exec(sql)[1];
db.prepare("UPDATE code_tasks SET status = 'queued' WHERE id = ?").run(task);
db.exec(rollback);
assert.deepEqual(row(db), before, "rollback restores the task exactly before it starts");
db.exec(/^-- Rollback \(contract\): (.+)$/m.exec(sql)[1]);
assert.equal(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1001341'").get().verify_probe, null);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 0);
db.close();
console.log("Codemode patch recovery: guarded requeue, backup, idempotency, rollback and outcome probe passed");
