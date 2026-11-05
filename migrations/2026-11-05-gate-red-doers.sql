-- GATE-RED-DOERS-1 (2026-11-05, charter pillar core; velocity, metric guard_rcs). Two suites are red on main since before the evening of 2026-11-04 and were hidden because
-- deploy-gate runs them as separate steps only when the SUITE-RUNNER mode is not 'full'; once a push selected 'changed' mode the deploy-gate went red with
-- CRON-RATE-CEILING-1 (fixed by PR 7334), `DS-402-BREAKER-1 offline suite (qnfo-ops)` and `Research grounding offline suite (qnfo-research-exec)` (runs 41936855302 and 41937176921).
-- Both are tests merged by a Copilot "[WIP]" pull request that never got its implementation:
--   #6522 (2026-11-03) added sections H and I to qnfo-ops/ds-402-breaker.test.mjs (a 429 opens the shared breaker); #6382 (2026-11-03) added section 2g to
--   qnfo-research-exec/grounding.test.mjs (DataCite tops up candidates the full-text filter dropped). Reproduced on main and, for the grounding suite, on every commit back to 0e668212.
-- The class (a test-only merge that fails) is closed going forward by PR-FAST-GUARDS-1 `suite-regressions` (a suite that goes red against the base blocks the pull request); what is left is these two
-- pieces of debt, filed with a doer each because both worker files are held by other sessions' work claims (qnfo-ops: C-ops-tools; research-exec: C7-research-products).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE status = 'open' AND title IN ('GATE-RED-DS402-429-1: a DeepSeek 429 must open the shared breaker (ds-402-breaker.test.mjs H and I are red on main)', 'GATE-RED-GROUNDING-TOPUP-1: DataCite must top up candidates the full-text filter dropped (grounding.test.mjs 2g is red on main)');
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'GATE-RED-DS402-429-1: a DeepSeek 429 must open the shared breaker (ds-402-breaker.test.mjs H and I are red on main)',
'Charter pillar: core (velocity). Metric it should move: guard_rcs (deploy-gate red on main).

Evidence (2026-11-05, `node --no-warnings qnfo-ops/ds-402-breaker.test.mjs` on main): 31 passed, 5 failed: H "one shared breaker row for the 429", H "another isolate skips the paid path after the shared 429 breaker opens, saw 3", H "the original 429 remains recorded as an upstream error: []", I "one paid streamed attempt before the breaker opens", I "streamed 429 opens the shared breaker".
Root cause: dsPaidTrip() returns false unless status === 402, so a 429 never opens the breaker. The streaming path already calls it for a 429 (`if (await dsPaidTrip(env, body.model, _st, "callDeepSeekStream")) break;`, PR 6818), which is therefore dead code, and the non-streamed path never calls it for a 429. Separately PR 6790 (OPS-UPSTREAM-429-HANDLED-1) deliberately records a handled 429 as kind ops_upstream_throttle, status info, so the test assertion that expects kind ops_upstream_error is stale.
Change: in qnfo-ops/worker.js let dsPaidTrip() open the shared breaker for a deepseek 429 as well as a 402 (log text names the status, the row keeps kind ds-402-breaker so the shared read in dsPaidBlocked still finds it) and call it from the non-streamed 429 branch; in qnfo-ops/ds-402-breaker.test.mjs section H expect kind ops_upstream_throttle with status info for the recorded 429. Bump VERSION with scripts/worker_release.py and keep deployed-current.worker.js identical. Do not lower the breaker window or remove the 402 behaviour.
Definition of done: `node --no-warnings qnfo-ops/ds-402-breaker.test.mjs` prints "0 failed", and the next push-to-main deploy-gate run has no failing `DS-402-BREAKER-1 offline suite (qnfo-ops)` step.

code-task: repo=qnfo-workers path=qnfo-ops/worker.js
code-anchor: if (status !== 402 || !/^deepseek\//i.test(String(model || ""))) return false;
code-probe: {"paths": ["qnfo-ops/worker.js"], "absent": "if (status !== 402 || !/^deepseek"}',
'gate-red-doers-1', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'GATE-RED-DS402-429-1:%');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'GATE-RED-GROUNDING-TOPUP-1: DataCite must top up candidates the full-text filter dropped (grounding.test.mjs 2g is red on main)',
'Charter pillar: research (cite full texts, CITE-FULLTEXT-1). Metric it should move: guard_rcs (deploy-gate red on main).

Evidence (2026-11-05, `node qnfo-research-exec/grounding.test.mjs` on main): AssertionError "DataCite should replace candidates dropped by the full-text filter" (section 2g, `res.ok` is false). The same assertion fails on every commit back to 0e668212 (2026-11-03), the test-only pull request #6382, so no implementation ever existed.
Root cause: stageGround() drops candidates whose full text is unavailable and, when fewer than MIN_GROUND_REFS remain, goes straight to markError ("ground: bibliography N < MIN_GROUND_REFS entries with full text") without asking the second source for replacements. The thin-literature floor then withholds or parks rows that DataCite could have completed. Section 2g sets two QNFO corpus bodies empty, answers DataCite with two records whose arXiv HTML exists, makes the arXiv HTML 404 for 2601.01003 to 2601.01007, and expects res.ok === true and res.bibCount === 5.
Change: in qnfo-research-exec/worker.js, before the thin-literature check, when the bibliography is under MIN_GROUND_REFS because the full-text filter dropped candidates, query DataCite for replacement candidates, run them through the same full-text filter (never admit a record without its full text; SOURCE-VOICE-1 and CITE-FULLTEXT-1 hold), merge them without duplicates and log a ground-fulltext-topup event with the counts. Bump VERSION with scripts/worker_release.py and keep deployed-current.worker.js identical; keep narrative-prompt-guard clean.
Definition of done: `node qnfo-research-exec/grounding.test.mjs` exits 0, and the next push-to-main deploy-gate run has no failing `Research grounding offline suite (qnfo-research-exec)` step.

code-task: repo=qnfo-workers path=qnfo-research-exec/worker.js
code-anchor: if (bib.length < MIN_GROUND_REFS) {
code-probe: {"paths": ["qnfo-research-exec/worker.js"], "contains": "ground-fulltext-topup"}',
'gate-red-doers-1', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'GATE-RED-GROUNDING-TOPUP-1:%');
