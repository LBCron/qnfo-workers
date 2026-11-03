-- MONITORING-PASS-1 auto-close isolation (agent_issues 1000744, charter pillar autonomy).
-- Monitoring passes measure an open issue without taking ownership of its resolution; a pass in this ledger must not close that issue.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_monitoring_pass_autoclose
-- Rollback: DROP TRIGGER IF EXISTS remediation_verification_autoclose_ins; DROP TRIGGER IF EXISTS remediation_verification_autoclose_upd; restore both saved trigger definitions from bak_20261103_monitoring_pass_autoclose

CREATE TABLE IF NOT EXISTS bak_20261103_monitoring_pass_autoclose (
  kind TEXT NOT NULL,
  record_key TEXT NOT NULL,
  old_value TEXT NOT NULL,
  PRIMARY KEY (kind, record_key)
);

INSERT OR IGNORE INTO bak_20261103_monitoring_pass_autoclose (kind, record_key, old_value)
SELECT 'trigger', name, sql FROM sqlite_master
WHERE type = 'trigger' AND name IN ('remediation_verification_autoclose_ins', 'remediation_verification_autoclose_upd');

INSERT OR IGNORE INTO bak_20261103_monitoring_pass_autoclose (kind, record_key, old_value)
SELECT 'control', control, json_object(
  'location', location, 'guards_against', guards_against, 'critical_path', critical_path,
  'disposition', disposition, 'disposition_state', disposition_state, 'alternate_path', alternate_path,
  'alternate_tested_at', alternate_tested_at, 'evidence', evidence, 'issue_id', issue_id
)
FROM control_registry WHERE control = 'autoclose-hysteresis';

DROP TRIGGER IF EXISTS remediation_verification_autoclose_ins;
CREATE TRIGGER remediation_verification_autoclose_ins AFTER INSERT ON remediation_verifications
WHEN NEW.pass = 1
  AND COALESCE(NEW.verifier, '') NOT LIKE 'qnfo-fleet-control/monitoring-pass@%'
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
  AND COALESCE(NEW.verifier, '') NOT LIKE 'qnfo-fleet-control/monitoring-pass@%'
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
SET disposition = 'keep',
    disposition_state = 'applied',
    alternate_path = 'Monitoring verification rows use qnfo-fleet-control/monitoring-pass@VERSION and are excluded from both auto-close triggers; ordinary remediation verifications retain the existing hysteresis and measured metric-trigger guard.',
    alternate_tested_at = '2026-11-03',
    evidence = 'MONITORING-PASS-1 (#1000744): hourly monitoring writes real verification rows for open issues without taking resolution actions. The insert and update autoclose triggers exclude only its verifier prefix; ordinary verifier behavior is preserved and covered by qnfo-fleet-control/monitoring-pass.test.mjs.'
WHERE control = 'autoclose-hysteresis';

INSERT OR IGNORE INTO capability_ledger (capability, provenance, prerequisites, reliability, acquired_at, last_exercised_at, evidence)
VALUES (
  'open-issue-monitoring-verification',
  'qnfo-fleet-control MONITORING-PASS-1 (#1000744)',
  'Monitoring contract has status monitoring, a d1-query transport, and an open issue',
  'Bounded at 60 contracts per tick; stores one measured verification without changing the contract state or auto-closing the issue',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  NULL,
  'qnfo-fleet-control/monitoring-pass@VERSION verification rows; qnfo-fleet-control/monitoring-pass.test.mjs exercises issue-state isolation'
);

INSERT INTO decision_log (
  actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
  capability_gain, predicted_outcome, reach_gain, surfaces_tested
)
VALUES (
  'qnfo-fleet-control/monitoring-pass',
  'Open issues with monitoring contracts still need a fresh probe row, but monitoring is not an issue-resolution action.',
  'Keep the autoclose guard and exclude only monitoring-pass verification rows from the insert and update close triggers.',
  'Issue 1000744 requires a monitoring verification every 55 minutes for open d1-query contracts and forbids closing or mutating the contract.',
  'Monitoring rows are observable without changing issue status; ordinary remediation auto-close remains unchanged.',
  'qnfo-audit remediation_verifications and open issues whose monitoring contracts are due; only the qnfo-fleet-control monitoring verifier prefix is exempt.',
  'Restore the trigger definitions saved in bak_20261103_monitoring_pass_autoclose and revert the worker source/mirror together.',
  'A bounded hourly verification path for open issues that preserves issue ownership and contract state.',
  'Monitoring contracts older than 55 minutes gain a real verification row; contract statuses and issue states remain unchanged.',
  'Expected to reduce issues_unprobed_60m from the live baseline of 113 (refreshed 2026-11-03T06:40:23Z) to below 20 after deployment, with no increase in false closures.',
  'qnfo-fleet-control/monitoring-pass.test.mjs; remediation-contract query LIMIT 60; autoclose insert/update trigger tests'
);
