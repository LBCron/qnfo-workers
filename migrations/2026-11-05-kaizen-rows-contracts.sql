-- KAIZEN-ROWS-CONTRACTS-1 (2026-11-05, charter pillar: autonomy; roadmap rows RM-KAIZEN-GATE-CANDIDATES-1 id 62 and RM-KAIZEN-SCHEDULED-1 id 63).
-- Follow-up of PR 7407 and PR 7441, both merged and applied ok on 2026-11-05 (migration_runs 1310: 28 statements at 00:28Z; 1328: 16 statements at 00:50Z). Read live after the apply:
--   * the three detector probes of PR 7407 return expected = observed (v_fleet_budget_undisposed 0, claim_sheet triggers 2, cost scope 0); their contracts are active and wait for the consumer's first run;
--   * kaizen_candidates holds no row in status proposed or scheduled (32 resolved, 9 promoted, 3 fixed, 1 wontfix); scripts/kaizen_gates.py exits 0 on main c28e3eea.
-- THIS FILE closes three loops those migrations left:
--   1. row 62 is built and a built row is verified by the steward only from a passing rm-<id> contract (ROADMAP-BUILT-VERIFY-1): rm-62 is that contract, a d1-query probe that reads the enforcers (the
--      twelve candidates resolved, the disposition view, the two claim_sheet triggers, the three detector contracts active), not the budget state, so a new breach elsewhere cannot hold the row open.
--   2. agent_issues 1001919 (costImpactGuard) was born with only the circular birth probe (superseded: its description is parsed up to the first closing brace and the code-probe text holds braces):
--      its contract becomes the code-read probe that measures the defect (the PUT body that sends spend_limits alone).
--   3. row 63 named "PR NUMBER" in its evidence: it now names PR 7441 and its two doers (agent_issues 1001929, 1001930).
-- PREDICTION: the steward moves row 62 to verified within about 4 hours of the next consumer run; the issue-1001919 contract reads fail until the code loop removes the PUT, then closes the issue.
-- Revert: the Rollback line restores the rows and the contract from bak_20261105_kaizen_rows and supersedes rm-62.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_kaizen_rows
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.t1 FROM bak_20261105_kaizen_rows b WHERE b.tbl = 'roadmap_implementation' AND b.k = roadmap_implementation.id) WHERE id IN (SELECT k FROM bak_20261105_kaizen_rows WHERE tbl = 'roadmap_implementation'); UPDATE remediation_contracts SET status = (SELECT b.s FROM bak_20261105_kaizen_rows b WHERE b.tbl = 'remediation_contracts' AND b.k = remediation_contracts.issue_id), verify_probe = (SELECT b.t1 FROM bak_20261105_kaizen_rows b WHERE b.tbl = 'remediation_contracts' AND b.k = remediation_contracts.issue_id), verify_transport = (SELECT b.t2 FROM bak_20261105_kaizen_rows b WHERE b.tbl = 'remediation_contracts' AND b.k = remediation_contracts.issue_id), last_verdict = (SELECT b.t3 FROM bak_20261105_kaizen_rows b WHERE b.tbl = 'remediation_contracts' AND b.k = remediation_contracts.issue_id) WHERE class = 'issue-1001919' AND issue_id IN (SELECT k FROM bak_20261105_kaizen_rows WHERE tbl = 'remediation_contracts'); UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:rollback' WHERE class = 'rm-62';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_kaizen_rows AS
SELECT 'roadmap_implementation' AS tbl, id AS k, status AS s, evidence AS t1, NULL AS t2, NULL AS t3 FROM roadmap_implementation WHERE id IN (62, 63)
UNION ALL
SELECT 'remediation_contracts', issue_id, status, verify_probe, verify_transport, last_verdict FROM remediation_contracts WHERE class = 'issue-1001919';

-- 1. the closing probe of row 62 (the steward verifies a built row from this contract and closes its mirror)
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-62', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item RM-KAIZEN-GATE-CANDIDATES-1 (id 62) is built and waits for its closing probe',
 'RM-KAIZEN-GATE-CANDIDATES-1: PR 7407 is on main; scripts/kaizen_gates.py is the strict kaizen-gates fast guard (the scans check passed on the PR); the twelve kaizen_candidates rows (rowid 34 to 45) are resolved with their enforcer named; v_fleet_budget_undisposed, the claim_sheet triggers and the three fm- detector contracts exist and are active (read 2026-11-05)',
 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM kaizen_candidates WHERE rowid BETWEEN 34 AND 45 AND status IN (''resolved'', ''fixed'')) = 12 AND (SELECT COUNT(*) FROM sqlite_master WHERE type = ''view'' AND name = ''v_fleet_budget_undisposed'') = 1 AND (SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name IN (''handoffs_claim_sheet_required_ins'', ''wbs_claim_sheet_required_ins'')) = 2 AND (SELECT COUNT(*) FROM remediation_contracts WHERE class IN (''fm-fleet-budget-undisposed'', ''fm-claim-sheet-triggers'', ''fm-cost-source-scope'') AND status IN (''active'', ''holding'')) = 3 THEN ''ok'' ELSE ''a kaizen gate enforcer is missing: a candidate not resolved, the disposition view, a claim_sheet trigger or a detector contract'' END AS observed',
 'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 62 AND item = 'RM-KAIZEN-GATE-CANDIDATES-1' AND status IN ('built', 'deployed', 'implemented');

UPDATE roadmap_implementation SET evidence = COALESCE(evidence, '') || ' | PR 7407 merged 2026-11-05T00:27Z, migration_runs 1310 ok (28 statements); the scans check ran the kaizen-gates guard green; read live after apply: the three detector probes return expected = observed (v_fleet_budget_undisposed 0, claim_sheet triggers 2, cost scope 0); doer for the defect found: agent_issues 1001919; closing probe: contract rm-62'
WHERE id = 62 AND instr(COALESCE(evidence, ''), 'PR 7407 merged') = 0;

-- 2. the real closing probe of the costImpactGuard issue (the birth probe was the circular one)
UPDATE remediation_contracts SET verify_transport = 'code-read',
  verify_probe = '{"paths": ["qnfo-fleet-control/worker.js"], "absent": "body: JSON.stringify({ spend_limits: { enabled: true, rules: newRules } })"}',
  status = 'active', module = 'kaizen-gates-2026-11-05', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 1, max_attempts = 3,
  action = 'machine probe: the PUT body that sends spend_limits alone must be gone from costImpactGuard (KAIZEN-ROWS-CONTRACTS-1, 2026-11-05)'
WHERE class = 'issue-1001919' AND status = 'superseded' AND issue_id = 1001919;

-- 3. row 63 names its PR and its doers
UPDATE roadmap_implementation SET evidence = replace(evidence, '(PR NUMBER)', '(PR 7441, migration_runs 1328 ok; doers agent_issues 1001929 and 1001930)')
WHERE id = 63 AND instr(COALESCE(evidence, ''), '(PR NUMBER)') > 0;
