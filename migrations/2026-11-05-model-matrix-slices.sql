-- MODEL-MATRIX-SLICES-1 (2026-11-05, session C-ops-tools; charter pillar cost; program QNFO.OPS). Companion of qnfo-ops 2.67.0 and qnfo-research-exec 0.53.2 for agent_issues 1000708 and 1000709
-- (MODEL-MATRIX-1 rows gate-decision and bulk-background/utility-text), and the disposition of the three cf-model-eval adoption items RM-923, RM-1614 and RM-1646.
-- 1000708: qnfo-ops now asks @cf/cloudflare/clef-flash the tier and needs_tools questions next to every uncached, non-public chat turn and writes its answer, the model that served the turn and the
--   agreement to cost_router_metrics as task_class gate-decision-shadow (nothing routes on it; ops_config model_matrix_gate = off stops it). Routing needs agreement >= 0.7 over 200 rows, read from the
--   view v_model_matrix_gate_shadow created here. The contract probe now names the shadow task class instead of the marker comment, so it passes on the code that writes the rows.
--   Measured first (2026-11-05): qnfo-ops sent 74 of 74 chat-class calls since 2026-10-30 to tier 1 (free @cf models) and 6 deterministic answers to tier 0, none to tier 2 or 3, and the canary measured
--   0.125 agreement of clef-flash with the labelled incumbent (cf_model_catalog row: BLOCKED), so the share of chat calls reaching a frontier or paid tier cannot fall: the shadow rows decide whether the
--   gate has any headroom at all.
-- 1000709: the claim audit extraction of qnfo-research-exec runs on gpt-oss-20b with a per-request fallback to gpt-oss-120b (marker MODEL-MATRIX-1, ops_config claim_scan_model = off reverts); the
--   contract is the issue's own code-probe, which passes on the merged code. scripts/model-policy.json lists gpt-oss-20b in `allowed` (ctx 128000 from cf_model_catalog).
-- RM-923, RM-1614, RM-1646: the models are in_production in cf_model_catalog and active in model_ladder_models (tier 1), read 2026-11-05; the roadmap items were never closed because nothing closed them
--   (all four cf-model-eval items were still open); they are verified here with that evidence.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_model_matrix_contracts
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_model_matrix_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_model_matrix_contracts b WHERE b.class = remediation_contracts.class) WHERE class = 'issue-1000708';

CREATE TABLE IF NOT EXISTS bak_20261105_model_matrix_contracts AS SELECT class, verify_probe, verify_transport, last_verdict FROM remediation_contracts WHERE class IN ('issue-1000708');
CREATE TABLE IF NOT EXISTS bak_20261105_model_matrix_roadmap AS SELECT id, status, evidence, verified_at FROM roadmap_implementation WHERE id IN (923, 1614, 1646);

UPDATE remediation_contracts
SET verify_probe = '{"paths": ["qnfo-ops/worker.js"], "contains": "gate-decision-shadow"}', verify_transport = 'code-read', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000708' AND issue_id = 1000708;

-- The agreement the gate would route on, over the latest 200 shadow rows. tier = the tier clef-flash predicted (0 = no parseable answer), success = predicted tier equals the tier that served the turn,
-- tool_calls_ok = needs_tools agreed with the tool calls the turn made.
CREATE VIEW IF NOT EXISTS v_model_matrix_gate_shadow AS
SELECT COUNT(*) AS n,
       SUM(success) AS tier_agree,
       ROUND(1.0 * SUM(success) / MAX(COUNT(*), 1), 4) AS agreement,
       SUM(tool_calls_ok) AS tools_agree,
       SUM(CASE WHEN tier = 1 THEN 1 ELSE 0 END) AS predicted_free_small,
       SUM(CASE WHEN tier = 2 THEN 1 ELSE 0 END) AS predicted_cheap_mid,
       SUM(CASE WHEN tier = 3 THEN 1 ELSE 0 END) AS predicted_frontier,
       SUM(CASE WHEN tier = 0 THEN 1 ELSE 0 END) AS unparsed,
       MIN(ts) AS first_ts,
       MAX(ts) AS last_ts
FROM (SELECT * FROM cost_router_metrics WHERE task_class = 'gate-decision-shadow' ORDER BY id DESC LIMIT 200);

UPDATE roadmap_implementation
SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = COALESCE(evidence, '') || ' | VERIFIED 2026-11-05 (session C-ops-tools): cf_model_catalog status in_production and model_ladder_models tier 1 active 1 (price 0.1 / 0.3, quality 62); last eval verdict promote at 67% of the control input price.'
WHERE id = 923 AND item = 'MODEL-@cf/google/gemma-4-26b-a4b-it' AND status = 'open';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = COALESCE(evidence, '') || ' | VERIFIED 2026-11-05 (session C-ops-tools): cf_model_catalog status in_production and model_ladder_models tier 1 active 1 (price 0.06 / 0.4, quality 66); last eval verdict keep (score 0.9 inside the 0.15 band below control 1).'
WHERE id = 1614 AND item = 'MODEL-@cf/zai-org/glm-4.7-flash' AND status = 'open';

UPDATE roadmap_implementation
SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = COALESCE(evidence, '') || ' | VERIFIED 2026-11-05 (session C-ops-tools): cf_model_catalog status in_production and model_ladder_models tier 1 active 1 (price 0.051 / 0.335, quality 65); last eval verdict promote at 34% of the control input price.'
WHERE id = 1646 AND item = 'MODEL-@cf/qwen/qwen3-30b-a3b-fp8' AND status = 'open';
