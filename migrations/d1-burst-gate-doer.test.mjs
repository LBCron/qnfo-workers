import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// D1-BURST-GATE-1: the doer issue is filed once, its code-anchor occurs exactly once in the target worker, the code-probe line is added once, replay is idempotent.
const migration = readFileSync(new URL("./2026-11-04-d1-burst-gate-doer.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);
assert.match(migration, /^-- NOOP-OK: /m, "the replay UPDATE matches nothing and says so");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
db.exec(migration);
const row = db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #d1-bursts:%'").all();
assert.equal(row.length, 1, "one issue");
const d = row[0].description;
assert.equal(row[0].status, "open");
assert.equal(row[0].source, "session:fleet-tick-fanout");
const taskLine = d.split("\n").find((l) => l.startsWith("code-task: "));
const anchorLine = d.split("\n").find((l) => l.startsWith("code-anchor: "));
assert.equal(taskLine, "code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js");
assert.ok(anchorLine, "a code-anchor line");
const anchor = anchorLine.slice("code-anchor: ".length);
const src = readFileSync(new URL("../qnfo-fleet-control/worker.js", import.meta.url), "utf8");
assert.equal(src.split(anchor).length - 1, 1, "the anchor occurs exactly once in qnfo-fleet-control/worker.js: " + anchor);
assert.ok(src.indexOf(anchor) < src.indexOf("env = await ghAppEnv(env);", src.indexOf(anchor) - 10) + 400, "and sits next to the env re-creation in scheduledOnce");
assert.equal(d.split("code-probe: {").length - 1, 1, "one code-probe line");
assert.match(d, /"contains": "D1-BURST-GATE-1"/);
assert.match(d, /below 60/, "the closing probe names its threshold");
assert.match(d, /Do not edit the source-pinned fan-out lines/, "the doer is told which tests pin the fan-out text");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n, 1, "replay files nothing twice");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "one decision row");
assert.equal(db.prepare("SELECT description FROM agent_issues").get().description.split("code-probe: {").length - 1, 1, "and adds no second code-probe line");
db.close();
console.log("d1-burst-gate-doer: all passed");
