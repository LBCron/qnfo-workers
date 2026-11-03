-- MANAGEMENT-PERSONAS-11 / PERSONAL-METRIC-DOERS-1 (2026-11-01, charter pillar autonomy).
-- Renamed from -10: #5518 merged a different migration (LEGACY-PLUS-LEDGER-1, plus_ledger columns and the pl-ledger step) under that name and applied it, so this one,
-- which changes only the dg-request step, is a forward migration with its own backup table (the backup of -10 predates that change and would roll both back).
-- Extend DOER-ASSIGN-1 to QNFO.PERSONAL off-target metric issues. Migration 9 already
-- ranks these metrics worst-first; the request step excluded PERSONAL entirely.
-- Personal requests contain only the aggregate focus reason, not the issue title/body,
-- and remain barred from personal-* code targets and research stores.
-- SWITCHED OFF BY DEFAULT: the step reads ops_config personal_metric_doers (seeded 'off'; absent reads as off), so applying this changes nothing until the switch is 'on'.
-- Why: Copilot's review of the pull request (High severity) found that the aggregate-only bound lives in the prompt only. qnfo-agents runs every cf_agent_requests row with the
-- generic loop scope, whose fleet_sql tool can read the referenced issue's title and description, and the instance name carries the issue id. Turn the switch on only after the
-- consumer authorises by requester: a request whose requester is program-manager:QNFO.PERSONAL must get no fleet_sql, ops_call or Code Mode read of agent_issues text, direct or
-- through the sandbox (issue 5455). Stop it again without a deploy: INSERT OR REPLACE INTO ops_config (key, value) VALUES ('personal_metric_doers', 'off');
-- Prediction (once the switch is on): each eligible PERSONAL off-target focus metric without a doer is requested
-- in breach-rank order, within the existing age and per-tick caps.
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261101_mp11_workflow WHERE id = 'management-personas'), version = version + 1 WHERE id = 'management-personas'
-- APPLY-BY: ci
-- REAPPLY-OK: replay is safe because the fleet_tasks update only matches the prior filter and becomes a no-op after success; ledger inserts are conflict-safe
-- DB: qnfo-audit
-- BACKUP: bak_20261101_mp11_workflow

CREATE TABLE IF NOT EXISTS bak_20261101_mp11_workflow AS
SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas';

UPDATE fleet_tasks
SET definition = json_set(
      definition,
      '$.steps[' || (
        SELECT CAST(key AS INTEGER)
        FROM json_each(fleet_tasks.definition, '$.steps')
        WHERE json_extract(value, '$.name') = 'dg-request'
        LIMIT 1
      ) || '].sql',
      replace(
        replace(
          json_extract(
            definition,
            '$.steps[' || (
              SELECT CAST(key AS INTEGER)
              FROM json_each(fleet_tasks.definition, '$.steps')
              WHERE json_extract(value, '$.name') = 'dg-request'
              LIMIT 1
            ) || '].sql'
          ),
          'a.title || char(10) || substr(COALESCE(a.description, ''''), 1, 1500)',
          'CASE WHEN f.program_code = ''QNFO.PERSONAL'' THEN ''Aggregate metric only: '' || f.reason || ''. Do not access personal records or research stores.'' ELSE a.title || char(10) || substr(COALESCE(a.description, ''''), 1, 1500) END'
        ),
        'AND f.program_code <> ''QNFO.PERSONAL'' AND f.entered_at',
        'AND (f.program_code <> ''QNFO.PERSONAL'' OR (f.reason LIKE ''worst off-target metric %'' AND COALESCE((SELECT value FROM ops_config WHERE key = ''personal_metric_doers''), ''off'') = ''on'')) AND f.entered_at'
      )
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND EXISTS (
    SELECT 1
    FROM json_each(fleet_tasks.definition, '$.steps')
    WHERE json_extract(value, '$.name') = 'dg-request'
      AND instr(json_extract(value, '$.sql'),
        'AND f.program_code <> ''QNFO.PERSONAL'' AND f.entered_at') > 0
  );

INSERT OR IGNORE INTO ops_config (key, value, note) VALUES
  ('personal_metric_doers', 'off', 'PERSONAL-METRIC-DOERS-1: on lets the management-personas dg-request step file doer requests for QNFO.PERSONAL off-target metric focus issues. Keep off until qnfo-agents authorises by requester (no agent_issues text for program-manager:QNFO.PERSONAL requests); see issue 5455.');

-- Use INSERT OR IGNORE to avoid violating the unique constraint on capability column
INSERT OR IGNORE INTO capability_ledger
  (capability, provenance, prerequisites, reliability, acquired_at, evidence)
VALUES
  ('personal-program-assigns-worst-first-metric-doers', 'migrations/2026-11-01-management-personas-11.sql',
   'management-personas hourly workflow; migration 9 focus ranking; aggregate metric-trigger issues',
   'off-target PERSONAL metric focus issues without a doer are requested in focus-rank order once ops_config personal_metric_doers is on (seeded off); personal issue bodies are not sent',
   '2026-11-01',
   'the dg-request step selects PERSONAL only for worst off-target metric focus reasons, only while the switch is on, and keeps existing age, cap, target, and opt-out rules');

-- Use INSERT OR IGNORE to keep decision_log idempotent
INSERT OR IGNORE INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'program-manager:QNFO.PERSONAL (PERSONAL-METRIC-DOERS-1)',
  'PERSONAL off-target metrics should use the existing worst-first focus order and doer workflow without exposing personal issue text',
  'request doers for PERSONAL off-target metric focus issues in focus-rank order using aggregate reasons only',
  'migration 9 ranked PERSONAL metric-trigger issues, but the management-personas dg-request step excluded QNFO.PERSONAL',
  'switched off by default (ops_config personal_metric_doers = off); enabling waits for requester-aware aggregate-only authorisation in qnfo-agents',
  'management-personas dg-request step for PERSONAL focus issues, inert while the switch is off; no personal records, personal-* targets, or research stores',
  'Rollback line of migrations/2026-11-01-management-personas-11.sql',
  'PERSONAL worst-first metric doer dispatch with aggregate-only context',
  'PERSONAL off-target metric focus issues without a doer receive requests in descending normalized breach order; existing caps and privacy boundaries hold',
  'No direct yield or reach gain is assumed; the change adds no spend and does not alter output quality measures.',
  'SQLite migration replay, synthetic PERSONAL breach ordering, eligible request selection, and issue-text redaction'
WHERE NOT EXISTS (
  SELECT 1 FROM decision_log
  WHERE action = 'request doers for PERSONAL off-target metric focus issues in focus-rank order using aggregate reasons only'
);
