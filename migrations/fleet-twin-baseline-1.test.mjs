// FLEET-TWIN-BASELINE-1 migration suite (roadmap_implementation 3259 RM-BS-FLEET-TWIN-1, PR 7664): the row goes planned -> partial exactly once, the two follow-up rows
// name a real file and an anchor that occurs once, a second run adds nothing, and the decision is logged with a prediction.
// Run: node migrations/fleet-twin-baseline-1.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-fleet-twin-baseline-1.sql", import.meta.url), "utf8");
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- BACKUP: bak_20261105_fleet_twin_roadmap$/m);
assert.match(sql, /^-- Rollback: .+/m);
assert.match(sql, /^-- CAUSE-MAPPED: /m, "registers no metric: says so");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, artifact_ref, status, evidence) VALUES (3259, 'RM-BS-FLEET-TWIN-1', 'bluesky-2026-11', 't', 'worker', 'qnfo-deploy-guard', 'planned', 'docs/BLUE-SKY-ROADMAP-2026-11.md');
  INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, artifact_ref, status, evidence) VALUES (3260, 'RM-BS-HONEST-MEASURE-1', 'bluesky-2026-11', 't', 'worker', 'qnfo-fleet-control', 'planned', 'docs/BLUE-SKY-ROADMAP-2026-11.md');
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
`);
db.exec(sql);
db.exec(sql);

// 1. only row 3259 moves, once, and keeps the doc reference
{
  const r = db.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = 3259").get();
  assert.equal(r.status, "partial");
  assert.match(r.evidence, /^docs\/BLUE-SKY-ROADMAP-2026-11\.md \| W2-H 2026-11-05 \(PR 7664, merged\)/);
  assert.equal(r.evidence.split("W2-H 2026-11-05").length, 2, "the second run appends nothing");
  assert.equal(db.prepare("SELECT status FROM roadmap_implementation WHERE id = 3260").get().status, "planned");
}
// 2. two follow-up rows, once each, each with a code-task path that exists, an anchor that occurs once there, and a code-probe
{
  const rows = db.prepare("SELECT title, description, source, status FROM agent_issues ORDER BY id").all();
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.match(r.title, /^ROADMAP-1: QNFO\.OPS RM-BS-FLEET-TWIN-1\.[23]: /);
    assert.equal(r.source, "session:W2-H-3259");
    assert.equal(r.status, "open");
    const path = /^code-task: repo=qnfo-workers path=(.+)$/m.exec(r.description)[1];
    const anchor = /^code-anchor: (.+)$/m.exec(r.description)[1];
    const text = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.equal(text.split(anchor).length - 1, 1, path + " holds the anchor once");
    assert.match(r.description, /^code-probe: \{"paths":\["[^"]+"\],"contains":"RM-BS-FLEET-TWIN-1\.[23]"\}$/m);
  }
}
// 3. the decision carries a prediction and a rollback path
{
  const d = db.prepare("SELECT predicted_outcome, rollback_path FROM decision_log").all();
  assert.equal(d.length, 1);
  assert.match(d[0].predicted_outcome, /deploys\.in_window above 1000/);
  assert.match(d[0].rollback_path, /bak_20261105_fleet_twin_roadmap/);
}
console.log("fleet-twin-baseline-1 migration: ok");
