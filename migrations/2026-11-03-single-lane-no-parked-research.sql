-- SINGLE-LANE-1 (2026-11-03, pillar research; owner directive 2026-11-03: "NO MORE PARKED ITEMS! There shall only be a single line from idea to publish").
-- research_queue carried a second, dead-end lane: rows with stage 'parked' (status wontfix, or archived by the revision loop). Live /revision-loop read 21 wontfix/parked and 27 archived/parked rows on
-- 2026-11-03, with no sweep that returns a row once its recoveries are spent (PARK-REARM-EXHAUSTED-1). Parked rows are not a disposition the pipeline needs: every one is either a duplicate whose text another row already
-- carries, or an unfinished paper that belongs back in the one lane. This file (data side; the writer in qnfo-research-exec follows through the code task filed below):
--   1. rows that ERRATA-ROUTE-PER-PAPER-1 merged into another row (their errata text is carried there) leave the lane as status superseded, stage merged: nothing is rewritten twice;
--   2. every other row with stage parked re-enters the lane at ground as status queued with its recovery counters reset and its old reason kept in error; qnfo-fleet-control's backpressure tick then orders
--      it by priority, score and age like any other row, and the publication gates (review, verify, claim integrity) are unchanged;
--   3. ops_config research_deferred_max = 0 turns POOL-BOUND-1 off, so the backpressure tick stops creating parked rows (the deferred pool is ordered, not cut).
-- Nothing is deleted. The code that still writes stage parked (parkPoisonRow, reclaimStaleResearching, the REVIEW-UNRESOLVED and no-op ceiling routes) is replaced by the code task below, whose closing probe is that
-- no row holds stage parked.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_single_lane_parked
-- Rollback: UPDATE research_queue SET status = (SELECT b.status FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id), stage = (SELECT b.stage FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id), error = (SELECT b.error FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id), recover_count = (SELECT b.recover_count FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id), terminal_rearms = (SELECT b.terminal_rearms FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id), attempt = (SELECT b.attempt FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id), context = (SELECT b.context FROM bak_20261103_single_lane_parked b WHERE b.id = research_queue.id) WHERE id IN (SELECT id FROM bak_20261103_single_lane_parked) AND instr(error, 'SINGLE-LANE-1') > 0; DELETE FROM ops_config WHERE key = 'research_deferred_max'; INSERT OR REPLACE INTO ops_config (key, value, note) SELECT key, value, note FROM bak_20261103_single_lane_ops;

CREATE TABLE IF NOT EXISTS bak_20261103_single_lane_parked AS SELECT id, source, source_id, status, stage, error, recover_count, terminal_rearms, attempt, context, claimed_at, created_at FROM research_queue WHERE stage = 'parked' AND status IN ('wontfix', 'archived');
CREATE TABLE IF NOT EXISTS bak_20261103_single_lane_ops AS SELECT key, value, note FROM ops_config WHERE key = 'research_deferred_max';

-- 1. duplicates whose errata text another row carries
UPDATE research_queue
   SET status = 'superseded', stage = 'merged', claimed_at = NULL,
       error = substr('SINGLE-LANE-1: carried by another row, not rewritten twice. Was: ' || COALESCE(error, ''), 1, 300)
 WHERE stage = 'parked' AND status IN ('wontfix', 'archived') AND instr(COALESCE(error, ''), 'ERRATA-ROUTE-PER-PAPER-1: merged into') = 1;

-- 2. everything else re-enters the one lane at ground
UPDATE research_queue
   SET status = 'queued', stage = 'ground', claimed_at = NULL, attempt = 0, recover_count = 0, terminal_rearms = 0, context = '{}',
       error = substr('SINGLE-LANE-1: re-entered at ground, no parked state. Was: ' || COALESCE(error, ''), 1, 300)
 WHERE stage = 'parked' AND status IN ('wontfix', 'archived');

-- 3. the backpressure tick no longer cuts the deferred pool into parked rows
INSERT INTO ops_config (key, value, note) VALUES ('research_deferred_max', '0', 'SINGLE-LANE-1 2026-11-03: 0 turns POOL-BOUND-1 off; the deferred pool is ordered by priority and score, never parked')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note;

INSERT INTO agent_issues (title, description, source, category, priority, status)
SELECT 'SINGLE-LANE-1: qnfo-research-exec must never write stage parked (one lane from idea to publish)',
 'Charter pillar: research. Owner directive 2026-11-03: "NO MORE PARKED ITEMS! There shall only be a single line from idea to publish". migrations/2026-11-03-single-lane-no-parked-research.sql returned every parked row to the lane (status queued, stage ground) and switched POOL-BOUND-1 off, but qnfo-research-exec still writes stage parked: parkPoisonRow (PARKED-POISON-1), reclaimStaleResearching, the REVIEW-UNRESOLVED-PARK-1 and PARKED-REVISE-NOOP-CEILING-1 routes of markError/rerunRoute, and parkRearmTick/parkedRegroundTick/floorRearmTick that exist only to undo it. Replace each park with a re-queue at the stage the failure names (recover_count and a reason in error, one cloud_ops_events row), retire the re-arm sweeps, and keep every publication gate unchanged: a paper that cannot pass review is never published, it keeps cycling through revise and ground under the existing recover ceiling and the backpressure order. qnfo-fleet-control researchBackpressureTick must also stop writing wontfix/parked (the POOL-BOUND-1 branch).
Closing probe (d1-query): SELECT COUNT(*) AS n FROM research_queue WHERE stage = ''parked'' expected 0
code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: async function parkPoisonRow(env, row, msg) {',
 'session:single-lane', 'pipeline', 'high', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SINGLE-LANE-1: qnfo-research-exec%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-single-lane', 'a parked row is a second lane the pipeline does not need: a duplicate is carried by its other row, an unfinished paper belongs in the one ordered lane under the unchanged publication gates (owner 2026-11-03)',
 'SINGLE-LANE-1: returned every parked research_queue row to status queued, stage ground (merged errata duplicates become superseded), and turned POOL-BOUND-1 off with research_deferred_max = 0',
 'qnfo-research-exec /revision-loop 2026-11-03: 21 wontfix/parked and 27 archived/parked rows, revision-loop mode off; qnfo-research-exec/worker.js and qnfo-fleet-control/worker.js were under other live work claims, so the code side is a filed code task',
 'applied by migration', 'research_queue rows with stage parked; ops_config research_deferred_max; no gate, cap or score changes',
 'the Rollback line of migrations/2026-11-03-single-lane-no-parked-research.sql restores the rows and the ops_config value from the backup tables',
 'one lane from idea to publish; the backpressure tick orders every row', 'rows with stage parked: 48 to 0 right after apply; the code task keeps it at 0',
 'research: no paper waits in a dead-end state', 'research_queue and ops_config; the offline suite replays the file on node:sqlite'
WHERE NOT EXISTS (SELECT 1 FROM decision_log x WHERE x.action LIKE 'SINGLE-LANE-1:%');
