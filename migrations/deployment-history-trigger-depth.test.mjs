import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-02-deployment-history-trigger-depth.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE deployment_history (
    id INTEGER PRIMARY KEY,
    resource_type TEXT,
    resource_name TEXT,
    version_id TEXT,
    notes TEXT,
    deployed_at TEXT,
    deployed_by TEXT,
    status TEXT
  );
  CREATE TABLE fleet_tick_heavy (id INTEGER PRIMARY KEY, source TEXT);
  CREATE TABLE fleet_deploys (
    worker TEXT, actor TEXT, to_sha TEXT, source_path TEXT, ok INTEGER, note TEXT, ts TEXT
  );
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT);
  CREATE TABLE decision_log (
    actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
    rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
  CREATE TRIGGER deployment_history_deployed_at_norm_ins
    AFTER INSERT ON deployment_history
    WHEN NEW.deployed_at IS NOT NULL AND instr(NEW.deployed_at, 'T') = 0
    BEGIN
      UPDATE deployment_history
      SET deployed_at = replace(NEW.deployed_at, ' ', 'T') || '.000Z'
      WHERE id = NEW.id;
    END;
  CREATE TRIGGER deployment_history_mirrors_fleet_deploys_ins
    AFTER INSERT ON deployment_history
    WHEN NEW.resource_type = 'worker' AND NEW.resource_name IS NOT NULL AND NEW.version_id IS NOT NULL
    BEGIN
      INSERT INTO fleet_deploys (worker, actor, to_sha, source_path, ok, note, ts)
      VALUES (NEW.resource_name, COALESCE(NEW.deployed_by, 'deployment_history'), NEW.version_id,
        'deployment_history', NEW.status = 'success', 'MIRRORED-FROM-DEPLOYMENT-HISTORY-1',
        COALESCE(NEW.deployed_at, datetime('now')));
    END;
  CREATE TRIGGER deployment_history_provenance_required_ins
    BEFORE INSERT ON deployment_history
    WHEN NEW.notes IS NULL OR trim(NEW.notes) = ''
    BEGIN SELECT RAISE(ABORT, 'deploy-ledger-row-without-provenance'); END;
  CREATE TRIGGER deployment_history_version_monotonic_ins
    BEFORE INSERT ON deployment_history
    WHEN NEW.version_id < (SELECT MAX(version_id) FROM deployment_history WHERE resource_name = NEW.resource_name)
      AND instr(COALESCE(NEW.notes, ''), 'ROLLBACK-OK') = 0
    BEGIN SELECT RAISE(ABORT, 'VERSION-MONOTONIC-1: version regresses'); END;
  CREATE TRIGGER version_regression_files_issue_ins
    AFTER INSERT ON deployment_history
    WHEN NEW.resource_type = 'worker'
    BEGIN
      INSERT INTO agent_issues (title, description)
      VALUES ('VERSION-LITERAL-NOT-MONOTONIC-1: ' || NEW.resource_name, 'version regression');
    END;
`);

const originalSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='version_regression_files_issue_ins'").get().sql;
db.exec(migration);

assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='version_regression_files_issue_ins'").get().n, 0,
  "the nested issue-filer trigger is removed");
assert.equal(db.prepare("SELECT sql FROM bak_20261102_deployment_history_depth_trigger WHERE name='version_regression_files_issue_ins'").get().sql, originalSql,
  "the removed trigger definition is preserved for rollback");
for (const name of [
  "deployment_history_deployed_at_norm_ins",
  "deployment_history_mirrors_fleet_deploys_ins",
  "deployment_history_provenance_required_ins",
  "deployment_history_version_monotonic_ins",
]) {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name),
    `${name} remains installed`);
}

db.exec('INSERT INTO "deployment_history" SELECT * FROM "deployment_history" WHERE 0');
db.exec('INSERT INTO "fleet_tick_heavy" SELECT * FROM "fleet_tick_heavy" WHERE 0');

db.prepare(`INSERT INTO deployment_history
  (resource_type, resource_name, version_id, notes, deployed_at, status)
  VALUES ('worker', 'qnfo-test', '1.0.0', 'routine deploy', '2026-11-02 12:00:00', 'success')`).run();
assert.equal(db.prepare("SELECT deployed_at FROM deployment_history WHERE resource_name='qnfo-test'").get().deployed_at,
  "2026-11-02T12:00:00.000Z", "deployment timestamp normalization remains active");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fleet_deploys WHERE worker='qnfo-test'").get().n, 1,
  "deployment mirroring remains active");

assert.throws(() => db.prepare(`INSERT INTO deployment_history
  (resource_type, resource_name, version_id, notes, status)
  VALUES ('worker', 'qnfo-test', '0.9.0', 'routine deploy', 'success')`).run(),
/VERSION-MONOTONIC-1/);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n, 0,
  "the BEFORE monotonic guard blocks a regression before any issue-filing AFTER trigger");

db.exec(migration);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bak_20261102_deployment_history_depth_trigger").get().n, 1,
  "reapplying the migration preserves its original rollback backup");

console.log("deployment-history-trigger-depth: passed");
