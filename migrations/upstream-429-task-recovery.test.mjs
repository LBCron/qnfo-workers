import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const sql = readFileSync(new URL("./2026-11-03-upstream-429-task-recovery.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-ops/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const id = "ct_dk7c7rkpv4i7kb";
const error = "patch too large: exceeds verification limit [FAIL-SIGNATURE-STOP-1]";
const anchor = "async function opsUpstreamError(env, status, where, model, detail) {";
const task = (db) => db.prepare("SELECT * FROM code_tasks WHERE id=?").get(id);
const contract = (db) => db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1001418'").get();
const snapshot = (db) => ["code_tasks", "agent_issues", "remediation_contracts", "failure_modes", "decision_log"]
  .map((table) => db.prepare(`SELECT * FROM ${table}`).all());

function fixture(changes = {}, issue = "open", originalIssue = "open") {
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
      VALUES ('issue-1001418', 1001418, 'old monitoring action', 'old probe', 'monitoring', 'probe-template-v2d-loop', 27, 'fail');
    INSERT INTO remediation_contracts (class, issue_id, verify_probe) VALUES ('issue-1000739', 1000739, 'live 429 probe');
  `);
  db.prepare("INSERT INTO agent_issues VALUES (1001418, ?)").run(issue);
  db.prepare("INSERT INTO agent_issues VALUES (1000739, ?)").run(originalIssue);
  const original = {
    id, repo: "qnfo-workers", path: "qnfo-ops/worker.js", goal: "[issue #1000739] OPS-UPSTREAM-429-HANDLED-1: preserve non-429 errors",
    status: "failed", step: "propose", attempts: 3, model: "last-rung",
    ctx: JSON.stringify({ mode: "patch", anchor: "old SQL anchor", base: "stale source", edits: [1],
      sigs: ["patch too large"], sig_n: 3, claim: { token: "expired-fixture" } }),
    branch: null, pr_url: null, last_error: error, lease_until: null, updated_at: "2026-11-03T03:52:45.686Z",
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
const liveContract = db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1000739'").get();
db.exec(sql);
const recovered = task(db);
assert.equal(recovered.status, "queued");
assert.equal(recovered.step, "read");
assert.equal(recovered.attempts, 0);
for (const key of ["model", "branch", "last_error", "lease_until"]) assert.equal(recovered[key], null, key);
assert.equal(recovered.goal, before.goal, "keep the precise one-line implementation goal");
assert.deepEqual(JSON.parse(recovered.ctx), { anchor, recovery: "UPSTREAM-429-TASK-RECOVERY-1" });
assert.equal(source.split(anchor).length, 2, "fresh source contains exactly one function anchor");
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_upstream_429_task").get(), before);
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_upstream_429_contract").get(), beforeContract);
assert.deepEqual(db.prepare("SELECT * FROM code_tasks WHERE id='unrelated'").get(), unrelated);
assert.deepEqual(db.prepare("SELECT * FROM remediation_contracts WHERE class='issue-1000739'").get(), liveContract);
assert.equal(contract(db).status, "active");
assert.equal(contract(db).attempts, 0);
assert.equal(contract(db).last_verdict, null);
assert.ok(contract(db).next_due_at);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status='open'").get().n, 2);

const once = snapshot(db);
db.exec(sql);
assert.deepEqual(snapshot(db), once, "reapplying neither resets progress nor duplicates decisions");
const probe = contract(db).verify_probe;
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='fm-upstream-429-stale-patch'").get().verify_probe;
assert.equal(db.prepare(detector).get().observed, "0");
for (const status of ["queued", "failed", "needs_human", "publish_failed", "closed", "superseded",
  "ready_to_publish", "publishing", "published", "pr_open", "merged", "deployed"]) {
  db.prepare("UPDATE code_tasks SET status=?, step='done', last_error=NULL WHERE id=?").run(status, id);
  assert.equal(db.prepare(probe).get().observed,
    ["ready_to_publish", "publishing", "published", "pr_open", "merged", "deployed"].includes(status) ? "ready" : "pending", status);
}
for (const changes of ["step='verify'", "step='done', last_error='still failing'"]) {
  db.exec(`UPDATE code_tasks SET status='ready_to_publish', ${changes} WHERE id='${id}'`);
  assert.equal(db.prepare(probe).get().observed, "pending", "status alone is not verified readiness");
}
for (const status of ["failed", "needs_human", "publish_failed"]) {
  db.prepare("UPDATE code_tasks SET status=?, step='propose', attempts=5, last_error=?, updated_at='later' WHERE id=?").run(status, error, id);
  assert.equal(db.prepare(detector).get().observed, "1", status + " is detected after recovery");
  const advanced = snapshot(db);
  db.exec(sql);
  assert.deepEqual(snapshot(db), advanced, "a later failure does not receive another reset");
}
db.close();

for (const [changes, issue, originalIssue] of [
  [{ status: "queued" }], [{ status: "ready_to_publish" }], [{ step: "verify" }],
  [{ last_error: "different failure" }], [{ lease_until: "2999-01-01T00:00:00Z" }],
  [{ branch: "codeagent-existing" }], [{ pr_url: "https://github.com/QNFO/qnfo-workers/pull/1" }],
  [{ path: "other/worker.js" }], [{ repo: "other" }], [{ id: "another-task" }],
  [{ goal: "[issue #99999] unrelated goal" }], [{ ctx: "{}" }],
  [{}, "closed"], [{}, "open", "closed"],
]) {
  const other = fixture(changes, issue, originalIssue), original = task(other), originalContract = contract(other);
  other.exec(sql);
  assert.deepEqual(task(other), original, `must not restart ${JSON.stringify([changes, issue, originalIssue])}`);
  assert.deepEqual(contract(other), originalContract, "ineligible tasks keep their completion contract");
  assert.equal(other.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0);
  other.close();
}

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
for (const changes of ["lease_until='2999-01-01T00:00:00Z'", "step='propose'", "attempts=1", "status='published'", "branch='new-branch'", "pr_url='https://example.test/pr'"]) {
  const advanced = fixture();
  advanced.exec(sql);
  advanced.exec(`UPDATE code_tasks SET ${changes} WHERE id='${id}'`);
  const progress = task(advanced);
  advanced.exec(rollback);
  assert.deepEqual(task(advanced), progress, "rollback never overwrites a leased or advanced task");
  advanced.close();
}

const orchestrator = readFileSync(new URL("../qnfo-code-orchestrator/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const a = orchestrator.indexOf(start), b = orchestrator.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source section ${start}`);
  return orchestrator.slice(a, b);
};
const { hunkPatch, bumpVersion, limit } = new Function(
  "const countOf = (text, needle) => text.split(needle).length - 1;\n" +
  section("const VERSION_DECL =", "// NOOP-PROPOSAL-GATE-1") +
  section("function wholeFilePatch(", "// SELF-REPAIR-1") +
  "const DIFF_MAX_D = " + /const DIFF_MAX_D = (\d+)/.exec(orchestrator)[1] + ";\n" +
  section("function lineOps(", "// REPAIR-SHOWS-EDITS-1") +
  "return {hunkPatch, bumpVersion, limit: " + /const MAX_PATCH_CHARS = (\d+)/.exec(orchestrator)[1] + "};"
)();
const search = 'await env.QNFO_AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, \'ops_upstream_error\', ?3, ?4, \'qnfo-ops\', \'error\')")';
const replace = 'await env.QNFO_AUDIT.prepare(`INSERT INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, \'${status === 429 ? "ops_upstream_throttle" : "ops_upstream_error"}\', ?3, ?4, \'qnfo-ops\', \'${status === 429 ? "info" : "error"}\')`)';
const base = source.includes(search) ? source :
  source + "\nasync function upstream429RecoveryFixture(env, status) {\n  " + search + ";\n}\n";
assert.equal(base.split(search).length, 2, "the failed task's exact SEARCH is unique in the regression fixture");
const proposal = (base) => bumpVersion(base, base.replace(search, replace));
const patchFor = (base) => ["worker.js", "deployed-current.worker.js"]
  .map((file) => hunkPatch("qnfo-ops/" + file, base, proposal(base))).join("");
const patch = patchFor(base);
assert.ok(patch.length <= limit, `fresh mirrored 429 patch fits ${limit} characters`);
const stale = base.replace(/^(var VERSION = "[^"]+";)\n((?:\/\*.*\*\/\n)+)/m,
  (_, version, notes) => version + " " + notes.trim().replace(/\n/g, " ") + "\n");
assert.notEqual(stale, base);
assert.ok(patchFor(stale).length > limit, "the cached same-line notes reproduce the task's size failure");
const work = mkdtempSync(join(tmpdir(), "upstream-429-recovery-"));
try {
  mkdirSync(join(work, "qnfo-ops"));
  for (const file of ["worker.js", "deployed-current.worker.js"]) writeFileSync(join(work, "qnfo-ops", file), base);
  execFileSync("git", ["apply", "-"], { cwd: work, input: patch });
  for (const file of ["worker.js", "deployed-current.worker.js"]) {
    assert.equal(readFileSync(join(work, "qnfo-ops", file), "utf8"), proposal(base));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Exact mirrored 429 edit: ${patch.length}/${limit} characters; git apply round-trip passed`);
console.log("Upstream-429 task recovery: fresh read, one-time guards, rollback and evidence probes passed");
