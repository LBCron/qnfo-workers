-- F1-RESEARCH-REACH-CLOSEOUT-1 (2026-11-05, charter pillars research and reach; GitHub 5750 5696 6153 6448 6817 5561 5593 5612 5613 5689; agent_issues 1000766 1000648 1000974 1001449 1000640; roadmap 1684 1710 1751 1752).
-- Sweep cluster F1-research-reach, part 2. Every fact below was read live on 2026-11-05 between 03:20Z and 04:40Z; nothing is assumed.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f1_closeout
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.a FROM bak_20261105_f1_closeout b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class), verify_transport = (SELECT b.b FROM bak_20261105_f1_closeout b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class), status = (SELECT b.st FROM bak_20261105_f1_closeout b WHERE b.kind = 'contract' AND b.key = remediation_contracts.class) WHERE class IN (SELECT key FROM bak_20261105_f1_closeout WHERE kind = 'contract'); UPDATE roadmap_implementation SET status = (SELECT b.st FROM bak_20261105_f1_closeout b WHERE b.kind = 'roadmap' AND b.key = CAST(roadmap_implementation.id AS TEXT)), evidence = (SELECT b.a FROM bak_20261105_f1_closeout b WHERE b.kind = 'roadmap' AND b.key = CAST(roadmap_implementation.id AS TEXT)), verified_at = (SELECT b.b FROM bak_20261105_f1_closeout b WHERE b.kind = 'roadmap' AND b.key = CAST(roadmap_implementation.id AS TEXT)) WHERE id IN (SELECT CAST(key AS INTEGER) FROM bak_20261105_f1_closeout WHERE kind = 'roadmap'); UPDATE remediation_contracts SET status = 'superseded', last_verdict = 'superseded:rollback' WHERE class IN ('rm-1751', 'rm-1752'); decision_log is append-only and keeps its row.
-- CAUSE-MAPPED: no metric_registry row is registered here; this changes four contract probes, two roadmap rows and adds two roadmap-dod contracts.
--
-- WHAT THIS DOES
--  (1) 1000648 / #5696 RM-CITE-EXISTENCE-GATE-1. The closing probe counted version_queue rows published in September 2026 (before any gate) whose citation_audit says "no machine identifier present":
--      historical, immutable rows, so it could never read 0 (10 attempts, all fail). The existence gate itself is live: CITATION_GATE resolves every arXiv id, DOI and link of a paper before it publishes and holds it
--      on not-found (since 2026-10-09); paper_claims holds 148 reference rows, all verified, 2026-11-02 to 2026-11-04; none of the 12 version_queue publications since 2026-10-28 carries an identifier-less reference;
--      the seeded harness (PR 7457) records its recall in seeded_claim_runs (gate citation-gate: 3 of 4 seeds caught on 2026-11-05T04:05Z; the miss is the label-against-title comparison on [n] lines, tracked as SEEDED-GAP-2).
--      The probe now reads those three facts. Precision is not measured (the harness seeds false references only); that stays with SEEDED-GAP-2.
--  (2) 1000766 / #5750 (rem-223f, "1 HARD findings unresolved after 7 revise cycles"). The probe compared a sentence with a concatenation, so it could not read pass either. The defect is the parking of a row that
--      cannot pass review (SINGLE-LANE-1, agent_issues 1001450, GitHub #6709, branch f1r/single-lane): the row itself was already re-queued at ground (error "SINGLE-LANE-1: re-entered at ground, no parked state").
--      The probe now counts rows left terminal (wontfix) on a HARD-unresolved error: 2 today (rem-rev-0786b94f and c6cfb61e, REVIEW-UNRESOLVED-PARK-1), expected 0 after the SINGLE-LANE-1 code and its sweep.
--  (3) 1000974 / #6153 (rem-7782) and 1001274 / #6448 (rem-2238), LOOP-BREAKER 1000960 / #6146. Defect: stageComplete gave up (markError "complete: structural defects only, no writable section") whenever the
--      numbering defect was not the single reason "skipped section numbers" on a paper with exactly the eight required headings. Live today: rows 5ec7f391, deb8dfc7 and rem-16f715f0 carry "duplicate required section:
--      Results; duplicate section numbers", and the signature {"ok":false,"stage":"complete","structural":true} last recurred 2026-11-05T02:24Z (6 in 24 h). Fixed by PR 7685 (qnfo-research-exec
--      0.53.1, repairStructuralHeadings). The 1000974 probe read a frozen backup body (paper_integrity_backups) and could never change; it now counts rows still waiting with a duplicate or skipped number error.
--  (4) 1001449 / #6817 (rem-ea57, "bibliography 4 < 5 entries with full text"). Fixed by GROUND-FULLTEXT-TOPUP-1 (PR 7474, DataCite replaces candidates the full-text filter dropped); the row is back in the lane
--      (ground, deferred by RESEARCH-BACKPRESSURE-1). The probe also counted published rows, which keep the text of an old error forever (f782bbf6): it now counts terminal (wontfix, archived) rows only.
--      NOT proven live: no ground-second-source event has been written since the deploy (the pipeline is held by backpressure and budget), so the top-up path itself has not run on a real row yet.
--  (5) Roadmap rows. 1684 RM-RAG-HYBRID-BASELINE-1 -> verified: the A/B pair is recorded (ask_evals 63 rerank=true mrr 0.9063 recall 0.9375 mean_ms 7906 rerank_calls 16; 64 rerank=false mrr 0.9583 recall 1
--      mean_ms 3305 rerank_calls 0, 2026-11-05T03:44Z) and the cheaper arm also holds the higher quality, so cross-encoder rerank is NOT adopted (contract issue-1000640 reads pass). The keep-after-three-pairs rule is
--      agent_issues 1001862. 1710 BP26-SLO-FRESHNESS-1 -> verified: bp26_probe_results holds lat:<host> for 13 hosts and fresh:q08.org (collect_web run 2026-11-05T03:22:59Z); fresh:q08.org reads ok=0 because q08 published
--      nothing in the 24 h before the 2026-11-04 09:00 CET deadline: that is the real stall (EK-5), measured, not hidden.
--  (6) EK-4 (1751) and EK-5 (1752) are built (q08-signal-engine 0.44.0) and verified only by a published q08 piece, which has not happened: q08 engine_runs show 0 published since 2026-11-02T09:04Z and gate_failed
--      drafts (panel mean 2 of 5, unsupported claim) on 2026-11-05. Each gets a roadmap-dod contract so the steward verifies the row and closes the mirror when the piece exists, not before.
--
-- PREDICTION (decision_log below): the four rewritten probes read honestly from the next consumer pass; 1000648 and 1001449 close on it, 1000766/1000974 on the SINGLE-LANE-1 and PR 7685 deploys; rm-1751 and rm-1752
-- stay un-passed until q08 publishes. Failure mode: a probe that reads pass while the live path is unproven (1001449): its evidence says so in the close text and the pipeline hold is named.

CREATE TABLE IF NOT EXISTS bak_20261105_f1_closeout AS
SELECT 'contract' AS kind, class AS key, status AS st, verify_probe AS a, verify_transport AS b FROM remediation_contracts WHERE class IN ('issue-1000648', 'issue-1000766', 'issue-1000974', 'issue-1001449')
UNION ALL
SELECT 'roadmap', CAST(id AS TEXT), status, evidence, verified_at FROM roadmap_implementation WHERE id IN (1684, 1710);

-- (1) issue-1000648: the existence gate runs on new papers and records a recall
UPDATE remediation_contracts
SET precondition = 'F1 2026-11-05: RM-CITE-EXISTENCE-GATE-1 holds when new publications carry no identifier-less reference, the gate wrote reference rows in the last 7 days and the seeded harness caught a seeded false reference in the last 7 days.',
    action = 'Measure the gate on publications since 2026-10-28, not the September rows that predate it.',
    verify_probe = 'SELECT ''ok'' AS expected, CASE WHEN (SELECT COUNT(*) FROM version_queue WHERE status = ''published'' AND updated_at >= ''2026-10-28'' AND instr(citation_audit, ''no machine identifier present'') > 0) = 0 AND (SELECT COUNT(*) FROM paper_claims WHERE claim_kind = ''reference'' AND created_at >= datetime(''now'', ''-7 days'')) >= 1 AND (SELECT COUNT(*) FROM seeded_claim_runs WHERE gate = ''citation-gate'' AND caught = 1 AND ts >= datetime(''now'', ''-7 days'')) >= 1 THEN ''ok'' ELSE ''existence gate evidence missing: '' || (SELECT COUNT(*) FROM version_queue WHERE status = ''published'' AND updated_at >= ''2026-10-28'' AND instr(citation_audit, ''no machine identifier present'') > 0) || '' unresolved publications, '' || (SELECT COUNT(*) FROM paper_claims WHERE claim_kind = ''reference'' AND created_at >= datetime(''now'', ''-7 days'')) || '' reference rows in 7 days'' END AS observed',
    verify_transport = 'd1-query',
    max_attempts = 24,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1000648'
  AND issue_id = 1000648
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000648 AND status = 'open');

-- (2) issue-1000766: no row is left terminal on unresolved HARD findings
UPDATE remediation_contracts
SET precondition = 'F1 2026-11-05: a paper that cannot pass review keeps cycling through revise and ground (SINGLE-LANE-1); it is never left terminal.',
    action = 'Count research_queue rows left wontfix on a HARD-findings-unresolved error. Expected 0 once SINGLE-LANE-1 (agent_issues 1001450) is deployed and its sweep ran.',
    verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM research_queue WHERE status = ''wontfix'' AND instr(error, ''HARD findings unresolved'') > 0',
    verify_transport = 'd1-query',
    max_attempts = 48,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1000766'
  AND issue_id = 1000766
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000766 AND status = 'open');

-- (3) issue-1000974: no row waits with a duplicate or skipped section number error
UPDATE remediation_contracts
SET precondition = 'F1 2026-11-05: stageComplete repairs duplicate, skipped and duplicate-required-heading numbering without a model call (PR 7685, qnfo-research-exec 0.53.1).',
    action = 'Count research_queue rows still queued, researching or deferred with a duplicate or skipped section number error. Expected 0 after the deploy and one pass of the stale-claim reaper.',
    verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM research_queue WHERE status IN (''queued'', ''researching'', ''deferred'') AND (instr(error, ''duplicate section numbers'') > 0 OR instr(error, ''skipped section numbers'') > 0)',
    verify_transport = 'd1-query',
    max_attempts = 48,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1000974'
  AND issue_id = 1000974
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1000974 AND status = 'open');

-- (4) issue-1001449: terminal rows only (a published row keeps the text of an old error)
UPDATE remediation_contracts
SET precondition = 'F1 2026-11-05: the ground stage tops up candidates the full-text filter dropped (GROUND-FULLTEXT-TOPUP-1, PR 7474); a row is not left terminal on the bibliography gate.',
    action = 'Count terminal (wontfix, archived) research_queue rows whose error names the bibliography. Published rows are excluded: they keep the text of an error from before they published.',
    verify_probe = 'SELECT ''0'' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM research_queue WHERE status IN (''wontfix'', ''archived'') AND instr(error, ''bibliography'') > 0',
    verify_transport = 'd1-query',
    max_attempts = 24,
    status = 'active',
    ts = datetime('now'),
    last_attempt_at = NULL,
    last_verdict = NULL,
    next_due_at = datetime('now'),
    attempts = 0,
    deferred_since = NULL
WHERE class = 'issue-1001449'
  AND issue_id = 1001449
  AND EXISTS (SELECT 1 FROM agent_issues WHERE id = 1001449 AND status = 'open');

-- (5) roadmap rows read verified today
UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'F1 2026-11-05, read live: the A/B pair the item asks for is recorded in ask_evals (id 63 rerank=true: mrr 0.9063, recall 0.9375, mean_ms 7906, rerank_calls 16, n 16; id 64 rerank=false: mrr 0.9583, recall 1, mean_ms 3305, rerank_calls 0; both 2026-11-05T03:44Z, qnfo-ai-search 2.15.0 after PR 7308). The cheaper arm (hybrid retrieval, no cross-encoder rerank) also holds the higher quality, so rerank is not adopted and hybrid stays the baseline; contract issue-1000640 reads pass. The keep-after-three-pairs rule is agent_issues 1001862.'
WHERE id = 1684 AND item = 'RM-RAG-HYBRID-BASELINE-1' AND status IN ('planned', 'partial', 'built');

UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'F1 2026-11-05, read live: bp26_probe_results holds lat:<host> samples for 13 public hosts and fresh:q08.org, all written by one collect_web run at 2026-11-05T03:22:59Z (PR 7461, scripts/bp26_web.py and bp26_slo.py); 14 SLI definitions were registered by migrations/2026-11-05-f1c-slo-freshness.sql (migration_runs ok 03:15Z). fresh:q08.org reads ok=0 (deadline 2026-11-04T08:00Z: no piece in the 24 h before 09:00 Central European time): that is the real q08 publishing stall (EK-5), now measured every day.'
WHERE id = 1710 AND status IN ('planned', 'partial', 'built');

-- (6) EK-4 and EK-5 are verified by a published q08 piece, not by a merge
INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1751', NULL, 'F1 2026-11-05: roadmap item EK-4 (id 1751) is built (q08-signal-engine 0.44.0, Q08-DOMAIN-FORM-1) and waits for a published policy or science analysis on q08.org',
       'EK-4 is verified when q08.org has published a policy or science analysis, read from content_external_items (the fleet mirror of published pieces). q08 engine_runs show 0 published since 2026-11-02T09:04Z.',
       'SELECT ''ok'' AS expected, CASE WHEN COUNT(*) >= 1 THEN ''ok'' ELSE COUNT(*) || '' published policy or science analyses on q08.org'' END AS observed FROM content_external_items WHERE property = ''q08.org'' AND stage = ''published'' AND (lower(title) LIKE ''%policy%'' OR lower(title) LIKE ''%regulation%'' OR lower(title) LIKE ''%legislation%'' OR lower(title) LIKE ''%government%'' OR lower(title) LIKE ''%election%'' OR lower(title) LIKE ''%climate%'' OR lower(title) LIKE ''%biology%'' OR lower(title) LIKE ''%physics%'' OR lower(title) LIKE ''%neuroscience%'' OR lower(title) LIKE ''%public health%'' OR lower(title) LIKE ''%energy%'' OR lower(title) LIKE ''%economics%'')',
       'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1751 AND item = 'EK-4' AND status IN ('built', 'deployed', 'implemented');

INSERT OR IGNORE INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, max_attempts, escalate_to, expected_cadence_h, status, module, next_due_at)
SELECT 'rm-1752', NULL, 'F1 2026-11-05: roadmap item EK-5 (id 1752) is built (q08-signal-engine 0.44.0) and waits for a q08 piece inside the daily freshness window',
       'EK-5 is verified when the newest fresh:q08.org sample is ok: a q08.org piece was published in the 24 h before the 09:00 Central European time deadline (bp26_web.py writes one sample a day from q08-signal). Today it reads ok=0, nothing published since 2026-11-02T09:04Z.',
       'SELECT ''ok'' AS expected, CASE WHEN (SELECT ok FROM bp26_probe_results WHERE subject = ''fresh:q08.org'' ORDER BY run_at DESC LIMIT 1) = 1 THEN ''ok'' ELSE ''fresh:q08.org newest sample ok='' || COALESCE((SELECT ok FROM bp26_probe_results WHERE subject = ''fresh:q08.org'' ORDER BY run_at DESC LIMIT 1), ''none'') END AS observed',
       'd1-query', 48, 'qnfo-github-steward', 1, 'active', 'roadmap-dod-v1', datetime('now')
FROM roadmap_implementation WHERE id = 1752 AND item = 'EK-5' AND status IN ('built', 'deployed', 'implemented');

INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested)
SELECT 'session:F1-research-reach',
 'a closing probe that can never read pass keeps a fixed defect open for ever, and one that reads pass on stale or historical rows closes an unfixed one; so each probe below is rewritten to read the live state of the defect and no more',
 'F1-RESEARCH-REACH-CLOSEOUT-1: probes of issue-1000648, 1000766, 1000974, 1001449 rewritten; roadmap rows 1684 and 1710 verified; roadmap-dod contracts rm-1751 and rm-1752 added',
 'read 2026-11-05: ask_evals 63 and 64; bp26_probe_results lat: 13 subjects and fresh:q08.org; paper_claims 148 reference rows; seeded_claim_runs citation-gate 3 of 4; research_queue wontfix HARD-unresolved 2, duplicate-number errors 1, bibliography terminal 0; q08 engine_runs 0 published since 2026-11-02',
 'migration applied by CI; probes read at the next consumer pass',
 'four contract rows, two roadmap rows, two new roadmap-dod contracts',
 'the Rollback header restores the four probes and the two rows from bak_20261105_f1_closeout and supersedes the two new contracts',
 'closing probes that can tell fixed from unfixed',
 'the next consumer pass closes 1000648 and 1001449 (they read pass today); 1000766 and 1000974 stay fail until the SINGLE-LANE-1 and structural-repair deploys, then close; rm-1751 and rm-1752 stay unpassed until q08 publishes',
 'research papers stop dying on numbering and parking',
 'remediation_contracts, roadmap_implementation'
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE action LIKE 'F1-RESEARCH-REACH-CLOSEOUT-1:%');
