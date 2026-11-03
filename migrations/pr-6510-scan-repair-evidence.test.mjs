// Run: node migrations/pr-6510-scan-repair-evidence.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const sql = readFileSync(new URL("./2026-11-03-pr-6510-scan-repair-evidence.sql", import.meta.url), "utf8");
const hygiene = readFileSync(new URL("./2026-10-26-issue-hygiene-1.sql", import.meta.url), "utf8");
const rollback = /^-- Rollback: (.*)$/m.exec(sql)[1];
const title = "STALE-PR-CHECK-REPAIR-1 PR 6510: scan failing on a green, quiet session pull request";

function world({ id = 1001429, status = "open", contract = "monitoring", module = "probe-template-v2d-loop", source = "qnfo-fleet-control", issueTitle = title } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, source TEXT, status TEXT, updated_at INTEGER, close_channel TEXT);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, reopened_count INTEGER, triaged_at TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, module TEXT, last_verdict TEXT, last_attempt_at TEXT);
    CREATE TABLE issue_lifecycle (issue_id INTEGER, from_status TEXT, to_status TEXT, evidence TEXT);
    CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues
    WHEN NEW.status = 'closed' AND OLD.status = 'open' BEGIN
      SELECT RAISE(ABORT, 'close-without-evidence') WHERE NOT EXISTS (
        SELECT 1 FROM issue_triage WHERE issue_id = NEW.id AND length(close_evidence) > 0);
      SELECT RAISE(ABORT, 'close-while-contract-fails') WHERE EXISTS (
        SELECT 1 FROM remediation_contracts WHERE issue_id = NEW.id AND status IN ('active', 'holding') AND last_verdict = 'fail');
    END;
    CREATE TRIGGER triage_close_sync_issue_upd AFTER UPDATE OF triage_state ON issue_triage
    WHEN NEW.triage_state = 'closed' BEGIN
      UPDATE agent_issues SET status = 'closed', updated_at = 999 WHERE id = NEW.issue_id AND status = 'open';
    END;
    CREATE TRIGGER issue_lifecycle_au AFTER UPDATE OF status ON agent_issues
    WHEN OLD.status <> NEW.status BEGIN
      INSERT INTO issue_lifecycle SELECT NEW.id, OLD.status, NEW.status, close_evidence FROM issue_triage WHERE issue_id = NEW.id;
    END;
  `);
  db.exec(/CREATE TABLE IF NOT EXISTS issue_fold_ledger \([\s\S]*?\);/.exec(hygiene)[0]);
  db.prepare("INSERT INTO agent_issues VALUES (?, ?, ?, ?, 123, NULL)").run(id, issueTitle, source, status);
  db.prepare("INSERT INTO issue_triage VALUES (?, 'triaged', NULL, 0, '2026-11-03 05:06:38')").run(id);
  db.prepare("INSERT INTO remediation_contracts VALUES (?, ?, ?, ?, 'monitoring:loop-owned-48h', NULL)").run("issue-" + id, id, contract, module);
  return db;
}

const snapshot = (db) => JSON.stringify(["agent_issues", "issue_triage", "remediation_contracts"].map((t) => db.prepare("SELECT * FROM " + t).all()));
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- BACKUP: issue_fold_ledger$/m);

const db = world();
const before = snapshot(db);
db.exec(sql);
assert.equal(db.prepare("SELECT status FROM agent_issues").get().status, "closed");
assert.equal(db.prepare("SELECT close_channel FROM agent_issues").get().close_channel, "workflow:ISSUE-HYGIENE-1 pr-6510-scan-repair-evidence");
const evidence = db.prepare("SELECT close_evidence FROM issue_triage").get().close_evidence;
for (const marker of ["234c678084020b7414e3d9a0e79b4c9d17498ea5", "125792262439", "2026-11-03T07:52:22Z", "version=3.50.0"]) assert.ok(evidence.includes(marker));
assert.equal(db.prepare("SELECT status FROM remediation_contracts").get().status, "superseded");
assert.equal(db.prepare("SELECT evidence FROM issue_lifecycle WHERE to_status = 'closed'").get().evidence, evidence);
const ledger = db.prepare("SELECT * FROM issue_fold_ledger").get();
assert.equal(ledger.applied, 1);
assert.equal(ledger.agent_updated_at, 123);
assert.equal(ledger.contract_status, "monitoring");
const after = snapshot(db);
db.exec(sql);
assert.equal(snapshot(db), after);
assert.equal(db.prepare("SELECT count(*) n FROM issue_fold_ledger").get().n, 1);
assert.equal(db.prepare("SELECT count(*) n FROM issue_lifecycle").get().n, 1);
db.exec(rollback);
assert.equal(snapshot(db), before);
db.exec(rollback);
assert.equal(snapshot(db), before);
db.exec(sql);
assert.equal(snapshot(db), before, "a later recurrence is not re-closed by replay");
db.close();

for (const options of [
  { id: 1001430 }, { status: "closed" }, { source: "other" },
  { issueTitle: title.replace("6510", "6511") },
  { contract: "active" }, { contract: "holding" }, { module: "replacement-probe" },
]) {
  const other = world(options);
  const unchanged = snapshot(other);
  other.exec(sql);
  assert.equal(snapshot(other), unchanged, JSON.stringify(options));
  assert.equal(other.prepare("SELECT count(*) n FROM issue_fold_ledger").get().n, 0);
  other.close();
}

const absent = world();
absent.exec("DELETE FROM agent_issues; DELETE FROM issue_triage; DELETE FROM remediation_contracts;");
absent.exec(sql);
assert.equal(absent.prepare("SELECT count(*) n FROM issue_fold_ledger").get().n, 0);
absent.close();
console.log("PR 6510 scan repair evidence: 0 failed");
