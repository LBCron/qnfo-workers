-- RELAPSE-COHORT-2 (2026-11-04, charter pillar autonomy): count only the closes the hold governs when deciding to keep it.
-- Why (read from qnfo-audit at 2026-11-04T19:45Z, 2h39m after RELAPSE-HOLD-1 went live): 234 closes since 17:06:10Z, but only 31 came through remediation_verification_autoclose_ins/_upd
-- (close_channel auto:verified-remediation-trigger); 108 came from auto:triage-sync:qnfo-fleet-control (a batch), 54 from the ISSUE-HYGIENE-1 d1-overload-superseded workflow (43 of them CF-OBS), 16 from
-- conflict-repair, 7 from triage-resolved-sync, 6 from ux-journeys. The headline metrics moved (closure_branching_ratio_24h 0.509 to 0.396, issue_drain_ratio_24h 0.76 to 1.05, issues_open_over_120m 298
-- to 150) mostly because of those bulk closes, which never pass through the hold and rarely relapse. Judged on the 24 h ratio they would make the hold look better than it is, and a keep decided on them
-- would be a false keep. v_relapse_6h_cohort therefore gets the close channel as a column, and the keep-or-revert reading on issue 1001754 is restricted to the gated channel.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: recreate v_relapse_6h_cohort from migrations/2026-11-04-relapse-6h-cohort.sql (it has no channel column); the appended paragraph on issue 1001754 is harmless.
-- BACKUP: bak_20261104_relapse_6h_cohort_view
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_relapse_6h_cohort_view AS SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_relapse_6h_cohort';

DROP VIEW IF EXISTS v_relapse_6h_cohort;
CREATE VIEW v_relapse_6h_cohort AS
WITH t AS (SELECT COALESCE((SELECT value FROM ops_config WHERE key = 'relapse_hold_since'), '2026-11-04T17:06:10Z') AS since),
c AS (
  SELECT l.issue_id, l.ts,
    EXISTS (SELECT 1 FROM issue_lifecycle r WHERE r.issue_id = l.issue_id AND r.event = 'reopened' AND r.ts > l.ts
              AND r.ts <= strftime('%Y-%m-%dT%H:%M:%SZ', l.ts, '+6 hours')) AS relapsed
  FROM issue_lifecycle l, t
  WHERE l.event = 'dispositioned'
    AND l.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', t.since, '-7 days')
    AND l.ts <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-6 hours')
)
SELECT CASE WHEN c.ts >= t.since THEN 'after' ELSE 'before' END AS cohort,
  CASE WHEN a.title LIKE 'METRIC-TRIGGER-%' THEN 'METRIC-TRIGGER'
       ELSE substr(a.title, 1, MIN(CASE WHEN instr(a.title, ' ') > 0 THEN instr(a.title, ' ') ELSE 999 END,
                                    CASE WHEN instr(a.title, ':') > 0 THEN instr(a.title, ':') ELSE 999 END) - 1) END AS family,
  COALESCE(a.close_channel, '-') AS channel,
  COUNT(*) AS closes, SUM(c.relapsed) AS relapsed_6h, ROUND(1.0 * SUM(c.relapsed) / COUNT(*), 3) AS rate_6h
FROM c JOIN t JOIN agent_issues a ON a.id = c.issue_id
GROUP BY 1, 2, 3;

UPDATE agent_issues
SET description = description || char(10) || 'Decision reading (RELAPSE-COHORT-2): restrict to the path the hold governs, SELECT cohort, SUM(closes) AS closes, SUM(relapsed_6h) AS relapsed_6h, ROUND(1.0 * SUM(relapsed_6h) / SUM(closes), 3) AS rate_6h FROM v_relapse_6h_cohort WHERE channel = ''auto:verified-remediation-trigger'' GROUP BY cohort. The all-channel reading above and the 24 h ratio are inflated by bulk closes that never pass through the hold (2h39m after the deploy: 234 closes, 31 through the gated channel, 108 by triage-sync, 54 by the ISSUE-HYGIENE-1 workflow); a keep decided on them would be a false keep. Note that close_channel holds the latest close only, so the before cohort is approximate for issues closed again since.',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title = 'RELAPSE-HOLD-1 measure: keep or revert the close hold by the 7-day reading' AND status = 'open' AND instr(description, 'RELAPSE-COHORT-2') = 0;
