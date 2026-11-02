import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-issue-1000598-planner-first-step.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
const marker = "code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js";
const anchor = "code-anchor: async function ipatentUsage(env) {";
const originalDescription = `qnfo-youtube-shorts/wrangler.toml names qnfo-ipatent as the same-class retirement.
CLUSTER-E-C 2026-10-28: issue 1000598 owns this project work. Step order: first drop the dashboard binding and tile, then move qnfo-ops data, then retire qnfo-ipatent after a D1 backup.`;

assert.ok(rollback, "migration has a rollback");
const dashboard = readFileSync(new URL("../qnfo-fleet-dashboard/worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.equal(dashboard.split("async function ipatentUsage(env) {").length - 1, 1, "the code anchor is unique in its target");

function database({ status = "open", ageAction = true, plan = true, task = null, claim = false, diagnosis = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, description TEXT);
    CREATE TABLE issue_age_actions (issue_id INTEGER, rung TEXT, blocker TEXT);
    CREATE TABLE issue_plans (issue_id INTEGER PRIMARY KEY, outcome TEXT, planned_at TEXT, task_id TEXT, path TEXT, detail TEXT);
    CREATE TABLE code_tasks (id TEXT, goal TEXT, status TEXT, updated_at TEXT, lease_until TEXT);
    CREATE TABLE work_claims (issue_id INTEGER, path TEXT, released_at TEXT, expires_at TEXT);
    CREATE TABLE breach_diagnoses (issue_id INTEGER, mode TEXT, state TEXT, action_ref TEXT, action_kind TEXT, lease_until TEXT, last_progress_at TEXT);
    CREATE TABLE decision_log (
      actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
      rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
  `);
  db.prepare("INSERT INTO agent_issues VALUES (1000598, ?, ?, ?)").run(
    "NET-ZERO-1: retire qnfo-ipatent to fund qnfo-youtube-shorts (same class, reach)",
    status,
    originalDescription,
  );
  if (ageAction) db.prepare("INSERT INTO issue_age_actions VALUES (1000598, '24h', 'no live task, claim or progressing diagnosis')").run();
  if (plan) db.prepare("INSERT INTO issue_plans VALUES (1000598, 'retry', '2000-01-01T00:00:00Z', NULL, 'qnfo-ipatent/worker.js', 'ISSUE-AGE-24H-1 re-plan: cannot be resolved by a single code edit within worker.js')").run();
  if (task) db.prepare("INSERT INTO code_tasks VALUES (?, '[issue #1000598] prior task', ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL)").run(task.id || "ct_other", task.status);
  if (claim) db.prepare("INSERT INTO work_claims VALUES (1000598, 'issue:1000598', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+60 minutes'))").run();
  if (diagnosis) db.prepare("INSERT INTO breach_diagnoses VALUES (1000598, 'on', 'applied', 'action', 'sql', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+60 minutes'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))").run();
  return db;
}

function apply(db) {
  db.exec(migration);
}

{
  const db = database({ task: { status: "failed" } });
  apply(db);
  const issue = () => db.prepare("SELECT status, description FROM agent_issues WHERE id = 1000598").get();
  const plan = () => db.prepare("SELECT * FROM issue_plans WHERE issue_id = 1000598").get();
  const updated = issue();
  assert.equal(updated.status, "open", "the original issue stays open");
  assert.ok(updated.description.startsWith("NEXT EXECUTABLE STEP:"), "the first ordered code step is promoted for planner review");
  assert.equal(updated.description.split(marker).length - 1, 1, "the trusted code-task marker is added once");
  assert.equal(updated.description.split(anchor).length - 1, 1, "the unique source anchor is included once");
  assert.ok(updated.description.endsWith(originalDescription), "the original dependency and retirement plan is preserved");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM code_tasks").get().n, 1, "the migration does not bypass planner intake by creating a task");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM work_claims").get().n, 0, "the migration does not create or alter claims");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM breach_diagnoses").get().n, 0, "the migration does not create a diagnosis");
  assert.equal(plan().outcome, "retry", "the planner's prior verdict is unchanged");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
  const before = JSON.stringify({
    issue: issue(),
    plan: plan(),
    tasks: db.prepare("SELECT * FROM code_tasks ORDER BY id").all(),
    claims: db.prepare("SELECT * FROM work_claims").all(),
    diagnoses: db.prepare("SELECT * FROM breach_diagnoses").all(),
    decisions: db.prepare("SELECT * FROM decision_log").all(),
  });
  apply(db);
  assert.equal(JSON.stringify({
    issue: issue(),
    plan: plan(),
    tasks: db.prepare("SELECT * FROM code_tasks ORDER BY id").all(),
    claims: db.prepare("SELECT * FROM work_claims").all(),
    diagnoses: db.prepare("SELECT * FROM breach_diagnoses").all(),
    decisions: db.prepare("SELECT * FROM decision_log").all(),
  }), before, "reapplying the migration is idempotent");
  for (const statement of rollback.split(/;\s*/).filter(Boolean)) db.exec(statement);
  assert.equal(issue().status, "open", "rollback leaves the original issue open");
  assert.equal(issue().description, originalDescription, "rollback restores the exact issue description");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "rollback preserves the append-only decision");
  db.close();
}

for (const options of [
  { status: "closed" },
  { ageAction: false },
  { plan: false },
  { task: { id: "ct_im1000598", status: "editing" } },
  { claim: true },
  { diagnosis: true },
]) {
  const db = database(options);
  apply(db);
  assert.equal(db.prepare("SELECT description FROM agent_issues WHERE id = 1000598").get().description, originalDescription, JSON.stringify(options));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, JSON.stringify(options));
  db.close();
}

console.log("issue-1000598-planner-first-step: all passed");
