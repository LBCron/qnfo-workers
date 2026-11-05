-- DATA-SPINE-LAKE-1-BUILT (2026-11-05, charter pillars reliability and cost, program QNFO.INFRA; roadmap row 3258 RM-BS-DATA-SPINE-1): row 3258 to partial with what was read live, and a detector for a drift check that goes silent.
-- Slice 1 merged as PR 7716 (migrations/2026-11-05-data-spine-lake-1.sql applied 04:25:57Z, qnfo-infra 1.14.0-lake-spine live at 04:27Z). Read live after the deploy (D1 qnfo-audit and Basin SQL, 2026-11-05):
--   04:31:54Z first fire: lake_spine_state cursor 367,438 -> 380,475, rows_sent 13,037 in 27 batches, last_error NULL (the secrets-store token has the Pipelines send scope);
--   04:33Z Basin SQL: count(*) = count(DISTINCT id) = 13,037 for id >= 367,439 (300 older rows sent by hand are outside the range);
--   complete day 2026-11-04: D1 10,806 rows with id sum 4,028,925,249; lake 10,806 distinct ids with the same sum, read by hand at 04:34Z and by the worker's own drift check at 05:32:00Z
--   (lake_spine_drift verdict ok, missing 0, duplicates 0, bytes_scanned 104,630: the token also has the Basin SQL read scope);
--   05:31:54Z second fire: 503 more rows, rows_sent 13,540, cursor 380,978, last_error NULL.
-- WHAT THIS ADDS BESIDES THE ROW: fm-lake-spine-drift-silent. fm-lake-spine-stalled watches the copy and fm-lake-spine-drift watches a bad reading, but nothing watches the reading never being taken (a token that loses the Basin SQL scope
-- makes lakeDriftTick throw into the fire's error list, which only Workers Logs hold). The contract reads 1 when the copy has been on for 36 hours and the newest drift row is older than 36 hours or absent (a normal gap is 25 hours: a day is checked on the first fire at least an hour after it ends).
-- PREDICTION: the new contract reads 0 until 2026-11-07 and keeps reading 0 while the daily check runs; falsifier: it reads 1 with last_error NULL, which means the check threw (read Workers Logs for "lake spine").
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'planned', evidence = 'docs/BLUE-SKY-ROADMAP-2026-11.md', verified_at = NULL WHERE id = 3258 AND item = 'RM-BS-DATA-SPINE-1'; UPDATE remediation_contracts SET status = 'retired' WHERE class = 'fm-lake-spine-drift-silent';
-- CAUSE-MAPPED: registers no metric_registry row; the failure-mode contract fm-lake-spine-drift-silent is the alarm.

UPDATE roadmap_implementation
SET status = 'partial',
    evidence = 'PARTIAL, slice 1 of B2 built and read live 2026-11-05 (PR 7716, qnfo-infra 1.14.0-lake-spine, migration 2026-11-05-data-spine-lake-1.sql): fleet_probe_log is copied hourly to the Iceberg table telemetry.fleet_probe_log (Pipelines stream telemetry_fleet_probe_log_stream -> R2 Data Catalog, bucket qnfo-audit) and checked daily against D1. Live: first fire 04:31Z sent 13,037 rows in 27 batches, the 05:31Z fire 503 more (lake_spine_state rows_sent 13,540, cursor 380,978, last_error NULL); Basin SQL count(DISTINCT id) from start_id 367,439 = 13,037; complete day 2026-11-04 D1 10,806 rows = lake 10,806 distinct ids, id sums equal (4,028,925,249), lake_spine_drift verdict ok, missing 0, duplicates 0 (the worker''s own check at 05:32Z). D1 stays authoritative and its writer is untouched, so D1 write volume is unchanged until slice 2. Open with doers: ROADMAP-1 QNFO.INFRA LAKE-SPINE-2.1 (qnfo-infra /lake/ingest door), LAKE-SPINE-2.2 (healthProbes dual write, then stop the D1 insert; about 96,000 fewer fleet_probe_log row writes a day), INFRA-AUTH-AWAIT-1 (qnfo-infra routes answered without a token). Not started in B2: the Durable Object coordination plane, the Queue write-coalescer, ops_config as a KV snapshot, the 50 MB result-cap guard (D1-RESULT-CAP-1) and the lake for remediation_verifications and cloud_ops_events (their triggers go first, D1-SPLIT P0).',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 3258 AND item = 'RM-BS-DATA-SPINE-1' AND status = 'planned';

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('lake-spine-drift-silent', 'the daily drift check of the lake copy has not produced a reading for 36 hours although the copy is on',
  'lakeDriftTick compares each complete UTC day with Basin SQL; when the check throws (the secrets-store token lost the Basin SQL read scope, the table was dropped, a query timed out) the error goes to the fire error list and Workers Logs only, and the copy keeps sending rows nobody verifies',
  'read the qnfo-infra Workers Logs for "lake spine" and run python scripts/lake_spine.py --query "SELECT count(*) FROM telemetry.fleet_probe_log" with the repository token to separate a token problem from a table problem; restore the scope or the table, then POST /lake/drift on qnfo-infra; never set lake_spine to off to quiet it',
  'fm-lake-spine-drift-silent', 'fm-lake-spine-drift-silent', '2026-11-05',
  'ops_config lake_spine = shadow for more than 36 hours and the newest lake_spine_drift row is older than 36 hours',
  'SELECT MAX(checked_at) FROM lake_spine_drift',
  'the lake copy only: an unverified copy cannot be used for a cutover (slice 2 requires 7 days of ok readings)');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-lake-spine-drift-silent', NULL,
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT value FROM ops_config WHERE key = ''lake_spine'') = ''shadow'' AND (SELECT updated_at FROM ops_config WHERE key = ''lake_spine'') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-36 hours'') AND COALESCE((SELECT MAX(checked_at) FROM lake_spine_drift), ''1970-01-01'') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-36 hours'') THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 1000, 1, 'active',
  'with ops_config lake_spine = shadow for more than 36 hours, lake_spine_drift holds a reading checked within the last 36 hours (a day is checked on the first fire at least an hour after it ends)',
  'Read the qnfo-infra Workers Logs for "lake spine" and lake_spine_state.last_error; run python scripts/lake_spine.py --query to separate a token problem from a table problem; then POST /lake/drift on qnfo-infra',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));
