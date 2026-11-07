#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const db = new DatabaseSync(':memory:');

// Set up minimal schema
db.exec(`
  CREATE TABLE fleet_heartbeat (
    id INTEGER PRIMARY KEY,
    tick_at TEXT NOT NULL,
    tick_min_10 INTEGER DEFAULT 0
  );

  CREATE TABLE personal_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    replied_at TEXT NOT NULL,
    body TEXT
  );
`);

// Insert test data: old and recent rows
db.exec(`
  INSERT INTO personal_replies (session_id, replied_at, body) VALUES
    ('old-1', datetime('now', '-40 days'), 'Old reply 1'),
    ('old-2', datetime('now', '-35 days'), 'Old reply 2'),
    ('recent-1', datetime('now', '-15 days'), 'Recent reply 1'),
    ('recent-2', datetime('now', '-5 days'), 'Recent reply 2'),
    ('old-3', datetime('now', '-31 days'), 'Old reply 3');
`);

const beforeCount = db.prepare('SELECT COUNT(*) as cnt FROM personal_replies').get().cnt;
assert.equal(beforeCount, 5, 'Should have 5 test rows before migration');

const oldCount = db.prepare(`SELECT COUNT(*) as cnt FROM personal_replies 
  WHERE replied_at < datetime('now', '-30 days')`).get().cnt;
assert.equal(oldCount, 3, 'Should have 3 old rows (>30 days)');

// Apply migration
const migrationSQL = readFileSync('migrations/2026-11-07-personal-replies-retention.sql', 'utf8');
db.exec(migrationSQL);

// Test 1: Backup table was created
const backupExists = db.prepare(`
  SELECT COUNT(*) as cnt FROM sqlite_master 
  WHERE type='table' AND name='bak_20261107_personal_replies_before_retention'
`).get().cnt;
assert.equal(backupExists, 1, 'Backup table should exist');

// Test 2: Verify trigger was created
const triggerExists = db.prepare(`
  SELECT COUNT(*) as cnt FROM sqlite_master 
  WHERE type='trigger' AND name='personal_replies_retention_sweep'
`).get().cnt;
assert.equal(triggerExists, 1, 'Retention sweep trigger should exist');

// Verify immediate cleanup deleted old rows
const afterCleanup = db.prepare('SELECT COUNT(*) as cnt FROM personal_replies').get().cnt;
assert.equal(afterCleanup, 2, 'Should have 2 rows left after immediate cleanup');

const remainingOld = db.prepare(`SELECT COUNT(*) as cnt FROM personal_replies 
  WHERE replied_at < datetime('now', '-30 days')`).get().cnt;
assert.equal(remainingOld, 0, 'Should have 0 old rows after cleanup');

// Verify trigger fires on heartbeat
db.exec(`
  INSERT INTO personal_replies (session_id, replied_at, body) VALUES
    ('future-old', datetime('now', '-35 days'), 'Should be deleted by trigger');
  
  INSERT INTO fleet_heartbeat (tick_at, tick_min_10) VALUES
    (datetime('now'), 1);
`);

const afterTrigger = db.prepare('SELECT COUNT(*) as cnt FROM personal_replies').get().cnt;
assert.equal(afterTrigger, 2, 'Trigger should have deleted the newly inserted old row');

console.log('✓ All 6 assertions passed: retention sweep trigger works correctly (backup table + trigger creation + immediate cleanup + old row deletion + trigger firing + final count)');
