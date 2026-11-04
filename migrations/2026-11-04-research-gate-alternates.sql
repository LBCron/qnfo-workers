-- SURVIVE-2 (2026-11-04, charter pillar: research; SQL only). Gives research-quality-gate and research-daily-neuron-gate an exercisable alternate-liveness probe
-- (control_alternate_probes; both read drill_state no-alternate / not-exercisable) and records what the live data shows, without changing any gate, cap or budget.
-- Measured 2026-11-04 (ai_call_counters): qnfo-research-exec spent 988,203 neurons on 11-02 and 996,539 on 11-03 against research_daily_neurons = 360,000. The gate steers
-- to the lean route and never holds work (SOFT-DAILY-BUDGET-1), so it is not the thing that holds spend to the target; the cap is Rowan's cost decision and the cost thread owns the lever.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM control_alternate_probes WHERE control IN ('research-quality-gate', 'research-daily-neuron-gate');
INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note)
VALUES ('research-daily-neuron-gate',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''research-budget'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 minutes'')) > 0 THEN ''ok'' ELSE ''no research-budget event in 30 minutes: the neuron gate is not evaluating'' END AS observed',
  '30 min: the gate writes a research-budget event each evaluation; this proves the gate runs, not that spend stays under target (see the migration header)');
INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note)
VALUES ('research-quality-gate',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''quality-fresh'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-120 minutes'')) > 0 AND (SELECT COUNT(*) FROM cloud_ops_events WHERE kind = ''quality-score'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-26 hours'')) > 0 THEN ''ok'' ELSE ''the qnfo-cloud-ops post-publication sweeps (quality-fresh 2 h, quality-score 26 h) are not running'' END AS observed',
  '2 h and 26 h: the post-publication second line is alive; it quarantines after publication and is NOT a preventive validator (PUB-STRUCTURE-ORDER-1 stays open, agent_issues 1000209)');
UPDATE control_registry SET alternate_path = 'qnfo-ai router downgrades every caller at an ai_spend cap (BUDGET-SOFT-ROUTE-1, a different worker from qnfo-research-exec); the cost thread owns holding spend near the 360000 target',
  evidence = COALESCE(evidence, '') || ' | SURVIVE-2 2026-11-04: measured spend 988k (11-02) and 997k (11-03) neurons against target 360k; the gate is steering, not a ceiling. The probe proves the gate evaluates only.',
  reviewed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE control = 'research-daily-neuron-gate' AND alternate_path IS NULL;
