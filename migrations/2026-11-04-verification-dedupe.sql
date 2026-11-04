-- VERIFICATION-DEDUPE-1 (2026-11-04, pillar cost; owner: "table rows are bloated and need to be regularly swept").
-- Evidence (qnfo-audit, 24 h to 2026-11-04T16Z): remediation_verifications took 13,626 rows; 6,575 failing rows (48%) repeated the previous row of
-- their class (same issue, expected and observed) on an issue that was still open, and 4,180 passing rows (31%) repeated a pass on an issue that was
-- already closed. Each row costs 13 index writes and is scanned by the guard and relapse views.
-- Change: a BEFORE INSERT trigger touches the previous row (verified_at, verifier) and ignores the insert when
--   (a) the row fails, repeats the class's latest row, and the issue is not closed/resolved (a closed issue keeps every failing row: remediation_reopen_on_relapse_d1 counts them), or
--   (b) the row passes, repeats the class's latest row, and the issue is already closed/resolved (an open issue keeps every pass: autoclose_ins may fire on a later one).
-- A changed observed or expected, a flip of pass, and every row of a closed-then-failing class are stored as before. Freshness (verified_at of the latest row) is kept by the touch.
-- Kill switch without a deploy: ops_config verification_dedupe = off.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS remediation_verification_dedupe_ins; DELETE FROM control_alternate_probes WHERE control = 'verification-dedupe'; DELETE FROM control_registry WHERE control = 'verification-dedupe';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TRIGGER IF NOT EXISTS remediation_verification_dedupe_ins BEFORE INSERT ON remediation_verifications
WHEN NEW.class IS NOT NULL AND NEW.issue_id IS NOT NULL
  AND COALESCE((SELECT value FROM ops_config WHERE key = 'verification_dedupe'), 'on') <> 'off'
  AND EXISTS (SELECT 1 FROM (SELECT pass, expected, observed, issue_id FROM remediation_verifications WHERE class = NEW.class ORDER BY id DESC LIMIT 1) p
              WHERE p.pass = NEW.pass AND p.expected IS NEW.expected AND p.observed IS NEW.observed AND p.issue_id IS NEW.issue_id)
  AND ((NEW.pass = 0 AND NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = NEW.issue_id AND a.status IN ('closed', 'resolved')))
    OR (NEW.pass = 1 AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id = NEW.issue_id AND a.status IN ('closed', 'resolved'))))
BEGIN
  UPDATE remediation_verifications SET verified_at = NEW.verified_at, verifier = NEW.verifier
  WHERE id = (SELECT id FROM remediation_verifications WHERE class = NEW.class ORDER BY id DESC LIMIT 1);
  SELECT RAISE(IGNORE);
END;

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence)
VALUES ('verification-dedupe', 'trigger remediation_verification_dedupe_ins on remediation_verifications', 'filter',
  'row growth and index write cost from identical repeat verifications (13,626 rows a day, 79% of them repeats of the previous row of their class)',
  0, 'keep', 'applied', 'ops_config verification_dedupe = off stores every row again without a deploy (offline suite migrations/verification-dedupe.test.mjs, case H1)',
  '24 h to 2026-11-04T16Z: 6,575 repeat failures on open issues and 4,180 repeat passes on closed issues; a closed issue keeps every failing row (relapse counting) and an open issue keeps every pass (autoclose)');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled)
VALUES ('verification-dedupe',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM ops_config WHERE key = ''verification_dedupe'') OR EXISTS (SELECT 1 FROM ops_config WHERE key = ''verification_dedupe'' AND value IN (''on'', ''off'')) THEN ''ok'' ELSE ''ops_config verification_dedupe holds a value the trigger does not read (use on or off), so the kill switch cannot be trusted'' END AS observed',
  '60', 1);
