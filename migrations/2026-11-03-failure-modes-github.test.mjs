import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./2026-11-03-failure-modes-github.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
const keys = [
  "fm-github-user-quota-exhausted",
  "fm-committed-credential",
  "fm-codeql-setup-failed",
  "fm-no-security-policy",
  "fm-workflow-token-default-write",
  "fm-licence-ref-stale",
  "fm-copilot-credits-exhausted",
  "fm-copilot-assignment-starved",
];

assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.ok(rollback);
assert.match(migration, /PORTFOLIO-STANDARDS-1/);
assert.match(migration, /probe transports[\s\S]*cannot read the GitHub data directly/);

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE failure_modes (
    fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL,
    remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT,
    first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT,
    symptom TEXT, blast_radius TEXT
  );
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT,
    verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER,
    escalate_to TEXT, expected_cadence_h REAL, status TEXT, module TEXT
  );
`);

db.exec(migration.replace(/^--.*$/gm, ""));
db.exec(migration.replace(/^--.*$/gm, ""));
const registered = db.prepare("SELECT fm_key, probe_class FROM failure_modes ORDER BY fm_key").all();
assert.deepEqual(registered.map(({ fm_key }) => fm_key), [...keys].sort());
assert.ok(registered.every(({ probe_class }) => /^fm-/.test(probe_class)));

const contracts = db.prepare("SELECT class, verify_probe, verify_transport, precondition FROM remediation_contracts ORDER BY class").all();
assert.deepEqual(contracts.map(({ class: name }) => name), [...keys].sort());
assert.ok(contracts.every(({ verify_transport, precondition }) => verify_transport === "d1-query" && precondition.includes("PORTFOLIO-STANDARDS-1")));
for (const { verify_probe } of contracts) {
  const result = db.prepare(verify_probe).get();
  assert.equal(result.expected, "1");
  assert.equal(result.observed, "1");
}

db.exec(rollback);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0);
db.close();

console.log("failure-modes-github: 8 registrations, 8 contracts, idempotency, and rollback passed");
