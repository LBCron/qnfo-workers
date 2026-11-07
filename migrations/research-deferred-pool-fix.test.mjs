import { DatabaseSync } from 'node:sqlite';
import { deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./2026-11-07-research-deferred-pool-fix.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');

// Set up minimal schema
db.exec(`
  CREATE TABLE research_queue (
    id INTEGER PRIMARY KEY,
    status TEXT,
    stage TEXT,
    recover_count INTEGER,
    created_at TEXT
  );
  
  CREATE TABLE metric_registry (
    metric TEXT PRIMARY KEY,
    metric_name TEXT,
    query TEXT,
    layer TEXT,
    kind TEXT,
    target INTEGER,
    threshold INTEGER,
    state TEXT,
    disposition_actor TEXT,
    owner TEXT
  );
  
  CREATE TABLE analytics_metric_triggers (
    metric TEXT,
    metric_key TEXT PRIMARY KEY,
    threshold INTEGER,
    severity TEXT,
    action TEXT,
    owner TEXT
  );
  
  CREATE TABLE metric_breach_cause (
    metric TEXT,
    cause_key TEXT,
    cause_description TEXT,
    PRIMARY KEY (metric, cause_key)
  );
`);

// Run the migration
db.exec(sql);

// Test 1: View exists
const viewExists = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='view' AND name='v_research_deferred_analysis'
`).get();

ok(viewExists, 'v_research_deferred_analysis view should exist');

// Test 2: Deferred pool size metric exists
const deferredMetric = db.prepare(`
  SELECT metric, metric_name, owner, threshold
  FROM metric_registry
  WHERE metric = 'research_deferred_pool_size'
`).get();

ok(deferredMetric, 'Deferred pool size metric should exist');
deepStrictEqual(deferredMetric.owner, 'qnfo-research-exec', 'Metric should be owned by qnfo-research-exec');
deepStrictEqual(deferredMetric.threshold, 100, 'Threshold should be 100');

// Test 3: Deferred pool trigger exists
const deferredTrigger = db.prepare(`
  SELECT metric, action, owner
  FROM analytics_metric_triggers
  WHERE metric = 'research_deferred_pool_size'
`).get();

ok(deferredTrigger, 'Deferred pool trigger should exist');
ok(deferredTrigger.action.includes('code-task:'), 'Trigger should have code-task');
ok(deferredTrigger.action.includes('qnfo-research-exec/worker.js'), 'Trigger should point to worker');

// Test 4: Legacy parked metric exists
const parkedMetric = db.prepare(`
  SELECT metric, threshold
  FROM metric_registry
  WHERE metric = 'research_legacy_parked_count'
`).get();

ok(parkedMetric, 'Legacy parked metric should exist');
deepStrictEqual(parkedMetric.threshold, 0, 'Parked threshold should be 0');

// Test 5: Legacy parked trigger exists
const parkedTrigger = db.prepare(`
  SELECT metric
  FROM analytics_metric_triggers
  WHERE metric = 'research_legacy_parked_count'
`).get();

ok(parkedTrigger, 'Legacy parked trigger should exist');

// Test 6: Metric breach causes exist
const causes = db.prepare(`
  SELECT COUNT(*) as count
  FROM metric_breach_cause
  WHERE metric IN ('research_deferred_pool_size', 'research_legacy_parked_count')
    AND cause_key = 'research-deferred-drain'
`).get();

deepStrictEqual(causes.count, 2, 'Both metrics should have breach cause');

// Test 7: Backup table exists
const backup = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name='bak_20261107_metric_registry_research_deferred'
`).get();

ok(backup, 'Backup table should exist');

// Test 8: INSERT OR IGNORE means migration is idempotent - run it twice
db.exec(sql);
const metricCount = db.prepare(`
  SELECT COUNT(*) as count FROM metric_registry
  WHERE metric IN ('research_deferred_pool_size', 'research_legacy_parked_count')
`).get();

deepStrictEqual(metricCount.count, 2, 'Should still have exactly 2 metrics after second run');

console.log('✓ All 8 assertions passed: research deferred pool fix migration');
