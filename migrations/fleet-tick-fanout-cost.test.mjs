import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// FLEET-TICK-FANOUT-COST-1: the rewritten trigger and view return what the correlated originals returned, and the detector tells them apart.
const migration = readFileSync(new URL("./2026-11-04-fleet-tick-fanout-cost.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_fleet_tick_fanout$/m);
assert.match(migration, /^-- Rollback: /m);

const SCHEMA = `
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, category TEXT, priority TEXT, status TEXT,
    created_at INTEGER, updated_at INTEGER, source TEXT, close_channel TEXT);
  CREATE INDEX idx_issues_status ON agent_issues(status, priority);
  CREATE INDEX idx_issues_created ON agent_issues(created_at);
  CREATE TABLE issue_age_bumps (issue_id INTEGER, ts TEXT);
  CREATE VIEW v_issue_age AS
    SELECT a.id, a.priority, a.title,
      CAST(((CAST(strftime('%s', 'now') AS INTEGER) * 1000) - a.created_at) / 60000 AS INTEGER) AS age_min,
      CAST(((CAST(strftime('%s', 'now') AS INTEGER) * 1000) - a.created_at) / 3600000 AS INTEGER) AS age_h,
      (SELECT MAX(b.ts) FROM issue_age_bumps b WHERE b.issue_id = a.id) AS last_bump
    FROM agent_issues a WHERE a.status = 'open';
  CREATE TABLE goals (source TEXT);
  CREATE TABLE objective_space (source TEXT);
  CREATE TABLE code_tasks (goal TEXT, status TEXT);
  CREATE TABLE work_claims (issue_id INTEGER, path TEXT, released_at TEXT, expires_at TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER, owner TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT,
    verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT,
    budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, last_verdict TEXT);
  CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY, verifier TEXT, verified_at TEXT);
  CREATE INDEX idx_remediation_verifications_ts ON remediation_verifications(verified_at);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
  INSERT INTO metric_registry (metric) VALUES ('open_issues_without_doer_24h'), ('open_issues_without_doer_120m');
  CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY, source TEXT);
  CREATE TABLE spof_registry (component TEXT, critical_path TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT,
    first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT,
    capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`;

// The shapes the migration replaces: the correlated scans as they stood on 2026-11-04.
const OLD_VIEW = `
  CREATE VIEW v_sla_bound_issue_age AS
  SELECT a.id, a.priority, a.title, a.age_min, i.category
  FROM v_issue_age a JOIN agent_issues i ON i.id = a.id
  WHERE a.age_min >= 120
    AND lower(trim(COALESCE(i.category, ''))) IN ('defect', 'incident', 'reliability')
    AND i.title NOT LIKE 'METRIC-TRIGGER-%'
    AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.source = 'agent_issues:' || i.id OR g.source LIKE 'agent_issues:' || i.id || ' (%'
       OR g.source = 'agent_issues ' || i.id OR g.source LIKE 'agent_issues ' || i.id || ' (%')
    AND NOT EXISTS (SELECT 1 FROM objective_space o WHERE o.source = 'agent_issues:' || i.id OR o.source LIKE 'agent_issues:' || i.id || ' (%'
       OR o.source = 'agent_issues ' || i.id OR o.source LIKE 'agent_issues ' || i.id || ' (%');`;
const oldDoerless = (seconds) => `(
      SELECT COUNT(*) FROM agent_issues a WHERE a.status = 'open' AND a.created_at <= (CAST(strftime('%s', 'now') AS INTEGER) - ${seconds}) * 1000
        AND instr(COALESCE(a.description, ''), 'code-task:') = 0
        AND NOT EXISTS (SELECT 1 FROM code_tasks k WHERE k.goal LIKE '[issue #' || a.id || ']%' AND k.status NOT IN ('failed', 'closed', 'superseded', 'needs_human'))
        AND NOT EXISTS (SELECT 1 FROM work_claims w WHERE (w.issue_id = a.id OR w.path = 'issue:' || a.id) AND w.released_at IS NULL
                          AND w.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))`;
const OLD_TRIGGER = `
  CREATE TRIGGER autonomy_selfheal_tick AFTER INSERT ON fleet_tick
  BEGIN
    UPDATE metric_registry SET last_value = CAST(${oldDoerless(86400)} AS TEXT) WHERE metric = 'open_issues_without_doer_24h';
    UPDATE metric_registry SET last_value = CAST(${oldDoerless(7200)} AS TEXT) WHERE metric = 'open_issues_without_doer_120m';
  END;`;

const now = Date.now();
const minutes = (m) => now - m * 60000;
const future = new Date(now + 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const past = new Date(now - 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");

function fixture(db) {
  const add = db.prepare("INSERT INTO agent_issues (id, title, description, category, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'medium', ?, ?, ?)");
  // ids 1, 2, 12, 13 prove that an id is never a prefix match of another id.
  const rows = [
    [1, "d1", "", "defect", "open", minutes(1500)], [2, "d2", "", "incident", "open", minutes(1500)],
    [3, "has active task", "", "defect", "open", minutes(1500)], [4, "task failed", "", "defect", "open", minutes(1500)],
    [5, "upper-case task", "", "reliability", "open", minutes(1500)], [6, "live claim by issue_id", "", "defect", "open", minutes(1500)],
    [7, "live claim by path", "", "defect", "open", minutes(1500)], [8, "expired claim", "", "defect", "open", minutes(1500)],
    [9, "released claim", "", "defect", "open", minutes(1500)], [10, "carries code-task line", "code-task: repo=x path=y", "defect", "open", minutes(1500)],
    [11, "younger than 24 h, older than 2 h", "", "defect", "open", minutes(300)], [12, "twelve", "", "defect", "open", minutes(1500)],
    [13, "thirteen", "", "reliability", "open", minutes(1500)], [14, "fresh", "", "defect", "open", minutes(30)],
    [15, "closed", "", "defect", "closed", minutes(1500)], [16, "optimization", "", "optimization", "open", minutes(1500)],
    [17, "METRIC-TRIGGER-1-X", "", "defect", "open", minutes(1500)], [18, "goal with note", "", "defect", "open", minutes(1500)],
    [19, "objective plain", "", "reliability", "open", minutes(1500)], [20, "goal with trailing words", "", "defect", "open", minutes(1500)],
  ];
  for (const [id, title, description, category, status, created] of rows) add.run(id, title, description, category, status, created, now);
  const task = db.prepare("INSERT INTO code_tasks VALUES (?, ?)");
  task.run("[issue #3] fix it", "queued"); task.run("[issue #4] fix it", "failed"); task.run("[ISSUE #5] fix it", "running");
  task.run("[issue #1x] other", "queued"); task.run("[issue #99] other", "queued"); task.run("no issue tag", "queued");
  const claim = db.prepare("INSERT INTO work_claims VALUES (?, ?, ?, ?)");
  claim.run(6, null, null, future); claim.run(null, "issue:7", null, future); claim.run(8, null, null, past);
  claim.run(9, null, past, future); claim.run(null, "file:some/path.js", null, future);
  const goal = db.prepare("INSERT INTO goals VALUES (?)");
  goal.run("agent_issues:18 (some note (nested))"); goal.run("agent_issues 1x"); goal.run("agent_issues:2 trailing words (x)"); goal.run("agent_issues:12x");
  goal.run("agent_issues:20 trailing (x)"); goal.run("other source"); goal.run("agent_issues:");
  db.prepare("INSERT INTO objective_space VALUES (?)").run("agent_issues:19");
  db.prepare("INSERT INTO objective_space VALUES (?)").run("agent_issues 13 (note)");
}

function build(withMigration) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA + OLD_VIEW + OLD_TRIGGER);
  fixture(db);
  db.prepare("INSERT INTO agent_issues (id, title, description, category, priority, status, created_at, updated_at) VALUES (?, ?, '', 'code', 'high', 'open', ?, ?)")
    .run(1001656, "D1-OVERLOAD-1e: fleet_tick standby producer", now, now);
  if (withMigration) db.exec(migration);
  return db;
}
const tick = (db) => {
  db.exec("INSERT INTO fleet_tick (source) VALUES ('test')");
  return Object.fromEntries(db.prepare("SELECT metric, last_value FROM metric_registry ORDER BY metric").all().map((r) => [r.metric, r.last_value]));
};
const ids = (db) => db.prepare("SELECT id FROM v_sla_bound_issue_age ORDER BY id").all().map((r) => r.id);

const before = build(false);
const after = build(true);

// The SLA-bound view: same ids, old against new.
const oldIds = ids(before);
assert.deepEqual(oldIds, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20], "fixture sanity: mapped, young, closed, other-category and METRIC-TRIGGER issues are out");
assert.deepEqual(ids(after), oldIds, "the single-read view returns the ids the correlated view returned");

// The doer-less counts: same values, old against new (ids 1 and 12 are not matched by the prefixes of ids 1x / 12x).
const oldMetrics = tick(before);
const newMetrics = tick(after);
assert.deepEqual(newMetrics, oldMetrics, "the IN-list trigger returns what the correlated trigger returned");
assert.deepEqual(newMetrics, { open_issues_without_doer_120m: "13", open_issues_without_doer_24h: "12" });

// The detector sees the old shapes (one trigger, one view) and not the new ones.
const probeSql = after.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-fleet-tick-fanout-rows-read'").get().verify_probe;
assert.deepEqual({ ...after.prepare(probeSql).get() }, { expected: "0", observed: "0" });
assert.equal(before.prepare(probeSql).get().observed, "2");

// Records and idempotence.
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM spof_registry WHERE component LIKE 'fleet_tick producers%'").get().n, 1);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE title LIKE 'FLEET-TICK-SECOND-SOURCE-1:%'").get().n, 1);
const second = after.prepare("SELECT description FROM agent_issues WHERE title LIKE 'FLEET-TICK-SECOND-SOURCE-1:%'").get().description;
assert.match(second, /^code-task: repo=qnfo-workers path=qnfo-fleet-control\/worker\.js$/m);
assert.match(second, /^code-anchor: async scheduledOnce\(event, env, ctx\) \{$/m);
assert.match(after.prepare("SELECT description FROM agent_issues WHERE id = 1001656").get().description, /CADENCE-CAUTION/);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM bak_20261104_fleet_tick_fanout").get().n, 2, "both replaced definitions are backed up");
after.exec(migration);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM spof_registry").get().n, 1, "replay adds no second spof row");
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM agent_issues WHERE title LIKE 'FLEET-TICK-SECOND-SOURCE-1:%'").get().n, 1);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal((after.prepare("SELECT description FROM agent_issues WHERE id = 1001656").get().description.match(/CADENCE-CAUTION/g) || []).length, 1);
assert.deepEqual(tick(after), newMetrics, "the replayed trigger gives the same values");

before.close();
after.close();
console.log("fleet-tick-fanout-cost: all passed");
