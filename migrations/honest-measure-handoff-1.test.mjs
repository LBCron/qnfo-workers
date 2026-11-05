// HONEST-MEASURE-HANDOFF-1 migration suite (roadmap_implementation 3260 RM-BS-HONEST-MEASURE-1): the row keeps status planned and gains its evidence once, the two slices name a real file
// and an anchor that occurs once, carry a code-probe, a definition of done and a do-not list, a second run adds nothing, and the decision is logged with a prediction.
// Run: node migrations/honest-measure-handoff-1.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-honest-measure-handoff-1.sql", import.meta.url), "utf8");
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- BACKUP: bak_20261105_honest_measure_roadmap$/m);
assert.match(sql, /^-- Rollback: .+/m);
assert.match(sql, /^-- CAUSE-MAPPED: /m, "registers no metric: says so");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
  INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, artifact_ref, status, evidence) VALUES (3260, 'RM-BS-HONEST-MEASURE-1', 'bluesky-2026-11', 't', 'worker', 'qnfo-fleet-control', 'planned', 'docs/BLUE-SKY-ROADMAP-2026-11.md');
  INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, artifact_ref, status, evidence) VALUES (3259, 'RM-BS-FLEET-TWIN-1', 'bluesky-2026-11', 't', 'worker', 'qnfo-deploy-guard', 'partial', 'x');
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
`);
db.exec(sql);
db.exec(sql);

// 1. only row 3260 changes, once; its status is unchanged (no code of its own has shipped) and the doc reference stays first
{
  const r = db.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = 3260").get();
  assert.equal(r.status, "planned");
  assert.match(r.evidence, /^docs\/BLUE-SKY-ROADMAP-2026-11\.md \| W2-H 2026-11-05 handoff/);
  assert.equal(r.evidence.split("W2-H 2026-11-05 handoff").length, 2, "the second run appends nothing");
  assert.match(r.evidence, /RM-BS-HONEST-MEASURE-1\.1/);
  assert.match(r.evidence, /RM-BS-HONEST-MEASURE-1\.2/);
  assert.equal(db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 3259").get().evidence, "x");
}
// 2. two slices, once each, each cold-readable: a code-task path that exists, an anchor that occurs once there, a code-probe, a definition of done and a do-not list
{
  const rows = db.prepare("SELECT title, description, source, status FROM agent_issues ORDER BY id").all();
  assert.equal(rows.length, 2);
  rows.forEach((r, i) => {
    assert.match(r.title, new RegExp("^ROADMAP-1: QNFO\\.OPS RM-BS-HONEST-MEASURE-1\\." + (i + 1) + ": "));
    assert.equal(r.source, "session:W2-H-3260");
    assert.equal(r.status, "open");
    const path = /^code-task: repo=qnfo-workers path=(.+)$/m.exec(r.description)[1];
    const anchor = /^code-anchor: (.+)$/m.exec(r.description)[1];
    const text = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.equal(text.split(anchor).length - 1, 1, path + " holds the anchor " + anchor + " once");
    assert.match(r.description, new RegExp('^code-probe: \\{"paths":\\["' + path.replace(/[./]/g, "\\$&") + '"\\],"contains":"RM-BS-HONEST-MEASURE-1\\.' + (i + 1) + '"\\}$', "m"));
    assert.match(r.description, /DEFINITION OF DONE/);
    assert.match(r.description, /DO NOT:/);
    assert.match(r.description, /WHY \(read 2026-11-05\)/);
  });
  // the pure function .1 adds goes next to ilMean, inside the IMPROVEMENT-LOOP-1 block that improvement.test.mjs loads
  const src = readFileSync(new URL("../qnfo-fleet-control/worker.js", import.meta.url), "utf8");
  const b = src.indexOf("// ---- IMPROVEMENT-LOOP-1:BEGIN"), e = src.indexOf("// ---- IMPROVEMENT-LOOP-1:END ----");
  const m = src.indexOf("function ilMean(a) {"), v = src.indexOf("function improvementEvaluate(f, nowMs) {");
  assert.ok(b >= 0 && e > b && m > b && m < e && v > b && v < e, "both anchors sit inside the IMPROVEMENT-LOOP-1 block");
  // the formula in .1 reproduces the first reading in the doc: sd 5.0 gives 7.5, 5.3 and 3.7
  const mde = (sd, w) => 2.8 * sd * Math.sqrt(2 / w);
  assert.ok(Math.abs(mde(5.0, 7) - 7.48) < 0.02 && Math.abs(mde(5.0, 14) - 5.29) < 0.02 && Math.abs(mde(5.0, 28) - 3.74) < 0.02);
  assert.match(rows[0].description, /sd 5\.0 gives 7\.5, 5\.3, 3\.7/);
}
// 3. the decision carries a prediction and a rollback path
{
  const d = db.prepare("SELECT predicted_outcome, rollback_path FROM decision_log").all();
  assert.equal(d.length, 1);
  assert.match(d[0].predicted_outcome, /at least 15 rows/);
  assert.match(d[0].rollback_path, /bak_20261105_honest_measure_roadmap/);
}
console.log("honest-measure-handoff-1 migration: ok");
