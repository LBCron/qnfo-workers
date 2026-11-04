-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_d2b_unmeasured_contracts b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_d2b_unmeasured_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_d2b_unmeasured_contracts b WHERE b.class = remediation_contracts.class), attempts = (SELECT b.attempts FROM bak_20261105_d2b_unmeasured_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_d2b_unmeasured_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_d2b_unmeasured_contracts); DELETE FROM metric_unmeasured_exemptions WHERE metric_key IN ('youtube_avg_view_duration_s', 'plus_kept_share_30d'); DELETE FROM control_alternate_probes WHERE control IN ('metric-unmeasured-plus-kept-sample-floor', 'metric-unmeasured-youtube-owner-consent'); DELETE FROM control_registry WHERE control IN ('metric-unmeasured-plus-kept-sample-floor', 'metric-unmeasured-youtube-owner-consent'); DELETE FROM remediation_contracts WHERE class = 'fm-metric-seed-never-refreshed'; DELETE FROM failure_modes WHERE fm_key = 'metric-seed-never-refreshed'; UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261105_d2b_plus_task b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 'management-personas-plus' AND EXISTS (SELECT 1 FROM bak_20261105_d2b_plus_task)
-- The Rollback leaves the decision row: decision_log is append-only.
-- BACKUP: bak_20261105_d2b_unmeasured_contracts
-- METRIC-UNMEASURED-ROOT-1 (2026-11-05, charter pillar autonomy; GitHub 5685 / agent_issues 1000609 METRIC-UNMEASURED-1: qnfo-fleet-control, GitHub 5741 / agent_issues 1000745
-- METRIC-UNMEASURED-1: qnfo-youtube-shorts, GitHub 6040 / agent_issues 1001220 ROOT-CAUSE-1: METRIC-UNMEASURED-1 keeps recurring).
-- The managers' hourly audit (fleet_tasks management-personas-c, steps mi-unmeasured-*) files one METRIC-UNMEASURED-1 issue per owner whose enabled metric triggers hold no value
-- (metric_improvement_now verdict unmeasured, bp26 = 0), closes it the hour every one of them holds a value or carries a named exemption (metric_unmeasured_exemptions), and re-files it
-- when one reads NULL again (issue_refile_reopen then reopens the closed issue: 29 reopens across 14 issues in 7 days). Read live 2026-11-04T23:10Z, three metrics were unmeasured with
-- bp26 = 0 and each has a different cause, none of them a producer that "needs repair" in the sense of the filer's text:
--   plus_debt_oldest_weeks (qnfo-fleet-control)   PRODUCER MISSING. The registry formula is max(weeks_since_plus) from v_product_plus_debt, but no management-personas step writes it; the
--                                                 value is the seed string "seed: 0 (ledger has no shipped pluses yet)" from 2026-10-29, never refreshed (last_refreshed 2026-10-29 12:29). The view
--                                                 has the weeks_since_plus column (max 0 today). A step pl-debt-oldest is appended to management-personas-plus, the task that owns the pl-* steps
--                                                 (PLUS-OWN-TASK-1), and writes the number and refresh time from the view; it never writes a value by hand.
--   plus_kept_share_30d (qnfo-fleet-control)      SAMPLE FLOOR. pl-kept-metric writes NULL while plus_outcome_checks holds no mature seven-day check (0 rows on 2026-11-04, plus_ledger holds 2 proposed
--                                                 rows and none shipped). A valid floor, not a missing producer: a named exemption (ends_when: a mature check exists), the same shape as the BP26 floors.
--   youtube_avg_view_duration_s (qnfo-youtube-shorts)  OWNER CONSENT. qnfo-youtube-shorts reads retention every hour and is refused scope-missing (cloud_ops_events youtube.retention_scope, latest
--                                                 2026-11-04T22:00:43Z): the OAuth grant lacks youtube.readonly and yt-analytics.readonly. The consent is the owner's step on the owner's Google account
--                                                 (human_actions yt-analytics-consent, IDENTITY-BOUND, no session or loop can click it). A named exemption carries it; the owner card stays the single tracker.
-- The contracts: issue-1000609 measured only evolve_parse_pass_pct_7d (measured since 14:31Z) while the issue is the owner-wide one, so it passed and still never closed (reopened_count 3 plus
-- the VACUOUS-PROBE marker still on its action, which the autoclose trigger reads as a placeholder). issue-1000745 counted the youtube metric without the bp26 filter the filer itself uses,
-- so a named exemption could never make it pass. Both now return the literal ok from the same condition the filer's own close step uses (owner, bp26 = 0, verdict unmeasured). issue-1001220's
-- probe counted every registry metric with no metric_history row (17 today, most of them exempt), so it could not reach 0; it gets the family-quiet probe its sibling ROOT-CAUSE-1 tickets carry
-- (copied from issue-1001522 with the id replaced): no opened or reopened issue of the family in 24 hours and the ticket older than 24 hours.
-- Prediction: after the apply and one management-personas-plus (:50) and one metric_improvement_now (:42) pass, metric_improvement_now holds no unmeasured row with bp26 = 0 for either
-- owner, the filer's close step closes 1000609 and 1000745 with evidence, and no METRIC-UNMEASURED-1 issue is opened or reopened for 24 hours (the family-quiet probe of 1001220).
-- Falsified if plus_debt_oldest_weeks stays NULL after the next :50 run or any owner's unmeasured count rises.
-- CAUSE-MAPPED: no metric is registered here.

CREATE TABLE IF NOT EXISTS bak_20261105_d2b_unmeasured_contracts AS
  SELECT class, verify_probe, action, module, attempts, last_verdict, next_due_at
    FROM remediation_contracts WHERE class IN ('issue-1000609', 'issue-1000745', 'issue-1001220');

CREATE TABLE IF NOT EXISTS bak_20261105_d2b_plus_task AS
  SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas-plus';

INSERT OR IGNORE INTO metric_unmeasured_exemptions (metric_key, reason, ends_when, doer) VALUES
  ('youtube_avg_view_duration_s',
   'qnfo-youtube-shorts reads retention every hour and is refused scope-missing (cloud_ops_events youtube.retention_scope): the OAuth grant behind YT_REFRESH_TOKEN lacks youtube.readonly and yt-analytics.readonly. The consent is the owner step on the owner Google account (human_actions yt-analytics-consent, IDENTITY-BOUND); no session or loop can click it',
   'youtube_videos holds an avg_view_duration_s for an uploaded Short and the producer writes a number',
   'qnfo-youtube-shorts'),
  ('plus_kept_share_30d',
   'producer pl-kept-metric (management-personas-plus) writes NULL while plus_outcome_checks holds no mature seven-day check (0 rows on 2026-11-04; plus_ledger holds 2 proposed rows and none shipped); a valid sample floor, not a missing producer',
   'plus_outcome_checks holds a mature seven-day outcome check and the producer writes a number',
   'qnfo-fleet-control');

-- plus_debt_oldest_weeks: the producer step. Appended once to the task that owns the pl-* steps; it writes only when the view has rows.
UPDATE fleet_tasks
SET definition = json_insert(definition, '$.steps[#]', json_object(
      'type', 'sql', 'name', 'pl-debt-oldest', 'db', 'AUDIT',
      'sql', 'UPDATE metric_registry SET last_value = CAST((SELECT MAX(weeks_since_plus) FROM v_product_plus_debt) AS TEXT), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric = ''plus_debt_oldest_weeks'' AND EXISTS (SELECT 1 FROM v_product_plus_debt)')),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus'
  AND instr(definition, '"pl-debt-oldest"') = 0;

-- Contracts: the owner-wide condition of the filer's own close step.
UPDATE remediation_contracts SET
  verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_improvement_now WHERE verdict = ''unmeasured'' AND bp26 = 0 AND owner = ''qnfo-fleet-control''',
  verify_transport = 'd1-query', status = 'active', module = 'metric-unmeasured-owner-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
  action = 'MEASURES the issue: every enabled metric trigger owned by qnfo-fleet-control holds a value or carries a named exemption (metric_improvement_now, bp26 = 0, verdict unmeasured), the condition the management-personas close step uses. METRIC-UNMEASURED-ROOT-1.'
WHERE class = 'issue-1000609' AND issue_id = 1000609;

UPDATE remediation_contracts SET
  verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM metric_improvement_now WHERE verdict = ''unmeasured'' AND bp26 = 0 AND owner = ''qnfo-youtube-shorts''',
  verify_transport = 'd1-query', status = 'active', module = 'metric-unmeasured-owner-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
  action = 'MEASURES the issue: every enabled metric trigger owned by qnfo-youtube-shorts holds a value or carries a named exemption (metric_improvement_now, bp26 = 0, verdict unmeasured). The consent that makes youtube_avg_view_duration_s measurable is the IDENTITY-BOUND owner card yt-analytics-consent. METRIC-UNMEASURED-ROOT-1.'
WHERE class = 'issue-1000745' AND issue_id = 1000745;

UPDATE remediation_contracts SET
  verify_probe = replace((SELECT s.verify_probe FROM remediation_contracts s WHERE s.class = 'issue-1001522'), 'a.id = 1001522', 'a.id = 1001220'),
  verify_transport = 'd1-query', status = 'active', module = 'root-cause-probe-at-birth-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
  action = 'MEASURES the closing condition of this ticket: its issue family (METRIC-UNMEASURED-1) has had no opened or reopened issue for 24 hours and the ticket is older than 24 hours. The management-personas workflow closes the ticket on the same condition (step rc-close). METRIC-UNMEASURED-ROOT-1 replaces a probe that counted exempt metrics and could not reach 0.'
WHERE class = 'issue-1001220' AND issue_id = 1001220
  AND instr((SELECT s.verify_probe FROM remediation_contracts s WHERE s.class = 'issue-1001522'), 'a.id = 1001522') > 0;

-- The two exemptions are filters: each gets a control_registry row (kind filter, disposition keep, not on the critical path) and an alternate probe that fails when the exemption is
-- missing, when an empty sample is treated as a missing producer, or when an exemption masks a numeric value (the shape of metric-unmeasured-ask-plain-sample-floor).
INSERT OR IGNORE INTO control_registry
  (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence, issue_id)
VALUES
  ('metric-unmeasured-plus-kept-sample-floor',
   'qnfo-audit.metric_unmeasured_exemptions.plus_kept_share_30d; management-personas mi-snapshot',
   'filter', 'false missing-producer issues while plus_kept_share_30d has no mature seven-day outcome check', 0, 'keep', 'applied',
   'pl-kept-metric writes a numeric value once plus_outcome_checks holds a mature check; the enabled metric trigger then evaluates it normally',
   'METRIC-UNMEASURED-ROOT-1: the named exemption applies only while the value is absent. plus_outcome_checks holds 0 rows on 2026-11-04 and plus_ledger no shipped plus; metric_improvement_now read the metric unmeasured with bp26 = 0 and the managers filed it for qnfo-fleet-control.',
   1000609),
  ('metric-unmeasured-youtube-owner-consent',
   'qnfo-audit.metric_unmeasured_exemptions.youtube_avg_view_duration_s; management-personas mi-snapshot',
   'filter', 'false missing-producer issues while youtube_avg_view_duration_s waits for the owner OAuth consent', 0, 'keep', 'applied',
   'the owner card human_actions yt-analytics-consent (IDENTITY-BOUND) stays open and is the single tracker; qnfo-youtube-shorts reads retention hourly and the metric reads a number the hour the grant covers youtube.readonly and yt-analytics.readonly',
   'METRIC-UNMEASURED-ROOT-1: the named exemption applies only while the value is absent. cloud_ops_events youtube.retention_scope reads scope-missing every hour (2026-11-04T22:00:43Z); the producer is healthy and the consent is the owner step.',
   1000745);

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
  ('metric-unmeasured-plus-kept-sample-floor',
   'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_unmeasured_exemptions WHERE metric_key = ''plus_kept_share_30d'') THEN ''named sample-floor exemption is missing'' WHEN NOT EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''plus_kept_share_30d'') THEN ''management snapshot is missing'' WHEN EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''plus_kept_share_30d'' AND verdict = ''unmeasured'' AND COALESCE(bp26, 0) <> 1) THEN ''empty sample is treated as a missing producer'' WHEN EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''plus_kept_share_30d'' AND val IS NOT NULL AND (COALESCE(bp26, 1) <> 0 OR verdict = ''unmeasured'')) THEN ''numeric value is exempted or unmeasured'' ELSE ''ok'' END AS observed',
   'Hourly: a NULL sample is exempt only from missing-producer filing; a numeric value stays visible to the enabled trigger. METRIC-UNMEASURED-ROOT-1.', 1),
  ('metric-unmeasured-youtube-owner-consent',
   'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM metric_unmeasured_exemptions WHERE metric_key = ''youtube_avg_view_duration_s'') THEN ''named owner-consent exemption is missing'' WHEN NOT EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''youtube_avg_view_duration_s'') THEN ''management snapshot is missing'' WHEN EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''youtube_avg_view_duration_s'' AND verdict = ''unmeasured'' AND COALESCE(bp26, 0) <> 1) THEN ''owner-gated NULL is treated as a missing producer'' WHEN EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''youtube_avg_view_duration_s'' AND val IS NOT NULL AND (COALESCE(bp26, 1) <> 0 OR verdict = ''unmeasured'')) THEN ''numeric value is exempted or unmeasured'' WHEN NOT EXISTS (SELECT 1 FROM human_actions WHERE slug = ''yt-analytics-consent'' AND resolved_at IS NULL) AND EXISTS (SELECT 1 FROM metric_improvement_now WHERE metric_key = ''youtube_avg_view_duration_s'' AND val IS NULL) THEN ''the owner card yt-analytics-consent is missing or resolved while the metric is still unmeasured'' ELSE ''ok'' END AS observed',
   'Hourly: the exemption holds only while the value is absent and the IDENTITY-BOUND owner card is open. METRIC-UNMEASURED-ROOT-1.', 1);

-- Failure mode: a registry metric whose value is a seed string that no producer ever refreshes (plus_debt_oldest_weeks held "seed: 0 ..." for 6 days).
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('metric-seed-never-refreshed',
   'a registered metric keeps its seed string because no workflow step writes it',
   'the metric was registered with a seed value and a source_of_truth view, but the producer step was never added to a management-personas task; the seed reads as unmeasured once it fails to parse as a number',
   'METRIC-UNMEASURED-ROOT-1: step pl-debt-oldest writes plus_debt_oldest_weeks from v_product_plus_debt; fm-metric-seed-never-refreshed counts any metric still on a seed string two days after its last refresh',
   'd1-query count of metric_registry rows whose last_value starts with seed and whose last_refreshed is older than two days',
   'fm-metric-seed-never-refreshed', '2026-11-05', 1000609,
   'a metric is registered with a seed last_value and no step or trigger refreshes it',
   'METRIC-UNMEASURED-1 is filed for the owner every hour while the seed string is read as no value',
   'plus_debt_oldest_weeks (qnfo-fleet-control) and the manager audit that files and re-opens the owner issue');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to) VALUES
  ('fm-metric-seed-never-refreshed', NULL,
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM metric_registry WHERE last_value LIKE ''seed%'' AND datetime(COALESCE(last_refreshed, ''1970-01-01'')) < datetime(''now'', ''-2 days'')) AS TEXT) AS observed',
   'd1-query', 3, 1, 'active', 'METRIC-UNMEASURED-ROOT-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'an unmeasured metric has one of three causes (producer missing, sample floor, owner consent); each gets its own repair, and an exemption names the doer and the end condition instead of leaving the filer to re-open the same issue hourly',
  'METRIC-UNMEASURED-ROOT-1: step pl-debt-oldest produces plus_debt_oldest_weeks from v_product_plus_debt; named exemptions for plus_kept_share_30d (sample floor) and youtube_avg_view_duration_s (owner consent card yt-analytics-consent); the contracts of issue-1000609, issue-1000745 and issue-1001220 measure the owner-wide and family-quiet conditions',
  'live reads 2026-11-04T23:10Z: metric_improvement_now unmeasured rows with bp26 = 0: youtube_avg_view_duration_s, plus_debt_oldest_weeks (last_value seed string, last_refreshed 2026-10-29), plus_kept_share_30d (plus_outcome_checks 0 rows); cloud_ops_events youtube.retention_scope scope-missing hourly; agent_issues 1000609 reopened_count 3 with a VACUOUS-PROBE action marker on a contract that measures a single measured metric; issue-1001220 probe observed 17 against expected 0',
  'migration merged through the canonical path; management-personas-plus gains one step; no worker bundle changed',
  'fleet_tasks management-personas-plus (one appended step), two metric_unmeasured_exemptions rows, three remediation_contracts rows',
  'the Rollback header restores the contracts and the task definition from the backup tables and deletes the two exemption rows; the decision row stays (append-only)',
  'the managers stop re-filing METRIC-UNMEASURED-1 for metrics whose cause is a sample floor or an owner consent, and plus_debt_oldest_weeks gets a producer',
  'plus_debt_oldest_weeks holds a number after the next management-personas-plus run (:50); the filer closes 1000609 and 1000745 within two hourly passes; no METRIC-UNMEASURED-1 issue is opened or reopened for 24 hours, so issue-1001220 reads pass',
  'none',
  'offline suite migrations/d2b-metric-unmeasured-root.test.mjs (the step runs on sqlite against the live view shape, the snapshot verdict flips to bp26 = 1 for the exempt metrics, the three probes read ok and a named reason); live reads of metric_improvement_now, cloud_ops_events and v_product_plus_debt'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'METRIC-UNMEASURED-ROOT-1:%');
