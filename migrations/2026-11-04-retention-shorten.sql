-- RETENTION-SWEEP-1 (2026-11-04, pillar cost; owner: "table rows are bloated and need to be regularly swept").
-- Evidence: remediation_verifications takes about 15k rows a day (6.7k of them failing re-probes of the same issue classes) and carries 13 indexes,
-- so every row costs 13 index writes; cloud_ops_events housekeeping kinds are read for hours, not two weeks. Readers of remediation_verifications
-- look back at most 7 days (remediation_latest_pass_pct_7d, v_closure_relapses), so 8 days keeps every window whole.
-- Change: remediation_verifications 14 -> 8 days; cloud_ops_events housekeeping kinds 14 -> 5 days. Other deletes unchanged.
-- Revert: re-run migrations/2026-10-05-* history: recreate retention_prune_tick_v2 with '-14 days' in both statements (ops_config retention_prune = off stops all pruning at once).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS retention_prune_tick_v2; CREATE TRIGGER retention_prune_tick_v2 AFTER INSERT ON fleet_tick WHEN strftime('%M', 'now') < '10' AND COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off' BEGIN DELETE FROM remediation_verifications WHERE id IN (SELECT id FROM remediation_verifications INDEXED BY idx_remediation_verifications_ts WHERE verified_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days') LIMIT 5000); END;
-- BACKUP: remediation_verifications
-- CAUSE-MAPPED: registers no metric_registry row.

DROP TRIGGER IF EXISTS retention_prune_tick_v2;
CREATE TRIGGER retention_prune_tick_v2 AFTER INSERT ON fleet_tick
WHEN strftime('%M', 'now') < '10' AND COALESCE((SELECT value FROM ops_config WHERE key = 'retention_prune'), 'on') <> 'off'
BEGIN
  DELETE FROM cloud_ops_events WHERE id IN (SELECT id FROM cloud_ops_events INDEXED BY idx_coe_ts
    WHERE ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 days')
      AND kind IN ('ops_ai_tool','heartbeat','idle','done','claim','code-task.claim-held','code-task.intake','code-task.intake-exhausted','code-task.intake-waiting','revise-patch','revise-noop','review-triage','slop-scan','deploy-drift-cf','ai-warn','metric-write-audit','rerun-route','pdf-backlog','remediation.deferred','math-scan','advisor-audit','container.sh','container.exec','container.workspace_exec','container.git_clone')
    LIMIT 5000);
  DELETE FROM cloud_ops_events WHERE id IN (SELECT id FROM cloud_ops_events INDEXED BY idx_coe_ts
    WHERE ts < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days')
    LIMIT 5000);
  DELETE FROM remediation_verifications WHERE id IN (SELECT id FROM remediation_verifications INDEXED BY idx_remediation_verifications_ts
    WHERE verified_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')
    LIMIT 5000);
  DELETE FROM fleet_probe_log WHERE id IN (SELECT p.id FROM fleet_probe_log p INDEXED BY idx_fpl_ts
    WHERE p.ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-21 days')
      AND EXISTS (SELECT 1 FROM fleet_probe_log q INDEXED BY idx_fpl_name_transport_ts WHERE q.name = p.name AND q.transport = p.transport AND q.ts > p.ts)
    LIMIT 3000);
END;

UPDATE agent_issues SET description = description || ' STEP 1 SHIPPED (migrations/2026-11-04-retention-shorten.sql): remediation_verifications 14 to 8 days, cloud_ops_events housekeeping kinds 14 to 5 days. STEP 2: about 15k rows a day land in remediation_verifications, 6.7k of them failing re-probes of the same issue classes, each costing 13 index writes: write a row only when pass or observed changes, or once a day per class, and record last-probed time in a small table so the freshness views (issues_unprobed_60m) still see the probe.'
WHERE title LIKE 'RETENTION-SWEEP-1:%' AND status = 'open' AND description NOT LIKE '%STEP 1 SHIPPED%';
