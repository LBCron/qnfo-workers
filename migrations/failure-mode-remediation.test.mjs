// Test for migrations/2026-11-07-failure-mode-remediation.sql
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationSQL = readFileSync('migrations/2026-11-07-failure-mode-remediation.sql', 'utf8');

test('failure-mode-remediation migration', async (t) => {
  await t.test('parks all 6 PROBE-NEEDED issues as monitoring', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
      CREATE TABLE remediation_contracts (
        class TEXT,
        issue_id INTEGER,
        module TEXT,
        verify_probe TEXT,
        verify_transport TEXT,
        status TEXT,
        last_verdict TEXT,
        next_due_at TEXT,
        PRIMARY KEY (class, module)
      );
      CREATE TABLE decision_log (
        decision_key TEXT PRIMARY KEY,
        decision TEXT,
        reasoning TEXT,
        revert_path TEXT,
        predicted_outcome TEXT,
        surfaces_tested TEXT,
        created_at TEXT
      );
      CREATE TABLE failure_modes (key TEXT PRIMARY KEY, title TEXT, root_cause TEXT, remediation TEXT);
      
      -- Pre-populate with probe-review-refused contract
      INSERT INTO remediation_contracts (class, status) VALUES ('issue-1001677', 'probe-review-refused');
    `);
    
    db.exec(migrationSQL);
    
    // All 6 issues should have monitoring contracts
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM remediation_contracts 
      WHERE class IN ('issue-1001677', 'issue-1001895', 'issue-1001975', 'issue-1002012', 'issue-1002028', 'issue-1002091')
      AND status = 'monitoring'
    `);
    const result = stmt.get();
    assert.equal(result.count, 6, 'All 6 issues should have monitoring status');
    
    db.close();
  });

  await t.test('records decisions for parked contracts', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (
        class TEXT PRIMARY KEY,
        issue_id INTEGER,
        module TEXT,
        verify_probe TEXT,
        verify_transport TEXT,
        status TEXT,
        last_verdict TEXT,
        next_due_at TEXT
      );
      CREATE TABLE decision_log (
        decision_key TEXT PRIMARY KEY,
        decision TEXT,
        reasoning TEXT,
        revert_path TEXT,
        predicted_outcome TEXT,
        surfaces_tested TEXT,
        created_at TEXT
      );
      CREATE TABLE failure_modes (key TEXT PRIMARY KEY, title TEXT, root_cause TEXT, remediation TEXT);
    `);
    
    db.exec(migrationSQL);
    
    // Should have 6 decision records
    const stmt = db.prepare("SELECT COUNT(*) as count FROM decision_log WHERE decision_key LIKE 'park-issue-%'");
    const result = stmt.get();
    assert.equal(result.count, 6, 'Should have 6 parking decisions');
    
    db.close();
  });

  await t.test('registers 3 new failure modes', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, module TEXT, status TEXT, verify_probe TEXT, verify_transport TEXT, next_due_at TEXT, last_verdict TEXT);
      CREATE TABLE decision_log (decision_key TEXT PRIMARY KEY, decision TEXT, reasoning TEXT, revert_path TEXT, predicted_outcome TEXT, surfaces_tested TEXT, created_at TEXT);
      CREATE TABLE failure_modes (key TEXT PRIMARY KEY, title TEXT, root_cause TEXT, remediation TEXT);
    `);
    
    db.exec(migrationSQL);
    
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM failure_modes 
      WHERE key IN ('migration-schema-assumptions', 'issue-without-probe', 'dormant-detector')
    `);
    const result = stmt.get();
    assert.equal(result.count, 3, 'Should register 3 failure modes');
    
    db.close();
  });

  await t.test('is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (
        class TEXT PRIMARY KEY,
        issue_id INTEGER,
        module TEXT,
        verify_probe TEXT,
        verify_transport TEXT,
        status TEXT,
        last_verdict TEXT,
        next_due_at TEXT
      );
      CREATE TABLE decision_log (
        decision_key TEXT PRIMARY KEY,
        decision TEXT,
        reasoning TEXT,
        revert_path TEXT,
        predicted_outcome TEXT,
        surfaces_tested TEXT,
        created_at TEXT
      );
      CREATE TABLE failure_modes (key TEXT PRIMARY KEY, title TEXT, root_cause TEXT, remediation TEXT);
    `);
    
    // Run twice
    db.exec(migrationSQL);
    db.exec(migrationSQL);
    
    // Should still have exactly 6 contracts and 6 decisions and 3 failure modes
    const contractStmt = db.prepare("SELECT COUNT(*) as count FROM remediation_contracts WHERE status = 'monitoring'");
    const decisionStmt = db.prepare("SELECT COUNT(*) as count FROM decision_log WHERE decision_key LIKE 'park-issue-%'");
    const fmStmt = db.prepare("SELECT COUNT(*) as count FROM failure_modes");
    
    assert.equal(contractStmt.get().count, 6);
    assert.equal(decisionStmt.get().count, 6);
    assert.equal(fmStmt.get().count, 3);
    
    db.close();
  });

  await t.test('has required header lines', () => {
    assert.match(migrationSQL, /^-- APPLY-BY: ci$/m, 'Missing APPLY-BY header');
    assert.match(migrationSQL, /^-- DB: qnfo-audit$/m, 'Missing DB header');
    assert.match(migrationSQL, /^-- BACKUP: remediation_contracts$/m, 'Missing BACKUP header');
    assert.match(migrationSQL, /^-- Rollback:/m, 'Missing Rollback header');
  });

  await t.test('closing probe verifies failure modes registered', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, module TEXT, status TEXT, verify_probe TEXT, verify_transport TEXT, next_due_at TEXT, last_verdict TEXT);
      CREATE TABLE decision_log (decision_key TEXT PRIMARY KEY, decision TEXT, reasoning TEXT, revert_path TEXT, predicted_outcome TEXT, surfaces_tested TEXT, created_at TEXT);
      CREATE TABLE failure_modes (key TEXT PRIMARY KEY, title TEXT, root_cause TEXT, remediation TEXT);
    `);
    
    db.exec(migrationSQL);
    
    // Extract and run the closing probe
    const probeMatch = migrationSQL.match(/closing probe: (.+)/);
    assert.ok(probeMatch, 'Migration should have closing probe');
    
    const probe = probeMatch[1];
    const result = db.prepare(probe).get();
    
    assert.equal(result.expected, '3', 'Expected 3 failure modes');
    assert.equal(result.observed, '3', 'Should have 3 failure modes registered');
    
    db.close();
  });
});
