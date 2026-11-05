-- REACH-JOURNEYS-PREDICTIONS-1 (2026-11-05, charter pillar core; FLEET-JOURNEY-FAILED-1 loop-heartbeats agent_issues 1001171 and traffic-health 2562).
-- Three fleet-control changes (two decision rows) ship with this file and are logged here with their prediction before the deploy (PREDICT, MEASURE, KEEP OR REVERT; DOCTRINE-1 decision_log):
--   1. REMEDIATION-OVERLOAD-BACKPRESSURE-1 (qnfo-fleet-control remediationContractsTick). Measured 2026-11-04 22:30-23:30Z with Workers Observability (error-level lines that
--      contain "overloaded"): 419 lines in the hour, 210 from the remediation tick, in bursts at :00, :10, :20 and :30 where every worker's cron also starts. The tick stamped an
--      overloaded probe as the contract's verdict probe-error and went on to write four more rows into the database that had just said it was full. Now an overloaded probe leaves its
--      contract untouched, the tick waits 2 s times the streak and stops after three overloaded iterations in a row (the rest stays due for the next slot), and the lines are warnings.
--      Honest size of the effect: only 3 contracts carried the verdict probe-error at 00:15Z, so the verdict part is small; the load and the error lines are the point.
--      Prediction: error-level overload lines from remediationTick events fall from about 210 an hour to under 40; qnfo-fleet-control real-traffic error rate (9.6 % of 6 h) falls under 5 %
--      after the 6-hour window has rolled past the deploy.
--      The same change carries JOURNEY-RECORD-OVERLOAD-1: the journey_runs insert and the journey issue update wait out an overload twice (2.5 s, 5 s). Measured from journey_runs: the 20-minute
--      ticks of 18:00 to 20:20Z wrote 1, 5, 8, 2, 1 and 0 of their 8 rows and the 00:00Z tick 6 of 8 (binding-census, ai-router, traffic-health lost), so a journey could be unrecorded and its issue
--      and fleet_journeys_failing stale. Prediction: every 20-minute tick after the deploy writes all 7 or 8 of its rows.
--   2. PORTFOLIO-VIA-PR-1 (qnfo-fleet-control pfCommitOnce, charterCommitOnce). Since 2026-11-04 15:47Z the Contents API commit of docs/PORTFOLIO.md to main (ruleset require-build)
--      and of PORTFOLIO.md and profile/README.md to QNFO/.github master (branch protection that asks for a pull request) answers HTTP 409 on every hourly retry (last commit 07:05Z),
--      so LOOP-WATCH-1 reports PORTFOLIO-WRITE-FAILED-1 for all three surfaces (issues 1001804 to 1001806) and the gha runner of loop-heartbeats fails "fleet-control LOOP-WATCH healthy".
--      The charter document (next run 03:10Z) would take the same refusal. A rule refusal is now answered with one branch and one pull request per surface, merged through the API when
--      GitHub allows it and left to the merge lane otherwise.
--      Prediction: within two hourly syncs after the deploy the three PORTFOLIO-WRITE-FAILED-1 findings are gone, the loop-heartbeats journey passes on both runners and
--      fleet_journeys_failing is at most 1 (traffic-health, which also waits on the qnfo-ai model-route 504s and the deploy-guard lock 5xx owned elsewhere).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: SELECT 1 /* decision_log is append-only; a wrong prediction is answered by outcome_matched, never by deleting the row */;
-- spof-review: two append-only decision rows; no code, binding, cron or credential.

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-reach-journeys',
  'a D1 overload is a 10-second window, not a verdict about a probe: the tick that meets it stops adding load and leaves its work due, instead of recording a failure and writing more',
  'REACH-JOURNEYS-PREDICTIONS-1: REMEDIATION-OVERLOAD-BACKPRESSURE-1 (fleet-control remediationContractsTick: overloaded probe leaves the contract untouched, 2 s x streak wait, stop after 3 in a row, overload lines are warnings) and JOURNEY-RECORD-OVERLOAD-1 (journey_runs insert waits out an overload twice)',
  'Workers Observability 22:30-23:30Z: 419 error lines containing "overloaded", 210 from remediationTick/remediationContractsTick events (probe-error 83, caught 93, deferral-stamp 14, evidence-fallback 8, verification-insert 8, pass-prestamp 3); worker_logs per-minute: 118/79/28/48 overload exceptions at 23:00/23:10/23:20/23:30; D1 GraphQL: 301 remediation_verifications inserts plus 115 cloud_ops_events inserts in the 90 s after 23:30:00; 3 contracts with verdict probe-error at 00:15Z',
  'applied by migration with the code change', 'one tick function in qnfo-fleet-control; contracts keep their rows and due dates, nothing deleted',
  'revert the pull request (the worker returns to stamping probe-error and logging error lines); the migration rollback deletes the decision row',
  'the 10-minute remediation slot sheds load when the database is full', 'fleet_journeys_failing <= 2 within 12 h', 'none',
  'qnfo-fleet-control suites remediation-overload-backpressure, remediation-slot, remediation-transports; D1 qnfo-audit worker_logs; Workers Observability telemetry query'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'REACH-JOURNEYS-PREDICTIONS-1: REMEDIATION%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'breach-reach-journeys',
  'a repository rule that asks for a pull request is not a conflict to retry: the generated document is delivered the way the rule asks, and the merge lane or the API merges it',
  'REACH-JOURNEYS-PREDICTIONS-1: PORTFOLIO-VIA-PR-1 (fleet-control pfCommitOnce and charterCommitOnce open one branch and one pull request per surface when the direct commit is refused by a rule)',
  'portfolio_sync_runs 16:05Z to 23:05Z: all three surfaces write-failed "PUT HTTP 409 ... attempts 3" on every hourly run, last commit 07:05Z; gh api repos/QNFO/qnfo-workers/rulesets/26544275 require-build updated 2026-11-04T16:47+01:00 (status check plus pull request, bypass only repository admin role); gh api repos/QNFO/.github/branches/master/protection required_pull_request_reviews present; docs/MAIN-PUSH-POLICY.md records the same refusal for workflows; agent_issues 1001804 to 1001806 open without a doer',
  'applied by migration with the code change', 'portfolio and charter writes of qnfo-fleet-control; one branch portfolio-loop/<surface> and one pull request per surface per change, no change to any ruleset',
  'revert the pull request (writes return to the refused direct commit); close any open portfolio-loop/* pull request',
  'generated portfolio and charter documents reach main and master again under the repository rules', 'fleet_journeys_failing <= 1 within 24 h', 'none',
  'qnfo-fleet-control suite portfolio-via-pr (in-memory GitHub: refusal, open pull request, retry, merge, stale sha, charter); GitHub rulesets and branch protection read'
WHERE NOT EXISTS (SELECT 1 FROM decision_log d WHERE d.action LIKE 'REACH-JOURNEYS-PREDICTIONS-1: PORTFOLIO%');
