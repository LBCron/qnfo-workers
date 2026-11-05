-- AI-CONTROL-AUTHORITY-1 (2026-11-03, charter pillar autonomy; QNFO.OPS): one revisioned D1 authority for owner-controlled AI pause/resume.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DROP TRIGGER IF EXISTS fleet_ai_control_revision_guard; DROP TRIGGER IF EXISTS fleet_ai_control_no_delete; DROP TRIGGER IF EXISTS fleet_ai_control_audit_after_update; DROP TRIGGER IF EXISTS fleet_ai_control_audit_after_insert; DROP TABLE IF EXISTS fleet_ai_control; DELETE FROM remediation_contracts WHERE class IN ('fm-ai-control-state', 'belief-ai-control-first-primary'); DELETE FROM failure_modes WHERE fm_key = 'ai-control-state-unavailable'; DELETE FROM control_registry WHERE control = 'owner-ai-control-authority'; DELETE FROM spof_registry WHERE component = 'fleet_ai_control singleton'; DELETE FROM belief_registry WHERE belief_key = 'ai-control-first-primary'; the append-only fleet_ai_control_audit history and its immutability triggers are retained.

CREATE TABLE IF NOT EXISTS fleet_ai_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_ai_control_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL,
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS fleet_ai_control_audit_no_update
BEFORE UPDATE ON fleet_ai_control_audit
BEGIN
  SELECT RAISE(ABORT, 'AI-CONTROL-AUTHORITY-1: audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS fleet_ai_control_audit_no_delete
BEFORE DELETE ON fleet_ai_control_audit
BEGIN
  SELECT RAISE(ABORT, 'AI-CONTROL-AUTHORITY-1: audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS fleet_ai_control_revision_guard
BEFORE UPDATE ON fleet_ai_control
WHEN NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'AI-CONTROL-AUTHORITY-1: revision must increase by one');
END;

CREATE TRIGGER IF NOT EXISTS fleet_ai_control_no_delete
BEFORE DELETE ON fleet_ai_control
BEGIN
  SELECT RAISE(ABORT, 'AI-CONTROL-AUTHORITY-1: singleton cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS fleet_ai_control_audit_after_insert
AFTER INSERT ON fleet_ai_control
BEGIN
  INSERT INTO fleet_ai_control_audit (revision, paused, updated_at, reason, actor)
  VALUES (NEW.revision, NEW.paused, NEW.updated_at, NEW.reason, NEW.actor);
END;

CREATE TRIGGER IF NOT EXISTS fleet_ai_control_audit_after_update
AFTER UPDATE ON fleet_ai_control
BEGIN
  INSERT INTO fleet_ai_control_audit (revision, paused, updated_at, reason, actor)
  VALUES (NEW.revision, NEW.paused, NEW.updated_at, NEW.reason, NEW.actor);
END;

INSERT OR IGNORE INTO fleet_ai_control (id, paused, revision, updated_at, reason, actor)
VALUES (1, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'initial running state', 'migration:AI-CONTROL-AUTHORITY-1');

INSERT OR IGNORE INTO control_registry
  (control, location, kind, guards_against, critical_path, disposition, disposition_state, alternate_path, evidence)
VALUES
  ('owner-ai-control-authority', 'qnfo-deploy-guard /ai-control; qnfo-audit.fleet_ai_control',
   'kill-switch', 'AI dispatch continuing after an owner pause or resuming from a stale revision',
   1, 'keep', 'applied', 'Trusted machine checks fail closed on missing or unavailable D1 state; restore the singleton from the canonical migration before resuming calls',
   'Owner status and mutations independently verify Cloudflare Access RS256 claims; each status/check/mutation reads the singleton in a first-primary session; pause increments every time and resume uses revision compare-and-set; regression suite covers auth, primary reads, failure and audit paths.');

-- CONTROL-PROBE-AT-BIRTH-1: a read-only, falsifiable probe of the alternate path (the canonical migration restores the singleton; this reads that the singleton, its audit table and its audit trigger exist).
INSERT OR IGNORE INTO control_alternate_probes (control, probe_sql, window_note, enabled) VALUES
 ('owner-ai-control-authority',
  'SELECT ''ok'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = ''table'' AND name = ''fleet_ai_control'') OR NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = ''table'' AND name = ''fleet_ai_control_audit'') THEN ''fleet_ai_control or its audit table is missing: re-apply migrations/2026-11-03-owner-ai-control.sql'' WHEN NOT EXISTS (SELECT 1 FROM fleet_ai_control WHERE id = 1) THEN ''the fleet_ai_control singleton row is missing: calls fail closed until the canonical migration seeds it'' WHEN NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = ''trigger'' AND name = ''fleet_ai_control_audit_after_update'') THEN ''the append-only audit trigger fleet_ai_control_audit_after_update is missing'' ELSE ''ok'' END AS observed',
  '60 min: a state probe on the singleton, its audit table and its audit trigger; any of them missing means a pause cannot be recorded or read, and the gate fails closed until the canonical migration is re-applied', 1);

INSERT OR IGNORE INTO spof_registry
  (component, critical_path, alternate_path, evidence)
VALUES
  ('fleet_ai_control singleton', 'AI-call authorization pause/revision state',
   'No alternate writer; calls fail closed while qnfo-audit is unavailable, then recover from the D1 backup and re-apply this migration',
   'One authoritative singleton is read through first-primary sessions. The authority suite verifies missing table/row and session failures return paused/unavailable rather than a permissive state.');

INSERT OR IGNORE INTO belief_registry
  (belief_key, claim, confidence, evidence, probe_class, built_on)
VALUES
  ('ai-control-first-primary', 'Every deploy-guard owner status, owner mutation and trusted machine check starts from the qnfo-audit primary session.',
   1, 'AI-CONTROL-AUTHORITY-1 routes use AUDIT.withSession("first-primary"); the ai-control suite verifies that option for every state access.',
   'belief-ai-control-first-primary', 'AI-CONTROL-AUTHORITY-1');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, trigger_condition, symptom, blast_radius)
VALUES
  ('ai-control-state-unavailable', 'AI control authority is absent or unreadable',
   'A missing singleton, migration, D1 binding or primary session could otherwise be mistaken for an unpaused default.',
   'Require the migration-seeded singleton, read first-primary on every route, return ai_control_unavailable with paused=true on every state error, and retain append-only change audit.',
   'fm-ai-control-state', 'fm-ai-control-state', '2026-11-03',
   'A state read or conditional mutation fails, or the singleton/audit schema is absent.',
   'AI consumers cannot establish the owner control state; the safe response is to stop the call.',
   'AI consumers that use the shared owner-controlled AI pause state');

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
VALUES
  ('fm-ai-control-state', NULL, 'AI-CONTROL-AUTHORITY-1 schema is applied',
   'Restore the singleton and audit triggers through the canonical migration path; never seed a runtime default.',
   'SELECT ''1'' AS expected, CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type=''table'' AND name=''fleet_ai_control'') AND EXISTS (SELECT 1 FROM sqlite_master WHERE type=''table'' AND name=''fleet_ai_control_audit'') AND EXISTS (SELECT 1 FROM fleet_ai_control WHERE id=1) AND EXISTS (SELECT 1 FROM sqlite_master WHERE type=''trigger'' AND name=''fleet_ai_control_audit_after_update'') THEN ''1'' ELSE ''0'' END AS observed',
   'd1-query', 3, 'program-manager:QNFO.OPS', 1, 'active', 'failure-mode', datetime('now')),
  ('belief-ai-control-first-primary', NULL, 'Deploy-guard authority routes use the first-primary D1 session.',
   'Preserve first-primary sessions for independent owner status, mutations and machine checks.',
   '{"paths":["qnfo-deploy-guard/worker.js"],"contains":"withSession(\"first-primary\")"}',
   'code-read', 3, 'program-manager:QNFO.OPS', 1, 'active', 'belief', datetime('now'));

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT
  'copilot:AI-CONTROL-AUTHORITY-1',
  'A revisioned singleton and independently verified owner identity provide a durable, fail-closed authority surface for the fleet AI pause control.',
  'AI-CONTROL-AUTHORITY-1: add owner-authenticated status/pause/resume and trusted first-primary machine checks in qnfo-deploy-guard.',
  'Owner Access JWT verification checks RS256 signature, issuer, audience, expiry, nbf, verified-email status, allowlisted email and subject; migration seeds only the initial running state and audits every state insert/update.',
  'Implementation and offline regression checks recorded; deployment and live verification remain pending.',
  'Owner-operated AI pause authority; downstream dispatch enforcement is implemented separately.',
  'Revert the worker route change through the canonical path; rollback this migration while retaining the append-only audit history.',
  'Revisioned owner pause/resume with stale-resume protection and trusted, primary-read state checks.',
  'Owner pause and resume cannot be spoofed through forwarded headers; stale resume cannot undo a later pause; missing state is never treated as running.',
  'No external audience change; reduces unintended AI activity while paused.',
  'Real generated RS256 JWTs, Access JWKS stub, owner/non-owner/expired/audience/signature cases, public caller spoof, D1 first-primary, pause/CAS/audit, paused routes, and fail-closed DB errors.'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action = 'AI-CONTROL-AUTHORITY-1: add owner-authenticated status/pause/resume and trusted first-primary machine checks in qnfo-deploy-guard.');
