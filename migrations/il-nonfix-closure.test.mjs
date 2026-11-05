// IL-NONFIX-CLOSURE-1 offline suite for migrations/2026-11-05-il-nonfix-closure.sql (real SQLite via node:sqlite).
// Proves: monitors on closed superseded / moot tickets (any case) in status active, holding or escalated are superseded with their before-state kept; a monitor on a ticket closed by a recovery,
// an open ticket's monitor and a monitor of another module are untouched; the detector reads 0 after the file and 1 for a monitor written later; replay changes nothing; the rollback restores.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(fileURLToPath(new URL("./2026-11-05-il-nonfix-closure.sql", import.meta.url)), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
assert.ok(rollback, "one rollback line");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
const body = migration.replace(/^--.*$/gm, "");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, title TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, last_verdict TEXT, last_attempt_at TEXT, next_due_at TEXT, module TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
const issue = (id, status, evidence) => { db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?)").run(id, status, "METRIC-TRIGGER-" + id + "-X: gap"); db.prepare("INSERT INTO issue_triage VALUES (?, ?)").run(id, evidence); };
const monitor = (id, status, module = "improvement-relapse") => db.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, next_due_at, module) VALUES (?, ?, ?, 'fail', '2026-11-06 00:00:00', ?)").run("metric-relapse-" + id, id, status, module);
issue(1, "closed", "SUPERSEDED BY #99938: trigger 3689 is disabled"); monitor(1, "active");
issue(2, "closed", "superseded by 99943 (METRIC-TRIGGER-5394)"); monitor(2, "escalated");
issue(3, "closed", "MOOT: trigger 409 is disabled"); monitor(3, "holding");
issue(4, "closed", "  Moot: leading spaces are trimmed, like the worker"); monitor(4, "escalated");
issue(5, "closed", "TRIGGER-RECOVERY-1 2026-10-26T06:31:08Z: x=640 no longer"); monitor(5, "active");
issue(6, "open", "SUPERSEDED BY #1: an open ticket is not closed"); monitor(6, "active");
issue(7, "closed", "SUPERSEDED BY #2: other module"); monitor(7, "active", "failure-mode");
issue(8, "closed", "SUPERSEDED BY #3: already superseded"); monitor(8, "superseded");
issue(9, "closed", ""); monitor(9, "active");

db.exec(body);
const st = (id) => db.prepare("SELECT status, last_verdict FROM remediation_contracts WHERE class = ?").get("metric-relapse-" + id);
for (const id of [1, 2, 3, 4]) { assert.equal(st(id).status, "superseded", "monitor " + id + " superseded"); assert.match(st(id).last_verdict, /^superseded:nonfix-closure/); }
for (const id of [5, 6, 7, 9]) assert.equal(st(id).status, "active", "monitor " + id + " untouched");
assert.equal(st(8).status, "superseded");
assert.equal(st(8).last_verdict, "fail", "an already superseded monitor keeps its verdict");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261105_il_nonfix_monitors").get().n, 4, "before-state kept for exactly the four");

const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-nonfix-relapse-monitor'").get().verify_probe;
assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" }, "detector reads 0 after the file");
issue(10, "closed", "SUPERSEDED BY #5: later"); monitor(10, "active");
assert.equal(db.prepare(probe).get().observed, "1", "a monitor written later is seen");
db.exec("DELETE FROM remediation_contracts WHERE class = 'metric-relapse-10'");

const snap = () => JSON.stringify([db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all(), db.prepare("SELECT COUNT(*) AS n FROM decision_log").all(), db.prepare("SELECT * FROM bak_20261105_il_nonfix_monitors ORDER BY class").all()]);
const before = snap();
db.exec(body);
assert.equal(snap(), before, "replay changes nothing");

db.exec(rollback);
for (const id of [1, 2, 3, 4]) assert.equal(st(id).last_verdict, "fail", "rollback restores monitor " + id);
assert.equal(st(1).status, "active"); assert.equal(st(2).status, "escalated"); assert.equal(st(3).status, "holding");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'fm-nonfix-relapse-monitor'").get().n, 0);

console.log("il-nonfix-closure.test: all assertions passed");
