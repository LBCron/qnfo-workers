-- IL-NONFIX-CLOSURE-1 (2026-11-05, pillar autonomy; metrics fix_hold_rate_30d, issue_relapse_families_7d, open_agent_issues). Companion of qnfo-fleet-control 0.68.1 (same pull request).
-- WHAT WAS READ (qnfo-audit, 2026-11-05 04Z): the improvement loop installs a post-close monitor (module improvement-relapse, class metric-relapse-<id>) on every closed METRIC-TRIGGER ticket and
--   judges it "did the fix hold". 67 of the 276 such closures of the last 31 days were closed as superseded by a successor ticket or as moot, which fixes nothing: 27 of the 48 relapses behind
--   fix_hold_rate_30d 0.6923 (108 held of 156) were them, and a monitor on a metric that is still off its trigger reopens the closed ticket the day after (the loop issue 2816 needed
--   migrations/2026-11-02-orphan-metric-successor.sql to stop by hand). The worker no longer judges or monitors such closures; this file settles the monitors it had already installed.
-- WHAT THIS FILE ADDS: every improvement-relapse monitor in status active, holding or escalated on a CLOSED issue whose close_evidence starts with "superseded" or "moot:" (any case) is set to
--   status superseded, last_verdict superseded:nonfix-closure; before-state in bak_20261105_il_nonfix_monitors. Plus the detector fm-nonfix-relapse-monitor (expected 0), which also catches
--   the monitors the loop writes between this file and the worker deploy.
-- Prediction: fix_hold_rate_30d rises from 0.6923 to >= 0.8 at the first improvement tick after the 0.68.1 deploy (about 98 held of 119 judged); no closed superseded or moot ticket reopens on a relapse
--   contract; closes_7d and reopens_7d of the METRIC-TRIGGER family fall together.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET status = (SELECT b.status FROM bak_20261105_il_nonfix_monitors b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_il_nonfix_monitors b WHERE b.class = remediation_contracts.class), next_due_at = (SELECT b.next_due_at FROM bak_20261105_il_nonfix_monitors b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_il_nonfix_monitors); DELETE FROM remediation_contracts WHERE class = 'fm-nonfix-relapse-monitor'; DELETE FROM failure_modes WHERE fm_key = 'nonfix-relapse-monitor';
-- Closing probe: SELECT COUNT(*) FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id JOIN issue_triage t ON t.issue_id = a.id WHERE c.module = 'improvement-relapse' AND c.status IN ('active', 'holding', 'escalated') AND a.status = 'closed' AND (lower(substr(trim(COALESCE(t.close_evidence, '')), 1, 10)) = 'superseded' OR lower(substr(trim(COALESCE(t.close_evidence, '')), 1, 5)) = 'moot:'); -- 0

CREATE TABLE IF NOT EXISTS bak_20261105_il_nonfix_monitors AS
SELECT c.class AS class, c.issue_id AS issue_id, c.status AS status, c.last_verdict AS last_verdict, c.next_due_at AS next_due_at
FROM remediation_contracts c
JOIN agent_issues a ON a.id = c.issue_id
JOIN issue_triage t ON t.issue_id = a.id
WHERE c.module = 'improvement-relapse' AND c.status IN ('active', 'holding', 'escalated')
  AND a.status = 'closed'
  AND (lower(substr(trim(COALESCE(t.close_evidence, '')), 1, 10)) = 'superseded' OR lower(substr(trim(COALESCE(t.close_evidence, '')), 1, 5)) = 'moot:');

UPDATE remediation_contracts
SET status = 'superseded', last_verdict = 'superseded:nonfix-closure (IL-NONFIX-CLOSURE-1)', next_due_at = NULL, last_attempt_at = datetime('now')
WHERE class IN (SELECT class FROM bak_20261105_il_nonfix_monitors) AND status IN ('active', 'holding', 'escalated');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES ('nonfix-relapse-monitor', 'a superseded or moot ticket is judged and monitored as if a fix had been made, so its closed ticket reopens and fix_hold_rate_30d counts a relapse nobody caused',
  'the improvement loop selected every closed METRIC-TRIGGER ticket for the durability judgement and the relapse monitor, whatever closed it',
  'IL-NONFIX-CLOSURE-1: ilNonFixClosure (qnfo-fleet-control 0.68.1) leaves closures whose evidence starts "superseded" or "moot:" out of fix_hold_rate_30d and out of the monitors; this file supersedes the monitors already installed',
  'improvement-relapse contracts in status active, holding or escalated on closed superseded or moot tickets',
  'fm-nonfix-relapse-monitor', '2026-11-05', 99927);

INSERT OR IGNORE INTO remediation_contracts
  (class, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES ('fm-nonfix-relapse-monitor', 'IL-NONFIX-CLOSURE-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts c JOIN agent_issues a ON a.id = c.issue_id JOIN issue_triage t ON t.issue_id = a.id WHERE c.module = ''improvement-relapse'' AND c.status IN (''active'', ''holding'', ''escalated'') AND a.status = ''closed'' AND (lower(substr(trim(COALESCE(t.close_evidence, '''')), 1, 10)) = ''superseded'' OR lower(substr(trim(COALESCE(t.close_evidence, '''')), 1, 5)) = ''moot:'')) AS TEXT) AS observed',
  'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issue-backlog', 'closing a ticket because a successor carries its metric is not a fix, so it has no durability to judge',
  'IL-NONFIX-CLOSURE-1', '67 of 276 metric-ticket closures in 31 days were superseded or moot; 27 of the 48 relapses behind fix_hold_rate_30d 0.6923 were them (improvement loop GET /improvement)',
  'pending CI apply, qnfo-fleet-control 0.68.1 deploy and the next improvement tick', 'improvement-relapse monitors of closed superseded or moot tickets; fix_hold_rate_30d numerator and denominator',
  'Rollback line in migrations/2026-11-05-il-nonfix-closure.sql', 'fix_hold_rate_30d measures remediations only; the strict view fix_target_hold_rate_30d keeps every closure',
  'fix_hold_rate_30d >= 0.8 at the first tick after the deploy; fix_target_hold_rate_30d unchanged', 'none', 'live read-only D1 diagnosis; offline suites qnfo-fleet-control/improvement-nonfix-closure.test.mjs and migrations/il-nonfix-closure.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = 'IL-NONFIX-CLOSURE-1');
