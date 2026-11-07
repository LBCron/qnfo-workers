/**
 * Example migration test demonstrating BACKUP table validation (MIGRATION-TEST-BACKUP-CHECK-1)
 * 
 * This test shows how to use the test-utils.mjs BACKUP validation functions to
 * prevent the PR #8537 scenario (empty BACKUP table passing tests but failing in production).
 * 
 * Pattern for migration tests that have BACKUP headers:
 * 1. Extract BACKUP header from migration file
 * 2. Check if migration has row-destructive statements (DELETE FROM, DROP TABLE)
 * 3. Before applying migration, validate backup table exists and is non-empty
 * 
 * Run: node migrations/backup-validation-example.test.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { 
  extractBackupHeader, 
  hasRowDestructiveStatements, 
  validateBackupTable 
} from './test-utils.mjs';

const migrationSql = `
-- Example migration with BACKUP
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: INSERT INTO remediation_contracts SELECT * FROM bak_example WHERE class = 'test-123'
-- BACKUP: bak_example

CREATE TABLE IF NOT EXISTS bak_example AS 
SELECT * FROM remediation_contracts WHERE class = 'test-123';

DELETE FROM remediation_contracts WHERE class = 'test-123';
`;

let pass = 0, fail = 0;
const ok = (c, m, d) => { 
  if (c) pass++; 
  else { 
    fail++; 
    console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); 
  } 
};

// Setup test database
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE remediation_contracts (
  class TEXT PRIMARY KEY,
  issue_id INTEGER,
  precondition TEXT,
  action TEXT
)`);

// Insert test data that BACKUP will capture
db.exec(`INSERT INTO remediation_contracts (class, precondition, action) 
         VALUES ('test-123', 'some condition', 'some action')`);

// ============ BACKUP Validation Pattern ============

const lines = migrationSql.split('\n');

// Step 1: Extract BACKUP header
const backupTable = extractBackupHeader(lines);
ok(backupTable === 'bak_example', 'extracted BACKUP header', backupTable);

// Step 2: Check if migration has row-destructive statements
const isRowDestructive = hasRowDestructiveStatements(migrationSql);
ok(isRowDestructive === true, 'detected DELETE FROM as row-destructive');

// Step 3: Apply migration (this creates the backup table)
const statementsToApply = migrationSql
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n');

db.exec(statementsToApply);

// Step 4: Validate backup table AFTER creation (in real tests, validate BEFORE destructive statements)
// Here we validate that the backup was created with the correct data
const result = validateBackupTable(db, backupTable, isRowDestructive);
ok(result.valid === true, 'backup table validation passed', result);
ok(result.error === null, 'no validation errors');

// Step 5: Verify backup captured the data before deletion
const backupCount = db.prepare(`SELECT COUNT(*) AS n FROM ${backupTable}`).get();
ok(backupCount.n === 1, 'backup table has expected row count', backupCount);

// Step 6: Verify main table row was deleted as expected
const mainCount = db.prepare(`SELECT COUNT(*) AS n FROM remediation_contracts WHERE class = 'test-123'`).get();
ok(mainCount.n === 0, 'main table row was deleted');

// ============ Regression Test: Empty BACKUP (PR #8537) ============

// Test what happens with empty backup (should fail validation)
const db2 = new DatabaseSync(':memory:');
db2.exec(`CREATE TABLE remediation_contracts (class TEXT, action TEXT)`);
db2.exec(`CREATE TABLE bak_empty AS SELECT * FROM remediation_contracts WHERE class = 'nonexistent'`);

const emptyResult = validateBackupTable(db2, 'bak_empty', true);
ok(emptyResult.valid === false, 'empty backup fails validation for row-destructive migration');
ok(emptyResult.error.includes('is empty'), 'error message indicates empty backup');

// ============ Test: Non-destructive migration (DROP TRIGGER) ============

const nonDestructiveSql = `
-- BACKUP: bak_triggers
-- This migration only drops triggers, no rows deleted
CREATE TABLE IF NOT EXISTS bak_triggers AS 
SELECT name, sql FROM sqlite_master WHERE type = 'trigger';

DROP TRIGGER IF EXISTS old_trigger;
`;

const db3 = new DatabaseSync(':memory:');
db3.exec(`CREATE TABLE bak_triggers (name TEXT, sql TEXT)`);

const nonDestructive = hasRowDestructiveStatements(nonDestructiveSql);
ok(nonDestructive === false, 'DROP TRIGGER is not row-destructive');

const triggerResult = validateBackupTable(db3, 'bak_triggers', nonDestructive);
ok(triggerResult.valid === true, 'empty backup allowed for non-row-destructive migration');

if (fail === 0) {
  console.log(`\n✓ All ${pass} BACKUP validation pattern tests passed`);
  process.exit(0);
} else {
  console.log(`\n✗ ${fail} of ${pass + fail} tests failed`);
  process.exit(1);
}
