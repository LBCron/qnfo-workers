-- TERMINAL-RECONCILE-PREFIX-1 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1, owner: fleet cost under $200-300 a month).
-- Measured 2026-11-04 on qnfo-audit: the fleet_tasks workflow code-loop-terminal-reconcile (about 175 runs a day) reads 362 K rows a run: step
-- retarget-circular-probe 262,607 rows (1.4 s) and step close-merged 99,240 rows (0.4 s), about 63 M rows a day (the UPDATE remediation_contracts
-- statement was 41 M of the 24 h top list). Cause: both join agent_issues to code_tasks with instr(a.title, 'CODE-LOOP-EXHAUSTED-1: ' || t.id || ' ') > 0,
-- which no index can serve, so every open issue (613) is compared with every merged task (425): 260 K pairs, although only 13 open issues carry the marker.
-- Change: the two joins gain a title range on the marker prefix (a.title >= 'CODE-LOOP-EXHAUSTED-1: ' AND a.title < 'CODE-LOOP-EXHAUSTED-1:!'), which the
-- partial index idx_agent_issues_open_title (title WHERE status = 'open') serves, so only the marked issues meet the merged tasks (13 x 425). Same rows: the
-- code loop files these issues with the marker as the title prefix (live check: 13 open marked issues, 0 whose title does not start with the marker).
-- Prediction: the workflow reads about 20 K rows a run instead of 362 K; about 60 M rows a day fewer; remediation_contracts retargets and issue_triage closes unchanged.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_clr_workflow
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_clr_workflow WHERE id = 'code-loop-terminal-reconcile'), version = version + 1 WHERE id = 'code-loop-terminal-reconcile'
-- spof-review: one workflow definition edited in place (same steps, same cadence); the previous definition is kept in the backup table.

CREATE TABLE IF NOT EXISTS bak_20261104_clr_workflow AS
SELECT id, definition, version FROM fleet_tasks WHERE id = 'code-loop-terminal-reconcile';

UPDATE fleet_tasks
SET definition = REPLACE(
      definition,
      'JOIN code_tasks t ON instr(a.title, ''CODE-LOOP-EXHAUSTED-1: '' || t.id || '' '') > 0 WHERE a.status = ''open'' AND t.status = ''merged''',
      'JOIN code_tasks t ON instr(a.title, ''CODE-LOOP-EXHAUSTED-1: '' || t.id || '' '') > 0 WHERE a.status = ''open'' AND t.status = ''merged'' AND a.title >= ''CODE-LOOP-EXHAUSTED-1: '' AND a.title < ''CODE-LOOP-EXHAUSTED-1:!'''
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'code-loop-terminal-reconcile'
  AND json_valid(definition)
  AND instr(definition, 'AND a.title >= ''CODE-LOOP-EXHAUSTED-1: ''') = 0
  AND instr(definition, 'JOIN code_tasks t ON instr(a.title, ''CODE-LOOP-EXHAUSTED-1: '' || t.id || '' '') > 0 WHERE a.status = ''open'' AND t.status = ''merged''') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:fleet-tick-fanout', 'an instr() join between 613 open issues and 425 merged tasks is a 260 K-pair cross product that a title prefix range turns into 13 x 425',
  'TERMINAL-RECONCILE-PREFIX-1: code-loop-terminal-reconcile steps retarget-circular-probe and close-merged join only issues whose title starts with the CODE-LOOP-EXHAUSTED-1 marker',
  'step SELECT parts on live data: 262,607 and 99,240 rows a run; d1QueriesAdaptiveGroups 24 h: the UPDATE remediation_contracts retarget statement 41 M rows in 175 calls; live marker check: 13 open marked issues, 0 not prefixed',
  'same retargets and closes, about 95 % fewer rows read', 'one fleet_tasks row (definition kept in bak_20261104_clr_workflow, version + 1)',
  'the Rollback line', 'the terminal reconcile costs a twentieth of its rows',
  'code-loop-terminal-reconcile steps read under 30 K rows a run in total after the merge', NULL, 'SQLite equivalence and plan test in migrations/terminal-reconcile-prefix.test.mjs, live SELECT-part measurement'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'TERMINAL-RECONCILE-PREFIX-1:%');
