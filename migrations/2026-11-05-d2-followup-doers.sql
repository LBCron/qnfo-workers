-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE agent_issues SET status = 'closed' WHERE (title LIKE 'PROBE-REVIEW-ROOT-CAUSE-1: %' OR title LIKE 'SLO-DATAPATH-1: %') AND status = 'open'; UPDATE agent_issues SET description = replace(description, char(10) || 'DELTA-NOTE (D2-slo-journeys-probes, 2026-11-05): ', char(10) || 'REVERTED-NOTE: ') WHERE id IN (1001925, 1000610)
-- D2 FOLLOW-UP DOERS (2026-11-05, charter pillars autonomy and reliability; OWNER-NO-LOOSE-ENDS-1; session D2-slo-journeys-probes, GitHub 6178, 6040, 6876, 5768, 5282).
-- Four findings of the cluster that need a code change in a file another session held when this was written (work-locks 2026-11-05T04:00Z: qnfo-ai-calibration/worker.js until 04:51Z,
-- qnfo-cloud-ops/worker.js until 05:28Z, scripts/bp26_web.py until 05:17Z). Each gets a doer with a code-task line and a closing probe; nothing else is changed here.
--   1. AI-CAL-ECHO-1 (1001925, GitHub 6178): the cause is now known. qnfo-ai answers a single-model request with `model: routedModel`, and routedModel is the route chatRoute() picked
--      (a dynamic route such as dynamic/premium for an id containing thinking, reasoner, pro or code), never the id that was asked for. The routed ping can therefore never echo the asked id:
--      all nine ids with a Workers AI twin read "router http=504 echo=false; direct ok direct" and pass on the direct probe; deepseek-v4-flash-thinking has no twin, so it reads http=200 echo=false and fails
--      for ever (91 of 91 sweeps on the 504, then every sweep after PR 7338 on echo). A note with the decided fix is appended to the issue.
--   2. PROBE-REVIEW-ROOT-CAUSE-1 (GitHub 6040, 6876): PROBE-REVIEW-1 (qnfo-cloud-ops) judged the family-quiet probe of the ROOT-CAUSE-1 template "self-confirming" and moved the contracts of 1001220 (2026-11-01,
--      cached by probe text) and 1001621 (2026-11-05T03:11Z) to probe-review-refused, which neither executor reads. The probe is the template's definition of done ("closes once the family has had no reopen and no new
--      issue for 24 hours"), written by the management-personas workflow, like the probe-template modules the review already skips.
--   3. SLO-DATAPATH-1 (GitHub 5768): V3-DASH-1 made fleet.qnfo.org / a static shell, so the availability sample of that host (bp26_web.py) no longer touches the data path; a slow /api/v3/now would not show.
--   4. 1000610 (GitHub 5282): the drill window compares published_at ('YYYY-MM-DD HH:MM:SS') with a 'YYYY-MM-DDTHH:MM:SSZ' bound, so posts on the boundary day are left out; harmless while the caps are not binding.
-- The descriptions hold real line breaks.
UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (D2-slo-journeys-probes, 2026-11-05): cause found, decided fix. qnfo-ai/worker.js sets the response model of a single-model request to routedModel, which is the route chatRoute() chose (dynamic/premium for ids matching thinking|reasoner|pro|code, dynamic/value for flash, dynamic/standard otherwise), not the asked id. So `echo` in probeCompletion can never be true through the router; the ids with a Workers AI twin pass on the direct probe (probe = model-budget), deepseek-v4-flash-thinking has none. Fix in probeCompletion: for an id that is not in BUDGET_DIRECT_IDS, a 200 with content whose response model starts with dynamic/ is the evidence the router can give and counts as an echo (the id is served through its route); keep the downgraded and fail paths; put the response model into the failure detail (ECHO-DETAIL-1: model=<id>). Add the case to qnfo-ai-calibration/reasoning-ping.test.mjs (stub router answers model dynamic/premium for the thinking id). code-probe below stays: ECHO-DETAIL-1 must appear in the file.'
WHERE id = 1001925 AND status = 'open' AND instr(description, 'DELTA-NOTE (D2-slo-journeys-probes, 2026-11-05)') = 0;

UPDATE agent_issues
SET description = description || char(10) || 'DELTA-NOTE (D2-slo-journeys-probes, 2026-11-05): CAPS-CHANGE-GRACE-1 (PR 7651) makes the drill judge posts under the caps in force. Known and left: the 7-day bound in the drill probe is strftime(''%Y-%m-%dT%H:%M:%SZ'', ''now'', ''-7 days'') while social_media_posts.published_at is ''YYYY-MM-DD HH:MM:SS'', so a post on the boundary day sorts before the bound and is left out (a space sorts before T). Fix by replacing the bound with datetime(''now'', ''-7 days'') in control_alternate_probes.probe_sql of social-weekly-caps (one replace, guarded by the fragment occurring once) and adding the boundary case to migrations/social-weekly-caps-cap-change.test.mjs.'
WHERE id = 1000610 AND instr(description, 'DELTA-NOTE (D2-slo-journeys-probes, 2026-11-05)') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'PROBE-REVIEW-ROOT-CAUSE-1: PROBE-REVIEW-1 refuses the ROOT-CAUSE-1 template probe as self-confirming, so the contracts of the tickets it closes leave the closing path',
 'Charter pillar: autonomy. Doer: the code loop (qnfo-cloud-ops), after the file claim of ct_im1001893 lapses.
Read live 2026-11-05: contract issue-1001220 (GitHub 6040) has status probe-review-refused since 2026-11-01 (verdict cached by probe text, cloud_ops_events probe-review-issue-1001220-70bb72a56e19) and issue-1001621 (GitHub 6876) since 2026-11-05T03:11Z. The probe is the one the management-personas workflow writes for every ROOT-CAUSE-1 ticket (module root-cause-probe-at-birth-1): it reads ok when the family has had no reopen and no new issue for 24 hours, which is the ticket''s own definition of done ("it closes on its own once the family has had no reopen and no new issue for 24 hours"). The model judged it against "the ROOT-CAUSE issue has actually closed". A refused contract is read by neither executor, so the ticket can only close through the workflow''s rc-close step.
Lever: in qnfo-cloud-ops/worker.js jobProbeReview, do not judge a contract whose module is root-cause-probe-at-birth-1 (a fleet-owned template, like the probe-template modules PROBE_REVIEW_SELECT already skips), and restore one left refused: add AND COALESCE(c.module, '''') <> ''root-cause-probe-at-birth-1'' to PROBE_REVIEW_SELECT and a one-time migration UPDATE remediation_contracts SET status = ''active'', last_verdict = NULL, attempts = 0, next_due_at = datetime(''now'') WHERE module = ''root-cause-probe-at-birth-1'' AND status = ''probe-review-refused''. Add the case to the cloud-ops probe-review suite. Do not touch the model, the prompt or the verdict handling for any other module.
Done: no contract with module root-cause-probe-at-birth-1 has status probe-review-refused; the two named contracts are active.

code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js
code-anchor: function probeReviewPrompt(title, description, probe) {
code-probe: {"paths": ["qnfo-cloud-ops/worker.js"], "contains": "root-cause-probe-at-birth-1"}',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'PROBE-REVIEW-ROOT-CAUSE-1: %' AND status = 'open');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'SLO-DATAPATH-1: the availability sample of fleet.qnfo.org reads a static shell since V3-DASH-1, so a slow dashboard API would not show in the SLO',
 'Charter pillar: reliability. Doer: the code loop (scripts/bp26_web.py), after the file claim of breach-bp26-web lapses.
Cause of GitHub 5768 / agent_issues 1000808: fleet.qnfo.org / answered 200 in 5 to 18 s from 2026-10-29 to 2026-11-04T14:09Z (the old page waited on qnfo-audit reads; worker_logs wall 12 to 29 s at 25 to 158 ms CPU). V3-DASH-1 (PR 6923, dashboard 1.82.0) made / a static shell and moved the reads to /api/v3/now and /api/v3/readers (7 s section timeouts, 45 s cache). The sample bp26_web.py takes of https://fleet.qnfo.org/ now exercises none of them: a dashboard whose data endpoint takes 30 s or answers ok:false in every section would still read 200 in 250 ms.
Lever: in scripts/bp26_web.py collect_web, add one more availability sample for the data path: GET https://fleet.qnfo.org/api/v3/now, ok when the status is 200, the answer comes in under SLO_MAX_MS and the JSON carries at least one section with ok true; record it as subject avail:fleet.qnfo.org/api/v3/now (not a new member of HTML_HOSTS: that list also feeds the security-header, tracker and structured-data checks) and add the surface to slo_definitions with a migration (objective 0.995, window 28 days) so scripts/bp26_slo.py gives it a budget row, incidents and postmortems. A failed or unreadable fetch is a failed sample only when the host answered; a budget-exhausted fetch stays not sampled (ok NULL, SLO-PROBE-BUDGET-1). Selftest case in scripts/bp26_web.py and a migration test.
Done: slo_budget_state has a row for fleet.qnfo.org/api/v3/now and bp26_probe_results holds a sample of it every run.

code-task: repo=qnfo-workers path=scripts/bp26_web.py
code-anchor: def collect_web(ctx):
code-probe: {"paths": ["scripts/bp26_web.py"], "contains": "api/v3/now"}',
 'session', 'reliability', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'SLO-DATAPATH-1: %' AND status = 'open');
