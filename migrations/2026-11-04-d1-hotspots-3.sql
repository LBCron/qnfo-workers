-- D1-HOTSPOTS-3 (2026-11-04, charter pillar cost; D1 overload family D1-OVERLOAD-1; follows PR 7205, the headline cache and the cron-fault scans).
-- Measured 2026-11-04 17:20-21:20Z on qnfo-audit (GraphQL d1QueriesAdaptiveGroups sorted by rows read, 2 h window; then a live read of each statement, meta.rows_read):
--   1. the fm-consumer-pending-recorded-as-failure probe scans remediation_verifications whole: 27 runs, 9.9 M rows read, 62 s of D1 time in 2 h (363,753 rows read, 1.16 s per run;
--      EXPLAIN: SEARCH idx_remediation_verifications_ts (verified_at>?) because the 2026-10-19 cutoff is older than the 8-day retention, so every row qualifies and
--      pass = 0 / observed LIKE 'pending%' are filtered row by row; 128,868 of 363,499 rows are pass = 0 and only 1,926 are pending).
--   2. fm-remediation-over-budget-metric-lifetime-count probe: 33 runs, 6.7 M rows read, 47 s in 2 h (259,780 rows read per run), because
--      NOT EXISTS (SELECT 1 FROM code_tasks ct WHERE ... ct.goal LIKE '%#' || r.issue_id || ' %') rescans the 800 open code_tasks for each of about 325 candidate contracts.
--   3. v_breach_ticket_coverage_candidates (read by the breach-coverage step every few minutes: 66 runs, 1.58 M rows read in 40 min, 23,384 per run):
--      a.title LIKE 'METRIC-TRIGGER-' || s.id || '-%' cannot use idx_agent_issues_title (the pattern is an expression, and the index is BINARY), so each of the 307
--      trigger states scans all 5.5 k agent_issues, twice.
-- Change (same answers, fewer rows):
--   1. partial index idx_rv_pending_fail ON remediation_verifications(verified_at) WHERE pass = 0 AND lower(trim(observed)) LIKE 'pending%' (about 2 k entries, written only for a
--      failing pending verification); the probe text is unchanged because the planner proves the index WHERE from the probe's own terms (tested in migrations/d1-hotspots-3.test.mjs).
--   2. the probe reads the open code_tasks goals once into a one-row CTE (group_concat) and tests instr(goals, '#<issue> '), instead of one LIKE scan per candidate.
--   3. the view compares the title with a half-open range (>= 'METRIC-TRIGGER-<id>-' and < 'METRIC-TRIGGER-<id>.', '.' is the byte after '-') so idx_agent_issues_title seeks.
-- PREDICTION (rows read per statement, same results): 1. 363,753 -> under 5,000; 2. 259,780 -> 7,681 (measured live with the new text before this file was written); 3. 23,384 -> 994 (measured live).
-- Together about 140 M rows read a day fewer (2 h figures x 12), no write path touched except one small partial index.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261104_d1_hotspots_3
-- Rollback: DROP INDEX IF EXISTS idx_rv_pending_fail; UPDATE remediation_contracts SET verify_probe = (SELECT body FROM bak_20261104_d1_hotspots_3 WHERE kind = 'probe') WHERE class = 'fm-remediation-over-budget-metric-lifetime-count'; DROP VIEW IF EXISTS v_breach_ticket_coverage_candidates; then CREATE VIEW v_breach_ticket_coverage_candidates from the body of bak_20261104_d1_hotspots_3 where kind = 'view'
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261104_d1_hotspots_3 (kind TEXT, name TEXT, body TEXT);
INSERT INTO bak_20261104_d1_hotspots_3 (kind, name, body)
SELECT 'view', name, sql FROM sqlite_master WHERE type = 'view' AND name = 'v_breach_ticket_coverage_candidates'
  AND NOT EXISTS (SELECT 1 FROM bak_20261104_d1_hotspots_3 WHERE kind = 'view');
INSERT INTO bak_20261104_d1_hotspots_3 (kind, name, body)
SELECT 'probe', class, verify_probe FROM remediation_contracts WHERE class = 'fm-remediation-over-budget-metric-lifetime-count'
  AND NOT EXISTS (SELECT 1 FROM bak_20261104_d1_hotspots_3 WHERE kind = 'probe');

CREATE INDEX IF NOT EXISTS idx_rv_pending_fail ON remediation_verifications (verified_at) WHERE pass = 0 AND lower(trim(observed)) LIKE 'pending%';

UPDATE remediation_contracts SET verify_probe =
 'WITH ogb AS (SELECT COALESCE(group_concat(goal, char(10)), '''') AS g FROM code_tasks WHERE status NOT IN (''closed'',''superseded'')) '
 || 'SELECT ''0'' AS expected, CAST(CASE WHEN EXISTS (SELECT 1 FROM metric_registry m WHERE m.metric = ''remediation_contracts_over_budget'' AND CAST(m.last_value AS INTEGER) = '
 || '(SELECT COUNT(*) FROM remediation_contracts r, ogb WHERE r.status IN (''active'',''holding'') AND r.last_verdict=''fail'' AND r.attempts > 5*COALESCE(r.max_attempts,3) '
 || 'AND substr(r.class,1,3) <> ''fm-'' AND substr(r.class,1,7) <> ''belief-'' AND COALESCE(instr(ogb.g, ''#'' || r.issue_id || '' ''), 0) = 0 '
 || 'AND NOT (r.issue_id IS NOT NULL AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.id=r.issue_id AND a.status=''open'' AND a.title NOT LIKE ''METRIC-TRIGGER-%'') '
 || 'AND NOT EXISTS (SELECT 1 FROM remediation_contracts c2 WHERE c2.issue_id=r.issue_id AND c2.class<>r.class AND c2.status IN (''active'',''holding'')))) '
 || 'AND m.last_refreshed >= strftime(''%Y-%m-%dT%H:%M:%SZ'',''now'',''-120 minutes'')) THEN 0 ELSE 1 END AS TEXT) AS observed'
WHERE class = 'fm-remediation-over-budget-metric-lifetime-count' AND verify_probe LIKE '%ct.goal LIKE%';

DROP VIEW IF EXISTS v_breach_ticket_coverage_candidates;
CREATE VIEW v_breach_ticket_coverage_candidates AS
SELECT s.id AS trigger_id, s.metric_key, s.val, s.threshold
FROM v_metric_trigger_state s
WHERE s.hit = 1 AND s.queue_target = 'agent_issues'
  AND EXISTS (SELECT 1 FROM agent_issues a WHERE a.title >= 'METRIC-TRIGGER-' || s.id || '-' AND a.title < 'METRIC-TRIGGER-' || s.id || '.')
  AND NOT EXISTS (SELECT 1 FROM agent_issues a WHERE a.status = 'open' AND a.title >= 'METRIC-TRIGGER-' || s.id || '-' AND a.title < 'METRIC-TRIGGER-' || s.id || '.');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:d1-slim-tiering', 'a probe or view that rescans a table per candidate row is the cheapest D1 load to remove: same answer, an index or a one-shot CTE',
  'D1-HOTSPOTS-3: partial index idx_rv_pending_fail; over-budget probe reads open code_tasks goals once; v_breach_ticket_coverage_candidates seeks idx_agent_issues_title by range',
  'GraphQL 2 h: pending probe 9.9 M rows / 62 s, over-budget probe 6.7 M / 47 s, coverage candidates 1.58 M per 40 min; live reads 363,753 -> (index), 259,780 -> 7,681, 23,384 -> 994',
  'three statements read 95 percent fewer rows with identical results', 'one partial index, one probe text, one view; originals in bak_20261104_d1_hotspots_3',
  'the Rollback line', 'the single writer spends about 100 s less per 2 h on these three', 'about 140 M rows read a day fewer', NULL,
  'migrations/d1-hotspots-3.test.mjs (planner uses the partial index; range seek equals the LIKE on a fixture); live rows_read before and after'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'D1-HOTSPOTS-3:%');
