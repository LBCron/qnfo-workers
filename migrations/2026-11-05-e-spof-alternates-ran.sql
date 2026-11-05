-- SPOF-ALTERNATE-RAN-E-1 (2026-11-05, charter pillar autonomy; GitHub QNFO/qnfo-workers#5284; agent_issues 1000613 METRIC-REGRESSION-1 spofs_on_critical_path; cluster E-metrics-portfolio).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_e_spof_alternates
-- Rollback: UPDATE spof_registry SET alternate_tested_at = (SELECT b.alternate_tested_at FROM bak_20261105_e_spof_alternates b WHERE b.component = spof_registry.component), evidence = (SELECT b.evidence FROM bak_20261105_e_spof_alternates b WHERE b.component = spof_registry.component), reviewed_at = (SELECT b.reviewed_at FROM bak_20261105_e_spof_alternates b WHERE b.component = spof_registry.component) WHERE component IN (SELECT component FROM bak_20261105_e_spof_alternates)
-- CAUSE-MAPPED: no metric is registered here; this records two alternate-path runs in spof_registry.
--
-- spofs_on_critical_path counts registered single points of failure whose alternate path has not run (doctrine section 10; the contract of issue 1000613 requires 0 untested and a 7-day mean not above
-- the prior 7 days). Read 2026-11-05 00:55Z: 5 of 18 rows have alternate_tested_at NULL. Two of the five alternates have in fact run in production, and the registry never recorded it:
--   * fleet_tick producers (issue 1001656): fleet_tick rows by source in the 8 hours to 00:55Z: cron:qnfo-code-orchestrator 41 (the first 2026-11-04T17:08:45Z, the last 2026-11-05T00:54:45Z),
--     cron:qnfo-fleet-dashboard 6 (the last 2026-11-04T20:35:23Z), session:fleet-tick-measure-2 1. The dashboard stopped writing at 20:35Z and the orchestrator's */2 feedFleetTick, the registered alternate, kept
--     every 10-minute fixer fed for the four hours since, so the alternate producer has run and carried the fan-out.
--   * work-claim endpoint (qnfo-deploy-guard /work-lock): CLAIM-UNREACHABLE-FALLBACK-1 is the alternate (a GitHub-side overlap check and a `work-claim: unreachable (...)` line in the pull request body). PR 6966
--     (D1-429-RETRY-1, merged 2026-11-04T15:25:55Z) was opened while the endpoint answered lock_db_unavailable (D1 overloaded) and says "work-claim: unreachable (lock_db_unavailable, D1 overloaded); no other open
--     PR touches scripts/code-task-publish.py": the fallback was followed and the change merged.
-- Three rows stay untested, honestly, and the issue stays open on them: the qnfo-agents */5 cron (alternate POST /requests/drain needs a trusted caller's token), the qnfo-evolve cron (alternate POST /tick needs
-- x-loop-token) and research publication structural validation (its listed alternate is not a preventive one, issue 1000209). None of the three can be exercised by a session without a credential; a drill step that
-- calls both token-gated routes through chaosExercise (CHAOS-DRILL-1) is filed below with a doer.

CREATE TABLE IF NOT EXISTS bak_20261105_e_spof_alternates AS SELECT component, alternate_tested_at, evidence, reviewed_at FROM spof_registry WHERE component IN ('fleet_tick producers (qnfo-audit trigger fan-out)', 'work-claim endpoint (qnfo-deploy-guard /work-lock)');

UPDATE spof_registry
SET alternate_tested_at = '2026-11-05T00:54:45Z',
    evidence = COALESCE(evidence, '') || ' | SPOF-ALTERNATE-RAN-E-1 2026-11-05: fleet_tick rows by source in the 8 hours to 00:55Z were cron:qnfo-code-orchestrator 41 (last 2026-11-05T00:54:45Z), cron:qnfo-fleet-dashboard 6 (last 2026-11-04T20:35:23Z), session:fleet-tick-measure-2 1; the registered alternate producer carried the 10-minute fan-out for the four hours after the dashboard stopped writing.',
    reviewed_at = '2026-11-05T00:54:45Z'
WHERE component = 'fleet_tick producers (qnfo-audit trigger fan-out)' AND alternate_tested_at IS NULL;

UPDATE spof_registry
SET alternate_tested_at = '2026-11-04T15:25:55Z',
    evidence = COALESCE(evidence, '') || ' | SPOF-ALTERNATE-RAN-E-1 2026-11-05: PR 6966 (D1-429-RETRY-1, merged 2026-11-04T15:25:55Z) was opened while the endpoint answered lock_db_unavailable and carries "work-claim: unreachable (lock_db_unavailable, D1 overloaded); no other open PR touches scripts/code-task-publish.py": CLAIM-UNREACHABLE-FALLBACK-1 was followed and the change merged.',
    reviewed_at = '2026-11-05T00:54:45Z'
WHERE component = 'work-claim endpoint (qnfo-deploy-guard /work-lock)' AND alternate_tested_at IS NULL;

-- The drill keeps the first row fresh: CHAOS-DRILL-1 (qnfo-fleet-control chaosDrill, every 6 hours) judges each spof_alternate_probes row and re-stamps spof_registry.alternate_tested_at on a pass, so a producer
-- that stops carrying the fan-out is filed as CHAOS-DRILL-FAILED-1 instead of staying stamped for ever. The probe reads the alternate producer's own rows: the orchestrator wrote a fleet_tick in the last 6 hours.
INSERT OR IGNORE INTO spof_alternate_probes (component, probe_sql, exercise, window_note, enabled)
VALUES ('fleet_tick producers (qnfo-audit trigger fan-out)',
  'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM fleet_tick WHERE source LIKE ''cron:qnfo-code-orchestrator%'' AND ts > strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-6 hours'')) > 0 THEN ''ok'' ELSE ''the alternate producer (qnfo-code-orchestrator */2 feedFleetTick) wrote no fleet_tick in 6 hours'' END AS observed',
  NULL,
  '6 h: the registered alternate producer is qnfo-code-orchestrator feedFleetTick (*/2, the same 9-minute guard as the dashboard); the proof is its own rows, 41 of them in the 8 hours to 2026-11-05T00:55Z while the dashboard stopped at 20:35Z (issue 1001656)',
  1);

-- The remainder, with a doer (OWNER-NO-LOOSE-ENDS-1): exercise the two token-gated alternates from the worker that already runs the drill and holds the bindings, so spof_alternate_probes can judge them.
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SPOF-DRILL-1: exercise the token-gated alternate paths of the qnfo-agents and qnfo-evolve crons in chaosExercise so CHAOS-DRILL-1 can judge them',
'Charter pillar: autonomy. Serves agent_issues 1000613 (GitHub #5284, METRIC-REGRESSION-1 spofs_on_critical_path). Metric: spofs_on_critical_path 3 (after migrations/2026-11-05-e-spof-alternates-ran.sql) to 1 (research publication structural validation, issue 1000209).

Evidence (read 2026-11-05): spof_registry rows "qnfo-agents cron */5 (CF-AGENTS-LOOPS-1)" (alternate POST /requests/drain through the qnfo-ops AGENTS binding) and "qnfo-evolve cron" (alternate POST /tick with x-loop-token) have alternate_tested_at NULL and no spof_alternate_probes row: the alternates are documented and unit-tested (qnfo-agents/worker.test.mjs checks both drain paths) but have never been called in production, and a session cannot call them because both need a loop token. qnfo-fleet-control chaosDrill already runs every spof_alternate_probes row every 6 hours and has two exercise kinds (pdf-relay, router-drill) that act first and judge after.

Change: two exercise kinds in chaosExercise, agents-drain (POST /requests/drain on qnfo-agents) and evolve-tick (POST /tick on qnfo-evolve), each run only when the primary cron wrote its own event in the last 10 minutes (so the call is idempotent and cannot double a side effect), and two spof_alternate_probes rows whose probe reads the event the call leaves (a drain event with a count field, an evolve-tick event with trigger manual). A 401, a timeout or a body without the count field is a failed exercise (ran false), so the probe fails and CHAOS-DRILL-FAILED-1 is filed by the existing plan; nothing is stamped on a route that merely answers.

Failure mode: the exercise itself becomes the single caller; it is bounded to one call per component per drill and skipped while the primary cron is late.

code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js
code-anchor: async function chaosExercise(env, exercise) {
code-probe: {"paths": ["qnfo-fleet-control/worker.js"], "contains": "agents-drain"}',
'spof-drill-1', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'SPOF-DRILL-1:%');
