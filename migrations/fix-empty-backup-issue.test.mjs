// Test for migrations/2026-11-07-fix-empty-backup-issue.sql
// Validates fixes for BACKUP-SELF-EMPTY-1 failure from PR #8537

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const db = new DatabaseSync(':memory:');

// Create tables with production schemas (from ab-length-retry.test.mjs line 92)
db.exec(`
  CREATE TABLE IF NOT EXISTS remediation_contracts (
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
    deferred_since TEXT,
    description TEXT,
    hit_action TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS metric_registry (
    metric TEXT PRIMARY KEY,
    query TEXT,
    threshold REAL,
    direction TEXT,
    owner TEXT,
    cadence_min INTEGER,
    state TEXT,
    description TEXT,
    kind TEXT,
    last_value TEXT
  )
`);

// Create metric_breach_cause table
db.exec(`
  CREATE TABLE IF NOT EXISTS metric_breach_cause (
    metric_key TEXT NOT NULL,
    cause_key TEXT NOT NULL,
    PRIMARY KEY (metric_key, cause_key)
  )
`);

// Create fleet_tick table for trigger test
db.exec(`
  CREATE TABLE IF NOT EXISTS fleet_tick (
    tick_id INTEGER PRIMARY KEY,
    phase TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create personal_replies table for retention test
db.exec(`
  CREATE TABLE IF NOT EXISTS personal_replies (
    id INTEGER PRIMARY KEY,
    content TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Read and apply the migration
const migration = readFileSync('migrations/2026-11-07-fix-empty-backup-issue.sql', 'utf-8');

// Remove comment lines
const withoutComments = migration
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

// Split on semicolons, but preserve trigger bodies (split on END; not inner semicolons)
const statements = [];
let currentStmt = '';
let inTrigger = false;

for (const line of withoutComments.split('\n')) {
  currentStmt += line + '\n';
  
  if (line.trim().toUpperCase().startsWith('CREATE TRIGGER')) {
    inTrigger = true;
  }
  
  if (inTrigger && line.trim() === 'END;') {
    statements.push(currentStmt.trim());
    currentStmt = '';
    inTrigger = false;
  } else if (!inTrigger && line.trim().endsWith(';')) {
    statements.push(currentStmt.trim());
    currentStmt = '';
  }
}

// Apply each statement
for (const stmt of statements.filter(s => s.length > 0)) {
  try {
    db.exec(stmt);
  } catch (err) {
    console.error(`Failed to execute statement: ${stmt.substring(0, 100)}...`);
    throw err;
  }
}

// TEST 1: Verify companion-ui-regression-guard contracts inserted with correct column
const runtimeProbe = db.prepare('SELECT * FROM remediation_contracts WHERE class = ?').get('issue-8495-runtime');
assert.ok(runtimeProbe, 'Runtime probe should exist');
assert.strictEqual(runtimeProbe.expected_cadence_h, 1, 'Runtime probe should have expected_cadence_h = 1');
assert.strictEqual(runtimeProbe.status, 'active', 'Runtime probe should be active');
assert.ok(runtimeProbe.verify_probe.includes('me.q08.org/companion'), 'Runtime probe should check companion URL');

const codeProbe = db.prepare('SELECT * FROM remediation_contracts WHERE class = ?').get('issue-8495-code');
assert.ok(codeProbe, 'Code probe should exist');
assert.strictEqual(codeProbe.expected_cadence_h, 1, 'Code probe should have expected_cadence_h = 1');
assert.strictEqual(codeProbe.status, 'active', 'Code probe should be active');

// TEST 2: Verify voice STT probe would be removed (if it existed)
// Since we don't create it in this test, just verify the UPDATE statement compiled
// In production, this will set status='removed' for class='rt-live-voice-stt'

// TEST 3: Verify research_deferred_pool_pct metric inserted with correct column name
const metric = db.prepare('SELECT * FROM metric_registry WHERE metric = ?').get('research_deferred_pool_pct');
assert.ok(metric, 'research_deferred_pool_pct metric should exist');
assert.strictEqual(metric.threshold, 15.0, 'Metric threshold should be 15.0');
assert.strictEqual(metric.direction, 'below', 'Metric direction should be below');
assert.strictEqual(metric.state, 'active', 'Metric should be active');

// TEST 4: Verify metric breach cause mapping
const cause = db.prepare('SELECT * FROM metric_breach_cause WHERE metric_key = ?').get('research_deferred_pool_pct');
assert.ok(cause, 'Breach cause mapping should exist');
assert.strictEqual(cause.cause_key, 'research-pipeline', 'Cause should be research-pipeline');

// TEST 5: Verify retention trigger was created
const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get('retention_personal_replies_tick_v1');
assert.ok(triggers, 'Retention trigger should exist');

// TEST 6: Test idempotency - run migration again
for (const stmt of statements) {
  try {
    db.exec(stmt);
  } catch (err) {
    console.error(`Failed idempotency test on: ${stmt.substring(0, 100)}...`);
    throw err;
  }
}

// Verify counts didn't change (idempotency check)
const probeCount = db.prepare("SELECT COUNT(*) as cnt FROM remediation_contracts WHERE class LIKE 'issue-8495-%'").get().cnt;
assert.strictEqual(probeCount, 2, 'Should still have exactly 2 companion-ui probes after re-run');

const metricCount = db.prepare("SELECT COUNT(*) as cnt FROM metric_registry WHERE metric = 'research_deferred_pool_pct'").get().cnt;
assert.strictEqual(metricCount, 1, 'Should still have exactly 1 research_deferred_pool_pct metric after re-run');

db.close();

console.log('fix-empty-backup-issue: All tests passed ✓');
console.log('  ✓ Companion UI probes inserted with correct expected_cadence_h column');
console.log('  ✓ Voice STT probe removal UPDATE compiled');
console.log('  ✓ Research deferred pool metric inserted with correct metric column');
console.log('  ✓ Metric breach cause mapping created');
console.log('  ✓ Retention trigger created');
console.log('  ✓ Idempotency verified - safe to run multiple times');
