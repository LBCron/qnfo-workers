-- D1-OVERLOAD-REFILE-1 + D1-OVERLOAD-UMBRELLA-PROBE-1 (2026-11-05, charter pillar autonomy; cluster D1-observability of the open-issue sweep).
-- GitHub 6852, 6853, 6863, 6866, 6867, 6869, 6959, 6975, 7116, 7197 (LOOP-BREAKER-1), 6892, 7278 (CF-OBS-ISSUE-1, D1 overloaded) and the umbrella agent_issues 1001715.
--
-- WHAT WAS MEASURED (qnfo-audit SELECT only, 2026-11-04 22:30Z to 2026-11-05 00:00Z)
--   Rule d1-overload-superseded of the hourly workflow issue-meta-fold closed 54 per-group D1-overload issues at 18:56Z as superseded by the umbrella. The ten LOOP-BREAKER-1 ones
--   (1001512, 1001513, 1001514, 1001550, 1001564, 1001565, 1001571, 1001594, 1001604, 1001630) were reopened at 19:53Z: issue_lifecycle holds dispositioned 18:56:31Z then reopened 19:53:37Z for
--   1001512, and issue_triage.reopened_count is 1 on all ten. The producer is scripts/loop_breaker_runner.py: it files one LOOP-BREAKER-1 issue per producer and message variant of
--   v_loop_breaker_signatures, deduped only against OPEN titles, so after the fold closed a title the next hourly run filed it again and issue_refile_reopen (a title closed within 24 h is
--   reopened, the insert dropped) reopened it. FOLD-NO-PINGPONG-1 (PR 7174) then made the fold skip a reopened issue for 24 hours, which hides the cycle for a day and leaves the family open.
--   The runner now counts a signature whose text says the database is overloaded and files nothing while the umbrella is open (PR for D1-OVERLOAD-REFILE-1).
--   The umbrella itself had no probe that can pass: its contract is born into module issue-birth-probe-families with the family probe on fingerprint cf-obs-d1-overload (no such dispatch
--   row exists, the umbrella is not a Cloudflare group, so the probe reads 'missing'), and the bridge's own probe write was undone by contract_probe_templates_family_reassert.
--
-- WHAT THIS FILE DOES
--   1. Gives the open umbrella a measuring probe (scripts/cf_obs_issue_bridge.py umbrella_probe(), the same text, checked by cf_obs_issue_bridge_test.py) and moves its contract out of the family
--      module so the family trigger cannot replace it. The probe passes when no D1-overload observability group was seen for 6 hours (a Cloudflare resolved status does not count as quiet)
--      and no error event with the overload text was written for 6 hours.
--   2. Applies the d1-overload-superseded fold once to every OPEN issue that the rule selects (CF-OBS-ISSUE-1, LOOP-BREAKER-1 or [fleet] title with the overload text), without the 24-hour reopen
--      clause, because the producer that reopened them is fixed in the same change. Each close keeps its before-state in issue_fold_ledger, supersedes the contract, and names the umbrella as
--      successor in issue_triage.close_evidence. Only while the umbrella exists and is open; the umbrella is never closed here.
--   3. Registers the failure mode and its detector fm-d1-overload-refile (expected 0): an open per-group overload issue next to the open umbrella.
--
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'open', close_channel = (SELECT f.agent_close_channel FROM issue_fold_ledger f WHERE f.issue_id = agent_issues.id AND f.rule = 'd1-overload-superseded' AND f.evidence LIKE '%D1-OVERLOAD-REFILE-1%' ORDER BY f.id DESC LIMIT 1) WHERE id IN (SELECT issue_id FROM issue_fold_ledger WHERE rule = 'd1-overload-superseded' AND evidence LIKE '%D1-OVERLOAD-REFILE-1%'); DELETE FROM remediation_contracts WHERE class = 'fm-d1-overload-refile'; DELETE FROM failure_modes WHERE fm_key = 'd1-overload-refile'
-- CAUSE-MAPPED: no metric is registered here; the failure mode has its own detector contract.

-- 1. the umbrella's measuring probe (idempotent: only a row whose probe or module differs is written)
UPDATE remediation_contracts SET verify_probe = 'SELECT ''1'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM fleet_issue_dispatch d WHERE d.category = ''worker-observability'' AND json_valid(d.payload) AND instr(lower(COALESCE(json_extract(d.payload, ''$.title''), '''')), ''d1 db is overloaded'') > 0 AND CAST(json_extract(d.payload, ''$.lastObserved'') AS INTEGER) > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000) AND NOT EXISTS (SELECT 1 FROM cloud_ops_events e WHERE e.status = ''error'' AND e.ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-6 hours'') AND instr(lower(COALESCE(e.text, '''') || '' '' || COALESCE(e.meta, '''')), ''db is overloaded'') > 0) THEN ''1'' ELSE ''0'' END AS observed', verify_transport = 'd1-query', status = 'active', module = 'd1-overload-umbrella', next_due_at = datetime('now'), attempts = 0 WHERE class = 'issue-' || (SELECT MAX(x.id) FROM agent_issues x WHERE x.status = 'open' AND x.title = 'CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]') AND (COALESCE(verify_probe, '') <> 'SELECT ''1'' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM fleet_issue_dispatch d WHERE d.category = ''worker-observability'' AND json_valid(d.payload) AND instr(lower(COALESCE(json_extract(d.payload, ''$.title''), '''')), ''d1 db is overloaded'') > 0 AND CAST(json_extract(d.payload, ''$.lastObserved'') AS INTEGER) > (CAST(strftime(''%s'', ''now'') AS INTEGER) - 21600) * 1000) AND NOT EXISTS (SELECT 1 FROM cloud_ops_events e WHERE e.status = ''error'' AND e.ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-6 hours'') AND instr(lower(COALESCE(e.text, '''') || '' '' || COALESCE(e.meta, '''')), ''db is overloaded'') > 0) THEN ''1'' ELSE ''0'' END AS observed' OR COALESCE(module, '') <> 'd1-overload-umbrella');

-- 2. the fold, once, for the open per-group issues (the statements the hourly workflow runs, with the producer-fixed evidence)
INSERT INTO issue_fold_ledger (issue_id, rule, successor_id, evidence, agent_status, agent_updated_at, agent_close_channel, triage_state, triage_close_evidence, triage_reopened_count, triage_triaged_at, contract_class, contract_status, contract_last_verdict, contract_last_attempt_at) SELECT m.id, 'd1-overload-superseded', u.id, 'superseded by ' || u.id || ': one shared-database condition, tracked once (D1-OVERLOAD-FOLD-1); the producer that refiled it is fixed (D1-OVERLOAD-REFILE-1)', m.status, m.updated_at, m.close_channel, t.triage_state, t.close_evidence, t.reopened_count, t.triaged_at, c.class, c.status, c.last_verdict, c.last_attempt_at FROM agent_issues u JOIN agent_issues m ON m.id <> u.id JOIN issue_triage t ON t.issue_id = m.id LEFT JOIN remediation_contracts c ON c.class = 'issue-' || m.id WHERE u.id = (SELECT MAX(x.id) FROM agent_issues x WHERE x.status = 'open' AND x.title = 'CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]') AND m.status = 'open' AND (m.title LIKE 'CF-OBS-ISSUE-1:%' OR m.title LIKE 'LOOP-BREAKER-1:%' OR m.title LIKE '[fleet]%') AND (instr(lower(m.title), 'd1 db is overloaded') > 0 OR instr(lower(m.title), 'd db is overloaded') > 0) AND NOT EXISTS (SELECT 1 FROM issue_fold_ledger f WHERE f.issue_id = m.id AND f.applied = 0) ORDER BY m.id LIMIT 200;
UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:closure-superseded (ISSUE-HYGIENE-1)', last_attempt_at = datetime('now') WHERE class IN (SELECT f.contract_class FROM issue_fold_ledger f WHERE f.applied = 0 AND f.contract_class IS NOT NULL) AND status IN ('monitoring', 'escalated', 'active', 'holding', 'needs-machine-probe', 'probe-review-refused');
UPDATE agent_issues SET close_channel = 'session:D1-observability' WHERE status = 'open' AND id IN (SELECT issue_id FROM issue_fold_ledger WHERE applied = 0);
UPDATE issue_triage SET triage_state = 'closed', triaged_at = datetime('now'), close_evidence = (SELECT f.evidence FROM issue_fold_ledger f WHERE f.issue_id = issue_triage.issue_id AND f.applied = 0 ORDER BY f.id DESC LIMIT 1) WHERE issue_id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN agent_issues a ON a.id = f.issue_id WHERE f.applied = 0 AND a.status = 'open');
UPDATE agent_issues SET status = 'closed', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE status = 'open' AND id IN (SELECT f.issue_id FROM issue_fold_ledger f JOIN issue_triage t ON t.issue_id = f.issue_id WHERE f.applied = 0 AND t.triage_state = 'closed' AND t.close_evidence = f.evidence);
UPDATE issue_fold_ledger SET applied = 1, applied_at = datetime('now') WHERE applied = 0 AND (SELECT a.status FROM agent_issues a WHERE a.id = issue_fold_ledger.issue_id) <> 'open';

-- 3. the failure mode and its detector: a per-group overload issue that is open while the umbrella is open
INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id)
VALUES ('d1-overload-refile', 'a producer refiles per-group D1-overload issues that the fold closed as superseded by the umbrella, so closer and producer cycle',
  'scripts/loop_breaker_runner.py deduped only against open titles and issue_refile_reopen reopens a title closed within 24 h; the fold had no way to know',
  'D1-OVERLOAD-REFILE-1: the runner counts a D1-overload signature and files nothing while the umbrella is open; the umbrella has a probe that measures the condition',
  'open CF-OBS-ISSUE-1 or LOOP-BREAKER-1 issue with the overload text beside the open umbrella issue',
  'fm-d1-overload-refile', '2026-11-05', (SELECT MAX(x.id) FROM agent_issues x WHERE x.title = 'CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]'));

INSERT OR IGNORE INTO remediation_contracts (class, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module)
VALUES ('fm-d1-overload-refile', 'D1-OVERLOAD-REFILE-1', 'failure-mode detector',
  'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM agent_issues m WHERE m.status = ''open'' AND (m.title LIKE ''CF-OBS-ISSUE-1:%'' OR m.title LIKE ''LOOP-BREAKER-1:%'') AND (instr(lower(m.title), ''d1 db is overloaded'') > 0 OR instr(lower(m.title), ''d db is overloaded'') > 0) AND m.title <> ''CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]'' AND EXISTS (SELECT 1 FROM agent_issues u WHERE u.status = ''open'' AND u.title = ''CF-OBS-ISSUE-1: fleet: D1 DB is overloaded, all workers [cf-obs:d1-overload]'')',
  'd1-query', 3, 'qnfo-fleet-control', 2, 'active', 'failure-mode');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D1-observability',
  'a per-group D1-overload issue is one symptom of the shared-database condition the umbrella issue tracks; its producer, not its closer, has to stop refiling it',
  'D1-OVERLOAD-REFILE-1: loop_breaker_runner counts D1-overload signatures while the umbrella is open; the umbrella gets a measuring probe outside the family module; the open per-group overload issues are superseded once by the umbrella',
  'qnfo-audit 2026-11-04: issue_lifecycle for 1001512 dispositioned 18:56:31Z, reopened 19:53:37Z; issue_triage.reopened_count 1 on ten LOOP-BREAKER-1 rows; remediation_contracts issue-1001715 reads fingerprint cf-obs-d1-overload which has no fleet_issue_dispatch row; offline suites scripts/loop_breaker_runner.py --selftest, scripts/cf_obs_issue_bridge_test.py, migrations/d1-overload-settle.test.mjs',
  'migration merged, runner deployed with the next hourly consumer run',
  'one UPDATE of one contract, one fold of the open overload issues (each before-state in issue_fold_ledger), one failure mode and its detector; no trigger, no cron',
  'Rollback line of migrations/2026-11-05-d1-overload-family-settle.sql',
  'a shared-database condition is one tracked issue with a probe that measures it, and no producer refiles its symptoms',
  'open per-group D1-overload issues beside the umbrella: 12 to 0 and stay 0 while the umbrella is open; the folded issues are not reopened within 24 h; the umbrella probe reads 0 while the condition lasts and 1 after six quiet hours',
  'none',
  'live LIMITed D1 reads, offline sqlite suites'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'D1-OVERLOAD-REFILE-1:%');
