-- AI-COST-CUT-2 (charter pillar: research). Owner 2026-11-04: "The quality can never ever suffer."
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = '3' WHERE key = 'research_max_review_cycles';
--
-- 2026-11-04-ai-cost-width-cut.sql also lowered research_max_review_cycles 6 -> 3. REVISE-BUDGET-1 (worker.js, 2026-10-17) records that a
-- low cycle cap parked 179 papers as REVIEW-UNRESOLVED-PARK-1 while the patch reviser was still making edits, so fewer cycles trade
-- quality for parking. Restore 6; the width cuts (research_parallel 24, lean 2) stay because they limit throughput, not review depth.
-- Ordered after the width-cut file by name so the final value is 6 whichever order CI applies them in.
UPDATE ops_config SET value = '6' WHERE key = 'research_max_review_cycles';
