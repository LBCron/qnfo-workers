import { DatabaseSync } from 'node:sqlite';
import { deepStrictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./2026-11-07-companion-ui-regression-guard.sql', import.meta.url), 'utf8');
const db = new DatabaseSync(':memory:');

// Set up minimal schema
db.exec(`
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY,
    verify_transport TEXT,
    verify_probe TEXT,
    verify_cadence_h INTEGER,
    hit_action TEXT,
    issue_id INTEGER,
    description TEXT
  );
`);

// Run the migration
db.exec(sql);

// Test 1: Runtime probe exists
const runtimeProbe = db.prepare(`
  SELECT class, verify_transport, verify_probe, verify_cadence_h, issue_id
  FROM remediation_contracts
  WHERE class = 'issue-8495-runtime'
`).get();

ok(runtimeProbe, 'Runtime probe should exist');
deepStrictEqual(runtimeProbe.verify_transport, 'runner-https', 'Runtime probe should use runner-https transport');
ok(runtimeProbe.verify_probe.includes('me.q08.org/companion'), 'Runtime probe should check companion URL');
ok(runtimeProbe.verify_probe.includes('For the Quniverse'), 'Runtime probe should check for Quniverse text');
deepStrictEqual(runtimeProbe.issue_id, 8495, 'Runtime probe should link to issue 8495');

// Test 2: Code probe exists
const codeProbe = db.prepare(`
  SELECT class, verify_transport, verify_probe, verify_cadence_h, issue_id
  FROM remediation_contracts
  WHERE class = 'issue-8495-code'
`).get();

ok(codeProbe, 'Code probe should exist');
deepStrictEqual(codeProbe.verify_transport, 'code-read', 'Code probe should use code-read transport');
ok(codeProbe.verify_probe.includes('personal-api/worker.js'), 'Code probe should check personal-api');
ok(codeProbe.verify_probe.includes('function fleetAsks'), 'Code probe should check for fleetAsks function');
deepStrictEqual(codeProbe.issue_id, 8495, 'Code probe should link to issue 8495');

// Test 3: Both probes use absent (regression guard)
const runtimeProbeJSON = JSON.parse(runtimeProbe.verify_probe);
const codeProbeJSON = JSON.parse(codeProbe.verify_probe);

ok(runtimeProbeJSON.absent, 'Runtime probe should use absent check');
ok(codeProbeJSON.absent, 'Code probe should use absent check');
deepStrictEqual(runtimeProbeJSON.absent, 'For the Quniverse', 'Runtime probe should check absence of fleet text');
deepStrictEqual(codeProbeJSON.absent, 'function fleetAsks', 'Code probe should check absence of function');

// Test 4: Backup table exists
const backup = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name='bak_20261107_remediation_contracts_companion_ui'
`).get();

ok(backup, 'Backup table should exist');

// Test 5: Both probes run hourly
deepStrictEqual(runtimeProbe.verify_cadence_h, 1, 'Runtime probe should run hourly');
deepStrictEqual(codeProbe.verify_cadence_h, 1, 'Code probe should run hourly');

console.log('✓ All 5 assertions passed: companion UI regression guard migration');
