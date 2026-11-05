-- ROADMAP-1681-PARTIAL-1 (2026-11-05, charter pillar autonomy; roadmap_implementation 1681 = RM-MEMORY-TIERING-1, GitHub 5558; agent_issues 1000637).
-- Verified live before this file was written (qnfo-audit read at 01:39Z): qnfo-memory-mcp /health reports 2.9.0; memory_tier_counts holds the first hourly snapshot (ts 2026-11-05T01:00:00Z,
-- 647 rows, all untiered, newest 2026-10-25) and v_memory_tiering reads episodic_rows_effective 647, semantic_rows 0, outcomes_7d 0. The tools were not called live (no credential in the session).
-- The item is not done: consolidation is not built and the 7 and 30 day result is what the closing probe of issue-1000637 waits for, so the row moves from planned to partial, no further.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'planned', evidence = 'docs/SCOUT-ROADMAP-2026-10.md' WHERE id = 1681 AND status = 'partial' AND evidence LIKE 'partial 2026-11-05:%';
-- CAUSE-MAPPED: registers no metric_registry row.
-- spof-review: one status row.

UPDATE roadmap_implementation
SET status = 'partial',
    evidence = 'partial 2026-11-05: qnfo-memory-mcp 2.9.0 live (memory_outcome and memory_tiering_metrics implemented, tier validated, search_memories rank=weighted, hourly tier snapshot); v_memory_tiering reads 647 episodic rows, 0 tiered, 0 outcomes at the first snapshot 2026-11-05T01:00Z; consolidation not built (agent_issues ROADMAP-1 QNFO.INFRA #memory-consolidation, gated on the tools being used); the 7 and 30 day result goes to docs/MEMORY-TIERING-EVAL.md and closes agent_issues 1000637'
WHERE id = 1681 AND status = 'planned';
