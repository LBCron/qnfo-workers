-- C1-BP26-FOLLOWUPS-1 (2026-11-05, charter pillars research and security; roadmap_implementation rows 1390, 1391, 1400, 1414; agent_issues 1000334, 1000335, 1000344, 1000358).
-- The part of cluster C1-BP26 that other sessions' claims on the owning files made a code-task instead of a change this session could make, plus two records that were missing:
--   1. Issue 1001912 (OWNER-TASK, the owner's handback of the provenance signing key card, 2026-11-05T00:26Z) carried the closure-observing probe template (CLOSE-PROBE-CIRCULAR-1: it reads the
--      status of the issue it guards, so it can never pass). It gets a probe that measures the defect: the signing key document answers, read from the evidence row the collector in
--      scripts/bp26_provenance_marking_coverage.py writes every run (subject 'signing key', ok 1 when https://papers.qnfo.org/.well-known/provenance-key.json answers 200).
--   2. The code-task filed by migrations/2026-11-05-bp26-provenance-key-card.sql resolved only a card that is open; the owner handed the card back, so it is 'rerouted'. The issue text now says the watch resolves both.
--   3. Three code-tasks with doers: papers.qnfo.org has no corrections feed (q08.org serves /api/corrections; checked live 2026-11-05: papers.qnfo.org/corrections and /api/corrections answer 404);
--      reading.q08.org serves /api/retractions without the COPE type and original link and has no /corrections alias; qnfo-cloud-ops sendDigest returns the recipient ADDRESS and its callers log the
--      result (2 raw address matches in a 24 h sample of 12000 Workers Logs events). Each file is under another session's live claim (qnfo-gateway/worker.js F1-research-reach/B, qnfo-cloud-ops/worker.js
--      breach-doctor-probes, personal-companion/worker.js a code-loop task), so the code loop takes them in order after the claim.
--   4. decision_log: the diff-size cap of catalogue 3.2 is NOT built, with the measurements that justify it and the condition that would reverse the decision; and the Worker-secret write for the
--      signing key was not retried through another route.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE remediation_contracts SET verify_probe = 'SELECT ''closed'' AS expected, (SELECT CASE WHEN status IN (''closed'', ''resolved'') THEN ''closed'' ELSE NULL END FROM agent_issues WHERE id = 1001912) AS observed', last_verdict = NULL WHERE issue_id = 1001912 AND class = 'issue-1001912'; DELETE FROM agent_issues WHERE status = 'open' AND title IN ('BP26-CORRECTIONS-PAPERS-1: papers.qnfo.org serves a COPE-typed corrections feed (/api/corrections and /corrections)', 'BP26-CORRECTIONS-READING-1: reading.q08.org retractions carry the COPE type and original link, with a /corrections alias', 'BP26-PII-LOGS-3: qnfo-cloud-ops sendDigest returns the recipient domain, not the address'); DELETE FROM decision_log WHERE actor = 'session-c1-bp26' AND action LIKE 'C1-BP26-FOLLOWUPS-1:%';

UPDATE remediation_contracts
SET verify_probe = 'SELECT ''signing key document served'' AS expected, COALESCE((SELECT CASE WHEN ok = 1 THEN ''signing key document served'' ELSE ''not served: '' || substr(detail, 1, 120) END FROM bp26_probe_results WHERE metric = ''provenance_marking_coverage'' AND subject = ''signing key'' ORDER BY run_at DESC LIMIT 1), ''unmeasured'') AS observed',
    verify_transport = 'd1-query', last_verdict = NULL, next_due_at = NULL
WHERE issue_id = 1001912 AND class = 'issue-1001912';

UPDATE agent_issues
SET description = description || char(10) || char(10) || 'Update 2026-11-05: the owner handed the card back to the fleet from the dashboard (issue 1001912), so human_actions.status is rerouted, not open. The watch must resolve a card that is open OR rerouted when the key document answers 200; ownerStepVerdict gets the case and jobOwnerStepsWatch reads both statuses. Issue 1001912 closes through its own probe (the evidence row of scripts/bp26_provenance_marking_coverage.py).'
WHERE status = 'open' AND title = 'BP26-PROVENANCE-KEY-1: owner-steps-watch resolves the provenance signing key card when the key document answers 200' AND instr(description, 'Update 2026-11-05') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-CORRECTIONS-PAPERS-1: papers.qnfo.org serves a COPE-typed corrections feed (/api/corrections and /corrections)',
'Charter pillar: research. Serves BP26-CORRECTIONS-FEED-1 (agent_issues 1000334, roadmap row 1390, catalogue 1.2: a machine-readable corrections feed, JSON and HTML, per property, with the COPE type, reason, date and two-way links). Metric it should move: the number of properties with a feed (q08.org has it, reading.q08.org has /api/retractions, papers.qnfo.org has none) and, through the notice a reader can find, correction_latency_p95_h.

Evidence read 2026-11-05: https://q08.org/api/corrections answers {ok, worker, version, retractions:[{type:"retraction", original_url, slug, reason, retracted_at, title}]} (131 rows) and https://q08.org/corrections 200; https://papers.qnfo.org/corrections, /corrections.json and /api/corrections answer 404 while living-paper holds 28 papers with status retracted whose ledger rows (paper_change_ledger, status_after = ''retracted'') carry the time and reason.

Change in qnfo-gateway (handleOpenData is the papers.qnfo.org public API router; the papers.qnfo.org host gate lists the open-data paths): add GET /api/corrections (JSON, same shape as q08.org plus cope_type, version and notice_url) and GET /corrections (HTML through qdsPage, a table of the same rows with the original and the notice linked), both from papers WHERE status = ''retracted'' joined to the newest ledger row with status_after = ''retracted'' by slug (28 rows: two correlated lookups by slug, never a scan of the ledger). The reason is cut at 240 characters and before any text starting "Restore:" (internal restore SQL is not public text). Add the path to the host gate, the OpenAPI document and llms.txt, one http probe in qnfo-gateway/probes.json, and a suite that feeds retracted and published rows and checks the JSON shape and the cut.

Closing probe: runtime-probe: {"url": "https://papers.qnfo.org/api/corrections", "status": 200, "contains": "\"retractions\""}

code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: async function handleOpenData(request, env, p) {
code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "/api/corrections"}',
'bp26-corrections', 'reliability', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'BP26-CORRECTIONS-PAPERS-1: papers.qnfo.org serves a COPE-typed corrections feed (/api/corrections and /corrections)');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-CORRECTIONS-READING-1: reading.q08.org retractions carry the COPE type and original link, with a /corrections alias',
'Charter pillar: research. Serves BP26-CORRECTIONS-FEED-1 (agent_issues 1000334, roadmap row 1390, catalogue 1.2).

Evidence read 2026-11-05: https://reading.q08.org/api/retractions answers {ok, count: 74, retractions:[{slug, reason, claims_json, retracted_at, title}]} and /retractions renders the page, but the rows have no type (COPE: correction, update, retraction, retraction-with-replacement), no original_url and no notice link, and https://reading.q08.org/corrections and /api/corrections answer 404 (q08.org serves /api/corrections with type and original_url).

Change in personal-companion (the route sits in the block that handles "/api/retractions" and "/retractions"): add type: "retraction" and original_url: "https://reading.q08.org/p/<slug>" (the 410 notice stays at that address; a retracted piece keeps its original timestamps) to each row, and answer "/api/corrections" and "/corrections" with the same handler. claims_json stays as it is. Add a case to the companion suite that feeds a retraction row and checks type, original_url and the alias.

Closing probe: runtime-probe: {"url": "https://reading.q08.org/api/corrections", "status": 200, "contains": "original_url"}

code-task: repo=qnfo-workers path=personal-companion/worker.js
code-anchor:     if (p === "/api/retractions" || p === "/retractions") {
code-probe: {"paths": ["personal-companion/worker.js"], "contains": "/api/corrections"}',
'bp26-corrections', 'reliability', 'low', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'BP26-CORRECTIONS-READING-1: reading.q08.org retractions carry the COPE type and original link, with a /corrections alias');

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'BP26-PII-LOGS-3: qnfo-cloud-ops sendDigest returns the recipient domain, not the address',
'Charter pillar: security. Serves BP26-RETENTION-1 (agent_issues 1000344, roadmap row 1400, catalogue 4.3: no raw e-mail addresses in logs). Metric it should move: pii_in_logs (target 0).

Evidence read 2026-11-05 (Workers Observability telemetry, 12000 events of 24 h, addresses never stored): qnfo-cloud-ops held 2 raw address matches in its application log. Redacted line: cloud-ops briefing ok {"items":4,"digest":{"skipped":"personal-domain","to":"[email]"}}. Source: sendDigest returns { skipped: "personal-domain", to: toRaw }, { ok: true, messageId, to } and { error, to }, and the briefing step logs the whole result.

Change: sendDigest returns to_domain (the part after the @) instead of to, in all three results, and nothing else reads .to (check the callers with the fleet graph impact lookup fn:qnfo-cloud-ops#sendDigest before the change). Add a case to a cloud-ops suite that stubs SEND_EMAIL and asserts no result carries an @.

Closing probe: code-probe below, and the 24 h address-match count for scriptName qnfo-cloud-ops reads 0.

code-task: repo=qnfo-workers path=qnfo-cloud-ops/worker.js
code-anchor: async function sendDigest(env, subject, text, toOverride) {
code-probe: {"paths": ["qnfo-cloud-ops/worker.js"], "contains": "to_domain"}',
'bp26-privacy', 'security', 'medium', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title = 'BP26-PII-LOGS-3: qnfo-cloud-ops sendDigest returns the recipient domain, not the address');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-c1-bp26',
  'a diff-size cap would slow pull requests the owner wants merged faster, and the two guard metrics that would justify it are healthy, so the catalogue 3.2 cap is deferred with its trigger written down, not built',
  'C1-BP26-FOLLOWUPS-1: diff-size cap of catalogue 3.2 not built; dependency allow-list built instead (scripts/dependency_allowlist.py, PR 7409)',
  'qnfo-audit v_metric_trigger_state 2026-11-05: change_failure_rate 0.0005 (limit 0.15), agent_pr_revert_rate 0 (limit 0.1); ci_gate_bypass_count 45 is measured over 16 of 2679 audited merges and is owned by the metric trigger issue, not by a size cap',
  'no cap; the dependency gate is regression-only through scripts/regression_gate.py',
  'none: nothing is removed or blocked',
  'build the cap as a report-only step in scripts/pr_fast_guards.py first (changed hand-written lines outside mirrors, lockfiles, releases and docs), enforce only after a week of its own numbers',
  'the catalogue gate list is explicit about which gate exists, which is deferred and why',
  'if agent_pr_revert_rate rises above 0.05 or change_failure_rate above 0.1, build the report-only cap the same day',
  0, 'v_metric_trigger_state read for the four metrics'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session-c1-bp26' AND action LIKE 'C1-BP26-FOLLOWUPS-1: diff-size cap%');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session-c1-bp26',
  'the owner handing a card back from the dashboard is a record in D1, not an instruction in the session, and the Worker-secret write for the signing key was refused by a permission check on 2026-10-28; the fleet path for a secret write belongs to the fleet loops under the secret lock, not to a session working around the refusal',
  'C1-BP26-FOLLOWUPS-1: PROVENANCE_SIGNING_KEY not written by this session; issue 1001912 gets a probe that measures the key document so it closes the moment any authorised path lands the secret',
  'issue 1001912 (OWNER-HANDBACK of bp26-provenance-signing-key) open; https://papers.qnfo.org/.well-known/provenance-key.json 503; provenance_marking_coverage 0 of 514 measured by PR 7375',
  'the measure and the probe exist; the secret does not',
  'none: no secret, binding or Worker setting changed',
  'n/a (nothing changed); the probe replacement is reverted by the Rollback line of this file',
  'issue 1001912 can no longer be closed without the key actually serving',
  'issue 1001912 closes within one consumer run of the key landing',
  0, 'papers.qnfo.org key document and q08.org sidecar read live; bp26_probe_results subject signing key'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE actor = 'session-c1-bp26' AND action LIKE 'C1-BP26-FOLLOWUPS-1: PROVENANCE_SIGNING_KEY%');
