-- RM-CMD-FAILURES-1 (2026-11-05, charter pillar autonomy; program QNFO.OPS; agent_issues 1000804, roadmap_implementation 1805, GitHub 5442 and 5635).
-- WHAT WAS MEASURED (qnfo-audit.cmd_log, 400 rows 2026-10-02..2026-11-04; aggregates only, no prompt or answer text read): 24 failed or fallback rows. 21 are the AI answer leg falling back to
-- stored data (kind ai, status fallback; last 2026-10-25, none since the second transport shipped), 1 is an ops-exec run that did not finish in 30 minutes, and 2 are the owner's only CodeSession
-- stream turns (kind agent-stream), both marked "abandoned: the worker stopped before answering" three minutes after they started although qnfo-agents finished both (cf_agent_session_usage
-- holds their done rows): nothing wrote the answer back. The page and scripts/qcli.mjs also had no branch for kind "stream", so the answer of a CodeSession turn was never drawn.
-- WHAT THIS CHANGES: qnfo-fleet-dashboard 1.92.0 (GET /api/cmd/failures by stage; stream turns rendered, resumed and settled from their session; refused hand-offs logged) and this file.
-- (1) The closing probe of issue 1000804 counted every failed or fallback row ever written ("0 cmd failures" expected, 24 observed), so it could never pass and no fix could be seen by it. It now
--     counts the defects of the command line itself in the last 24 hours: every failed or fallback row except the designed degradation of the AI answer leg (kind ai, status fallback), which is
--     reported next to it. A defect row inside the window keeps the contract failing; an empty window passes. The all-time 21 model fallbacks are history, not a defect of the line.
-- (2) Owner card cmd-mic-zone-header-1: the zone ruleset header rule sets Permissions-Policy microphone=() over the worker's microphone=(self) on every *.qnfo.org response, so the Speak button of
--     /cmd cannot ask for the microphone in any browser (GitHub 5469). Changing a zone security-header rule is a security setting that no session or loop changes: IDENTITY-BOUND card, with the exact
--     change; the live journey fleet / cmd-mic-allowed (scripts/ux-journeys/apps/fleet.journeys.mjs) fails until it is done and files and closes its own UX-JOURNEY-1 issue.
-- (3) roadmap_implementation 1805 is built (planned before); it is set verified, with the live reading, when the probe in (1) passes on the deployed worker.
-- PREDICTION (decision_log): CodeSession stream turns in cmd_log end answered or failed with the session's own error (never "abandoned: the worker stopped") for the next 10 owner stream turns;
-- the defect count of the new probe stays 0 for 24 hours after the deploy. Falsifier: an agent-stream row older than 5 minutes still running while its session is done.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_cmd_failures_1
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT json_extract(state, '$.verify_probe') FROM bak_20261105_cmd_failures_1 WHERE kind = 'issue-contract' AND item_key = 'issue-1000804'), last_verdict = NULL, attempts = 0 WHERE class = 'issue-1000804'; UPDATE human_actions SET status = 'dismissed', resolution = 'rolled back with RM-CMD-FAILURES-1' WHERE slug = 'cmd-mic-zone-header-1' AND status = 'open'; UPDATE roadmap_implementation SET status = 'planned' WHERE id = 1805;
-- Rollback note: decision_log is append-only; the probe returns to the all-time count that cannot pass.

CREATE TABLE IF NOT EXISTS bak_20261105_cmd_failures_1 AS
SELECT 'issue-contract' AS kind, class AS item_key,
  json_object('verify_probe', verify_probe, 'verify_transport', verify_transport, 'status', status, 'last_verdict', last_verdict, 'attempts', attempts) AS state
FROM remediation_contracts WHERE class = 'issue-1000804';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''0 command-line defects in 24h'' AS expected, CASE WHEN COUNT(*) = 0 THEN ''0 command-line defects in 24h'' ELSE COUNT(*) || '' command-line defects in 24h: '' || group_concat(DISTINCT kind || ''/'' || status) END AS observed FROM cmd_log WHERE status IN (''failed'', ''fallback'') AND NOT (kind = ''ai'' AND status = ''fallback'') AND ts >= datetime(''now'', ''-24 hours'')',
    verify_transport = 'd1-query', status = 'active', last_verdict = NULL, attempts = 0, next_due_at = datetime('now')
WHERE class = 'issue-1000804' AND issue_id = 1000804;

INSERT OR IGNORE INTO human_actions (slug, title, why, default_in_effect, action, sev, status, source)
VALUES ('cmd-mic-zone-header-1',
  'Let fleet.qnfo.org/cmd ask for the microphone: change the qnfo.org zone header rule',
  'IDENTITY-BOUND: a zone-level response-header rule is a security setting of the owner''s Cloudflare account, and no session or loop changes those. Evidence (read-only, 2026-11-05): the zone ruleset http_response_headers_transform (id b2d28290482f4570994d1fb038f0f49a, zone 84e9dc1d7fb72629ccdbe3174ed24420) has the rule "Security headers for all QNFO Pages sites" (id 5ea65a79ade84503a3164ad71ca38307, expression http.host wildcard "*.qnfo.org") that SETS Permissions-Policy to camera=(), microphone=(), geolocation=() on every response. The worker qnfo-fleet-dashboard has sent microphone=(self) since 1.77.1 and https://qnfo-fleet-dashboard.q08.workers.dev/cmd shows it, but https://fleet.qnfo.org/cmd answers microphone=(), so no browser can show a microphone prompt on /cmd: getUserMedia fails at once with NotAllowedError and the permission state reads denied, which is what GitHub 5469 saw in the Kimi in-app browser (not a defect of that app).',
  'The Speak button on /cmd keeps failing, and the page now says that the site policy refuses the microphone and to type the command instead. Everything else on the command line is unchanged.',
  'In the Cloudflare dashboard open the qnfo.org zone, Rules, Transform Rules, Modify Response Header, the rule "Security headers for all QNFO Pages sites". Change its expression to (http.host wildcard "*.qnfo.org" and http.host ne "fleet.qnfo.org"), then add a second rule named "Security headers for fleet.qnfo.org" with expression (http.host eq "fleet.qnfo.org") that sets the same five headers, with Permissions-Policy set to camera=(), microphone=(self), geolocation=(). Nothing else changes. Done when curl -sI https://fleet.qnfo.org/cmd shows microphone=(self); the live phone journey fleet / cmd-mic-allowed then passes and closes its own issue.',
  'normal', 'open', 'session:C-ops-tools-F2');

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'qnfo-fleet-dashboard 1.92.0 (PR 7356): GET /api/cmd/failures by stage, CodeSession stream turns rendered and settled, hand-off failures logged; inventory in docs/CODE-AGENT-CONSOLE.md; closes on the probe of issue-1000804 (command-line defects in 24h = 0)'
WHERE id = 1805 AND status = 'planned';

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:C-ops-tools-F2',
  'the owner''s natural-language /cmd turns now run as CodeSession streams, and the log of those turns is the only server-side record of whether the command line works',
  'RM-CMD-FAILURES-1: name the failing stage of every failed cmd_log row, settle CodeSession stream rows from their session, draw the stream on /cmd and in qcli, log refused hand-offs; replace the all-time-count probe of issue 1000804 with a 24-hour defect count',
  'cmd_log 400 rows: 21 model fallbacks (none since 2026-10-25), 1 ops-exec timeout, 2 of 2 stream turns marked abandoned while cf_agent_session_usage holds their done rows; fleet.qnfo.org/cmd header microphone=() against the worker''s microphone=(self); live reads 2026-11-05',
  'branch change; verify after CI migration and canonical deployment',
  'the /cmd page and /api/cmd routes of qnfo-fleet-dashboard, cmd_log rows of kind agent-stream and handoff, the contract of issue 1000804',
  'qnfo-fleet-dashboard rollback (previous version) restores the sweep that marks stream rows abandoned; this file''s Rollback line restores the probe, dismisses the card and resets roadmap item 1805',
  'a per-stage reading of command-line failures that does not depend on a replay by the owner',
  'the next 10 owner stream turns in cmd_log end answered or failed with the session''s own error, none abandoned; command-line defects in 24h stay 0',
  'none; this repairs the command line the owner uses, it does not add readers',
  'offline suites qnfo-fleet-dashboard/cmd-stream.test.mjs, cmd-agent, cmd-cli-poll; phone journey fleet / cmd-ask-streams (local harness); live journey fleet / cmd-mic-allowed; live D1 and zone ruleset reads'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'RM-CMD-FAILURES-1: name the failing%');
