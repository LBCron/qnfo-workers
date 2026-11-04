-- B-GOVERNANCE-1 (2026-11-05, charter pillar autonomy; sweep cluster B-governance-code): five ROADMAP-1 rows whose work shipped earlier are verified against the live state read on 2026-11-04 22:40Z to 23:20Z,
-- and the finished CF-OBS six-hour-bar issue (agent_issues 1001566) gets the probe that measures its outcome, not its code. Every row below carries the reading it rests on.
--  FM-1  (roadmap 1754, GitHub 5615)  rc-agent-request / rc-agent-report / rc-agent-mark of fleet_tasks management-personas filter an answer holding tool_call, <invoke, <function_calls or DSML and re-ask it (at most 6 requests per
--         issue); migrations/2026-10-28-cluster-e-c-failure-modes.sql. Live: the contract probe of class issue-1000717 read observed 0 against expected 0 (markup answers appended after 2026-10-29 plus open ROOT-CAUSE-1 issues on
--         the stale no-answer line); issue 1000717 is closed.
--  FM-2  (roadmap 1755, GitHub 5616)  the same prompt makes the agent confirm that a code-anchor occurs exactly once in the named file and name the layer (a D1 trigger, view, migration or fleet_tasks step gets a migration, not a
--         worker.js edit): instr(definition, 'occurs exactly once in it') > 0 on the live row; the contract of class issue-1000718 holds a pass and issue 1000718 is closed. The deterministic half is at intake: the code orchestrator
--         repairs or locates an anchor that occurs 0 or 2+ times before a model call (ANCHOR-REPAIR-1, ANCHOR-LOCATOR-1, qnfo-code-orchestrator/intake-preflight.test.mjs).
--  FM-5  (roadmap 1758, GitHub 5619)  scripts/remediation_consumer.py steady_state_cadence backs a contract whose last 6 verifications all passed with the same observed value off to 2 hours (never beyond 120 minutes, SLA-120M-1;
--         runtime probes keep their cadence). Live: remediation_verifications held 18960 rows in the last 24 hours (2026-11-04 22:40Z) against 31903 on 2026-10-28 and the 24000 bar of the contract.
--  RM-D1-RESTORE-DRILL-1 (roadmap 1704, GitHub 5583)  scripts/d1_restore_drill.py creates a scratch D1, seeds it, takes a Time Travel bookmark, mutates, restores, verifies, cleans up and records the run. Live: d1_restore_drills id 1,
--         2026-10-28T12:46:35Z, outcome pass, steps create/seed/bookmark/mutate/restore/verify/cleanup/prod-bookmark-readable all true; later changes (CONSUMER-SPEED-3/4) only sweep leftovers and shorten the retry to 6 hours.
--  RM-POSTMORTEM-LEDGER-1 (roadmap 1701, GitHub 5580)  tables incidents and postmortems exist (migrations/2026-10-28-bp26-slo-budgets.sql), the hourly ledger builder in scripts/bp26_slo.py fills both and
--         scripts/bp26_postmortem.py registers the producer. Live: 69 incidents, 69 postmortems, latest incident 2026-11-04T18:11:33Z, postmortem_coverage last_value 0.9556 refreshed 2026-11-04T22:20:50Z, so the metric is measured.
-- The probe of issue 1001566 (GitHub 7095): the finding and its fix are in migrations/2026-11-04-issue-1001566-cf-obs-bar.sql and RELAPSE-HOLD-1 (PR 7031). The contract that migration installed measured the text of a
-- probe template and was refused as self-confirming by the probe reviewer (status probe-review-refused since 2026-11-04 17:36:57). The replacement measures the outcome the issue asks for: no CF-OBS issue whose last close was
-- by auto:verified-remediation-trigger AFTER the fix applied (2026-11-04T17:06:10Z, updated_at 1793811970000) had its group seen within the six hours before the close (fleet_issue_dispatch payload lastObserved inside
-- [close - 6 h, close]). Falsifiable: the same query without the date bound reads 4 on 2026-11-04 (1001587, 1001588, 1001600, 1001610 closed after 0.76 to 2.0 quiet hours); the three closes after the fix
-- (1001547, 1001549, 1001670) were 8.2, 21.7 and 7.7 quiet hours, so it reads 0 now.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'planned', verified_at = NULL WHERE id IN (1754, 1755, 1758, 1704, 1701) AND source IN ('failure-modes-2026', 'scout-2026-10-closeout'); UPDATE remediation_contracts SET status = 'probe-review-refused', last_verdict = 'probe-review-refused', module = 'cf-obs-six-hour-bar' WHERE class = 'issue-1001566';
-- CAUSE-MAPPED: registers no metric_registry row.

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'FM-1 live 2026-11-04: fleet_tasks management-personas steps rc-agent-request, rc-agent-report and rc-agent-mark exclude answers with tool_call, <invoke, <function_calls or DSML and re-ask up to 6 times (migrations/2026-10-28-cluster-e-c-failure-modes.sql); the closing probe of issue-1000717 read 0 of 0 (no markup diagnosis appended after 2026-10-29, no open ROOT-CAUSE-1 issue on the stale no-answer line); issue 1000717 is closed.'
WHERE id = 1754 AND item = 'FM-1' AND source = 'failure-modes-2026' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'FM-2 live 2026-11-04: the root-cause prompt of fleet_tasks management-personas requires the agent to confirm that the code-anchor occurs exactly once in the file and to propose a migration when the gate is a D1 trigger, view or fleet_tasks step (instr(definition, ''occurs exactly once in it'') > 0); issue 1000718 is closed on a passing contract; the code orchestrator repairs or locates an unresolved anchor at intake before a model call (ANCHOR-REPAIR-1 and ANCHOR-LOCATOR-1, qnfo-code-orchestrator/intake-preflight.test.mjs). Limit: the prompt-level check is the model''s; the deterministic check is the intake.'
WHERE id = 1755 AND item = 'FM-2' AND source = 'failure-modes-2026' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'FM-5 live 2026-11-04 22:40Z: scripts/remediation_consumer.py steady_state_cadence re-probes a contract whose last 6 verifications all passed with the same observed value every 2 hours at most (runtime probes exempt, SLA-120M-1); remediation_verifications holds 18960 rows in the last 24 hours against 31903 on 2026-10-28, under the 24000 bar of the contract of issue 1000721; scripts/remediation_consumer_steady_test.py covers it.'
WHERE id = 1758 AND item = 'FM-5' AND source = 'failure-modes-2026' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'live 2026-11-04: d1_restore_drills id 1, 2026-10-28T12:46:35Z, outcome pass (steps create, seed, bookmark, mutate, restore, verify, cleanup and prod-bookmark-readable all true) written by scripts/d1_restore_drill.py; CONSUMER-SPEED-3 and -4 (PRs 7270, 7280) sweep scratch databases a killed drill leaves and retry a failed drill after 6 hours.'
WHERE id = 1704 AND item = 'RM-D1-RESTORE-DRILL-1' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'live 2026-11-04 22:20Z: qnfo-audit incidents holds 69 rows and postmortems 69 (created by migrations/2026-10-28-bp26-slo-budgets.sql, filled hourly by the ledger builder in scripts/bp26_slo.py, producer registered in scripts/bp26_postmortem.py, PR 6617); metric_registry postmortem_coverage last_value 0.9556 refreshed 2026-11-04T22:20:50Z, so the coverage is measured.'
WHERE id = 1701 AND item = 'RM-POSTMORTEM-LEDGER-1' AND status = 'planned';

-- Issue 1001566: the contract measures the outcome (a close short of the six-hour bar), not the template text the reviewer refused.
UPDATE remediation_contracts
SET status = 'active', module = 'cf-obs-six-hour-bar-outcome', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now'), expected_cadence_h = 1,
    precondition = 'ISSUE-1001566: after RELAPSE-HOLD-1 (applied 2026-11-04T17:06:10Z) no CF-OBS issue closed by auto:verified-remediation-trigger had its group seen within the 6 hours before the close.',
    action = 'Count currently closed CF-OBS issues whose last close was by auto:verified-remediation-trigger after the fix and whose fleet_issue_dispatch lastObserved falls inside the six hours before the close; expected 0.',
    verify_transport = 'd1-query',
    verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM agent_issues a JOIN fleet_issue_dispatch f ON f.fingerprint = ''cf-obs-'' || substr(a.title, instr(a.title, ''[cf-obs:'') + 8, 36) WHERE a.id >= 1001400 AND a.title LIKE ''CF-OBS-ISSUE-1%'' AND a.status = ''closed'' AND a.close_channel = ''auto:verified-remediation-trigger'' AND a.updated_at >= 1793811970000 AND json_extract(f.payload, ''$.lastObserved'') > a.updated_at - 21600000 AND json_extract(f.payload, ''$.lastObserved'') <= a.updated_at) AS TEXT) AS observed'
WHERE class = 'issue-1001566' AND status IN ('probe-review-refused', 'superseded', 'active', 'holding') AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001566 AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a roadmap row whose work is on main and measured live is verified, not left planned; a probe the reviewer refused as self-confirming is replaced by one on the outcome',
  'roadmap_implementation 1754, 1755, 1758, 1704, 1701 set to verified with their readings; contract issue-1001566 re-pointed at the six-quiet-hours outcome',
  'FM-1 probe 0 of 0; verifications 18960 in 24 h; d1_restore_drills id 1 pass; postmortem_coverage 0.9556; CF-OBS closes after the fix 8.2, 21.7, 7.7 quiet hours',
  'pending', 'five roadmap rows and their GitHub mirrors, one remediation contract', 'the Rollback line of migrations/2026-11-05-b-governance-roadmap-verified.sql',
  'roadmap-rows-verified-with-live-readings',
  'the five GitHub mirrors close; the probe of issue-1001566 reads 0 and the issue closes by the trigger; it reads above 0 if a CF-OBS issue closes inside six hours of its group last seen',
  'none (closing existing work)', 'qnfo-audit reads listed in the header'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'roadmap-rows-verified-with-live-readings');
