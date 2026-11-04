-- D1-SPLIT-1 (charter pillar core): first three slices of docs/D1-SPLIT-DESIGN-2026-11.md. Design only; no table is cut over by this file.
-- Measured 2026-11-04 ~17:00Z (d1QueriesAdaptiveGroups, 6 h): remediation_verifications inserts 4,539 stmts, 178 s, 5.4M rows read; worker_logs 1 s; fleet_probe_log 1 s.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: agent_issues
-- Rollback: DELETE FROM agent_issues WHERE source = 'session:d1-split-1' AND title LIKE 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1%';

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1a: remediation_verifications insert does its dedupe and transport guard in the statement, not in triggers',
 'QNFO.INFRA; charter pillar core; metric: qnfo-audit query seconds on remediation_verifications inserts. P0 of docs/D1-SPLIT-DESIGN-2026-11.md. The table has one writer (qnfo-fleet-control remediationContractsTick, three INSERT sites) and 8 triggers, 5 of which read other tables (dedupe_ins, transport_guard_ins/upd, autoclose_ins/upd, reopen_on_relapse_d1): 4,539 inserts in 6 h held the single writer 178 s and read 5.4M rows. Work: in remediationContractsTick make each INSERT an INSERT ... SELECT ... WHERE NOT EXISTS carrying the dedupe and transport checks the triggers enforce (read the trigger SQL from sqlite_master first and keep identical semantics), and read the verdict in the worker so the autoclose and relapse decisions are made by one UPDATE per issue after the batch. Do NOT drop any trigger in this change: demoting them is a follow-up migration after 24 h of matching results (D1-SPLIT-1a2). No data moves. Prediction: query seconds for remediation_verifications INSERT statements in d1QueriesAdaptiveGroups fall from 178 s per 6 h to under 60 s per 6 h and rows read from 5.4M to under 2M, and remediation_latest_pass_pct_7d does not drop. Closing marker: the change carries the text D1-SPLIT-1a in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
 'code-anchor: async function remediationContractsTick(env, opts) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-control/worker.js"],"contains":"D1-SPLIT-1a"}',
 'session:d1-split-1', 'code', 'high', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1a:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1b: worker_logs dual-write to qnfo-telemetry behind ops_config d1_split_worker_logs',
 'QNFO.INFRA; charter pillar core; metric: rows written per hour on qnfo-audit. P1 of docs/D1-SPLIT-DESIGN-2026-11.md, the proving ground for the cutover mechanism on a trigger-free table (2,625 inserts, 15,450 rows written and 1 s in 6 h; 87,602 rows; writers ingestTrace, logEvent in qnfo-observability and errorDetailCapture in qnfo-ops; readers conLogs, assessIntegration, digest). Run fleet-graph impact on d1t:qnfo-audit.worker_logs first. Work: (1) create D1 qnfo-telemetry with the cf-ops-actions create-d1 action (add it to scripts/cf_ops_actions.py if absent, with a test) after a d1-backup of qnfo-audit; (2) bind it as TELEMETRY in qnfo-observability wrangler.toml; (3) in ingestTrace write each row to the audit table and, when ops_config d1_split_worker_logs is dual, also to TELEMETRY with INSERT OR IGNORE keyed on event_hash, a failure never failing the ingest and counted; (4) a resumable id-range backfill with count, max(id) and bucket checksum verification as in section 4 of the design. No read switch, no drop in this change. Prediction: TELEMETRY row count tracks the audit table within 0.1% after 24 h, no ingest error increase. Closing marker: the change carries the text D1-SPLIT-1b in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-observability/worker.js' || char(10) ||
 'code-anchor: async function ingestTrace(env) {' || char(10) ||
 'code-probe: {"paths":["qnfo-observability/worker.js"],"contains":"D1-SPLIT-1b"}',
 'session:d1-split-1', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1b:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1c: fleet_probe_log dual-write to qnfo-telemetry (single writer, no triggers)',
 'QNFO.INFRA; charter pillar core; metric: rows written per hour on qnfo-audit. P1 of docs/D1-SPLIT-DESIGN-2026-11.md, second use of the dual-write helper from D1-SPLIT-1b (start after 1b has created qnfo-telemetry; if 1b is unmerged, take its claim over rather than creating the database twice). fleet_probe_log: 2,262 inserts and 9,048 rows written in 6 h, 374,704 rows, one writer (healthProbes in qnfo-fleet-dashboard), readers in 9 workers (audit-hub, qnfo-backlog-exec, qnfo-fleet-control, qnfo-fleet-dashboard, qnfo-fleet-deploy, qnfo-lifecycle, qnfo-observability, qnfo-ops, qnfo-scorecard). Run fleet-graph impact on d1t:qnfo-audit.fleet_probe_log first. Work: bind TELEMETRY in qnfo-fleet-dashboard, dual-write the insert in healthProbes behind ops_config d1_split_fleet_probe_log (old, dual), failure counted and never failing the probe run, ensureSchema for the table in TELEMETRY. No read switch and no backfill in this change (the backfill reuses 1b). Prediction: both tables count the same new rows over 24 h, probe run time unchanged within 5%. Closing marker: the change carries the text D1-SPLIT-1c in a comment.' || char(10) ||
 'code-task: repo=qnfo-workers path=qnfo-fleet-dashboard/worker.js' || char(10) ||
 'code-anchor: async function healthProbes(env, liveNames) {' || char(10) ||
 'code-probe: {"paths":["qnfo-fleet-dashboard/worker.js"],"contains":"D1-SPLIT-1c"}',
 'session:d1-split-1', 'code', 'medium', 'open', unixepoch() * 1000, unixepoch() * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA D1-SPLIT-1c:%' AND status = 'open');
