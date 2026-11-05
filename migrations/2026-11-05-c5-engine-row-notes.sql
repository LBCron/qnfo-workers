-- C5-ENGINE-ROW-NOTES-1 (2026-11-05, charter pillar autonomy; follow-up to migrations/2026-11-04-c5-engine-roadmap-rows.sql, PR 7329).
-- Two corrections and one decision-guiding measurement, read live on 2026-11-05, appended to the evidence of roadmap rows 1 and 2 (nothing is closed or re-statused):
--   row 2: the 31 merged code tasks without a deployed_at stamp are mostly PRs merged on GitHub outside the loop runner, synced later by TRACKER-SYNC-1, not loop merges that skipped the deploy;
--   row 1: the research chain is not polling-bound, so a Queue chain there would not pay (idea_to_publish_h_p50_7d 352 h against a 10-minute tick), which keeps the first slice on the issues chain (ROADMAP-1 #S2.1).
-- Prediction: none on a metric (evidence text only); it stops a Queue build on the research chain that could not move idea_to_publish_h_p50_7d.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET evidence = substr(evidence, 1, instr(evidence, ' | 2026-11-05 c5-engine (correction') - 1) WHERE id IN (1, 2) AND instr(evidence, ' | 2026-11-05 c5-engine (correction') > 0;

UPDATE roadmap_implementation
SET evidence = COALESCE(evidence, '') || ' | 2026-11-05 c5-engine (correction, read live): of the 12 most recent merged worker-path code tasks without a deployed_at stamp (2026-11-03 to 2026-11-05), 9 carry the merge_note TRACKER-SYNC-1 (the pull request was merged on GitHub outside the loop merge runner and code_tasks was synced afterwards, so no deploy stamp is expected) and 3 are loop merges with no stamp (qnfo-social ct_im1001721 merged 2026-11-05T00:26Z and qnfo-lifecycle ct_im1001813 merged 2026-11-04T23:48Z, both noted no required check has started; qnfo-gateway ct_im1001719 merged 2026-11-04T21:01Z), which BLINDSPOT-1 still has to explain. So the 31 unstamped of 172 overstate the loop deploy gap; the loop-merge deploy latency above (1.2 minutes average over 135 stamped merges) stands.'
WHERE id = 2 AND instr(COALESCE(evidence, ''), ' | 2026-11-05 c5-engine (correction') = 0;

UPDATE roadmap_implementation
SET evidence = COALESCE(evidence, '') || ' | 2026-11-05 c5-engine (correction, read live): the research and version chains are not polling-bound, so they are not the next Queue slice. idea_to_publish_h_p50_7d reads 352.4 hours (target under 100) against a 10-minute cron tick (TICK-10M-1), and content_stage_events from 2026-11-03 holds 2680 transitions into ground for 1183 distinct items (1418 ground to ground, 1076 parked to ground) while 44 items reached done in the 8 days to 2026-11-05: the wait is funnel and capacity (research budget, single-flight lease, parked pools), and a stage-to-stage Queue would save at most a tick per stage (about 0.17 hour of 352). The issues chain (code tasks waiting for a work claim) is where the tick itself is the waste, hence ROADMAP-1 #S2.1. Do not build a Queue chain for research until content_items_over_stage_sla (279) and the ground churn are explained.'
WHERE id = 1 AND instr(COALESCE(evidence, ''), ' | 2026-11-05 c5-engine (correction') = 0;
