-- ROADMAP-TWIN-GUARD-1 (2026-11-05, pillar autonomy; metrics open_agent_issues, largest_issue_family_net_inflow_24h). Producer side of migrations/2026-11-05-roadmap-twin-fold.sql.
-- WHAT WAS READ (qnfo-audit, 2026-11-05 04Z): step rm-file of fleet task management-personas (ROADMAP-ORIGINATE-1) files a ROADMAP-1 issue for every roadmap_proposals row in status 'proposed' unless an issue for that
-- proposal id exists or the program already has 3 open manager issues. It never looks at ROADMAP-1 items a SESSION filed: on 2026-11-04 it filed #2131 to #2134 (QNFO.REACH) nine hours after session:reader-yield
-- filed the same four items word for word (READER-YIELD-1.1 to 1.4), and both copies queued code tasks on the same two files. 4 of the 77 open ROADMAP-1 issues are such twins.
-- WHAT THIS FILE ADDS: the INSERT of rm-file also requires that no ROADMAP-1 issue that is open, or was touched in the last 3 days, carries the first 50 characters of the proposal title (lower case, any program or
-- item code in front). Nothing else in the 66-step workflow changes; the statement is a no-op when step 45 is no longer rm-file or already carries the guard. The proposal stays 'proposed' and is filed on a later
-- tick once the twin has been closed for 3 days (a shipped twin means the proposal is built: the managers' own outcome pass records it).
-- Prediction: no manager-filed ROADMAP-1 issue repeats a session-filed one; the next twin of the kind the fold file closed does not appear.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE fleet_tasks SET definition = json_set(definition, '$.steps[45].sql', replace(json_extract(definition, '$.steps[45].sql'), ' AND (length(p.title) < 20 OR NOT EXISTS (SELECT 1 FROM agent_issues i WHERE i.title LIKE ''ROADMAP-1: %'' AND (i.status = ''open'' OR i.updated_at > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 259200) * 1000) AND instr(lower(i.title), lower(substr(p.title, 1, 50))) > 0)) /* ROADMAP-TWIN-GUARD-1 */', '')), version = version + 1, updated_at = datetime('now') WHERE id = 'management-personas' AND json_extract(definition, '$.steps[45].name') = 'rm-file';
-- Closing probe: SELECT instr(json_extract(definition, '$.steps[45].sql'), 'ROADMAP-TWIN-GUARD-1') > 0 FROM fleet_tasks WHERE id = 'management-personas'; -- 1

CREATE TABLE IF NOT EXISTS bak_20261105_mp_rm_file AS
SELECT id, definition, version, updated_at FROM fleet_tasks WHERE id = 'management-personas';

UPDATE fleet_tasks SET definition = json_set(
    definition,
    '$.steps[45].sql',
    replace(json_extract(definition, '$.steps[45].sql'),
      'AND NOT EXISTS (SELECT 1 FROM agent_issues i WHERE i.title LIKE ''ROADMAP-1: '' || p.program_code || '' #'' || p.id || '':%'')',
      'AND NOT EXISTS (SELECT 1 FROM agent_issues i WHERE i.title LIKE ''ROADMAP-1: '' || p.program_code || '' #'' || p.id || '':%'') AND (length(p.title) < 20 OR NOT EXISTS (SELECT 1 FROM agent_issues i WHERE i.title LIKE ''ROADMAP-1: %'' AND (i.status = ''open'' OR i.updated_at > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 259200) * 1000) AND instr(lower(i.title), lower(substr(p.title, 1, 50))) > 0)) /* ROADMAP-TWIN-GUARD-1 */')),
  version = version + 1, updated_at = datetime('now')
WHERE id = 'management-personas'
  AND json_extract(definition, '$.steps[45].name') = 'rm-file'
  AND json_extract(definition, '$.steps[45].sql') LIKE '%INTO agent_issues%'
  AND json_extract(definition, '$.steps[45].sql') NOT LIKE '%ROADMAP-TWIN-GUARD-1%';
