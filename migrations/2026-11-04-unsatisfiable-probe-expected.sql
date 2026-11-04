-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = replace(verify_probe, 'SELECT ''ok'' AS expected, CASE WHEN (SELECT d FROM mx) <= 10 THEN ''ok'' ELSE ''max trigger nesting depth '' || (SELECT d FROM mx) END AS observed', 'SELECT ''<=10'' AS expected, CAST((SELECT d FROM mx) AS TEXT) AS observed') WHERE class = 'issue-1001212'; UPDATE remediation_contracts SET verify_probe = replace(verify_probe, 'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) >= 1 THEN ''ok'' ELSE COUNT(*) || '' published policy or science analyses on q08.org'' END AS observed FROM content_external_items', 'SELECT ''>=1 published policy or science analysis'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM content_external_items') WHERE class = 'issue-1000715'; DELETE FROM remediation_contracts WHERE class = 'fm-probe-expected-unsatisfiable'; DELETE FROM failure_modes WHERE fm_key = 'probe-expected-unsatisfiable';
-- The Rollback leaves the decision row: decision_log is append-only.
-- BACKUP: remediation_contracts
-- PROBE-EXPECTED-UNSATISFIABLE-1 (2026-11-04, charter pillar autonomy; GitHub issue 6182 / agent_issues 1001212, and the ROADMAP-1 EK-4 contract issue-1000715).
-- The consumer passes a d1-query contract only when `expected` equals `observed` as text (scripts/remediation_consumer.py classify: "pass = 1 only when expected == observed"),
-- and its protocol fixes `expected` to a literal token. Two contracts wrote a comparator as the expected literal and a bare number as the observed value:
--   issue-1001212 (TRIGGER-DEPTH-COMPILE-1)  expected '<=10'                                        observed '5'   (max trigger nesting depth measured live 2026-11-04: 5)
--   issue-1000715 (EK-4 policy/science form)   expected '>=1 published policy or science analysis'  observed '0' or '2'
-- Neither can read pass = 1, whatever the system does: 57 and 80 verifications, every one `fail`, so the defect of 1001212 (already gone) stayed open and the 1000715 deliverable
-- could not be recognised when it ships. (Three more contracts with a comparator literal, issue-1000268, 1000779 and 1000802, return the literal from a CASE when the condition holds, so they
-- can pass and are left alone.) The two probes keep the measurement and the threshold exactly; only the token changes: expected 'ok', observed 'ok' when the threshold holds and the
-- measured value otherwise. Each REPLACE edits the probe's own head or tail, so a second run finds nothing to replace.
-- The detector `fm-probe-expected-unsatisfiable` counts active or holding d1-query contracts that still carry a comparator literal with no CASE in the probe, expected 0.
-- BACKUP names remediation_contracts: the table holds the old probes (the Rollback restores them) and the file deletes no rows.
UPDATE remediation_contracts SET verify_probe = replace(verify_probe,
  'SELECT ''<=10'' AS expected, CAST((SELECT d FROM mx) AS TEXT) AS observed',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT d FROM mx) <= 10 THEN ''ok'' ELSE ''max trigger nesting depth '' || (SELECT d FROM mx) END AS observed')
 WHERE class = 'issue-1001212';

UPDATE remediation_contracts SET verify_probe = replace(verify_probe,
  'SELECT ''>=1 published policy or science analysis'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM content_external_items',
  'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) >= 1 THEN ''ok'' ELSE COUNT(*) || '' published policy or science analyses on q08.org'' END AS observed FROM content_external_items')
 WHERE class = 'issue-1000715';

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('probe-expected-unsatisfiable',
   'a d1-query contract can never pass because its expected token is a comparator and its observed value a bare number',
   'the consumer passes only when expected equals observed as text; a probe written as SELECT ''<=10'' AS expected, CAST(n AS TEXT) AS observed compares ''<=10'' with ''5''',
   'PROBE-EXPECTED-UNSATISFIABLE-1: expected is the literal ok and observed is ok when the threshold holds, else the measured value; fm-probe-expected-unsatisfiable counts the contracts that still read the old way',
   'd1-query count of active or holding d1-query contracts whose probe holds a comparator literal (<= or >=) as expected and no CASE',
   'fm-probe-expected-unsatisfiable', '2026-11-04', 1001212,
   'a probe author writes a threshold as the expected literal instead of mapping it to ok',
   'a contract fails every verification (57 and 80 attempts) while the measured value meets the threshold, so the issue never closes',
   'issue-1001212 (TRIGGER-DEPTH-COMPILE-1 stayed open after the trigger graph was fixed) and issue-1000715');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to) VALUES
  ('fm-probe-expected-unsatisfiable', NULL,
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts WHERE status IN (''active'', ''holding'') AND verify_transport LIKE ''d1-query%'' AND (instr(verify_probe, ''''''<='') > 0 OR instr(verify_probe, ''''''>='') > 0) AND instr(verify_probe, ''CASE'') = 0) AS TEXT) AS observed',
   'd1-query', 3, 1, 'active', 'PROBE-EXPECTED-UNSATISFIABLE-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:github-issues-resolution',
  'a verification that cannot read pass = 1 is not a check, so the fix is to make the same measurement satisfiable, never to loosen the threshold or close the issue by hand',
  'PROBE-EXPECTED-UNSATISFIABLE-1: the probes of issue-1001212 and issue-1000715 return the literal ok when their threshold holds; detector fm-probe-expected-unsatisfiable added',
  'remediation_contracts read 2026-11-04: issue-1001212 attempts 57 last_verdict fail while the probe body measures max trigger depth 5 (<= 10); issue-1000715 attempts 80 fail with expected ''>=1 ...'' against observed a number; zero-row INSERTs into deployment_history and fleet_tick_heavy compile',
  'migration merged through the canonical path; no worker bundle changed',
  'two remediation_contracts rows, one failure_modes row and one detector contract',
  'the Rollback header restores both probes and removes the detector; the decision row stays (append-only)',
  'a contract whose threshold holds reads pass and closes its issue through the normal two-pass rule; a new comparator-literal probe is caught within the hour',
  'issue-1001212 reads pass within two hourly passes and closes; issue-1000715 stays open until a q08 policy or science analysis is published, then closes; fm-probe-expected-unsatisfiable reads ok (0)',
  'none',
  'offline suite migrations/unsatisfiable-probe-expected.test.mjs (both new probes run on sqlite against a shallow and a 12-deep trigger chain and against content rows; the detector reads 2 before and 0 after); live read of the trigger graph depth (5) and of the 0 published rows'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PROBE-EXPECTED-UNSATISFIABLE-1:%');
