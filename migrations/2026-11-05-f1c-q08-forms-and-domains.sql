-- F1-C open-issue sweep, part 1 (2026-11-05, pillars reach and security; GitHub 5576 5578 5612 5613 5709 5712 5736; agent_issues 1000662 1000668 1000715; roadmap 1697 1699 1751 1752).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f1c_contracts
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_f1c_contracts b WHERE b.class = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_f1c_contracts b WHERE b.class = remediation_contracts.class), status = (SELECT b.status FROM bak_20261105_f1c_contracts b WHERE b.class = remediation_contracts.class), last_verdict = (SELECT b.last_verdict FROM bak_20261105_f1c_contracts b WHERE b.class = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_f1c_contracts b WHERE b.class = remediation_contracts.class) WHERE class IN (SELECT class FROM bak_20261105_f1c_contracts); UPDATE roadmap_implementation SET status = (SELECT b.status FROM bak_20261105_f1c_roadmap b WHERE b.id = roadmap_implementation.id), evidence = (SELECT b.evidence FROM bak_20261105_f1c_roadmap b WHERE b.id = roadmap_implementation.id), verified_at = (SELECT b.verified_at FROM bak_20261105_f1c_roadmap b WHERE b.id = roadmap_implementation.id) WHERE id IN (SELECT id FROM bak_20261105_f1c_roadmap); UPDATE agent_issues SET status = 'closed' WHERE title LIKE 'BP26-EDGE-TURNSTILE-Q08-2:%' OR title LIKE 'ROADMAP-1: QNFO.REACH Q08-DOMAIN-FORM-2:%'; decision_log is append-only and keeps its rows.
-- CAUSE-MAPPED: no metric is registered here; this edits two contract rows and roadmap rows and inserts two issue rows.

-- WHAT THIS DOES, read from the live system on 2026-11-04/05
--  (1) #5712 / 1000668 BP26-EDGE-TURNSTILE-Q08-1. The contract probe could never pass: expected was a sentence ("q08.org#/subscribe and q08.org#q08-fb both Turnstile-protected (ok=1)")
--      and observed a group_concat of subjects and details, and the consumer passes only when the two are equal as text. The rows it reads were real (ok=0, "Turnstile widget absent"
--      for q08.org#/subscribe and q08.org#q08-fb at 2026-11-04T21:53:57Z), so the defect was in the code and the probe could not have recognised the fix. The probe now returns the literal
--      ok when the newest row of both subjects is ok = 1, else the subjects and their ok values. The code fix is q08-signal-engine 0.44.0 (shared TURNSTILE-EDGE-1 block, widget in the
--      three forms, token verified in handleSubscribe and /api/f); the stale unwired copy of the block that a code-loop task had left in worker.js (#5122) is replaced.
--  (2) #5578 / #5709 / 1000662 RM-FORECAST-UPDATE-SCORING-1. Shipped in 0.42.0 (PR 6611, merged 2026-11-03T09:26Z): updated_brier, updated_log_score, updated_probability and
--      original_log_score on /api/forecasts and /forecasts, never overwriting q08_forecasts.probability or brier; q08-signal-engine/forecast.test.mjs line 190 proves it against the real
--      worker (73 passed). The contract was superseded as circular (it observed the guarded issue status). It now reads the code: the worker and the test that covers it both hold updated_brier.
--      No forecast has resolved yet (stats.resolved 0, earliest horizon 2026-12-31), so the field cannot be seen on a live resolved forecast; the test is the evidence until one resolves.
--  (3) #5576 / roadmap 1697 RM-FORECAST-HYGIENE-1 is shipped and live: the resolution gate (forecastResolutionGaps inside validateForecastClaim), the append-only q08_forecast_updates and the
--      immutable published fields are triggers in the production q08-signal database (q08_forecast_updates_no_update, q08_forecast_updates_no_delete, q08_forecasts_published_fields_immutable,
--      read 2026-11-05), the log score and the calibration page answer 200 at q08.org/forecasts/calibration, and forecast-hygiene.test.mjs passes 14 of 14. The three forecasts that predate the
--      gate still fail the text-pattern proxy (forecast_resolution_criteria_complete 0 of 3): that is the open metric issue 1000671, not this item.
--  (5) #5612 / #5736 / 1000715 (EK-4) and #5613 (EK-5): q08-signal-engine 0.44.0 writes and judges policy and science stories in the structural-reading form (Q08-DOMAIN-FORM-1). Roadmap rows
--      1751 and 1752 move to built, not verified: they are verified only by a published piece (see the probes below), after the deploy.
--  (6) Closed loops: two issue rows for what this change cannot do by itself (enforce the Turnstile secret, add an official-source policy lane), each with its closing probe.

CREATE TABLE IF NOT EXISTS bak_20261105_f1c_contracts AS
  SELECT * FROM remediation_contracts WHERE class IN ('issue-1000662', 'issue-1000668');
CREATE TABLE IF NOT EXISTS bak_20261105_f1c_roadmap AS
  SELECT id, status, evidence, verified_at FROM roadmap_implementation WHERE id IN (1697, 1699, 1751, 1752);

-- (2) issue-1000662: a probe that measures the feature, not the issue's own status
UPDATE remediation_contracts
SET precondition = 'F1-C 2026-11-05: RM-FORECAST-UPDATE-SCORING-1 is implemented when the worker computes updated_brier and the test that covers it holds the same field, never when issue 1000662 changes status.',
    action = 'Measure the feature on main with a code-read probe over q08-signal-engine/worker.js and q08-signal-engine/forecast.test.mjs.',
    verify_probe = '{"paths":["q08-signal-engine/worker.js","q08-signal-engine/forecast.test.mjs"],"contains":"updated_brier"}',
    verify_transport = 'code-read',
    max_attempts = 24,
    expected_cadence_h = 1,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    module = 'probe-needed-issue-1000662',
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1000662'
  AND issue_id = 1000662
  AND status = 'superseded'
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000662 AND status = 'open');

-- (1) issue-1000668: a probe that can pass when the forms are protected
UPDATE remediation_contracts
SET verify_probe = 'WITH latest AS (SELECT subject, ok FROM (SELECT subject, ok, ROW_NUMBER() OVER (PARTITION BY subject ORDER BY run_at DESC) AS rn FROM bp26_probe_results WHERE metric = ''turnstile_on_public_forms'' AND subject IN (''q08.org#/subscribe'', ''q08.org#q08-fb'')) WHERE rn = 1) SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM latest WHERE ok = 1) = 2 THEN ''ok'' ELSE COALESCE((SELECT group_concat(subject || '' ok='' || COALESCE(ok, ''null''), '' | '') FROM latest), ''no probe rows'') END AS observed',
    precondition = 'F1-C 2026-11-05: the old probe compared a sentence with a concatenation of subjects and details and could never read pass; this one returns ok when the newest collector row of both q08.org forms is ok = 1.',
    last_attempt_at = NULL,
    last_verdict = NULL,
    attempts = 0,
    next_due_at = datetime('now'),
    deferred_since = NULL
WHERE class = 'issue-1000668'
  AND issue_id = 1000668
  AND status = 'active'
  AND instr(verify_probe, 'both Turnstile-protected (ok=1)') > 0
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000668 AND status = 'open');

-- roadmap rows: the two verified live today, the two built and waiting for a published piece
UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'F1-C 2026-11-05, read live: the resolution gate (forecastResolutionGaps in validateForecastClaim), the append-only q08_forecast_updates (triggers q08_forecast_updates_no_update and _no_delete) and the immutable published fields (trigger q08_forecasts_published_fields_immutable) exist in the production q08-signal database; the log score and the calibration page answer at q08.org/forecasts/calibration (HTTP 200) and q08.org/api/forecasts/calibration; q08-signal-engine 0.43.0 serves them; forecast-hygiene.test.mjs 14 of 14 and forecast.test.mjs 73 of 73 pass. The three forecasts that predate the gate fail the text-pattern proxy (forecast_resolution_criteria_complete 0 of 3): tracked by agent_issues 1000671.'
WHERE id = 1697 AND item = 'RM-FORECAST-HYGIENE-1' AND status = 'in_progress';

UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'F1-C 2026-11-05: shipped in q08-signal-engine 0.42.0 (PR 6611, merged 2026-11-03): lastForecastUpdateScore and attachForecastUpdateScore add updated_probability, updated_at, original_log_score, updated_brier and updated_log_score to /api/forecasts and /forecasts for a resolved forecast that had an update before its horizon, and leave q08_forecasts.probability and brier untouched; forecast.test.mjs line 190 proves it against the worker (73 passed). Live 0.43.0 serves it; no forecast has resolved yet (stats.resolved 0, earliest horizon 2026-12-31), so the fields are not yet visible on a live forecast. Closing probe: contract issue-1000662 (code-read over the worker and the test).'
WHERE id = 1699 AND item = 'RM-FORECAST-UPDATE-SCORING-1' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'F1-C 2026-11-05: q08-signal-engine 0.44.0 (Q08-DOMAIN-FORM-1) classifies a story before the first writer call and writes and judges a policy or science story in the structural-reading form; a second arXiv request adds the policy and science categories; ops_config q08_domains = tech restores the earlier behaviour. Verified live when a q08 engine_runs row with status ok carries a source_kind containing -policy or -science (agent_issues 1000715 carries the title-based outcome probe). Not covered: an official-source policy lane (filed as Q08-DOMAIN-FORM-2).'
WHERE id = 1751 AND item = 'EK-4' AND status = 'planned';

UPDATE roadmap_implementation
SET status = 'built',
    evidence = 'F1-C 2026-11-05, read live: 61 hours since the last q08 piece (2026-11-02T09:04Z), 0 of about 70 attempts of 2026-11-03/04 published; the failed drafts about a street-safety scheme and a data-centre ballot measure were refused by the panel and the fact-check because the technical-systems form asked for components the source never had. q08-signal-engine 0.44.0 writes and judges those stories in the policy and science form (Q08-DOMAIN-FORM-1); the tick allowance of 0.43.0 (16:31Z 2026-11-04) already bounds the attempts. Verified live when q08.org lists a piece newer than 24 hours and q08_neurons_per_published_piece_7d moves; guard unified_cost_usd_30d must not rise.'
WHERE id = 1752 AND item = 'EK-5' AND status = 'planned';

-- (6) closed loops
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-EDGE-TURNSTILE-Q08-2: bind TURNSTILE_SECRET on q08-signal-engine so the q08.org subscribe and verdict forms enforce, after the secret is shown to work',
 'Charter pillar: security. q08-signal-engine 0.44.0 renders the Turnstile widget in the subscribe forms and the verdict form and verifies the token in handleSubscribe and /api/f, fail-open while TURNSTILE_SECRET is unbound (issue 1000668 closes on the widget). Until the secret is bound nothing is enforced: /health says "turnstile": "widget-only". Steps for the fleet (not the owner): (1) take the secret lease (POST https://qnfo-deploy-guard.q08.workers.dev/secret-lock/acquire for worker q08-signal-engine); (2) show that the secret works before enforcing, with the hourly self-test pattern of scripts/turnstile-selftest.snippet.js (PR 7339 for qnfo-ipatent) or one real widget token from a browser on q08.org; (3) PUT TURNSTILE_SECRET to q08-signal-engine the way BP26-EDGE-SECURITY-1 did for idea-hub (docs/BP26-EDGE-SECURITY-1.md, Secrets); (4) read /health. Do not bind a secret nobody has seen verify: a wrong secret makes siteverify refuse every visitor and takes the reader verdicts (q08_verified_votes_7d) to zero. Rollback: delete the secret; the code is fail-open again.
runtime-probe: {"url": "https://q08.org/health", "status": 200, "contains": "enforcing"}',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'BP26-EDGE-TURNSTILE-Q08-2:%' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.REACH Q08-DOMAIN-FORM-2: an official-source policy lane for q08 (primary documents), behind ops_config q08_domains, with a measured yield read of Q08-DOMAIN-FORM-1',
 'Charter pillar: reach. Q08-DOMAIN-FORM-1 (q08-signal-engine 0.44.0) writes policy and science stories in the structural-reading form and adds an arXiv lane for the policy and science categories; the policy half still depends on Hacker News and arXiv. Add a lane of primary policy documents (the Federal Register JSON API, documents.json with body_html_url for the full text) as candidates with source set to the new lane and domain policy, so they flow through the same gates, the same domain prompts and sourceKindOf; keep it behind the policy token of ops_config q08_domains. A contested-topic piece needs the even-keel check of EK-3 (agent_issues 1000714) and the three-source rule of EK-2 (1000713) before the lane is switched on for it. Measure first: engine_runs source_kind of 2026-11-05 onward (hn-policy, hn-science, arxiv-policy, arxiv-science against hn and arxiv): attempts, ok rows, panel and fact-check failures, from q08-signal. Offline test with a stubbed documents.json. Definition of done: code-probe passes and a policy piece from the lane publishes, or the yield read says the lane is not worth its calls, written into this issue with the numbers.
code-task: repo=qnfo-workers path=q08-signal-engine/worker.js
code-anchor: async function scrapeArxivDomain(env, domains) {
code-probe: {"paths": ["q08-signal-engine/worker.js"], "contains": "federalregister.gov"}',
 'session', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.REACH Q08-DOMAIN-FORM-2:%' AND status = 'open');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:F1-research-reach/C',
 'a technical-systems writer prompt and reader panel applied to policy and science stories is the cause of the q08 stall, not the quality bar; so the form is made domain-fit and every gate is left alone',
 'Q08-DOMAIN-FORM-1 and BP26-EDGE-TURNSTILE-Q08-1 in q08-signal-engine 0.44.0; contract probes of issue-1000662 and issue-1000668 replaced',
 'q08-signal D1 read 2026-11-05: 0 of about 70 attempts of 2026-11-03/04 published, last piece 2026-11-02T09:04Z; judge pass rates over 2026-11-01..04: glm-5.3-flash 50 to 65 percent, qwen3.8-27b 14 to 30, kimi-k2.6 15 to 17, deepseek-v4-flash 10 to 17; the panel fix lines of the failed drafts ask for the concrete event and for invented procedural details to be cut on a street-safety scheme and a data-centre ballot measure; bp26_probe_results 2026-11-04T21:53:57Z turnstile_on_public_forms ok 0 for q08.org#/subscribe and q08.org#q08-fb; forecast.test.mjs 73 passed, domain-form.test.mjs and turnstile-forms.test.mjs added',
 'PR open; deploy through the canonical path; live verification pending',
 'q08-signal-engine (the writer prompt of policy and science stories only, the widget and token check on two forms), two contract rows',
 'ops_config q08_domains = tech restores the earlier prompts; deleting the secret (never bound) keeps the forms fail-open; revert the PR; the Rollback header restores the contracts and roadmap rows',
 'q08 can publish policy and science analyses in the form the owner asked for',
 'within 72 hours of the deploy at least one q08 engine_runs row is ok with a source_kind containing -policy or -science, or the lane is shown to fail at a named stage (read from engine_runs and q08_reader_tests); q08.org/subscribe and a piece page carry cf-turnstile and the next collect_web run reads turnstile_on_public_forms ok 1 for both q08.org subjects',
 'q08 pieces on policy and science topics; fewer wasted attempts on stories the technical form cannot carry',
 'q08.org/subscribe, q08.org/p/<slug>, /api/f, /health, domain-form.test.mjs, turnstile-forms.test.mjs'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'Q08-DOMAIN-FORM-1 and BP26-EDGE-TURNSTILE-Q08-1%');
