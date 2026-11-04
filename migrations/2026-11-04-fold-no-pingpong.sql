-- FOLD-NO-PINGPONG-1 (2026-11-04, charter pillar autonomy; issue-closing quality: a closer must not re-close what its producer reopens within a day).
-- WHAT WAS MEASURED (qnfo-audit, 2026-11-04 19:50Z)
--   Rule d1-overload-superseded of the hourly workflow issue-meta-fold (migrations/2026-11-04-issue-hygiene-d1-overload-supersede.sql) closed 54 per-group D1-overload issues at 18:56Z as superseded
--   by the umbrella 1001715. By 19:50Z 9 of the 54 were open again (reopened at 19:25Z, four of them LOOP-BREAKER-1 titles such as "BRANCH-HYGIENE-1: D1_ERROR: D DB is overloaded", the same minute): their loops
--   throw on the same overload every cycle and file the same title, issue_refile_reopen (a refile of a title closed in the last 24 h reopens the closed row and drops the insert) reopens it, and the next
--   hourly run of the rule closes it again, because the rule selects every open issue with the overload text and does not look at the issue's own history. A closer and a producer that disagree
--   make a cycle of one close and one reopen per issue per hour. The channel's earlier 7-day record shows the same shape: channel workflow:ISSUE-HYGIENE-1 d1-overload-superseded, 31 closes, 25 reopened within
--   6 hours (80.6 %), the highest of any closer (qnfo-audit, closes 2026-10-28T17:06Z to 2026-11-04T11:06Z).
-- WHAT THIS CHANGES
--   Rule d1-overload-superseded no longer selects an issue that was reopened in the last 24 hours. A refiled symptom stays open for a day (it is live, its loop still throws), then the rule folds it again,
--   so the cycle runs at most once a day per issue instead of once an hour. Nothing is dropped: issue_refile_reopen still reopens, the doctrine's no-silent-drop path is untouched, and an issue that
--   has not been reopened in 24 hours is folded as before. No trigger is created or changed.
--   Prediction (decision_log): reopens of issues folded by this rule fall from 9 in the first hour to at most 2 a day after the next fold; the rule's 6-hour relapse rate falls from 80 % toward 0.3.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261104_fold_no_pingpong b WHERE b.id = 'issue-meta-fold'), version = version + 1, updated_at = datetime('now') WHERE id = 'issue-meta-fold'; UPDATE fleet_tasks_canonical SET definition = (SELECT b.definition FROM bak_20261104_fold_no_pingpong b WHERE b.id = 'issue-meta-fold') WHERE id = 'issue-meta-fold';
-- CAUSE-MAPPED: no metric is registered here; this edits one workflow statement.

CREATE TABLE IF NOT EXISTS bak_20261104_fold_no_pingpong AS SELECT * FROM fleet_tasks WHERE id = 'issue-meta-fold';

UPDATE fleet_tasks SET
  definition = json_set(definition, '$.steps[0].sql', replace(json_extract(definition, '$.steps[0].sql'),
    'AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) ORDER BY m.id LIMIT 200',
    'AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) AND NOT EXISTS (SELECT 1 FROM issue_lifecycle r WHERE r.issue_id = m.id AND r.event = ''reopened'' AND r.ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) /* FOLD-NO-PINGPONG-1 */ ORDER BY m.id LIMIT 200')),
  version = version + 1,
  updated_at = datetime('now')
WHERE id = 'issue-meta-fold'
  AND instr(json_extract(definition, '$.steps[0].sql'), 'FOLD-NO-PINGPONG-1') = 0
  AND instr(json_extract(definition, '$.steps[0].sql'), 'd1-overload-superseded') > 0
  AND instr(json_extract(definition, '$.steps[0].sql'), 'AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) ORDER BY m.id LIMIT 200') > 0;

-- the drift gate compares fleet_tasks with fleet_tasks_canonical: the canonical row moves with the live one, only when it matched the replaced definition
UPDATE fleet_tasks_canonical SET
  definition = (SELECT t.definition FROM fleet_tasks t WHERE t.id = 'issue-meta-fold'),
  repo_path = 'migrations/2026-11-04-fold-no-pingpong.sql',
  exported_at = datetime('now')
WHERE id = 'issue-meta-fold'
  AND definition = (SELECT b.definition FROM bak_20261104_fold_no_pingpong b WHERE b.id = 'issue-meta-fold')
  AND instr((SELECT t.definition FROM fleet_tasks t WHERE t.id = 'issue-meta-fold'), 'FOLD-NO-PINGPONG-1') > 0;

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:issue-relapse-hold',
  'A closer that re-closes an issue its producer reopened the same hour makes a one-hour cycle of close and reopen that counts as work and tells nothing; one day of honest openness is the right pause.',
  'FOLD-NO-PINGPONG-1: rule d1-overload-superseded of issue-meta-fold skips issues reopened in the last 24 hours.',
  'qnfo-audit 2026-11-04 19:50Z: 54 folds at 18:56Z, 9 reopened at 19:25Z by issue_refile_reopen (four LOOP-BREAKER-1 BRANCH-HYGIENE-1 and research-exec titles in the same minute); the channel workflow:ISSUE-HYGIENE-1 d1-overload-superseded had 31 closes and 25 reopened within 6 hours in the 7 days to 2026-11-04T11:06Z (80.6 %).',
  'pending canonical migration; measured by reopens of issues in issue_fold_ledger rule d1-overload-superseded per hour',
  'one statement of the hourly workflow issue-meta-fold; no trigger, no table shape',
  'Rollback line of migrations/2026-11-04-fold-no-pingpong.sql with bak_20261104_fold_no_pingpong',
  'folds hold for a day instead of cycling hourly',
  'reopens of issues folded by d1-overload-superseded: 9 in the first hour to at most 2 a day after the next fold; 6-hour relapse rate of the channel 80 % to 30 % or lower',
  'not a reach change; closing quality',
  'node:sqlite suite migrations/fold-no-pingpong.test.mjs (the rule selects an issue reopened 2 hours ago no more, one reopened 30 hours ago again, an issue never reopened as before; canonical row; idempotent)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FOLD-NO-PINGPONG-1:%');
