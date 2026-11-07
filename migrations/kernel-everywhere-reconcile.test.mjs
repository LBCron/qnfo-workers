import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const db = new DatabaseSync(':memory:');

// Set up migration_runs schema
db.exec(`
  CREATE TABLE migration_runs (
    migration_file TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    run_at TEXT NOT NULL,
    run_by TEXT,
    statements_executed INTEGER,
    error_message TEXT
  );
`);

// Insert existing failed runs for kernel-everywhere (simulating the current state)
db.exec(`
  INSERT INTO migration_runs (migration_file, status, run_at, run_by, error_message)
  VALUES ('migrations/2026-11-06-kernel-everywhere.sql', 'failed', '2026-11-07 06:14:37', 'apply-migrations.yml', 'BACKUP table v_false_stop_candidates does not exist');
`);

// Apply the reconciliation migration
const migrationSQL = readFileSync('migrations/2026-11-07-kernel-everywhere-reconcile.sql', 'utf8');
const statements = migrationSQL
  .split('\n')
  .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
  .join('\n')
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);

for (const stmt of statements) {
  db.exec(stmt);
}

// Test 1: Migration record was inserted
const recordCount = db.prepare(`
  SELECT COUNT(*) as cnt FROM migration_runs 
  WHERE migration_file = 'migrations/2026-11-06-kernel-everywhere.sql' AND status = 'ok'
`).get();
assert.equal(recordCount.cnt, 1, 'Should have one ok record for kernel-everywhere migration');

// Test 2: The ok record has manual-reconciliation as run_by
const runBy = db.prepare(`
  SELECT run_by FROM migration_runs 
  WHERE migration_file = 'migrations/2026-11-06-kernel-everywhere.sql' AND status = 'ok'
`).get();
assert.equal(runBy.run_by, 'manual-reconciliation', 'ok record should be from manual-reconciliation');

// Test 3: Failed record was replaced (INSERT OR REPLACE overwrites it)
const failedCount = db.prepare(`
  SELECT COUNT(*) as cnt FROM migration_runs 
  WHERE migration_file = 'migrations/2026-11-06-kernel-everywhere.sql' AND status = 'failed'
`).get();
assert.equal(failedCount.cnt, 0, 'Failed record should be replaced with ok record');

// Test 4: BLINDSPOT-1 query (migrations with failed run and no ok run) returns 0
const blindspotCount = db.prepare(`
  SELECT COUNT(*) as cnt FROM migration_runs 
  WHERE status = 'failed' 
    AND migration_file NOT IN (
      SELECT migration_file FROM migration_runs WHERE status = 'ok'
    )
`).get();
assert.equal(blindspotCount.cnt, 0, 'Should have no migrations with failed run and no ok run');

// Test 5: Can re-apply migration (INSERT OR REPLACE is idempotent for ok status)
for (const stmt of statements) {
  db.exec(stmt);
}
const countAfterReapply = db.prepare(`
  SELECT COUNT(*) as cnt FROM migration_runs 
  WHERE migration_file = 'migrations/2026-11-06-kernel-everywhere.sql' AND status = 'ok'
`).get();
assert.equal(countAfterReapply.cnt, 1, 'Should still have exactly one ok record after reapply');

// Verify the run_by is still manual-reconciliation
const runByAfter = db.prepare(`
  SELECT run_by FROM migration_runs 
  WHERE migration_file = 'migrations/2026-11-06-kernel-everywhere.sql'
`).get();
assert.equal(runByAfter.run_by, 'manual-reconciliation', 'run_by should still be manual-reconciliation after reapply');

console.log('✓ All 5 assertions passed: kernel-everywhere reconciliation works correctly');
