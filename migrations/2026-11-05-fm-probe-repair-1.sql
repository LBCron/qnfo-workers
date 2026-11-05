-- FM-PROBE-REPAIR-1 (2026-11-05, charter pillar autonomy, program QNFO.OPS; cluster C9-FAILURE-MODES; metric failure_modes_recurring, agent_issues 3002).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_fm_probe_repair_1
-- Rollback: restore the detectors from the rows of bak_20261105_fm_probe_repair_1 (obj contract: verify_transport = a, verify_probe = b, action = c; obj fm: probe_class = a, detector = b, remediation = c); ids: UPDATE cloud_ops_events SET id = NULL WHERE rowid IN (SELECT rid FROM bak_20261105_coe_null_id); descriptions: restore from bak_20261105_directive_newline; the sweep step: remove the step named directive-newline-sweep from the definition of the fleet task whose name starts ISSUE-HYGIENE-1
-- CAUSE-MAPPED: registers no metric_registry row (it repairs six failure-mode detectors and two data defects behind failure_modes_recurring).
--
-- MEASURED 2026-11-04 23:10-23:50Z (qnfo-audit SELECT, curl of the live pages, git grep of origin/main). v_failure_mode_status read 73 recurring. Eight detectors read a defect that is not there, or look for a text the owner-approved
-- remediation removed or moved; the fix is the detector (same defect, successor marker), never a threshold:
--  (1) fm-code-loop-budget-claim-starvation (code-read, observed missing-marker): the probe wanted "(gate.capped ? executed : done.length) < maxSteps"; qnfo-code-orchestrator was refactored and the loop now reads
--      "while (executed + reserved < maxSteps && (!gate.capped || scanned < 64) && ...": steps are counted on executed work and a capped scan is bounded, which is the remediation (CODE-LOOP-BUDGET-CLAIM-SCAN-1).
--  (2) fm-zaraz-autoinject-worker-html (runner-https, qnfo.org lacks /cdn-cgi/zaraz/i.js) and (3) fm-edge-copy-version-skew (ideas.qnfo.org lacks it): GA4-COLLECT-RESTORE-1 (2026-10-25, owner report, PR 4009) removed the
--      Zaraz loader on purpose: the Zaraz GA4 action fired at the edge and sent nothing, GA4 stored 0 rows from 2026-10-13. The successor of "the Workers pages carry the analytics loader" is the consent-gated loader
--      /qds-consent.js (BP26-CONSENT-1), which curl https://qnfo.org/ shows. The version-skew mode (a stored copy built by an older version served after a deploy) is not about Zaraz: its remediation is the version stamp
--      in the stored copy (idea-hub: hd.set("X-Ideas-Version", VERSION); qnfo-gateway: hd.set("X-Hub-Version", VERSION)), which a code-read probe can hold.
--  (4) fm-q08-writer-yield-order: Q08-WRITER-ORDER-2 (2026-10-26) replaced the gpt-oss-first order with nemotron, gpt-oss, kimi because the first order was chosen on the writer-gate pass rate, a proxy (writer-order-by-proxy:
--      66.1, 60.2 and 21.2 percent gate passes, 1.7, 0.9 and 10.2 percent published). The old probe asks for the superseded order; writer-order-by-proxy (roadmap row 1381) has no detector. Both modes now read the current
--      array of q08-signal-engine, and the second gets its own contract.
--  (5) fm-d1-like-pattern-length counted every open issue whose contract reads probe-error: 2 of 2 on 2026-11-04 23:30Z were "HTTP 429 ... D1 DB is overloaded" (issue-1001233, issue-1000805), not a LIKE over 50 bytes. It now
--      requires a LIKE/GLOB error event for the contract in the last 6 hours.
--  (6) fm-redundant-indexes counted 8 indexes on remediation_verifications against 7: D1-HOTSPOTS-3 (PR 7236) added idx_rv_pending_fail, a partial index with about 2 K entries that is written only for a pending failure.
--      The write amplification the mode is about comes from full indexes, so it now allows 7 full indexes and 2 partial ones.
-- Data defects: (7) fm-coe-null-id counts 302 cloud_ops_events rows without an id: 289 errata_confirm_defer (last 2026-11-01 11:01, the writers in errata-hub and qnfo-research-exec now pass crypto.randomUUID()) and 13 one-off
--      rows of 2026-10-21..24 (owner_queue_audit, thread_closeout, ...); they are backfilled with the statement of migrations/2026-10-13-coe-null-id-ts-normalise.sql. (8) fm-directive-literal-newline counts 3 open
--      METRIC-TRIGGER issues (1893, 2522, 2758) whose description quotes an agent's JSON answer with a literal backslash-n before code-task/code-anchor lines (the management-persona parked-report and lever-report steps append
--      the answer unescaped), so the planner cannot read the agent's anchor; they are repaired, and the hourly ISSUE-HYGIENE-1 task gets a sweep step that repairs any later one (an AFTER UPDATE trigger on agent_issues is
--      not allowed: AGENT-ISSUES-TRIGGER-DEPTH-1).
-- Prediction: failure_modes_recurring -8 within one consumer run after the apply (73 -> 65 or fewer, unprobed unchanged).

CREATE TABLE IF NOT EXISTS bak_20261105_fm_probe_repair_1 AS
SELECT 'contract' AS obj, class AS k, verify_transport AS a, verify_probe AS b, action AS c FROM remediation_contracts
WHERE class IN ('fm-code-loop-budget-claim-starvation', 'fm-zaraz-autoinject-worker-html', 'fm-edge-copy-version-skew', 'fm-q08-writer-yield-order', 'fm-d1-like-pattern-length', 'fm-redundant-indexes')
UNION ALL
SELECT 'fm', fm_key, probe_class, detector, remediation FROM failure_modes
WHERE fm_key IN ('code-loop-budget-claim-starvation', 'zaraz-autoinject-worker-html', 'edge-copy-version-skew', 'q08-writer-yield-order', 'writer-order-by-proxy', 'd1-like-pattern-length', 'redundant-indexes');

CREATE TABLE IF NOT EXISTS bak_20261105_coe_null_id AS SELECT rowid AS rid, kind, ts FROM cloud_ops_events WHERE id IS NULL;
CREATE TABLE IF NOT EXISTS bak_20261105_directive_newline AS SELECT id, description FROM agent_issues WHERE id IN (1893, 2522, 2758);

-- (1)
UPDATE remediation_contracts SET verify_probe = '{"paths":["qnfo-code-orchestrator/worker.js"],"contains":"executed + reserved < maxSteps && (!gate.capped || scanned < 64)"}'
WHERE class = 'fm-code-loop-budget-claim-starvation';
-- (2)
UPDATE remediation_contracts SET verify_probe = '{"url": "https://qnfo.org/", "status": 200, "contains": "/qds-consent.js"}',
  action = 'failure-mode detector: the qnfo.org hub head carries the consent-gated analytics loader (BP26-CONSENT-1); the Zaraz loader was removed by GA4-COLLECT-RESTORE-1 on 2026-10-25 because Zaraz sent no GA4 hits'
WHERE class = 'fm-zaraz-autoinject-worker-html';
-- (3)
UPDATE remediation_contracts SET verify_transport = 'code-read', verify_probe = '{"paths":["idea-hub/worker.js"],"contains":"hd.set(\"X-Ideas-Version\", VERSION)"}',
  action = 'failure-mode detector: the stored ideas.qnfo.org copy carries the VERSION that built it (HUB-CACHE-VERSION-2); the gateway twin is hd.set("X-Hub-Version", VERSION) in qnfo-gateway/worker.js'
WHERE class = 'fm-edge-copy-version-skew';
-- (4)
UPDATE remediation_contracts SET verify_probe = '{"paths":["q08-signal-engine/worker.js"],"contains":"var COMPOSE_MODELS = [\n  \"@cf/nvidia/nemotron-3-120b-a12b\",\n  \"@cf/openai/gpt-oss-120b\",\n  \"@cf/moonshotai/kimi-k2.6\","}',
  precondition = 'Q08-WRITER-ORDER-2 (nemotron, gpt-oss, kimi) is present on main; the earlier gpt-oss-first order of Q08-WRITER-YIELD-1 was chosen on a proxy and is superseded'
WHERE class = 'fm-q08-writer-yield-order';
INSERT OR IGNORE INTO remediation_contracts
 (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to, module, next_due_at)
VALUES
 ('fm-writer-order-by-proxy', NULL,
  '{"paths":["q08-signal-engine/worker.js"],"contains":"var COMPOSE_MODELS = [\n  \"@cf/nvidia/nemotron-3-120b-a12b\",\n  \"@cf/openai/gpt-oss-120b\",\n  \"@cf/moonshotai/kimi-k2.6\","}',
  'code-read', 3, 1, 'active', 'FM-PROBE-REPAIR-1',
  'failure-mode detector: the composer order is the one chosen on end-to-end yield (Q08-WRITER-ORDER-2), not on the writer-gate pass rate; ops_config q08_compose_order can override it without a deploy, so a change of order is made by a reviewed commit that updates this marker',
  'q08-signal-engine', 'failure-mode', datetime('now'));
UPDATE failure_modes SET probe_class = 'fm-writer-order-by-proxy',
  detector = 'fm-writer-order-by-proxy (code-read: COMPOSE_MODELS in q08-signal-engine/worker.js lists nemotron, gpt-oss, kimi in that order); outcome shares are tracked in v_output_quality_by_surface'
WHERE fm_key = 'writer-order-by-proxy' AND probe_class IS NULL;
-- (5)
UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts c JOIN agent_issues a ON c.class = ''issue-'' || a.id WHERE a.status = ''open'' AND c.status = ''active'' AND c.last_verdict = ''probe-error'' AND EXISTS (SELECT 1 FROM cloud_ops_events e WHERE e.kind = ''remediation.probe-error'' AND e.ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-6 hours'') AND instr(e.text, ''class='' || c.class || '' '') = 1 AND instr(e.text, ''LIKE or GLOB pattern'') > 0)) AS TEXT) AS observed'
WHERE class = 'fm-d1-like-pattern-length';
-- (6)
UPDATE remediation_contracts SET verify_probe = 'SELECT ''0'' AS expected, CAST(COALESCE(MAX(0, SUM(instr(sql, '' WHERE '') = 0) - 7), 0) + COALESCE(MAX(0, SUM(instr(sql, '' WHERE '') > 0) - 2), 0) AS TEXT) AS observed FROM sqlite_master WHERE type = ''index'' AND tbl_name = ''remediation_verifications'' AND sql IS NOT NULL',
  precondition = 'remediation_verifications has at most 7 full indexes and 2 partial ones'
WHERE class = 'fm-redundant-indexes';

-- the failure-mode rows say what the detectors now read
UPDATE failure_modes SET detector = 'fm-zaraz-autoinject-worker-html (runner-https: https://qnfo.org/ contains /qds-consent.js, the consent-gated analytics loader that replaced the Zaraz loader in GA4-COLLECT-RESTORE-1, 2026-10-25)',
  remediation = remediation || ' | FM-PROBE-REPAIR-1 (2026-11-05): the Zaraz loader was removed on purpose (PR 4009); the detector holds its successor'
WHERE fm_key = 'zaraz-autoinject-worker-html' AND instr(remediation, 'FM-PROBE-REPAIR-1') = 0;
UPDATE failure_modes SET detector = 'fm-edge-copy-version-skew (code-read: idea-hub/worker.js stamps the stored copy with X-Ideas-Version = VERSION; qnfo-gateway/worker.js stamps X-Hub-Version)',
  remediation = remediation || ' | FM-PROBE-REPAIR-1 (2026-11-05): the Zaraz marker the runner probe read is gone (GA4-COLLECT-RESTORE-1); the detector holds the version stamp itself'
WHERE fm_key = 'edge-copy-version-skew' AND instr(remediation, 'FM-PROBE-REPAIR-1') = 0;
UPDATE failure_modes SET detector = 'fm-q08-writer-yield-order (code-read: the Q08-WRITER-ORDER-2 array in q08-signal-engine/worker.js); superseded the gpt-oss-first order, see writer-order-by-proxy',
  remediation = remediation || ' | FM-PROBE-REPAIR-1 (2026-11-05): superseded by Q08-WRITER-ORDER-2 (nemotron, gpt-oss, kimi); the detector holds the current array'
WHERE fm_key = 'q08-writer-yield-order' AND instr(remediation, 'FM-PROBE-REPAIR-1') = 0;
UPDATE failure_modes SET detector = 'fm-d1-like-pattern-length: open issues whose contract reads probe-error AND whose probe-error event of the last 6 hours names a LIKE or GLOB pattern error (D1 overload errors are not this mode)',
  remediation = remediation || ' | FM-PROBE-REPAIR-1 (2026-11-05): the detector no longer counts HTTP 429 overload errors'
WHERE fm_key = 'd1-like-pattern-length' AND instr(remediation, 'FM-PROBE-REPAIR-1') = 0;
UPDATE failure_modes SET detector = 'fm-redundant-indexes (at most 7 full indexes and 2 partial indexes on remediation_verifications)',
  remediation = remediation || ' | FM-PROBE-REPAIR-1 (2026-11-05): partial indexes (idx_rv_pending_fail, about 2 K entries) are counted separately from full ones'
WHERE fm_key = 'redundant-indexes' AND instr(remediation, 'FM-PROBE-REPAIR-1') = 0;
UPDATE failure_modes SET detector = 'fm-code-loop-budget-claim-starvation (code-read: executed + reserved < maxSteps && (!gate.capped || scanned < 64) in qnfo-code-orchestrator/worker.js)'
WHERE fm_key = 'code-loop-budget-claim-starvation';

-- data defects
UPDATE cloud_ops_events SET id = 'coe-' || lower(hex(randomblob(8))) WHERE id IS NULL;

UPDATE agent_issues SET
  description = replace(replace(replace(replace(replace(replace(description,
    '\ncode-task:', char(10) || 'code-task:'), '\ncode-anchor:', char(10) || 'code-anchor:'), '\ncode-probe:', char(10) || 'code-probe:'),
    '\nruntime-probe:', char(10) || 'runtime-probe:'), '\nsession-task:', char(10) || 'session-task:'), '\ndepends-on:', char(10) || 'depends-on:'),
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE status = 'open' AND (instr(description, '\ncode-') > 0 OR instr(description, '\nruntime-probe:') > 0 OR instr(description, '\nsession-task:') > 0 OR instr(description, '\ndepends-on:') > 0);

UPDATE fleet_tasks SET
  definition = json_insert(definition, '$.steps[#]', json('{"type":"sql","name":"directive-newline-sweep","db":"AUDIT","sql":"UPDATE agent_issues SET description = replace(replace(replace(replace(replace(replace(description, char(92) || ''ncode-task:'', char(10) || ''code-task:''), char(92) || ''ncode-anchor:'', char(10) || ''code-anchor:''), char(92) || ''ncode-probe:'', char(10) || ''code-probe:''), char(92) || ''nruntime-probe:'', char(10) || ''runtime-probe:''), char(92) || ''nsession-task:'', char(10) || ''session-task:''), char(92) || ''ndepends-on:'', char(10) || ''depends-on:''), updated_at = CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 WHERE status = ''open'' AND (instr(description, char(92) || ''ncode-'') > 0 OR instr(description, char(92) || ''nruntime-probe:'') > 0 OR instr(description, char(92) || ''nsession-task:'') > 0 OR instr(description, char(92) || ''ndepends-on:'') > 0)"}')),
  version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE name LIKE 'ISSUE-HYGIENE-1:%' AND instr(definition, 'directive-newline-sweep') = 0;

INSERT INTO decision_log
 (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, surfaces_tested)
SELECT 'claude-code-session-2026-11-04-c9-failure-modes',
 'A detector that asks for a text its own approved remediation removed measures nothing; a detector repaired to the successor invariant keeps the same defect in scope',
 'FM-PROBE-REPAIR-1: repair six failure-mode detectors to their successor markers, arm fm-writer-order-by-proxy, backfill 302 cloud_ops_events ids, repair three directive-newline descriptions and add the sweep step to ISSUE-HYGIENE-1',
 'v_failure_mode_status 73 recurring at 2026-11-04 23:30Z; curl https://qnfo.org/ has /qds-consent.js and no zaraz; orchestrator loop line "executed + reserved < maxSteps && (!gate.capped || scanned < 64)"; COMPOSE_MODELS nemotron, gpt-oss, kimi; D1 429 probe-errors for issue-1001233 and issue-1000805; 302 id IS NULL rows (289 errata_confirm_defer last 2026-11-01)',
 'six detectors read their real defect; two data defects repaired',
 'six remediation_contracts rows, seven failure_modes rows, cloud_ops_events.id of 302 historic rows, three agent_issues descriptions, one fleet_tasks definition',
 'Rollback line of this file (bak_20261105_fm_probe_repair_1, bak_20261105_coe_null_id, bak_20261105_directive_newline)',
 'failure-mode detectors follow the remediation instead of its first marker',
 'failure_modes_recurring -8 within one consumer run (73 -> 65 or fewer)',
 'migrations/fm-probe-repair-1.test.mjs (replay of the six probes, the two repairs and the step JSON) and git grep of each marker on origin/main'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'FM-PROBE-REPAIR-1:%');
