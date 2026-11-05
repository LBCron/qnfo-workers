-- B-GOVERNANCE-3 (2026-11-05, charter pillar autonomy; sweep cluster B-governance-code): live readings for the roadmap rows whose code merged and deployed today, taken 2026-11-05 ~03:35Z.
--  1723 BP26-KILLSWITCH-CAPS-1 (GitHub 5603): qnfo-code-orchestrator /health answers 0.48.2-codeagent (the circuit breaker shipped in 0.48.0, PR 7483); ops_config code_loop_breaker = on; the live
--       loop wrote ops_config code_loop_breaker_state = {"fails":0,"until":0,"trips":0,"last_trip_at":null}, so the breaker evaluates every tick and has not tripped; control_registry rows
--       code-loop-breaker and code-loop-kill-switch-reader exist; qnfo-code-orchestrator/kill-switch-breaker.test.mjs 32 checks. Limit: no live trip was provoked (that needs 30 failed steps in a row).
--  1709 BP26-SLO-MERGE-LANE-1 (GitHub 5592): qnfo-fleet-control /health answers 0.66.3-codeagent (the lane gate shipped in 0.66.0, PR 7570, merged 2026-11-05T02:02:30Z); ops_config slo_merge_lane = on,
--       slo_budget_spent = '' (empty, so the freeze is inert today), lane_review_hold = on, lane_review_wait_min = 8; the lane kept merging after the deploy (PRs 7521 at 01:32Z before it,
--       7534 at 02:49Z and 7622 after it) through the new code path, so it does not break a merge; lane-review-slo.test.mjs 67 checks cover the freeze, the label and body exemptions and the off switch.
--       Limit: the hold itself is exercised offline only, because no budget is spent now.
--  1706 BP26-GRADUAL-ADOPT-1 (GitHub 5585) moves to in_progress: the staged path refused 15 of the 34 worker directories as "not an ES module" because it tested the text `export default` and a bundler writes
--       `export { x as default }` (dry runs 41952554890 and 41952559656); PR 7633 fixes the guard; PR 7622 lists qnfo-ai-calibration, the host that took over the proof from the folded qnfo-model-eval.
--       deploys_via_gradual reads 0.0032; it rises only as listed workers receive code-only pushes. Next: real proofs for qnfo-subscribers and qnfo-pdf, then list them.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'built' WHERE id IN (1723, 1709) AND status = 'verified'; UPDATE roadmap_implementation SET status = 'planned' WHERE id = 1706 AND status = 'in_progress'; DELETE FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'roadmap-rows-live-verified-2';
-- CAUSE-MAPPED: registers no metric_registry row.

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'live 2026-11-05 03:35Z: qnfo-code-orchestrator /health 0.48.2-codeagent (circuit breaker shipped in 0.48.0, PR 7483); ops_config code_loop_breaker = on; the live loop wrote code_loop_breaker_state {"fails":0,"until":0,"trips":0}, so the breaker evaluates each tick and has not tripped; control_registry rows code-loop-breaker and code-loop-kill-switch-reader; kill-switch-breaker.test.mjs 32 checks (five failures trip, a paused tick makes no model call, an expired pause resumes, off disables). Reused caps: steps per tick, wall-clock per tick, lanes, daily calls and neurons (spendGate). Limit: no live trip was provoked.'
WHERE id = 1723 AND status = 'built';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = datetime('now'),
    evidence = 'live 2026-11-05 03:35Z: qnfo-fleet-control /health 0.66.3-codeagent (the lane gate shipped in 0.66.0, PR 7570, merged 02:02:30Z); ops_config slo_merge_lane = on, slo_budget_spent empty (the freeze is inert today), lane_review_hold = on, lane_review_wait_min = 8; the lane kept merging through the new code path after the deploy (PRs 7534 at 02:49Z and 7622 among them); lane-review-slo.test.mjs 67 checks cover the freeze (capability fragment held, patch release, migration and docs merged, label and slo-exempt body line, slo_merge_lane off). Limit: the hold itself is exercised offline only, because no budget is spent now.'
WHERE id = 1709 AND status IN ('planned', 'built');

UPDATE roadmap_implementation
SET status = 'in_progress',
    evidence = 'the staged path refused 15 of 34 worker directories as "not an ES module" because scripts/gradual_deploy.py tested the text export default and a bundler writes export { x as default } (dry runs of gradual-deploy.yml, qnfo-subscribers 41952554890 and qnfo-pdf 41952559656, 2026-11-05); PR 7633 fixes the guard (all 34 pass); PR 7622 lists qnfo-ai-calibration, the host that took over the proof from the folded qnfo-model-eval. deploys_via_gradual reads 0.0032 and rises only as listed workers receive code-only pushes; next: real proofs for qnfo-subscribers and qnfo-pdf, then list them.'
WHERE id = 1706 AND status = 'planned';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:B-governance-code',
  'a roadmap row is verified on what the live system shows, with the limit stated; a row whose behaviour cannot yet be observed live says so',
  'roadmap_implementation 1723 and 1709 set to verified, 1706 to in_progress, each with its readings',
  'orchestrator /health 0.48.2, fleet-control /health 0.66.3, ops_config rows, breaker state row written by the live loop',
  'pending', 'three roadmap rows and their GitHub mirrors', 'the Rollback line of migrations/2026-11-05-b-governance-verified-2.sql',
  'roadmap-rows-live-verified-2',
  'the mirrors of 5603 and 5592 close; 5585 stays open with a named next step', 'none (closing existing work)', 'reads listed in the file header'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:B-governance-code' AND capability_gain = 'roadmap-rows-live-verified-2');
