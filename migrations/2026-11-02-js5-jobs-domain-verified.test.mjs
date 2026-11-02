import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./2026-11-02-js5-jobs-domain-verified.sql", import.meta.url), "utf8");
const probe = '{"url": "https://jobs.q08.org/health", "status": 200, "contains": "qnfo-jobsearch"}';

function world({ issueStatus = "closed", lastVerdict = "pass", probeText = probe, transport = "runner-https", age = "now" } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE roadmap_implementation (
      id INTEGER PRIMARY KEY,
      item TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence TEXT,
      verified_at TEXT
    );
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY,
      issue_id INTEGER,
      status TEXT,
      verify_transport TEXT,
      verify_probe TEXT,
      last_verdict TEXT,
      last_attempt_at TEXT
    );
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      assumption TEXT NOT NULL,
      action TEXT NOT NULL,
      evidence TEXT NOT NULL,
      outcome TEXT NOT NULL,
      blast_radius TEXT NOT NULL,
      rollback_path TEXT NOT NULL,
      capability_gain TEXT,
      predicted_outcome TEXT,
      reach_gain TEXT,
      surfaces_tested TEXT,
      outcome_matched INTEGER
    );
    CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log
    BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
    CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log
    BEGIN SELECT RAISE(ABORT, 'decision_log is append-only'); END;
    INSERT INTO roadmap_implementation
      (id, item, source, status, evidence, verified_at)
    VALUES (1676, 'JS-5', 'jobsearch-2026', 'planned',
      'agent_issues DOMAIN-PLANE-1:jobs.q08.org with a runtime-probe on /health', NULL);
  `);
  db.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (?, ?, ?, ?)")
    .run(1000582, "DOMAIN-PLANE-1:jobs.q08.org", `runtime-probe: ${probe}`, issueStatus);
  db.prepare(`INSERT INTO remediation_contracts
    (class, issue_id, status, verify_transport, verify_probe, last_verdict, last_attempt_at)
    VALUES ('issue-1000582', 1000582, 'holding', ?, ?, ?, datetime('now', ?))`)
    .run(transport, probeText, lastVerdict, age === "now" ? "-1 minutes" : age);
  return db;
}

const roadmap = (db) => db.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = 1676").get();

test("the passing recent route probe verifies JS-5 once and records the decision", () => {
  const db = world();
  assert.match(sql, /^-- APPLY-BY: ci$/m);
  assert.match(sql, /^-- DB: qnfo-audit$/m);
  assert.match(sql, /^-- BACKUP: bak_20261102_js5_jobs_domain_verified$/m);
  assert.match(sql, /^-- Rollback: .+/m);

  db.exec(sql);
  const row = roadmap(db);
  assert.equal(row.status, "verified");
  assert.match(row.evidence, /jobs\.q08\.org\/health probe \(HTTP 200, worker qnfo-jobsearch\)/);
  assert.ok(row.verified_at);
  const decision = db.prepare("SELECT * FROM decision_log").get();
  assert.equal(decision.capability_gain, "js5-owner-facing-domain-verified");
  assert.equal(decision.outcome_matched, 1);

  db.exec(sql);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM decision_log").get().count, 1);
});

test("a missing or failing close condition leaves JS-5 planned", () => {
  const conditions = [
    ["issue remains open", { issueStatus: "open" }],
    ["probe has not passed", { lastVerdict: "fail" }],
    ["probe is stale", { age: "-61 minutes" }],
    ["probe URL differs", { probeText: '{"url": "https://wrong.example/health"}' }],
    ["transport differs", { transport: "d1-query" }]
  ];
  for (const [label, options] of conditions) {
    const db = world(options);
    db.exec(sql);
    assert.equal(roadmap(db).status, "planned", label);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM decision_log").get().count, 0, label);
  }
});

test("rollback restores the original roadmap state and leaves the decision ledger intact", () => {
  const db = world();
  db.exec(sql);
  const rollback = sql.match(/^-- Rollback: (.+)$/m)?.[1];
  assert.ok(rollback);
  db.exec(rollback);

  assert.deepEqual(Object.fromEntries(Object.entries(roadmap(db))), {
    status: "planned",
    evidence: "agent_issues DOMAIN-PLANE-1:jobs.q08.org with a runtime-probe on /health",
    verified_at: null
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM decision_log").get().count, 1);
});
