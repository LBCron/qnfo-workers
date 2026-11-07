/**
 * Tests for test-utils.mjs production schema exports
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { 
  PRODUCTION_SCHEMAS, 
  validateColumnReferences, 
  setupTestDatabase,
  extractBackupHeader,
  hasRowDestructiveStatements,
  validateBackupTable
} from './test-utils.mjs';

describe('PRODUCTION_SCHEMAS', () => {
  it('contains remediation_contracts schema', () => {
    assert.ok(PRODUCTION_SCHEMAS.remediation_contracts);
    assert.ok(PRODUCTION_SCHEMAS.remediation_contracts.includes('expected_cadence_h'));
    assert.ok(!PRODUCTION_SCHEMAS.remediation_contracts.includes('verify_cadence_h'));
  });

  it('contains failure_modes schema', () => {
    assert.ok(PRODUCTION_SCHEMAS.failure_modes);
    assert.ok(PRODUCTION_SCHEMAS.failure_modes.includes('fm_key'));
    assert.ok(PRODUCTION_SCHEMAS.failure_modes.includes('detector'));
  });

  it('contains decision_log schema', () => {
    assert.ok(PRODUCTION_SCHEMAS.decision_log);
    assert.ok(PRODUCTION_SCHEMAS.decision_log.includes('capability_gain'));
    assert.ok(PRODUCTION_SCHEMAS.decision_log.includes('predicted_outcome'));
  });
});

describe('validateColumnReferences', () => {
  it('accepts valid INSERT with correct columns', () => {
    const sql = `INSERT INTO remediation_contracts (class, action, verify_probe) VALUES ('test', 'x', 'y')`;
    const result = validateColumnReferences(sql, 'remediation_contracts');
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects INSERT with wrong column name', () => {
    // This is the actual error from PR #8560
    const sql = `INSERT INTO remediation_contracts (class, hit_action) VALUES ('test', 'x')`;
    const result = validateColumnReferences(sql, 'remediation_contracts');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('hit_action')));
  });

  it('accepts valid UPDATE with correct columns', () => {
    const sql = `UPDATE remediation_contracts SET expected_cadence_h = 2 WHERE class = 'test'`;
    const result = validateColumnReferences(sql, 'remediation_contracts');
    assert.equal(result.valid, true);
  });

  it('rejects UPDATE with wrong column name', () => {
    // This is another actual error from PR #8560
    const sql = `UPDATE remediation_contracts SET verify_cadence_h = 2 WHERE class = 'test'`;
    const result = validateColumnReferences(sql, 'remediation_contracts');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('verify_cadence_h')));
  });

  it('handles unknown table', () => {
    const sql = `INSERT INTO unknown_table (col1) VALUES ('x')`;
    const result = validateColumnReferences(sql, 'unknown_table');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Unknown table')));
  });
});

describe('setupTestDatabase', () => {
  it('creates tables from production schemas', () => {
    const db = new DatabaseSync(':memory:');
    setupTestDatabase(db, ['remediation_contracts', 'failure_modes']);
    
    // Verify tables exist
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('remediation_contracts', 'failure_modes')
    `).all();
    assert.equal(tables.length, 2);
    
    // Verify columns match production
    const columns = db.prepare(`PRAGMA table_info(remediation_contracts)`).all();
    const columnNames = columns.map(c => c.name);
    assert.ok(columnNames.includes('expected_cadence_h'));
    assert.ok(!columnNames.includes('verify_cadence_h')); // Wrong name
    assert.ok(!columnNames.includes('hit_action')); // Wrong name
    
    db.close();
  });

  it('throws on unknown table', () => {
    const db = new DatabaseSync(':memory:');
    assert.throws(
      () => setupTestDatabase(db, ['unknown_table']),
      /Unknown table: unknown_table/
    );
    db.close();
  });
});

describe('regression tests for PR #8560 failures', () => {
  it('catches verify_cadence_h vs expected_cadence_h error', () => {
    const badSql = `UPDATE remediation_contracts SET verify_cadence_h = 1`;
    const result = validateColumnReferences(badSql, 'remediation_contracts');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('verify_cadence_h')));
  });

  it('catches hit_action column error', () => {
    const badSql = `INSERT INTO remediation_contracts (class, hit_action) VALUES ('x', 'y')`;
    const result = validateColumnReferences(badSql, 'remediation_contracts');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('hit_action')));
  });

  it('catches metric_name vs metric error', () => {
    // Simulating the metric_registry error pattern
    const badSql = `INSERT INTO metric_registry (metric_name, last_value) VALUES ('x', 'y')`;
    const result = validateColumnReferences(badSql, 'metric_registry');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('metric_name')));
  });
});

describe('BACKUP validation (MIGRATION-TEST-BACKUP-CHECK-1)', () => {
  describe('extractBackupHeader', () => {
    it('finds BACKUP header in migration', () => {
      const lines = ['-- APPLY-BY: ci', '-- BACKUP: bak_test_table', 'INSERT INTO test'];
      const backup = extractBackupHeader(lines);
      assert.equal(backup, 'bak_test_table');
    });

    it('returns null for BACKUP: none', () => {
      const lines = ['-- APPLY-BY: ci', '-- BACKUP: none', 'DROP TRIGGER test'];
      const backup = extractBackupHeader(lines);
      assert.equal(backup, null);
    });

    it('returns null when no BACKUP header', () => {
      const lines = ['-- APPLY-BY: ci', 'INSERT INTO test'];
      const backup = extractBackupHeader(lines);
      assert.equal(backup, null);
    });
  });

  describe('hasRowDestructiveStatements', () => {
    it('detects DELETE FROM as row-destructive', () => {
      const sql = 'DELETE FROM agent_issues WHERE status = "closed"';
      assert.equal(hasRowDestructiveStatements(sql), true);
    });

    it('detects DROP TABLE as row-destructive', () => {
      const sql = 'DROP TABLE old_table';
      assert.equal(hasRowDestructiveStatements(sql), true);
    });

    it('DROP TRIGGER is not row-destructive', () => {
      const sql = 'DROP TRIGGER IF EXISTS test_trigger';
      assert.equal(hasRowDestructiveStatements(sql), false);
    });

    it('DROP INDEX is not row-destructive', () => {
      const sql = 'DROP INDEX IF EXISTS test_index';
      assert.equal(hasRowDestructiveStatements(sql), false);
    });

    it('DROP VIEW is not row-destructive', () => {
      const sql = 'DROP VIEW IF EXISTS test_view';
      assert.equal(hasRowDestructiveStatements(sql), false);
    });

    it('ignores DELETE in comments', () => {
      const sql = `-- Comment: DELETE FROM should be ignored
        UPDATE test SET status = 'deleted'`;
      assert.equal(hasRowDestructiveStatements(sql), false);
    });

    it('ignores DELETE in string literals', () => {
      const sql = "INSERT INTO log (msg) VALUES ('DELETE FROM happened')";
      assert.equal(hasRowDestructiveStatements(sql), false);
    });
  });

  describe('validateBackupTable', () => {
    it('fails when backup table does not exist', () => {
      const db = new DatabaseSync(':memory:');
      const result = validateBackupTable(db, 'nonexistent_table', true);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('does not exist'));
    });

    it('fails for empty backup with row-destructive migration', () => {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE bak_empty (id INTEGER)');
      const result = validateBackupTable(db, 'bak_empty', true);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('is empty'));
    });

    it('passes for empty backup with non-row-destructive migration (DROP TRIGGER)', () => {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE bak_trigger_backup (name TEXT, sql TEXT)');
      const result = validateBackupTable(db, 'bak_trigger_backup', false);
      assert.equal(result.valid, true);
      assert.equal(result.error, null);
    });

    it('passes for non-empty backup with row-destructive migration', () => {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE bak_good (id INTEGER)');
      db.exec('INSERT INTO bak_good (id) VALUES (1), (2), (3)');
      const result = validateBackupTable(db, 'bak_good', true);
      assert.equal(result.valid, true);
      assert.equal(result.error, null);
    });

    it('regression: catches PR #8537 empty backup scenario', () => {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE remediation_contracts (class TEXT, status TEXT)');
      // Create empty backup (simulating PR #8537 mistake)
      db.exec(`CREATE TABLE bak_20261107_test AS 
        SELECT * FROM remediation_contracts 
        WHERE class IN ('issue-8495-runtime', 'issue-8495-code')`);
      
      // This migration would DELETE rows, so requires non-empty backup
      const result = validateBackupTable(db, 'bak_20261107_test', true);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('is empty'));
    });
  });
});
