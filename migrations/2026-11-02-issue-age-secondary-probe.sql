-- ISSUE-AGE-SECONDARY-PROBE-1 (charter pillar autonomy).
-- The issue-age alternate now runs as a 10-minute task, so a breach may briefly
-- appear in the live ladder before that task records its action.
-- Prediction: false failures from threshold-crossing races stop while persistent
-- missing actions remain detectable after one scheduler interval plus jitter.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261102_issue_age_secondary_probe
-- Rollback: UPDATE control_alternate_probes SET probe_sql = (SELECT probe_sql FROM bak_20261102_issue_age_secondary_probe), window_note = (SELECT window_note FROM bak_20261102_issue_age_secondary_probe) WHERE control = 'issue-age-repair-secondary-notice'; DROP TABLE bak_20261102_issue_age_secondary_probe

CREATE TABLE bak_20261102_issue_age_secondary_probe AS
SELECT control, probe_sql, window_note
FROM control_alternate_probes
WHERE control = 'issue-age-repair-secondary-notice';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path,
   capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot:1001272',
  'The alternate issue-age path now runs every 10 minutes, so a newly crossed 24h threshold may precede its scheduled action.',
  'ISSUE-AGE-SECONDARY-PROBE-1: allow 15 minutes after the threshold before declaring the alternate path broken.',
  'Live qnfo-audit: the alternate previously observed "an age breach has no issue_age_actions row"; after the scheduled task ran, the probe returned ok and 0 of 480 current breaches lacked a 24h action.',
  'Pending CI migration and the next live chaos-drill pass.',
  'The issue-age secondary-notice alternate probe only.',
  'Restore probe_sql and window_note from bak_20261102_issue_age_secondary_probe.',
  'The alternate probe tolerates one scheduled task interval without masking persistent missing evidence.',
  'Transient failures stop; a missing action remains detectable after 15 minutes.',
  'none',
  'SQLite boundary regression test, migration safety check, live qnfo-audit probe read.'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'ISSUE-AGE-SECONDARY-PROBE-1: allow 15 minutes after the threshold before declaring the alternate path broken.'
);

UPDATE control_alternate_probes
SET probe_sql = 'WITH due AS (SELECT l.id FROM v_issue_age_ladder l JOIN agent_issues i ON i.id = l.id WHERE l.breach = 1 AND i.created_at <= (CAST(strftime(''%s'', ''now'') AS INTEGER) - 24 * 3600 - 900) * 1000) SELECT ''ok'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM due l WHERE NOT EXISTS (SELECT 1 FROM issue_age_actions x WHERE x.issue_id = l.id AND x.rung = ''24h'')) THEN ''an overdue issue has no issue_age_actions row'' WHEN EXISTS (SELECT 1 FROM due l WHERE NOT EXISTS (SELECT 1 FROM v_sla_breaches b WHERE b.id = l.id AND b.breach_type = ''issue-age-24h'')) THEN ''an overdue issue is absent from v_sla_breaches'' ELSE ''ok'' END AS observed',
    window_note = 'Each 10-minute issue-age task run: 24h breaches receive an issue_age_actions row and remain in v_sla_breaches; allow 15 minutes after threshold crossing for the scheduled task. Replayed by migrations/issue-age-secondary-probe.test.mjs.'
WHERE control = 'issue-age-repair-secondary-notice';
