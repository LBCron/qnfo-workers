#!/usr/bin/env node
/**
 * MIGRATION-SCHEMA-GUARD-1 regression test suite
 * 
 * Tests the schema validation guard against the exact production failure from PR #8490:
 * migrations/2026-11-07-research-pipeline-drain-deferred-pool.sql used 'metric_key'
 * for metric_registry (should be 'metric'), failed in production, partial D1 state.
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpDir = join(tmpdir(), `migration-guard-test-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });

let exitCode = 0;

// Test case 1: The actual failure that reached production
const failedMigration = `-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM metric_registry WHERE metric = 'test_metric';
-- BACKUP: analytics_metric_triggers

-- This should FAIL - uses metric_key instead of metric
INSERT INTO metric_registry (
  metric_key,
  metric_name,
  query,
  target_value,
  comparison
) VALUES (
  'test_metric',
  'Test Metric',
  'SELECT 1 as value',
  100,
  '<'
);
`;

const failedPath = join(tmpDir, '2026-11-07-test-failed.sql');
writeFileSync(failedPath, failedMigration);

console.log('Test 1: Detect metric_registry using metric_key (production failure)');
try {
  execSync(`python scripts/migration_schema_guard.py`, { 
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  console.log('  ✗ FAIL: Should have detected metric_key error');
  exitCode = 1;
} catch (e) {
  if (e.stdout?.includes('metric_key') && e.stdout?.includes('metric_registry')) {
    console.log('  ✓ PASS: Correctly detected metric_key vs metric error');
  } else {
    console.log('  ✗ FAIL: Wrong error message');
    console.log(e.stdout);
    exitCode = 1;
  }
}

// Test case 2: Correct usage should pass
const correctMigration = `-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM metric_registry WHERE metric = 'test_metric';
-- BACKUP: analytics_metric_triggers

-- This should PASS - uses metric (correct)
INSERT INTO metric_registry (
  metric,
  metric_name,
  query,
  target_value,
  comparison
) VALUES (
  'test_metric',
  'Test Metric',
  'SELECT 1 as value',
  100,
  '<'
);
`;

const correctPath = join(tmpDir, '2026-11-07-test-correct.sql');
writeFileSync(correctPath, correctMigration);

console.log('\nTest 2: Accept metric_registry using metric (correct)');
try {
  execSync(`python scripts/migration_schema_guard.py`, {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  console.log('  ✓ PASS: Correct migration accepted');
} catch (e) {
  console.log('  ✗ FAIL: Rejected correct migration');
  console.log(e.stdout);
  exitCode = 1;
}

// Test case 3: analytics_metric_triggers should use metric_key
const triggerWrong = `-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM analytics_metric_triggers WHERE metric_key = 'test';

-- This should FAIL - uses metric instead of metric_key
INSERT INTO analytics_metric_triggers (
  metric,
  threshold,
  direction,
  owner,
  action
) VALUES (
  'test_metric',
  100,
  'above',
  'test',
  'Test action'
);
`;

const triggerWrongPath = join(tmpDir, '2026-11-07-test-trigger-wrong.sql');
writeFileSync(triggerWrongPath, triggerWrong);

console.log('\nTest 3: Detect analytics_metric_triggers using metric (wrong)');
try {
  execSync(`python scripts/migration_schema_guard.py`, {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  console.log('  ✗ FAIL: Should have detected metric vs metric_key error');
  exitCode = 1;
} catch (e) {
  if (e.stdout?.includes('metric_key') && e.stdout?.includes('analytics_metric_triggers')) {
    console.log('  ✓ PASS: Correctly detected metric vs metric_key error');
  } else {
    console.log('  ✗ FAIL: Wrong error message');
    console.log(e.stdout);
    exitCode = 1;
  }
}

// Test case 4: research_queue should use created_at not queued_at
const viewWrong = `-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS test_view;

-- This should FAIL - uses queued_at instead of created_at
CREATE VIEW test_view AS
SELECT id, queued_at FROM research_queue;
`;

const viewWrongPath = join(tmpDir, '2026-11-07-test-view-wrong.sql');
writeFileSync(viewWrongPath, viewWrong);

console.log('\nTest 4: Detect research_queue using queued_at (wrong)');
try {
  execSync(`python scripts/migration_schema_guard.py`, {
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  console.log('  ℹ Note: View detection not yet implemented (INSERT only)');
} catch (e) {
  // Expected - view validation not yet implemented
}

// Cleanup
try {
  unlinkSync(failedPath);
  unlinkSync(correctPath);
  unlinkSync(triggerWrongPath);
  unlinkSync(viewWrongPath);
  unlinkSync(tmpDir);
} catch (e) {
  // Ignore cleanup errors
}

if (exitCode === 0) {
  console.log('\n✓ All migration schema guard tests passed');
} else {
  console.log('\n✗ Some tests failed');
}

process.exit(exitCode);
