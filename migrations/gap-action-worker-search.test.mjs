import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// GAP-ACTION-WORKER-SEARCH-1: step 8 of portfolio-gap-action closes the same issues and searches worker_compat_state by worker.
const migration = readFileSync(new URL("./2026-11-04-gap-action-worker-search.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_gap_action_workflow$/m);
assert.match(migration, /^-- Rollback: /m);

// Step 8 as the live fleet_tasks row holds it (2026-11-04).
const STEP8 = `UPDATE agent_issues SET status='closed', close_channel='auto:portfolio-gap-action',
  updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE status='open' AND EXISTS (
  SELECT 1 FROM worker_compat_state w
  JOIN roadmap_implementation r ON r.item='UPG-'||w.worker AND r.status='verified'
  JOIN issue_triage t ON t.issue_id=agent_issues.id
  WHERE agent_issues.title='PORTFOLIO-UPGRADE-1: advance compat_date for '||w.worker
    AND w.checked_at=(SELECT MAX(w2.checked_at) FROM worker_compat_state w2 WHERE w2.worker=w.worker)
    AND typeof(w.days_behind) IN ('integer','real') AND w.days_behind>=0 AND w.days_behind<30
    AND datetime(w.checked_at) BETWEEN datetime('now','-120 minutes') AND datetime('now')
    AND t.close_evidence='PORTFOLIO-GAP-CLOSE-EVIDENCE-1: worker='||w.worker||' checked_at='||w.checked_at||
      ' live_date='||w.live_date||' days_behind='||w.days_behind||' roadmap='||r.item||' verified_at='||r.verified_at)
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id=agent_issues.id AND c.status IN ('active','holding')
    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'))`;
const definition = JSON.stringify({ steps: [{ type: "sql", name: "other", db: "AUDIT", sql: "SELECT 1" }, { type: "sql", db: "AUDIT", sql: STEP8 }] });

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);
    CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
    CREATE TABLE worker_compat_state (worker TEXT NOT NULL, checked_at TEXT NOT NULL, live_date TEXT NOT NULL, days_behind INTEGER, PRIMARY KEY (worker, checked_at));
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, status TEXT NOT NULL, verified_at TEXT);
    CREATE INDEX idx_roadmap_impl_item_status ON roadmap_implementation (item, status);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
    CREATE TABLE remediation_contracts (issue_id INTEGER, status TEXT, last_verdict TEXT);
    CREATE INDEX idx_rc_issue_status ON remediation_contracts (issue_id, status);
    CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
    CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
      predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  `);
  const fmt = (ms) => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  const now = Date.now();
  db.exec("BEGIN");
  const wcs = db.prepare("INSERT INTO worker_compat_state VALUES (?, ?, ?, ?)");
  for (let w = 1; w <= 41; w++) for (let c = 0; c < 73; c++) wcs.run("w" + w, fmt(now - (c + 1) * 3600000 * 3), "2026-10-01", 2);
  // latest checks: w1..w6 checked 30 minutes ago (inside the 120-minute window); w1 days_behind 90 (too far), w6 has an unverified roadmap row
  for (let w = 1; w <= 6; w++) wcs.run("w" + w, fmt(now - 30 * 60000), "2026-10-02", w === 1 ? 90 : 3);
  const road = db.prepare("INSERT INTO roadmap_implementation (item, status, verified_at) VALUES (?, ?, ?)");
  for (let w = 1; w <= 41; w++) road.run("UPG-w" + w, w === 6 ? "planned" : "verified", "2026-10-03");
  for (let i = 0; i < 640; i++) db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?, ?, 'open')").run(i + 1, "unrelated issue " + i);
  const issue = db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?, ?, 'open')");
  const triage = db.prepare("INSERT INTO issue_triage VALUES (?, ?)");
  const checked = (w) => db.prepare("SELECT MAX(checked_at) AS c, live_date, days_behind FROM worker_compat_state WHERE worker = ? AND checked_at = (SELECT MAX(checked_at) FROM worker_compat_state WHERE worker = ?)").get(w, w);
  for (let w = 1; w <= 7; w++) {
    const id = 2000 + w, c = checked("w" + w);
    issue.run(id, "PORTFOLIO-UPGRADE-1: advance compat_date for w" + w);
    triage.run(id, "PORTFOLIO-GAP-CLOSE-EVIDENCE-1: worker=w" + w + " checked_at=" + c.c + " live_date=" + c.live_date + " days_behind=" + c.days_behind + " roadmap=UPG-w" + w + " verified_at=2026-10-03");
  }
  issue.run(2008, "PORTFOLIO-UPGRADE-1: advance compat_date for w2 (copy)"); // longer title: not equal to prefix || worker
  triage.run(2008, "x");
  db.prepare("INSERT INTO remediation_contracts VALUES (2003, 'active', 'fail')").run(); // a failing contract keeps issue 2003 open
  db.exec("COMMIT");
  db.prepare("INSERT INTO fleet_tasks (id, definition, version) VALUES ('portfolio-gap-action', ?, 5)").run(definition);
  return db;
}
const runStep = (db) => { const d = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'portfolio-gap-action'").get().definition); db.exec(d.steps[1].sql); };
const closed = (db) => db.prepare("SELECT id FROM agent_issues WHERE status = 'closed' ORDER BY id").all().map((r) => r.id);
const plan = (db) => {
  const d = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'portfolio-gap-action'").get().definition);
  const sql = d.steps[1].sql;
  return db.prepare("EXPLAIN QUERY PLAN SELECT count(*) FROM agent_issues " + sql.slice(sql.search(/WHERE status='open'/))).all().map((r) => r.detail).join(" | ");
};

const before = build();
const after = build();
const beforePlan = plan(before);
assert.match(beforePlan, /SCAN w\b/, "before: worker_compat_state is scanned inside the EXISTS: " + beforePlan);
runStep(before);
const expected = closed(before);
assert.deepEqual(expected, [2002, 2004, 2005], "fixture: workers 2, 4, 5 qualify; 1 (days_behind 90), 3 (failing contract), 6 (roadmap not verified), 7 (stale check) and the longer title do not");

after.exec(migration);
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM bak_20261104_gap_action_workflow").get().n, 1);
const def = after.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'portfolio-gap-action'").get();
assert.equal(def.version, 6);
assert.equal(JSON.parse(def.definition).steps.length, 2, "still two valid steps");
assert.equal((def.definition.match(/w\.worker = substr\(agent_issues\.title, length\(/g) || []).length, 1);
const afterPlan = plan(after);
assert.match(afterPlan, /SEARCH w USING (COVERING )?INDEX sqlite_autoindex_worker_compat_state_1 \(worker=\?\)|SEARCH w USING PRIMARY KEY \(worker=\?\)/, "after: searched by worker: " + afterPlan);
assert.doesNotMatch(afterPlan, /SCAN w\b/);
runStep(after);
assert.deepEqual(closed(after), expected, "the same issues are closed");

after.exec(migration);
assert.equal(after.prepare("SELECT version FROM fleet_tasks WHERE id = 'portfolio-gap-action'").get().version, 6, "replay does not bump the version");
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
before.close(); after.close();
console.log("gap-action-worker-search: all passed");
