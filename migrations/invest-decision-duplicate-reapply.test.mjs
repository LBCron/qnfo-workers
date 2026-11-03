import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const migrationPath = join(here, "2026-11-01-invest-decision-duplicate.sql");
const sql = readFileSync(migrationPath, "utf8");

assert.match(sql, /^-- REAPPLY-OK: .+/m);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, close_channel TEXT, updated_at TEXT);
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT);
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, precondition TEXT,
    action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT,
    expected_cadence_h INTEGER, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER
  );
  CREATE TABLE decision_log (
    actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT,
    rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT
  );
  CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT,
    probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT
  );
  CREATE TABLE migration_runs (file TEXT, status TEXT);
  CREATE TRIGGER issue_triage_close_while_contract_fails
  BEFORE UPDATE OF triage_state ON issue_triage
  WHEN NEW.triage_state = 'closed' AND EXISTS (
    SELECT 1 FROM remediation_contracts
    WHERE issue_id = NEW.issue_id AND status IN ('active', 'holding')
  )
  BEGIN
    SELECT RAISE(ABORT, 'close-while-contract-fails');
  END;
  INSERT INTO agent_issues (id, status, close_channel, updated_at) VALUES
    (1836, 'open', NULL, 'before'), (2124, 'open', NULL, 'before');
  INSERT INTO issue_triage (issue_id, triage_state, close_evidence) VALUES (2124, 'triaged', 'old evidence');
  INSERT INTO remediation_contracts (class, issue_id, status, last_verdict)
    VALUES ('issue-2124', 2124, 'active', 'fail');
  INSERT INTO migration_runs (file, status)
    VALUES ('migrations/2026-11-01-invest-decision-duplicate.sql', 'failed');
`);

const backupStart = sql.indexOf("CREATE TABLE IF NOT EXISTS bak_20261101_invest_decision_duplicate");
const backupEnd = sql.indexOf(";", backupStart) + 1;
assert.ok(backupStart >= 0 && backupEnd > backupStart, "migration has its expected backup statement");
db.exec(sql.slice(backupStart, backupEnd));

db.exec(sql);
assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-2124'").get().status, "superseded");
assert.equal(db.prepare("SELECT triage_state FROM issue_triage WHERE issue_id = 2124").get().triage_state, "closed");
assert.match(db.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id = 2124").get().close_evidence, /^superseded by agent_issues 1836/);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes WHERE fm_key = 'migration-close-before-contract-retire'").get().n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'fm-migration-close-before-contract-retire'").get().n, 1);
const detector = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-migration-close-before-contract-retire'").get();
db.prepare("INSERT INTO migration_runs (file, status) VALUES (?, 'ok')").run("migrations/2026-11-01-invest-decision-duplicate.sql");
const probe = db.prepare(detector.verify_probe).get();
assert.equal(probe.expected, probe.observed, "the failure-mode probe recognizes a successful reapply after the recorded failure");

db.exec(sql);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "the corrected partial migration can be retried idempotently");

const check = spawnSync("python3", [join(root, "scripts", "apply_migrations.py"), "--check", migrationPath], { encoding: "utf8", cwd: root });
assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);

console.log("invest decision duplicate reapply tests passed");
