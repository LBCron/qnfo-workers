-- C4-FM2-LEVER-NONANCHOR-GATE-1 (2026-11-05, charter pillar autonomy; roadmap_implementation 1755 FM-2, agent_issues 1000718; follow-up of PR 7398 and 7438).
-- Row 1755 asks that a code-task from an agent answer pass an anchor check before it is stored. The check that exists is the model's own (the root-cause prompt, probe 1000718) and the code loop's
-- locator at intake (ANCHOR-LOCATOR-1, which absorbs an anchor that occurs 0 or 2+ times). Read 2026-11-05T01:00Z: the lever review is the path that stores agent code-tasks in issue descriptions
-- (management-personas-c lever-report appends a reply that holds `code-task: repo=qnfo-workers path=`, `code-anchor:` and `EDIT:`), 52 issues carry such a block, 19 of them open with an anchor line, and of
-- 13 open ones checked against main 2 resolve exactly once as stored, 5 after stripping backticks and 8 not at all: two of the eight are the model's own admission that it has no anchor, stored as a task:
--   1000391  code-task path `qnfo-agents/src/ (lever-review / ... exact file NOT read in this turn)`, code-anchor: NOT ESTABLISHED - I did not read the producer source, and I will not supply an unverified anchor.
--   1001373  code-task path migrations/2026-11-04-iar-r1-live-doer-verify-semicolon.sql (a file that does not exist), code-anchor: not quotable - the playbook-insert migration's text was never read.
-- The other six (a comment line that moved, a trigger line, three `; code-anchor:` inline forms, escaped quotes) need the file to be judged and are left to the locator: the 2 of 2 stored doer anchors
-- that occur 0 times on main (issues 99930 and 100464) have merged tasks. A file-reading check at store time would live in qnfo-agents finishRequest, claimed by another session; not built.
-- What this file builds is the part SQL can decide: a reply whose code-anchor line starts with `not` (case-insensitive: NOT ESTABLISHED, not captured, not quotable, NOT VERIFIED) is the model saying it
-- has no anchor, so it is not a lever reply. In management-personas-c the lever-request (a usable reply in the last 3 days stops a new request), lever-report (appends) and lever-mark (marks a reply
-- 'empty', which the request step answers with a new request inside lever_per_trigger_daily and lever_daily_cap) all carry the same predicate six times; each gets
-- `AND COALESCE(r.result, '') NOT LIKE '%code-anchor: not %'` after the code-anchor test. The two stored blocks lose their task marker (code-task and code-anchor lose the colon), so the issues read doer-less again
-- and the doer-gap chain (dg-request) can assign one. fm-diagnosis-unresolved-anchor now also counts open issues whose description holds such an anchor line (expected 0).
-- Prediction: the two issues leave `instr(lower(description), 'code-anchor: not ') > 0`; no further lever reply with a non-anchor is appended (2 of 52 stored so far); lever_requests per day stay inside the caps;
-- guards remediation_latest_pass_pct_7d (62.7), issue_wontfix_share_7d (0.0) and agents_lever_usable_share_48h (counts EDIT: or CORRECTED TARGET:, unchanged) not worse.
-- Falsified if a lever reply that names a real anchor on a line starting with `not` is rejected (none of 52 stored blocks does).
-- Rollback: UPDATE fleet_tasks SET definition = (SELECT b.old_value FROM bak_20261105_c4_fm2 b WHERE b.kind = 'task' AND b.record_key = 'management-personas-c'), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = 'management-personas-c'; UPDATE agent_issues SET description = (SELECT b.old_value FROM bak_20261105_c4_fm2 b WHERE b.kind = 'issue' AND b.record_key = CAST(agent_issues.id AS TEXT)) WHERE id IN (1000391, 1001373); UPDATE remediation_contracts SET verify_probe = (SELECT b.old_value FROM bak_20261105_c4_fm2 b WHERE b.kind = 'probe' AND b.record_key = 'fm-diagnosis-unresolved-anchor') WHERE class = 'fm-diagnosis-unresolved-anchor';
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_c4_fm2
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_c4_fm2 (
  kind TEXT NOT NULL,
  record_key TEXT NOT NULL,
  old_value TEXT,
  PRIMARY KEY (kind, record_key)
);

INSERT OR IGNORE INTO bak_20261105_c4_fm2 (kind, record_key, old_value)
SELECT 'task', id, definition FROM fleet_tasks WHERE id = 'management-personas-c';
INSERT OR IGNORE INTO bak_20261105_c4_fm2 (kind, record_key, old_value)
SELECT 'issue', CAST(id AS TEXT), description FROM agent_issues WHERE id IN (1000391, 1001373);
INSERT OR IGNORE INTO bak_20261105_c4_fm2 (kind, record_key, old_value)
SELECT 'probe', class, verify_probe FROM remediation_contracts WHERE class = 'fm-diagnosis-unresolved-anchor';

-- 1. The predicate of a usable lever reply, six times in management-personas-c (lever-request 1, lever-report 3, lever-mark 2). Written only when the fragment occurs exactly six times and the
-- gate is not there yet; any other shape (a concurrent edit of the task) writes nothing.
UPDATE fleet_tasks
SET definition = replace(definition,
      'COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%''',
      'COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') NOT LIKE ''%code-anchor: not %'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%'''),
    version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c' AND json_valid(definition)
  AND instr(definition, 'NOT LIKE ''%code-anchor: not %''') = 0
  AND (length(definition) - length(replace(definition, 'COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%''', '')))
      = 6 * length('COALESCE(r.result, '''') LIKE ''%code-anchor:%'' AND COALESCE(r.result, '''') LIKE ''%EDIT:%''');

-- 2. The two stored blocks that say they have no anchor stop being tasks (the marker loses its colon; the text stays readable).
UPDATE agent_issues
SET description = replace(replace(description, 'code-task: repo=qnfo-workers path=qnfo-agents/src/ (lever-review', 'code-task (FM-2: no file, no anchor) repo=qnfo-workers path=qnfo-agents/src/ (lever-review'),
                          'code-anchor: NOT ESTABLISHED', 'code-anchor (FM-2: not established):')
WHERE id = 1000391 AND instr(description, 'code-anchor: NOT ESTABLISHED') > 0;
UPDATE agent_issues
SET description = replace(replace(description, 'code-task: repo=qnfo-workers path=migrations/2026-11-04-iar-r1-live-doer-verify-semicolon.sql', 'code-task (FM-2: that file does not exist) repo=qnfo-workers path=migrations/2026-11-04-iar-r1-live-doer-verify-semicolon.sql'),
                          'code-anchor: not quotable', 'code-anchor (FM-2: not quotable):')
WHERE id = 1001373 AND instr(description, 'code-anchor: not quotable') > 0;

-- 3. The FM-2 detector (the sla-graph-fm-1 contract) reads the prompt rule AND the stored non-anchors; guarded on its old text so a second apply is a no-op.
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''1'' AS expected, CASE WHEN instr((SELECT definition FROM fleet_tasks WHERE id = ''management-personas''), ''occurs exactly once in it'') > 0 AND instr((SELECT definition FROM fleet_tasks WHERE id = ''management-personas''), ''D1 trigger, view, migration or fleet_tasks step'') > 0 AND NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = ''open'' AND id >= 100000 AND instr(lower(description), ''code-anchor: not '') > 0) THEN ''1'' ELSE ''0'' END AS observed',
    precondition = 'even-keel FM-2 (agent_issues 1000718); probe extended by C4-FM2-LEVER-NONANCHOR-GATE-1',
    action = 'failure-mode detector: the root-cause prompt carries the anchor rule and no open issue stores a code-anchor line that says there is no anchor',
    attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
WHERE class = 'fm-diagnosis-unresolved-anchor' AND instr(verify_probe, 'code-anchor: not') = 0 AND instr(verify_probe, 'occurs exactly once in it') > 0;
UPDATE failure_modes
SET detector = 'fm-diagnosis-unresolved-anchor: the live root-cause prompt carries the anchor and layer rule and no open issue stores a code-anchor line that starts with not (the lever gate of C4-FM2-LEVER-NONANCHOR-GATE-1), expected 1; the file-reading check of a stored anchor is the code loop intake (ANCHOR-LOCATOR-1)'
WHERE fm_key = 'diagnosis-unresolved-anchor' AND probe_class = 'fm-diagnosis-unresolved-anchor' AND instr(detector, 'C4-FM2-LEVER-NONANCHOR-GATE-1') = 0;

-- 4. Row 1755 keeps its status; the measured limit is appended once.
UPDATE roadmap_implementation
SET evidence = evidence || ' | C4-FM2-LEVER-NONANCHOR-GATE-1 (PR 7455, read 2026-11-05T01:00Z): what is stored is not checked against the file. 52 issues carry a lever-review block, 13 open ones were checked against main: 2 anchors resolve once as stored, 5 after stripping backticks, 8 not at all (2 of them the model saying it has no anchor: 1000391 and 1001373; 4 inline or escaped forms; a moved comment; a trigger line); 2 of 8 stored doer anchors occur 0 times and both issues have merged tasks, so the locator at intake absorbs the rest. Built: lever-request, lever-report and lever-mark of management-personas-c refuse a reply whose code-anchor line starts with not, the two stored blocks lose the task marker, fm-diagnosis-unresolved-anchor counts stored non-anchors. Not built: a file-reading check at store time (qnfo-agents finishRequest), because the locator absorbs a moved anchor.'
WHERE id = 1755 AND instr(COALESCE(evidence, ''), 'C4-FM2-LEVER-NONANCHOR-GATE-1') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:c4-fm',
  'an agent that says it has no anchor has not proposed a code-task; storing the line as one tells every doer counter that the issue has a doer',
  'C4-FM2-LEVER-NONANCHOR-GATE-1: lever-request, lever-report and lever-mark refuse a reply whose code-anchor line starts with not; the two stored blocks lose the task marker; the FM-2 detector counts stored non-anchors',
  '2026-11-05T01:00Z: 52 lever blocks stored, 2 with a non-anchor (1000391, 1001373), 8 of 13 open stored anchors never resolve (2 resolve as stored, 5 after stripping backticks), 2 of 8 doer anchors occur 0 times and their tasks merged',
  'pending canonical migration; measured by fm-diagnosis-unresolved-anchor', 'fleet_tasks management-personas-c (one version bump), two issue descriptions, one detector probe',
  'the Rollback line of migrations/2026-11-05-c4-fm2-lever-nonanchor-gate.sql with bak_20261105_c4_fm2',
  'fm2-lever-nonanchor-gate-1',
  'no lever reply with a code-anchor line starting with not is appended after the apply; fm-diagnosis-unresolved-anchor reads 1; lever requests stay inside lever_per_trigger_daily and lever_daily_cap; agents_lever_usable_share_48h unchanged',
  'not a reach change; lever quality',
  'node:sqlite suite migrations/c4-fm2-lever-nonanchor-gate.test.mjs (the live lever-report and lever-mark statements, a usable reply, a non-anchor reply, a CORRECTED TARGET reply, idempotent re-apply, a concurrent edit writes nothing)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session:c4-fm' AND capability_gain = 'fm2-lever-nonanchor-gate-1');
