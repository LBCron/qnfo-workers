import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// HEAVY-TICK-COHORT-GUARD-1: the snapshot trigger recomputes only when its row is 30 minutes old (or missing); the detector tells a stopped refresher.
const migration = readFileSync(new URL("./2026-11-04-heavy-tick-cohort-guard.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261104_cohort_snapshot_tick$/m);
assert.match(migration, /^-- Rollback: /m);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT);
  CREATE TABLE output_quality_cohort_snapshot (k INTEGER PRIMARY KEY CHECK (k = 1), computed_at TEXT NOT NULL, now_day TEXT, prev_day TEXT, subjects INTEGER, now_value REAL, prev_value REAL);
  CREATE TABLE raw_calls (n INTEGER);
  CREATE VIEW v_output_quality_remediation_cohort_raw AS SELECT '2026-11-04' AS now_day, '2026-10-28' AS prev_day, 41 AS subjects, 77.5 AS now_value, 70.0 AS prev_value;
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
  CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER,
    trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, next_due_at TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER);
  CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
    predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  -- the trigger as it stood before: a refresh on every heavy tick
  CREATE TRIGGER output_quality_cohort_snapshot_tick AFTER INSERT ON fleet_tick_heavy
  BEGIN
    INSERT OR REPLACE INTO output_quality_cohort_snapshot (k, computed_at, now_day, prev_day, subjects, now_value, prev_value)
    SELECT 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), now_day, prev_day, subjects, now_value, prev_value FROM v_output_quality_remediation_cohort_raw;
  END;
`);
const heavy = () => db.exec("INSERT INTO fleet_tick_heavy (source) VALUES ('test')");
const computedAt = () => db.prepare("SELECT computed_at FROM output_quality_cohort_snapshot WHERE k = 1").get()?.computed_at;
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString().replace(/\.\d+Z$/, "Z");

// Before: every heavy tick rewrites the snapshot.
heavy();
db.exec(`UPDATE output_quality_cohort_snapshot SET computed_at = '${ago(5)}'`);
heavy();
assert.ok(computedAt() > ago(1), "before: a 5-minute-old snapshot is recomputed on the next heavy tick");

db.exec(migration);
assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'output_quality_cohort_snapshot_tick'").get().sql, /WHEN NOT EXISTS/);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261104_cohort_snapshot_tick").get().n, 1, "the previous definition is backed up");

// After: a fresh snapshot is left alone, a stale or missing one is recomputed.
db.exec(`UPDATE output_quality_cohort_snapshot SET computed_at = '${ago(5)}'`);
heavy();
assert.equal(computedAt(), ago(5), "a 5-minute-old snapshot is not recomputed");
db.exec(`UPDATE output_quality_cohort_snapshot SET computed_at = '${ago(29)}'`);
heavy();
assert.equal(computedAt(), ago(29), "a 29-minute-old snapshot is not recomputed");
db.exec(`UPDATE output_quality_cohort_snapshot SET computed_at = '${ago(31)}', subjects = 0`);
heavy();
assert.ok(computedAt() > ago(1), "a 31-minute-old snapshot is recomputed");
assert.equal(db.prepare("SELECT subjects FROM output_quality_cohort_snapshot").get().subjects, 41, "with the raw view's values");
db.exec("DELETE FROM output_quality_cohort_snapshot");
heavy();
assert.ok(computedAt() > ago(1), "a missing snapshot is recomputed");

// Detector: fresh reads 0, a snapshot older than 75 minutes or missing reads 1.
const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-cohort-snapshot-stale'").get().verify_probe;
assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "0", observed: "0" });
db.exec(`UPDATE output_quality_cohort_snapshot SET computed_at = '${ago(80)}'`);
assert.equal(db.prepare(probe).get().observed, "1");
db.exec("DELETE FROM output_quality_cohort_snapshot");
assert.equal(db.prepare(probe).get().observed, "1");

// Replay is idempotent.
db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 1);
db.close();
console.log("heavy-tick-cohort-guard: all passed");
