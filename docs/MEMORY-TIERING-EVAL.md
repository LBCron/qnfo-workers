# Tiered agent memory: how it is measured (RM-MEMORY-TIERING-1)

Charter pillar: **autonomy**. Issue: agent_issues 1000637 (GitHub 5687, roadmap_implementation 1681, docs/SCOUT-ROADMAP-2026-10.md). Worker: `qnfo-memory-mcp`.
The issue's definition of done is "consolidation row counts in a view and retrieval hit-rate measured before and after", evaluated at 7 and 30 days. This file is where
that evaluation is written down. It holds the baseline and the reading guide today; the result section is written by the QNFO.OPS roadmap lane when the days have run
(the closing probe of the issue reads this file for the second-level heading "Result at 30 days", so nothing below carries that heading before there is a result).

## What exists (qnfo-memory-mcp 2.9.0, migrations/2026-11-05-memory-tiering-store.sql)

| Piece | Where | What it does |
|---|---|---|
| tier, role, provenance | `agent_memories.metadata_json` (qnfo-graph D1) | `remember_fact` writes `tier` (episodic; semantic rows are produced by consolidation, which is not built), `role` (default agent) and `provenance` next to `source`. A row with no tier is read as episodic. |
| outcome records | `memory_outcomes` (qnfo-audit) | `memory_outcome` stores one success or failure per `(memory_id, feedback_id)`; a repeat is reported as a duplicate, a different answer for the same feedback id as a conflict and the first answer stands. |
| hit rate | view `v_memory_outcome_hit_rate` (7 and 30 days) | successes over successes plus failures. |
| tier counts | `memory_tier_counts` (hourly snapshot by the worker's cron), view `v_memory_tier_latest` | rows per tier and role, with the oldest and newest `created_at`. |
| consolidation runs | `memory_consolidation_runs` (empty) | one row per consolidation run: `episodic_in`, `semantic_out`. |
| one-row summary | view `v_memory_tiering` | `episodic_rows_effective`, `untiered_rows`, `semantic_rows`, `consolidation_runs`, `episodic_consolidated`, `semantic_produced`, `outcomes_7d`, `hit_rate_7d`, `outcomes_30d`, `hit_rate_30d`. |
| tools | MCP `memory_tiering_metrics` (read), `memory_outcome` (write), `search_memories` | `rank=weighted` multiplies the vector score by an age factor (1 falling to 0.85, half-life 90 days of the difference) and an outcome factor `1 + 0.15 (s - f) / (s + f + 3)`; the default stays the vector order. |

PR 6364 (2026-11-02) had advertised `memory_outcome`, `memory_tiering_metrics` and an outcome-weighted `search_memories` with no code behind them (the tools answered
"Unknown tool"); 2.9.0 implements them and `qnfo-memory-mcp/memory-tiering.test.mjs` fails when a tool is listed without a handler.

## Baseline (read from the databases on 2026-11-05, before 2.9.0 was deployed)

- `agent_memories`: 647 rows, first written 2026-07-14, newest 2026-10-25, **0 rows with a tier**. The first step (tier and role in `metadata_json`) was merged on 2026-10-28
  (PR 5167) and nothing has written a memory since: the tier field has never been exercised.
- `memory_outcomes`: created by the migration, empty. No retrieval hit rate exists before outcomes are recorded, so "before" is the first window in which outcomes arrive
  and "after" is the same measurement once consolidation has run.
- Consolidation and the decay policy are not built (ROADMAP-1 row `QNFO.INFRA #memory-consolidation`, gated on the tools being used).

## How to read it

```sql
-- qnfo-audit
SELECT * FROM v_memory_tiering;          -- the one-row summary
SELECT * FROM v_memory_tier_latest;      -- the latest snapshot by tier and role
SELECT * FROM v_memory_outcome_hit_rate; -- 7 and 30 day windows
```

or call `memory_tiering_metrics` on the MCP server.

## Decision rule (so an unused feature is not built out)

Fourteen days after the 2.9.0 deploy, if `episodic_rows_effective` is still at or below 700 and `outcomes_7d` is below 20, the premise of the item (a flat memory in use) does
not hold. The result section then says so with those two numbers, and the feature is retired through the standing owner grant rather than extended with consolidation.
Otherwise consolidation (bounded hourly step, one summary row per group of at least three older episodic rows, sources kept and marked) is built and `hit_rate_7d` is recorded
before and after on the same query set.

## Not measured here

Whether consolidated rows answer questions better than the episodic rows they replace is exactly what the 7 and 30 day readings decide; nothing in this file claims it.
