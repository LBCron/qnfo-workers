-- C2-SCOUT-ROWS-1 (2026-11-05, roadmap completion sweep, cluster C2-SCOUT): status and live evidence for the scout roadmap rows that were built by earlier work and never recorded (every row still read
-- planned). Each evidence string is a read made on 2026-11-04/05 (qnfo-audit, living-paper, the repository on main), not a restatement of a merge. Rows whose build is still open stay as they are; every UPDATE is guarded with status = 'planned' so a status another session already wrote (1701 and 1704 read verified) is never overwritten.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'planned', verified_at = NULL, evidence = 'docs/SCOUT-ROADMAP-2026-10.md' WHERE id IN (1682, 1685, 1691); UPDATE roadmap_implementation SET status = 'planned', verified_at = NULL, evidence = 'docs/SCOUT-ROADMAP-2026-10.md; scripts/bp26_*.py stubs' WHERE id = 1703; UPDATE roadmap_implementation SET status = 'planned', verified_at = NULL, evidence = 'docs/COMPOSIO-INTEGRATION.md' WHERE id = 1804;

UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'Live read 2026-11-05: scripts/seeded_claim_harness.mjs + scripts/seeded-claims.json write qnfo-audit.seeded_claim_runs through scripts/bp26_seeded.py (156 rows, newest 2026-11-04T21:53:17Z, 150 of 150 caught in 7 days); metric seeded_false_claim_catch_rate last_value 1 refreshed 2026-11-04T21:53:18Z; agent_issues 1000665 closed with remediation_verifications#397514 pass. Validity: the six original seeds were the six sentences the scan was written for and only one gate was exercised, so PR 7457 (RM-SEEDED-CLAIM-HARNESS-2) widens it to 17 seeds over fabricated-scan, citation-gate and verify-adjudication with a clean control per gate; the five misses it found are filed as SEEDED-GAP-1 (four scan paraphrases) and SEEDED-GAP-2 (title check inert on [n] reference lines) with doers and closing probes.'
WHERE id = 1703 AND item = 'RM-SEEDED-CLAIM-HARNESS-1' AND status = 'planned';

UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'Audit docs/DETERMINISTIC-GATE-AUDIT.md (PR 5083, 21 decision points, 4 MODEL-ONLY); the four GATE-AUDIT-1 follow-ups (agent_issues 1000658, 1000659, 1000660, 1000661) are closed with passing code-read probes (remediation_verifications#468798, #416875, #423970, #389415); the roadmap issue 1000638 closed with remediation_verifications#396247 pass. qnfo-ops carries the GATE-AUDIT-1:cf_worker_deploy gate (worker.js gateAudit1CfWorkerDeploy).'
WHERE id = 1682 AND item = 'RM-DETERMINISTIC-GATE-AUDIT-1' AND status = 'planned';

UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'Live read 2026-11-05 (living-paper): 19 of 19 papers first published in the last 7 days carry seed, trace_id and novelty in their insert row of paper_change_ledger / paper_change_bodies (the probe of agent_issues 1000641, remediation_verifications#547343 pass 1.00 on 2026-11-03). Code: PR 5186 and PR 6366 in qnfo-research-exec.'
WHERE id = 1685 AND item = 'RM-PAPER-PROVENANCE-TRACE-1' AND status = 'planned';

UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'The existence gate is live and enforcing: qnfo-research-exec CITATION_GATE (since 2026-10-09; ops_config research_citation_gate unset = enforce) resolves every arXiv id, DOI and link of a paper before publish, holds it on not-found, and writes one paper_claims reference row per checked reference (148 rows, all verified, 2026-11-02 to 2026-11-04; 13 citation-gate events in 2 days, all ok). Of 203 references in the 20 papers first published in the last 5 days, 0 lacked a link, so the id/DOI/URL path covers the fleet reference format; the dead title-and-year resolver stub of PR 5194 (citationGateResolve, never called) is not needed for it. The seeded harness (PR 7457) catches a fabricated arXiv id, a dead DOI and a dead link. Open: the label-against-title comparison never runs on [n] reference lines (seed S12), tracked by SEEDED-GAP-2.'
WHERE id = 1691 AND item = 'RM-CITE-EXISTENCE-GATE-1' AND status = 'planned';

UPDATE roadmap_implementation SET status = 'verified', verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  evidence = 'The code loop planner replays its recorded transcript offline and asserts the model request equals the logged projection (PR 6404, qnfo-code-orchestrator/planner-transcript-replay.test.mjs, passing); PR 7297 adds the reusable harness scripts/agent_loop_replay.mjs (JSONL transcripts, Workers AI binding and OpenAI-style fetch clients, first-divergence path, extra and missing calls, secret refusal on record; 15 offline checks in scripts/agent_loop_replay.test.mjs, run by scripts/run-suites.mjs).'
WHERE id = 1804 AND item = 'RM-DSH-REPLAY-1' AND status = 'planned';
