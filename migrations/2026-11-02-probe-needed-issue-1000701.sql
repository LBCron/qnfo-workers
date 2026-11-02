-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_probe_needed_1000701
-- Rollback: UPDATE remediation_contracts SET issue_id=(SELECT issue_id FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),precondition=(SELECT precondition FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),action=(SELECT action FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),verify_probe=(SELECT verify_probe FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),verify_transport=(SELECT verify_transport FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),max_attempts=(SELECT max_attempts FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),escalate_to=(SELECT escalate_to FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),expected_cadence_h=(SELECT expected_cadence_h FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),status=(SELECT status FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),ts=(SELECT ts FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),last_attempt_at=(SELECT last_attempt_at FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),last_verdict=(SELECT last_verdict FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),module=(SELECT module FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),budget_ms=(SELECT budget_ms FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),next_due_at=(SELECT next_due_at FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),max_items=(SELECT max_items FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),requires_container=(SELECT requires_container FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),attempts=(SELECT attempts FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class),deferred_since=(SELECT deferred_since FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class) WHERE class='issue-1000701' AND module='probe-needed-issue-1000701' AND EXISTS (SELECT 1 FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class); DELETE FROM remediation_contracts WHERE class='issue-1000701' AND module='probe-needed-issue-1000701' AND NOT EXISTS (SELECT 1 FROM bak_20261102_probe_needed_1000701 WHERE class=remediation_contracts.class);

-- PROBE-NEEDED-ISSUE-1000701-1 (2026-11-02, charter pillar autonomy).
-- Restore the paper-quality probe against living-paper records; it measures both affected papers and never reads issue 1000701 status.

CREATE TABLE IF NOT EXISTS bak_20261102_probe_needed_1000701 AS
SELECT * FROM remediation_contracts WHERE class = 'issue-1000701';

UPDATE remediation_contracts
SET precondition = 'Both published papers from REVISED-STANDARD-1 have title and abstract sections and contain neither known raw-outline marker.',
    action = 'MEASURES the two papers in living-paper and reports pending unless both bodies pass the established paper-format checks; never reads issue 1000701 status.',
    verify_probe = 'SELECT ''2'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM papers WHERE slug IN (''a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning'', ''simulation-inconsistency-detection-via-neurobiological-and-cognitive-interfaces'') AND ltrim(body_md) LIKE ''# %'' AND instr(body_md, ''## Abstract'') > 0 AND body_md NOT LIKE ''%TOPIC COMPLEXITY ASSESSMENT%'' AND body_md NOT LIKE ''%Here is the continuation of the detailed%''',
    verify_transport = 'd1-query@living-paper',
    max_attempts = 24,
    escalate_to = 'qnfo-fleet-control',
    expected_cadence_h = 1,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    module = 'probe-needed-issue-1000701',
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1000701' AND issue_id = 1000701
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000701 AND status = 'open')
  AND (status <> 'active'
    OR verify_transport <> 'd1-query@living-paper'
    OR verify_probe <> 'SELECT ''2'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM papers WHERE slug IN (''a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning'', ''simulation-inconsistency-detection-via-neurobiological-and-cognitive-interfaces'') AND ltrim(body_md) LIKE ''# %'' AND instr(body_md, ''## Abstract'') > 0 AND body_md NOT LIKE ''%TOPIC COMPLEXITY ASSESSMENT%'' AND body_md NOT LIKE ''%Here is the continuation of the detailed%''');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at, attempts, last_verdict, deferred_since)
SELECT 'issue-1000701', 1000701,
       'Both published papers from REVISED-STANDARD-1 have title and abstract sections and contain neither known raw-outline marker.',
       'MEASURES the two papers in living-paper and reports pending unless both bodies pass the established paper-format checks; never reads issue 1000701 status.',
       'SELECT ''2'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM papers WHERE slug IN (''a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning'', ''simulation-inconsistency-detection-via-neurobiological-and-cognitive-interfaces'') AND ltrim(body_md) LIKE ''# %'' AND instr(body_md, ''## Abstract'') > 0 AND body_md NOT LIKE ''%TOPIC COMPLEXITY ASSESSMENT%'' AND body_md NOT LIKE ''%Here is the continuation of the detailed%''',
       'd1-query@living-paper', 24, 'qnfo-fleet-control', 1, 'active', 'probe-needed-issue-1000701', datetime('now'), 0, NULL, NULL
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000701 AND status = 'open')
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts WHERE class = 'issue-1000701');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:PROBE-NEEDED-ISSUE-1000701-1',
       'The definition of done is that both named published papers no longer match the raw-outline markers.',
       'PROBE-NEEDED-ISSUE-1000701-1: re-armed issue-1000701 with the living-paper content probe.',
       'The prior cluster-f-b-drain migration identifies both paper slugs and the expected count of two; its test demonstrates that an outline marker makes the probe fail. The probe reads papers only, not issue status.',
       'An active hourly D1 probe measures both papers; issue closure awaits its successful live run.',
       'remediation_contracts class issue-1000701 only.',
       'Rollback restores the backed-up contract from bak_20261102_probe_needed_1000701, or removes it if this migration created it; decision history remains append-only.',
       'An open paper-quality issue regains a live content-based verification path.',
       'The contract becomes active and measures both papers; an outline-marked paper changes observed from 2 to less than 2.',
       'No external reach change; one autonomy reliability issue gains measurable closure evidence.',
       'SQLite regression fixture; CI migration application and living-paper remediation-consumer run.'
WHERE EXISTS (
  SELECT 1 FROM remediation_contracts
  WHERE class = 'issue-1000701' AND issue_id = 1000701
    AND status = 'active' AND verify_transport = 'd1-query@living-paper'
    AND verify_probe = 'SELECT ''2'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM papers WHERE slug IN (''a-unified-framework-for-superdeterminism-neurobiology-and-the-mechanics-of-human-meaning'', ''simulation-inconsistency-detection-via-neurobiological-and-cognitive-interfaces'') AND ltrim(body_md) LIKE ''# %'' AND instr(body_md, ''## Abstract'') > 0 AND body_md NOT LIKE ''%TOPIC COMPLEXITY ASSESSMENT%'' AND body_md NOT LIKE ''%Here is the continuation of the detailed%'''
)
AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000701 AND status = 'open')
AND NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE actor = 'qnfo-workers:PROBE-NEEDED-ISSUE-1000701-1'
    AND action = 'PROBE-NEEDED-ISSUE-1000701-1: re-armed issue-1000701 with the living-paper content probe.'
);
