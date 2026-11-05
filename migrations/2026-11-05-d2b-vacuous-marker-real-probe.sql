-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET action = (SELECT b.action FROM bak_20261105_d2b_vacuous_marker b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_d2b_vacuous_marker); DELETE FROM remediation_contracts WHERE class = 'fm-vacuous-marker-on-measuring-probe'; DELETE FROM failure_modes WHERE fm_key = 'vacuous-marker-on-measuring-probe'; DELETE FROM metric_registry WHERE metric = 'vacuous_probe_share'; DELETE FROM metric_breach_cause WHERE metric_key = 'vacuous_probe_share'; UPDATE roadmap_implementation SET status = 'planned' WHERE id = 1757; UPDATE fleet_tasks SET definition = (SELECT b.definition FROM bak_20261105_d2b_vacuous_tasks b WHERE b.id = fleet_tasks.id), version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id IN (SELECT id FROM bak_20261105_d2b_vacuous_tasks)
-- The Rollback leaves the decision row: decision_log is append-only.
-- BACKUP: bak_20261105_d2b_vacuous_marker
-- VACUOUS-MARKER-REAL-PROBE-1 (2026-11-05, charter pillar autonomy; roadmap_implementation 1757 FM-4 / GitHub 5618, "Vacuous contracts: 190 issues closed on a probe that measures nothing (50 reopened).
-- Replace the vacuous probe with a measuring probe at issue-open time, starting with the METRIC-UNMEASURED-1 and CF-OBS-ISSUE-1 families, and report the vacuous share").
-- VACUOUS-FLAP-1 (migrations/2026-10-28-vacuous-flap-1.sql) stops the autoclose triggers from closing an already-reopened issue while one of its active or holding contracts has an action that
-- starts with VACUOUS-PROBE (the born placeholder: "this contract measures nothing while the issue is open ... A doer that knows the defect replaces this probe with one that measures it").
-- The doers did replace the probes, but the replacement writes verify_probe and leaves the action text, so the marker outlives the placeholder and the clause keeps holding issues whose probe is real.
-- Read live 2026-11-04T23:40Z: 189 active and 86 holding contracts carry the marker, none with the born circular probe (THEN 'closed' ELSE NULL END FROM agent_issues WHERE id = ...); 30 of them sit on open
-- issues that were reopened at least once, and 28 of those 30 probes have a failing verification with a non-empty observed value (they measure something: ops_ai error share, gateway 504 counts,
-- loop-breaker signatures, charter snapshot parse, migration errors, cron exceptions). Five of them read pass now (issue 1000575, 1000609, 1000838, 1000990, 1001695) and cannot close:
-- the clause holds them for a placeholder that no longer exists, which is the opposite of the intent ("a doer must replace the probe" was done).
-- Repair, in three parts:
--   1. One-time: the marker is cleared (action rewritten to start with REAL-PROBE-1 and keep the old text) on every active or holding contract whose probe has a failing verification with a
--      non-empty observed value, i.e. has demonstrably measured something. A contract whose probe never failed keeps the marker (2 of the 30), and a superseded placeholder keeps it.
--   2. Standing: step fm4-marker-sweep is appended to management-personas-plus (hourly) and runs the same UPDATE, so a doer that replaces a probe without its action is healed within the hour.
--      The detector fm-vacuous-marker-on-measuring-probe counts what the sweep has not yet cleared (expected 0).
--   3. At birth for the METRIC-UNMEASURED-1 family: the step mi-unmeasured-probe of management-personas-c replaced a placeholder probe with the owner-wide metric_improvement_now probe and left the
--      VACUOUS action; it now writes a measuring action in the same UPDATE. (CF-OBS-ISSUE-1 issues are filed with a real probe by their producer and are covered by the sweep.)
-- Prediction: within two hourly passes the 28 contracts read action REAL-PROBE-1; reopened issues whose real probe passes (five today) close on their next two-pass verification; the 2 contracts
-- that never failed keep the clause. Guard: reopens of closed issues do not rise above the 7-day baseline (the probes that close them are the ones that failed on real readings).
-- Falsified if an issue closed this way reopens within 24 hours because its probe measured nothing (then that probe is replaced, and the sweep keeps its marker via the never-failed rule).
--   4. The guard metric the roadmap item asks for: vacuous_probe_share = open issues on a contract that still carries the marker / open issues (the existing view v_vacuous_probe_share, 138 of 514 =
--      0.268 on 2026-11-04T23:40Z, before the clearing), refreshed hourly by the step fm4-vacuous-share of management-personas-plus. It is registered with a named trigger exemption (the clearing sweep
--      first shows the true remaining share; the contract of agent_issues 1000720 already requires the metric to exist and the two flapping families to carry no marker) and mapped to the structure cause
--      in this same file (CAUSE-MAPPED).
-- CAUSE-MAPPED: INSERT INTO metric_breach_cause below maps vacuous_probe_share to structure in this same file.

CREATE TABLE IF NOT EXISTS bak_20261105_d2b_vacuous_marker AS
  SELECT c.class, c.action, c.status
    FROM remediation_contracts c
   WHERE c.status IN ('active', 'holding')
     AND c.action LIKE 'VACUOUS-PROBE%'
     AND EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.class = c.class AND v.pass = 0 AND COALESCE(v.observed, '') <> '');

CREATE TABLE IF NOT EXISTS bak_20261105_d2b_vacuous_tasks AS
  SELECT id, definition, version FROM fleet_tasks WHERE id IN ('management-personas-plus', 'management-personas-c');

UPDATE remediation_contracts
SET action = 'REAL-PROBE-1: the born VACUOUS-PROBE placeholder was replaced by a probe that has failed on a real reading (remediation_verifications), so VACUOUS-FLAP-1 no longer treats this contract as a placeholder. Was: ' || action
WHERE status IN ('active', 'holding')
  AND action LIKE 'VACUOUS-PROBE%'
  AND EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.class = remediation_contracts.class AND v.pass = 0 AND COALESCE(v.observed, '') <> '');

-- Standing sweep: the same UPDATE, appended once to the hourly plus task.
UPDATE fleet_tasks
SET definition = json_insert(definition, '$.steps[#]', json_object(
      'type', 'sql', 'name', 'fm4-marker-sweep', 'db', 'AUDIT',
      'sql', 'UPDATE remediation_contracts SET action = ''REAL-PROBE-1: the born VACUOUS-PROBE placeholder was replaced by a probe that has failed on a real reading (remediation_verifications), so VACUOUS-FLAP-1 no longer treats this contract as a placeholder. Was: '' || action WHERE status IN (''active'', ''holding'') AND action LIKE ''VACUOUS-PROBE%'' AND EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.class = remediation_contracts.class AND v.pass = 0 AND COALESCE(v.observed, '''') <> '''')')),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus'
  AND instr(definition, '"fm4-marker-sweep"') = 0;

-- The guard metric and its hourly producer (after the sweep in the same task).
INSERT OR IGNORE INTO metric_registry
  (metric, layer, kind, formula, source_of_truth, baseline, target, owner, disposition_actor, refresh_cadence, warning_band, kill_band, last_value, last_refreshed, state, refresh_class)
VALUES
  ('vacuous_probe_share', 'system', 'guard',
   'open agent_issues whose active or holding remediation contract still carries the VACUOUS-PROBE action marker, divided by all open agent_issues (v_vacuous_probe_share.on_vacuous_probe / open_issues); the marker is cleared once the probe has failed on a real reading (VACUOUS-MARKER-REAL-PROBE-1)',
   'qnfo-audit.v_vacuous_probe_share <- remediation_contracts, agent_issues; refreshed hourly by management-personas-plus step fm4-vacuous-share',
   '0.268 (138 of 514 open issues, 2026-11-04T23:40Z, before the marker sweep)',
   '<= 0.15', 'qnfo-fleet-control',
   'exempt from a threshold trigger until the marker sweep has run for 7 days: the sweep first shows the true remaining share, and the contract of agent_issues 1000720 (FM-4) already requires this metric to exist and the METRIC-UNMEASURED-1 and CF-OBS-ISSUE-1 families to carry no marker (VACUOUS-MARKER-REAL-PROBE-1)',
   '1h', '> 0.15', '> 0.30', NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), 'UNMEASURED', 'computed');

INSERT OR IGNORE INTO metric_breach_cause (metric_key, cause_key, note) VALUES
  ('vacuous_probe_share', 'structure', 'VACUOUS-MARKER-REAL-PROBE-1 2026-11-05: an open issue on a placeholder contract cannot be closed or held by a measurement; the root cause of a high share is a structural gap in how probes replace placeholders (the doers leave the marker, the producers file with a placeholder), not a budget or a model.');

UPDATE fleet_tasks
SET definition = json_insert(definition, '$.steps[#]', json_object(
      'type', 'sql', 'name', 'fm4-vacuous-share', 'db', 'AUDIT',
      'sql', 'UPDATE metric_registry SET last_value = (SELECT CAST(ROUND(1.0 * on_vacuous_probe / MAX(1, open_issues), 3) AS TEXT) FROM v_vacuous_probe_share WHERE open_issues > 0), last_refreshed = strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now''), state = ''MEASURED'' WHERE metric = ''vacuous_probe_share'' AND EXISTS (SELECT 1 FROM v_vacuous_probe_share WHERE open_issues > 0)')),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-plus'
  AND instr(definition, '"fm4-vacuous-share"') = 0;

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'VACUOUS-MARKER-REAL-PROBE-1 (migrations/2026-11-05-d2b-vacuous-marker-real-probe.sql): marker cleared on probes that failed on a real reading (one-time and hourly sweep fm4-marker-sweep), METRIC-UNMEASURED-1 birth step writes a measuring action, guard metric vacuous_probe_share registered (producer step fm4-vacuous-share), detector fm-vacuous-marker-on-measuring-probe. Verification: the contract of agent_issues 1000720 reads pass and vacuous_probe_share holds a value.'
WHERE id = 1757 AND status = 'planned';

-- At birth, METRIC-UNMEASURED-1 family: the owner-wide probe is installed together with a measuring action.
UPDATE fleet_tasks
SET definition = replace(definition,
      'verify_transport = ''d1-query'' WHERE class IN (SELECT ''issue-'' || a.id FROM agent_issues a WHERE a.status = ''open'' AND a.title LIKE ''METRIC-UNMEASURED-1: % has metrics with no value'')',
      'verify_transport = ''d1-query'', action = ''MEASURES the issue: every enabled metric trigger of the owner holds a value or carries a named exemption (metric_improvement_now, bp26 = 0, verdict unmeasured). VACUOUS-MARKER-REAL-PROBE-1.'' WHERE class IN (SELECT ''issue-'' || a.id FROM agent_issues a WHERE a.status = ''open'' AND a.title LIKE ''METRIC-UNMEASURED-1: % has metrics with no value'')'),
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 'management-personas-c'
  AND instr(definition, 'verify_transport = ''d1-query'' WHERE class IN (SELECT ''issue-'' || a.id FROM agent_issues a WHERE a.status = ''open'' AND a.title LIKE ''METRIC-UNMEASURED-1: % has metrics with no value'')') > 0
  AND instr(definition, 'VACUOUS-MARKER-REAL-PROBE-1') = 0;

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('vacuous-marker-on-measuring-probe',
   'a remediation contract keeps the VACUOUS-PROBE action marker after its probe was replaced by one that measures, so VACUOUS-FLAP-1 keeps holding the reopened issue',
   'the placeholder is identified by the action text, not by the probe; a doer that replaces verify_probe leaves the action unchanged',
   'VACUOUS-MARKER-REAL-PROBE-1: the marker is cleared once the probe has failed on a real reading; step fm4-marker-sweep repeats it hourly; fm-vacuous-marker-on-measuring-probe counts what is left',
   'd1-query count of active or holding contracts whose action starts with VACUOUS-PROBE and whose probe has a failing verification with a non-empty observed value',
   'fm-vacuous-marker-on-measuring-probe', '2026-11-05', NULL,
   'a doer replaces a contract probe without rewriting the action text',
   'a reopened issue whose probe passes is not auto-closed (30 issues on 2026-11-04, 5 of them with a passing probe)',
   'every reopened issue with a replaced probe; the drain ratio of the issue queue');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to) VALUES
  ('fm-vacuous-marker-on-measuring-probe', NULL,
   'SELECT ''0'' AS expected, CAST((SELECT COUNT(*) FROM remediation_contracts c WHERE c.status IN (''active'', ''holding'') AND c.action LIKE ''VACUOUS-PROBE%'' AND EXISTS (SELECT 1 FROM remediation_verifications v WHERE v.class = c.class AND v.pass = 0 AND COALESCE(v.observed, '''') <> '''')) AS TEXT) AS observed',
   'd1-query', 3, 1, 'active', 'VACUOUS-MARKER-REAL-PROBE-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'VACUOUS-FLAP-1 asks a doer to replace a vacuous probe; once the probe has failed on a real reading it measures something, so the placeholder marker on the action must not keep holding the issue',
  'VACUOUS-MARKER-REAL-PROBE-1: the VACUOUS-PROBE action marker is cleared on contracts whose probe has failed on a real reading (one-time UPDATE, hourly sweep step fm4-marker-sweep, detector fm-vacuous-marker-on-measuring-probe); the METRIC-UNMEASURED-1 birth step writes a measuring action',
  'live reads 2026-11-04T23:40Z: 189 active and 86 holding contracts carry the marker and none the circular placeholder probe; 30 open reopened issues are held by the clause and 28 of their probes have a failing verification with a non-empty observed value; issues 1000575, 1000609, 1000838, 1000990 and 1001695 read pass and are held',
  'migration merged through the canonical path; management-personas-plus gains one step; no worker bundle changed',
  'remediation_contracts action text (about 28 to 250 rows), fleet_tasks management-personas-plus and management-personas-c, one failure mode and its detector',
  'the Rollback header restores the actions from bak_20261105_d2b_vacuous_marker and the two task definitions from bak_20261105_d2b_vacuous_tasks and removes the detector; the decision row stays (append-only)',
  'a reopened issue closes the moment its measuring probe passes, instead of waiting for a placeholder marker that no doer clears',
  'the detector reads 0 within two hourly passes; the five reopened issues with a passing probe close on their next two-pass verification; the 2 contracts that never failed keep the clause',
  'none',
  'offline suite migrations/d2b-vacuous-marker-real-probe.test.mjs (marker cleared only for probes with a failing real reading, replay no-op, sweep step, birth-step edit, detector, rollback); live reads of remediation_contracts and remediation_verifications'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'VACUOUS-MARKER-REAL-PROBE-1:%');
