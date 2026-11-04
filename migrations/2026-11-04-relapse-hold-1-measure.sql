-- RELAPSE-HOLD-1 measurement loop (2026-11-04, charter pillar autonomy; NEVER-STOP-1: predict, measure, keep or revert).
-- migrations/2026-11-04-relapse-hold-1.sql (PR 7031, applied 17:06:10Z as migration_runs 1149) logged its prediction in decision_log but no decision_predictions rows, so the calibration scorer
-- (calibration_scorer_tick) never scores it and nothing waits for the 24 h and 7 d readings. This file seeds the five predictions, files the issue that stays open until the scorer has a
-- matching outcome (its closing probe reads decision_outcomes), and gives the three closer doers of that migration a code-read contract on the tag they must add.
-- Prediction rows: closure_branching_ratio_24h < 0.45 after 24 h and <= 0.35 after 7 days (0.509 at 2026-11-04T16:36Z), issue_relapse_families_7d <= 6 after 7 days (9 families),
-- guards remediation_latest_pass_pct_7d >= 60 (62.6) and issue_wontfix_share_7d <= 1 (0.0). The scorer writes decision_outcomes once every row of the decision is scored.
-- Keep or revert (the rule of the task): keep when the ratio fell and no guard worsened; otherwise set ops_config relapse_close_hold = off, record why on the decision, and replace the lever.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM decision_predictions WHERE origin = 'seeded' AND decision_id = (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1); the issue titled 'RELAPSE-HOLD-1 measure: ...' is closed with evidence, not deleted.
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'closure_branching_ratio_24h', '<', 0.45, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day'), 'seeded'
FROM decision_log d WHERE d.action LIKE 'RELAPSE-HOLD-1:%' ORDER BY d.id LIMIT 1;

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'closure_branching_ratio_24h', '<=', 0.35, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+7 days'), 'seeded'
FROM decision_log d WHERE d.action LIKE 'RELAPSE-HOLD-1:%' ORDER BY d.id LIMIT 1;

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'issue_relapse_families_7d', '<=', 6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+7 days'), 'seeded'
FROM decision_log d WHERE d.action LIKE 'RELAPSE-HOLD-1:%' ORDER BY d.id LIMIT 1;

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'remediation_latest_pass_pct_7d', '>=', 60, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+7 days'), 'seeded'
FROM decision_log d WHERE d.action LIKE 'RELAPSE-HOLD-1:%' ORDER BY d.id LIMIT 1;

INSERT OR IGNORE INTO decision_predictions (decision_id, kind, subject, op, value, due_at, origin)
SELECT d.id, 'metric', 'issue_wontfix_share_7d', '<=', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+7 days'), 'seeded'
FROM decision_log d WHERE d.action LIKE 'RELAPSE-HOLD-1:%' ORDER BY d.id LIMIT 1;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'RELAPSE-HOLD-1 measure: keep or revert the close hold by the 7-day reading',
       'Charter pillar: autonomy. Program QNFO.OPS. Decision: decision_log RELAPSE-HOLD-1 (migrations/2026-11-04-relapse-hold-1.sql, PR 7031). Its five predictions are in decision_predictions (24 h: closure_branching_ratio_24h < 0.45, 7 d: closure_branching_ratio_24h <= 0.35, issue_relapse_families_7d <= 6, guards remediation_latest_pass_pct_7d >= 60 and issue_wontfix_share_7d <= 1) and calibration_scorer_tick writes decision_outcomes when all are scored. This issue stays open until that outcome exists and matched.' || char(10) ||
       'Doer: read SELECT * FROM decision_predictions WHERE decision_id = (SELECT id FROM decision_log WHERE action LIKE ''RELAPSE-HOLD-1:%'') and SELECT * FROM v_issue_relapse_7d ORDER BY reopens_7d DESC. Keep the hold when the ratio fell and no guard worsened. On a miss: UPDATE ops_config SET value = ''off'' WHERE key = ''relapse_close_hold'' (insert the row when absent), record why in decision_log, and replace the lever (the top family of v_issue_relapse_7d, its closing probe or its closer) rather than repeating it. Also owed by this issue: retune the closed CF-OBS contracts whose group was seen within six hours (left on the old probe by the first migration so it reopened nothing) in a migration of its own after the 24 h reading.' || char(10) ||
       'Done: a decision_outcomes row for the decision with actor calibration-scorer and matched = 1, or the revert recorded and this issue superseded by the successor lever.',
       'claude-session', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title = 'RELAPSE-HOLD-1 measure: keep or revert the close hold by the 7-day reading');

UPDATE remediation_contracts
SET status = 'active', verify_transport = 'd1-query', module = 'relapse-hold-measure', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'), expected_cadence_h = 1,
    precondition = 'RELAPSE-HOLD-1: the calibration scorer has scored every prediction of the decision',
    action = 'the issue closes only when the calibration scorer recorded a matching outcome for the RELAPSE-HOLD-1 decision',
    verify_probe = 'SELECT ''ok'' AS expected, CASE '
      || 'WHEN NOT EXISTS (SELECT 1 FROM decision_outcomes o WHERE o.decision_id = ' || (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1) || ' AND o.actor = ''calibration-scorer'') '
      || 'THEN ''pending: '' || (SELECT COUNT(*) FROM decision_predictions p WHERE p.decision_id = ' || (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1) || ' AND p.scored_at IS NOT NULL) || '' of '' || (SELECT COUNT(*) FROM decision_predictions p WHERE p.decision_id = ' || (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1) || ') || '' predictions scored, the last due '' || COALESCE((SELECT MAX(p.due_at) FROM decision_predictions p WHERE p.decision_id = ' || (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1) || '), ''never'') '
      || 'WHEN (SELECT o.matched FROM decision_outcomes o WHERE o.decision_id = ' || (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1) || ' AND o.actor = ''calibration-scorer'' ORDER BY o.id DESC LIMIT 1) = 1 THEN ''ok'' '
      || 'ELSE ''missed: '' || (SELECT substr(o.observed_outcome, 1, 300) FROM decision_outcomes o WHERE o.decision_id = ' || (SELECT id FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%' ORDER BY id LIMIT 1) || ' AND o.actor = ''calibration-scorer'' ORDER BY o.id DESC LIMIT 1) END AS observed'
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title = 'RELAPSE-HOLD-1 measure: keep or revert the close hold by the 7-day reading' ORDER BY id LIMIT 1)
  AND EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RELAPSE-HOLD-1:%');

-- The three closer doers shared one tag, so the first change to carry it would have closed all three code-probe contracts. Each gets its own tag; the description update re-arms the
-- code-probe line trigger (agent_issues_code_probe_upd), which installs the code-read contract of that issue.
UPDATE agent_issues
SET description = replace(replace(description, 'Tag the change RELAPSE-HOLD-1 in a comment.', 'Tag the change with the comment text RELAPSE-HOLD-1 journeys.'),
                          '"contains": "RELAPSE-HOLD-1"}', '"contains": "RELAPSE-HOLD-1 journeys"}'),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-2:%' AND status = 'open' AND instr(description, '"contains": "RELAPSE-HOLD-1"}') > 0;

UPDATE agent_issues
SET description = replace(replace(description, 'Tag the change RELAPSE-HOLD-1 in a comment.', 'Tag the change with the comment text RELAPSE-HOLD-1 gha-journeys.'),
                          '"contains": "RELAPSE-HOLD-1"}', '"contains": "RELAPSE-HOLD-1 gha-journeys"}'),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-3:%' AND status = 'open' AND instr(description, '"contains": "RELAPSE-HOLD-1"}') > 0;

UPDATE agent_issues
SET description = replace(replace(description, 'Tag the change RELAPSE-HOLD-1 in a comment.', 'Tag the change with the comment text RELAPSE-HOLD-1 improvement-loop.'),
                          '"contains": "RELAPSE-HOLD-1"}', '"contains": "RELAPSE-HOLD-1 improvement-loop"}'),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title LIKE 'ROADMAP-1: QNFO.OPS #relapse-4:%' AND status = 'open' AND instr(description, '"contains": "RELAPSE-HOLD-1"}') > 0;
