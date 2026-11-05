-- GOV-TAIL-3 (2026-11-05, charter pillar autonomy; slice B-governance-tail of the issue-backlog cluster). Follows GOV-TAIL-1 (#7331) and GOV-TAIL-2 (#7384).
-- 1. session_dependent_issues_open counts every open issue whose text holds `session-task:` anywhere. Five of them name a change that is already on main, so the line
--    asks a session for work that was done; it is rewritten as a record of what shipped (the rest of each description, its probe and its metric stay):
--      100317   TP-1.7 evModelJson re-ask: EV_REASKED in qnfo-fleet-control/worker.js since 2026-11-01 (PR 5671); evolve_parse_pass_pct_7d reads 100.0.
--      1000334  BP26-CORRECTIONS-FEED-1: slice 1 (type, original_url, /corrections alias) shipped in PR 5126 (q08-signal-engine 0.39.0); the metric lever is the errata respond loop (issue 100456).
--      1000341  BP26-AI-ACT-ART50-1: the companion disclosure is on the first screen and the guide (personal-api 4.26.0, personal-api/ai-disclosure.test.mjs), ipatent carries it live,
--               qnfo-social 0.20.0 labels posts; the open part is the e-mail agent signature, an IDENTITY-BOUND card (bp26-email-agent-ai-disclosure).
--      1000347  BP26-EMAIL-AUTH-1: the RFC 8058 headers shipped as the child "BP26-EMAIL-AUTH-1 (implement)" (issue 1000738, closed); rfc8058_headers_present reads 1 and
--               dmarc_aligned_pass_rate reads 1 (metric_registry 2026-11-04T23:56Z).
--      1000351  BP26-AI-GATEWAY-BUDGETS-1: the q08-signal-engine call sites shipped as the child 1000614 (PR 5148, q08-signal-engine 0.39.2); the remaining sites have their own
--               issues (1001881 calibration, 1001882 research-exec, 1001883 code-orchestrator, 1001884 model-eval, 1001872 research-exec coverage).
--    Two parents keep their line because their change is not on main and its path is claimed by another doer today: 1000344 (personal-api/worker.js, code task ct_im1001641 holds
--    the claim) and 1000350 (qnfo-ops/worker.js, held by another session).
-- 2. Issue 1000866 (OWNER-TASK: diagnose the qnfo-observability scriptThrewException of 2026-10-29): diagnosed from worker_logs. The /health route read D1 and threw when D1 was saturated
--    (exceptions on /health at 2026-11-02 21:40Z and 2026-11-03 03:01Z); PR 6511 decoupled /health from D1 and was deployed 2026-11-03T08:02Z (deployment_history), and worker_logs holds 0
--    /health exceptions since. The exceptions left are cron-path D1 saturation (scheduled() at 2026-11-04 09:15Z, "D1 DB is overloaded"), the fleet-wide umbrella 1001715, not a defect of this
--    worker. The probe (zero exceptions of any kind since 2026-10-29, which D1 saturation kept at 13) now counts the exceptions that are not D1 saturation since the fix deployed.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET description=(SELECT b.description FROM bak_20261105_gov_tail3_issues b WHERE b.id=agent_issues.id) WHERE id IN (SELECT id FROM bak_20261105_gov_tail3_issues); UPDATE remediation_contracts SET verify_probe=(SELECT b.verify_probe FROM bak_20261105_gov_tail3_contracts b WHERE b.class=remediation_contracts.class), last_verdict=(SELECT b.last_verdict FROM bak_20261105_gov_tail3_contracts b WHERE b.class=remediation_contracts.class), attempts=(SELECT b.attempts FROM bak_20261105_gov_tail3_contracts b WHERE b.class=remediation_contracts.class), next_due_at=(SELECT b.next_due_at FROM bak_20261105_gov_tail3_contracts b WHERE b.class=remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_gov_tail3_contracts);
-- The Rollback leaves the decision_log row: decision_log is append-only.

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail3_issues AS
SELECT id, description FROM agent_issues WHERE id IN (100317, 1000334, 1000341, 1000347, 1000351);

CREATE TABLE IF NOT EXISTS bak_20261105_gov_tail3_contracts AS
SELECT class, verify_probe, last_verdict, attempts, next_due_at FROM remediation_contracts WHERE class = 'issue-1000866';

UPDATE agent_issues
SET description = replace(description, 'session-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js', 'landed: repo=qnfo-workers path=qnfo-fleet-control/worker.js (the evModelJson re-ask is on main since 2026-11-01, PR 5671, EV_REASKED; evolve_parse_pass_pct_7d reads 100.0; GOV-TAIL-3 2026-11-05)'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 100317 AND status = 'open' AND instr(description, 'session-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js') > 0;

UPDATE agent_issues
SET description = replace(description, 'session-task: repo=qnfo-workers path=q08-signal-engine/worker.js', 'slice-shipped: repo=qnfo-workers path=q08-signal-engine/worker.js (slice 1 is live: PR 5126, q08-signal-engine 0.39.0, type and original_url on /api/retractions and the /corrections alias; the metric lever is the errata respond loop, issue 100456; GOV-TAIL-3 2026-11-05)'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000334 AND status = 'open' AND instr(description, 'session-task: repo=qnfo-workers path=q08-signal-engine/worker.js') > 0;

UPDATE agent_issues
SET description = replace(description, 'session-task: repo=qnfo-workers path=personal-api/worker.js', 'slice-shipped: repo=qnfo-workers path=personal-api/worker.js (the companion first screen and guide carry the Art. 50 disclosure since personal-api 4.26.0, pinned by personal-api/ai-disclosure.test.mjs; ipatent carries it live; qnfo-social 0.20.0 labels posts; what is open is the e-mail agent signature, an IDENTITY-BOUND card, and the 14-day post window; GOV-TAIL-3 2026-11-05)'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000341 AND status = 'open' AND instr(description, 'session-task: repo=qnfo-workers path=personal-api/worker.js') > 0;

UPDATE agent_issues
SET description = replace(description, 'session-task: repo=qnfo-workers path=personal-companion/worker.js', 'slice-shipped: repo=qnfo-workers path=personal-companion/worker.js (the RFC 8058 headers shipped as the child BP26-EMAIL-AUTH-1 (implement), issue 1000738, closed; rfc8058_headers_present reads 1 and dmarc_aligned_pass_rate reads 1 at 2026-11-04T23:56Z; GOV-TAIL-3 2026-11-05)'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000347 AND status = 'open' AND instr(description, 'session-task: repo=qnfo-workers path=personal-companion/worker.js') > 0;

UPDATE agent_issues
SET description = replace(description, 'session-task: repo=qnfo-workers path=q08-signal-engine/worker.js', 'slice-shipped: repo=qnfo-workers path=q08-signal-engine/worker.js (the compose, title repair, forecast repair, fact-check and judge calls go through aiGatewayRun since PR 5148, q08-signal-engine 0.39.2, child issue 1000614; the remaining call sites have their own issues: 1001881 calibration, 1001882 research-exec, 1001883 code-orchestrator, 1001884 model-eval, 1001872 research-exec coverage; GOV-TAIL-3 2026-11-05)'),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 1000351 AND status = 'open' AND instr(description, 'session-task: repo=qnfo-workers path=q08-signal-engine/worker.js') > 0;

-- 2. the diagnosis is the finding; the probe measures the fix, not the fleet-wide D1 saturation
UPDATE remediation_contracts
SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-observability'' AND outcome = ''exception'' '
  || 'AND ts_ms > CAST(strftime(''%s'', ''2026-11-03 08:02:05'') AS INTEGER) * 1000 '
  || 'AND instr(COALESCE(exceptions_json, ''''), ''D1 DB is overloaded'') = 0 AND instr(COALESCE(exceptions_json, ''''), ''Requests queued for too long'') = 0) = 0 THEN ''ok'' '
  || 'ELSE (SELECT COUNT(*) FROM worker_logs WHERE script_name = ''qnfo-observability'' AND outcome = ''exception'' AND ts_ms > CAST(strftime(''%s'', ''2026-11-03 08:02:05'') AS INTEGER) * 1000 '
  || 'AND instr(COALESCE(exceptions_json, ''''), ''D1 DB is overloaded'') = 0 AND instr(COALESCE(exceptions_json, ''''), ''Requests queued for too long'') = 0) || '' qnfo-observability exceptions that are not D1 saturation since the health route was decoupled from D1'' END AS observed',
    last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000866' AND issue_id = 1000866 AND instr(verify_probe, '2026-10-29 21:00:00') > 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:breach-issues-B-governance-tail',
  'a session-task line that names a change already on main asks for work that was done, and a probe that counts fleet-wide D1 saturation as a defect of one worker can never close the diagnosis it was filed for',
  'GOV-TAIL-3: five session-task lines rewritten as records of what shipped (100317, 1000334, 1000341, 1000347, 1000351); the closing probe of 1000866 counts exceptions that are not D1 saturation since the fix deployed',
  'live reads 2026-11-04/05: EV_REASKED in qnfo-fleet-control/worker.js; PR 5126, personal-api 4.26.0 test, rfc8058_headers_present 1, dmarc_aligned_pass_rate 1, PR 5148 child 1000614; worker_logs qnfo-observability: 0 /health exceptions since the 2026-11-03T08:02Z deploy, the 2026-11-04 09:15Z exceptions are D1 overloaded',
  'migration merged through the canonical path; no worker bundle changed',
  'five agent_issues descriptions and one remediation_contracts row',
  'the Rollback header restores the five descriptions and the probe from the bak_20261105_gov_tail3_* tables; the decision row stays (append-only)',
  'session_dependent_issues_open stops asking a session for shipped work; the observability diagnosis closes on a probe that measures its fix',
  'session_dependent_issues_open falls by 5 within the hour; issue 1000866 closes after two passes (it was reopened once)',
  'none',
  'offline suite migrations/gov-tail-3.test.mjs (the migration on SQLite fixtures, the new probe against exception rows of both kinds, replay no-op, Rollback restores); live read of worker_logs for qnfo-observability'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'GOV-TAIL-3:%');
