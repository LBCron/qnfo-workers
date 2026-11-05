-- F1-RESEARCH-REACH-CLOSEOUT-2 (2026-11-05, charter pillar research; GitHub 5728 6448 6153 6146 6709; agent_issues 1000701 1001274 1000974 1000960 1001450).
-- Sweep cluster F1-research-reach, part 3. Facts read live 2026-11-05 05:00Z-05:40Z.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f1_closeout2
-- Rollback: UPDATE research_queue SET score = (SELECT b.score FROM bak_20261105_f1_closeout2 b WHERE b.kind = 'score' AND b.id = research_queue.id) WHERE id IN (SELECT id FROM bak_20261105_f1_closeout2 WHERE kind = 'score'); UPDATE research_queue SET error = (SELECT b.error FROM bak_20261105_f1_closeout2 b WHERE b.kind = 'error' AND b.id = research_queue.id) WHERE id IN (SELECT id FROM bak_20261105_f1_closeout2 WHERE kind = 'error') AND error IS NULL; UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'SINGLE-LANE-2:%'; decision_log is append-only and keeps its row.
-- CAUSE-MAPPED: no metric_registry row is registered here; this edits research_queue rows, adds one issue row and one decision_log row.
--
-- WHAT THIS DOES
--  (1) #5728 / 1000701 REVISED-STANDARD-1 backfill: the two published papers whose body is an LLM outline (a-unified-framework-for-superdeterminism... 2.0.0, simulation-inconsistency-detection... 2.1.0) have
--      revision rows rem-rev-cfb-1000701-a and -b queued since 2026-10-28T19:36Z with score 0.96, never claimed in 7 days: the claim orders the revision class by score then age and 22 revision rows
--      hold the same 0.96 (oldest 2026-10-21), while the throttled pipeline claims 1 to 2 rows an hour. A paper whose published body is planning text is the worst quality defect in the corpus, so these two rows go to
--      0.99 and are claimed next. Nothing else about the rows, the gates or the caps changes.
--  (2) #6448 / #6153 / #6146: research_queue.error is cleared only at publish, so a row that is no longer stuck on the structural defect keeps its old text ("complete: structural defects only, no writable section: ...")
--      for days and the contracts that count such rows (issue-1001274, issue-1000974) cannot read pass. Rows that are not at stage complete cannot be stuck there: their text is cleared (old text kept in the backup
--      table); a row that fails the complete stage again gets the text written again by markError, so the probe stays honest.
--  (3) #6709 SINGLE-LANE-1 left one branch outside qnfo-research-exec: qnfo-fleet-control researchBackpressureTick (POOL-BOUND-1) still writes status wontfix, stage parked when ops_config research_deferred_max
--      is above 0 (it is 0 since 2026-11-03, so the branch is off). It is filed as SINGLE-LANE-2 with a doer and a code-probe so the branch is removed, not left as a latent park.
-- PREDICTION (decision_log below): the two rows are claimed within 12 hours (claimed_at set, stage past ground), issue-1001274 reads pass after the structural-repair rows advance, SINGLE-LANE-2 closes with the code-probe.
-- Failure mode: 0.99 is a one-off priority for two rows and does not scale; if a third such paper appears the revision class needs its own aging rule (filed in the issue text below).

CREATE TABLE IF NOT EXISTS bak_20261105_f1_closeout2 AS
SELECT 'score' AS kind, id, CAST(score AS TEXT) AS score, NULL AS error FROM research_queue WHERE id IN ('rem-rev-cfb-1000701-a', 'rem-rev-cfb-1000701-b')
UNION ALL
SELECT 'error', id, NULL, error FROM research_queue WHERE status IN ('queued', 'researching', 'deferred') AND COALESCE(stage, '') <> 'complete' AND instr(error, 'no writable section') > 0;

UPDATE research_queue SET score = 0.99 WHERE id IN ('rem-rev-cfb-1000701-a', 'rem-rev-cfb-1000701-b') AND status = 'queued' AND score < 0.99;

UPDATE research_queue SET error = NULL
WHERE status IN ('queued', 'researching', 'deferred') AND COALESCE(stage, '') <> 'complete' AND instr(error, 'no writable section') > 0;

INSERT INTO agent_issues (title, description, source, category, priority, status)
SELECT 'SINGLE-LANE-2: qnfo-fleet-control researchBackpressureTick must not write status wontfix / stage parked (POOL-BOUND-1 branch)',
 'Charter pillar: research. Follow-up of SINGLE-LANE-1 (agent_issues 1001450, GitHub 6709): qnfo-research-exec no longer writes stage parked, but qnfo-fleet-control researchBackpressureTick still has the POOL-BOUND-1 branch (a write that sets status wontfix and stage parked for a deferred pool above ops_config research_deferred_max) and the matching read that brings the rows back. The branch is off while research_deferred_max = 0 (set 2026-11-03) but one ops_config write turns it into a second lane for dead rows. Remove the park write and its re-arm read; the deferred pool stays ordered by priority, score and age (RB_ORDER_SQL), never cut. Control registry: research-pool-bound goes to disposition remove when this lands.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: async function researchBackpressureTick(env) {' || char(10) ||
 'code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "absent": "SET status = ''wontfix'', stage = ''parked''"}' || char(10) ||
 'Definition of done: the code-probe reads absent after the canonical deploy, the worker suite passes, and SELECT COUNT(*) FROM research_queue WHERE stage = ''parked'' stays 0 for 24 hours.',
 'session:F1-research-reach', 'reliability', 'high', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SINGLE-LANE-2:%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:F1-research-reach',
 'two published papers whose body is planning text are the worst quality defect in the corpus, and a stale error annotation on a research_queue row makes a repaired row look stuck; so the two revision rows are prioritised once and the stale annotations of rows that are not at the complete stage are cleared with a backup',
 'F1-RESEARCH-REACH-CLOSEOUT-2: score of rem-rev-cfb-1000701-a and -b to 0.99, stale structural error text cleared on rows not at stage complete, SINGLE-LANE-2 filed',
 'research_queue read 2026-11-05: both rows queued since 2026-10-28T19:36Z with 0.96 behind 22 revision rows of 0.96, claims 1 to 2 an hour; 3 rows carried the structural text at stages review, ground and revise; fleet-control researchBackpressureTick still writes stage parked at its POOL-BOUND-1 branch (off while research_deferred_max = 0)',
 'migration applied by CI; claims read at the next ticks',
 'two research_queue score values, the error text of rows not at stage complete, one agent_issues row',
 'the Rollback header restores both from bak_20261105_f1_closeout2 and closes the new issue',
 'the corpus stops serving two outline papers sooner; probes of repaired rows read honestly',
 'both rows claimed within 12 hours and past stage ground; issue-1001274 reads pass once no row at a later stage carries the structural text',
 'two published papers regenerated',
 'research_queue, agent_issues'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'F1-RESEARCH-REACH-CLOSEOUT-2:%');
