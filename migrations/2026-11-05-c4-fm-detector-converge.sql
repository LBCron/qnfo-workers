-- C4-FM-DETECTOR-CONVERGE-1 (2026-11-05, charter pillar autonomy; follow-up of PR 7398, roadmap_implementation 1754 FM-1 and 1756 FM-3).
-- migrations/2026-11-05-sla-graph-fm-1.sql (applied 2026-11-04T23:21Z) armed a detector for each failure mode whose failure_modes.probe_class was the transport name d1-query, by copying the probe of the
-- issue contract: fm-diagnosis-raw-markup (issue 1000717), fm-diagnosis-unresolved-anchor (1000718) and fm-close-no-dwell (1000719). PR 7398 (applied 2026-11-05T00:29:12Z) wrote the same detectors
-- under other names and its INSERT OR IGNORE left the copies in place, so two of its three FM-1 to FM-3 detectors exist twice and one still carries the defect of its original:
--   fm-diagnosis-raw-markup   the copy of the 1000717 probe counts 'no answer yet' only at the very end of a description and markup written after 2026-10-29; it read 0 (pass, 2026-11-04T23:32Z) while 4
--                             ROOT-CAUSE-1 descriptions held raw tool-call markup and 2 clean answers were not appended (read before PR 7398). The probe of PR 7398 reads the descriptions themselves
--                             and the unappended answers; live at 2026-11-05T00:39Z it reads 0 after the 00:36Z management-personas run appended #333 to 1000303 and #340 to 1000558.
--   fm-close-no-dwell         the copy of the 1000719 probe counts single_pass_close in v_close_dwell_shadow, which reads verified_at; VERIFICATION-DEDUPE-1 moves it on a repeat pass, so the detector
--                             reads fail while every close held (v_close_hold_audit, live 2026-11-05T00:39Z: 68 closes judged, 12 with a hold, shortest span 60.2 minutes against 60, 0 violations).
--   fm-diagnosis-unresolved-anchor and PR 7398's fm-diagnosis-anchor-rule read the same prompt rule; fm-close-no-dwell and PR 7398's fm-close-hold-violated measure the same failure mode.
-- Change: the two copies get the probes that read the defect; the failure_modes rows name the sla-graph-fm-1 contracts again (class fm-<key>); the two duplicates of PR 7398 are superseded
-- (not deleted, not run: fewer verification rows, FM-5), and the evidence of row 1756 names the detector that stays. Nothing is closed, no threshold, cap, probe or gate is loosened: the only probe
-- that changes replaces one that cannot see the defect (raw-markup) and one that cannot pass while the defect is absent (close-no-dwell), each with a probe that fails while the defect exists.
-- Prediction: fm-close-no-dwell reads pass at its next probe (it failed since 2026-11-04T23:32Z); fm-diagnosis-raw-markup stays pass; failure_modes_recurring falls by one.
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_c4_fm_detectors b WHERE b.class = remediation_contracts.class), precondition = (SELECT b.precondition FROM bak_20261105_c4_fm_detectors b WHERE b.class = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_c4_fm_detectors b WHERE b.class = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_c4_fm_detectors b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_c4_fm_detectors b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_c4_fm_detectors); UPDATE failure_modes SET probe_class = 'fm-close-hold-violated' WHERE fm_key = 'close-no-dwell'; UPDATE failure_modes SET probe_class = 'fm-diagnosis-anchor-rule' WHERE fm_key = 'diagnosis-unresolved-anchor';
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_c4_fm_detectors
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_c4_fm_detectors (
  class TEXT PRIMARY KEY,
  verify_probe TEXT,
  precondition TEXT,
  action TEXT,
  status TEXT,
  last_verdict TEXT
);

INSERT OR IGNORE INTO bak_20261105_c4_fm_detectors (class, verify_probe, precondition, action, status, last_verdict)
SELECT class, verify_probe, precondition, action, status, last_verdict FROM remediation_contracts
WHERE class IN ('fm-diagnosis-raw-markup', 'fm-close-no-dwell', 'fm-close-hold-violated', 'fm-diagnosis-anchor-rule');

-- 1. fm-diagnosis-raw-markup: the probe that reads the descriptions (the one PR 7398 meant to install); guarded on the old text so a second apply, or a probe someone improved, is not touched.
UPDATE remediation_contracts
SET verify_probe = 'WITH latest AS (SELECT CAST(substr(instance, 12) AS INTEGER) AS issue_id, MAX(id) AS rid FROM cf_agent_requests WHERE instance LIKE ''root-cause-%'' GROUP BY instance) SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM agent_issues a WHERE a.id >= 1000000 AND a.title LIKE ''ROOT-CAUSE-1:%'' AND (a.description LIKE ''%<|tool_call%'' OR a.description LIKE ''%<function_calls%'' OR a.description LIKE ''%<invoke%'' OR a.description LIKE ''%DSML%'')) + (SELECT COUNT(*) FROM latest l JOIN agent_issues a ON a.id = l.issue_id JOIN cf_agent_requests r ON r.id = l.rid WHERE a.status = ''open'' AND a.title LIKE ''ROOT-CAUSE-1:%'' AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') <> '''' AND r.result NOT LIKE ''(the model returned no text)%'' AND r.result NOT LIKE ''%tool_call%'' AND r.result NOT LIKE ''%<invoke%'' AND r.result NOT LIKE ''%<function_calls%'' AND r.result NOT LIKE ''%DSML%'' AND r.finished_at < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-180 minutes'') AND instr(COALESCE(a.description, ''''), ''(cf_agent_requests #'' || r.id || '','') = 0) AS TEXT) AS observed',
    precondition = 'even-keel FM-1 (agent_issues 1000717); probe replaced by C4-FM-DETECTOR-CONVERGE-1',
    action = 'failure-mode detector: a ROOT-CAUSE-1 description holds raw tool-call markup, or a clean diagnosis older than 3 hours is not in the description',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'fm-diagnosis-raw-markup' AND instr(verify_probe, 'no answer yet') > 0;

-- 2. fm-close-no-dwell: the audit of PR 7398 (close time from close_evidence, the hold of v_issue_close_hold) instead of the shadow view that reads the moved verified_at.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_close_hold_audit WHERE violated = 1 AND closed_at > datetime(''now'', ''-24 hours'')) AS TEXT) AS observed',
    precondition = 'even-keel FM-3 (agent_issues 1000719); probe replaced by C4-FM-DETECTOR-CONVERGE-1',
    action = 'failure-mode detector: an issue with a prior reopen was closed by the autoclose trigger inside its RELAPSE-HOLD-1 hold (v_close_hold_audit)',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'fm-close-no-dwell' AND instr(verify_probe, 'v_close_dwell_shadow') > 0
  AND EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'v_close_hold_audit');

-- 3. The failure_modes rows name the fm-<key> contracts again; the detector text follows.
UPDATE failure_modes
SET probe_class = 'fm-close-no-dwell',
    detector = 'fm-close-no-dwell: closes in 24 hours of an issue with a prior reopen that broke the RELAPSE-HOLD-1 hold (v_close_hold_audit), expected 0'
WHERE fm_key = 'close-no-dwell' AND probe_class = 'fm-close-hold-violated';
UPDATE failure_modes
SET probe_class = 'fm-diagnosis-unresolved-anchor',
    detector = 'fm-diagnosis-unresolved-anchor: the live root-cause prompt carries the anchor and layer rule, expected 1; the deterministic check of a stored anchor is the code loop intake (ANCHOR-LOCATOR-1)'
WHERE fm_key = 'diagnosis-unresolved-anchor' AND probe_class = 'fm-diagnosis-anchor-rule';

-- 4. The two duplicates of PR 7398 are superseded: the consumer runs active contracts only, and nothing reads them any more.
UPDATE remediation_contracts
SET status = 'superseded', last_verdict = 'superseded:duplicate of fm-close-no-dwell (C4-FM-DETECTOR-CONVERGE-1)'
WHERE class = 'fm-close-hold-violated' AND status = 'active'
  AND EXISTS (SELECT 1 FROM remediation_contracts k WHERE k.class = 'fm-close-no-dwell' AND k.status = 'active' AND instr(k.verify_probe, 'v_close_hold_audit') > 0);
UPDATE remediation_contracts
SET status = 'superseded', last_verdict = 'superseded:duplicate of fm-diagnosis-unresolved-anchor (C4-FM-DETECTOR-CONVERGE-1)'
WHERE class = 'fm-diagnosis-anchor-rule' AND status = 'active'
  AND EXISTS (SELECT 1 FROM remediation_contracts k WHERE k.class = 'fm-diagnosis-unresolved-anchor' AND k.status = 'active' AND instr(k.verify_probe, 'occurs exactly once in it') > 0);

-- 5. Row 1756 names the detector that stays.
UPDATE roadmap_implementation
SET evidence = replace(evidence, 'detector fm-close-hold-violated, expected 0', 'detector fm-close-no-dwell (its probe reads v_close_hold_audit), expected 0')
WHERE id = 1756 AND instr(evidence, 'detector fm-close-hold-violated, expected 0') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c4-fm',
  'a detector that cannot see its defect, or cannot pass when the defect is absent, is worse than none: it produces a green or a red that nobody believes',
  'C4-FM-DETECTOR-CONVERGE-1: probes of fm-diagnosis-raw-markup and fm-close-no-dwell replaced; failure_modes rows re-pointed; two duplicate detectors of PR 7398 superseded',
  '2026-11-05T00:39Z qnfo-audit reads: fm-diagnosis-raw-markup read pass at 23:32Z with 4 markup descriptions and 2 unappended answers present; fm-close-no-dwell failing since 23:32Z while v_close_hold_audit shows 12 held closes, 0 violations, shortest span 60.2 minutes',
  'pending canonical migration; measured by the two detectors', 'four remediation_contracts rows, two failure_modes rows, one roadmap evidence string',
  'the Rollback line of migrations/2026-11-05-c4-fm-detector-converge.sql with bak_20261105_c4_fm_detectors',
  'fm-detectors-converge-1',
  'fm-close-no-dwell passes at its next probe; fm-diagnosis-raw-markup stays pass; failure_modes_recurring falls by one; remediation_latest_pass_pct_7d and issue_wontfix_share_7d do not worsen',
  'not a reach change; detector honesty',
  'node:sqlite suite migrations/c4-fm-detector-converge.test.mjs (the copies as sla-graph-fm-1 created them, then PR 7398, then this file; idempotent re-apply)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c4-fm' AND capability_gain = 'fm-detectors-converge-1');
