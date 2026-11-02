// Run: node migrations/triage-close-trigger-order.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const migration = read("./2026-11-02-triage-close-trigger-order.sql");
const triggers = (file) => read(file).match(/^CREATE TRIGGER[\s\S]*?END;/gm).join("\n");
const retirement = triggers("./2026-10-12-superseded-closure-holds.sql");
const sync = triggers("./2026-10-21-triage-sync-close-channel.sql");
const guard = triggers("./2026-10-18-close-binds-to-probe.sql");
const statuses = ["active", "holding", "needs-machine-probe", "probe-review-refused", "superseded", "retired"];
let checks = 0;

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA recursive_triggers = ON;
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT, close_channel TEXT, updated_at INTEGER);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT, owner TEXT);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT, last_attempt_at TEXT,
      precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
      escalate_to TEXT, expected_cadence_h INTEGER, module TEXT);
    CREATE TABLE failure_modes (
      fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT,
      probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
  `);
  db.exec(retirement + guard + sync);
  return db;
}

function seed(db, insert, channel = null, verdict = "fail") {
  db.prepare("INSERT INTO agent_issues VALUES (1, 'open', ?, 1)").run(channel);
  db.exec("INSERT INTO agent_issues VALUES (2, 'open', NULL, 1)");
  if (!insert) db.exec("INSERT INTO issue_triage VALUES (1, 'open', NULL, 'test')");
  for (const status of statuses) {
    db.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict) VALUES (?, 1, ?, ?)").run(status, status, verdict);
  }
  db.exec("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict) VALUES ('other', 2, 'active', 'fail')");
}

function close(db, insert, evidence, state = "closed", owner = "test") {
  if (insert) {
    db.prepare("INSERT INTO issue_triage VALUES (1, ?, ?, ?)").run(state, evidence, owner);
  } else {
    db.prepare("UPDATE issue_triage SET triage_state = ?, close_evidence = ?, owner = ? WHERE issue_id = 1").run(state, evidence, owner);
  }
}

// Prove the original defect on both paths using the historical trigger definitions.
for (const insert of [false, true]) {
  const db = fixture();
  seed(db, insert);
  assert.throws(() => close(db, insert, "superseded by #2"), /close-while-contract-fails/);
  db.close();
  checks++;
}

for (const insert of [false, true]) {
  for (const retireFirst of [false, true]) {
    for (const evidence of ["superseded by #2", "SUPERSEDED BY #2", "moot: duplicate", "Moot: duplicate"]) {
      const db = fixture();
      db.exec(migration);
      if (retireFirst) {
        db.exec("DROP TRIGGER triage_superseded_contracts_upd; DROP TRIGGER triage_superseded_contracts_ins;");
        db.exec(retirement);
      }
      seed(db, insert);
      close(db, insert, evidence);
      const issue = db.prepare("SELECT * FROM agent_issues WHERE id = 1").get();
      assert.equal(issue.status, "closed");
      assert.equal(issue.close_channel, "auto:triage-sync:test");
      assert.ok(issue.updated_at > 1);
      for (const status of statuses) {
        const contract = db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get(status);
        const retired = statuses.indexOf(status) < 4;
        assert.equal(contract.status, retired ? "superseded" : status);
        assert.equal(contract.last_verdict, retired ? "superseded:closure-superseded" : "fail");
        assert.equal(contract.last_attempt_at !== null, retired);
      }
      assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'other'").get().status, "active");
      // Reapplication preserves the original rollback snapshot and trigger count.
      const backup = db.prepare("SELECT sql FROM bak_20261102_triage_close_sync_triggers ORDER BY name").all();
      const count = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n;
      db.exec(migration);
      assert.deepEqual(db.prepare("SELECT sql FROM bak_20261102_triage_close_sync_triggers ORDER BY name").all(), backup);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'").get().n, count);
      const probe = db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = 'fm-triage-close-trigger-order'").get().verify_probe;
      assert.deepEqual({ ...db.prepare(probe).get() }, { expected: "2", observed: "2" });
      // The detector must reject the old trigger bodies.
      db.exec("DROP TRIGGER triage_close_sync_issue_upd; DROP TRIGGER triage_close_sync_issue_ins;");
      db.exec(sync);
      assert.equal(db.prepare(probe).get().observed, "0");
      db.close();
      checks++;
    }
  }
}

for (const insert of [false, true]) {
  for (const evidence of [null, "", "   ", "fixed", "now superseded by #2"]) {
    const db = fixture();
    db.exec(migration);
    seed(db, insert);
    assert.throws(() => close(db, insert, evidence), evidence === "fixed" || evidence?.startsWith("now ") ? /close-while-contract-fails/ : /close-without-evidence/);
    assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 1").get().status, "open");
    assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'active'").get().status, "active");
    assert.equal(db.prepare("SELECT triage_state FROM issue_triage WHERE issue_id = 1").get()?.triage_state, insert ? undefined : "open");
    db.close();
    checks++;
  }
  for (const state of ["closed", "closed-refuted", "wontfix"]) {
    const db = fixture();
    db.exec(migration);
    seed(db, insert, "session:original", state === "wontfix" ? "fail" : "pass");
    close(db, insert, "measured evidence", state);
    assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 1").get().status, state === "wontfix" ? "wontfix" : "closed");
    assert.equal(db.prepare("SELECT close_channel FROM agent_issues WHERE id = 1").get().close_channel, "session:original");
    assert.equal(db.prepare("SELECT status FROM remediation_contracts WHERE class = 'active'").get().status, "active");
    db.close();
    checks++;
  }
  for (const verdict of ["fail", "vacuous-probe-result", "probe-error", "probe-not-machine-executable", "probe-same-account-host"]) {
    const db = fixture();
    db.exec(migration);
    seed(db, insert, null, verdict);
    assert.throws(() => close(db, insert, "fixed"), /close-while-contract-fails/);
    assert.throws(() => close(db, insert, "superseded by #2", "closed-refuted"), /close-while-contract-fails/);
    close(db, insert, "superseded by #2", "closed", null);
    assert.equal(db.prepare("SELECT close_channel FROM agent_issues WHERE id = 1").get().close_channel, "auto:triage-sync");
    db.close();
    checks++;
  }
}

// Retirement is not delegated to a sibling trigger, and direct closes keep the guard.
{
  const db = fixture();
  db.exec(migration);
  db.exec("DROP TRIGGER triage_superseded_contracts_upd; DROP TRIGGER triage_superseded_contracts_ins;");
  seed(db, false);
  db.exec("UPDATE issue_triage SET close_evidence = 'superseded by #2' WHERE issue_id = 1");
  assert.throws(() => db.exec("UPDATE agent_issues SET status = 'closed' WHERE id = 1"), /close-while-contract-fails/);
  close(db, false, "superseded by #2");
  assert.equal(db.prepare("SELECT status FROM agent_issues WHERE id = 1").get().status, "closed");
  db.close();
  checks++;
}

console.log(`TRIGGER-ORDER-1: ${checks} cases passed`);
