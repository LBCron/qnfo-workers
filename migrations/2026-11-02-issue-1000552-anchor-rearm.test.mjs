import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-issue-1000552-anchor-rearm.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../qnfo-fleet-control/worker.js", import.meta.url), "utf8");
const anchor = "async function breachDoctorTick(env, opts) {";
const marker = "ISSUE-AGE-ANCHOR-REARM-1";
const taskLine = "code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js";
const anchorLine = "code-anchor: " + anchor;
const suffix = "\n\n" + marker + "\n" + taskLine + "\n" + anchorLine;
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];
assert.ok(rollback, "migration has a rollback");
assert.equal(worker.split(anchor).length - 1, 1, "the code anchor is unique in the worker");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, status TEXT, updated_at INTEGER, breach INTEGER);
  CREATE TABLE issue_age_actions (issue_id INTEGER, rung TEXT, blocker TEXT);
  CREATE TABLE issue_plans (issue_id INTEGER PRIMARY KEY, planned_at TEXT, outcome TEXT, detail TEXT, task_id TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  CREATE VIEW v_issue_age_ladder AS SELECT id, CASE WHEN status = 'open' THEN breach ELSE 0 END AS breach FROM agent_issues;
`);
db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, ?, 'open', 1, 1)").run(
  1000552,
  "METRIC-TRIGGER-14604-DOCTOR-ACTIONS-FAILED-24H: A doctor action failed or was reverted",
  "Metric trigger description",
  "qnfo-fleet-control"
);
db.prepare("INSERT INTO issue_age_actions VALUES (1000552, '24h', 'no live task, claim or progressing diagnosis')").run();
db.prepare("INSERT INTO issue_plans VALUES (1000552, '2026-11-02T15:21:15Z', 'retry', ?, NULL)").run(
  "ISSUE-AGE-24H-1 re-plan: anchor is not one verbatim, unique line of qnfo-fleet-control/worker.js: await d1Run(...)"
);
db.prepare("INSERT INTO agent_issues VALUES (1000553, 'unrelated', 'unchanged', 'qnfo-fleet-control', 'open', 1, 1)").run();
db.prepare("INSERT INTO issue_age_actions VALUES (1000553, '24h', 'another blocker')").run();
db.prepare("INSERT INTO issue_plans VALUES (1000553, '2026-11-02T15:00:00Z', 'invalid', 'different issue', NULL)").run();

const snapshot = () => JSON.stringify({
  issue: db.prepare("SELECT * FROM agent_issues WHERE id = 1000552").get(),
  plan: db.prepare("SELECT * FROM issue_plans WHERE issue_id = 1000552").get(),
  backup: db.prepare("SELECT * FROM bak_20261102_issue_1000552_anchor_rearm").all(),
  decisions: db.prepare("SELECT * FROM decision_log").all(),
});

db.exec(migration);
const changedIssue = db.prepare("SELECT * FROM agent_issues WHERE id = 1000552").get();
const changedPlan = db.prepare("SELECT * FROM issue_plans WHERE issue_id = 1000552").get();
assert.equal(changedIssue.description, "Metric trigger description" + suffix);
assert.equal(changedIssue.status, "open", "the original issue stays open");
assert.equal(changedPlan.outcome, "retry", "retry still uses the planner");
assert.equal(changedPlan.planned_at, "2000-01-01T00:00:00Z", "the retry is immediately eligible for planner intake");
assert.equal(changedPlan.task_id, null, "the migration does not create a code task");
assert.equal(db.prepare("SELECT blocker FROM issue_age_actions WHERE issue_id = 1000552 AND rung = '24h'").get().blocker,
  "no live task, claim or progressing diagnosis", "the recorded blocker is retained");
assert.equal(db.prepare("SELECT description FROM agent_issues WHERE id = 1000553").get().description,
  "unchanged", "unrelated issues are untouched");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
const first = snapshot();
db.exec(migration);
assert.equal(snapshot(), first, "reapplying the migration is idempotent");

db.exec(rollback);
assert.equal(db.prepare("SELECT description FROM agent_issues WHERE id = 1000552").get().description,
  "Metric trigger description", "rollback restores the original description");
assert.deepEqual({ ...db.prepare("SELECT outcome, planned_at FROM issue_plans WHERE issue_id = 1000552").get() },
  { outcome: "retry", planned_at: "2026-11-02T15:21:15Z" }, "rollback restores the original retry state");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "the decision log remains append-only");

console.log("issue-1000552-anchor-rearm: passed");
db.close();
