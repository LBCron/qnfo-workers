-- D1-OVERLOAD-FOLD-1 / ISSUE-HYGIENE-7 (2026-11-04, pillar autonomy; follows migrations/2026-10-26-issue-hygiene-3.sql and PR 6978)
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-04, LIMITed reads)
--   "D1 DB is overloaded" is one shared-database condition seen by many workers. Before PR 6978 (scripts/cf_obs_issue_bridge.py) folded new groups into one umbrella, each worker,
--   function and message variant filed its own issue: 54 open rows whose title carries the overload text (CF-OBS-ISSUE-1: <worker>: ...D1_ERROR: D1 DB is overloaded...: 43, id 1000847..1001672;
--   LOOP-BREAKER-1: <worker>: ...D_ERROR: D DB is overloaded...: 11, id 1001512..1001630; the loop-breaker text lost its 1s). The umbrella is agent_issues 1001715
--   "CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]". The per-group issues stay open until their own probe passes, which cannot happen while the overload continues, and each is a
--   separate item for a coding session. The doctrine closes an issue only with close_evidence or supersedes it with the successor's id.
--
-- WHAT THIS FILE DOES
--   Rule d1-overload-superseded joins the hourly workflow issue-meta-fold as its first statement (a ledger-only insert; the existing settle statements supersede the contract, name the
--   channel and close with evidence). ONLY while the umbrella exists and is open (matched by its exact title; its id is the successor), every OTHER open agent_issues row whose title starts with
--   'CF-OBS-ISSUE-1:', 'LOOP-BREAKER-1:' or '[fleet]' AND whose title contains 'D1 DB is overloaded' or 'D DB is overloaded' (case-insensitive) is closed with evidence
--   'superseded by <umbrella id>: one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)'. The title is the only text matched: other D1 errors (no such column, UNIQUE constraint, exceeded its
--   CPU time limit, storage operation exceeded timeout) are different conditions and are not touched; an issue that merely mentions the overload in its body (1001532, a qnfo-ops error-capture
--   ticket) is not touched either. If the umbrella is absent or closed the rule closes nothing, and it never closes the umbrella itself. It runs once inside this file and every hour after,
--   so a later per-group issue filed before the bridge fold deployed is folded too. Each close keeps its before-state in issue_fold_ledger, so a reopen is an UPDATE from the ledger row.
--   The first definition is saved in bak_20261104_fleet_task_issue_meta_fold_h7; the Rollback line restores it (closed issues stay closed). No trigger, no cron change, no DELETE or DROP.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_fleet_task_issue_meta_fold_h7 b WHERE b.id = 'issue-meta-fold'), version = version + 1, updated_at = datetime('now') WHERE id = 'issue-meta-fold' AND EXISTS (SELECT 1 FROM bak_20261104_fleet_task_issue_meta_fold_h7)

CREATE TABLE IF NOT EXISTS bak_20261104_fleet_task_issue_meta_fold_h7 AS SELECT id, version, definition, updated_at FROM fleet_tasks WHERE id = 'issue-meta-fold';

-- 1. Run the rule once now, then settle (the same statements the workflow runs)
INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at) SELECT m.id, 'd1-overload-superseded', u.id, 'superseded by ' || u.id || ': one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)', m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at FROM agent_issues u JOIN agent_issues m ON m.id <> u.id JOIN issue_triage t ON t.issue_id = m.id LEFT JOIN remediation_contracts c ON c.class = 'issue-' || m.id WHERE u.id = (SELECT MAX(x.id) FROM agent_issues x WHERE x.status = 'open' AND x.title = 'CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]') AND m.status = 'open' AND (m.title LIKE 'CF-OBS-ISSUE-1:%' OR m.title LIKE 'LOOP-BREAKER-1:%' OR m.title LIKE '[fleet]%') AND (instr(lower(m.title), 'd1 db is overloaded') > 0 OR instr(lower(m.title), 'd db is overloaded') > 0) AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) ORDER BY m.id LIMIT 200;
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded (ISSUE-HYGIENE-1)', last_attempt_at = datetime('now') WHERE class IN (SELECT f.contract_class FROM issue_fold_ledger f WHERE f.applied = 0 AND f.contract_class IS NOT NULL) AND status IN ('monitoring', 'escalated', 'active', 'holding', 'needs-machine-probe', 'probe-review-refused');
UPDATE agent_issues SET close_channel = 'workflow:ISSUE-HYGIENE-1 ' || (SELECT f.rule FROM issue_fold_ledger f WHERE f.issue_id = agent_issues.id AND f.applied = 0 ORDER BY f.id DESC LIMIT 1) WHERE status = 'open' AND id IN (SELECT issue_id FROM issue_fold_ledger WHERE applied = 0);
UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'), close_evidence = (SELECT f.evidence FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 0 ORDER BY f.id DESC LIMIT 1) WHERE issue_id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN agent_issues a ON a.id = f.issue_id WHERE f.applied = 0 AND a.status = 'open');
UPDATE agent_issues SET status = 'closed', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN issue_triage t ON t.issue_id = f.issue_id WHERE f.applied = 0 AND t.triage_state = 'closed' AND t.close_evidence = f.evidence);
UPDATE issue_fold_ledger SET applied = 1, applied_at = datetime('now') WHERE applied = 0 AND (SELECT a.status FROM agent_issues a WHERE a.id = issue_fold_ledger.issue_id) <> 'open';

-- 2. The workflow gains the rule as its first statement (prepended to whatever definition is live, so later rules and edits of other sessions are kept; a definition that already holds it is left alone)
UPDATE fleet_tasks
SET definition = json_set(definition, '$.steps', json((
  SELECT json_group_array(json(step)) FROM (
    SELECT -1 AS ord, json_object('type', 'sql', 'db', 'AUDIT', 'sql', 'INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at) SELECT m.id, ''d1-overload-superseded'', u.id, ''superseded by '' || u.id || '': one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1)'', m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at FROM agent_issues u JOIN agent_issues m ON m.id <> u.id JOIN issue_triage t ON t.issue_id = m.id LEFT JOIN remediation_contracts c ON c.class = ''issue-'' || m.id WHERE u.id = (SELECT MAX(x.id) FROM agent_issues x WHERE x.status = ''open'' AND x.title = ''CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]'') AND m.status = ''open'' AND (m.title LIKE ''CF-OBS-ISSUE-1:%'' OR m.title LIKE ''LOOP-BREAKER-1:%'' OR m.title LIKE ''[fleet]%'') AND (instr(lower(m.title), ''d1 db is overloaded'') > 0 OR instr(lower(m.title), ''d db is overloaded'') > 0) AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) ORDER BY m.id LIMIT 200') AS step
    UNION ALL SELECT CAST(key AS INTEGER), value FROM json_each(fleet_tasks.definition, '$.steps')
    ORDER BY ord
  )
))), version = version + 1, updated_at = datetime('now')
WHERE id = 'issue-meta-fold' AND json_valid(definition) AND instr(definition, 'd1-overload-superseded') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'claude-code-session-d1-overload-supersede',
  'the per-group D1-overload issues filed before the bridge fold are one shared-database condition already tracked by the umbrella issue, so superseding them by its id loses no information and no doer',
  'ISSUE-HYGIENE-7: rule d1-overload-superseded joins the hourly workflow issue-meta-fold and supersedes open CF-OBS-ISSUE-1, LOOP-BREAKER-1 and [fleet] issues whose title says D1 DB is overloaded by the open umbrella issue',
  'live LIMITed reads 2026-11-04: umbrella 1001715 open, 54 open rows match by title (43 CF-OBS-ISSUE-1, 11 LOOP-BREAKER-1), 1001532 mentions the text only in its body and is excluded, offline suite migrations/issue-hygiene-d1-overload.test.mjs',
  'migration merged, workflow issue-meta-fold at its next version',
  'one extra ledger-only statement on the hourly workflow reading agent_issues by status; about 54 closes on apply, each with its before-state in issue_fold_ledger',
  'the Rollback line restores the previous definition; closed issues stay closed and issue_fold_ledger holds each before-state (reopen: UPDATE agent_issues SET status from the ledger row)',
  'D1-overload per-group issues fold into the umbrella within the hour',
  'open per-group D1-overload issues other than the umbrella fall from about 54 to 0 and stay there while the umbrella is open',
  'none',
  'd1:qnfo-audit agent_issues, issue_triage, issue_fold_ledger, fleet_tasks (SELECT only), offline node:sqlite suite'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE instr(action, 'ISSUE-HYGIENE-7:') = 1);
