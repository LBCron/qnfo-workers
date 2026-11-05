-- C4-FM-CLOSEOUT-1 (2026-11-04, charter pillars autonomy and cost; roadmap_implementation 1754 FM-1, 1756 FM-3, 1758 FM-5 and the FM-2 detector; agent_issues 1000717 to 1000721).
-- Follow-up of cluster-e-c (PR 5162), RELAPSE-HOLD-1 (PR 7031, 7065), VERIFICATION-DEDUPE-1 and the FM-5 back-off. Rows 1755 (FM-2) and 1757 (FM-4) are left as other sessions set them:
-- 1755 was verified 2026-11-04T23:38Z on the prompt rule plus the intake locator, 1757 was built by PR 7357 (VACUOUS-MARKER-REAL-PROBE-1: marker sweep, guard metric vacuous_probe_share).
-- What the live rows said on 2026-11-04 (qnfo-audit, read before this file was written):
--  FM-1  management-personas v34 carries the markup guard (instr '%tool_call%' 7163), the cap of six requests and the anchor rule; no ROOT-CAUSE-1 diagnosis written after 2026-10-29 holds markup.
--        But the clean-up of the old rows never ran: cluster-e-c reset the stale persona_actions rows only where the description ENDED with the 'no answer yet' line, and the live
--        descriptions continue after it (changes = 0). So 4 ROOT-CAUSE-1 descriptions still held raw markup (1000306, 1000309, 1000310 closed; 1000558 open; cf_agent_requests 118, 97, 58, 238),
--        1000303 and 1000558 never received the clean answer that exists (#333, #340), and the closing probe of 1000717 counts 'no answer yet' only at the very end of a description, so it
--        reads 0 whatever the rows hold (row 1754 was verified on that probe). qnfo-agents 0.6.0 (PR 7141) already strips markup at the producer.
--  FM-2  the prompt rule is live (probe 1000718 passes). No step reads the file when an answer is stored: 2 of the 8 doer_assignments with status assigned name an anchor that occurs 0 times on
--        main today (doer 1 qnfo-research-exec/worker.js REVISE-NOOP-BOUND-1, doer 818 q08-signal-engine/worker.js retryPiece) and dg-reject checks the path shape and the anchor length only.
--        The code loop absorbs it: its intake lets an anchor that occurs 0 or 2+ times through to ANCHOR-LOCATOR-1 and ANCHOR-REPAIR-1 (qnfo-code-orchestrator/intake-preflight.test.mjs), and
--        the tasks of both issues merged (ct_f822ern42hx9io for 99930, ct_ckebrhq20qlwf6 for 100464). A store-time vet in qnfo-agents finishRequest would save a locator call for about one answer in
--        four and costs a bundle rebuild on a file another session holds: not built. This file only keeps a detector on the prompt rule, so a later migration cannot drop it unseen.
--  FM-3  RELAPSE-HOLD-1 (v_issue_close_hold; 60 minutes after one or two reopens, 120 after three) is the dwell. Ten closes of an issue with a prior reopen between 2026-11-04T17:06Z and 2026-11-05T00:20Z: all ten
--        had a passing previous row and passes spanning 62.7 to 473.1 minutes against holds of 60 and 120. The shadow view v_close_dwell_shadow flags 8 of the first 9 as single-pass because it reads
--        verified_at, which VERIFICATION-DEDUPE-1 moves forward on a repeat pass (issue 1001286: close_evidence says 2026-11-03 19:11:04, the row says 2026-11-04 20:10:58). The close time is the
--        verified_at inside close_evidence: v_close_hold_audit reads that and the hold, and fm-close-hold-violated counts closes that broke the hold.
--  FM-4  not touched here. One reading for the record: v_vacuous_probe_share counts the action label (146 of 518 open issues on 2026-11-04) and ISSUE-PROBE-AGENT-1 rewrites verify_probe without
--        the label: all 18 label-only contracts of that reading held real probes and 0 open issues sat on the placeholder text SELECT 'closed' AS expected; PR 7357 clears the label once a probe
--        has failed on a real reading, which moves the metric to the same place.
--  FM-5  the steady-state back-off (scripts/remediation_consumer.py steady_state_cadence, tests green) and VERIFICATION-DEDUPE-1 (applied 2026-11-04T16:03:29Z) are live: 19,127 rows touched or
--        written in 24 hours against 31,903 on 2026-10-28, passing d1-query classes at 3.1 rows a day, runtime_verified_share_24h 12.7 (trigger 10, target 25), remediation_latest_pass_pct_7d 62.7.
--        Runtime probes are excluded from the back-off on purpose (they are the runtime share). What is left is 4,441 of 5,166 inserts since 17:27Z with issue_id NULL (the dedupe needs an issue),
--        of which about 4,100 repeat the previous row of their class: filed below with its closing probe.
-- Changes: (1) scrub the markup and the stale placeholder, re-arm the two open issues whose clean answer was never appended; detector fm-diagnosis-raw-markup (markup in a description, or a
--   clean answer older than 3 hours that is not in the description). (2) detector fm-diagnosis-anchor-rule. (3) v_close_hold_audit and fm-close-hold-violated, row 1756 implemented.
--   (4) fm-verification-row-volume and the issue-less dedupe issue, evidence appended to rows 1754 and 1758. The failure_modes rows of FM-1 to FM-3 get the detector as probe_class
--   (they pointed at the transport name d1-query, which no verification carries, so v_failure_mode_status read them unprobed).
-- Prediction (decision_log): fm-diagnosis-raw-markup reads 6 before and 0 within two hourly management-personas runs, then stays 0; fm-close-hold-violated stays 0 (10 of 10 held since the hold).
--   Guards: remediation_latest_pass_pct_7d (62.7) and issue_wontfix_share_7d (0.0) do not worsen, runtime_verified_share_24h (12.7) does not fall; no issue is closed, no probe, cap or gate is
--   weakened; one new open issue (the dedupe follow-up).
-- Rollback: UPDATE agent_issues SET description = (SELECT b.old_value FROM bak_20261104_c4_fm b WHERE b.kind = 'issue' AND b.record_key = CAST(agent_issues.id AS TEXT)) WHERE CAST(id AS TEXT) IN (SELECT record_key FROM bak_20261104_c4_fm WHERE kind = 'issue'); UPDATE persona_actions SET to_value = (SELECT b.old_value FROM bak_20261104_c4_fm b WHERE b.kind = 'persona_action' AND b.record_key = CAST(persona_actions.id AS TEXT)) WHERE CAST(id AS TEXT) IN (SELECT record_key FROM bak_20261104_c4_fm WHERE kind = 'persona_action'); DROP VIEW IF EXISTS v_close_hold_audit; DELETE FROM remediation_contracts WHERE class IN ('fm-diagnosis-raw-markup', 'fm-diagnosis-anchor-rule', 'fm-close-hold-violated', 'fm-verification-row-volume'); DELETE FROM failure_modes WHERE fm_key = 'verification-row-volume'; restore failure_modes (probe_class, detector) and roadmap_implementation (status, evidence, verified_at) from the json rows of kinds failure_mode and roadmap.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_c4_fm
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_c4_fm (
  kind TEXT NOT NULL,
  record_key TEXT NOT NULL,
  old_value TEXT,
  PRIMARY KEY (kind, record_key)
);

INSERT OR IGNORE INTO bak_20261104_c4_fm (kind, record_key, old_value)
SELECT 'issue', CAST(id AS TEXT), description FROM agent_issues WHERE id IN (1000301, 1000302, 1000303, 1000306, 1000309, 1000310, 1000558);

INSERT OR IGNORE INTO bak_20261104_c4_fm (kind, record_key, old_value)
SELECT 'persona_action', CAST(id AS TEXT), to_value FROM persona_actions WHERE kind = 'agent-diagnose' AND issue_id IN (1000303, 1000558);

INSERT OR IGNORE INTO bak_20261104_c4_fm (kind, record_key, old_value)
SELECT 'failure_mode', fm_key, json_object('probe_class', probe_class, 'detector', detector)
FROM failure_modes WHERE fm_key IN ('diagnosis-raw-markup', 'diagnosis-unresolved-anchor', 'close-no-dwell');

INSERT OR IGNORE INTO bak_20261104_c4_fm (kind, record_key, old_value)
SELECT 'roadmap', CAST(id AS TEXT), json_object('status', status, 'evidence', evidence, 'verified_at', verified_at)
FROM roadmap_implementation WHERE id IN (1754, 1756, 1758);

-- FM-1 (1): the raw tool-call markup stored as a diagnosis. Each pair is (issue, cf_agent_requests id); the replaced text is the part of the stored result from the first markup token on,
-- exactly as rc-agent-report appended it. Nothing is written unless that text occurs in the description.
UPDATE agent_issues
SET description = replace(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 118 AND instr(r.result, '<|tool_call') > 0),
                          '[raw tool-call markup removed (FM-1): cf_agent_requests #118 returned a tool call, not an answer]')
WHERE id = 1000306 AND instr(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 118 AND instr(r.result, '<|tool_call') > 0)) > 0;
UPDATE agent_issues
SET description = replace(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 97 AND instr(r.result, '<|tool_call') > 0),
                          '[raw tool-call markup removed (FM-1): cf_agent_requests #97 returned a tool call, not an answer]')
WHERE id = 1000309 AND instr(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 97 AND instr(r.result, '<|tool_call') > 0)) > 0;
UPDATE agent_issues
SET description = replace(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 58 AND instr(r.result, '<|tool_call') > 0),
                          '[raw tool-call markup removed (FM-1): cf_agent_requests #58 returned a tool call, not an answer]')
WHERE id = 1000310 AND instr(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 58 AND instr(r.result, '<|tool_call') > 0)) > 0;
UPDATE agent_issues
SET description = replace(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 238 AND instr(r.result, '<|tool_call') > 0),
                          '[raw tool-call markup removed (FM-1): cf_agent_requests #238 returned a tool call, not an answer]')
WHERE id = 1000558 AND instr(description, (SELECT substr(r.result, instr(r.result, '<|tool_call')) FROM cf_agent_requests r WHERE r.id = 238 AND instr(r.result, '<|tool_call') > 0)) > 0;

-- the stale placeholder of the first version of the report step, on the three oldest ROOT-CAUSE-1 issues (1000301 and 1000302 carry their clean answer below it already)
UPDATE agent_issues
SET description = replace(description, 'no answer yet; the managers ask again', '(that request returned no text; a later request answers)')
WHERE id IN (1000301, 1000302, 1000303) AND instr(description, 'no answer yet; the managers ask again') > 0;

-- FM-1 (2): the two open issues whose latest request holds a clean answer that is not in the description are asked to report again; rc-agent-report appends the latest request and
-- rc-agent-mark sets the row back to reported. The condition is the live one: latest request clean, finished, header not yet in the description.
UPDATE persona_actions SET to_value = 'requested'
WHERE kind = 'agent-diagnose' AND to_value = 'reported' AND issue_id IN (1000303, 1000558)
  AND EXISTS (
    SELECT 1 FROM agent_issues a
    JOIN cf_agent_requests r ON r.id = (SELECT MAX(q.id) FROM cf_agent_requests q WHERE q.instance = 'root-cause-' || a.id)
    WHERE a.id = persona_actions.issue_id AND a.status = 'open'
      AND r.status IN ('done', 'failed', 'error') AND COALESCE(r.result, '') <> ''
      AND r.result NOT LIKE '(the model returned no text)%' AND r.result NOT LIKE '%tool_call%' AND r.result NOT LIKE '%<invoke%'
      AND r.result NOT LIKE '%<function_calls%' AND r.result NOT LIKE '%DSML%'
      AND instr(COALESCE(a.description, ''), '(cf_agent_requests #' || r.id || ',') = 0);

-- FM-3: close audit that mirrors the autoclose hold. closed_at is the verified_at written into close_evidence at the close (VERIFICATION-DEDUPE-1 moves the verified_at of the row later);
-- reopens_before counts the issue's reopened events before that time; the hold is v_issue_close_hold's 60 (one or two reopens) and 120 (three or more) minutes, 0 while
-- ops_config relapse_close_hold = off; a close is held when the previous measured row of the class passed and the passes since the last failure and the last reopen span the hold.
-- Only closes from the start of the hold (2026-11-04T17:06:10Z, migration_runs 1149) on are judged.
DROP VIEW IF EXISTS v_close_hold_audit;
CREATE VIEW v_close_hold_audit AS
SELECT w.issue_id, w.verification_id, w.class, w.closed_at, w.reopens_before, w.hold_min, w.prev_pass,
       ROUND((julianday(w.closed_at) - w.first_pass_j) * 1440.0, 1) AS span_min,
       CASE WHEN w.hold_min = 0 THEN 0
            WHEN w.prev_pass = 1 AND w.first_pass_j IS NOT NULL AND (julianday(w.closed_at) - w.first_pass_j) * 1440.0 >= w.hold_min THEN 0
            ELSE 1 END AS violated
FROM (
  SELECT x.issue_id, x.verification_id, x.class, x.closed_at, x.reopens_before,
         CASE WHEN COALESCE((SELECT o.value FROM ops_config o WHERE o.key = 'relapse_close_hold'), 'on') = 'off' THEN 0
              WHEN x.reopens_before >= 3 THEN 120
              WHEN x.reopens_before >= 1 THEN 60
              ELSE 0 END AS hold_min,
         (SELECT p.pass FROM remediation_verifications p
           WHERE p.class = x.class AND p.id < x.verification_id AND COALESCE(p.observed, '') <> '' AND lower(trim(p.observed)) NOT LIKE 'pending%'
           ORDER BY p.id DESC LIMIT 1) AS prev_pass,
         (SELECT MIN(julianday(p.verified_at)) FROM remediation_verifications p
           WHERE p.class = x.class AND p.pass = 1 AND p.id < x.verification_id
             AND p.id > COALESCE((SELECT MAX(f.id) FROM remediation_verifications f
                                   WHERE f.class = x.class AND f.pass = 0 AND f.id < x.verification_id AND COALESCE(f.observed, '') <> '' AND lower(trim(f.observed)) NOT LIKE 'pending%'), 0)
             AND (x.last_reopen_j IS NULL OR julianday(p.verified_at) > x.last_reopen_j)) AS first_pass_j
  FROM (
    SELECT c.issue_id, c.verification_id, v.class AS class, c.closed_at,
           (SELECT COUNT(*) FROM issue_lifecycle l WHERE l.issue_id = c.issue_id AND l.event = 'reopened' AND julianday(l.ts) < julianday(c.closed_at)) AS reopens_before,
           (SELECT MAX(julianday(l.ts)) FROM issue_lifecycle l WHERE l.issue_id = c.issue_id AND l.event = 'reopened' AND julianday(l.ts) < julianday(c.closed_at)) AS last_reopen_j
    FROM (
      SELECT t.issue_id AS issue_id, CAST(substr(t.close_evidence, 27) AS INTEGER) AS verification_id,
             substr(t.close_evidence, instr(t.close_evidence, ' verified_at=') + 13, 19) AS closed_at
      FROM issue_triage t
      WHERE t.close_evidence LIKE 'remediation_verifications#%' AND instr(t.close_evidence, ' verified_at=') > 0
    ) c
    JOIN remediation_verifications v ON v.id = c.verification_id
    WHERE c.closed_at >= '2026-11-04 17:06:10'
  ) x
) w;

-- Detectors (failure_modes registry; v_failure_mode_status reads the probe_class contract). Each reads the defect itself.
INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES
  ('fm-diagnosis-raw-markup', NULL, 'C4-FM-CLOSEOUT-1 FM-1', 'failure-mode detector: a ROOT-CAUSE-1 description holds raw tool-call markup, or a clean diagnosis older than 3 hours is not in the description',
   'WITH latest AS (SELECT CAST(substr(instance, 12) AS INTEGER) AS issue_id, MAX(id) AS rid FROM cf_agent_requests WHERE instance LIKE ''root-cause-%'' GROUP BY instance) SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM agent_issues a WHERE a.id >= 1000000 AND a.title LIKE ''ROOT-CAUSE-1:%'' AND (a.description LIKE ''%<|tool_call%'' OR a.description LIKE ''%<function_calls%'' OR a.description LIKE ''%<invoke%'' OR a.description LIKE ''%DSML%'')) + (SELECT COUNT(*) FROM latest l JOIN agent_issues a ON a.id = l.issue_id JOIN cf_agent_requests r ON r.id = l.rid WHERE a.status = ''open'' AND a.title LIKE ''ROOT-CAUSE-1:%'' AND r.status IN (''done'', ''failed'', ''error'') AND COALESCE(r.result, '''') <> '''' AND r.result NOT LIKE ''(the model returned no text)%'' AND r.result NOT LIKE ''%tool_call%'' AND r.result NOT LIKE ''%<invoke%'' AND r.result NOT LIKE ''%<function_calls%'' AND r.result NOT LIKE ''%DSML%'' AND r.finished_at < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-180 minutes'') AND instr(COALESCE(a.description, ''''), ''(cf_agent_requests #'' || r.id || '','') = 0) AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now', '+90 minutes')),
  ('fm-diagnosis-anchor-rule', NULL, 'C4-FM-CLOSEOUT-1 FM-2', 'failure-mode detector: the live management-personas root-cause prompt still requires the anchor check and layer naming (the deterministic check is the code loop intake, ANCHOR-LOCATOR-1)',
   'SELECT ''1'' AS expected, CASE WHEN instr((SELECT definition FROM fleet_tasks WHERE id = ''management-personas''), ''occurs exactly once in it'') > 0 AND instr((SELECT definition FROM fleet_tasks WHERE id = ''management-personas''), ''D1 trigger, view, migration or fleet_tasks step'') > 0 THEN ''1'' ELSE ''0'' END AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now')),
  ('fm-close-hold-violated', NULL, 'C4-FM-CLOSEOUT-1 FM-3', 'failure-mode detector: an issue with a prior reopen was closed by the autoclose trigger inside its hold (v_close_hold_audit)',
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM v_close_hold_audit WHERE violated = 1 AND closed_at > datetime(''now'', ''-24 hours'')) AS TEXT) AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now')),
  ('fm-verification-row-volume', NULL, 'C4-FM-CLOSEOUT-1 FM-5', 'failure-mode detector: remediation_verifications rows written or touched in 24 hours stay below 24000 (31903 on 2026-10-28, 19127 on 2026-11-04)',
   'SELECT ''1'' AS expected, CASE WHEN (SELECT COUNT(*) FROM remediation_verifications WHERE verified_at > datetime(''now'', ''-24 hours'')) < 24000 THEN ''1'' ELSE ''0'' END AS observed',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode', datetime('now'));

UPDATE failure_modes
SET probe_class = 'fm-diagnosis-raw-markup',
    detector = 'fm-diagnosis-raw-markup: ROOT-CAUSE-1 descriptions with raw tool-call markup plus open issues whose clean diagnosis older than 3 hours is not in the description, expected 0'
WHERE fm_key = 'diagnosis-raw-markup';
UPDATE failure_modes
SET probe_class = 'fm-diagnosis-anchor-rule',
    detector = 'fm-diagnosis-anchor-rule: the live root-cause prompt carries the anchor and layer rule, expected 1; the deterministic check of a stored anchor is the code loop intake (ANCHOR-LOCATOR-1)'
WHERE fm_key = 'diagnosis-unresolved-anchor';
UPDATE failure_modes
SET probe_class = 'fm-close-hold-violated',
    detector = 'fm-close-hold-violated: closes in 24 hours of an issue with a prior reopen that broke the RELAPSE-HOLD-1 hold (v_close_hold_audit), expected 0'
WHERE fm_key = 'close-no-dwell';

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, symptom, blast_radius)
VALUES
 ('verification-row-volume', 'remediation_verifications grows by repeats of the previous row: 191,906 rows in 7 days (2026-10-28), 4,100 of 4,441 issue-less inserts in 6.3 hours on 2026-11-04',
  'a contract is re-verified at its cadence and every verification inserts a row; the steady-state back-off skips runtime probes and detectors, VERIFICATION-DEDUPE-1 needs an issue_id',
  'C4-FM-CLOSEOUT-1 FM-5: steady_state_cadence (passing d1-query contracts, 2 hours), VERIFICATION-DEDUPE-1 (issue-linked repeats touch the previous row), the issue-less dedupe issue',
  'fm-verification-row-volume: rows written or touched in 24 hours below 24000', 'fm-verification-row-volume', '2026-10-28',
  '31,903 rows in 24 hours on 2026-10-28; 19,127 on 2026-11-04', 'D1 write and index cost, scans of the guard and relapse views');

-- FM-5: the remaining volume has no issue. One follow-up with a named doer (GitHub Copilot through ASSIGN-COPILOT-ISSUES-1, or a session) and a d1 probe on inserts with no issue
-- (ids above MAX(id) - 3000 that are issue-less and verified in the last 3 hours). The description has no task line a parser could take.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe: standing probes with no issue repeat their previous verification row 92 percent of the time',
       'Charter pillar: cost. Program QNFO.OPS. Roadmap row failure-modes-2026 FM-5 (roadmap_implementation 1758). Metric to move: remediation_verifications inserts per hour (824 since 2026-11-04T17:27Z: ids 585138 to 590304 in 6.27 hours) and the rows with issue_id NULL (4,441 of 5,166).' || char(10) ||
       'Read 2026-11-04T23:40Z: of the 4,441 inserts with issue_id NULL, about 4,100 equal the previous row of their class in pass, expected and observed (other d1-query failing 1,439 of 1,485 in 244 classes; fm d1-query passing 1,076 of 1,139 in 332 classes; rt runner-https passing 666 of 676 in 68 classes; fm code-read passing 359 of 363). VERIFICATION-DEDUPE-1 (remediation_verification_dedupe_ins) only fires with issue_id IS NOT NULL, and steady_state_cadence skips runner-https and, with RM-FM-CADENCE-1 (c9-failure-modes), the fm- and belief- detectors, because v_failure_mode_status marks a detector unprobed after 60 minutes.' || char(10) ||
       'Change (a migration plus, if needed, scripts/remediation_consumer.py): extend the BEFORE INSERT dedupe so that an identical repeat of a PASSING row of a class with issue_id NULL on transport d1-query or code-read (class LIKE fm-% or belief-%, plus the failing repeats of the other issue-less d1-query classes) touches verified_at and verifier of the previous row instead of inserting. Keep: runner-https and external-https rows (runtime_verified_share_24h is their share and must not fall; 12.7 on 2026-11-04), every row on a flip of pass, expected or observed, every row of a class whose issue is closed. Check first, in the migration comments, each reader of the table that counts rows by class: v_belief_status, v_failure_mode_status (latest row and MAX(verified_at): safe), recurrence_guard_tick, autonomy_selfheal_tick, tick_driver_roster_tick, v_audit_freshness; and make steady_state_cadence count a touched row as a repeat so the 2-hour back-off still applies where no detector exemption holds. Kill switch: ops_config verification_dedupe = off as for issue-linked rows.' || char(10) ||
       'Doer: GitHub Copilot (ASSIGN-COPILOT-ISSUES-1) or any session, coordinating with the holder of scripts/remediation_consumer.py. Definition of done: the closing probe reads under 900 issue-less rows verified in the last 3 hours among the last 3000 ids (2,620 on 2026-11-05T00:20Z) with runtime_verified_share_24h, remediation_latest_pass_pct_7d and issue_wontfix_share_7d no worse.',
       'claude-session', 'cost', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe:%');

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1'' AS expected, CASE WHEN (SELECT COUNT(*) FROM remediation_verifications WHERE id > (SELECT MAX(id) - 3000 FROM remediation_verifications) AND issue_id IS NULL AND verified_at > datetime(''now'', ''-3 hours'')) < 900 THEN ''1'' ELSE ''0'' END AS observed',
    verify_transport = 'd1-query', status = 'active', attempts = 0, next_due_at = datetime('now'),
    precondition = 'C4-FM-CLOSEOUT-1 FM-5: issue-less verification rows in the last 3 hours of the last 3000 ids below 900 (2,620 on 2026-11-05T00:20Z)',
    action = 'C4-FM-CLOSEOUT-1 measuring probe', last_verdict = NULL
WHERE class = 'issue-' || (SELECT id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe:%' ORDER BY id DESC LIMIT 1)
  AND status IN ('active', 'holding', 'needs-machine-probe', 'superseded');

-- The roadmap rows. 1754 was verified on a probe that could not see the stored markup: the status stays, the correction is appended (once). 1756 is implemented (RELAPSE-HOLD-1).
-- 1758 keeps its verified status and gets the measured remainder. Rows 1755 and 1757 are not written.
UPDATE roadmap_implementation
SET evidence = evidence || ' | C4-FM-CLOSEOUT-1 correction (PR 7398, read 2026-11-04T23:40Z): the probe above could not see old rows. 4 ROOT-CAUSE-1 descriptions still held raw tool-call markup (1000306, 1000309, 1000310, 1000558) and 1000303 and 1000558 never received their clean answer (#333, #340), because the cluster-e-c clean-up matched only a description that ended with the placeholder line and the closing probe of 1000717 looked for the placeholder at the end of the description only. The migration removes the markup, rewrites the placeholder and re-arms the two reports; detector fm-diagnosis-raw-markup read 6 before and expects 0. Verify: SELECT COUNT(*) FROM agent_issues WHERE id >= 1000000 AND description LIKE ''%<|tool_call%'' reads 0 and fm-diagnosis-raw-markup passes.'
WHERE id = 1754 AND instr(COALESCE(evidence, ''), 'C4-FM-CLOSEOUT-1') = 0;
UPDATE roadmap_implementation
SET status = 'implemented', artifact_ref = 'migrations/2026-11-04-relapse-hold-1.sql',
    evidence = 'FM-3 shipped as RELAPSE-HOLD-1 (PR 7031, 7065; applied 2026-11-04T17:06:10Z, migration_runs 1149): v_issue_close_hold gives 60 minutes after one or two reopens and 120 after three; both autoclose triggers close a held issue only when the previous row passed and the passes since the last failure and reopen span the hold; ops_config relapse_close_hold = off. Read 2026-11-05T00:20Z: 10 closes of an issue with a prior reopen after 2026-11-04T17:06Z, previous row passed in 10 of 10, spans 62.7 to 473.1 minutes against holds of 60 and 120, 0 violations. The shadow v_close_dwell_shadow reads verified_at that VERIFICATION-DEDUPE-1 moves, so it showed 8 of the first 9 as single-pass; PR 7398 adds v_close_hold_audit (close time from close_evidence) and detector fm-close-hold-violated, expected 0.'
WHERE id = 1756;
UPDATE roadmap_implementation
SET evidence = evidence || ' | C4-FM-CLOSEOUT-1 (PR 7398, read 2026-11-04T23:40Z): of the 5,166 inserts between 17:27Z and 23:43Z (the dedupe went live at 16:03Z) 4,441 have issue_id NULL and about 4,100 repeat the previous row of their class; the dedupe needs an issue and the back-off skips runtime probes and, with RM-FM-CADENCE-1, the fm- and belief- detectors. Filed: issue ROADMAP-1: QNFO.OPS #fm5-issueless-dedupe with a doer and a measuring probe; detector fm-verification-row-volume (rows in 24 hours below 24000).'
WHERE id = 1758 AND instr(COALESCE(evidence, ''), 'C4-FM-CLOSEOUT-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c4-fm',
  'a roadmap row is closed by evidence read from the live rows: a row verified on a probe that cannot see the defect is corrected, a row another session built is left alone',
  'C4-FM-CLOSEOUT-1: scrubbed 4 ROOT-CAUSE-1 descriptions and re-armed 2 reports; v_close_hold_audit; four detectors; the issue-less dedupe follow-up; rows 1754, 1756 and 1758',
  '2026-11-04 qnfo-audit reads: fm-diagnosis-raw-markup probe 6 (4 markup, 2 unappended); 10 of 10 held closes since the hold; 19,127 verification rows in 24 hours; 4,441 of 5,166 inserts issue-less, about 4,100 repeats; 2 of 8 stored doer anchors resolve 0 times (absorbed by ANCHOR-LOCATOR-1)',
  'pending canonical migration; measured by the four detectors', 'ROOT-CAUSE-1 descriptions (4), persona_actions (2 rows), four new contracts, one view, one issue, three roadmap rows',
  'the Rollback line of migrations/2026-11-04-c4-fm-roadmap-closeout.sql with bak_20261104_c4_fm',
  'fm-detectors-real-probes-1',
  'fm-diagnosis-raw-markup 6 to 0 within two hourly runs; fm-close-hold-violated stays 0; remediation_latest_pass_pct_7d, issue_wontfix_share_7d and runtime_verified_share_24h do not worsen',
  'not a reach change; diagnosis quality and closing quality',
  'node:sqlite suite migrations/c4-fm-roadmap-closeout.test.mjs (live-shaped descriptions, hold audit cases, idempotent re-apply); scripts/apply_migrations.py --check; live reads of the same queries on qnfo-audit'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c4-fm' AND capability_gain = 'fm-detectors-real-probes-1');
