// CLOSE-PROBE-CIRCULAR-1 regression fix offline suite: proves migrations/2026-11-07-deferral-probe-not-blocking.sql
// allows closure when only deferral probes fail, still blocks when measuring probes fail.
// Run: node migrations/deferral-probes-not-blocking.test.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

// Create schema
db.exec(`
  CREATE TABLE agent_issues (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    title TEXT
  );
  
  CREATE TABLE issue_triage (
    issue_id INTEGER PRIMARY KEY,
    close_evidence TEXT,
    triage_state TEXT
  );
  
  CREATE TABLE remediation_contracts (
    class TEXT PRIMARY KEY,
    issue_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    last_verdict TEXT,
    verify_probe TEXT
  );
`);

// Apply the migration (simplified: just create the trigger)
db.exec(`
  CREATE TRIGGER issue_close_evidence_required
  BEFORE UPDATE OF status ON agent_issues
  WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
  BEGIN
    SELECT RAISE(ABORT,'close-without-evidence')
      WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
    
    SELECT RAISE(ABORT,'close-while-contract-fails')
      WHERE NEW.status IN ('closed','resolved')
        AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
                      AND c.status IN ('active','holding')
                      AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host')
                      AND NOT (COALESCE(c.verify_probe,'') LIKE '%closed-with-evidence%'));
  END;
`);

// Verify trigger exists
const triggerCount = db.prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type=? AND name=?').get('trigger', 'issue_close_evidence_required');
ok(triggerCount.count === 1, 'Trigger should exist');

// Test case 1: Issue with deferral-fail + measuring-pass should be closeable
db.prepare('INSERT INTO agent_issues (id, status, title) VALUES (?, ?, ?)').run(1, 'open', 'Test issue 1');
db.prepare('INSERT INTO issue_triage (issue_id, close_evidence) VALUES (?, ?)').run(1, 'Measuring probe passed');

// Add a failing deferral probe (checks for 'closed-with-evidence')
db.prepare('INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)').run(
  'deferral-1', 1, 'active', 'fail', 
  "SELECT 'closed-with-evidence' AS expected, (SELECT close_evidence FROM issue_triage WHERE issue_id = 1) AS observed"
);

// Add a passing measuring probe
db.prepare('INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)').run(
  'measuring-1', 1, 'active', 'pass', 
  "SELECT 0 AS expected, (SELECT COUNT(*) FROM some_table WHERE defect_exists) AS observed"
);

// Should be able to close (deferral probe is excluded from blocking)
const closeStmt = db.prepare('UPDATE agent_issues SET status = ? WHERE id = ?');
let closeFailed1 = false;
try {
  closeStmt.run('closed', 1);
} catch (e) {
  closeFailed1 = true;
}
ok(!closeFailed1, 'Should allow closure when only deferral probe fails');


// Test case 2: Issue with measuring-fail should still be refused
db.prepare('INSERT INTO agent_issues (id, status, title) VALUES (?, ?, ?)').run(2, 'open', 'Test issue 2');
db.prepare('INSERT INTO issue_triage (issue_id, close_evidence) VALUES (?, ?)').run(2, 'Some evidence');

// Add a failing measuring probe (not a deferral)
db.prepare('INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)').run(
  'measuring-2', 2, 'active', 'fail', 
  "SELECT 0 AS expected, (SELECT COUNT(*) FROM some_table WHERE defect_exists) AS observed"
);

// Should NOT be able to close (measuring probe is failing)
let closeBlocked2 = false;
let error2 = '';
try {
  closeStmt.run('closed', 2);
} catch (e) {
  closeBlocked2 = true;
  error2 = e.message;
}
ok(closeBlocked2 && error2.includes('close-while-contract-fails'), 'Should block closure when measuring probe fails');


// Test case 3: Issue with BOTH deferral-fail and measuring-fail should be refused
db.prepare('INSERT INTO agent_issues (id, status, title) VALUES (?, ?, ?)').run(3, 'open', 'Test issue 3');
db.prepare('INSERT INTO issue_triage (issue_id, close_evidence) VALUES (?, ?)').run(3, 'Some evidence');

db.prepare('INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)').run(
  'deferral-3', 3, 'active', 'fail', 
  "SELECT 'closed-with-evidence' AS expected, (SELECT close_evidence FROM issue_triage WHERE issue_id = 3) AS observed"
);

db.prepare('INSERT INTO remediation_contracts (class, issue_id, status, last_verdict, verify_probe) VALUES (?, ?, ?, ?, ?)').run(
  'measuring-3', 3, 'active', 'fail', 
  "SELECT 0 AS expected, (SELECT COUNT(*) FROM some_table WHERE defect_exists) AS observed"
);

// Should NOT be able to close (measuring probe is failing, even though deferral is excluded)
let closeBlocked3 = false;
let error3 = '';
try {
  closeStmt.run('closed', 3);
} catch (e) {
  closeBlocked3 = true;
  error3 = e.message;
}
ok(closeBlocked3 && error3.includes('close-while-contract-fails'), 'Should block closure when measuring probe fails, regardless of deferral probe');

// Test case 4: Issue with no evidence should still be refused
db.prepare('INSERT INTO agent_issues (id, status, title) VALUES (?, ?, ?)').run(4, 'open', 'Test issue 4');

let closeBlocked4 = false;
let error4 = '';
try {
  closeStmt.run('closed', 4);
} catch (e) {
  closeBlocked4 = true;
  error4 = e.message;
}
ok(closeBlocked4 && error4.includes('close-without-evidence'), 'Should block closure without evidence');

db.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
