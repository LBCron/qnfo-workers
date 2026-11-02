import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const migration = readFileSync(new URL("./2026-11-02-probe-needed-issue-1001216.sql", import.meta.url), "utf8");
const rollback = migration.match(/^-- Rollback: (.+)$/m)?.[1];
const probe = {
  paths: ["ci-status/applier-doctor.json"],
  contains: '"marker": "APPLIER-DOCTOR-2"',
  absent: '"scripts/patch-sync-version-capture-1.py"',
};
const probeText = JSON.stringify(probe);

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
    CREATE TABLE remediation_contracts (
      class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL,
      verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3,
      escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active',
      ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT,
      budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5,
      requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT
    );
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT,
      outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT,
      reach_gain TEXT, surfaces_tested TEXT
    );
  `);
  return db;
}

function seed(db, { status = "open", contract = true, contractStatus = "superseded" } = {}) {
  db.prepare("INSERT INTO agent_issues VALUES (1001216, ?)").run(status);
  if (contract) {
    db.prepare(`
      INSERT INTO remediation_contracts
        (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts,
         escalate_to, expected_cadence_h, status, ts, last_attempt_at, last_verdict, module,
         budget_ms, next_due_at, max_items, requires_container, attempts, deferred_since)
      VALUES ('issue-1001216', 1001216, 'old precondition', 'old action', 'old probe', 'd1-query',
        3, 'qnfo-fleet-control', 1, ?, '2026-11-01 17:20:00', '2026-11-01 17:21:00',
        'superseded:old', 'probe-template-v3-generic', 45000, '2026-11-01 17:20:00',
        5, 0, 7, '2026-11-01 17:20:00')
    `).run(contractStatus);
  }
}

function runCodeProbe(spec, root) {
  const code = [
    "import json, sys",
    "sys.path.insert(0, sys.argv[1])",
    "import remediation_consumer as rc",
    "probe, error = rc.parse_code_probe(sys.argv[2])",
    "print(json.dumps({'error': error, 'observed': rc.run_code_probe(probe, sys.argv[3]) if probe else None}))",
  ].join("; ");
  const result = spawnSync("python3", ["-c", code, fileURLToPath(new URL("../scripts/", import.meta.url)), spec, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

assert.ok(rollback, "migration has a rollback line");
const db = database();
seed(db);
db.exec(migration.replace(/^--.*$/gm, ""));

const updated = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001216'").get();
assert.equal(updated.status, "active");
assert.equal(updated.verify_transport, "code-read");
assert.equal(updated.verify_probe, probeText);
assert.equal(updated.last_verdict, null);
assert.equal(updated.attempts, 0);
assert.equal(updated.deferred_since, null);
assert.match(updated.next_due_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
assert.equal(updated.max_attempts, 24);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
assert.ok(!/agent_issues|1001216/.test(updated.verify_probe), "probe never reads the issue status");

const root = mkdtempSync(join(tmpdir(), "probe-needed-1001216-"));
try {
  mkdirSync(join(root, "ci-status"));
  const reportPath = join(root, "ci-status", "applier-doctor.json");
  writeFileSync(reportPath, '{"counts": {}, "errored": [], "marker": "APPLIER-DOCTOR-2", "never_landed": [], "stale_anchor": [], "superseded": [], "undetermined": []}');
  assert.deepEqual(runCodeProbe(updated.verify_probe, root), { error: null, observed: "ok" });

  writeFileSync(reportPath, '{"counts": {}, "errored": ["scripts/patch-sync-version-capture-1.py"], "marker": "APPLIER-DOCTOR-2", "never_landed": [], "stale_anchor": [], "superseded": [], "undetermined": []}');
  assert.deepEqual(runCodeProbe(updated.verify_probe, root), { error: null, observed: "present-marker:ci-status/applier-doctor.json" });

  writeFileSync(reportPath, '{"counts": {}, "errored": [], "marker": "APPLIER-DOCTOR-1", "never_landed": [], "stale_anchor": [], "superseded": [], "undetermined": []}');
  assert.deepEqual(runCodeProbe(updated.verify_probe, root), { error: null, observed: "missing-marker:ci-status/applier-doctor.json" });
} finally {
  rmSync(root, { recursive: true, force: true });
}

db.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "migration replay is idempotent");

db.exec(rollback);
const restored = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1001216'").get();
assert.equal(restored.status, "superseded");
assert.equal(restored.verify_transport, "d1-query");
assert.equal(restored.verify_probe, "old probe");
assert.equal(restored.last_verdict, "superseded:old");
assert.equal(restored.attempts, 7);
assert.equal(restored.deferred_since, "2026-11-01 17:20:00");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "decision ledger remains append-only");

const missing = database();
seed(missing, { contract: false });
missing.exec(migration.replace(/^--.*$/gm, ""));
assert.equal(missing.prepare("SELECT status FROM remediation_contracts WHERE class = 'issue-1001216'").get().status, "active");
missing.exec(rollback);
assert.equal(missing.prepare("SELECT COUNT(*) AS n FROM remediation_contracts").get().n, 0, "rollback removes a migration-created contract");

for (const options of [
  { status: "closed" },
  { contractStatus: "monitoring" },
]) {
  const untouched = database();
  seed(untouched, options);
  const before = untouched.prepare("SELECT * FROM remediation_contracts").get();
  untouched.exec(migration.replace(/^--.*$/gm, ""));
  assert.deepEqual(untouched.prepare("SELECT * FROM remediation_contracts").get(), before, JSON.stringify(options));
  assert.equal(untouched.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 0, JSON.stringify(options));
}

console.log("probe-needed-issue-1001216: all assertions passed");
