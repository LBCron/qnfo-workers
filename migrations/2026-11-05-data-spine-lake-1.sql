-- DATA-SPINE-LAKE-1 (2026-11-05, charter pillars reliability and cost, program QNFO.INFRA; roadmap row 3258 RM-BS-DATA-SPINE-1, blue-sky bet B2): slice 1, the first telemetry table that leaves D1.
-- WHAT EXISTS (read 2026-11-05 from the Cloudflare API with the repository token): stream telemetry_fleet_probe_log_stream (c9f627df...), sink telemetry_fleet_probe_log_sink (r2_data_catalog, bucket qnfo-audit,
-- namespace telemetry, table fleet_probe_log, parquet), pipeline telemetry_fleet_probe_log (running), created by scripts/lake_spine.py --ensure-infrastructure; 300 real rows sent by hand were read back through
-- Basin SQL (count 300, distinct ids 300, 6 files, 12,247 bytes scanned). The same machinery has served r2_object_inventory since 2026-10-18.
-- WHAT THIS CHANGES: two small tables (lake_spine_state: the cursor; lake_spine_drift: one row per table and UTC day), the flag ops_config lake_spine (shadow = copy on, off, paused = set by the drift kill),
-- a read view, two failure modes with detector contracts, a decision_log row and two next-slice issues. qnfo-infra 1.14.0 (lakeSpineTick, hourly at :30) does the copy and the daily drift check.
-- D1 stays authoritative and fleet_probe_log keeps its writer (qnfo-fleet-dashboard healthProbes) and its cold-tier retention: this slice COPIES. D1 write volume does not fall until slice 2 (LAKE-SPINE-2.1/2.2).
-- PREDICTION (decision_log): within 3 h of the deploy lake_spine_state.rows_sent is at least 12,000 and the cursor is within 500 ids of the table's max id; the first lake_spine_drift row (yesterday) reads ok with
-- missing 0; count(DISTINCT id) in the lake from start_id equals the D1 count for each complete day. Falsifier: a drift row with verdict breach, or last_error containing stream 401/403 after the first tick.
-- Cost of the pilot: about 12,000 rows read from D1 a day by the tail, one lake_spine_state write an hour, two Basin SQL queries a day (about 12 KB scanned each).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE ops_config SET value = 'off' WHERE key = 'lake_spine'; UPDATE remediation_contracts SET status = 'retired' WHERE class IN ('fm-lake-spine-stalled', 'fm-lake-spine-drift'); UPDATE agent_issues SET status = 'closed' WHERE source = 'session:W2-H-3258' AND title LIKE 'ROADMAP-1: QNFO.INFRA LAKE-SPINE-2%';
-- CAUSE-MAPPED: registers no metric_registry row; the failure-mode contracts fm-lake-spine-stalled and fm-lake-spine-drift are the alarm.

CREATE TABLE IF NOT EXISTS lake_spine_state (
  tbl TEXT PRIMARY KEY,
  cursor_id INTEGER NOT NULL,
  start_id INTEGER NOT NULL,
  start_day TEXT,
  rows_sent INTEGER NOT NULL DEFAULT 0,
  batches INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_error TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS lake_spine_drift (
  tbl TEXT NOT NULL,
  day TEXT NOT NULL,
  d1_rows INTEGER,
  lake_rows INTEGER,
  lake_distinct INTEGER,
  missing INTEGER,
  duplicates INTEGER,
  drift_pct REAL,
  verdict TEXT,
  first_checked_at TEXT,
  checked_at TEXT,
  note TEXT,
  PRIMARY KEY (tbl, day)
);

CREATE VIEW IF NOT EXISTS v_lake_spine_status AS
SELECT s.tbl,
       (SELECT value FROM ops_config WHERE key = 'lake_spine') AS mode,
       s.start_day, s.start_id, s.cursor_id, s.rows_sent, s.batches, s.last_run_at,
       CAST((julianday('now') - julianday(s.last_run_at)) * 1440 AS INTEGER) AS minutes_since_run,
       s.last_error,
       (SELECT d.day || ' ' || d.verdict FROM lake_spine_drift d WHERE d.tbl = s.tbl ORDER BY d.day DESC LIMIT 1) AS latest_drift,
       (SELECT MAX(d.drift_pct) FROM lake_spine_drift d WHERE d.tbl = s.tbl) AS worst_drift_pct
FROM lake_spine_state s;

INSERT OR IGNORE INTO ops_config (key, value, note, updated_at)
VALUES ('lake_spine', 'shadow', 'DATA-SPINE-LAKE-1: qnfo-infra copies new fleet_probe_log rows to the R2 Data Catalog table telemetry.fleet_probe_log every hour and checks drift daily; shadow = copy on (D1 authoritative), off = nothing runs, paused = set by the 24 h drift kill. Reserved for slice 2: dual, new.', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('lake-spine-stalled', 'the lake copy of fleet_probe_log is on (ops_config lake_spine = shadow) but its cursor has not run for 3 hours',
  'qnfo-infra lakeSpineTick runs on the hourly :30 fire; it records every run in lake_spine_state.last_run_at and every failure in last_error (a stream refusal, a token without the Pipelines send scope, a pipeline that was deleted)',
  'read v_lake_spine_status (last_error, minutes_since_run) and GET qnfo-infra /health for the deployed version; a 401/403 means the CF_API_TOKEN of the qnfo-infra secrets store lost a scope, so run python scripts/lake_spine.py --tail from a runner (it moves the same cursor) and fix the scope; never set lake_spine off to hide it',
  'fm-lake-spine-stalled', 'fm-lake-spine-stalled', '2026-11-05',
  'ops_config lake_spine = shadow for more than 3 hours and lake_spine_state.last_run_at older than 3 hours',
  'SELECT last_run_at FROM lake_spine_state WHERE tbl = fleet_probe_log',
  'the lake copy only: D1 and its readers are not touched in slice 1');

INSERT OR IGNORE INTO failure_modes
 (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
 ('lake-spine-drift', 'a complete UTC day of fleet_probe_log is missing more than 0.1 percent of its rows in the lake',
  'the copy is at least once: a refused batch leaves the cursor and is re-sent, so a gap needs a stream that accepted rows the sink then dropped, a pipeline that stopped, or ids D1 wrote below the cursor; the daily drift check (lake_spine_drift) is the only thing that sees it',
  'read lake_spine_drift where verdict = breach and v_lake_spine_status; the worker pauses the copy after 24 hours of breach and files LAKE-SPINE-DRIFT-1; repair by python scripts/lake_spine.py --tail --from-id <first missing id - 1> --to-id <last> --no-state (duplicates are harmless, the lake is read with count(DISTINCT id)), then set ops_config lake_spine back to shadow',
  'fm-lake-spine-drift', 'fm-lake-spine-drift', '2026-11-05',
  'a lake_spine_drift row with verdict breach checked in the last 3 days',
  'SELECT COUNT(*) FROM lake_spine_drift WHERE verdict = breach',
  'the lake copy only; a cutover (slice 2) is blocked while a breach is open');

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-lake-spine-stalled', NULL,
  'SELECT ''0'' AS expected, CAST(CASE WHEN (SELECT value FROM ops_config WHERE key = ''lake_spine'') = ''shadow'' AND (SELECT updated_at FROM ops_config WHERE key = ''lake_spine'') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') AND COALESCE((SELECT last_run_at FROM lake_spine_state WHERE tbl = ''fleet_probe_log''), ''1970-01-01'') < strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 hours'') THEN 1 ELSE 0 END AS TEXT) AS observed',
  'd1-query', 1000, 1, 'active',
  'with ops_config lake_spine = shadow for more than 3 hours the copy ran within the last 3 hours (it runs hourly at :30)',
  'Read v_lake_spine_status: last_error names the refusal; check that qnfo-infra deployed 1.14.0 or later (GET /health), that the stream telemetry_fleet_probe_log_stream exists (python scripts/lake_spine.py --check) and that the secrets-store token still has the Pipelines send scope',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-lake-spine-drift', NULL,
  'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM lake_spine_drift WHERE verdict = ''breach'' AND checked_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-3 days'')) AS TEXT) AS observed',
  'd1-query', 1000, 1, 'active',
  'no complete day of the lake copy is missing more than 0.1 percent of its fleet_probe_log rows',
  'Read lake_spine_drift (missing, duplicates, note) and lake_spine_state.last_error; repair the gap with python scripts/lake_spine.py --tail --from-id <id> --to-id <id> --no-state, wait for the next drift check (re-checked every 6 hours), then set ops_config lake_spine back to shadow if it was paused',
  'program-manager:QNFO.INFRA', 'failure-mode', datetime('now'));

INSERT OR IGNORE INTO control_registry (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, alternate_tested_at, evidence)
VALUES ('ops_config.lake_spine', 'qnfo-infra/worker.js lakeMode (ops_config row lake_spine)', 'kill-switch',
  'a lake copy that drifts from D1 or hammers a refusing stream: off stops it by hand, paused is set by the 24 hour drift kill',
  0, 'keep', 'planned', 'python scripts/lake_spine.py --tail (runner, same cursor) and python scripts/lake_spine.py --query', '2026-11-05T04:00:00Z',
  'DATA-SPINE-LAKE-1: not on a critical path (the copy only; D1 stays authoritative), reversible by one UPDATE, the pause needs a breach of more than 0.1 percent for 24 hours measured by lake_spine_drift; the runner path moved 300 rows and read them back on 2026-11-05');

INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('ops_config.lake_spine',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM ops_config WHERE key = ''lake_spine'') = 0 THEN ''the ops_config row lake_spine is missing, so the off lever cannot be set'' WHEN (SELECT value FROM ops_config WHERE key = ''lake_spine'') NOT IN (''off'', ''shadow'', ''paused'') THEN ''ops_config lake_spine holds a value other than off, shadow or paused, which qnfo-infra reads as off'' WHEN (SELECT value FROM ops_config WHERE key = ''lake_spine'') = ''paused'' AND NOT EXISTS (SELECT 1 FROM lake_spine_drift WHERE verdict = ''breach'') AND NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE ''LAKE-SPINE-DRIFT-1:%'' AND status = ''open'') THEN ''the copy is paused with no drift breach on record and no open LAKE-SPINE-DRIFT-1 issue, so the pause has no recorded reason'' ELSE ''ok'' END AS observed',
  'state probe, no window: the lever row, its three valid values and the reason a pause must carry. The runner path (scripts/lake_spine.py --tail) is a script and no D1 read can show it run; it was exercised by hand on 2026-11-05 (300 rows sent, read back through Basin SQL)', 1);

INSERT OR IGNORE INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence)
VALUES ('pipelines-ingest-and-basin-sql (lake spine)', 'qnfo-infra lakeSpineTick -> Pipelines stream telemetry_fleet_probe_log_stream (ingest.cloudflare.com) -> R2 Data Catalog; drift check -> api.sql.cloudflarestorage.com (Basin SQL)',
  'D1 is authoritative and untouched in slice 1, so a lost lake loses no data; scripts/lake_spine.py --tail moves the same cursor from a runner and --query reads the lake with the repository token', '2026-11-05T04:00:00Z',
  'DATA-SPINE-LAKE-1: both services are beta; slice 2 (a cutover) may not start before the 7 day drift record and a second reader path (see the choice rule in docs/D1-SPLIT-DESIGN-2026-11.md section 8)');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA LAKE-SPINE-2.1: qnfo-infra accepts fleet_probe_log rows from its writer at POST /lake/ingest',
 'QNFO.INFRA; charter pillar reliability; roadmap row 3258 RM-BS-DATA-SPINE-1; doer: qnfo-code-orchestrator. Slice 2 of the data spine moves the write of fleet_probe_log from D1 to the lake (slice 1, qnfo-infra 1.14.0, copies by tail and proved the lake: see v_lake_spine_status and lake_spine_drift). The writer, qnfo-fleet-dashboard, holds no Cloudflare token and no pipelines binding, so it needs a door.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-infra/worker.js' || char(10) ||
 'code-anchor: async function lakeRoute(request, env, url, path, method, cors) {' || char(10) ||
 'code-probe: {"paths":["qnfo-infra/worker.js"],"contains":"LAKE-SPINE-2.1"}' || char(10) ||
 'EDIT: add POST /lake/ingest?table=fleet_probe_log taking a JSON array of at most 500 rows with the table''s fields (id, ts, source, name, url, transport, ok, status, ms, body), validating the field names against LAKE_TABLES and dropping unknown keys, setting exported_at, and sending through lakeSend. Authenticate a service-binding caller by ctx.props.caller = qnfo-fleet-dashboard (the INTERNAL-CALLER-PROPS-1 pattern of qnfo-ai, not a copy of INFRA_TOKEN) or the bearer token; the /lake/ branch of fetch must keep awaiting its check. Mark the change LAKE-SPINE-2.1. Add a case to qnfo-infra/lake-spine.test.mjs (valid batch, unknown key dropped, 501 rows refused, caller not allowed refused).' || char(10) ||
 'Definition of done: merged and verified live: a POST of two rows from a fleet service binding returns committed 2 and the rows are readable with python scripts/lake_spine.py --query "SELECT count(*) FROM telemetry.fleet_probe_log WHERE name = <marker>". Prediction: no change to D1 volume yet (the door is unused until LAKE-SPINE-2.2).',
 'session:W2-H-3258', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA LAKE-SPINE-2.1:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA LAKE-SPINE-2.2: healthProbes sends each probe row to the lake when ops_config lake_spine is dual, and D1 keeps one day',
 'QNFO.INFRA; charter pillar reliability and cost; roadmap row 3258 RM-BS-DATA-SPINE-1; doer: qnfo-code-orchestrator; depends on LAKE-SPINE-2.1 (the door). The cutover of fleet_probe_log, the first table whose D1 write volume falls (measured 2026-11-05, 24 h: 12,107 inserts writing 48,428 rows including 2 indexes, plus the cold tier deleting about 90,000 rows).' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function healthProbes(env, liveNames) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"LAKE-SPINE-2.2"}' || char(10) ||
 'EDIT: in healthProbes, when ops_config lake_spine = dual (read once per run, default off), keep the D1 insert (it returns meta.last_row_id) and also POST the row with that id to qnfo-infra /lake/ingest through a service binding; a failure is swallowed and counted, never thrown. Hand-over without a gap or a duplicate: first run POST qnfo-infra /lake/tail so the cursor reaches the max id, record that id as ops_config lake_spine_handover_id, then set dual; the tail stops at the handover id and the writer sends only rows with id above it. After 24 hours of drift ok (lake_spine_drift) and the 9 readers of fleet_probe_log (v_probe_freshness, v_probe_transport and the dashboard reads) pointed at the lake or at a D1 table that keeps one day, stop the D1 insert (ops_config lake_spine = new) and keep one day of rows in D1.' || char(10) ||
 'Definition of done: merged and verified live: v_lake_spine_status shows mode dual, lake_spine_drift stays ok for 3 days, and the 24 h d1QueriesAdaptiveGroups rows written by INSERT INTO fleet_probe_log fall from 48,428 to 0 after the switch to new. Kill: drift above 0.1 percent for 24 h returns the flag to shadow (the worker does it).',
 'session:W2-H-3258', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA LAKE-SPINE-2.2:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA INFRA-AUTH-AWAIT-1: qnfo-infra routes answer without a token because the async auth check is not awaited',
 'QNFO.INFRA; charter pillar security; doer: qnfo-code-orchestrator. Found 2026-11-05 while adding the /lake/ routes: qnfo-infra/worker.js declares `async function auth(token, env)` (it reads INFRA_TOKEN from the secrets store), and fetch calls `if (!auth(token, env))` and `const full = auth(token, env)` without await, so the check is a Promise, always truthy: the `!` test never refuses and `full` is always true. Measured live: GET https://qnfo-infra.q08.workers.dev/state answered 200 with no Authorization header, while /health states "every route except /health needs a bearer token". POST /refresh (runs collectState, collectAnalytics, collectRecords against the Cloudflare API and writes infra_state) is open to anyone.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-infra/worker.js' || char(10) ||
 'code-anchor: async function auth(token, env) {' || char(10) ||
 'code-probe: {"paths":["qnfo-infra/worker.js"],"contains":"INFRA-AUTH-AWAIT-1"}' || char(10) ||
 'EDIT (recommended option, OPEN-ACCESS-1 and DEFAULT-APPROVE-1): keep the read routes the fleet and readers use open on purpose and say so in code (GET /state, /analytics, /records, /retrieve, /context, /cred/status without items, /indexer/ reads), and make every route that writes or spends (POST /refresh, /drift/workers, anything that is not a GET read) await auth(token, env). Callers: check qnfo-ai, qnfo-ops and qnfo-memory-mcp for calls to POST /refresh without a token before the change (fleet graph impact worker:qnfo-infra) and give those the bearer through their own route. Mark INFRA-AUTH-AWAIT-1; add a case to qnfo-infra/lake-spine.test.mjs or a new test: POST /refresh with no token is 401, GET /state with no token stays 200.' || char(10) ||
 'Definition of done: merged and verified live: POST https://qnfo-infra.q08.workers.dev/refresh with no token answers 401 and GET /state with no token still answers 200 (OPEN-ACCESS-1).',
 'session:W2-H-3258', 'reliability', 'high', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA INFRA-AUTH-AWAIT-1:%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:W2-H-3258 (roadmap row 3258)', 'a telemetry table can leave D1 for an Iceberg lake through the Pipelines machinery the fleet already runs (r2_inventory since 2026-10-18), and a copy with a measured drift check is the safe first slice before any writer is cut over',
  'DATA-SPINE-LAKE-1: stream/sink/pipeline for fleet_probe_log created with scripts/lake_spine.py; qnfo-infra 1.14.0 lakeSpineTick copies new rows hourly and checks drift daily; ops_config lake_spine = shadow; lake_spine_state, lake_spine_drift, v_lake_spine_status; fm-lake-spine-stalled and fm-lake-spine-drift',
  '2026-11-05 Cloudflare API: pipelines/v1 streams, sinks, pipelines and r2-catalog readable and writable with the repository token; 300 rows sent and read back through Basin SQL (count 300, count(DISTINCT id) 300); D1 24 h: fleet_probe_log 12,107 inserts, 48,428 rows written, trigger-free, single writer',
  'the lake holds a verified copy of fleet_probe_log from the previous UTC day on, with a daily D1-versus-lake check; nothing in D1 is removed or changed in slice 1', 'ops_config lake_spine, two new small tables, the qnfo-infra hourly fire (fail-open), one stream/sink/pipeline in the account',
  'ops_config lake_spine = off stops the copy; the Rollback line retires the contracts and closes the issues; the pipeline and stream can be deleted with the Pipelines API (DELETE pipelines/v1/pipelines, streams, sinks) and the Iceberg table dropped through the R2 Data Catalog',
  'a measured alternative to the planned second D1 database (docs/D1-SPLIT-DESIGN-2026-11.md): append-only telemetry in a lake that SQL can read',
  'within 3 h of the deploy rows_sent >= 12000 and cursor within 500 ids of max(id); the first drift row reads ok with missing 0; lake count(DISTINCT id) equals the D1 count per complete day. Falsifier: any drift verdict breach, or last_error with stream 401/403 after the first tick. Slice 2 prediction: fleet_probe_log row writes fall by about 96,000 a day (48k inserts and about 48k deletes), under 10 percent of the day''s row writes and under 1 percent of busy time, so the case for the lake rests on the mechanism and not on this table',
  NULL, 'node --no-warnings qnfo-infra/lake-spine.test.mjs; node migrations/data-spine-lake-1.test.mjs; python scripts/lake_spine.py --check and --query against the live account'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'DATA-SPINE-LAKE-1:%');
