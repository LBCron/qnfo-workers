// Run: node migrations/research-budget-task-recovery.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-02-research-budget-task-recovery.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-research-exec/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const rollback = /^-- Rollback: (.+)$/m.exec(sql)[1];
const id = "ct_qboaksz1tgbkmj";
const marker = "RESEARCH-BUDGET-TASK-RECOVERY-1";
const query = (db, text, ...args) => db.prepare(text).get(...args);
const task = (db) => query(db, "SELECT * FROM code_tasks WHERE id=?", id);
const contract = (db) => query(db, "SELECT * FROM remediation_contracts");

function world(changes = {}, issueStatus = "open", multiFile = "on") {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT,
      attempts INTEGER, model TEXT, ctx TEXT, last_error TEXT, lease_until TEXT, pr_url TEXT, merged_at TEXT, updated_at TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT,
      verify_probe TEXT, verify_transport TEXT, module TEXT, status TEXT, attempts INTEGER, last_verdict TEXT,
      last_attempt_at TEXT, deferred_since TEXT, next_due_at TEXT, expected_cadence_h INTEGER);
    CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT,
      blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    INSERT INTO agent_issues VALUES (1000995, 'open'), (100226, 'open');
    INSERT INTO ops_config VALUES ('research_daily_neurons', '360000');
    INSERT INTO remediation_contracts VALUES ('issue-1000995', 1000995, 'ISSUE-PROBE-AGENT-1', 'monitoring',
      'SELECT 1 AS expected, 0 AS observed', 'd1-query', 'probe-template-v2d-loop', 'active', 3, 'fail', 'old', NULL, 'old', 1);
  `);
  const row = {
    id, repo: "qnfo-workers", path: "qnfo-research-exec/worker.js", goal: "[issue #100226] old conflicting levers",
    status: "failed", step: "propose", attempts: 9, model: "old-model",
    ctx: JSON.stringify({ anchor: "old", patch: "stale", sigs: ["budget"], repair_round: 3,
      extras: Array(3).fill({ path: "qnfo-research-exec/cost-first.test.mjs" }) }),
    last_error: "PUBLISH-SUITE-CHECK-1: FAIL budget-gate.test.mjs", lease_until: null,
    pr_url: null, merged_at: null, updated_at: "old", ...changes,
  };
  db.prepare(`INSERT INTO code_tasks (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
  db.prepare("UPDATE agent_issues SET status=? WHERE id=1000995").run(issueStatus);
  db.prepare("INSERT INTO ops_config VALUES ('code_merge_multi_file', ?)").run(multiFile);
  return db;
}

assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(?:DELETE\s+FROM|DROP\s+(?:TABLE|TRIGGER))\b/i);

const db = world();
const beforeTask = task(db);
const beforeContract = contract(db);
db.exec(sql);
const recovered = task(db);
assert.equal(recovered.status, "queued");
assert.equal(recovered.step, "read");
assert.equal(recovered.attempts, 0);
assert.equal(recovered.last_error, null);
assert.equal(recovered.lease_until, null);
assert.equal(recovered.model, null);
assert.match(recovered.goal, /^\[issue #100226\] RESEARCH-BUDGET-TASK-RECOVERY-1:/);
assert.ok(recovered.goal.length <= 6000);
assert.match(recovered.goal, /explicit mk\(360000/);
assert.match(recovered.goal, /119999 and 120000/);
assert.match(recovered.goal, /UPDATE only ops_config research_daily_neurons from 360000 to 120000/);
const ctx = JSON.parse(recovered.ctx);
assert.deepEqual(Object.keys(ctx).sort(), ["anchor", "extras"]);
assert.equal(source.split(ctx.anchor).length - 1, 1, "fresh function anchor occurs exactly once");
assert.deepEqual(ctx.extras, [
  { path: "qnfo-research-exec/budget-gate.test.mjs" },
  { path: "migrations/2026-11-02-research-daily-neuron-target.sql" },
]);
assert.equal(query(db, "SELECT value FROM ops_config WHERE key='research_daily_neurons'").value, "360000", "requeue does not apply the future budget change");
assert.deepEqual(db.prepare("SELECT status FROM agent_issues ORDER BY id").all().map((r) => r.status), ["open", "open"]);
assert.equal(contract(db).module, "research-budget-task-recovery-v1");
assert.equal(contract(db).attempts, 0);
assert.notEqual(contract(db).next_due_at, "old");

const probe = contract(db).verify_probe;
for (const status of ["queued", "read", "propose", "verify", "failed", "publish_failed", "superseded"]) {
  db.prepare("UPDATE code_tasks SET status=? WHERE id=?").run(status, id);
  assert.equal(query(db, probe).observed, 0, `${status} is not evidence of recovery`);
}
for (const status of ["ready_to_publish", "branch_pushed", "published", "pr_open", "merged"]) {
  db.prepare("UPDATE code_tasks SET status=? WHERE id=?").run(status, id);
  assert.deepEqual({ ...query(db, probe) }, { expected: 1, observed: 1 }, `${status} meets this issue's DoD`);
}
db.prepare("UPDATE code_tasks SET status='queued' WHERE id=?").run(id);
db.prepare("INSERT INTO code_tasks (id,status) VALUES ('unrelated','merged')").run();
assert.equal(query(db, probe).observed, 0, "another task cannot satisfy this task's recovery probe");
const snap = () => JSON.stringify([task(db), contract(db), db.prepare("SELECT * FROM decision_log").all()]);
const first = snap();
db.exec(sql);
assert.equal(snap(), first, "replay changes neither task, contract nor decision log");
db.exec(rollback);
assert.deepEqual(task(db), beforeTask);
assert.deepEqual(contract(db), beforeContract);
assert.equal(query(db, "SELECT count(*) n FROM decision_log").n, 1, "rollback preserves the append-only decision");

for (const changes of [
  { status: "queued" }, { status: "ready_to_publish" }, { status: "merged" },
  { lease_until: "2999-01-01T00:00:00Z" }, { lease_until: "unreadable" },
  { pr_url: "https://github.com/QNFO/qnfo-workers/pull/1" }, { merged_at: "2026-11-01" },
  { last_error: "different failure" }, { repo: "other" }, { path: "other/worker.js" },
  { goal: marker },
]) {
  const w = world(changes);
  const original = [task(w), contract(w)];
  w.exec(sql);
  assert.deepEqual([task(w), contract(w)], original, `do not reset advanced, leased or unrelated work: ${JSON.stringify(changes)}`);
  assert.equal(query(w, "SELECT count(*) n FROM decision_log").n, 0);
  w.close();
}
for (const [status, flag] of [["closed", "on"], ["open", "off"]]) {
  const w = world({}, status, flag);
  const original = task(w);
  w.exec(sql);
  assert.deepEqual(task(w), original, "closed issue or disabled multi-file support is not requeued");
  w.close();
}
const expired = world({ lease_until: "2020-01-01T00:00:00Z" });
expired.exec(sql);
assert.equal(task(expired).status, "queued", "an expired lease does not strand a failed task");
expired.prepare("UPDATE code_tasks SET status='failed' WHERE id=?").run(id);
expired.exec(sql);
assert.equal(task(expired).status, "failed", "replay never grants another retry to a recovered task that failed again");
for (const changes of [
  { status: "read", lease_until: "2999-01-01T00:00:00Z" },
  { status: "ready_to_publish", lease_until: null },
]) {
  const w = world();
  w.exec(sql);
  w.prepare("UPDATE code_tasks SET status=?, lease_until=? WHERE id=?").run(changes.status, changes.lease_until, id);
  const original = [task(w), contract(w)];
  w.exec(rollback);
  assert.deepEqual([task(w), contract(w)], original, "rollback never rewinds active or verified work or its recovery probe");
  w.close();
}
const missing = world();
missing.prepare("DELETE FROM code_tasks WHERE id=?").run(id);
missing.exec(sql);
assert.equal(contract(missing).module, "probe-template-v2d-loop", "missing task is not fabricated or closed");
console.log("research-budget-task-recovery: all assertions passed, 0 failed");
