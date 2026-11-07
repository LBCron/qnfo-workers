#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

// Test 2026-11-07-fix-column-mismatch.sql migration
// Validates:
// 1. Uses only columns that exist in remediation_contracts schema
// 2. Uses only columns that exist in metric_registry schema
// 3. Correctly restores companion UI probes with required columns
// 4. Correctly supersedes voice STT contract
// 5. Correctly restores research metric
// 6. Idempotent - can run multiple times safely

const sql = readFileSync("migrations/2026-11-07-fix-column-mismatch.sql", "utf8");

// Create database with ACTUAL production schemas from ab-length-retry.test.mjs
const db = new DatabaseSync(":memory:");

// ACTUAL remediation_contracts schema (verified from ab-length-retry.test.mjs line 92)
db.exec(`
CREATE TABLE remediation_contracts (
  class TEXT PRIMARY KEY,
  issue_id INTEGER,
  precondition TEXT NOT NULL,
  action TEXT NOT NULL,
  verify_probe TEXT NOT NULL,
  verify_transport TEXT NOT NULL,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  escalate_to TEXT NOT NULL,
  expected_cadence_h INTEGER,
  status TEXT DEFAULT 'active',
  ts TEXT DEFAULT (datetime('now')),
  last_attempt_at TEXT,
  last_verdict TEXT,
  module TEXT,
  budget_ms INTEGER DEFAULT 45000,
  next_due_at TEXT,
  max_items INTEGER DEFAULT 5,
  requires_container INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  deferred_since TEXT
);

CREATE TABLE metric_registry (
  metric TEXT PRIMARY KEY,
  last_value TEXT
);

CREATE TABLE metric_breach_cause (
  metric TEXT,
  cause TEXT,
  action_template TEXT,
  PRIMARY KEY (metric, cause)
);

-- Insert a voice STT contract to test UPDATE
INSERT INTO remediation_contracts (
  class, issue_id, precondition, action, verify_probe,
  verify_transport, max_attempts, escalate_to, status
) VALUES (
  'rt-live-voice-stt', 8501, 'TRUE', 'file_issue',
  '{"url": "https://example.com"}', 'runner-https', 3, 'owner', 'active'
);
`);

// Extract SQL statements (skip comments and headers)
const lines = sql.split("\n");
const stmtLines = [];
let inHeader = true;

for (const line of lines) {
  const trimmed = line.trim();
  if (inHeader && (trimmed.startsWith("--") || trimmed === "")) {
    if (trimmed.startsWith("-- Issue")) {
      inHeader = false; // Headers end before first issue comment
    }
    continue;
  }
  inHeader = false;
  if (trimmed && !trimmed.startsWith("--")) {
    stmtLines.push(line);
  }
}

const stmtText = stmtLines.join("\n");
const stmts = stmtText.split(";").map(s => s.trim()).filter(s => s);

console.log(`Parsed ${stmts.length} statements from migration`);

// Test 1: Validate statement count and types
ok(stmts.length === 5, `Expected 5 statements, got ${stmts.length}`);
ok(stmts[0].startsWith("INSERT OR REPLACE INTO remediation_contracts"), "Statement 1 is companion UI runtime probe");
ok(stmts[1].startsWith("INSERT OR REPLACE INTO remediation_contracts"), "Statement 2 is companion UI code probe");
ok(stmts[2].startsWith("UPDATE remediation_contracts"), "Statement 3 is voice STT supersession");
ok(stmts[3].startsWith("INSERT OR REPLACE INTO metric_registry"), "Statement 4 is research metric");
ok(stmts[4].startsWith("INSERT OR IGNORE INTO metric_breach_cause"), "Statement 5 is metric breach cause");

// Test 2: Run migration (should succeed with correct column names)
try {
  for (let i = 0; i < stmts.length; i++) {
    db.exec(stmts[i]);
  }
  console.log("✓ Migration executed successfully");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  throw err;
}

// Test 3: Verify companion UI probes were inserted
const runtimeProbe = db.prepare(
  "SELECT * FROM remediation_contracts WHERE class = ?"
).get("issue-8495-runtime");

ok(runtimeProbe !== undefined, "Runtime probe exists");
ok(runtimeProbe.issue_id === 8495, "Runtime probe has correct issue_id");
ok(runtimeProbe.verify_transport === "runner-https", "Runtime probe has correct transport");
ok(runtimeProbe.expected_cadence_h === 1, "Runtime probe has correct cadence");
ok(runtimeProbe.status === "active", "Runtime probe is active");
ok(JSON.parse(runtimeProbe.verify_probe).absent === "For the Quniverse", "Runtime probe has correct absent text");
console.log("✓ Runtime probe verified");

const codeProbe = db.prepare(
  "SELECT * FROM remediation_contracts WHERE class = ?"
).get("issue-8495-code");

ok(codeProbe !== undefined, "Code probe exists");
ok(codeProbe.issue_id === 8495, "Code probe has correct issue_id");
ok(codeProbe.verify_transport === "code-read", "Code probe has correct transport");
ok(JSON.parse(codeProbe.verify_probe).paths[0] === "personal-api/worker.js", "Code probe has correct path");
console.log("✓ Code probe verified");

// Test 4: Verify voice STT contract was superseded
const voiceContract = db.prepare(
  "SELECT * FROM remediation_contracts WHERE class = ?"
).get("rt-live-voice-stt");

ok(voiceContract !== undefined, "Voice contract still exists");
ok(voiceContract.status === "removed", "Voice contract status is 'removed'");
console.log("✓ Voice STT contract superseded");

// Test 5: Verify research metric was inserted
const metric = db.prepare(
  "SELECT * FROM metric_registry WHERE metric = ?"
).get("research_deferred_pool_pct");

ok(metric !== undefined, "Research metric exists");
ok(metric.last_value === "0", "Research metric has correct initial value");
console.log("✓ Research metric verified");

// Test 6: Verify metric breach cause was inserted
const cause = db.prepare(
  "SELECT * FROM metric_breach_cause WHERE metric = ?"
).get("research_deferred_pool_pct");

ok(cause !== undefined, "Metric breach cause exists");
ok(cause.cause === "research-execution", "Breach cause is correct");
ok(cause.action_template.includes("deferred_since"), "Action template references deferred_since");
console.log("✓ Metric breach cause verified");

// Test 7: Idempotency - run migration again
try {
  for (let i = 0; i < stmts.length; i++) {
    db.exec(stmts[i]);
  }
  console.log("✓ Migration is idempotent");
} catch (err) {
  console.error("✗ Second run failed:", err.message);
  throw err;
}

// Test 8: Verify no hit_action or description columns were referenced in SQL statements
ok(!stmtText.includes("hit_action"), "Migration does not reference non-existent hit_action column");
ok(!stmtText.match(/description\s*,/), "Migration does not reference non-existent description column");
console.log("✓ No non-existent columns referenced");

console.log("\n✓ All tests passed!");
