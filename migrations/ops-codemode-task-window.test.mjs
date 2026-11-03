// OPS-CODEMODE-TASK-WINDOW-1: node migrations/ops-codemode-task-window.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const sql = readFileSync(new URL("./2026-11-03-ops-codemode-task-window.sql", import.meta.url), "utf8");
const source = readFileSync(new URL("../qnfo-ops/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const orch = readFileSync(new URL("../qnfo-code-orchestrator/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const id = "ct_r519athz3t8ysi";
const marker = "OPS-CODEMODE-TASK-WINDOW-1";
const oldAnchor = "var OPS_TOOLS = [";
const error = "model @cf/openai/gpt-oss-120b: edit 1: SEARCH text occurs 0 times in the shown content";
let pass = 0;
const ok = (condition, message) => { assert.ok(condition, message); pass++; };
const taskOf = (db) => db.prepare("SELECT * FROM code_tasks WHERE id = ?").get(id);
const snapshot = (db) => JSON.stringify(["code_tasks", "agent_issues", "remediation_contracts", "failure_modes", "decision_log"].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));

function world({ status = "failed", step = "propose", issue = "open", root = "open", lease = null, pr = null, lastError = error, anchor = oldAnchor, path = "qnfo-ops/worker.js", repo = "qnfo-workers" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT, status TEXT, step TEXT, attempts INTEGER, model TEXT, ctx TEXT, branch TEXT, pr_url TEXT, last_error TEXT, lease_until TEXT, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
  db.prepare("INSERT INTO code_tasks VALUES (?, ?, ?, '[issue #1000639] edit the catalogue and MCP handler', ?, ?, 9, 'old-model', ?, 'old-branch', ?, ?, ?, '2026-11-02T01:59:11Z')")
    .run(id, repo, path, status, step, JSON.stringify({ anchor, win: { ws: 147161, we: 171220 }, edits: ["stale"], lastError, sigs: ["same", "same", "same"], repair_round: 3 }), pr, lastError, lease);
  db.exec(`INSERT INTO code_tasks SELECT 'unrelated', repo, path, goal, status, step, attempts, model, ctx, branch, pr_url, last_error, lease_until, updated_at FROM code_tasks;
INSERT INTO remediation_contracts (class, issue_id, verify_probe, status, module) VALUES ('issue-1001269', 1001269, 'existing readiness probe', 'active', 'probe-template-v2d-loop');`);
  db.prepare("INSERT INTO agent_issues VALUES (1001269, ?)").run(issue);
  db.prepare("INSERT INTO agent_issues VALUES (1000639, ?)").run(root);
  return db;
}

const db = world();
const original = taskOf(db);
const other = db.prepare("SELECT * FROM code_tasks WHERE id = 'unrelated'").get();
const contract = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001269'").get();
db.exec(sql);
const task = taskOf(db);
ok(task.status === "queued" && task.step === "read" && task.attempts === 0, "one failed task gets a fresh read and attempt budget");
ok(task.model === null && task.branch === null && task.last_error === null && task.lease_until === null, "stale proposal metadata is cleared");
const ctx = JSON.parse(task.ctx);
assert.deepEqual(Object.keys(ctx), ["anchor"]); pass++;
ok(source.split(ctx.anchor).length === 2 && ctx.anchor.startsWith("async function "), "new anchor is a unique function signature");
ok(task.goal.startsWith("[issue #1000639]") && task.goal.length < 6000, "goal retains the root issue and fits the intake limit");
ok(task.goal.includes("ownerKeyOk") && task.goal.includes("reject a name not in opsRestToolList(true)") && task.goal.includes("run(name, args) unchanged"), "goal retains authentication, allowlisting and execution gates");
ok(task.goal.includes("byte-for-byte unchanged") && task.goal.includes("Do not edit VERSION") && task.goal.includes("Existing suites must pass"), "goal preserves default behavior, versioning and verification");
ok(task.goal.includes("20-task evaluation") && task.goal.includes("ready_to_publish or later"), "requeue is not either issue's completion evidence");
assert.deepEqual(db.prepare("SELECT * FROM code_tasks WHERE id = 'unrelated'").get(), other); pass++;
assert.deepEqual(db.prepare("SELECT * FROM bak_20261103_ops_codemode_task").get(), original); pass++;
assert.deepEqual(db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001269'").get(), contract); pass++;
ok(db.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE status = 'open'").get().n === 2, "existing evidence-only completion contracts keep both issues open");

// Use the actual window selector: the old goal spans distant regions; the new one does not.
const windowChars = /const WINDOW_CHARS = (\d+);/.exec(orch)[1];
const windowStart = orch.indexOf("const WINDOW_ALIGN_SLACK = ");
const windowCode = orch.slice(windowStart, orch.indexOf("// WINDOW-RELOCATE-1", windowStart));
const windowFor = new Function(`const WINDOW_CHARS = ${windowChars};\n${windowCode}\nreturn windowFor;`)();
const oldWin = windowFor(source, oldAnchor), newWin = windowFor(source, ctx.anchor);
const oldView = source.slice(oldWin.ws, oldWin.we), view = source.slice(newWin.ws, newWin.we);
ok(!oldView.includes("\n];") && !oldView.includes(ctx.anchor), "original window cannot show the catalogue terminator or MCP handler");
for (const text of ["function opsRestToolList(full) {", "ownerKeyOk(env, hdr)", "const run = async function(name, args) {", 'm.method === "tools/list"', 'm.method === "tools/call"']) {
  ok(view.includes(text), "new window includes " + text);
}
ok(!view.includes(oldAnchor), "new goal uses the accessor, not a catalogue edit outside the window");

const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-ops-codemode-task-window'").get().verify_probe;
ok(db.prepare(detector).get().observed === "0", "a queued retry is not reported as recurrence");
const beforeReplay = snapshot(db);
db.exec(sql);
ok(snapshot(db) === beforeReplay, "replay is idempotent while queued");
db.prepare("UPDATE code_tasks SET status = 'failed', step = 'propose', attempts = 9, last_error = ? WHERE id = ?").run(error, id);
ok(db.prepare(detector).get().observed === "1", "the detector catches failure of the narrowed retry");
const failedAgain = snapshot(db);
db.exec(sql);
ok(snapshot(db) === failedAgain, "a second failure never resets its budget again");
for (const status of ["needs_human", "publish_failed"]) {
  db.prepare("UPDATE code_tasks SET status = ? WHERE id = ?").run(status, id);
  ok(db.prepare(detector).get().observed === "1", status + " is also detected");
}
for (const opts of [{ status: "queued" }, { status: "merged" }, { step: "verify" }, { issue: "closed" }, { root: "closed" }, { lease: "2099-01-01" }, { pr: "existing-pr" }, { lastError: "unrelated failure" }, { anchor: "another anchor" }, { path: "other/worker.js" }, { repo: "other" }]) {
  const guarded = world(opts), before = taskOf(guarded);
  guarded.exec(sql);
  assert.deepEqual(taskOf(guarded), before); pass++;
  ok(guarded.prepare("SELECT COUNT(*) AS n FROM bak_20261103_ops_codemode_task").get().n === 0, "ineligible task is not backed up for recovery");
}

const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];
const restored = world();
restored.exec(sql);
restored.exec(rollback);
assert.deepEqual(taskOf(restored), original); pass++;
restored.exec(sql);
ok(taskOf(restored).status === "queued", "recovery can be reapplied after rollback");
for (const advance of ["lease_until = '2099-01-01'", "step = 'propose'", "attempts = 1", "status = 'ready_to_publish'", "pr_url = 'existing-pr'"]) {
  const running = world();
  running.exec(sql);
  running.exec("UPDATE code_tasks SET " + advance + " WHERE id = '" + id + "'");
  const before = taskOf(running);
  running.exec(rollback);
  assert.deepEqual(taskOf(running), before); pass++;
}
console.log(pass + " passed, 0 failed");
