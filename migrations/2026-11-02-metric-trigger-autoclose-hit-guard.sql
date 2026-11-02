-- METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1 (2026-11-02, issue 100407, charter pillar autonomy).
-- Live qnfo-audit evidence: issue 99945, METRIC-TRIGGER-5795, was dispositioned and reopened 13 times in 24 h while
-- issue_auto_close_2h_share_24h remained at 0.208 (trigger 5795 hit). An unrelated passing remediation contract closed
-- the metric issue; evaluateMetricTriggers reopened it because its own trigger still reported a breach.
-- Defer remediation auto-close for enabled METRIC-TRIGGER issues while their trigger is hit or unreadable. Keep the existing
-- two-pass hysteresis, and preserve ordinary issue closures and metric-trigger closures after measured recovery.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_metric_trigger_autoclose
-- Rollback: restore both trigger definitions and the prior autoclose-hysteresis, autoclose-flap, and fm-autoclose-flap contract values from bak_20261102_metric_trigger_autoclose; decision_log is append-only

CREATE TABLE IF NOT EXISTS bak_20261102_metric_trigger_autoclose (
  kind TEXT NOT NULL,
  record_key TEXT NOT NULL,
  old_value TEXT NOT NULL,
  PRIMARY KEY (kind, record_key)
);

INSERT OR IGNORE INTO bak_20261102_metric_trigger_autoclose (kind, record_key, old_value)
SELECT 'trigger', name, sql FROM sqlite_master
WHERE type = 'trigger' AND name IN ('remediation_verification_autoclose_ins', 'remediation_verification_autoclose_upd');

INSERT OR IGNORE INTO bak_20261102_metric_trigger_autoclose (kind, record_key, old_value)
SELECT 'control', control, json_object(
  'location', location, 'guards_against', guards_against, 'critical_path', critical_path,
  'disposition', disposition, 'disposition_state', disposition_state, 'alternate_path', alternate_path,
  'alternate_tested_at', alternate_tested_at, 'evidence', evidence, 'issue_id', issue_id
)
FROM control_registry WHERE control = 'autoclose-hysteresis';

INSERT OR IGNORE INTO bak_20261102_metric_trigger_autoclose (kind, record_key, old_value)
SELECT 'failure_mode', fm_key, json_object(
  'failure_mode', failure_mode, 'root_cause', root_cause, 'remediation', remediation,
  'detector', detector, 'symptom', symptom, 'blast_radius', blast_radius
)
FROM failure_modes WHERE fm_key = 'autoclose-flap';

INSERT OR IGNORE INTO bak_20261102_metric_trigger_autoclose (kind, record_key, old_value)
SELECT 'contract', class, json_object('action', action, 'verify_probe', verify_probe)
FROM remediation_contracts WHERE class = 'fm-autoclose-flap';

DROP TRIGGER IF EXISTS remediation_verification_autoclose_ins;
CREATE TRIGGER remediation_verification_autoclose_ins AFTER INSERT ON remediation_verifications
WHEN NEW.pass = 1
  AND NOT EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers mt
      ON substr(a.title, 1, length('METRIC-TRIGGER-' || mt.id || '-')) = 'METRIC-TRIGGER-' || mt.id || '-'
    LEFT JOIN v_metric_trigger_state ms ON ms.id = mt.id
    WHERE a.id = NEW.issue_id AND mt.enabled = 1 AND COALESCE(ms.hit, 1) <> 0
  )
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts c2 WHERE c2.issue_id = NEW.issue_id AND c2.class <> COALESCE(NEW.class, '')
                  AND c2.status IN ('active', 'holding')
                  AND (SELECT v2.pass FROM remediation_verifications v2 WHERE v2.class = c2.class AND COALESCE(v2.observed, '') <> ''
                       AND (lower(trim(v2.observed)) NOT LIKE 'pending%' OR (v2.observed GLOB '*[0-9]*' AND (v2.observed LIKE '%ceiling%' OR lower(v2.observed) LIKE '%target%' OR lower(v2.observed) LIKE '%threshold%' OR lower(v2.observed) LIKE '%limit%' OR lower(v2.observed) LIKE '%fewer than%' OR lower(v2.observed) LIKE '%more than%' OR v2.observed LIKE '% <= %' OR v2.observed LIKE '% >= %' OR v2.observed LIKE '% < %' OR v2.observed LIKE '% > %'))) ORDER BY v2.id DESC LIMIT 1) = 0)
  AND (COALESCE((SELECT t.reopened_count FROM issue_triage t WHERE t.issue_id = NEW.issue_id), 0) = 0
       OR (SELECT v3.pass FROM remediation_verifications v3 WHERE v3.class = NEW.class AND v3.id < NEW.id AND COALESCE(v3.observed, '') <> ''
           AND (lower(trim(v3.observed)) NOT LIKE 'pending%' OR (v3.observed GLOB '*[0-9]*' AND (v3.observed LIKE '%ceiling%' OR lower(v3.observed) LIKE '%target%' OR lower(v3.observed) LIKE '%threshold%' OR lower(v3.observed) LIKE '%limit%' OR lower(v3.observed) LIKE '%fewer than%' OR lower(v3.observed) LIKE '%more than%' OR v3.observed LIKE '% <= %' OR v3.observed LIKE '% >= %' OR v3.observed LIKE '% < %' OR v3.observed LIKE '% > %'))) ORDER BY v3.id DESC LIMIT 1) = 1)
  AND NOT (COALESCE((SELECT t4.reopened_count FROM issue_triage t4 WHERE t4.issue_id = NEW.issue_id), 0) >= 1
           AND EXISTS (SELECT 1 FROM remediation_contracts cv WHERE cv.issue_id = NEW.issue_id AND cv.status IN ('active', 'holding') AND cv.action LIKE 'VACUOUS-PROBE%'))
BEGIN
  INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence)
  SELECT NEW.issue_id, 'verified-remediation', 'closed', 'fleet-autoremediation', datetime('now','+7 days'),
         'remediation_verifications#' || NEW.id || ' pass=1 class=' || COALESCE(NEW.class,'') || ' transport=' || NEW.transport || ' verified_at=' || COALESCE(NEW.verified_at, datetime('now'))
  WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = NEW.issue_id AND status = 'open')
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'))
  ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence WHERE COALESCE(issue_triage.close_evidence,'') = '';
  UPDATE agent_issues SET status='closed', close_channel='auto:verified-remediation-trigger', updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE id = NEW.issue_id AND status = 'open'
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'));
END;

DROP TRIGGER IF EXISTS remediation_verification_autoclose_upd;
CREATE TRIGGER remediation_verification_autoclose_upd AFTER UPDATE OF pass ON remediation_verifications
WHEN NEW.pass = 1 AND COALESCE(OLD.pass,0) <> 1
  AND NOT EXISTS (
    SELECT 1
    FROM agent_issues a
    JOIN analytics_metric_triggers mt
      ON substr(a.title, 1, length('METRIC-TRIGGER-' || mt.id || '-')) = 'METRIC-TRIGGER-' || mt.id || '-'
    LEFT JOIN v_metric_trigger_state ms ON ms.id = mt.id
    WHERE a.id = NEW.issue_id AND mt.enabled = 1 AND COALESCE(ms.hit, 1) <> 0
  )
  AND NOT EXISTS (SELECT 1 FROM remediation_contracts c2 WHERE c2.issue_id = NEW.issue_id AND c2.class <> COALESCE(NEW.class, '')
                  AND c2.status IN ('active', 'holding')
                  AND (SELECT v2.pass FROM remediation_verifications v2 WHERE v2.class = c2.class AND COALESCE(v2.observed, '') <> ''
                       AND (lower(trim(v2.observed)) NOT LIKE 'pending%' OR (v2.observed GLOB '*[0-9]*' AND (v2.observed LIKE '%ceiling%' OR lower(v2.observed) LIKE '%target%' OR lower(v2.observed) LIKE '%threshold%' OR lower(v2.observed) LIKE '%limit%' OR lower(v2.observed) LIKE '%fewer than%' OR lower(v2.observed) LIKE '%more than%' OR v2.observed LIKE '% <= %' OR v2.observed LIKE '% >= %' OR v2.observed LIKE '% < %' OR v2.observed LIKE '% > %'))) ORDER BY v2.id DESC LIMIT 1) = 0)
  AND (COALESCE((SELECT t.reopened_count FROM issue_triage t WHERE t.issue_id = NEW.issue_id), 0) = 0
       OR (SELECT v3.pass FROM remediation_verifications v3 WHERE v3.class = NEW.class AND v3.id < NEW.id AND COALESCE(v3.observed, '') <> ''
           AND (lower(trim(v3.observed)) NOT LIKE 'pending%' OR (v3.observed GLOB '*[0-9]*' AND (v3.observed LIKE '%ceiling%' OR lower(v3.observed) LIKE '%target%' OR lower(v3.observed) LIKE '%threshold%' OR lower(v3.observed) LIKE '%limit%' OR lower(v3.observed) LIKE '%fewer than%' OR lower(v3.observed) LIKE '%more than%' OR v3.observed LIKE '% <= %' OR v3.observed LIKE '% >= %' OR v3.observed LIKE '% < %' OR v3.observed LIKE '% > %'))) ORDER BY v3.id DESC LIMIT 1) = 1)
  AND NOT (COALESCE((SELECT t4.reopened_count FROM issue_triage t4 WHERE t4.issue_id = NEW.issue_id), 0) >= 1
           AND EXISTS (SELECT 1 FROM remediation_contracts cv WHERE cv.issue_id = NEW.issue_id AND cv.status IN ('active', 'holding') AND cv.action LIKE 'VACUOUS-PROBE%'))
BEGIN
  INSERT INTO issue_triage (issue_id, rc, triage_state, owner, sla_due_at, close_evidence)
  SELECT NEW.issue_id, 'verified-remediation', 'closed', 'fleet-autoremediation', datetime('now','+7 days'),
         'remediation_verifications#' || NEW.id || ' pass=1 class=' || COALESCE(NEW.class,'') || ' transport=' || NEW.transport || ' verified_at=' || COALESCE(NEW.verified_at, datetime('now'))
  WHERE EXISTS (SELECT 1 FROM agent_issues WHERE id = NEW.issue_id AND status = 'open')
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'))
  ON CONFLICT(issue_id) DO UPDATE SET close_evidence = excluded.close_evidence WHERE COALESCE(issue_triage.close_evidence,'') = '';
  UPDATE agent_issues SET status='closed', close_channel='auto:verified-remediation-trigger', updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE id = NEW.issue_id AND status = 'open'
    AND NOT EXISTS (SELECT 1 FROM remediation_contracts cb WHERE cb.issue_id = NEW.issue_id AND cb.status IN ('active', 'holding')
                    AND COALESCE(cb.last_verdict, '') IN ('fail', 'vacuous-probe-result', 'probe-error', 'probe-not-machine-executable', 'probe-same-account-host'));
END;

UPDATE control_registry
SET location = 'qnfo-audit triggers remediation_verification_autoclose_ins and _upd (AUTOCLOSE-HYSTERESIS-1; METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1)',
    guards_against = 'an issue whose probe flaps closing and reopening every hour; a METRIC-TRIGGER issue closed by an unrelated passing remediation while its own metric remains hit or unreadable',
    disposition = 'keep',
    disposition_state = 'applied',
    alternate_path = 'first closures of non-metric issues stay one pass; reopened issues still require two consecutive passes; an enabled metric trigger that is hit or unreadable keeps its matching METRIC-TRIGGER issue open, while evaluateMetricTriggers closes it after measured recovery',
    alternate_tested_at = '2026-11-02',
    evidence = 'AUTOCLOSE-HYSTERESIS-1: issues 2087, 2193, 2322 and 2327 cycled on single passes (2026-10-12/13), so reopened issues need two consecutive passes. METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1: live qnfo-audit 2026-11-02 issue 99945 (trigger 5795) cycled 13 times in 24 h while its metric remained 0.208 and hit=1; both remediation autoclose triggers now defer a matching metric issue until hit=0.'
WHERE control = 'autoclose-hysteresis';

UPDATE failure_modes
SET root_cause = 'The autoclose triggers can close a METRIC-TRIGGER issue on an unrelated passing remediation verification even when its own enabled trigger remains hit; evaluateMetricTriggers then reopens the same issue. Live issue 99945 (trigger 5795) cycled 13 times in 24 h at metric value 0.208.',
    remediation = 'METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1: both autoclose triggers defer while the matching enabled metric trigger is hit or unreadable; retain the existing two-pass hysteresis and allow closure after measured recovery.',
    detector = 'fm-autoclose-flap: both autoclose triggers contain the active metric-trigger recovery guard; no currently hit metric-trigger issue is auto-closed by a remediation verification',
    symptom = 'The same issue id closes on an unrelated verification pass and is reopened while its metric trigger remains hit; repeated dispositions inflate closure_branching_ratio_24h.',
    blast_radius = 'Issue counts oscillate, metric-trigger issues appear resolved without metric recovery, and each reopen adds a false closure-branch event.'
WHERE fm_key = 'autoclose-flap';

UPDATE remediation_contracts
SET action = 'Both remediation autoclose triggers retain reopened_count hysteresis and defer a METRIC-TRIGGER issue while its enabled trigger is hit or unreadable; ordinary issues and recovered metric-trigger issues retain their normal closure path.',
    verify_probe = 'SELECT ''2'' AS expected, CAST((SELECT COUNT(*) FROM sqlite_master WHERE type = ''trigger'' AND name IN (''remediation_verification_autoclose_ins'', ''remediation_verification_autoclose_upd'') AND instr(sql, ''COALESCE(ms.hit, 1) <> 0'') > 0) AS TEXT) AS observed'
WHERE class = 'fm-autoclose-flap';

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session copilot-closure-branching-100407',
  'A passing remediation contract does not prove that a separate metric-triggered issue recovered; its own enabled trigger must be measured clear before remediation autoclose can disposition it.',
  'METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1: guard both remediation autoclose triggers against closing a matching metric-trigger issue while its trigger is hit or unreadable; preserve the existing hysteresis and recovery evaluator.',
  'Read-only qnfo-audit probe 2026-11-02: closure_branching_ratio_24h=0.518; issue 99945 had 13 reopen events in 24 h; trigger 5795 remained hit at issue_auto_close_2h_share_24h=0.208 when a passing fm-issue-age-repair-untrusted verification dispositioned it.',
  'queued for CI migration; live post-deploy verification pending',
  'Two qnfo-audit remediation autoclose triggers and their existing control/failure-mode contract; ordinary issues and metric issues with a measured-clear trigger remain eligible for closure.',
  'Restore both trigger definitions and the prior registry values from bak_20261102_metric_trigger_autoclose; decision_log remains append-only.',
  'A metric-trigger issue cannot be auto-closed by an unrelated passing remediation while its own enabled trigger is hit or unreadable.',
  'No further remediation-verification disposition/reopen cycles for metric-trigger issues whose own trigger remains hit; closure_branching_ratio_24h moves down from 0.518 without weakening ordinary issue closure.',
  'Improves evidence-backed closure reliability and prevents repeated false resolutions from consuming issue lifecycle capacity.',
  'migrations/metric-trigger-autoclose-hit-guard.test.mjs; live qnfo-audit reads of issue_lifecycle, analytics_metric_triggers, v_metric_trigger_state and remediation_verifications'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'METRIC-TRIGGER-AUTOCLOSE-HIT-GUARD-1:%');
