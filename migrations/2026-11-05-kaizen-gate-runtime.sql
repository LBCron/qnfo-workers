-- KAIZEN-GATES-RUNTIME-1 (2026-11-05, charter pillar: autonomy; roadmap row RM-KAIZEN-GATE-CANDIDATES-1, qnfo-audit.roadmap_implementation id 62; task_dod 331).
-- The 12 kaizen gate candidates of 2026-09-26/27 (kaizen_candidates rowid 34 to 45: ten read "promoted", two "proposed") were prose: promotion filed an improvement, nothing enforced the lesson.
-- Each now has an enforcer, read on 2026-11-05:
--   repository checks   scripts/kaizen_gates.py (strict fast guard "kaizen-gates" in scripts/pr_fast_guards.py, tests scripts/kaizen-gates.test.mjs):
--                       RED-INVENTORY-1, BUILD-GATE-NOT-RUNTIME-GATE-1, LIVE-AHEAD-OF-REPO-UNCOMMITTED-1 (tripwires on the enforcers they rely on), DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1,
--                       CURRENCY-UNIT-TRAP-1, STALE-TEMPLATE-MODELKEY-1 (checks); GATEWAY-RUNWAY-BRAKE-1 and TEMPLATE-RUNTIME-INJECTION-PARITY-1 as command-line checks over a live input.
--   D1 detectors        this file: GOVERNANCE-CAP-DISPOSITION-1 (fleet_budget_disposition, v_fleet_budget_undisposed, fm-fleet-budget-undisposed), CLAIM-SHEET-DB-ENFORCEMENT-1
--                       (fm-claim-sheet-triggers), FLEET-VS-EXTERNAL-MISATTRIBUTION-1 (fm-cost-source-scope). REGISTRY-DRIFT-CONCURRENT-REMOVAL-1 is held by fm-registry-live-absent and the
--                       fleet-graph findings untracked-worker and undeployed-dir, both already live.
-- MEASURED while writing: fleet_budget holds four classes over their cap (workers 39 of 30, d1_databases 13 of 10, ai_spend:workers-ai 793.53 of 95, cost:fleet_all_in_month 1151.13 of 300), each already has a
-- doer (metric trigger 344, issue 1001824, triggers 354 and 10930); that link was nowhere recorded, which is the GOVERNANCE-CAP-DISPOSITION-1 gap. Found on the way: costImpactGuard (qnfo-fleet-control) has
-- ended all 39 daily runs since 2026-09-27 as "-failed", the last ones with HTTP 400 "Expected number, received nan" from a PUT that sends spend_limits only; filed below with its doer.
-- PREDICTION (decision_log): kaizen gate candidates held by a machine check 0 of 12 to 12 of 12; kaizen_candidates rowid 34 to 45 left "proposed" or "promoted": 12 to 0; the detectors read 0 within the hour after apply.
-- Falsifier: fm-fleet-budget-undisposed reads above 0 after apply (a breached class lost its doer) or a pull request is blocked by kaizen-gates for a violation the base tree does not have: revert with the Rollback line.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_kaizen_gates
-- Rollback: UPDATE kaizen_candidates SET status = (SELECT b.status FROM bak_20261105_kaizen_gates b WHERE b.tbl = 'kaizen_candidates' AND b.rid = kaizen_candidates.rowid), evidence = (SELECT b.evidence FROM bak_20261105_kaizen_gates b WHERE b.tbl = 'kaizen_candidates' AND b.rid = kaizen_candidates.rowid) WHERE rowid IN (SELECT rid FROM bak_20261105_kaizen_gates WHERE tbl = 'kaizen_candidates'); UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_kaizen_gates b WHERE b.tbl = 'roadmap_implementation' AND b.rid = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_kaizen_gates b WHERE b.tbl = 'roadmap_implementation' AND b.rid = roadmap_implementation.id) WHERE id IN (SELECT rid FROM bak_20261105_kaizen_gates WHERE tbl = 'roadmap_implementation'); DROP VIEW IF EXISTS v_fleet_budget_undisposed; DROP TABLE IF EXISTS fleet_budget_disposition; DELETE FROM remediation_contracts WHERE class IN ('fm-fleet-budget-undisposed', 'fm-claim-sheet-triggers', 'fm-cost-source-scope'); DELETE FROM failure_modes WHERE fm_key IN ('fleet-budget-undisposed', 'claim-sheet-triggers', 'cost-source-scope');
-- CAUSE-MAPPED: registers no metric_registry row; the detectors are failure_modes rows with remediation contracts.

CREATE TABLE IF NOT EXISTS bak_20261105_kaizen_gates AS
SELECT 'kaizen_candidates' AS tbl, rowid AS rid, status, evidence FROM kaizen_candidates WHERE rowid BETWEEN 34 AND 45
UNION ALL
SELECT 'roadmap_implementation', id, status, evidence FROM roadmap_implementation WHERE id = 62;

-- 1. GOVERNANCE-CAP-DISPOSITION-1: a cap that is breached carries a live disposition (a doer that converges the metric, or a recorded re-baseline), never a silent re-detection.
CREATE TABLE IF NOT EXISTS fleet_budget_disposition (
  node_class TEXT PRIMARY KEY,
  disposition TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at TEXT
);

-- seeded only where the doer exists and is live at apply time (a metric trigger that is enabled, an issue that is open)
INSERT OR IGNORE INTO fleet_budget_disposition (node_class, disposition, ref_kind, ref_id, evidence)
SELECT 'workers', 'converge', 'trigger', 344, 'metric trigger 344 (worker_count above 30, owner qnfo-fleet-control) files the consolidation levers; fleet_budget workers 39 of cap 30 read 2026-11-05'
WHERE EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE id = 344 AND enabled = 1);
INSERT OR IGNORE INTO fleet_budget_disposition (node_class, disposition, ref_kind, ref_id, evidence)
SELECT 'd1_databases', 'converge', 'issue', 1001824, 'issue 1001824 (SYSTEM-MAP-1: sweep stale drill-restore scratch D1 databases at drill start) removes the scratch databases that hold d1_databases at 13 of cap 10'
WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001824 AND status = 'open');
INSERT OR IGNORE INTO fleet_budget_disposition (node_class, disposition, ref_kind, ref_id, evidence)
SELECT 'ai_spend:workers-ai', 'steer', 'trigger', 354, 'BUDGET-SOFT-ROUTE-1: an AI spend cap steers model choice and never stops work; metric trigger 354 (workers_ai_cost_30d_usd) files the cheaper-model levers; list estimate 793.53 of cap 95 read 2026-11-05'
WHERE EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE id = 354 AND enabled = 1);
INSERT OR IGNORE INTO fleet_budget_disposition (node_class, disposition, ref_kind, ref_id, evidence)
SELECT 'cost:fleet_all_in_month', 'steer', 'trigger', 10930, 'metric trigger 10930 (fleet_cost_bound_month_usd, owner qnfo-fleet-control) holds the all-in month; pace 1151.13 of cap 300 read 2026-11-05'
WHERE EXISTS (SELECT 1 FROM analytics_metric_triggers WHERE id = 10930 AND enabled = 1);

CREATE VIEW IF NOT EXISTS v_fleet_budget_undisposed AS
SELECT b.node_class AS node_class, b.cap AS cap, b.current AS current_value, b.unit AS unit,
       CASE WHEN d.node_class IS NULL THEN 'no disposition' ELSE 'disposition expired or its doer is gone' END AS why
FROM fleet_budget b
LEFT JOIN fleet_budget_disposition d ON d.node_class = b.node_class
WHERE b.current > b.cap
  AND NOT (d.node_class IS NOT NULL
       AND (d.expires_at IS NULL OR d.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       AND ((d.ref_kind = 'trigger' AND EXISTS (SELECT 1 FROM analytics_metric_triggers t WHERE t.id = d.ref_id AND t.enabled = 1))
         OR (d.ref_kind = 'issue' AND EXISTS (SELECT 1 FROM agent_issues i WHERE i.id = d.ref_id AND i.status NOT IN ('closed', 'resolved', 'wontfix', 'done', 'duplicate')))
         OR (d.ref_kind = 'decision' AND EXISTS (SELECT 1 FROM decision_log x WHERE x.id = d.ref_id))));

-- 2. detectors (failure mode path: the hourly remediation tick escalates a miss to qnfo-fleet-control)
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('fleet-budget-undisposed', 'a fleet_budget class stays over its cap with no live disposition: the breach is detected every cycle and never decided',
  'GOVERNANCE-CAP-DISPOSITION-1 (2026-09-27): the BUDGET-OVER node was detected hourly for days; the link from a breached class to its doer was not recorded anywhere a probe could read',
  'record the disposition in fleet_budget_disposition: converge (a metric trigger or issue that is live), steer (BUDGET-SOFT-ROUTE-1) or a re-baseline decision_log row with its evidence; never re-file silently',
  'the fm-fleet-budget-undisposed contract counts v_fleet_budget_undisposed rows, expected 0', 'fm-fleet-budget-undisposed', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'a fleet_budget row with current above cap and no unexpired fleet_budget_disposition row whose trigger is enabled, issue is open or decision exists',
  'budget breaches repeat in every tick with no owner', 'caps are measured and never acted on');
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-fleet-budget-undisposed', NULL, 'KAIZEN-GATES-RUNTIME-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_fleet_budget_undisposed) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('claim-sheet-triggers', 'the fail-closed claim_sheet triggers of handoffs and wbs_state are dropped, so FRAMEWORK-DOGFOOD-1 returns to convention',
  'CLAIM-SHEET-DB-ENFORCEMENT-1 (2026-09-27): 908 handoffs and 458 wbs_state rows had no claim sheet while the rule lived in prose; the triggers are the enforcement',
  're-create handoffs_claim_sheet_required_ins and wbs_claim_sheet_required_ins (BEFORE INSERT, abort when claim_sheet is NULL or shorter than 3 characters); their negative tests run in scripts/guard-registry-negative-tests.mjs',
  'the fm-claim-sheet-triggers contract counts the two triggers in sqlite_master, expected 2', 'fm-claim-sheet-triggers', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'fewer than two of the claim_sheet required triggers exist', 'a claim-less handoff or wbs_state insert succeeds', 'session closeout records without evidence');
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-claim-sheet-triggers', NULL, 'KAIZEN-GATES-RUNTIME-1', 'failure-mode detector',
  'SELECT ''2'' AS expected, CAST((SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name IN (''handoffs_claim_sheet_required_ins'', ''wbs_claim_sheet_required_ins'')) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES ('cost-source-scope', 'a cost source is registered with a scope outside fleet, external, owner-direct and owner-clients, or the fleet-only view is gone: a bill gets attributed to the fleet without the fleet logs showing it',
  'FLEET-VS-EXTERNAL-MISATTRIBUTION-1 (2026-09-26): a 4-500 USD a month provider bill was attributed to the fleet; the fleet logs showed about 4 USD',
  'register every cost source in cost_source_registry with its scope; v_cost_fleet_30d reads fleet-attributed logs only; the owner-side lines stay in v_cost_all_in under their own scope',
  'the fm-cost-source-scope contract counts registry rows outside the scope vocabulary plus a missing v_cost_fleet_30d, expected 0', 'fm-cost-source-scope', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), NULL,
  'a cost_source_registry row with an unknown scope, or no v_cost_fleet_30d view', 'a cost claim names a system whose own logs do not show it', 'cost decisions taken on a misattributed bill');
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES ('fm-cost-source-scope', NULL, 'KAIZEN-GATES-RUNTIME-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM cost_source_registry WHERE scope NOT IN (''fleet'', ''external'', ''owner-direct'', ''owner-clients'')) + (SELECT 1 - COUNT(*) FROM sqlite_master WHERE type = ''view'' AND name = ''v_cost_fleet_30d'') AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

-- 3. the doer for the defect found on the way (GATEWAY-RUNWAY-BRAKE-1): costImpactGuard has never applied a change
INSERT INTO agent_issues (title, description, source, category, priority, status)
SELECT 'ROADMAP-1: QNFO.OPS RM-KAIZEN-GATE-CANDIDATES-1.2: costImpactGuard PUTs spend_limits alone and fails with HTTP 400 on 39 of 39 runs; make it observation-only (BUDGET-SOFT-ROUTE-1)',
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js
code-anchor: async function costImpactGuard(env) {
code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "absent": "JSON.stringify({ spend_limits: { enabled: true, rules: newRules } })"}
Charter pillar: cost. Roadmap row RM-KAIZEN-GATE-CANDIDATES-1 (gate GATEWAY-RUNWAY-BRAKE-1), program QNFO.OPS. Measured 2026-11-05: qnfo-audit.cost_impact_guard ids 1 to 39 (daily 03:00Z since 2026-09-27) all end "relax-failed" or "tighten-failed"; the runs from 2026-10-20 carry "put=400 ... Expected number, received nan ... rate_limiting" because costImpactGuard in qnfo-fleet-control PUTs {spend_limits} alone, and the AI Gateway PUT needs the whole object (AI-GATEWAY-PUT-FULL-OBJECT-1). The gateway itself is intact (read through the Cloudflare API on 2026-11-05: rate_limiting_limit 300 per 60 s fixed, authentication true, rules monthly-180-providers and monthly-100-workers-ai enabled), so nothing was lost, but the guard has never worked.
Decision (DEFAULT-APPROVE-1, recommended option taken): do not repair the PUT. BUDGET-SOFT-ROUTE-1 (owner 2026-10-06): AI spend budgets steer model choice and never stop work, and a gateway spend rule is a hard stop, so the loop must not tighten or relax it on its own. costImpactGuard keeps its GET and its decision, records the action as tighten-recommended or relax-recommended with gateway_limit_after equal to gateway_limit_before, sends no PUT, and from the same GET writes the brake shape that scripts/kaizen_gates.py --gateway-config holds (rate_limiting_limit not above 300 per minute, authentication true, an enabled cost rule) into the row evidence. Revert: restore the PUT block.
Closing probe: the PUT body that sends spend_limits alone is gone from qnfo-fleet-control/worker.js (code-probe above).',
 'session:c4-kaizen', 'reliability', 'medium', 'open'
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND instr(title, 'RM-KAIZEN-GATE-CANDIDATES-1.2:') > 0);

-- 4. the lessons are now enforced: dispositions with the enforcer named (each row keeps its original evidence)
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced by gate RED-INVENTORY-1 in scripts/kaizen_gates.py (the fleet phone journey see-what-needs-me must stay; V3-DASH-1 replaced the failures-only root with the Needs you first Now screen, fleet.qnfo.org/api/v3/now read 2026-11-05)'
WHERE id = 'kc-redinventory-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced by DEPLOY-PROBES-1 (canonical-deploy.yml deploy_probes.py and canary_revert.py; qnfo-fleet-dashboard/probes.json probes / for the page marker) and the worker-load-gate of pr_fast_guards; tripwire gate BUILD-GATE-NOT-RUNTIME-GATE-1 in scripts/kaizen_gates.py'
WHERE id = 'kc-buildgate-runtime-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced by gate DEAD-SERVICE-BINDING-DEPLOY-BLOCK-1 in scripts/kaizen_gates.py (service, tail consumer and durable object script_name bindings of every live wrangler.toml must resolve to a live directory; kaizen-gates fast guard in scripts/pr_fast_guards.py; 0 violations in 36 live workers on main)'
WHERE id = 'kc-dead-binding-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced by fleet-autodeploy.yml (scripts/fleet-autoaudit.py --audit writes worker_live_audit: 131 rows, newest 2026-11-04T23:40Z; apply mode never redeploys a repo-BEHIND worker) with tripwire gate LIVE-AHEAD-OF-REPO-UNCOMMITTED-1 in scripts/kaizen_gates.py'
WHERE id = 'kc-live-ahead-repo-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced by gate CURRENCY-UNIT-TRAP-1 in scripts/kaizen_gates.py (a source file that reads a Cloudflare billing amount names its unit; fleet-control, the dashboard and scripts/cost_ledger.py pass)'
WHERE id = 'kc-cents-unit-trap-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced at runtime: cost_source_registry (scope NOT NULL; 12 rows read 2026-11-05) and v_cost_fleet_30d (fleet logs only) exist; contract fm-cost-source-scope holds the scope vocabulary and the view'
WHERE id = 'kc-fleet-vs-external-attr-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: live gateway read 2026-11-05 (rate_limiting_limit 300 per 60 s fixed, authentication true, spend rules monthly-180-providers and monthly-100-workers-ai enabled); the shape is held by scripts/kaizen_gates.py --gateway-config; defect found in costImpactGuard (39 of 39 runs failed) filed as ROADMAP-1 QNFO.OPS RM-KAIZEN-GATE-CANDIDATES-1.2'
WHERE id = 'kc-flock-rate-limit-brake-20260926' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced in D1: triggers handoffs_claim_sheet_required_ins and wbs_claim_sheet_required_ins exist (read 2026-11-05; guard_registry verified_at 2026-09-29); contract fm-claim-sheet-triggers fails if either is dropped'
WHERE id = 'kc-claim-sheet-db-enforcement-20260927' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced by fm-registry-live-absent (registry live row whose script is absent) and the fleet-graph findings untracked-worker and undeployed-dir (2 untracked-worker findings read 2026-11-05: qnfo-fleet-lee, voice-stt); a retirement deletes the script and the registry row together'
WHERE id = 'kc-registry-drift-concurrent-20260927' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced in CI by gate STALE-TEMPLATE-MODELKEY-1 in scripts/kaizen_gates.py (repo customPrompts stores carry no superseded key and name the live default; the guard triplicate agrees); the owner-machine stores stay with prompt-store-verify.py (GUARDS-LOCAL-ONLY-1, agent_issues 1686)'
WHERE id = 'kc-stale-template-modelkey-20260927' AND status IN ('promoted', 'proposed');
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: enforced at runtime: fleet_budget_disposition and v_fleet_budget_undisposed (migrations/2026-11-05-kaizen-gate-runtime.sql) with contract fm-fleet-budget-undisposed, expected 0; the four breached classes are seeded with their doers'
WHERE title LIKE 'GOVERNANCE-CAP-DISPOSITION-1:%' AND status = 'proposed';
UPDATE kaizen_candidates SET status = 'resolved', updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
  evidence = COALESCE(evidence, '') || ' | KAIZEN-GATES-1 2026-11-05: built: scripts/kaizen_gates.py --template-parity INJECTED --store STORE [--name NAME] compares the text a runtime injected with the store entry (and the superseded key and live default rules); the injected text exists only on the owner machine, so the local CMD UPDATE cycle calls it (GUARDS-LOCAL-ONLY-1, agent_issues 1686)'
WHERE title LIKE 'TEMPLATE-RUNTIME-INJECTION-PARITY-1:%' AND status = 'proposed';

UPDATE roadmap_implementation SET status = 'built',
  evidence = 'RM-KAIZEN-GATE-CANDIDATES-1: all 12 gates have an enforcer. Repository checks: scripts/kaizen_gates.py (6 gates, strict fast guard kaizen-gates in scripts/pr_fast_guards.py, 0 violations on main, scripts/kaizen-gates.test.mjs seeds a violation per gate; 2 command-line gates GATEWAY-RUNWAY-BRAKE-1 and TEMPLATE-RUNTIME-INJECTION-PARITY-1). D1 detectors: fm-fleet-budget-undisposed, fm-claim-sheet-triggers, fm-cost-source-scope (migrations/2026-11-05-kaizen-gate-runtime.sql). Held by existing enforcers: REGISTRY-DRIFT (fm-registry-live-absent, fleet-graph), LIVE-AHEAD (fleet-autoaudit), BUILD-GATE (DEPLOY-PROBES-1). kaizen_candidates rowid 34 to 45 are resolved with the enforcer named. Defect found: costImpactGuard 39 of 39 runs failed, filed with a doer (ROADMAP-1 QNFO.OPS RM-KAIZEN-GATE-CANDIDATES-1.2). Open: the device half of TEMPLATE-RUNTIME-INJECTION-PARITY-1 runs in the local CMD UPDATE cycle (GUARDS-LOCAL-ONLY-1)'
WHERE id = 62;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c4-kaizen (KAIZEN-GATES-RUNTIME-1)',
  'a lesson written as a kaizen candidate and only promoted into the issue ledger is not enforced; each of the 12 needs a machine check, a runtime detector or a named existing enforcer',
  'KAIZEN-GATES-1: scripts/kaizen_gates.py with a strict fast guard, fleet_budget_disposition and v_fleet_budget_undisposed with three failure-mode detectors, kaizen_candidates rowid 34 to 45 resolved with the enforcer, roadmap row 62 built, costImpactGuard defect filed',
  'kaizen_candidates read 2026-11-05: 10 promoted and 2 proposed gate rows; fleet_budget 4 classes over cap, each with a live doer; cost_impact_guard 39 of 39 runs failed; gateway config read through the Cloudflare API; scripts/kaizen_gates.py exits 0 on main in under 6 s',
  'applied by migration', 'kaizen_candidates rowid 34 to 45, roadmap_implementation id 62, one table, one view, three failure modes with contracts, one agent_issues row; no gate, cap, probe or worker is weakened or changed',
  'the Rollback line of migrations/2026-11-05-kaizen-gate-runtime.sql restores both tables from bak_20261105_kaizen_gates and drops the new objects',
  'twelve kaizen lessons held by checks that fail a pull request or a probe', 'kaizen gate candidates held by a machine check 0 of 12 to 12 of 12; candidates left proposed 2 to 0; fm detectors read 0',
  'none (internal quality)', 'node:sqlite fixture replay in migrations/kaizen-gate-runtime.test.mjs; scripts/kaizen-gates.test.mjs; live reads of D1 and the AI Gateway on 2026-11-05'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'KAIZEN-GATES-1:%');
