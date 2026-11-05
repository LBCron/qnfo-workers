-- SLICE-C-DISPOSITIONS-1 (2026-11-05, charter pillar autonomy; issue-backlog cluster, slice C-roadmap-and-free-text). Closed loops for issues whose subject is
-- resolved or carried by an open successor, and two probes that measured something no fix could satisfy or the wrong half of the defect.
-- Re-measured 2026-11-04T23:30Z to 2026-11-05T00:10Z (qnfo-audit, SELECT only) before any row was written:
--   1. CODE-MERGE-REFUSED-1 1000625 (task ct_im1000619) and 1000854 (task ct_im1000787): the issues those tasks worked, 1000619 and 1000787, are both closed
--      (agent_issues.status). The refusal records a merge that no longer has a subject; moot, with the parent named in the evidence.
--   2. METRIC-FIX-RELAPSED-1 100281 (subscribers_growth_monthly) and 100286 (attention_decision_efficacy_30d): the same metric is carried by the open critical
--      tickets METRIC-TRIGGER-341-SUBSCRIBERS-GROWTH-MONTHLY (1753) and METRIC-TRIGGER-1868-ATTENTION-DECISION-EFFICACY-30D (2467), which hold the metric-condition
--      probe. Two tickets on one metric is one path counted twice; the relapse ticket is superseded by the trigger ticket (neither is edited).
--   3. content_items_over_stage_sla 100456 (owner diagnosis of 1,601 items in three stalled loops): carried by METRIC-TRIGGER-5915-CONTENT-ITEMS-OVER-STAGE-SLA (99948).
--      Today's reading is in the close evidence: the errata and revision loops that issue named are drained (errata 15 over SLA, revision 0); 1,378 of the 1,569
--      are research/queued rows that wait for budget (62 of the 66 research_queue rows created on 2026-11-04 are status deferred), so the remaining defect is
--      research intake against the research_daily_neurons governor, which 99948 now carries with that decomposition.
--   4. noop-guard misreads SQL-inside-a-JS-string edits (1001468): the fix is NOOP-SQL-LITERAL-1 (qnfo-code-orchestrator 0.37.4, PR 6938, merged 2026-11-04T15:08Z,
--      live version 0.46.0). Every matching code-task.noop-refused event is older than the fix (newest 2026-11-04T04:40:57Z), but the probe counts a rolling 24 hours,
--      so it stays red until 2026-11-05T04:41Z whatever was fixed. The probe now counts events since 2026-11-04T15:30Z (after the merge and its deploy): the same
--      predicate, the window that can show the fix. After 04:41Z tomorrow both windows read the same.
--   5. q08 forecast update scoring (1000662): RM-FORECAST-UPDATE-SCORING-1 is on main (q08-signal-engine 0.42.0, PR 5578; attachForecastUpdateScore sets updated_brier,
--      updated_probability, updated_log_score; suite q08-signal-engine/forecast.test.mjs) and live (GET https://q08.org/health version 0.43.0). The contract was born
--      superseded on a closure-observing probe that cannot pass; it becomes a code-read probe on the function that sets the field.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE issue_triage SET triage_state = (SELECT f.triage_state FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1), close_evidence = (SELECT f.triage_close_evidence FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1), reopened_count = (SELECT f.triage_reopened_count FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1), triaged_at = (SELECT f.triage_triaged_at FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1) WHERE issue_id IN (SELECT issue_id FROM issue_fold_ledger WHERE applied = 1 AND rule LIKE 'slice-c-%'); UPDATE agent_issues SET status = 'open', close_channel = (SELECT f.agent_close_channel FROM issue_fold_ledger f WHERE f.issue_id = agent_issues.id AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1), updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE id IN (SELECT issue_id FROM issue_fold_ledger WHERE applied = 1 AND rule LIKE 'slice-c-%') AND status = 'closed' AND close_channel LIKE 'session:breach-remediation%'; UPDATE remediation_contracts SET status = (SELECT f.contract_status FROM issue_fold_ledger f WHERE f.contract_class = remediation_contracts.class AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1), last_verdict = (SELECT f.contract_last_verdict FROM issue_fold_ledger f WHERE f.contract_class = remediation_contracts.class AND f.applied = 1 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1) WHERE class IN (SELECT contract_class FROM issue_fold_ledger WHERE applied = 1 AND rule LIKE 'slice-c-%' AND contract_class IS NOT NULL) AND last_verdict LIKE 'superseded:closure-superseded%'; UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_slice_c_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_slice_c_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_slice_c_contracts b WHERE b.class = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_slice_c_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_slice_c_contracts b WHERE b.class = remediation_contracts.class), next_due_at = datetime('now') WHERE class IN ('issue-1001468', 'issue-1000662')

CREATE TABLE IF NOT EXISTS issue_fold_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, rule TEXT NOT NULL, successor_id INTEGER, evidence TEXT NOT NULL,
  agent_status TEXT, agent_updated_at INTEGER, agent_close_channel TEXT, triage_state TEXT, triage_close_evidence TEXT, triage_reopened_count INTEGER, triage_triaged_at TEXT,
  contract_class TEXT, contract_status TEXT, contract_last_verdict TEXT, contract_last_attempt_at TEXT,
  applied INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), applied_at TEXT);

CREATE INDEX IF NOT EXISTS idx_issue_fold_ledger_issue ON issue_fold_ledger(issue_id, applied);

CREATE TABLE IF NOT EXISTS bak_20261105_slice_c_contracts AS
SELECT * FROM remediation_contracts WHERE class IN ('issue-1001468', 'issue-1000662');

-- 1. moot: the code task a CODE-MERGE-REFUSED-1 ticket records worked an issue that is closed
INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at)
SELECT m.id, 'slice-c-merge-refused-parent-closed', p.id,
  'moot: the code task this ticket records (' || substr(m.title, 33, instr(substr(m.title, 33) || ' ', ' ') - 1) || ') worked issue ' || p.id || ' (' || substr(p.title, 1, 80) || '), which is ' || p.status || ' (agent_issues read ' || strftime('%Y-%m-%d', 'now') || '), so the merge refusal has no subject left. SLICE-C-DISPOSITIONS-1',
  m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at
FROM agent_issues m
JOIN issue_triage t ON t.issue_id = m.id
LEFT JOIN remediation_contracts c ON c.class = 'issue-' || m.id
JOIN agent_issues p ON p.id = CAST(substr(substr(m.title, 33, instr(substr(m.title, 33) || ' ', ' ') - 1), 6) AS INTEGER)
WHERE m.status = 'open' AND m.id IN (1000625, 1000854)
  AND m.title LIKE 'CODE-MERGE-REFUSED-1: code task ct_im%' AND p.status IN ('closed', 'resolved')
  AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0);

-- 2. superseded: the same metric is carried by an open trigger ticket of equal or higher priority
INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at)
SELECT m.id, 'slice-c-superseded-by-trigger-ticket', s.id,
  'superseded by ' || s.id || ' (' || substr(s.title, 1, 100) || ', ' || s.status || ', ' || s.priority || '): the same metric, carried by the trigger ticket and its metric-condition probe, so the relapse ticket counted one path twice. SLICE-C-DISPOSITIONS-1 ' || strftime('%Y-%m-%d', 'now'),
  m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at
FROM agent_issues m
JOIN issue_triage t ON t.issue_id = m.id
LEFT JOIN remediation_contracts c ON c.class = 'issue-' || m.id
JOIN agent_issues s ON (m.id = 100281 AND s.id = 1753 AND s.title LIKE 'METRIC-TRIGGER-341-SUBSCRIBERS-GROWTH-MONTHLY:%')
                    OR (m.id = 100286 AND s.id = 2467 AND instr(s.title, 'METRIC-TRIGGER-1868-ATTENTION-DECISION-EFFICACY-30D:') = 1)
WHERE m.status = 'open' AND m.id IN (100281, 100286)
  AND m.title LIKE 'METRIC-FIX-RELAPSED-1: %'
  AND s.status = 'open'
  AND CASE s.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END <= CASE m.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
  AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0);

INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at)
SELECT m.id, 'slice-c-superseded-by-trigger-ticket', s.id,
  'superseded by ' || s.id || ' (' || substr(s.title, 1, 100) || ', ' || s.status || ', ' || s.priority || '): the same metric and the same definition of done (content_items_over_stage_sla back to 0, each loop draining at least its inflow). The reading taken 2026-11-05 moves to the carrying ticket here: v_content_pipeline over_sla = 1 is 1,569 items, of them research/queued waiting 1,378 (oldest 160.6 h), research/research active 95, idea/triage held 73, errata/correct 15, idea/intake 5; the errata (882 on 2026-10-21) and revision (486) loops this issue named are drained (revision 0, errata 15); 62 of the 66 research_queue rows created on 2026-11-04 are status deferred (budget), so what is left is research intake against research_daily_neurons=360000 (22 to 147 rows created a day, 0 to 3 published), which the carrying ticket owns. SLICE-C-DISPOSITIONS-1',
  m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at
FROM agent_issues m
JOIN issue_triage t ON t.issue_id = m.id
LEFT JOIN remediation_contracts c ON c.class = 'issue-' || m.id
JOIN agent_issues s ON s.id = 99948 AND s.title LIKE 'METRIC-TRIGGER-5915-CONTENT-ITEMS-OVER-STAGE-SLA:%'
WHERE m.status = 'open' AND m.id = 100456
  AND m.title LIKE 'content_items_over_stage_sla %'
  AND s.status = 'open'
  AND CASE s.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END <= CASE m.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
  AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0);

-- 3. settle the contracts, name the channel, close through the triage row, mark the ledger (the statements of ISSUE-HYGIENE-1, scoped to this file's rules)
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded (SLICE-C-DISPOSITIONS-1)', last_attempt_at = datetime('now')
WHERE class IN (SELECT f.contract_class FROM issue_fold_ledger f WHERE f.applied = 0 AND f.rule LIKE 'slice-c-%' AND f.contract_class IS NOT NULL)
  AND status IN ('monitoring', 'escalated', 'active', 'holding', 'needs-machine-probe', 'probe-review-refused');
UPDATE agent_issues SET close_channel = 'session:breach-remediation ' || (SELECT f.rule FROM issue_fold_ledger f WHERE f.issue_id = agent_issues.id AND f.applied = 0 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1)
WHERE status = 'open' AND id IN (SELECT issue_id FROM issue_fold_ledger WHERE applied = 0 AND rule LIKE 'slice-c-%');
UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'), close_evidence = (SELECT f.evidence FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 0 AND f.rule LIKE 'slice-c-%' ORDER BY f.id DESC LIMIT 1)
WHERE issue_id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN agent_issues a ON a.id = f.issue_id WHERE f.applied = 0 AND f.rule LIKE 'slice-c-%' AND a.status = 'open');
UPDATE agent_issues SET status = 'closed', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE status = 'open' AND id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN issue_triage t ON t.issue_id = f.issue_id WHERE f.applied = 0 AND f.rule LIKE 'slice-c-%' AND t.triage_state = 'closed' AND t.close_evidence = f.evidence);
UPDATE issue_fold_ledger SET applied = 1, applied_at = datetime('now')
WHERE applied = 0 AND rule LIKE 'slice-c-%' AND (SELECT a.status FROM agent_issues a WHERE a.id = issue_fold_ledger.issue_id) <> 'open';

-- 4. probes that measure the defect
-- 1001468: same predicate as before, counted from after the fix was merged and deployed
UPDATE remediation_contracts
SET verify_probe = 'WITH r AS (SELECT DISTINCT t.id AS id FROM cloud_ops_events e JOIN code_tasks t ON instr(e.text, t.id) > 0 WHERE e.kind = ''code-task.noop-refused'' AND e.text LIKE ''%string literals%'' AND e.ts >= ''2026-11-04T15:30:00Z'' AND e.ts >= strftime(''%Y-%m-%dT%H:%M:%SZ'',''now'',''-1 day'') AND (lower(t.goal) LIKE ''%in (%'' OR lower(t.goal) LIKE ''%where%'' OR lower(t.goal) LIKE ''%clause%'' OR lower(t.goal) LIKE ''%d1_error%'' OR lower(t.goal) LIKE ''%status%'')) SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM r',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1001468' AND issue_id = 1001468 AND status = 'active'
  AND verify_probe LIKE '%code-task.noop-refused%' AND verify_probe NOT LIKE '%2026-11-04T15:30:00Z%';

-- 1000662: the function that sets updated_brier is on main (and in the deployed mirror)
UPDATE remediation_contracts
SET verify_transport = 'code-read', module = 'code-probe-line-v1', status = 'active',
    verify_probe = '{"paths": ["q08-signal-engine/worker.js"], "contains": "f.updated_brier = score.brier;"}',
    action = 'RM-FORECAST-UPDATE-SCORING-1 (q08-signal-engine 0.42.0, PR 5578; suite q08-signal-engine/forecast.test.mjs): attachForecastUpdateScore sets updated_brier beside the original brier. Replaces the born-superseded probe that observed this issue''s own status.',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000662' AND issue_id = 1000662
  AND verify_probe LIKE '%FROM agent_issues WHERE id = 1000662%';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'qnfo-workers:2026-11-05-slice-c-dispositions-1',
  'A ticket about a refused merge on a closed issue, a relapse ticket for a metric whose trigger ticket is open, and a probe that can only pass after a rolling window ages out carry no work of their own.',
  'SLICE-C-DISPOSITIONS-1: closed 1000625 and 1000854 (moot, parent closed), superseded 100281, 100286 and 100456 by open trigger tickets, moved the 1001468 probe window to after the fix, gave 1000662 a code-read probe on updated_brier.',
  'agent_issues 1000619 and 1000787 closed; 1753, 2467 and 99948 open and critical; cloud_ops_events kind code-task.noop-refused newest 2026-11-04T04:40:57Z, fix merged 2026-11-04T15:08Z; q08.org/health 0.43.0; v_content_pipeline over_sla breakdown 2026-11-05; git grep of the function in q08-signal-engine/worker.js; offline suite migrations/slice-c-dispositions.test.mjs',
  'migration merged',
  'at most 5 agent_issues rows closed with evidence, 2 contract probes replaced; every successor ticket keeps its own probe',
  'issue_fold_ledger holds the before-state of each close and bak_20261105_slice_c_contracts the two replaced probes; the Rollback header restores them',
  'a ticket outliving its subject closes with the fact that resolved it',
  'open_agent_issues falls by 5 and 1001468 and 1000662 close on their next passing probe without a relapse',
  'none',
  'd1:qnfo-audit agent_issues, issue_triage, remediation_contracts, cloud_ops_events, code_tasks, v_content_pipeline, fleet_budget (SELECT only); github main for q08-signal-engine/worker.js; https://q08.org/health'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'qnfo-workers:2026-11-05-slice-c-dispositions-1');
