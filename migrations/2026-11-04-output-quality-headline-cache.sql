-- D1-LOAD-HEADLINE-CACHE-1 (2026-11-04, charter pillar autonomy; issues 6848..6869 D1 overload family).
-- Measured 2026-11-04 14:00Z-20:00Z on qnfo-audit (d1QueriesAdaptiveGroups, 6 h): the management-personas job's
-- "UPDATE persona_briefs ... Outputs (readers, reviewers and probes, per surface)" statement ran 66 times, read 99.6M rows
-- and held the single-writer database for 358 s (5.4 s per call), because it reads v_output_quality_headline every run.
-- The headline moves hourly at most (its measures refresh from fleet_tick_heavy every 50 minutes).
-- Tested 2026-11-04: the guard sits in a derived table's WHERE with the view in a select-list subquery, because a plain
-- WHERE on the view's own SELECT still scanned it (758,606 rows, 2.4 s) while this form reads 0 rows (6.8 ms).
-- Change: the job reads a one-row cache (output_quality_headline_cache) and refreshes it from the view at most every 55 minutes.
-- PREDICTION: the persona_briefs Outputs statement falls from ~358 s per 6 h to under 10 s; rows read by it fall by >95%;
-- the portfolio brief still shows the Outputs sentence. Guard: no brief loses the sentence ("not measured" would appear on a miss).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_ohc_workflow
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT definition FROM bak_20261104_ohc_workflow WHERE id = 'management-personas'), version = version + 1 WHERE id = 'management-personas'; DROP TABLE IF EXISTS output_quality_headline_cache

CREATE TABLE IF NOT EXISTS bak_20261104_ohc_workflow AS
SELECT id, definition, version FROM fleet_tasks WHERE id = 'management-personas';

CREATE TABLE IF NOT EXISTS output_quality_headline_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  verdict TEXT, better INTEGER, worse INTEGER, flat INTEGER, unmeasured INTEGER, gaps TEXT,
  refreshed_at TEXT NOT NULL
);

INSERT OR REPLACE INTO output_quality_headline_cache (id, verdict, better, worse, flat, unmeasured, gaps, refreshed_at)
SELECT 1, json_extract(j, '$.v'), json_extract(j, '$.b'), json_extract(j, '$.w'), json_extract(j, '$.f'), json_extract(j, '$.u'), json_extract(j, '$.g'),
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM (SELECT (SELECT json_object('v', verdict, 'b', better, 'w', worse, 'f', flat, 'u', unmeasured, 'g', gaps) FROM v_output_quality_headline LIMIT 1) AS j);

UPDATE fleet_tasks
SET definition = REPLACE(
      REPLACE(
        definition,
        'FROM v_output_quality_headline LIMIT 1',
        'FROM output_quality_headline_cache LIMIT 1'
      ),
      '{"steps":[{"type":"sql","name":"recur-clear"',
      '{"steps":[{"type":"sql","name":"oq-headline-refresh","db":"AUDIT","sql":"INSERT OR REPLACE INTO output_quality_headline_cache (id, verdict, better, worse, flat, unmeasured, gaps, refreshed_at) SELECT 1, json_extract(j, ''$.v''), json_extract(j, ''$.b''), json_extract(j, ''$.w''), json_extract(j, ''$.f''), json_extract(j, ''$.u''), json_extract(j, ''$.g''), strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'') FROM (SELECT (SELECT json_object(''v'', verdict, ''b'', better, ''w'', worse, ''f'', flat, ''u'', unmeasured, ''g'', gaps) FROM v_output_quality_headline LIMIT 1) AS j WHERE COALESCE((SELECT refreshed_at FROM output_quality_headline_cache WHERE id = 1), ''1970'') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-55 minutes''))"},{"type":"sql","name":"recur-clear"'
    ),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas'
  AND definition LIKE '%FROM v_output_quality_headline LIMIT 1%'
  AND json_valid(definition);
