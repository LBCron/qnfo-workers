import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const migrationSQL = readFileSync(new URL('./2026-11-07-voice-stt-probe-remove.sql', import.meta.url), 'utf8');

describe('voice-stt-probe-remove migration', () => {
  it('supersedes the voice-stt probe', () => {
    const db = new DatabaseSync(':memory:');
    
    // Create minimal schema
    db.exec(`
      CREATE TABLE remediation_contracts (
        class TEXT PRIMARY KEY,
        module TEXT,
        status TEXT,
        last_verdict TEXT
      );
    `);
    
    // Insert the voice-stt probe
    db.exec(`
      INSERT INTO remediation_contracts (class, module, status, last_verdict)
      VALUES ('rt-live-voice-stt', 'runtime-liveness-v1', 'active', 'fail');
    `);
    
    // Apply migration (skip header comments)
    const statements = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n');
    db.exec(statements);
    
    // Verify probe is superseded
    const result = db.prepare('SELECT status, last_verdict FROM remediation_contracts WHERE class = ?')
      .get('rt-live-voice-stt');
    
    assert.equal(result.status, 'superseded');
    assert.ok(result.last_verdict.includes('worker does not exist'));
  });

  it('is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (
        class TEXT PRIMARY KEY,
        module TEXT,
        status TEXT,
        last_verdict TEXT
      );
      INSERT INTO remediation_contracts (class, module, status, last_verdict)
      VALUES ('rt-live-voice-stt', 'runtime-liveness-v1', 'active', 'fail');
    `);
    
    const statements = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n');
    
    // Apply twice
    db.exec(statements);
    db.exec(statements);
    
    const result = db.prepare('SELECT status FROM remediation_contracts WHERE class = ?')
      .get('rt-live-voice-stt');
    
    assert.equal(result.status, 'superseded');
  });

  it('does not affect other probes', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (
        class TEXT PRIMARY KEY,
        module TEXT,
        status TEXT,
        last_verdict TEXT
      );
      INSERT INTO remediation_contracts (class, module, status, last_verdict) VALUES
        ('rt-live-voice-stt', 'runtime-liveness-v1', 'active', 'fail'),
        ('rt-live-idea-hub', 'runtime-liveness-v1', 'active', 'pass');
    `);
    
    const statements = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--') && line.trim().length > 0)
      .join('\n');
    db.exec(statements);
    
    const other = db.prepare('SELECT status FROM remediation_contracts WHERE class = ?')
      .get('rt-live-idea-hub');
    
    assert.equal(other.status, 'active');
  });

  it('rollback restores the probe', () => {
    const db = new DatabaseSync(':memory:');
    
    db.exec(`
      CREATE TABLE remediation_contracts (
        class TEXT PRIMARY KEY,
        module TEXT,
        status TEXT,
        last_verdict TEXT,
        next_due_at TEXT
      );
      INSERT INTO remediation_contracts (class, module, status, last_verdict)
      VALUES ('rt-live-voice-stt', 'runtime-liveness-v1', 'superseded', 'superseded: worker does not exist');
    `);
    
    // Extract and apply rollback
    const rollbackMatch = migrationSQL.match(/-- Rollback: (.+)/);
    assert.ok(rollbackMatch, 'Rollback statement found');
    
    db.exec(rollbackMatch[1]);
    
    const result = db.prepare('SELECT status, last_verdict FROM remediation_contracts WHERE class = ?')
      .get('rt-live-voice-stt');
    
    assert.equal(result.status, 'active');
    assert.ok(result.last_verdict.includes('restored'));
  });

  it('has required header lines', () => {
    assert.ok(migrationSQL.includes('-- APPLY-BY: ci'), 'Missing APPLY-BY header');
    assert.ok(migrationSQL.includes('-- DB: qnfo-audit'), 'Missing DB header');
    assert.ok(migrationSQL.includes('-- Rollback:'), 'Missing Rollback header');
    assert.ok(migrationSQL.includes('-- BACKUP:'), 'Missing BACKUP header');
  });
});
