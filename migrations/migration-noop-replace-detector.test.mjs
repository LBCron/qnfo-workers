import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// NOOP-UPDATE-1 detector: reads 0 for a quiet day, 1 for a migration-noop-replace event in the last 24 hours, ignores the plain no-op kind and older rows; the probe is a covering index search.
const migration = readFileSync(new URL("./2026-11-04-migration-noop-replace-detector.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);
assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE)\b/im, "the migration must not itself be a no-op-prone UPDATE or a destructive file");
assert.doesNotMatch(migration, /CREATE TRIGGER/i, "detector only");

const T0 = Date.now();
const ago = (m) => new Date(T0 - m * 60000).toISOString().replace(/\.\d+Z$/, "Z");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE INDEX idx_coe_kind_ts ON cloud_ops_events(kind, ts);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
`);
db.exec(migration);
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-migration-noop-replace'").get().verify_probe;
const add = (id, kind, minutes) => db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?, ?, ?, 't', 'apply-migrations', 'warn')").run(id, ago(minutes), kind);

assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" }, "a quiet day reads 0");
add("a", "migration-noop-update", 5);
add("b", "migration-noop-replace", 60 * 25);
add("c", "gh-poke", 1);
assert.equal(db.prepare(probe).get().observed, "0", "the plain no-op kind, an event older than 24 hours and other kinds are ignored");
add("d", "migration-noop-replace", 90);
assert.equal(db.prepare(probe).get().observed, "1", "a replace() no-op 90 minutes ago trips it");
const plan = db.prepare("EXPLAIN QUERY PLAN " + probe).all().map((r) => r.detail).join(" | ");
assert.match(plan, /idx_coe_kind_ts/, "the probe is served by the kind/ts index: " + plan);

db.exec(migration);
for (const [t, n] of [["decision_log", 1], ["failure_modes", 1], ["remediation_contracts", 1]]) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, n, t + " replay is idempotent");
db.close();
console.log("migration-noop-replace-detector: all passed");
