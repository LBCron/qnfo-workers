import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-code-loop-cost-route.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.*)$/m)?.[1];

assert.ok(rollback);
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- BACKUP: bak_20261102_code_loop_cost_route$/m);

function setup(withConfig = true) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE ops_config (
      key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE control_registry (
      control TEXT PRIMARY KEY, evidence TEXT, reviewed_at TEXT
    );
    CREATE TABLE decision_log (
      actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT,
      blast_radius TEXT, rollback_path TEXT, capability_gain TEXT,
      predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
    );
    INSERT INTO control_registry VALUES ('code-loop-daily-calls', 'prior control evidence', '2026-10-19T00:00:00Z');
  `);
  if (withConfig) {
    db.prepare("INSERT INTO ops_config (key, value, note, updated_at) VALUES (?, ?, ?, ?)")
      .run("code_loop_daily_calls", "140", "prior config note", "2026-10-24T15:10:00Z");
  }
  return db;
}

for (const withConfig of [true, false]) {
  const db = setup(withConfig);
  db.exec(migration);

  const config = db.prepare("SELECT value, note FROM ops_config WHERE key = 'code_loop_daily_calls'").get();
  assert.equal(config.value, "10", "the existing soft route starts after ten calls");
  assert.match(config.note, /bounded fallback, verifier and publication gates continue/);
  assert.match(db.prepare("SELECT evidence FROM control_registry WHERE control = 'code-loop-daily-calls'").get().evidence,
    /CODE-LOOP-SOFT-BUDGET-COST-ROUTE-1/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);

  const firstEvidence = db.prepare("SELECT evidence FROM control_registry WHERE control = 'code-loop-daily-calls'").get().evidence;
  db.exec(migration);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "reapplying does not duplicate the decision");
  assert.equal(db.prepare("SELECT evidence FROM control_registry WHERE control = 'code-loop-daily-calls'").get().evidence,
    firstEvidence, "reapplying does not duplicate the control evidence");

  db.exec(rollback);
  const restored = db.prepare("SELECT value, note, updated_at FROM ops_config WHERE key = 'code_loop_daily_calls'").get();
  if (withConfig) {
    assert.deepEqual({ ...restored }, {
      value: "140", note: "prior config note", updated_at: "2026-10-24T15:10:00Z"
    });
  } else {
    assert.equal(restored, undefined, "rollback removes only the config row it introduced");
  }
  assert.deepEqual({ ...db.prepare("SELECT evidence, reviewed_at FROM control_registry WHERE control = 'code-loop-daily-calls'").get() },
    { evidence: "prior control evidence", reviewed_at: "2026-10-19T00:00:00Z" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision_log remains append-only");
  db.close();
}

console.log("code-loop-cost-route: all passed");
