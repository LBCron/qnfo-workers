-- SPOF-ALTERNATE-RAN-E-2 (2026-11-05, charter pillar autonomy; GitHub QNFO/qnfo-workers#5284; agent_issues 1000613 METRIC-REGRESSION-1 spofs_on_critical_path; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_spof_kg
-- Rollback: UPDATE spof_registry SET alternate_tested_at = (SELECT b.alternate_tested_at FROM bak_20261105_e_spof_kg b WHERE b.component = spof_registry.component), evidence = (SELECT b.evidence FROM bak_20261105_e_spof_kg b WHERE b.component = spof_registry.component), reviewed_at = (SELECT b.reviewed_at FROM bak_20261105_e_spof_kg b WHERE b.component = spof_registry.component) WHERE component = 'kg curator' AND EXISTS (SELECT 1 FROM bak_20261105_e_spof_kg b WHERE b.component = spof_registry.component)
-- CAUSE-MAPPED: no metric is registered here; this records one alternate-path run in spof_registry.
--
-- spofs_on_critical_path counts registered single points of failure whose alternate path has not run (alternate_tested_at empty). KG-CURATE-2 registered the row 'kg curator' at 2026-11-05T03:24:32Z with the
-- alternate "qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 sends repository_dispatch fleet-graph-tick and kg-curate.yml listens for it", and no one had sent it. It was exercised here, the way cloud-ops sends it:
--   * 2026-11-05T04:19:02Z: POST /repos/QNFO/qnfo-workers/dispatches with event_type fleet-graph-tick, repository token, HTTP 204.
--   * 04:19:05Z: GitHub started kg-curate run 41967048930 with event repository_dispatch; it completed success at 04:19:20Z and every step succeeded, including "Curate the knowledge graph".
--   * the same event started fleet-graph run 41967048971, cancelled by that workflow's own concurrency group because main took a newer push (its normal behaviour, not a failure of the path).
-- What this proves: the second trigger path starts the curator job and the job completes. It does not prove a full curation ran: the run lasted 15 seconds and whether the script skipped it as under 25 minutes
-- after the last good run was not read. The primary path (every push to main) runs the full curation. The other three untested rows are unchanged (qnfo-evolve cron, qnfo-agents cron, research publication
-- structural validation): their alternates need the loop token or a preventive second gate, see the note on the issue.

CREATE TABLE IF NOT EXISTS bak_20261105_e_spof_kg AS SELECT component, alternate_tested_at, evidence, reviewed_at FROM spof_registry WHERE component = 'kg curator';

UPDATE spof_registry
SET alternate_tested_at = '2026-11-05T04:19:05Z',
    evidence = COALESCE(evidence, '') || ' | SPOF-ALTERNATE-RAN-E-2 2026-11-05: repository_dispatch fleet-graph-tick sent with the repository token at 04:19:02Z (HTTP 204) started kg-curate run 41967048930 (event repository_dispatch, 04:19:05Z, completed success 04:19:20Z, all steps success including Curate the knowledge graph); the same event started fleet-graph run 41967048971, cancelled by its own concurrency group. Proves the second trigger path starts the job and the job completes; not read: whether the script skipped the curation as under 25 minutes after the last good run.',
    reviewed_at = '2026-11-05T04:19:20Z'
WHERE component = 'kg curator' AND alternate_tested_at IS NULL;
