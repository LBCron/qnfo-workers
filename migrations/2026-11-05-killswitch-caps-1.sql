-- BP26-KILLSWITCH-READERS-1 and BP26-KILLSWITCH-CAPS-1 (2026-11-05, charter pillar autonomy; sweep cluster B-governance-code; roadmap rows 1722 and 1723, GitHub 5602 and 5603).
-- qnfo-code-orchestrator 0.48.0: the code loop reads ops_config fleet_kill_switch (a tick starts nothing and records kill-switch.observed; the read fails open) and pauses itself after N
-- consecutive failed steps (CODE-LOOP-BREAKER-1). This file records the controls the doctrine asks every new hold, cap and switch to carry (disposition, critical path, a tested alternate with a
-- read-only probe), the ops_config default of the breaker, and the progress of the two roadmap rows. Row 1722 (readers) stays open: 3 of 9 readers exist (qnfo-deploy-guard, qnfo-code-orchestrator,
-- qnfo-github-steward); the rest are named with their reasons in docs/KILL-SWITCH-DRILL.md. Row 1723 (caps and breaker) is built: the steps, wall-clock, lane, daily-call and daily-neuron caps
-- existed; the missing piece, a loop-wide pause after N consecutive failures that files an issue, ships here. It is verified after the deploy by a later file.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM ops_config WHERE key = 'code_loop_breaker'; DELETE FROM control_alternate_probes WHERE control IN ('code-loop-breaker', 'code-loop-kill-switch-reader') AND last_run_at IS NULL; DELETE FROM control_registry WHERE control IN ('code-loop-breaker', 'code-loop-kill-switch-reader'); UPDATE roadmap_implementation SET status = 'planned' WHERE id IN (1722, 1723) AND status IN ('in_progress', 'built'); DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'code-loop-kill-switch-reader-and-breaker';
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES
  ('code_loop_breaker', 'on', 'CODE-LOOP-BREAKER-1 (BP26-KILLSWITCH-CAPS-1): on = the code loop pauses itself after N consecutive failed steps (ops_config code_loop_breaker_n, default 30, bounds 5 to 200) for code_loop_breaker_pause_min minutes (default 30, bounds 5 to 240) and files one agent_issues row; off disables the breaker. State: code_loop_breaker_state (delete the row to reset).');

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence)
VALUES
 ('code-loop-breaker', 'ops_config code_loop_breaker, code_loop_breaker_n, code_loop_breaker_pause_min, code_loop_breaker_state; qnfo-code-orchestrator tick() (loopControls, breakerStep)', 'cap',
  'a systemic fault (the model route, D1 errors, the verifier, the GitHub token) burning model calls and queue attempts on steps that all fail: 30 failures in a row with no success between is not a hard task',
  1, 'keep', 'applied',
  'the pause is bounded (5 to 240 minutes) and expires by itself; ops_config code_loop_breaker = off removes it without a deploy; sessions and the Copilot cloud agent keep opening pull requests while the loop is paused',
  'BP26-KILLSWITCH-CAPS-1: qnfo-code-orchestrator/kill-switch-breaker.test.mjs (32 checks: five failures trip it, a paused tick runs no step and no model call, an expired pause resumes, a success resets, off disables, N and the pause are bounded, one issue per open trip)'),
 ('code-loop-kill-switch-reader', 'ops_config fleet_kill_switch, read by qnfo-code-orchestrator loopControls (30 s cache, fails open)', 'kill-switch',
  'the code loop continuing to open pull requests and call models while the fleet is asked to stop (docs/KILL-SWITCH-DRILL.md)',
  0, 'keep', 'applied',
  'flip the flag to off through the cf-ops-actions kill-switch-drill or its ops_config row; an unreadable row is off, so a D1 overload can never stop the loop; the global switch is the alternate of every per-loop pause',
  'BP26-KILLSWITCH-READERS-1: qnfo-code-orchestrator/kill-switch-breaker.test.mjs section A (tick with the switch on runs nothing, one observed event per five minutes, 30 s cache, fail open)');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('code-loop-breaker',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''code_loop_breaker'') = 0 THEN ''the ops_config row code_loop_breaker is missing, so the off lever cannot be read'' WHEN (SELECT value FROM ops_config WHERE key = ''code_loop_breaker'') NOT IN (''on'', ''off'') THEN ''ops_config code_loop_breaker holds a value other than on or off'' ELSE ''ok'' END AS observed',
  'state probe, no window: the lever row and its value. The pause is bounded by code_loop_breaker_pause_min and expires by itself', 1),
 ('code-loop-kill-switch-reader',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''fleet_kill_switch'') = 0 THEN ''the ops_config row fleet_kill_switch is missing, so the flag cannot be turned off from the row'' WHEN (SELECT value FROM ops_config WHERE key = ''fleet_kill_switch'') NOT IN (''on'', ''off'') THEN ''ops_config fleet_kill_switch holds a value other than on or off, and only the exact value on stops a reader'' ELSE ''ok'' END AS observed',
  'state probe, no window: the flag row and its value (the monthly drill is the live proof, docs/KILL-SWITCH-DRILL.md)', 1);

UPDATE roadmap_implementation
SET status = 'in_progress',
    evidence = 'readers live 2026-11-05: qnfo-deploy-guard 1.4.0, qnfo-code-orchestrator 0.48.0 (the code loop tick), qnfo-github-steward 0.17.0 (scheduled runs); each reads fleet_kill_switch once per tick or run, cached 30 s, fails open, records kill-switch.observed. Pending with reasons in docs/KILL-SWITCH-DRILL.md: qnfo-fleet-control tick, qnfo-ops, qnfo-social, qnfo-research-exec, qnfo-cloud-ops, and the fleet-exec member inside qnfo-code-orchestrator (needs a per-step gate: it mixes internal D1 steps that must keep running with external ones); qnfo-email-orchestrator is not a worker directory. KS_READERS in scripts/cf_ops_actions.py grows after each deploy is verified live.'
WHERE id = 1722 AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'qnfo-code-orchestrator 0.48.0 (CODE-LOOP-BREAKER-1): N consecutive failed steps (ops_config code_loop_breaker_n, default 30) pause the code loop for a bounded time (code_loop_breaker_pause_min, default 30), record code-task.breaker-tripped and file one CODE-LOOP-BREAKER-1 agent_issues row; kill-switch-breaker.test.mjs 32 checks. Reused caps: steps per tick (maxSteps), wall-clock per tick (budget_ms), lanes, daily calls and daily neuron budget (spendGate; the per-tick spend is bounded by lanes x CODE_STEP_NEURONS_EST within the remaining daily headroom, so the per-iteration token and cost caps are the daily budget divided across the tick, not a separate counter), LOOP-BREAKER-1 and FAIL-SIGNATURE-STOP-1. Verified live by a later file once /health reports 0.48.0.'
WHERE id = 1723 AND status = 'planned';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a reversible fleet decision takes the recommended option: the code loop reads the global kill switch and pauses itself, bounded, after a run of failures',
  'qnfo-code-orchestrator 0.48.0; ops_config code_loop_breaker = on; control_registry and control_alternate_probes rows for code-loop-breaker and code-loop-kill-switch-reader',
  'the code loop had caps on steps, wall-clock, lanes, calls and neurons but no loop-wide pause after consecutive failures, and no reader of the global switch (only qnfo-deploy-guard read it)',
  'pending', 'the code loop (a tick that finds the switch on, or a paused breaker, runs no step); sessions and Copilot pull requests are unaffected',
  'set ops_config code_loop_breaker to off, or delete code_loop_breaker_state to reset a trip; fleet_kill_switch off restores the loop at once',
  'code-loop-kill-switch-reader-and-breaker',
  'the breaker never trips in normal operation (steps succeed more often than not); if 30 steps fail in a row it pauses at most 30 minutes, files one issue and resumes; the drill finds a kill-switch.observed event from qnfo-code-orchestrator inside T0 plus 2 ticks',
  'none (safety)', 'qnfo-code-orchestrator/kill-switch-breaker.test.mjs against the real worker with an in-memory D1'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'code-loop-kill-switch-reader-and-breaker');
