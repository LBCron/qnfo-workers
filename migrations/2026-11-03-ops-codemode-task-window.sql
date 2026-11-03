-- OPS-CODEMODE-TASK-WINDOW-1 (#1001269 / #6427; charter pillar: autonomy).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261103_ops_codemode_task
-- Rollback: UPDATE code_tasks SET (goal, status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at) = (SELECT goal, status, step, attempts, model, ctx, branch, last_error, lease_until, updated_at FROM bak_20261103_ops_codemode_task b WHERE b.id = code_tasks.id) WHERE id IN (SELECT id FROM bak_20261103_ops_codemode_task) AND status = 'queued' AND step = 'read' AND attempts = 0 AND lease_until IS NULL AND pr_url IS NULL AND instr(goal, 'OPS-CODEMODE-TASK-WINDOW-1') > 0;
--
-- D1 read 2026-11-03: ct_r519athz3t8ysi failed after nine attempts. Its
-- catalogue anchor shows offsets 147161..171220, but ownerRestRoutes is at
-- 729772 on this checkout. Even the catalogue's closing bracket is outside
-- that window (200908). The goal requires MCP edits the model cannot see.
-- Move the anchor and the implementation to the MCP handler, using the
-- existing opsRestToolList(true) accessor instead of copying the catalogue.
-- Clear stale proposals and failure signatures; keep every verification gate.
-- This is one retry, not recovery evidence. The existing issue-1001269
-- d1-query contract closes only on ready_to_publish or later; issue 1000639
-- still requires its separate 20-task before/after measurement.

CREATE TABLE IF NOT EXISTS bak_20261103_ops_codemode_task AS
SELECT * FROM code_tasks
WHERE id = 'ct_r519athz3t8ysi' AND repo = 'qnfo-workers'
  AND path = 'qnfo-ops/worker.js' AND status = 'failed' AND step = 'propose'
  AND pr_url IS NULL AND lease_until IS NULL
  AND instr(last_error, 'SEARCH text occurs 0 times in the shown content') > 0
  AND json_extract(ctx, '$.anchor') = 'var OPS_TOOLS = ['
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001269 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000639 AND status = 'open');

UPDATE code_tasks
SET goal = '[issue #1000639] OPS-CODEMODE-TASK-WINDOW-1: implement the opt-in MCP search/execute surface within ownerRestRoutes.'
    || char(10) || 'Keep all edits in or immediately beside ownerRestRoutes, which is shown in this anchor window. Use opsRestToolList(true) to read the existing catalogue; do not edit or copy the distant OPS_TOOLS definition. Add a comment containing CODEMODE-SURFACE-1.'
    || char(10) || 'For MCP tools/list only, surface=codemode in the URL query or m.params returns exactly two descriptors, ops_search (query: string) and ops_execute (name: string, args: object). Without the opt-in, keep the existing tools/list response byte-for-byte unchanged. Do not add these descriptors to OPS_TOOLS or change REST endpoints or normal dispatch.'
    || char(10) || 'Handle these two MCP tools/call names within the same authenticated handler. ops_search does case-insensitive keyword matching on catalogue names and descriptions, returning each hit as name plus the first description line. ops_execute must reject a name not in opsRestToolList(true), then call the existing local run(name, args) unchanged so execTool gates, redaction and audit writes still apply. Do not bypass ownerKeyOk or allow recursive ops_execute calls.'
    || char(10) || 'For each MCP tools/list response and each ops_search or ops_execute response, write a cloud_ops_events row with kind ops-surface-size, job qnfo-ops and the serialized response size in characters, using the existing QNFO_AUDIT binding, randId and iso insert pattern. Preserve JSON-RPC ids and content/isError envelopes. Keep ASCII and existing var/function style. Do not edit VERSION; the orchestrator bumps it and mirrors the source. Existing suites must pass before publication.'
    || char(10) || 'This is the first step of issue 1000639, not its 20-task evaluation. Issue 1001269 closes only when this task reaches ready_to_publish or later with verification evidence.',
    status = 'queued', step = 'read', attempts = 0, model = NULL,
    ctx = json_object('anchor', 'async function ownerRestRoutes(request, env, path, method) {'),
    branch = NULL, last_error = NULL, lease_until = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT id FROM bak_20261103_ops_codemode_task)
  AND status = 'failed' AND step = 'propose'
  AND pr_url IS NULL AND lease_until IS NULL
  AND instr(last_error, 'SEARCH text occurs 0 times in the shown content') > 0
  AND json_extract(ctx, '$.anchor') = 'var OPS_TOOLS = ['
  AND instr(goal, 'OPS-CODEMODE-TASK-WINDOW-1') = 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001269 AND status = 'open')
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000639 AND status = 'open');

INSERT OR IGNORE INTO failure_modes
  (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES
  ('ops-codemode-task-window', 'Ops MCP task exhausts exact-search retries',
   'Catalogue anchor window excludes both its closing bracket and the MCP handler required by the goal',
   'OPS-CODEMODE-TASK-WINDOW-1: reanchor at ownerRestRoutes, use the catalogue accessor and reread current main once',
   'The narrowed task must not fail again', 'fm-ops-codemode-task-window', '2026-11-02', 1001269);

INSERT OR IGNORE INTO remediation_contracts
  (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES
  ('fm-ops-codemode-task-window', NULL, 'OPS-CODEMODE-TASK-WINDOW-1', 'failure-mode detector',
   'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM code_tasks WHERE id = ''ct_r519athz3t8ysi'' AND instr(goal, ''OPS-CODEMODE-TASK-WINDOW-1'') > 0 AND status IN (''failed'', ''needs_human'', ''publish_failed'')',
   'd1-query', 3, 'qnfo-fleet-control', 1, 'active', 'failure-mode');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'copilot-6498',
  'A verified exact edit requires the requested implementation to be inside the source window',
  'OPS-CODEMODE-TASK-WINDOW-1: narrow and requeue ct_r519athz3t8ysi at the MCP handler',
  'Nine failed attempts; stored SEARCH names a bracket outside the catalogue window; MCP handler is over 570000 characters from the old anchor',
  'Retry queued, not yet verified; both issues remain open on their existing probes',
  'One failed code task and a failure-mode detector; no runtime, authentication or verification changes',
  'Rollback header restores the original task only before any runner leases or advances it',
  'Code loop can see every MCP edit required by the narrowed task',
  'One exhausted task reaches ready_to_publish or later without lowering verification',
  'No public reach change', 'node migrations/ops-codemode-task-window.test.mjs'
WHERE EXISTS (SELECT 1 FROM bak_20261103_ops_codemode_task)
  AND NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'OPS-CODEMODE-TASK-WINDOW-1:%');
