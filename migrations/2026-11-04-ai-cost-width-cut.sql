-- AI-COST-CUT-1 (charter pillar: cost). Owner directive 2026-11-04: cut Workers AI cost toward free.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = '96' WHERE key = 'research_parallel'; UPDATE ops_config SET value = '6' WHERE key = 'research_parallel_lean'; UPDATE ops_config SET value = '6' WHERE key = 'research_max_review_cycles';
--
-- D1 read 2026-11-04 (ai_call_counters, 3 full days): Workers AI ran 0.94-1.95M neurons/day (about $790/30d list) against a
-- 360k/day research target; qnfo-research-exec took 876k/day (28M input vs 6.7M output tokens a day, 17-29k input per call because each
-- review/revise cycle resends the whole draft), qnfo-code-orchestrator 480k/day (kimi-k2.7-code ladder rung 308k/day).
-- research_parallel 96 plus up to 6 review cycles resend the same draft many times. Lower the width and the cycle cap; the lean route
-- (width 6, 3 cycles) was already breached all day, so lean width drops 6 -> 2 as well. No hold: work continues at lower width
-- (BUDGET-SOFT-ROUTE-1). Verify: SUM(neurons) of ai_call_counters for the day under 450k within 48 h.
UPDATE ops_config SET value = '24' WHERE key = 'research_parallel';
UPDATE ops_config SET value = '2' WHERE key = 'research_parallel_lean';
UPDATE ops_config SET value = '3' WHERE key = 'research_max_review_cycles';
