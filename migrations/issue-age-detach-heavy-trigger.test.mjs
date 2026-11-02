import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-issue-age-detach-heavy-trigger.sql", import.meta.url), "utf8");
const originalMigration = readFileSync(new URL("./2026-11-01-issue-age-live-doers.sql", import.meta.url), "utf8");
const originalTrigger = originalMigration.match(/CREATE TRIGGER IF NOT EXISTS issue_age_live_doers_tick AFTER INSERT ON fleet_tick_heavy\s+BEGIN([\s\S]*?)\s+END;/)?.[1];
assert.ok(originalTrigger, "the previous heartbeat trigger exists as the behavior baseline");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY, source TEXT);
  CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT, type TEXT, definition TEXT, timeout_ms INTEGER, retries INTEGER, version INTEGER, enabled INTEGER, updated_at TEXT);
  CREATE TABLE fleet_tasks_canonical (id TEXT PRIMARY KEY, definition TEXT, repo_path TEXT, exported_at TEXT);
  CREATE TABLE fleet_crons (name TEXT PRIMARY KEY, cron_expr TEXT, task_id TEXT, enabled INTEGER, timezone TEXT, last_fired TEXT, next_fire TEXT, updated_at TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE issue_plans (issue_id INTEGER PRIMARY KEY, outcome TEXT, planned_at TEXT, detail TEXT, task_id TEXT);
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, goal TEXT, status TEXT, last_error TEXT, merge_note TEXT);
  CREATE TABLE work_claims (issue_id INTEGER, path TEXT, released_at TEXT, expires_at TEXT);
  CREATE TABLE breach_diagnoses (issue_id INTEGER, mode TEXT, state TEXT, action_ref TEXT, action_kind TEXT, lease_until TEXT, last_progress_at TEXT);
  CREATE TABLE issue_age_replans (issue_id INTEGER, outcome_was TEXT, planned_at_was TEXT, age_h REAL, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
  CREATE TABLE issue_age_actions (issue_id INTEGER, rung TEXT, priority_was TEXT, priority_to TEXT, blocker TEXT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY(issue_id,rung));
  CREATE TABLE issue_age_tick_state (id INTEGER, title TEXT, priority TEXT, source TEXT, age_h REAL, doer TEXT, plan_outcome TEXT, planned_at TEXT, plan_reason TEXT, rung TEXT, breach INTEGER, blocker TEXT);
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, action TEXT);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  CREATE VIEW v_issue_age_ladder AS
    SELECT id, title, priority, source, 30.0 AS age_h, NULL AS doer, 'not-code' AS plan_outcome,
      '2000-01-01T00:00:00Z' AS planned_at, 'test blocker' AS plan_reason, '24h' AS rung, 1 AS breach
    FROM agent_issues WHERE status='open';
  CREATE TRIGGER issue_age_live_doers_tick AFTER INSERT ON fleet_tick_heavy BEGIN ${originalTrigger} END;
  CREATE TABLE heavy_tick_marks (id INTEGER);
  CREATE TRIGGER unrelated_heavy_tick AFTER INSERT ON fleet_tick_heavy
    BEGIN INSERT INTO heavy_tick_marks VALUES (NEW.id); END;
  INSERT INTO agent_issues VALUES (1, 'Overdue test issue', '', 'test', 'reliability', 'high', 'open', 1, 1);
  INSERT INTO issue_plans VALUES (1, 'not-code', '2000-01-01T00:00:00Z', 'test plan', NULL);
  INSERT INTO remediation_contracts (class, issue_id, status) VALUES ('issue-2', 2, 'active');
  INSERT INTO metric_registry (metric) VALUES ('issues_over_24h_no_doer');
`);

// SQLite's default depth limit is 1000; D1 reaches its smaller limit with the live issue trigger graph.
// The issue write fits alone, but not beneath the additional heartbeat trigger.
for (let i = 0; i < 1000; i++) db.exec(`CREATE TABLE issue_depth_${i} (id INTEGER)`);
for (let i = 0; i < 999; i++) {
  db.exec(`CREATE TRIGGER issue_depth_${i}_next AFTER INSERT ON issue_depth_${i}
    BEGIN INSERT INTO issue_depth_${i + 1} VALUES (NEW.id); END`);
}
db.exec(`CREATE TRIGGER issue_depth_start AFTER INSERT ON agent_issues
  BEGIN INSERT INTO issue_depth_0 VALUES (NEW.id); END`);
assert.throws(() => db.exec("INSERT INTO fleet_tick_heavy (source) VALUES ('cron:qnfo-code-orchestrator')"),
  /triggers nested too deep/, "the original issue-age trigger exhausts the heartbeat's nested trigger budget");
assert.equal(db.prepare("SELECT COUNT(*) n FROM fleet_tick_heavy").get().n, 0,
  "trigger exhaustion rolls back the heartbeat");
assert.equal(db.prepare("SELECT COUNT(*) n FROM heavy_tick_marks").get().n, 0,
  "trigger exhaustion also rolls back unrelated heavy-tick work");
assert.equal(db.prepare("SELECT outcome FROM issue_plans WHERE issue_id=1").get().outcome, "not-code",
  "the failed heartbeat rolls back issue-age replanning");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='issue_age_live_doers_tick'").get().n, 0,
  "issue-age statements are detached from the heavy heartbeat trigger");
db.exec("INSERT INTO fleet_tick_heavy (source) VALUES ('cron:qnfo-code-orchestrator')");
assert.equal(db.prepare("SELECT COUNT(*) n FROM fleet_tick_heavy").get().n, 1,
  "the heavy heartbeat commits after detachment");
assert.equal(db.prepare("SELECT COUNT(*) n FROM heavy_tick_marks").get().n, 1,
  "unrelated heavy-tick work commits after detachment");
const cron = db.prepare("SELECT cron_expr, task_id, enabled FROM fleet_crons WHERE name='issue-age-live-doers'").get();
assert.deepEqual({ ...cron }, { cron_expr: "*/10 * * * *", task_id: "issue-age-live-doers", enabled: 1 });
const task = db.prepare("SELECT type, version, enabled, definition FROM fleet_tasks WHERE id='issue-age-live-doers'").get();
assert.equal(task.type, "workflow");
assert.equal(task.version, 2);
assert.equal(task.enabled, 1);
const steps = JSON.parse(task.definition).steps;
assert.equal(steps.length, 12);
assert.ok(steps.every((step) => step.type === "sql" && step.db === "AUDIT"));
const normalizeSql = (sql) => sql.replace(/\s+/g, " ").trim();
const splitSql = (sql) => {
  const statements = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'" && sql[i + 1] === "'") {
      i++;
    } else if (sql[i] === "'") {
      quoted = !quoted;
    } else if (sql[i] === ";" && !quoted) {
      statements.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  statements.push(sql.slice(start));
  return statements.map(normalizeSql).filter(Boolean);
};
assert.deepEqual(
  steps.map((step) => normalizeSql(step.sql)),
  splitSql(originalTrigger),
  "scheduled steps preserve the issue-age trigger's original SQL and order"
);
assert.deepEqual({ ...db.prepare("SELECT definition FROM fleet_tasks_canonical WHERE id='issue-age-live-doers'").get() }, { definition: task.definition });

for (const step of steps) db.exec(step.sql);
assert.equal(db.prepare("SELECT outcome FROM issue_plans WHERE issue_id=1").get().outcome, "retry");
assert.equal(db.prepare("SELECT COUNT(*) n FROM issue_age_actions WHERE issue_id=1 AND rung='24h'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'ISSUE-AGE-24H-REPAIR-1:%'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) n FROM issue_depth_999").get().n, 1,
  "the detached workflow files its repair issue through the complete nested trigger chain");
assert.equal(db.prepare("SELECT last_value FROM metric_registry WHERE metric='issues_over_24h_no_doer'").get().last_value, "1");

const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback);
db.exec(rollback);
assert.equal(db.prepare("SELECT COUNT(*) n FROM fleet_tasks WHERE id='issue-age-live-doers'").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) n FROM fleet_crons WHERE name='issue-age-live-doers'").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) n FROM fleet_tasks_canonical WHERE id='issue-age-live-doers'").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='issue_age_live_doers_tick'").get().n, 1);
console.log("issue-age-detach-heavy-trigger: passed");
