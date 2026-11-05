-- JOURNEY-RECORD-DURABLE-1 (2026-11-05, charter pillar autonomy; GitHub 6623 / agent_issues 1001363 ask-path, 6420 / 1001171 loop-heartbeats, 5743 / 1000750 binding-census; qnfo-fleet-control change in the same PR).
-- Evidence (qnfo-audit journey_runs, runner cf, read 2026-11-04 23:00Z): the fleet-control tick writes one row per journey, eight on a normal tick, nine when the ask journey is due. Ticks with fewer than
-- eight: 1 of 72 on 2026-11-02, 0 of 70 on 2026-11-03, 11 of 62 on 2026-11-04 (rows missing from the front, the back or the middle: 18:00Z held papers-path only), and 10 ticks recorded nothing. The ask-path run
-- of 18:00Z (every 6 h) never landed, so its contract read an age of 670 minutes and could not pass. Cause in code: jrnRecord inserted the rows one at a time, each in its own try/catch that logs and drops the row,
-- each followed by that journey's issue handling (D1 reads and writes, and for a failing journey a source fetch from GitHub), inside a ctx.waitUntil that the runtime ends 30 s after the handler returns.
-- Change: the rows are written first, in one batch retried on a transient failure and then one by one; the cron handler awaits the journeys; a GET hop that answered 5xx or failed before an answer is tried once
-- more; the loop-heartbeats error-level check leaves the worker-errors category to traffic-health; a portfolio or charter write refused by a repository rule is no longer retried and its note carries GitHub's sentence.
-- This file adds the failure mode and its detector (fm-journey-ticks-cut: reads ok when no tick of the last 6 h is partial and at least 15 of the 18 ticks are there, and the ask journey ran in 3 of the last 4
-- slots), and files the doer for the part this PR does not do: the portfolio and charter loops cannot publish since the require-build ruleset (2026-11-04T15:47Z, admin-only bypass) refuses their direct
-- writes (portfolio_sync_runs 773 to 776: every PUT answers HTTP 409 on main and on master since 16:05Z), which keeps the gha runner's loop-heartbeats red through LOOP-WATCH and portfolio_last.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM remediation_contracts WHERE class = 'fm-journey-ticks-cut'; DELETE FROM failure_modes WHERE fm_key = 'journey-ticks-cut';
-- The Rollback leaves the decision row (decision_log is append-only) and the filed ROADMAP-1 #portfolio-pr-publish issue: a filed issue is closed with close_evidence on its issue_triage row, never deleted.
-- BACKUP: failure_modes
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT OR IGNORE INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, probe_class, first_seen, issue_id, trigger_condition, symptom, blast_radius) VALUES
  ('journey-ticks-cut',
   'a fleet-control journey tick is recorded in part or not at all, so a journey run that happened leaves no row',
   'jrnRecord wrote the rows one at a time, each followed by that journey''s issue handling, in a waitUntil task that ends 30 s after the cron handler returns; a failed insert was logged and dropped',
   'JOURNEY-RECORD-DURABLE-1: one batch of all rows first (retried, then row by row), the handler awaits the journeys; fm-journey-ticks-cut counts partial and missing ticks',
   'd1-query over journey_runs runner cf: ticks of the last 6 h with fewer rows than the fullest tick of the same 6 h, ticks present of 18, ask-path runs in the last 24 h',
   'fm-journey-ticks-cut', '2026-11-05', 1001363,
   'D1 overloaded or the isolate cut while a tick records, which happens on days with many deploys of qnfo-fleet-control',
   'FLEET-JOURNEY-FAILED-1 contracts read pending or stale (ask-path age 670 min after the 18:00Z tick), journeys that ran are invisible',
   'every journey contract and the journey metric fleet_journeys_failing');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, max_attempts, expected_cadence_h, status, precondition, action, escalate_to) VALUES
  ('fm-journey-ticks-cut', NULL,
   'WITH t AS (SELECT ts, COUNT(*) AS n FROM journey_runs WHERE runner = ''cf'' AND journey <> ''ask-path'' AND ts >= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-24 hours'') GROUP BY ts), w AS (SELECT * FROM t WHERE ts >= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-6 hours'')), m AS (SELECT COALESCE(MAX(n), 0) AS mx FROM w), a AS (SELECT COUNT(DISTINCT ts) AS runs FROM journey_runs WHERE runner = ''cf'' AND journey = ''ask-path'' AND ts >= strftime(''%Y-%m-%dT%H:%M:%fZ'', ''now'', ''-24 hours'')) SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM w WHERE n < (SELECT mx FROM m)) > 0 THEN (SELECT COUNT(*) FROM w WHERE n < (SELECT mx FROM m)) || '' of the last 6 h ticks hold fewer rows than the fullest tick'' WHEN (SELECT COUNT(*) FROM w) < 15 THEN ''only '' || (SELECT COUNT(*) FROM w) || '' of 18 ticks in the last 6 h'' WHEN (SELECT runs FROM a) < 3 THEN ''ask-path ran in '' || (SELECT runs FROM a) || '' of the last 4 slots'' ELSE ''ok'' END AS observed',
   'd1-query', 3, 1, 'active', 'JOURNEY-RECORD-DURABLE-1', 'failure-mode detector', 'qnfo-fleet-control');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.OPS #portfolio-pr-publish: the portfolio and charter loops publish through a pull request now that the require-build ruleset refuses their direct writes',
       'Charter pillar: autonomy. Program QNFO.OPS. Metric to move: the loop-heartbeats journey (issue 1001171, GitHub 6420) and the charter document refresh. Evidence (qnfo-audit portfolio_sync_runs, read 2026-11-04 23:00Z): run 772 at 07:05Z committed all three surfaces (QNFO/qnfo-workers docs/PORTFOLIO.md on main, QNFO/.github PORTFOLIO.md and profile/README.md on master, author qnfo-fleet[bot]); runs 773 to 776 (16:05Z to 22:05Z) answer PUT HTTP 409 on all three, three attempts each. The ruleset require-build (id 26544275, active on the default branch, created 2026-11-04T15:47Z, docs/MAIN-PUSH-POLICY.md) requires the status check Workers Builds: qnfo-workers and a pull request with the repository admin role as the only bypass actor; QNFO/.github master has classic protection that requires a pull request. docs/MAIN-PUSH-POLICY.md moved the workflows to branches and pull requests but names no worker: pfCommitOnce and charterCommitOnce in qnfo-fleet-control/worker.js still PUT to the default branch. The GitHub App token is not an admin, and the personal token must not be used to step around the owner''s rule. Effect: LOOP-WATCH reports PORTFOLIO-WRITE-FAILED-1 for three surfaces, portfolio_last ages past its 150-minute budget, loop-heartbeats stays red on the GitHub runner, and the daily charter refresh (03:10Z, docs/QUNIVERSE-CHARTER.md) will meet the same refusal.' || char(10) ||
       'Change: when the PUT is refused by a rule (the note now carries GitHub''s sentence since qnfo-fleet-control JOURNEY-RECORD-DURABLE-1 / PUT-RULE-NOTE-1), write the new content to a branch fleet-bot/portfolio-sync cut from the default branch tip (force-reset an existing one), open a pull request unless one is open, and merge it with the same token only where the default branch has no required status check (QNFO/.github); for qnfo-workers leave the merge to the stale-PR lane, and keep [skip ci] out of that commit message so the required check reports. Apply the same fallback in charterCommitOnce. A sync whose tree equals the branch tip pushes nothing. Test with a stubbed GitHub in qnfo-fleet-control/portfolio.test.mjs: refused PUT, branch reset, pull request opened once, merge only on .github, unchanged content opens nothing. If the owner instead adds the GitHub App as a bypass actor of require-build (docs/MAIN-PUSH-POLICY.md, compatible with either choice), the fallback is simply not reached. Definition of done: the newest portfolio_sync_runs row is ok and at most 150 minutes old. The same change serves the three PORTFOLIO-WRITE-FAILED-1 issues that LOOP-WATCH filed at 16:05Z, one per surface (agent_issues 1001804, 1001805, 1001806).' || char(10) ||
       'code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js' || char(10) ||
       'code-anchor: async function pfCommitOnce(env, repo, path, content, message, mode) {',
       'claude-session', 'reliability', 'high', 'open', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #portfolio-pr-publish:%');

UPDATE remediation_contracts
   SET verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM portfolio_sync_runs) = 0 THEN ''no portfolio sync row'' WHEN (SELECT status FROM portfolio_sync_runs ORDER BY id DESC LIMIT 1) <> ''ok'' THEN ''latest portfolio sync is '' || (SELECT status FROM portfolio_sync_runs ORDER BY id DESC LIMIT 1) WHEN (SELECT (julianday(''now'') - julianday(ts)) * 1440.0 FROM portfolio_sync_runs ORDER BY id DESC LIMIT 1) > 150 THEN ''latest portfolio sync is older than 150 minutes'' ELSE ''ok'' END AS observed',
       verify_transport = 'd1-query', status = 'active', attempts = 0, last_verdict = NULL, next_due_at = datetime('now')
 WHERE class = (SELECT 'issue-' || id FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS #portfolio-pr-publish:%' AND status = 'open' ORDER BY id DESC LIMIT 1)
   AND instr(verify_probe, 'portfolio_sync_runs') = 0;

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:D2-slo-journeys-probes',
  'a journey run that leaves no row is a defect of the recorder, not of the journey: rows are written first and together, and a refusal by a repository rule is reported with its sentence and never retried or stepped around',
  'JOURNEY-RECORD-DURABLE-1: failure mode journey-ticks-cut with detector fm-journey-ticks-cut; doer ROADMAP-1 #portfolio-pr-publish filed for the portfolio and charter writes the require-build ruleset refuses',
  'journey_runs runner cf: 11 of 62 ticks partial on 2026-11-04 against 1 of 72 on 2026-11-02, 10 ticks absent, no ask-path run at 18:00Z; portfolio_sync_runs 773 to 776 write-failed HTTP 409 on all three surfaces after the ruleset of 15:47Z; run 772 committed at 07:05Z',
  'migration merged through the canonical path; qnfo-fleet-control deployed by the same PR',
  'one failure_modes row, one detector contract, one filed issue with its contract',
  'the Rollback header removes the detector and the failure mode and closes the filed issue with evidence; the decision row stays (append-only)',
  'every journey run leaves a row even when D1 stumbles; a tick cut short is visible within the hour; the portfolio write failure has an owner, a design and a closing probe',
  'fm-journey-ticks-cut reads ok within a day of the deploy (all ticks whole, ask-path in 3 of 4 slots); ask-path contract 1001363 passes after the 00:00Z or 06:00Z run; the portfolio doer closes when portfolio_sync_runs reads ok',
  'none',
  'offline suites qnfo-fleet-control/journeys.test.mjs (74 checks: batch retry, row-by-row fallback, hop retry, error category), qnfo-fleet-control/put-retry-ledger.test.mjs (30) and migrations/d2a-journey-durable.test.mjs (the detector on whole, partial and sparse ticks; the doer probe on ok, partial and stale runs)'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'JOURNEY-RECORD-DURABLE-1:%');
