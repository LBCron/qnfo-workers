import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// TERMINAL-RECONCILE-PREFIX-1: the two steps keep their effect and meet only marked issues.
const migration = readFileSync(new URL("./2026-11-04-terminal-reconcile-prefix.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_clr_workflow$/m);
assert.match(migration, /^-- Rollback: /m);

// The steps as the live fleet_tasks row holds them (2026-11-04).
const STEP0 = "UPDATE remediation_contracts SET verify_probe = 'SELECT ''merged'' AS expected, COALESCE((SELECT status FROM code_tasks WHERE id = ''' || (SELECT t.id FROM agent_issues a JOIN code_tasks t ON instr(a.title, 'CODE-LOOP-EXHAUSTED-1: ' || t.id || ' ') > 0 WHERE a.id = remediation_contracts.issue_id AND a.status = 'open' AND t.status = 'merged') || '''), ''missing'') AS observed', verify_transport = 'd1-query', module = 'code-loop-terminal-reconcile', next_due_at = datetime('now') WHERE status IN ('active','holding') AND issue_id IN (SELECT a.id FROM agent_issues a JOIN code_tasks t ON instr(a.title, 'CODE-LOOP-EXHAUSTED-1: ' || t.id || ' ') > 0 WHERE a.status = 'open' AND t.status = 'merged') AND instr(verify_probe, 'FROM agent_issues WHERE id = ') > 0 AND instr(verify_probe, ') <> ''open'' THEN ''ok''') > 0";
const STEP1 = "INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence) SELECT a.id, 'code-loop-terminal-reconcile', 'resolved', 'qnfo-code-orchestrator', datetime('now'), 'DoD met: code task ' || t.id || ' reached merged (PR ' || COALESCE(t.pr_url,'unknown') || '); code_tasks.status=merged. Auto-closed by CODE-LOOP-TERMINAL-RECONCILE-1.' FROM agent_issues a JOIN code_tasks t ON instr(a.title, 'CODE-LOOP-EXHAUSTED-1: ' || t.id || ' ') > 0 WHERE a.status = 'open' AND t.status = 'merged' AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = a.id AND c.status IN ('active','holding') AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host')) ON CONFLICT(issue_id) DO UPDATE SET triage_state='resolved', close_evidence=excluded.close_evidence";
const definition = JSON.stringify({ steps: [{ type: "sql", name: "retarget-circular-probe", db: "AUDIT", sql: STEP0 }, { type: "sql", name: "close-merged", db: "AUDIT", sql: STEP1 }] });

const SCHEMA = `
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT);
  CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
  CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, pr_url TEXT);
  CREATE INDEX idx_code_tasks_status ON code_tasks (status);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, verify_probe TEXT, verify_transport TEXT, module TEXT, next_due_at TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT);
  CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, definition TEXT, version INTEGER, updated_at TEXT);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`;
const PROBE = (id) => `SELECT CASE WHEN (SELECT status FROM agent_issues WHERE id = ${id}) <> 'open' THEN 'ok' ELSE 'no' END AS observed`;

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const issue = db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (?, ?, '', ?)");
  const task = db.prepare("INSERT INTO code_tasks (id, status, pr_url) VALUES (?, ?, ?)");
  const contract = db.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)");
  // 600 unrelated open issues, 400 merged tasks: the cross product the guard removes.
  for (let i = 1; i <= 600; i++) issue.run(i, "plain issue " + i, "open");
  for (let t = 1; t <= 400; t++) task.run("ct_m" + t, "merged", "https://example/pr/" + t);
  task.run("ct_run", "running", null);
  // Marked issues: merged task (retarget + close), unmerged task, wrong id, closed issue, a contract that fails (must not be closed), a task id that is a prefix of another.
  issue.run(1001, "CODE-LOOP-EXHAUSTED-1: ct_m7 exhausted after 3 tries", "open");
  issue.run(1002, "CODE-LOOP-EXHAUSTED-1: ct_run exhausted", "open");
  issue.run(1003, "CODE-LOOP-EXHAUSTED-1: ct_none exhausted", "open");
  issue.run(1004, "CODE-LOOP-EXHAUSTED-1: ct_m8 exhausted", "closed");
  issue.run(1005, "CODE-LOOP-EXHAUSTED-1: ct_m9 exhausted", "open");
  issue.run(1006, "CODE-LOOP-EXHAUSTED-1: ct_m1 x", "open");
  issue.run(1007, "CODE-LOOP-EXHAUSTED-1: ct_m10 y", "open");
  contract.run("issue-1001", 1001, "active", null, PROBE(1001));
  contract.run("issue-1002", 1002, "active", null, PROBE(1002));
  contract.run("issue-1005", 1005, "holding", "fail", PROBE(1005));
  contract.run("issue-1006", 1006, "active", "ok", "SELECT 'x' AS observed");
  contract.run("issue-5", 5, "active", null, PROBE(5));
  db.prepare("INSERT INTO fleet_tasks (id, definition, version) VALUES ('code-loop-terminal-reconcile', ?, 2)").run(definition);
  return db;
}
const runSteps = (db) => {
  const steps = JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = 'code-loop-terminal-reconcile'").get().definition).steps;
  for (const s of steps) db.exec(s.sql);
};
const state = (db) => JSON.stringify({
  rc: db.prepare("SELECT class, verify_probe, verify_transport, module FROM remediation_contracts ORDER BY class").all(),
  triage: db.prepare("SELECT issue_id, rc, triage_state, owner, close_evidence FROM issue_triage ORDER BY issue_id").all(),
});
const planOf = (db, sql) => db.prepare("EXPLAIN QUERY PLAN SELECT a.id FROM agent_issues a JOIN code_tasks t ON instr(a.title, 'CODE-LOOP-EXHAUSTED-1: ' || t.id || ' ') > 0 WHERE a.status = 'open' AND t.status = 'merged'" + sql).all().map((r) => r.detail).join(" | ");

const before = build();
const after = build();
runSteps(before);
after.exec(migration);
const def = after.prepare("SELECT definition, version FROM fleet_tasks WHERE id = 'code-loop-terminal-reconcile'").get();
assert.equal(def.version, 3);
assert.equal(JSON.parse(def.definition).steps.length, 2, "the definition is still two valid steps");
assert.equal((def.definition.match(/a\.title >= 'CODE-LOOP-EXHAUSTED-1: '/g) || []).length, 2, "both joins gained the prefix range");
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM bak_20261104_clr_workflow").get().n, 1);
runSteps(after);
assert.equal(state(after), state(before), "same retargets and closes with the prefix range");
// Fixture sanity: issue 1001 closed by the steps, 1002 (task running), 1003 (no task), 1005 (failing contract), 1006/1007 (prefix ids) behave identically.
const closed = after.prepare("SELECT issue_id FROM issue_triage ORDER BY issue_id").all().map((r) => r.issue_id);
assert.deepEqual(closed, [1001, 1006, 1007]);
assert.match(after.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-1001'").get().verify_probe, /^SELECT 'merged' AS expected/);

// The marker range is served by the partial title index.
assert.match(planOf(after, " AND a.title >= 'CODE-LOOP-EXHAUSTED-1: ' AND a.title < 'CODE-LOOP-EXHAUSTED-1:!'"), /idx_agent_issues_open_title \(title>\? AND title<\?\)/);

// Replay changes nothing (version and definition stay).
after.exec(migration);
assert.equal(after.prepare("SELECT version FROM fleet_tasks WHERE id = 'code-loop-terminal-reconcile'").get().version, 3, "replay does not bump the version again");
assert.equal(after.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
before.close();
after.close();
console.log("terminal-reconcile-prefix: all passed");
