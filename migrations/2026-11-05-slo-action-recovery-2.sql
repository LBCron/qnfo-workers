-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_slo_action_contracts
-- Rollback: UPDATE remediation_contracts SET (verify_probe, verify_transport, precondition, action, status, module, attempts, last_verdict, next_due_at, expected_cadence_h, max_attempts) = (SELECT b.verify_probe, b.verify_transport, b.precondition, b.action, b.status, b.module, b.attempts, b.last_verdict, b.next_due_at, b.expected_cadence_h, b.max_attempts FROM bak_20261105_slo_action_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_slo_action_contracts); UPDATE postmortems SET (state, completed_at, root_cause, actions) = (SELECT b.state, b.completed_at, b.root_cause, b.actions FROM bak_20261105_slo_postmortems b WHERE b.incident_key = postmortems.incident_key) WHERE incident_key IN (SELECT incident_key FROM bak_20261105_slo_postmortems); UPDATE incidents SET summary = (SELECT b.summary FROM bak_20261105_slo_incidents b WHERE b.incident_key = incidents.incident_key) WHERE incident_key IN (SELECT incident_key FROM bak_20261105_slo_incidents)
-- SLO-ACTION-RECOVERY-2 (2026-11-05, charter pillar autonomy; ROOT-CAUSE-1 agent_issues 1000892 / GitHub 5404; actions 1000808 fleet.qnfo.org (5768), 1000676 qnfo.org (7119), 1000675 papers.qnfo.org (7132), 1000678 travel.q08.org (7153), 1000677 qwav.org (7170)).
--
-- WHAT THE LIVE READS SHOWED (qnfo-audit, 2026-11-05T01:50Z)
--   1. The closing probe of every SLO-POSTMORTEM-ACTION-1 issue could not pass. Migration 2026-11-03-slo-postmortem-action-recovery.sql (PR 6505) made it require slo_budget_state = 'ok'.
--      That row is a 28-day figure: 'immature' while a surface holds fewer than 200 samples (all 13 held 167 on 2026-11-04) and 'spent' for 28 days after a single failed sample once it
--      holds 200. The probe read 'budget state is not ok' on 1000675, 1000676, 1000677, 1000678 and 1000808 at every verification (attempts 5 to 44, last_verdict fail) although
--      qnfo.org, papers.qnfo.org and qwav.org had 139 observed samples and no failed one since 2026-10-28T09:32:26Z; REMEDIATION-REOPEN-2 reopened each issue that the earlier HTTP-200 probe
--      had closed, and the reopens fed the ROOT-CAUSE-1 ticket 1000892 (20 reopens in 7 days), which stays open while the family recurs.
--   2. The only real, user-visible unavailability was fleet.qnfo.org: 87 of 167 samples failed, 84 of them 'status 200' slower than the 5 s limit (daily mean 5.1 to 8.7 s, up to 18 s)
--      from 2026-10-29 to 2026-11-04T14:09Z; worker_logs shows GET / on qnfo-fleet-dashboard at 12 to 29 s a day on average with 25 to 158 ms of CPU: it waited. V3-DASH-1 (PR 6923, dashboard
--      1.82.0, merged 2026-11-04T14:36Z) made / a static shell; every observed sample since 2026-11-04T15:09:32Z answered in 163 to 594 ms and the last slow or cancelled GET / was 14:33Z.
--   3. The failures on the other four surfaces were single samples (qnfo.org three, papers.qnfo.org one, qwav.org one) or a known cause (travel.q08.org: nine 'status 401' answers of 5.3 to 6.0 s
--      from personal-companion ensureTravel, fixed by PR 5165 and 5175 on 2026-10-28), plus 27 not-sampled rows that SLO-PROBE-BUDGET-1 (PR 7179) already relabelled.
--
-- WHAT THIS FILE DOES (scripts/bp26_slo.py, same PR, re-arms the same probe every hour from now on, so this is the same definition, not a second one)
--   a. gives the five open action issues the probe of scripts/bp26_slo.py action_recovery_probe: at least 12 observed samples in 24 h, none failed, no availability incident of the surface open.
--      The budget state stays what it is for (burn figure, ops_config slo_budget_spent). On 2026-11-05T01:50Z the probe reads ok for qnfo.org, papers.qnfo.org, qwav.org and travel.q08.org and
--      'a sample failed in the last 24 h' for fleet.qnfo.org (last failure 2026-11-04T14:09:10Z), so fleet.qnfo.org's issue closes by itself after 2026-11-05T14:09Z if it stays fast.
--   b. names the cause in the postmortem rows of those surfaces (the definition of done of the issues: "the cause is named in the postmortem row"): the text is appended to root_cause.
--   c. withdraws the completed postmortems of incidents whose first sample is a not-sampled row (13 of 2026-10-31T00:54:09Z and ask.qwav.tech 2026-11-01T19:19:56Z): they name an 'unreachable'
--      failure that never happened. PHANTOM-INCIDENT-1 in scripts/bp26_slo.py already withdrew the open ones of 2026-11-04T18:11:33Z; this does the same for the closed ones.
-- Nothing is deleted; the before-state of every row changed is in the three bak_20261105_* tables.

CREATE TABLE IF NOT EXISTS bak_20261105_slo_action_contracts AS
SELECT class, issue_id, verify_probe, verify_transport, precondition, action, status, module, attempts, last_verdict, next_due_at, expected_cadence_h, max_attempts
FROM remediation_contracts WHERE class IN ('issue-1000675', 'issue-1000676', 'issue-1000677', 'issue-1000678', 'issue-1000808');

CREATE TABLE IF NOT EXISTS bak_20261105_slo_postmortems AS
SELECT incident_key, state, completed_at, root_cause, actions FROM postmortems
WHERE incident_key LIKE 'avail:fleet.qnfo.org:%' OR incident_key LIKE 'avail:travel.q08.org:%' OR incident_key LIKE 'avail:qnfo.org:%' OR incident_key LIKE 'avail:papers.qnfo.org:%'
   OR incident_key LIKE 'avail:qwav.org:%' OR incident_key LIKE 'avail:%:2026-10-31T00:54:09Z' OR incident_key = 'avail:ask.qwav.tech:2026-11-01T19:19:56Z';

CREATE TABLE IF NOT EXISTS bak_20261105_slo_incidents AS
SELECT incident_key, summary FROM incidents
WHERE incident_key LIKE 'avail:%:2026-10-31T00:54:09Z' OR incident_key = 'avail:ask.qwav.tech:2026-11-01T19:19:56Z';

-- (a) the closing probe, byte for byte what scripts/bp26_slo.py action_recovery_probe(surface) returns (migrations/slo-action-recovery-2.test.mjs compares them)
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = ''papers.qnfo.org''), ''no-data'') = ''no-data'' THEN ''no budget state for the surface'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:papers.qnfo.org'' AND ok IS NOT NULL AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) < 12 THEN ''fewer than 12 observed samples in 24 h'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:papers.qnfo.org'' AND ok = 0 AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''a sample failed in the last 24 h'' WHEN EXISTS (SELECT 1 FROM incidents WHERE surface = ''papers.qnfo.org'' AND kind = ''availability'' AND closed_at IS NULL) THEN ''an availability incident of the surface is still open'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'slo-action-recovery-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
    expected_cadence_h = 1, max_attempts = 3, precondition = 'SLO recovery for 24 hours',
    action = 'the action issue closes only after the surface answered for 24 hours: at least 12 observed samples, none failed, no availability incident open'
WHERE class = 'issue-1000675' AND issue_id = 1000675;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = ''qnfo.org''), ''no-data'') = ''no-data'' THEN ''no budget state for the surface'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:qnfo.org'' AND ok IS NOT NULL AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) < 12 THEN ''fewer than 12 observed samples in 24 h'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:qnfo.org'' AND ok = 0 AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''a sample failed in the last 24 h'' WHEN EXISTS (SELECT 1 FROM incidents WHERE surface = ''qnfo.org'' AND kind = ''availability'' AND closed_at IS NULL) THEN ''an availability incident of the surface is still open'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'slo-action-recovery-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
    expected_cadence_h = 1, max_attempts = 3, precondition = 'SLO recovery for 24 hours',
    action = 'the action issue closes only after the surface answered for 24 hours: at least 12 observed samples, none failed, no availability incident open'
WHERE class = 'issue-1000676' AND issue_id = 1000676;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = ''qwav.org''), ''no-data'') = ''no-data'' THEN ''no budget state for the surface'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:qwav.org'' AND ok IS NOT NULL AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) < 12 THEN ''fewer than 12 observed samples in 24 h'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:qwav.org'' AND ok = 0 AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''a sample failed in the last 24 h'' WHEN EXISTS (SELECT 1 FROM incidents WHERE surface = ''qwav.org'' AND kind = ''availability'' AND closed_at IS NULL) THEN ''an availability incident of the surface is still open'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'slo-action-recovery-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
    expected_cadence_h = 1, max_attempts = 3, precondition = 'SLO recovery for 24 hours',
    action = 'the action issue closes only after the surface answered for 24 hours: at least 12 observed samples, none failed, no availability incident open'
WHERE class = 'issue-1000677' AND issue_id = 1000677;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = ''travel.q08.org''), ''no-data'') = ''no-data'' THEN ''no budget state for the surface'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:travel.q08.org'' AND ok IS NOT NULL AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) < 12 THEN ''fewer than 12 observed samples in 24 h'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:travel.q08.org'' AND ok = 0 AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''a sample failed in the last 24 h'' WHEN EXISTS (SELECT 1 FROM incidents WHERE surface = ''travel.q08.org'' AND kind = ''availability'' AND closed_at IS NULL) THEN ''an availability incident of the surface is still open'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'slo-action-recovery-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
    expected_cadence_h = 1, max_attempts = 3, precondition = 'SLO recovery for 24 hours',
    action = 'the action issue closes only after the surface answered for 24 hours: at least 12 observed samples, none failed, no availability incident open'
WHERE class = 'issue-1000678' AND issue_id = 1000678;

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = ''fleet.qnfo.org''), ''no-data'') = ''no-data'' THEN ''no budget state for the surface'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:fleet.qnfo.org'' AND ok IS NOT NULL AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) < 12 THEN ''fewer than 12 observed samples in 24 h'' WHEN (SELECT COUNT(*) FROM bp26_probe_results WHERE metric = ''slo_attainment_28d_min'' AND subject = ''avail:fleet.qnfo.org'' AND ok = 0 AND run_at > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-24 hours'')) > 0 THEN ''a sample failed in the last 24 h'' WHEN EXISTS (SELECT 1 FROM incidents WHERE surface = ''fleet.qnfo.org'' AND kind = ''availability'' AND closed_at IS NULL) THEN ''an availability incident of the surface is still open'' ELSE ''ok'' END AS observed',
    verify_transport = 'd1-query', status = 'active', module = 'slo-action-recovery-1', attempts = 0, last_verdict = NULL, next_due_at = datetime('now'),
    expected_cadence_h = 1, max_attempts = 3, precondition = 'SLO recovery for 24 hours',
    action = 'the action issue closes only after the surface answered for 24 hours: at least 12 observed samples, none failed, no availability incident open'
WHERE class = 'issue-1000808' AND issue_id = 1000808;


-- (b) the cause, named in the postmortem rows (appended; the class the generator wrote stays in front)
UPDATE postmortems SET root_cause = root_cause || ' | ' || 'NAMED CAUSE (SLO-ACTION-RECOVERY-2, measured 2026-11-05): the page itself was slow, not the probe or the network. Until qnfo-fleet-dashboard 1.82.0 (V3-DASH-1, PR 6923, merged 2026-11-04T14:36Z) GET / answered 200 only after the server finished its work: 84 of the 87 failed samples are ''status 200'' over the 5 s limit (daily mean 5.1 to 8.7 s from 2026-10-30 to 2026-11-04, up to 18 s) and the dashboard''s worker_logs rows for GET / show wall time of 12 to 29 s on a daily mean at 25 to 158 ms of CPU, so the request waited (on qnfo-audit D1 reads while that database was overloaded, D1-OVERLOAD-1; which reads dominated was not traced). Fix: V3-DASH-1 serves a static shell and moves the data to /api/v3/now and /api/v3/readers (7 s section timeouts, 45 s cache), with D1-OVERLOAD-1b/1d/1f (PR 6935) and D1-REPLICA-READS-1 (PR 7122); every observed sample since 2026-11-04T15:09:32Z answered in 163 to 594 ms, the last slow or cancelled GET / was 2026-11-04T14:33Z. Side effect: / is now a shell, so this availability SLI no longer sees a slow data path (SLO-DATAPATH-1).'
WHERE state = 'complete' AND incident_key LIKE 'avail:fleet.qnfo.org:%' AND root_cause LIKE 'slow:%' AND root_cause NOT LIKE '%NAMED CAUSE%';

UPDATE postmortems SET root_cause = root_cause || ' | ' || 'NAMED CAUSE (SLO-ACTION-RECOVERY-2, inferred 2026-11-05): a one-off transport failure or slow answer of qnfo-gateway on 2026-10-27/28 (one ''error:RemoteDisconnected'', then ''status 200'' in 9.1 s and 6.3 s). The evidence cannot say more. It did not recur: 139 observed samples and 0 failed since 2026-10-28T09:32:26Z (mean 286 ms). No code change is specific to this surface; the issue closes on the 24 h clean window (SLO-ACTION-RECOVERY-2).'
WHERE state = 'complete' AND incident_key IN ('avail:qnfo.org:2026-10-27T14:32:44Z', 'avail:qnfo.org:2026-10-28T06:41:07Z') AND root_cause NOT LIKE '%NAMED CAUSE%';

UPDATE postmortems SET root_cause = root_cause || ' | ' || 'NAMED CAUSE (SLO-ACTION-RECOVERY-2, inferred 2026-11-05): one slow answer (''status 200'' in 8.8 s) at 2026-10-28T09:32:25Z, in the same run in which qwav.org timed out and the hour after qnfo.org''s two slow answers (qnfo-gateway serves both qnfo.org and papers.qnfo.org). One sample, no recurrence: 139 observed samples and 0 failed since (mean 506 ms). The papers-path journey failures on single slugs are a different cause (GitHub 6455, 6623).'
WHERE state = 'complete' AND incident_key = 'avail:papers.qnfo.org:2026-10-28T09:32:25Z' AND root_cause NOT LIKE '%NAMED CAUSE%';

UPDATE postmortems SET root_cause = root_cause || ' | ' || 'NAMED CAUSE (SLO-ACTION-RECOVERY-2, inferred 2026-11-05): one timeout at 2026-10-28T09:32:25Z in the same run as papers.qnfo.org''s slow answer; the evidence cannot name the layer. One sample, no recurrence: 139 observed samples and 0 failed since (mean 329 ms).'
WHERE state = 'complete' AND incident_key = 'avail:qwav.org:2026-10-28T09:32:25Z' AND root_cause NOT LIKE '%NAMED CAUSE%';

UPDATE postmortems SET root_cause = root_cause || ' | ' || 'NAMED CAUSE (SLO-ACTION-RECOVERY-2, from agent_issues 1000678 CLUSTER-F-A and the samples): personal-companion ensureTravel wrote about 30 schema statements one by one to the D1 primary on every cold isolate, so the sign-in page answered 401 in 5.3 to 6.0 s (nine samples, 2026-10-26T23:01Z to 2026-10-28T19:19Z). Fixed by personal-companion 1.44.2 (memo, PR 5165) and 1.44.3 (one batch, a one-read request path, PR 5175, deployed about 2026-10-28T20:40Z): 0 slow samples since, 131 samples, mean 640 ms.'
WHERE state = 'complete' AND incident_key LIKE 'avail:travel.q08.org:%' AND root_cause LIKE 'slow:%' AND root_cause NOT LIKE '%NAMED CAUSE%';

UPDATE postmortems SET root_cause = root_cause || ' | ' || 'NAMED CAUSE (SLO-ACTION-RECOVERY-2, inferred 2026-11-05): a timeout shared with q08.org, me.q08.org and reading.q08.org in the same run (2026-11-03T20:36:52Z, recovered 23:02:20Z): an event of the q08.org family, not of travel''s code; the evidence cannot name the layer. One episode, no recurrence in the samples since.'
WHERE state = 'complete' AND incident_key = 'avail:travel.q08.org:2026-11-03T20:36:52Z' AND root_cause NOT LIKE '%NAMED CAUSE%';


-- (c) withdraw the completed postmortems of incidents whose first sample is a not-sampled row (evidence-gated: the sample at the incident's opening is ok NULL)
UPDATE postmortems
SET state = 'withdrawn', completed_at = NULL,
    root_cause = 'withdrawn: no failed availability sample remains for this incident (its first sample was relabelled not-sampled: the probe ran out of its own time budget, SLO-PROBE-BUDGET-1, PR 7179)',
    actions = 'none: not an outage (the host was never fetched in that run)'
WHERE state = 'complete'
  AND incident_key IN (SELECT i.incident_key FROM incidents i
                        WHERE i.kind = 'availability'
                          AND EXISTS (SELECT 1 FROM bp26_probe_results r WHERE r.metric = 'slo_attainment_28d_min' AND r.subject = 'avail:' || i.surface AND r.run_at = i.opened_at AND r.ok IS NULL));

UPDATE incidents
SET summary = summary || ' [withdrawn: the first sample was relabelled not-sampled, SLO-PROBE-BUDGET-1; no outage]'
WHERE kind = 'availability' AND summary NOT LIKE '%[withdrawn:%'
  AND EXISTS (SELECT 1 FROM bp26_probe_results r WHERE r.metric = 'slo_attainment_28d_min' AND r.subject = 'avail:' || incidents.surface AND r.run_at = incidents.opened_at AND r.ok IS NULL);
