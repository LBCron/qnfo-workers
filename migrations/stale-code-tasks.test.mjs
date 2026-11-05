// TASK-ISSUE-CLOSED-1 offline suite: queued code tasks of closed issues are superseded once by the migration and hourly by the issue-meta-fold step; open issues,
// METRIC-TRIGGER issues and tasks that are not queued are left alone; the workflow step runs the same statement; a second run changes nothing.
// Run: node --no-warnings migrations/stale-code-tasks.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = rd("2026-11-05-stale-code-tasks.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, repo TEXT, path TEXT, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', last_error TEXT, updated_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT, repo_path TEXT, exported_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO agent_issues VALUES
  (1001629, 'CF-OBS-ISSUE-1: idea-hub: D1_ERROR: D1 DB is overloaded', 'closed'),
  (1001555, 'CRON-FAULT-1: worker-silent:qnfo-model-eval', 'closed'),
  (1001801, 'ROADMAP-1: QNFO.PERSONAL #2152: Group stretch matches', 'open'),
  (99916, 'METRIC-TRIGGER-2934-SESSION-DEPENDENT-ISSUES-OPEN: gap', 'closed'),
  (1001157, 'METRIC-TRIGGER-14423-CF-AGENT-REQUESTS-OVER-120M: x', 'closed'),
  (1001000, 'BREACH-DOCTOR-1: something', 'closed'),
  (1000792, 'PLUS-1 me.q08.org: empty-state card', 'resolved'),
  (1000500, 'WONT-1: no', 'wontfix'),
  (1000600, 'OPEN-1: still open', 'open');
INSERT INTO code_tasks (id, path, goal, status) VALUES
  ('ct_im1001629', 'idea-hub/worker.js', 'CF-OBS-ISSUE-1: idea-hub', 'queued'),
  ('ct_im1001555', 'qnfo-model-eval/worker.js', 'CRON-FAULT-1: worker-silent', 'queued'),
  ('ct_im1001801', 'qnfo-jobsearch/worker.js', 'ROADMAP-1: QNFO.PERSONAL #2152', 'queued'),
  ('ct_klrhftbqigkacf', 'personal-api/worker.js', '[issue #99916] [retry 1] METRIC-TRIGGER-2934-SESSION-DEPENDENT-ISSUES-OPEN: gap', 'queued'),
  ('ct_tkzsosgb6ovbwa', 'qnfo-agents/worker.js', '[issue #1001157] METRIC-TRIGGER-14423-CF-AGENT-REQUESTS-OVER-120M: x', 'queued'),
  ('ct_u9huz7zbg8aahu', 'personal-api/worker.js', '[issue #1000792] [retry 4] PLUS-1 me.q08.org: empty-state card', 'queued'),
  ('ct_im1001000', 'qnfo-x/worker.js', 'BREACH-DOCTOR-1: something', 'queued'),
  ('ct_im1000500', 'qnfo-y/worker.js', 'WONT-1', 'queued'),
  ('ct_im1000600', 'qnfo-z/worker.js', 'OPEN-1', 'queued'),
  ('ct_im1001629x', 'idea-hub/worker.js', 'done already', 'merged'),
  ('ct_other', 'scripts/a.py', 'a goal with no issue named', 'queued'),
  ('ct_im9999999', 'scripts/b.py', 'issue 9999999 does not exist', 'queued');
`);
// the workflow definition as issue-meta-fold has it: a list of sql steps
db.prepare("INSERT INTO fleet_tasks VALUES ('issue-meta-fold', ?, 7, 'x')").run(JSON.stringify({ steps: [{ type: "sql", db: "AUDIT", sql: "SELECT 1" }, { type: "sql", db: "AUDIT", sql: "SELECT 2" }] }));
db.prepare("INSERT INTO fleet_tasks_canonical VALUES ('issue-meta-fold', (SELECT definition FROM fleet_tasks WHERE id = 'issue-meta-fold'), 'migrations/old.sql', 'x')").run();

const st = (id) => db.prepare("SELECT status FROM code_tasks WHERE id = ?").get(id).status;
db.exec(sql);

ok(st("ct_im1001629") === "superseded" && st("ct_im1001555") === "superseded", "ct_im<id> tasks of closed issues are superseded");
ok(st("ct_u9huz7zbg8aahu") === "superseded", "a task whose goal starts with [issue #<id>] is superseded when that issue is resolved");
ok(st("ct_im1000500") === "superseded", "a wontfix issue's task is superseded");
ok(st("ct_im1001801") === "queued" && st("ct_im1000600") === "queued", "tasks of open issues stay queued");
ok(st("ct_klrhftbqigkacf") === "queued" && st("ct_tkzsosgb6ovbwa") === "queued", "tasks of closed METRIC-TRIGGER issues are left to their own cluster");
ok(st("ct_im1001000") === "queued", "a BREACH-DOCTOR-1 issue's task is left alone");
ok(st("ct_im1001629x") === "merged", "a task that is not queued is untouched");
ok(st("ct_other") === "queued" && st("ct_im9999999") === "queued", "a task with no issue named, or an unknown issue, stays queued");
const reason = db.prepare("SELECT last_error, updated_at FROM code_tasks WHERE id = 'ct_im1001629'").get();
ok(/^TASK-ISSUE-CLOSED-1:/.test(reason.last_error) && /revert: status queued/.test(reason.last_error) && /^\d{4}-\d\d-\d\dT/.test(reason.updated_at), "the reason and a timestamp are written", reason);
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_stale_code_tasks").get().n === 11, "the backup holds the 11 queued rows seen at apply");

// the workflow step is the same statement and works on the next hour's data
const def = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'issue-meta-fold'").get().definition);
ok(def.steps.length === 3 && def.steps[2].name === "task-issue-closed" && def.steps[2].db === "AUDIT", "the step is appended last, with its name", def.steps.map((s) => s.name));
ok(db.prepare("SELECT version v FROM fleet_tasks WHERE id = 'issue-meta-fold'").get().v === 8, "the workflow version is bumped");
ok(db.prepare("SELECT definition = (SELECT definition FROM fleet_tasks WHERE id = 'issue-meta-fold') eq FROM fleet_tasks_canonical WHERE id = 'issue-meta-fold'").get().eq === 1, "the canonical row moved with the live one");
db.exec("UPDATE agent_issues SET status = 'closed' WHERE id = 1001801");
db.exec(def.steps[2].sql);
ok(st("ct_im1001801") === "superseded" && st("ct_im1000600") === "queued", "the step supersedes the task of an issue that closed since, not the open one");
db.exec("UPDATE code_tasks SET status = 'queued' WHERE id = 'ct_im1001801'; UPDATE agent_issues SET status = 'open' WHERE id = 1001801");
db.exec(def.steps[2].sql);
ok(st("ct_im1001801") === "queued", "a reopened issue keeps its requeued task");

// idempotent
const snap = JSON.stringify(db.prepare("SELECT * FROM code_tasks ORDER BY id").all());
const snapDef = db.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'issue-meta-fold'").get();
db.exec(sql);
ok(JSON.stringify(db.prepare("SELECT * FROM code_tasks ORDER BY id").all()) === snap, "a second run changes no task");
const d2 = db.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'issue-meta-fold'").get();
ok(d2.definition === snapDef.definition && d2.version === snapDef.version, "a second run appends no second step and does not bump the version");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'TASK-ISSUE-CLOSED-1:%'").get().n === 1, "one decision_log row after two runs");

console.log((fail ? "FAIL " : "ok ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
