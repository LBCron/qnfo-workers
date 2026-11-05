-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:rollback' WHERE class = 'rm-1757' AND module = 'roadmap-dod-v1'
-- The Rollback leaves the decision row: decision_log is append-only.
-- BACKUP: remediation_contracts
-- RM-1757-FM4-VERIFY-1 (2026-11-05, charter pillar autonomy; GitHub 5618 / roadmap_implementation 1757 FM-4 "Vacuous contracts: 190 issues closed on a probe that measures nothing (50 reopened). Replace the vacuous probe
-- with a measuring probe at issue-open time, starting with the METRIC-UNMEASURED-1 and CF-OBS-ISSUE-1 families, and report the vacuous share as a guard metric").
-- Built by migrations/2026-11-05-d2b-vacuous-marker-real-probe.sql (PR 7357, applied 2026-11-05T00:00:55Z, migration_runs 1271): the marker is cleared on probes that measure, step fm4-marker-sweep repeats it hourly, step
-- mi-unmeasured-probe writes a measuring action at birth, guard metric vacuous_probe_share is registered with an hourly producer (fm4-vacuous-share). Read live 2026-11-05T01:45Z: vacuous_probe_share 0.043 MEASURED at
-- 00:50:57Z (v_vacuous_probe_share read 138 of 514 = 0.268 before the sweep), detector fm-vacuous-marker-on-measuring-probe last_verdict pass, the contract of agent_issues 1000720 (no METRIC-UNMEASURED-1 or CF-OBS-ISSUE-1 issue on
-- a vacuous probe and the metric registered) last_verdict pass.
-- ROADMAP-BUILT-VERIFY-1 (migrations/2026-11-05-roadmap-built-verify.sql): qnfo-github-steward moves a built item to verified when its rm-<id> contract (module roadmap-dod-v1) reads a pass inside 240 minutes and closes the
-- GitHub mirror in the same tick. This file adds the contract for item 1757: the probe measures what the item claims, live: the guard metric is measured and fresh (3 hours), at most 0.15 of the open issues sit on a contract that
-- still carries the VACUOUS-PROBE marker, and no open METRIC-UNMEASURED-1 or CF-OBS-ISSUE-1 issue does. It fails when the sweep stops, when the metric goes stale, and when a doer reintroduces the marker on those two families.
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1757', NULL,
  'ROADMAP-BUILT-VERIFY-1: roadmap item FM-4 (id 1757) is built, deployed or implemented and waits for its closing probe',
  'FM-4 vacuous contracts: PR 7357 is on main (migration_runs 1271 ok); the marker sweep fm4-marker-sweep and the share step fm4-vacuous-share run hourly in management-personas-plus; vacuous_probe_share read 0.043 at 2026-11-05T00:50:57Z (0.268 before); the METRIC-UNMEASURED-1 birth step writes a measuring action; the contract of agent_issues 1000720 reads pass (read 2026-11-05)',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_registry WHERE metric = ''vacuous_probe_share'' AND state = ''MEASURED'' AND last_value GLOB ''[0-9]*'') THEN ''vacuous_probe_share is not measured'' WHEN datetime(COALESCE((SELECT last_refreshed FROM metric_registry WHERE metric = ''vacuous_probe_share''), ''1970-01-01'')) < datetime(''now'', ''-3 hours'') THEN ''vacuous_probe_share was not refreshed in 3 hours'' WHEN CAST((SELECT last_value FROM metric_registry WHERE metric = ''vacuous_probe_share'') AS REAL) > 0.15 THEN ''vacuous_probe_share is above 0.15'' WHEN EXISTS (SELECT 1 FROM agent_issues a JOIN remediation_contracts c ON c.class = ''issue-'' || a.id WHERE a.status = ''open'' AND c.status IN (''active'', ''holding'') AND c.action LIKE ''VACUOUS-PROBE%'' AND (a.title LIKE ''METRIC-UNMEASURED-1%'' OR a.title LIKE ''CF-OBS-ISSUE-1%'')) THEN ''a METRIC-UNMEASURED-1 or CF-OBS-ISSUE-1 issue still sits on a vacuous probe'' ELSE ''ok'' END AS observed',
  'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1757 AND item = 'FM-4' AND status IN ('built', 'deployed', 'implemented');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a roadmap item marked built stays open until a contract measures what it claims; the steward verifies and closes the mirror on that contract',
  'RM-1757-FM4-VERIFY-1: contract rm-1757 (module roadmap-dod-v1) measures the vacuous share guard metric, its freshness and the two flapping families',
  'live reads 2026-11-05T01:45Z: vacuous_probe_share 0.043 MEASURED (00:50:57Z); roadmap_implementation 1757 status built, verified_at NULL; contract of agent_issues 1000720 last_verdict pass; detector fm-vacuous-marker-on-measuring-probe last_verdict pass',
  'migration merged through the canonical path; no worker bundle changed',
  'one remediation_contracts row',
  'the Rollback header supersedes the contract; the decision row stays (append-only)',
  'item FM-4 reaches verified on a live measurement and its GitHub mirror closes through the steward, not by hand',
  'rm-1757 reads pass on its first verification (within 80 minutes of the apply); the steward verifies item 1757 and closes the mirror within 240 minutes',
  'none',
  'offline suite migrations/rm-1757-fm4-verify.test.mjs (the probe on ok, stale, above-threshold, unmeasured and flapping-family states; the insert only for a built item; replay; rollback)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-1757-FM4-VERIFY-1:%');
