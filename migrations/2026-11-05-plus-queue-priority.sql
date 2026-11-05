-- PLUS-QUEUE-PRIORITY-1 (2026-11-05, charter pillar autonomy and reach; cluster reach-q08-plus; metrics plus_shipped_7d, product_plus_rate_7d, plus_keep_rate_30d; agent_issues 1001004).
-- Evidence (qnfo-audit, read 2026-11-05 03:40Z): after PLUS-LEDGER-STATUS-1 (the CHECK, PR 7345) and PLUS-REGISTRY-SLUG-1 (PR 7512) management-personas-plus runs ok again (fleet_runs 70400, 70588, 70773), but the loop still ships
-- nothing, for three further reasons that the first two fixes uncovered:
--   1. QUEUE STARVATION. pl-research files its request at priority 'medium'. qnfo-agents drains critical, then high, then medium, then low, each by id (index.ts: ORDER BY CASE priority ...), under a daily neuron budget
--      (QNFO-AGENTS-BUDGET-1, 250000) and sheds a request it could not start after 110 minutes. In the last 24 h the queue served 15 critical, 75 high and 41 medium probe runs, 8 doers and 15 levers while the three plus requests
--      of 2026-11-05 (cf_agent_requests 2495 to 2497, filed 00:50Z) waited 110 minutes at 'medium' and were shed: "shed: waited over 110 minutes under the daily neuron budget". Only 3 plus requests a day are ever filed
--      (product_plus_daily_cap 3), about 7,500 neurons, 3 percent of that budget, so priority 'high' (the level of the doers) costs the budget nothing it was not already spending on lower-value probe runs.
--   2. A SHED REQUEST SPENDS THE DAY. The daily cap counts every plus request of the UTC day, including the ones the queue shed without running a model (attempts 0, no spend): the three shed requests used the whole cap of
--      2026-11-05, so no plus request could be filed again until 2026-11-06. The cap counts requests that were not shed now. The spend bound is unchanged: at most 3 requests that reached the queue's worker a day.
--   3. AN UNUSABLE ANSWER SPENDS THE PRODUCT'S DAY. A 'done' request whose result is only a preface ("I'll start by reading the dashboard worker from the user's side.", requests 2371 and 2372 of 2026-11-04) counted as the product's
--      answer for the day, so the product was not asked again and no proposal could be parsed from it (rm-parse needs TITLE:). A done request counts as the answer only when it carries a TITLE: line.
-- Two more defects of the same loop, found while reading it:
--   4. plus_ledger id 1 is the 2026-10-29 legacy PLUS-1 row for companion-today ("Migrated from the legacy product plus ledger"): status 'proposed' for 7 days with no issue, no proposal and no build, so v_product_plus_due
--      shows in_flight 1 for companion-today and pl-research never asks about it. It is set to 'rejected' (superseded) with its reason; the table keeps the row.
--   5. plus_keep_rate_30d reads 0.0 with no verdict at all (pl-plus-keep-rate divides kept by MAX(1, kept + reverted)), so a metric that cannot be judged until a plus has been deployed and checked after seven days is
--      judged as a breach today. The sibling plus_kept_share_30d already says UNMEASURED (NULL) with no verdict; this step does the same. The reading returns the moment the first plus is kept or reverted, and a real
--      0.0 (all reverted) still breaches.
-- The failure mode and its detector (fm-plus-requests-unanswered) are registered in the same file.
-- Change: four independent UPDATEs of management-personas-plus (each replaces one text and raises the version by one, and runs only while its old text is present, so an unrelated edit of the step by another file cannot stop the others and a replay does nothing), one UPDATE of plus_ledger id 1, one decision_log row.
-- PREDICTION: at the next management-personas-plus tick (:50) three requests roadmap-%-plus-%-20261105 appear with priority 'high' although three shed ones exist today, and at least 2 of the 3 reach 'done' with a TITLE: line
-- within 3 hours (11-05: 0 of 3; 11-04: 1 of 3 usable); plus_keep_rate_30d reads UNMEASURED (no hit) after the same tick; companion-today leaves in_flight 0. plus_shipped_7d and product_plus_rate_7d stay 0 until the first plus is
-- deployed (jobs, issue 1001801, is in build); they move only when each product has one, which needs the 3-a-day cap to run for 3 days.
-- Check: SELECT instance, priority, status, substr(result,1,40) FROM cf_agent_requests WHERE instance LIKE 'roadmap-%-plus-%-20261105' ORDER BY id; SELECT last_value, state FROM metric_registry WHERE metric = 'plus_keep_rate_30d';
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_plus_queue
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261105_plus_queue WHERE id = 'management-personas-plus'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 'management-personas-plus' AND EXISTS (SELECT 1 FROM bak_20261105_plus_queue WHERE id = 'management-personas-plus'); UPDATE plus_ledger SET status = 'proposed', outcome = NULL, decided_at = '2026-10-29 12:29:00' WHERE id = 1 AND status = 'rejected' AND outcome LIKE 'superseded: legacy%';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_plus_queue AS SELECT id, definition FROM fleet_tasks WHERE id = 'management-personas-plus';

-- edit 1 of 4
UPDATE fleet_tasks
SET definition = replace(definition,
    'strftime(''%Y%m%d'', ''now''), ''medium'' FROM v_product_plus_due d JOIN',
    'strftime(''%Y%m%d'', ''now''), ''high'' FROM v_product_plus_due d JOIN'),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus' AND instr(definition, 'strftime(''%Y%m%d'', ''now''), ''medium'' FROM v_product_plus_due d JOIN') > 0;

-- edit 2 of 4
UPDATE fleet_tasks
SET definition = replace(definition,
    'q.instance LIKE ''roadmap-%-plus-%-'' || strftime(''%Y%m%d'', ''now'')) < COALESCE(',
    'q.instance LIKE ''roadmap-%-plus-%-'' || strftime(''%Y%m%d'', ''now'') AND COALESCE(q.error, '''') NOT LIKE ''shed:%'') < COALESCE('),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus' AND instr(definition, 'q.instance LIKE ''roadmap-%-plus-%-'' || strftime(''%Y%m%d'', ''now'')) < COALESCE(') > 0;

-- edit 3 of 4
UPDATE fleet_tasks
SET definition = replace(definition,
    '(q.status = ''done'' AND COALESCE(q.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(q.result, '''') <> '''')',
    '(q.status = ''done'' AND COALESCE(q.result, '''') LIKE ''%TITLE:%'')'),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus' AND instr(definition, '(q.status = ''done'' AND COALESCE(q.result, '''') NOT LIKE ''(the model returned no text)%'' AND COALESCE(q.result, '''') <> '''')') > 0;

-- edit 4 of 4
UPDATE fleet_tasks
SET definition = replace(definition,
    'last_value = CAST(ROUND(1.0 * (SELECT COUNT(*) FROM plus_ledger WHERE status = ''kept'' AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')) / MAX(1, (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''kept'', ''reverted'') AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days''))), 3) AS TEXT), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric = ''plus_keep_rate_30d''',
    'last_value = CASE WHEN (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''kept'', ''reverted'') AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')) = 0 THEN NULL ELSE CAST(ROUND(1.0 * (SELECT COUNT(*) FROM plus_ledger WHERE status = ''kept'' AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')) / (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''kept'', ''reverted'') AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')), 3) AS TEXT) END, last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = CASE WHEN (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''kept'', ''reverted'') AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')) = 0 THEN ''UNMEASURED'' ELSE ''MEASURED'' END WHERE metric = ''plus_keep_rate_30d'''),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus' AND instr(definition, 'last_value = CAST(ROUND(1.0 * (SELECT COUNT(*) FROM plus_ledger WHERE status = ''kept'' AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days'')) / MAX(1, (SELECT COUNT(*) FROM plus_ledger WHERE status IN (''kept'', ''reverted'') AND decided_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-30 days''))), 3) AS TEXT), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric = ''plus_keep_rate_30d''') > 0;

UPDATE plus_ledger
SET status = 'rejected',
    outcome = 'superseded: legacy 2026-10-29 PLUS-1 row for companion-today, never filed as an issue or built; the plus loop asks the product manager for a fresh plus (PLUS-QUEUE-PRIORITY-1)',
    decided_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
WHERE id = 1 AND status = 'proposed' AND issue_id IS NULL AND evidence = 'Migrated from the legacy product plus ledger';

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('plus-requests-unanswered',
   'products are due a plus but no plus request is answered with a proposal, so plus_shipped_7d, product_plus_rate_7d and plus_keep_rate_30d stay at zero',
   'pl-research filed its request at priority medium behind high-priority probe runs under the qnfo-agents daily neuron budget, the queue shed it after 110 minutes, and the shed request still used the day''s request cap; a preface-only answer used the product''s day',
   'PLUS-QUEUE-PRIORITY-1: priority high, the cap counts requests the queue did not shed, a done request counts only with a TITLE: line; fm-plus-requests-unanswered reads the answers',
   'd1-query over cf_agent_requests instance roadmap-%-plus-%: a request done with a TITLE: line in the last 24 hours while products are due with nothing in flight',
   'fm-plus-requests-unanswered', '2026-11-05', 1001004,
   'the qnfo-agents drain is limited by its daily budget and a day''s probe runs are served first',
   'plus_ledger holds two rows, cf_agent_requests plus rows failed "shed: waited over 110 minutes", every product shows hours_since_plus above its cadence',
   'plus_shipped_7d, product_plus_rate_7d, plus_keep_rate_30d and the weekly plus of every active product');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to) VALUES
  ('fm-plus-requests-unanswered', NULL,
   'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM v_product_plus_due WHERE in_flight = 0) = 0 THEN ''ok'' WHEN (SELECT COUNT(*) FROM cf_agent_requests WHERE instance LIKE ''roadmap-%-plus-%'' AND status = ''done'' AND result LIKE ''%TITLE:%'' AND created_at >= strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''ok'' ELSE ''no plus request answered with a TITLE line in 24 hours while '' || (SELECT COUNT(*) FROM v_product_plus_due WHERE in_flight = 0) || '' products are due'' END AS observed',
   'd1-query', 3, 1, 'active', 'PLUS-QUEUE-PRIORITY-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session (breach-reach-q08-plus)',
  'a plus request that is shed unrun must not use the day''s request cap, a preface-only answer must not use the product''s day, plus requests belong at the priority of the doers, and a ratio with no verdict is unmeasured, not zero',
  'PLUS-QUEUE-PRIORITY-1: pl-research files at priority high, counts only requests the queue did not shed against product_plus_daily_cap, counts a done request only when it carries a TITLE: line; pl-plus-keep-rate reads UNMEASURED with no kept or reverted plus; legacy plus_ledger row 1 set to rejected (superseded)',
  'cf_agent_requests 2495 to 2497 (2026-11-05 00:50Z) failed "shed: waited over 110 minutes under the daily neuron budget" at medium priority with 75 high and 41 medium probe runs served in 24 h; requests 2371 and 2372 (2026-11-04) done with a preface only; plus_ledger holds 2 rows (one legacy proposed since 2026-10-29); plus_keep_rate_30d 0.0 with no verdict',
  'pending', 'management-personas-plus only: at most product_plus_daily_cap (3) plus requests a day, no spend cap, guard or probe changed; the legacy ledger row stays in the table as rejected',
  'the Rollback header of migrations/2026-11-05-plus-queue-priority.sql, or ops_config product_plus = off',
  'the plus loop keeps asking each day until a usable proposal exists, and is served ahead of probe chatter',
  'three plus requests filed at the next :50 tick at priority high although three shed ones exist today; at least 2 of 3 done with a TITLE: line within 3 hours; plus_keep_rate_30d UNMEASURED',
  'more of the nine products receive a plus each week (jobs, travel, companion-today, fleet-dashboard, papers, research-gateway, q08-home, shorts-channel)',
  'node:sqlite replay in migrations/plus-queue-priority.test.mjs; d1:qnfo-audit fleet_tasks, cf_agent_requests and metric_registry after the next :50 tick'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'PLUS-QUEUE-PRIORITY-1:%');
