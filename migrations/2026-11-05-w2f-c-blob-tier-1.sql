-- BLOB-TIER-1 (2026-11-05, agent W2-F-C, charter pillar cost; roadmap row 119 RM-D1-RETENTION-1; agent_issues 1001972). scripts/cold_tier.py gets mode "blob": the row stays, its heavy columns move to R2 and are set
-- to NULL after a verified read-back (same order as COLD-TIER-1: object written, read back by sha256 and rowids, verified cold_archive_ledger row, only then the UPDATE, at most 400 rowids a statement).
-- First tier: code_task_ctx_archive. Read 2026-11-05 04:30Z: 1,153 rows holding 108.6 MB of base and 75.8 MB of patch (184 MB of a 1.32 GB file, orig_ctx_bytes sum 257 MB, growing by 40 rows a heavy tick
-- because CODE-TASKS-CTX-SLIM copies the text out of code_tasks.ctx into this table: an archive inside D1 is not an archive); its only toucher is the trigger code_tasks_ctx_slim_heavy_tick, which reads task_id and slimmed.
-- Not in this slice, with the reason read today: paper_integrity_backups (ciBackfillRetracted and noticeRepairTick of qnfo-research-exec read body_md to restore a retracted paper from the earliest backup),
-- errata_actions and version_queue (bodies of unfinished rows are read by the errata and revision pipelines; they need a status filter), email_raw_archive (personal-plane text): filed as BLOB-TIER-2.
-- This file adds a failure mode with its closing probe (no more than 100 heavy slimmed rows older than a day), a decision_log row, a note on agent_issues 1001972 and the BLOB-TIER-2 issue; it deletes nothing.
-- PREDICTION: code_task_ctx_archive base+patch 184 MB -> under 5 MB within about 8 hours of the merge (120 rows per consumer run, then 40 new rows per tick keep pace); R2 gains about 25 MB gzipped in about
-- 100 objects; v_cold_tier_status lists code_task_ctx_archive with unverified 0 and rows_pruned equal to rows_archived. The D1 file size falls only after D1 reuses the freed pages.
-- Verify: SELECT * FROM v_cold_tier_status; SELECT COUNT(*), SUM(length(base)), SUM(length(patch)) FROM code_task_ctx_archive (read once; the table is small in rows).
-- Restore: gunzip the object named in cold_archive_ledger.r2_key and UPDATE code_task_ctx_archive SET base = ?, patch = ? WHERE task_id = ? for each line. Kill switch: ops_config cold_tier = off.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-cold-archive-lag-3'; DELETE FROM failure_modes WHERE fm_key = 'cold-archive-lag-3'; DELETE FROM decision_log WHERE actor = 'session:w2f-c' AND action LIKE 'BLOB-TIER-1:%'; DELETE FROM agent_issues WHERE title LIKE 'BLOB-TIER-2:%' AND source = 'session:w2f-c' AND status = 'open'; UPDATE agent_issues SET description = substr(description, 1, instr(description, char(10) || 'BLOB-TIER-1 2026-11-05') - 1) WHERE id = 1001972 AND instr(description, char(10) || 'BLOB-TIER-1 2026-11-05') > 0
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it writes one failure mode, one contract, one decision_log row, one issue row and one issue note.

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('cold-archive-lag-3', 'code_task_ctx_archive holds more than 100 slimmed rows with text in base or patch that are over a day old: the blob tier is not running or not verifying',
  'scripts/cold_tier.py sets base and patch to NULL only after the R2 object holding them was read back and matched; when the object cannot be written or read, or D1 refuses a result of that size, nothing is changed and the archive keeps growing by 40 rows a tick',
  'read the latest continuity-snapshot run log line {"cold-tier": ...} (error field), cold_archive_ledger / v_cold_tier_status, and ops_config cold_tier; a D1 result too large is fixed by lowering chunk of the tier in scripts/cold_tier.py, never by nulling the columns by hand',
  'fm-cold-archive-lag-3', 'fm-cold-archive-lag-3', '2026-11-05',
  'more than 100 rows of code_task_ctx_archive with slimmed = 1, archived over a day ago and base or patch not NULL',
  'SELECT COUNT(*) FROM code_task_ctx_archive WHERE slimmed = 1 AND archived_at < now - 1 day AND (base IS NOT NULL OR patch IS NOT NULL)',
  'D1 file size (184 MB and growing about 50 MB a day) and every statement that scans code-task tables');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-cold-archive-lag-3', NULL,
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT COUNT(*) FROM code_task_ctx_archive WHERE slimmed = 1 AND archived_at < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-1 day'') AND (base IS NOT NULL OR patch IS NOT NULL)) > 100 THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 1000, 1, 'active',
  'code_task_ctx_archive holds at most 100 slimmed rows over a day old that still carry text in base or patch (the first runs after the BLOB-TIER-1 merge drain about 1,000 rows at 120 rows a run)',
  'Read the {"cold-tier": ...} line of the last remediation-consumer continuity step and v_cold_tier_status; error verify-sha-mismatch or r2-put-refused is an R2 problem, a D1 error naming a result size means lowering chunk for code_task_ctx_archive in TIERS, stopped=budget needs another run',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now', '+8 hours'));

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:w2f-c',
 'the base and patch text of code_task_ctx_archive can leave D1 for R2 because the table is itself an archive (slimmed = 1 means code_tasks.ctx no longer holds the text) and nothing reads those two columns',
 'BLOB-TIER-1: scripts/cold_tier.py blob mode moves base and patch of code_task_ctx_archive rows to R2 (verified read-back first) and sets them NULL; paper_integrity_backups and the errata and revision bodies stay (BLOB-TIER-2)',
 'fleet-graph impact of code_task_ctx_archive (2026-11-05): the only toucher is trigger code_tasks_ctx_slim_heavy_tick, reading task_id and slimmed; table read 04:30Z: 1,153 rows, base 108.6 MB, patch 75.8 MB; impact of paper_integrity_backups shows ciBackfillRetracted and noticeRepairTick reading body_md, so it is excluded',
 'about 184 MB of text leave qnfo-audit within about 8 hours; every row, task_id and orig_ctx_bytes stay',
 'one table of qnfo-audit; code_tasks and the slim trigger are unchanged',
 'ops_config cold_tier = off stops it; restore a row from the object named in cold_archive_ledger.r2_key (UPDATE base, patch by task_id); revert the script by the canonical revert of the merge',
 'the largest remaining D1 table by bytes stops growing in D1 and stays restorable from R2',
 'v_cold_tier_status lists code_task_ctx_archive with unverified 0 within 2 hours of the merge and the contract fm-cold-archive-lag-3 passes within 10 hours',
 'no external reach change',
 'offline sqlite self-test of scripts/cold_tier.py (rows nulled only when slimmed, old enough and heavy; original text byte-identical in the objects; a failed read-back nulls nothing)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:w2f-c' AND action LIKE 'BLOB-TIER-1:%');

UPDATE agent_issues
SET description = description || char(10) || 'BLOB-TIER-1 2026-11-05: code_task_ctx_archive (the 184 MB table, 1,153 rows, base and patch) is built as blob mode in scripts/cold_tier.py (agent W2-F-C). paper_integrity_backups is excluded: ciBackfillRetracted and noticeRepairTick of qnfo-research-exec read its body_md to restore a retracted paper from the earliest backup. errata_actions, version_queue and email_raw_archive are the remainder, filed as BLOB-TIER-2 with the status vocabulary each needs. Closing evidence: v_cold_tier_status lists code_task_ctx_archive with unverified 0 and the contract fm-cold-archive-lag-3 passes.'
WHERE id = 1001972 AND instr(description, char(10) || 'BLOB-TIER-1 2026-11-05') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BLOB-TIER-2: errata_actions and version_queue bodies of finished rows, and email_raw_archive, move to R2 with a status filter (paper_integrity_backups stays in D1)',
 'Charter pillar: cost (D1 size). Roadmap row 119 (RM-D1-RETENTION-1). Evidence read 2026-11-05: errata_actions 57.8 MB (clarification, acknowledgement, changelog, corrected_md; status, created_at), version_queue 28.0 MB (corrected_md, references_bib, citation_audit, due_diligence, project_plan, readme_md, verify_script, verify_output, license_md; status, created_at) per docs/D1-TIERING-2026-11.md section 2; BLOB-TIER-1 built mode blob in scripts/cold_tier.py for code_task_ctx_archive. paper_integrity_backups (9.7 MB) is NOT a candidate: ciBackfillRetracted and noticeRepairTick (qnfo-research-exec) read body_md to restore a retracted paper from the earliest backup. email_raw_archive (5.5 MB) is personal-plane text and moves only under the personal-plane rules (private path, never the research plane).' || char(10) ||
 'EDIT: read the status values of errata_actions and version_queue (SELECT status, COUNT(*) GROUP BY status, small tables), name the terminal ones, add one TIERS entry each with mode blob, where = the terminal-status filter, keep_days 30, and the columns above; before enabling, run impact on each table and list every reader of the columns (the errata and revision pipelines of qnfo-research-exec read bodies of unfinished rows). Extend scripts/cold_tier.py --selftest with a not-terminal row that must keep its text.' || char(10) ||
 'Definition of done: v_cold_tier_status lists errata_actions and version_queue with unverified 0, the blob columns are NULL for terminal rows older than 30 days, and the errata and revision pipelines still pass their suites and the next paper revision completes.' || char(10) ||
 'code-task: repo=qnfo-workers path=scripts/cold_tier.py' || char(10) ||
 'code-anchor: def archive_chunk(d1, r2, t, rows, now=None, sleep=time.sleep):' || char(10) ||
 'code-probe: {"paths": ["scripts/cold_tier.py"], "contains": "\"table\": \"errata_actions\""}',
 'session:w2f-c', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'BLOB-TIER-2:%' AND status = 'open');
