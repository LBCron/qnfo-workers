import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-03-web-search-task-recovery.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-ops/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const id = "ct_q3lctlj7ozkdsn";
const marker = "WEB-SEARCH-TASK-RECOVERY-1";
const task = (db) => db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const contract = (db) => db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1001410'").get();
const snapshot = (db) => ["code_tasks", "agent_issues", "remediation_contracts", "failure_modes", "decision_log"]
  .map((table) => db.prepare(`SELECT * FROM ${table}`).all());

function fixture(changes = {}, issue = "open", root = "open") {
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
    INSERT INTO remediation_contracts (class, issue_id, action, verify_probe, status, module, attempts, last_verdict)
      VALUES ('issue-1001410', 1001410, 'old monitoring action', 'old broad probe', 'active', 'probe-template-v2d-loop', 9, 'fail'),
             ('issue-1000810', 1000810, 'runtime probe', 'forced fallback', 'active', 'root', 0, NULL);
  `);
  db.prepare("INSERT INTO agent_issues VALUES (1001410, ?), (1000810, ?)").run(issue, root);
  const original = {
    id, repo: "qnfo-workers", path: "qnfo-ops/worker.js", goal: "[issue #1000810] old fallback goal",
    status: "queued", step: "commit", attempts: 1, model: "old-model",
    ctx: JSON.stringify({ mode: "patch", anchor: "old anchor", base: "stale source",
      edits: [1], lastError: "patch too large: exceeds verification limit", sigs: ["patch too large"] }),
    branch: null, pr_url: null, last_error: null, lease_until: null, updated_at: "2026-11-03T04:18:54.414Z",
    ...changes,
  };
  db.prepare(`INSERT INTO code_tasks (${Object.keys(original).join(",")}) VALUES (${Object.keys(original).map(() => "?").join(",")})`)
    .run(...Object.values(original));
  db.exec(`INSERT INTO code_tasks SELECT 'ct_x2hh0z7m4z7svk', repo, path, goal, 'failed', 'propose',
    3, model, ctx, branch, pr_url, 'patch too large: exceeds verification limit', NULL, updated_at FROM code_tasks`);
  return db;
}

assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
const db = fixture(), before = task(db), beforeContract = contract(db);
const originalTask = db.prepare("SELECT * FROM code_tasks WHERE id='ct_x2hh0z7m4z7svk'").get();
const rootContract = db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1000810'").get();
db.exec(sql);
const recovered = task(db), ctx = JSON.parse(recovered.ctx);
assert.equal(recovered.status, "queued");
assert.equal(recovered.step, "read");
assert.equal(recovered.attempts, 0);
for (const key of ["model", "last_error", "branch", "pr_url", "lease_until"]) assert.equal(recovered[key], null, key);
assert.deepEqual(ctx, { anchor: "async function webSearchTool(env, args) {", recovery: marker });
assert.equal(source.split(ctx.anchor).length, 2, "fresh source has a unique function anchor");
assert.match(recovered.goal, /^\[issue #1000810\]/);
assert.ok(recovered.goal.length < 6000);
for (const text of ["encodeURIComponent(q)", "never reassign results", "at most k", "result-link",
  "ok:false", "path:fallback", "80000-character", "Do not edit VERSION", "live forced-fallback probe"]) {
  assert.ok(recovered.goal.includes(text), text);
}
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_web_search_task").get(), before);
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_web_search_contract").get(), beforeContract);
assert.deepEqual(db.prepare("SELECT * FROM code_tasks WHERE id='ct_x2hh0z7m4z7svk'").get(), originalTask,
  "never requeue the failed original alongside its replacement");
assert.deepEqual(db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1000810'").get(), rootContract);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status='open'").get().n, 2);
assert.equal(contract(db).attempts, 0);
assert.equal(contract(db).last_verdict, null);
assert.ok(contract(db).next_due_at);
const once = snapshot(db);
db.exec(sql);
assert.deepEqual(snapshot(db), once, "replay does not reset progress or duplicate decisions");
const probe = contract(db).verify_probe;
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='fm-web-search-stale-patch'").get().verify_probe;
assert.equal(db.prepare(probe).get().observed, "pending", "requeue is not completion evidence");
assert.equal(db.prepare(detector).get().observed, "0", "the failed original does not fail the replacement detector");
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
  db.prepare("UPDATE code_tasks SET status=?, step='commit', ctx=?, updated_at='later' WHERE id=?")
    .run(status, before.ctx, id);
  assert.equal(db.prepare(detector).get().observed, "1", status + " is detected even if recovery context is lost");
  const advanced = snapshot(db);
  db.exec(sql);
  assert.deepEqual(snapshot(db), advanced, "recurrence never receives another retry");
}

for (const [changes, issue, root] of [
  [{ status: "failed" }], [{ status: "ready_to_publish" }], [{ step: "verify" }],
  [{ ctx: "{}" }], [{ goal: "[issue #other] different goal" }],
  [{ lease_until: "2999-01-01T00:00:00Z" }], [{ branch: "already-publishing" }],
  [{ pr_url: "https://github.com/QNFO/qnfo-workers/pull/1" }],
  [{ path: "other/worker.js" }], [{ repo: "other" }], [{ id: "another-task" }],
  [{}, "closed"], [{}, "open", "closed"],
]) {
  const other = fixture(changes, issue, root), original = task(other), oldContract = contract(other);
  other.exec(sql);
  assert.deepEqual(task(other), original, `must not restart ${JSON.stringify([changes, issue, root])}`);
  assert.deepEqual(contract(other), oldContract, "ineligible tasks keep their completion contract");
  assert.equal(other.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  other.close();
}

// A changed snapshot between backup and UPDATE must not be overwritten.
const split = sql.indexOf("\nUPDATE code_tasks\n");
const raced = fixture();
raced.exec(sql.slice(0, split));
raced.exec(`UPDATE code_tasks SET ctx='{}' WHERE id='${id}'`);
const changed = task(raced);
raced.exec(sql.slice(split));
assert.deepEqual(task(raced), changed);
raced.close();

const rollback = /^-- Rollback: (.+)$/m.exec(sql)[1];
const restore = fixture(), restoreTask = task(restore), restoreContract = contract(restore);
restore.exec(sql);
restore.exec(rollback);
assert.deepEqual(task(restore), restoreTask, "rollback restores the exact unstarted task");
restore.exec(/^-- Rollback \(contract\): (.+)$/m.exec(sql)[1]);
assert.deepEqual(contract(restore), restoreContract);
assert.equal(restore.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 0);
restore.close();
for (const changes of ["lease_until='2999-01-01T00:00:00Z'", "step='propose'", "attempts=1", "status='published'", "branch='publishing'"]) {
  const advanced = fixture();
  advanced.exec(sql);
  advanced.exec(`UPDATE code_tasks SET ${changes} WHERE id='${id}'`);
  const progress = task(advanced);
  advanced.exec(rollback);
  assert.deepEqual(task(advanced), progress, "rollback never overwrites a leased or advanced task");
  advanced.close();
}
db.close();
console.log("Web-search recovery: existing replacement, guarded fresh read, bounded goal, rollback and evidence probes passed");
