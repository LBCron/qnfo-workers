-- GOV-TAIL-1 (2026-11-05, charter pillar autonomy; owner of the slice: breach-issues B-governance-tail). Issue backlog 509 open, 334 older than 24 h with no doer.
-- This file works the governance tail by evidence, never by wontfix:
--   1. TP-1.7 (issue 100317): the re-ask in evModelJson landed on 2026-11-01 (PR 5671, EV_REASKED in qnfo-fleet-control/worker.js) and evolve_parse_pass_pct_7d reads 100.0
--      (target >= 50), but the contract still counts model-skip rows from before the fix and can never read pass. Its probe now judges only rows created after the fix. Its
--      session fallback twin 1001448 (CODE-TASK-NEEDS-SESSION-1) is superseded by 100317: the same change.
--   2. TP-3.9 (issue 1001461): scripts/charter-guard.py rule C6 (CHARTER-PILLAR-EVERY-TOML-1, PR 7011, 2026-11-04) fails any live wrangler.toml without a pillar line; the guard
--      read PASS with missing_pillar_line=0 over 36 deployable directories on 2026-11-04. The lever row (transformation_levers id 28) is landed, the issue closes.
--   3. Probes that could never pass (the consumer passes a d1-query contract only when expected equals observed as text): issue-100595 (expected '0 open PRs older than
--      60m awaiting merge' against a longer sentence), issue-1000825 (expected '0 off-target QNFO.PERSONAL metrics are missing a doer' against '0 off-target metrics without a
--      doer') and issue-1000817 (expected '0 unmapped breach metrics' against '0 unmapped breach metric(s)'). Each keeps its measurement and returns ok when it holds.
--   4. issue 1000817: 9 breaching metrics had no metric_breach_cause row (v_breach_by_cause read them as unmapped). Each is mapped to the cause whose lever its own trigger
--      names, with INSERT OR IGNORE so a mapping a session made with better evidence is kept.
--   5. OWNER-HANDBACK 1001748 (Exuvia agent account): its card closes when qnfo-memory-mcp /health reports exuvia_key true; read live 2026-11-04T23:31Z: status ok, version 2.8.0,
--      exuvia_key true, auth true, read_token true, query_token true.
--   6. BLINDSPOT-1 1001781 (belief evolve-wip-planner-alignment): its latest verification row passes (remediation_verifications class belief-evolve-wip-planner-alignment, pass 1 at 2026-11-04 23:29:09), so the claim is true again.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe=(SELECT b.verify_probe FROM bak_20261105_gov_tail_contracts b WHERE b.class=remediation_contracts.class), status=(SELECT b.status FROM bak_20261105_gov_tail_contracts b WHERE b.class=remediation_contracts.class), last_verdict=(SELECT b.last_verdict FROM bak_20261105_gov_tail_contracts b WHERE b.class=remediation_contracts.class), next_due_at=(SELECT b.next_due_at FROM bak_20261105_gov_tail_contracts b WHERE b.class=remediation_contracts.class), attempts=(SELECT b.attempts FROM bak_20261105_gov_tail_contracts b WHERE b.class=remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_gov_tail_contracts); UPDATE agent_issues SET status=(SELECT b.status FROM bak_20261105_gov_tail_issues b WHERE b.id=agent_issues.id), close_channel=(SELECT b.close_channel FROM bak_20261105_gov_tail_issues b WHERE b.id=agent_issues.id), updated_at=(SELECT b.updated_at FROM bak_20261105_gov_tail_issues b WHERE b.id=agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_gov_tail_issues); UPDATE issue_triage SET triage_state=(SELECT b.triage_state FROM bak_20261105_gov_tail_issues b WHERE b.id=issue_triage.issue_id), close_evidence=(SELECT b.close_evidence FROM bak_20261105_gov_tail_issues b WHERE b.id=issue_triage.issue_id) WHERE issue_id IN (SELECT id FROM bak_20261105_gov_tail_issues); DELETE FROM metric_breach_cause WHERE note='GOV-TAIL-1'; UPDATE transformation_levers SET status=(SELECT b.status FROM bak_20261105_gov_tail_levers b WHERE b.id=28), landed_at=(SELECT b.landed_at FROM bak_20261105_gov_tail_levers b WHERE b.id=28), note=(SELECT b.note FROM bak_20261105_gov_tail_levers b WHERE b.id=28) WHERE id=28;
-- The Rollback leaves the decision_log row: decision_log is append-only.

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail_contracts AS
SELECT class, issue_id, verify_probe, status, last_verdict, next_due_at, attempts
FROM remediation_contracts
WHERE class IN ('issue-100317', 'issue-1001448', 'issue-100595', 'issue-1000825', 'issue-1000817');

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail_issues AS
SELECT a.id, a.status, a.close_channel, a.updated_at, t.triage_state, t.close_evidence
FROM agent_issues a LEFT JOIN issue_triage t ON t.issue_id = a.id
WHERE a.id IN (100317, 1001448, 1001461, 1001748, 1001781);

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail_levers AS
SELECT id, status, landed_at, note FROM transformation_levers WHERE id = 28;

-- 1. TP-1.7: judge only the rows created after the re-ask shipped (merge 2026-11-01T15:03Z, deployed within the hour).
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE '
  || 'WHEN COALESCE((SELECT CAST(last_value AS REAL) FROM metric_registry WHERE metric = ''evolve_parse_pass_pct_7d'' AND state = ''MEASURED''), -1) < 50 THEN ''evolve_parse_pass_pct_7d is unmeasured or below 50'' '
  || 'WHEN (SELECT COUNT(*) FROM evolve_candidates WHERE status = ''model-skip'' AND ts >= ''2026-11-01T16:00:00Z'' AND note LIKE ''no usable JSON%'' AND COALESCE(proposal, '''') NOT LIKE ''%"reasked":true%'') > 0 '
  || 'THEN ''a no-usable-JSON model-skip after the re-ask shipped was not re-asked'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-100317' AND issue_id = 100317;

UPDATE remediation_contracts
SET status = 'superseded', last_verdict = 'superseded:duplicate-of-100317', next_due_at = NULL
WHERE class = 'issue-1001448' AND issue_id = 1001448 AND status IN ('active', 'holding', 'monitoring', 'needs-machine-probe', 'probe-review-refused');

UPDATE issue_triage
SET triage_state = 'closed', owner = COALESCE(owner, 'qnfo-fleet-control'),
    close_evidence = 'superseded by #100317: CODE-TASK-NEEDS-SESSION-1 twin of the same lever (TP-1.7-EVOLVE-PARSE-GATE-1, evModelJson re-ask). The change is on main (EV_REASKED in qnfo-fleet-control/worker.js, PR 5671 of 2026-11-01, task ct_vj0agcottcdm17 / PR 6618) and metric_registry evolve_parse_pass_pct_7d reads 100.0 (target >= 50, refreshed 2026-11-04T22:28Z). #100317 keeps the closing probe, rewritten to judge only rows after the fix.'
WHERE issue_id = 1001448 AND COALESCE(close_evidence, '') = ''
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001448 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 100317 AND status = 'open');

-- 2. TP-3.9: charter-guard C6 is on main; the lever is landed.
UPDATE transformation_levers
SET status = 'landed', landed_at = COALESCE(landed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), stalled_at = NULL,
    note = 'landed: scripts/charter-guard.py rule C6 CHARTER-PILLAR-EVERY-TOML-1 (PR 7011, 2026-11-04); charter-guard PASS with missing_pillar_line=0 over 36 deployable directories (GOV-TAIL-1)',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 28 AND key = 'charter-pillar-on-every-toml' AND status <> 'landed';

UPDATE issue_triage
SET triage_state = 'closed', owner = COALESCE(owner, 'qnfo-fleet-control'),
    close_evidence = 'TP-3.9 landed: scripts/charter-guard.py rule C6 (CHARTER-PILLAR-EVERY-TOML-1, PR 7011 merged 2026-11-04) fails any live wrangler.toml without a charter-pillar line, and the 42 declarations landed in that PR. Live read on main 2026-11-04T23:20Z: python scripts/charter-guard.py prints deployable_dirs=36 missing_pillar_line=0 and CHARTER-GUARD PASS. transformation_levers id 28 is set to landed by this migration (GOV-TAIL-1).'
WHERE issue_id = 1001461 AND COALESCE(close_evidence, '') = ''
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001461 AND status = 'open')
  AND EXISTS (SELECT 1 FROM transformation_levers WHERE id = 28 AND status = 'landed');

-- 3. Probes that could never read pass: same measurement, the literal ok when it holds.
UPDATE remediation_contracts
SET verify_probe = 'WITH o AS (SELECT pr, waits_on, CAST((julianday(''now'') - julianday(opened_at)) * 1440 AS INTEGER) AS age_min FROM pr_sla_state WHERE state = ''open'') '
  || 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM o WHERE age_min > 60) = 0 THEN ''ok'' '
  || 'ELSE (SELECT COUNT(*) FROM o WHERE age_min > 60) || '' open PRs older than 60m, oldest '' || (SELECT MAX(age_min) FROM o) || ''m, prs '' || COALESCE((SELECT group_concat(pr || ''('' || COALESCE(waits_on, ''none'') || '','' || age_min || ''m)'') FROM o WHERE age_min > 60), ''none'') END AS observed',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-100595' AND issue_id = 100595 AND instr(verify_probe, '0 open PRs older than 60m awaiting merge') > 0;

UPDATE remediation_contracts
SET verify_probe = 'WITH personal_off AS (SELECT metric_key, verdict, has_code_task FROM metric_improvement_now WHERE program_code = ''QNFO.PERSONAL'' AND verdict NOT IN (''on-target'', ''unmeasured'')) '
  || 'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) = 0 THEN ''ok'' ELSE COUNT(*) || '' off-target QNFO.PERSONAL metrics without a doer: '' || group_concat(metric_key, '', '') END AS observed FROM personal_off WHERE has_code_task = 0',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000825' AND issue_id = 1000825 AND instr(verify_probe, '0 off-target QNFO.PERSONAL metrics are missing a doer') > 0;

UPDATE remediation_contracts
SET verify_probe = 'WITH breached AS (SELECT metric_key FROM v_metric_trigger_state WHERE hit = 1) '
  || 'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) = 0 THEN ''ok'' ELSE COUNT(*) || '' unmapped breach metric(s): '' || group_concat(b.metric_key, '', '') END AS observed '
  || 'FROM breached b LEFT JOIN metric_breach_cause c ON c.metric_key = b.metric_key WHERE c.metric_key IS NULL',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000817' AND issue_id = 1000817 AND instr(verify_probe, '0 unmapped breach metrics') > 0;

-- 4. Nine breaching metrics with no cause row, each mapped by the lever its own trigger names (cause keys already in use).
INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
 ('workers_ai_attribution_coverage_pct', 'spend', 'GOV-TAIL-1'),
 ('improvement_rate_7d', 'issue-backlog', 'GOV-TAIL-1'),
 ('idea_topic_concentration_30d', 'publishing', 'GOV-TAIL-1'),
 ('worker_count_disagreement', 'structure', 'GOV-TAIL-1'),
 ('metrics_on_probation_overdue', 'measurement', 'GOV-TAIL-1'),
 ('contracts_unexecutable_open', 'issue-backlog', 'GOV-TAIL-1'),
 ('cf_obs_reopen_churn_24h', 'issue-backlog', 'GOV-TAIL-1'),
 ('secrets_in_repo', 'structure', 'GOV-TAIL-1'),
 ('plain_article_coverage_pct', 'publishing', 'GOV-TAIL-1');

-- 5. OWNER-HANDBACK ha:exuvia-register-agent: the card's own closing condition holds (live /health read, 2026-11-04T23:31Z).
UPDATE issue_triage
SET triage_state = 'closed', owner = COALESCE(owner, 'qnfo-fleet-dashboard'),
    close_evidence = 'The card closes when https://qnfo-memory-mcp.q08.workers.dev/health reports exuvia_key true. Live GET 2026-11-04T23:31Z: {"status":"ok","server":"qnfo-memory-mcp","version":"2.8.0","auth":true,"read_token":true,"query_token":true,"exuvia_key":true}. The four secret-triggered versions of qnfo-memory-mcp on 2026-11-04 14:27-14:29Z (SECRET-CHANGE-OBSERVED 1001646) are the EXUVIA_API_KEY put. No account was created or key minted by this migration.'
WHERE issue_id = 1001748 AND COALESCE(close_evidence, '') = ''
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001748 AND status = 'open');

-- 6. BLINDSPOT-1: the belief's latest probe passes again.
UPDATE issue_triage
SET triage_state = 'closed', owner = COALESCE(owner, 'qnfo-fleet-control'),
    close_evidence = 'Belief evolve-wip-planner-alignment: the latest remediation_verifications row of class belief-evolve-wip-planner-alignment passes (pass 1, expected 1 observed 1, verified_at 2026-11-04 23:29:09), so the claim is true again and the issue text closes on exactly that condition. The audit re-files it if the probe fails again.'
WHERE issue_id = 1001781 AND COALESCE(close_evidence, '') = ''
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001781 AND status = 'open')
  AND COALESCE((SELECT v.pass FROM remediation_verifications v WHERE v.class = 'belief-evolve-wip-planner-alignment' ORDER BY v.id DESC LIMIT 1), 0) = 1;

-- The sync trigger closes the issue with an auto:triage-sync channel; name the session channel the playbook asks for.
UPDATE agent_issues SET close_channel = 'session:breach-remediation'
WHERE id IN (1001448, 1001461, 1001748, 1001781) AND status = 'closed' AND close_channel LIKE 'auto:triage-sync%';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-B-governance-tail',
  'a verification that cannot read pass is not a check, and a lever whose change is on main is closed with the evidence, never by wontfix',
  'GOV-TAIL-1: probe repairs for issues 100317, 100595, 1000825, 1000817; 9 breach causes mapped; issues 1001448, 1001461, 1001748, 1001781 closed with evidence; lever 28 landed',
  'charter-guard PASS (36 dirs, 0 missing) on main; evolve_parse_pass_pct_7d 100.0; qnfo-memory-mcp /health exuvia_key true at 2026-11-04T23:31Z; v_breach_by_cause listed 9 unmapped metrics before; belief-evolve-wip-planner-alignment pass 1 at 23:29:09',
  'migration merged through the canonical path; no worker bundle changed',
  'five remediation_contracts rows, nine metric_breach_cause rows, one transformation_levers row, four issues closed',
  'the Rollback header restores the contracts, issues, triage rows and lever from the bak_20261105_gov_tail_* tables and deletes the nine cause rows; the decision row stays (append-only)',
  'three contracts that could never pass can now close their issues; four landed or true items leave the backlog with evidence',
  'open_agent_issues falls by 4 at once and by up to 4 more when issues 100317, 100595, 1000825, 1000817 pass their two consecutive verifications; breaches_unmapped reads 0 for the nine',
  'none',
  'offline suite migrations/gov-tail-1.test.mjs (the migration on SQLite with the live probe shapes and fixtures); live reads of charter-guard, the memory-mcp health route, evolve_candidates and the verification rows'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'GOV-TAIL-1:%');
