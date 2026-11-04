-- RELAPSE-COHORT-1 (2026-11-04, charter pillar autonomy): a lag-free reading for the RELAPSE-HOLD-1 keep-or-revert decision (agent_issues 1001754).
-- Why: reopens trail their close by hours (qnfo-audit, 7 days to 2026-11-04: 28 % of relapses within 1 h, 44 % within 2 h, 70 % within 6 h), so the 24 h ratio closure_branching_ratio_24h still counts
-- reopens of issues that were closed BEFORE the change for about 6 hours after it. At 96 minutes after the deploy 8 of 11 reopens were such issues. This view compares closes the same way on both
-- sides of the change: of the closes that have had at least 6 hours to relapse, the share reopened within 6 hours of the close, for the 7 days before and for the days since.
-- Baseline read on 2026-11-04T18:50Z: 1,232 closes from 2026-10-28T17:06Z to 2026-11-04T11:06Z, 384 reopened within 6 h (31.2 %). The first closes made after the change (from 2026-11-04T17:06:10Z) enter the
-- "after" cohort from 23:06Z onward.
-- Read: SELECT * FROM v_relapse_6h_cohort (cohort, family, closes, relapsed_6h, rate_6h); ops_config relapse_hold_since holds the change time (kept in step with a revert or a replacement lever).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP VIEW IF EXISTS v_relapse_6h_cohort; DELETE FROM ops_config WHERE key = 'relapse_hold_since';
-- BACKUP: bak_20261104_relapse_6h_cohort
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_relapse_6h_cohort AS SELECT key, value, note FROM ops_config WHERE key = 'relapse_hold_since';

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('relapse_hold_since', '2026-11-04T17:06:10Z', 'RELAPSE-HOLD-1: time the close hold went live (migration_runs 1149); v_relapse_6h_cohort splits closes before and after it', datetime('now'));

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
  COUNT(*) AS closes, SUM(c.relapsed) AS relapsed_6h, ROUND(1.0 * SUM(c.relapsed) / COUNT(*), 3) AS rate_6h
FROM c JOIN t JOIN agent_issues a ON a.id = c.issue_id
GROUP BY 1, 2;

-- The measure issue reads this view for its keep-or-revert decision.
UPDATE agent_issues
SET description = description || char(10) || 'Lag-free reading (RELAPSE-COHORT-1): SELECT cohort, SUM(closes) AS closes, SUM(relapsed_6h) AS relapsed_6h, ROUND(1.0 * SUM(relapsed_6h) / SUM(closes), 3) AS rate_6h FROM v_relapse_6h_cohort GROUP BY cohort. Baseline (before) 0.312 on 1,232 closes; keep the hold when the after cohort is clearly lower (a drop of 0.10 or more on at least 150 closes) and no guard worsened.',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE title = 'RELAPSE-HOLD-1 measure: keep or revert the close hold by the 7-day reading' AND status = 'open' AND instr(description, 'RELAPSE-COHORT-1') = 0;
