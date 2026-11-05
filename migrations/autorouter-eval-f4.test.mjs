// AUTOROUTER-EVAL-1 migration suite (RM-AUTOROUTER-EVAL-1, agent_issues 1000652): the probe measures recorded shadow events, the doer row names a real file and anchor.
// Run: node migrations/autorouter-eval-f4.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-autorouter-eval-f4.sql", import.meta.url), "utf8");
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- BACKUP: bak_20261105_autorouter_eval_f4$/m);
assert.match(sql, /^-- Rollback: .+/m);

function fixture(events) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, last_verdict TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
    INSERT INTO remediation_contracts VALUES ('issue-1000652', 1000652, 'SELECT old', 'd1-query', 'fail');
  `);
  const ins = db.prepare("INSERT INTO cloud_ops_events VALUES (?,?,?,?,?,?,?)");
  events.forEach(([ago, kind, status], i) => ins.run("e" + i, new Date(Date.now() - ago * 864e5).toISOString().replace(/\.\d+Z$/, "Z"), kind, "t", "{}", "qnfo-ai", status));
  db.exec(sql);
  return db;
}
const probe = (db) => db.prepare(db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='issue-1000652'").get().verify_probe).get();

// 1. three ok events in the window pass; fewer say how many there were
{
  const p = probe(fixture([[1, "autorouter-shadow", "ok"], [2, "autorouter-shadow", "ok"], [3, "autorouter-shadow", "ok"]]));
  assert.equal(p.expected, p.observed, p.observed);
  const two = probe(fixture([[1, "autorouter-shadow", "ok"], [2, "autorouter-shadow", "ok"], [3, "autorouter-shadow", "failed"]]));
  assert.equal(two.observed, "2 ok autorouter-shadow events in 14 days (3 of any status)");
  const none = probe(fixture([]));
  assert.equal(none.observed, "0 ok autorouter-shadow events in 14 days (0 of any status)");
}
// 2. old events, other kinds and other statuses do not count
{
  const p = probe(fixture([[20, "autorouter-shadow", "ok"], [1, "autorouter-shadow-run", "ok"], [1, "other", "ok"], [1, "autorouter-shadow", "skipped_budget"]]));
  assert.notEqual(p.expected, p.observed);
  assert.match(p.observed, /^0 ok autorouter-shadow events in 14 days \(1 of any status\)$/);
}
// 3. the doer row has a real path and an anchor that occurs once; a second run adds nothing
{
  const db = fixture([]);
  db.exec(sql.replace(/CREATE TABLE IF NOT EXISTS[\s\S]*?;\n/, ""));
  const rows = db.prepare("SELECT title, description FROM agent_issues").all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /^ROADMAP-1: QNFO\.INFRA AUTOROUTER-EVAL-1\.2: /);
  const path = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(rows[0].description)[1];
  const anchor = /^code-anchor: (.+)$/m.exec(rows[0].description)[1];
  const src = readFileSync(new URL("../" + path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(src.split(anchor).length - 1, 1, "anchor occurs once in " + path);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
}
// 4. the shadow endpoint the doer will call exists in the router, with the request shape the row describes
{
  const ai = readFileSync(new URL("../qnfo-ai/worker.js", import.meta.url), "utf8");
  assert.ok(ai.includes('path === "/internal/eval/autorouter-shadow" && method === "POST"'));
  assert.ok(ai.includes("body.confirm !== true"));
}
console.log("autorouter-eval-f4: ok");
