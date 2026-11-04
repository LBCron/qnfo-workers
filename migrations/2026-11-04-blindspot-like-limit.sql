-- BLINDSPOT-LIKE-LIMIT-1 (2026-11-04, charter pillar autonomy; family worker-observability).
-- The fleet task blind-spot-audit failed on every run with "D1_ERROR: LIKE or GLOB pattern too complex" (task-failed:blind-spot-audit, 9 consecutive fails at 21:56Z, first seen 15:55Z).
-- D1 refuses a LIKE or GLOB pattern longer than 50 bytes; five of its steps (fm-never-probed, metrics-stale, merged-no-deploy, migration-unapplied, contracts-parked) test an open issue
-- title with a 56 to 70 byte pattern such as  a.title LIKE 'BLINDSPOT-1: % merged code tasks have no deploy evidence after 2 hours' .  The same test is now the 13-byte prefix pattern plus
-- instr() for the suffix: (a.title LIKE 'BLINDSPOT-1: %' AND instr(a.title, ' <suffix>') > 0). Same issues match; the audit can file its findings again.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_blind_spot_audit_task
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_blind_spot_audit_task WHERE id = 'blind-spot-audit') WHERE id = 'blind-spot-audit';
-- spof-review: one fleet_tasks definition text changed in five predicates; no table or trigger change.

CREATE TABLE IF NOT EXISTS bak_20261104_blind_spot_audit_task AS
SELECT id, definition FROM fleet_tasks WHERE id = 'blind-spot-audit';

UPDATE fleet_tasks
SET definition = replace(replace(replace(replace(replace(definition,
    'a.title LIKE ''BLINDSPOT-1: % failure modes have a detector that never ran''',
    '(a.title LIKE ''BLINDSPOT-1: %'' AND instr(a.title, '' failure modes have a detector that never ran'') > 0)'),
    'a.title LIKE ''BLINDSPOT-1: % metrics have not refreshed in 3 days''',
    '(a.title LIKE ''BLINDSPOT-1: %'' AND instr(a.title, '' metrics have not refreshed in 3 days'') > 0)'),
    'a.title LIKE ''BLINDSPOT-1: % merged code tasks have no deploy evidence after 2 hours''',
    '(a.title LIKE ''BLINDSPOT-1: %'' AND instr(a.title, '' merged code tasks have no deploy evidence after 2 hours'') > 0)'),
    'a.title LIKE ''BLINDSPOT-1: % migration files have no ok row in migration_runs''',
    '(a.title LIKE ''BLINDSPOT-1: %'' AND instr(a.title, '' migration files have no ok row in migration_runs'') > 0)'),
    'a.title LIKE ''BLINDSPOT-1: % active contracts are parked past their cadence''',
    '(a.title LIKE ''BLINDSPOT-1: %'' AND instr(a.title, '' active contracts are parked past their cadence'') > 0)')
WHERE id = 'blind-spot-audit' AND definition LIKE '%a.title LIKE %BLINDSPOT-1: %' AND json_valid(definition);
