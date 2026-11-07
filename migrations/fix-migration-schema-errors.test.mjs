import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";

test("FIX-MIGRATION-SCHEMA-ERRORS-1: Fixes 4 failing migrations with correct schema", () => {
  const db = new DatabaseSync(":memory:");
  
  // Set up schema matching production (from CREATE TABLE statements in other migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS metric_registry (
      metric TEXT PRIMARY KEY,
      kind TEXT,
      target TEXT,
      polarity TEXT,
      formula TEXT,
      state TEXT,
      last_value TEXT,
      last_refreshed TEXT,
      breach_notified_at TEXT
    );
    
    CREATE TABLE IF NOT EXISTS analytics_metric_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL,
      threshold REAL,
      direction TEXT,
      owner TEXT,
      lever TEXT,
      action TEXT,
      state TEXT DEFAULT 'active'
    );
    
    CREATE TABLE IF NOT EXISTS remediation_contracts (
      class TEXT PRIMARY KEY,
      issue_id INTEGER,
      precondition TEXT NOT NULL DEFAULT 'TRUE',
      action TEXT NOT NULL DEFAULT 'file_issue',
      verify_probe TEXT NOT NULL,
      verify_transport TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      escalate_to TEXT NOT NULL DEFAULT 'owner',
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
      hit_action TEXT,
      description TEXT
    );
    
    CREATE TABLE IF NOT EXISTS personal_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    
    CREATE TABLE IF NOT EXISTS fleet_tick (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT DEFAULT (datetime('now')),
      worker TEXT
    );
  `);
  
  // Insert a sample probe that should be superseded
  db.exec(`
    INSERT INTO remediation_contracts (
      class, verify_probe, verify_transport, precondition, action, max_attempts, escalate_to
    ) VALUES (
      'rt-live-voice-stt',
      '{"url": "https://qnfo-live-voice.q08.workers.dev/health", "status": 200}',
      'runner-https',
      'TRUE',
      'file_issue',
      3,
      'owner'
    );
  `);
  
  // Apply the fix migration
  const sql = readFileSync("migrations/2026-11-07-fix-migration-schema-errors.sql", "utf8");
  db.exec(sql);
  
  // Verify FIX 1: Companion UI regression guard contracts created with correct schema
  const companionContracts = db.prepare(`
    SELECT class, expected_cadence_h, verify_transport, status 
    FROM remediation_contracts 
    WHERE class IN ('issue-8495-runtime', 'issue-8495-code')
    ORDER BY class
  `).all();
  
  assert.equal(companionContracts.length, 2, "Should create 2 companion guard contracts");
  assert.equal(companionContracts[0].class, "issue-8495-code");
  assert.equal(companionContracts[0].expected_cadence_h, 1, "Should use expected_cadence_h not verify_cadence_h");
  assert.equal(companionContracts[0].verify_transport, "code-read");
  assert.equal(companionContracts[0].status, "active");
  
  assert.equal(companionContracts[1].class, "issue-8495-runtime");
  assert.equal(companionContracts[1].expected_cadence_h, 1);
  assert.equal(companionContracts[1].verify_transport, "runner-https");
  
  // Verify FIX 2: Voice STT probe superseded
  const voiceSttProbe = db.prepare(`
    SELECT status, module 
    FROM remediation_contracts 
    WHERE class = 'rt-live-voice-stt'
  `).get();
  
  assert.equal(voiceSttProbe.status, "superseded", "Voice STT probe should be superseded");
  assert.equal(voiceSttProbe.module, "FIX-MIGRATION-SCHEMA-ERRORS-1");
  
  // Verify FIX 3: Research deferred pool metric created with correct column name
  const researchMetric = db.prepare(`
    SELECT metric, kind, polarity 
    FROM metric_registry 
    WHERE metric = 'research_deferred_pool_pct'
  `).get();
  
  assert.ok(researchMetric, "Research deferred pool metric should exist");
  assert.equal(researchMetric.metric, "research_deferred_pool_pct", "Should use 'metric' column not 'metric_name'");
  assert.equal(researchMetric.kind, "quality");
  assert.equal(researchMetric.polarity, "lower_is_better");
  
  // Verify FIX 4: Personal replies retention trigger created
  const trigger = db.prepare(`
    SELECT sql 
    FROM sqlite_master 
    WHERE type = 'trigger' AND name = 'retention_personal_replies_tick_v1'
  `).get();
  
  assert.ok(trigger, "Personal replies retention trigger should exist");
  assert.ok(trigger.sql.includes("fleet_tick"), "Trigger should reference fleet_tick");
  assert.ok(!trigger.sql.includes("fleet_heartbeat"), "Trigger should NOT reference fleet_heartbeat");
  
  // Verify backup table created
  const backupTable = db.prepare(`
    SELECT COUNT(*) as count 
    FROM bak_20261107_migration_schema_fixes
  `).get();
  
  assert.ok(backupTable.count >= 4, "Should record all 4 fixes in backup table");
  
  console.log("✓ All 4 migration schema fixes verified");
  console.log("✓ Companion guard contracts use expected_cadence_h");
  console.log("✓ Research metric uses metric column");
  console.log("✓ Voice STT probe superseded");
  console.log("✓ Personal replies trigger references fleet_tick");
});
