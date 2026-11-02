-- TRIGGER-ORDER-1 (issue 1001259; charter pillar autonomy).
-- Retire superseded/moot contracts in the same trigger, before closing the issue.
-- SQLite does not guarantee sibling trigger order; both insert and update need this.
-- Keep the existing close guard, status mapping, evidence rules and channel intact.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_triage_close_sync_triggers
-- Rollback: recreate triage_close_sync_issue_upd and triage_close_sync_issue_ins from bak_20261102_triage_close_sync_triggers (DROP TRIGGER, then run each saved sql); DELETE FROM remediation_contracts WHERE class = 'fm-triage-close-trigger-order'; DELETE FROM failure_modes WHERE fm_key = 'triage-close-trigger-order';

CREATE TABLE IF NOT EXISTS bak_20261102_triage_close_sync_triggers AS
SELECT type, name, tbl_name, sql, strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS backed_up_at
FROM sqlite_master
WHERE type = 'trigger' AND name IN ('triage_close_sync_issue_upd', 'triage_close_sync_issue_ins');

DROP TRIGGER IF EXISTS triage_close_sync_issue_upd;
CREATE TRIGGER triage_close_sync_issue_upd
AFTER UPDATE OF triage_state ON issue_triage
WHEN NEW.triage_state IN ('closed','closed-refuted','wontfix')
BEGIN
  UPDATE remediation_contracts
  SET status = 'superseded', last_verdict = 'superseded:closure-superseded', last_attempt_at = datetime('now')
  WHERE issue_id = NEW.issue_id
    AND status IN ('active', 'holding', 'needs-machine-probe', 'probe-review-refused')
    AND NEW.triage_state = 'closed'
    AND (lower(substr(COALESCE(NEW.close_evidence, ''), 1, 10)) = 'superseded'
      OR lower(substr(COALESCE(NEW.close_evidence, ''), 1, 4)) = 'moot');

  UPDATE agent_issues
  SET status = CASE WHEN NEW.triage_state='wontfix' THEN 'wontfix' ELSE 'closed' END,
      close_channel = COALESCE(close_channel, 'auto:triage-sync' || CASE WHEN COALESCE(NEW.owner, '') <> '' THEN ':' || NEW.owner ELSE '' END),
      updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE id = NEW.issue_id AND status='open';
END;

DROP TRIGGER IF EXISTS triage_close_sync_issue_ins;
CREATE TRIGGER triage_close_sync_issue_ins
AFTER INSERT ON issue_triage
WHEN NEW.triage_state IN ('closed','closed-refuted','wontfix')
BEGIN
  UPDATE remediation_contracts
  SET status = 'superseded', last_verdict = 'superseded:closure-superseded', last_attempt_at = datetime('now')
  WHERE issue_id = NEW.issue_id
    AND status IN ('active', 'holding', 'needs-machine-probe', 'probe-review-refused')
    AND NEW.triage_state = 'closed'
    AND (lower(substr(COALESCE(NEW.close_evidence, ''), 1, 10)) = 'superseded'
      OR lower(substr(COALESCE(NEW.close_evidence, ''), 1, 4)) = 'moot');

  UPDATE agent_issues
  SET status = CASE WHEN NEW.triage_state='wontfix' THEN 'wontfix' ELSE 'closed' END,
      close_channel = COALESCE(close_channel, 'auto:triage-sync' || CASE WHEN COALESCE(NEW.owner, '') <> '' THEN ':' || NEW.owner ELSE '' END),
      updated_at = CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE id = NEW.issue_id AND status='open';
END;

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius)
VALUES
  ('triage-close-trigger-order', 'superseded triage closes abort before their failing contracts retire',
   'sibling AFTER triggers made contract retirement depend on undocumented trigger creation order',
   'TRIGGER-ORDER-1: retire superseded/moot contracts inside each close-sync trigger before the issue status write',
   'both close-sync triggers contain contract retirement before issue closure', 'fm-triage-close-trigger-order',
   '2026-11-02', 1001259, 'triage closes an issue with a failing contract as superseded or moot',
   'close-while-contract-fails aborts a valid supersession', 'triage closures and CI-applied migrations');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-triage-close-trigger-order', NULL, 'TRIGGER-ORDER-1', 'failure-mode detector',
   'SELECT ''2'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM sqlite_master WHERE type = ''trigger'' AND name IN (''triage_close_sync_issue_upd'', ''triage_close_sync_issue_ins'') AND instr(sql, ''superseded:closure-superseded'') > 0 AND instr(sql, ''superseded:closure-superseded'') < instr(sql, ''agent_issues'')',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');
