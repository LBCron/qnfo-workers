import { DatabaseSync } from 'node:sqlite';
import { deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./2026-11-07-kernel-reconcile-fix.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');

// Set up migration_runs schema with CORRECT column names
db.exec(`
  CREATE TABLE migration_runs (
    file TEXT PRIMARY KEY,
    sha256 TEXT,
    commit_sha TEXT,
    db TEXT,
    status TEXT,
    statements INTEGER,
    error TEXT,
    applied_by TEXT
  );
  
  -- Insert a failed record like the real scenario
  INSERT INTO migration_runs VALUES (
    'migrations/2026-11-06-kernel-everywhere.sql',
    'abc123',
    'def456',
    'qnfo-audit',
    'error',
    0,
    'BACKUP table v_false_stop_candidates does not exist',
    'apply-migrations.yml'
  );
`);

// Run the migration
db.exec(sql);

// Test 1: Backup table exists
const backup = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name='bak_20261107_migration_runs_kernel_fix'
`).get();

ok(backup, 'Backup table should exist');

// Test 2: Failed record replaced with superseded
const record = db.prepare(`
  SELECT file, status, applied_by, db
  FROM migration_runs
  WHERE file = 'migrations/2026-11-06-kernel-everywhere.sql'
`).get();

ok(record, 'Record should exist');
deepStrictEqual(record.status, 'superseded', 'Status should be superseded');
deepStrictEqual(record.applied_by, 'manual-reconciliation-fix', 'Applied by should be manual-reconciliation-fix');
deepStrictEqual(record.db, 'qnfo-audit', 'DB should be qnfo-audit');

// Test 3: Only one record (INSERT OR REPLACE replaced the failed one)
const count = db.prepare(`
  SELECT COUNT(*) as count FROM migration_runs
  WHERE file = 'migrations/2026-11-06-kernel-everywhere.sql'
`).get();

deepStrictEqual(count.count, 1, 'Should have exactly one record');

// Test 4: BLINDSPOT-1 query (files with error and no ok/superseded) returns 0
const blindspot = db.prepare(`
  SELECT COUNT(*) as count FROM (
    SELECT e.file 
    FROM migration_runs e 
    WHERE e.status = 'error' 
      AND NOT EXISTS (
        SELECT 1 FROM migration_runs o 
        WHERE o.file = e.file 
          AND o.status IN ('ok', 'superseded')
      )
  )
`).get();

deepStrictEqual(blindspot.count, 0, 'BLINDSPOT-1 query should return 0 after reconciliation');

// Test 5: Idempotency - run twice
db.exec(sql);
const countAfter = db.prepare(`
  SELECT COUNT(*) as count FROM migration_runs
  WHERE file = 'migrations/2026-11-06-kernel-everywhere.sql'
`).get();

deepStrictEqual(countAfter.count, 1, 'Should still have exactly one record after second run');

console.log('✓ All 5 assertions passed: kernel reconcile fix migration');
