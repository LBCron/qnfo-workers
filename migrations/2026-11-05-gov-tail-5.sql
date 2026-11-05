-- GOV-TAIL-5 (2026-11-05, charter pillar autonomy; slice B-governance-tail of the issue-backlog cluster). Follows GOV-TAIL-4 (#7436, migration_runs 1325).
-- 1. The child issue PORTFOLIO-WRITE-VIA-PR-1 (1001928) was born with the generic superseded birth contract: the D1 triggers turn a `code-probe:` line into its code-read contract only on an UPDATE of the
--    description, never on the INSERT (the same trap as issue 1001774). A marked note appended to the description is that UPDATE, so the issue gets its closing probe (the marker PORTFOLIO-WRITE-VIA-PR-1 in
--    qnfo-fleet-control/worker.js) and stops being an orphan.
-- 2. Issue 1000781 (OWNER-ACT unit:pageviews, cost per impact unit): its probe returned the sentence 'cost per impact unit <= 0.012 (registered yield target)' as `expected` and 'cost per impact unit = 0.0xxxx'
--    as `observed`, which are never equal as text, so it could not read pass even at the target. Same measurement and same threshold (<= 0.012), the literal ok when it holds and the measured sentence when not.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description=(SELECT b.description FROM bak_20261105_gov_tail5_issues b WHERE b.id=agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_gov_tail5_issues); UPDATE remediation_contracts SET verify_probe=(SELECT b.verify_probe FROM bak_20261105_gov_tail5_contracts b WHERE b.class=remediation_contracts.class), last_verdict=(SELECT b.last_verdict FROM bak_20261105_gov_tail5_contracts b WHERE b.class=remediation_contracts.class), attempts=(SELECT b.attempts FROM bak_20261105_gov_tail5_contracts b WHERE b.class=remediation_contracts.class), next_due_at=(SELECT b.next_due_at FROM bak_20261105_gov_tail5_contracts b WHERE b.class=remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_gov_tail5_contracts);
-- The Rollback leaves the decision_log row: decision_log is append-only.

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail5_issues AS
SELECT id, description FROM agent_issues WHERE instr(title, 'PORTFOLIO-WRITE-VIA-PR-1') = 1 AND status = 'open';

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail5_contracts AS
SELECT class, verify_probe, last_verdict, attempts, next_due_at FROM remediation_contracts WHERE class = 'issue-1000781';

UPDATE agent_issues
SET description = description || char(10) || 'Note (GOV-TAIL-5 2026-11-05): the code-probe line above is armed by this update of the description; the contract closes the issue when the marker is in qnfo-fleet-control/worker.js on main.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE instr(title, 'PORTFOLIO-WRITE-VIA-PR-1') = 1 AND status = 'open' AND instr(description, 'code-probe: ') > 0 AND instr(description, 'GOV-TAIL-5') = 0;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN CAST((SELECT last_value FROM metric_registry WHERE metric = ''external_impact_per_dollar'') AS REAL) <= 0.012 THEN ''ok'' '
  || 'ELSE ''cost per impact unit = '' || COALESCE((SELECT printf(''%.5f'', CAST(last_value AS REAL)) FROM metric_registry WHERE metric = ''external_impact_per_dollar''), ''unmeasured'') || '' (registered yield target is at most 0.012)'' END AS observed',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000781' AND issue_id = 1000781 AND instr(verify_probe, 'cost per impact unit <= 0.012 (registered yield target)') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-B-governance-tail',
  'a code-probe line arms its contract only through an UPDATE of the description, and a probe that returns a sentence as expected can never equal its observed text',
  'GOV-TAIL-5: the PORTFOLIO-WRITE-VIA-PR-1 child issue gets its code-read contract, and the probe of issue 1000781 returns the literal ok at its unchanged threshold',
  'live 2026-11-05: issue 1001928 born with a superseded generic contract after migration_runs 1325; issue 1000781 observed ''cost per impact unit = 0.02483'' against a sentence as expected',
  'migration merged through the canonical path; no worker bundle changed',
  'one agent_issues description and one remediation_contracts row',
  'the Rollback header restores the description and the probe from the bak_20261105_gov_tail5_* tables; the decision row stays (append-only)',
  'the child issue is measured by the marker in the code it asks for; a probe that can pass at its own threshold',
  'orphan_issues_no_live_path -1; the planner dispatches a code task for 1001928 within an hour',
  'none',
  'offline suite migrations/gov-tail-5.test.mjs; live read of the contract after the apply'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'GOV-TAIL-5:%');
