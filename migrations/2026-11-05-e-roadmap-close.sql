-- ROADMAP-CLOSE-E-1 (2026-11-05, charter pillar autonomy; GitHub QNFO/qnfo-workers#5617 (roadmap_implementation 1756 FM-3) and #5791 (agent_issues 1000891 CF-CHANGELOG-1 DNS); cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_roadmap_close
-- Rollback: UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'roadmap' AND b.k = '1756'), evidence = (SELECT b.v FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'roadmap' AND b.k = '1756') WHERE id = 1756 AND EXISTS (SELECT 1 FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'roadmap' AND b.k = '1756'); UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:rollback' WHERE class = 'rm-1756'; UPDATE cloudflare_capability_catalog SET status = (SELECT b.status FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'catalog' AND b.k = 'dns'), linked_issue = CAST((SELECT b.v FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'catalog' AND b.k = 'dns') AS INTEGER), when_to_choose = (SELECT b.w FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'catalog' AND b.k = 'dns') WHERE slug = 'dns' AND EXISTS (SELECT 1 FROM bak_20261105_e_roadmap_close b WHERE b.kind = 'catalog' AND b.k = 'dns')
-- CAUSE-MAPPED: no metric is registered here; this edits one roadmap row, one catalog row and adds one rm- contract.
--
-- (1) FM-3 (roadmap_implementation 1756, GitHub #5617): "Close-on-single-pass with no dwell for real probes ... add a stability dwell (continuous passes over N hours) to the trigger for issues with
--     reopened_count >= 2, measure first with a shadow count". That is RELAPSE-HOLD-1, live since 2026-11-04 17:06Z (PR 7031, migration_runs 1149; PR 7065 measurement, run 1154; PR 7120 lag-free reading):
--     v_issue_close_hold holds a closing pass for 120 minutes after 3 or more reopens, 60 after one or two and 20 for a family in issue_recurrence_now, and remediation_verification_autoclose_ins and _upd read it,
--     so a pass closes an issue only when the passes since its last reopen and last failure span the hold. The shadow count is v_relapse_6h_cohort. Read 2026-11-05 01:30Z:
--     before the hold 417 of 1,347 closes relapsed within 6 hours (0.310), after it 4 of 47 (0.085; small n, the keep-or-revert rule on agent_issues 1001754 needs 150 closes and fires on 2026-11-05T17:16Z).
--     The roadmap row is marked built with that evidence and gets the rm- contract the steward (psBuiltVerify, ROADMAP-BUILT-VERIFY-1) verifies it from; the mirror closes with the proof text.
-- (2) CF-CHANGELOG-1 DNS (agent_issues 1000891, GitHub #5791): the Cloudflare changelog item is the dashboard's "new DNS records experience" becoming the default and the classic records page being retired.
--     The fleet never edits DNS records in the dashboard: every record it owns is written by a REST script (scripts/attach-ask-qwav-route.py, attach-jobs-q08-route.py, attach-lifecycle-custom-domain.py,
--     attach-me-q08-route.py, attach-mind-q08-route.py, attach-surface-routes.py, attach-travel-host.py, attach-watch-q08-route.py call /zones/<id>/dns_records with the repository token), so a retired
--     dashboard page changes no code, route or token. Decision: adopted, nothing to migrate (the status vocabulary the issue's probe accepts is adopted, migrated, rejected or superseded), with that reason in the catalog row, linked to this issue; the row already carries its metric_ref (orphan probes count).
--     The probe of 1000891 reads exactly this: a catalog row for the item's slug that is decided, linked to the issue, with a metric_ref.

CREATE TABLE IF NOT EXISTS bak_20261105_e_roadmap_close (kind TEXT NOT NULL, k TEXT NOT NULL, status TEXT, v TEXT, w TEXT, PRIMARY KEY (kind, k));
INSERT OR IGNORE INTO bak_20261105_e_roadmap_close (kind, k, status, v) SELECT 'roadmap', CAST(id AS TEXT), status, evidence FROM roadmap_implementation WHERE id = 1756;
INSERT OR IGNORE INTO bak_20261105_e_roadmap_close (kind, k, status, v, w) SELECT 'catalog', slug, status, CAST(linked_issue AS TEXT), when_to_choose FROM cloudflare_capability_catalog WHERE slug = 'dns';

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'RELAPSE-HOLD-1 (PR 7031 migrations/2026-11-04-relapse-hold-1.sql migration_runs 1149 ok 2026-11-04T17:06Z, PR 7065 measure run 1154, PR 7120 v_relapse_6h_cohort): v_issue_close_hold dwell (120 min after 3+ reopens, 60 after 1-2, 20 for a recurring family) read by remediation_verification_autoclose_ins/_upd; shadow count v_relapse_6h_cohort: relapse within 6 h before 417/1347 (0.310), after 4/47 (0.085, small n) read 2026-11-05; keep-or-revert rule on agent_issues 1001754.'
WHERE id = 1756 AND item = 'FM-3' AND status = 'planned';

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1756', NULL, 'ROADMAP-BUILT-VERIFY-1: roadmap item FM-3 (id 1756) is built, deployed or implemented and waits for its closing probe',
 'FM-3 stability dwell before an autoclose: RELAPSE-HOLD-1 (migration_runs 1149 and 1154 ok) makes both autoclose triggers read v_issue_close_hold (120 min after 3+ reopens, 60 after 1-2, 20 for a recurring family); the shadow count v_relapse_6h_cohort reads relapse within 6 h of a close 0.310 before the hold and 0.085 after it (read 2026-11-05, n = 47 after)',
 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM migration_runs WHERE id IN (1149, 1154) AND status = ''ok'') = 2 AND (SELECT COUNT(*) FROM sqlite_master WHERE type = ''view'' AND name IN (''v_issue_close_hold'', ''v_relapse_6h_cohort'', ''v_issue_relapse_7d'')) = 3 AND (SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name IN (''remediation_verification_autoclose_ins'', ''remediation_verification_autoclose_upd'') AND instr(sql, ''v_issue_close_hold'') > 0) = 2 AND (SELECT COUNT(*) FROM ops_config WHERE key = ''relapse_close_hold'' AND lower(value) = ''off'') = 0 THEN ''ok'' ELSE ''the close hold is missing or switched off: migrations, three views, two autoclose triggers reading v_issue_close_hold, or ops_config relapse_close_hold = off'' END AS observed',
 'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1756 AND item = 'FM-3' AND status IN ('built', 'deployed', 'implemented');

UPDATE cloudflare_capability_catalog
SET status = 'adopted', linked_issue = 1000891,
    when_to_choose = COALESCE(when_to_choose, '') || ' | CF-CHANGELOG-1 2026-11-05 (agent_issues 1000891): adopted, nothing to migrate. The changelog item is the dashboard DNS records page: the new experience became the default for all plans and the classic page was retired. The fleet writes every DNS record it owns through the REST API with the repository token (scripts/attach-*.py call /zones/<id>/dns_records), never through the dashboard, so no code, route or token changes and the new default is picked up by whoever opens the dashboard.',
    last_synced = datetime('now')
WHERE slug = 'dns' AND instr(COALESCE(when_to_choose, ''), 'CF-CHANGELOG-1 2026-11-05') = 0;
