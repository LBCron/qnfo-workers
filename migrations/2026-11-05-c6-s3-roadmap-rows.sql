-- C6-S3 roadmap rows 18, 19, 20, 45, 46, 47, 48, 117 (cluster C6-COST-INFRA-SECURITY, 2026-11-05, charter pillars core, cost and reach).
-- Every statement below states what was READ LIVE on 2026-11-05 between 01:20Z and 02:00Z; no row is flipped on a merge alone.
--   20  RM-DEAD-PROBES-VERIFY-1  verified: Cloudflare workers list (38 scripts) holds none of qnfo-email-orchestrator, qnfo-egress-probe, size-semantics-probe-a,
--       size-semantics-probe-b, qnfo-ops-ledger-selftest; worker_live_audit qnfo-email-orchestrator http 404 NOT_DEPLOYED (probed 2026-11-05 01:28:23); the four
--       probe directories do not exist in the repository and qnfo-email-orchestrator/ carries FOLDED. reorg_work_queue 67-71 (OPEN since 2026-10-01) are set DONE.
--   45  RM-PAGES-SITES-MIGRATION-1  verified in its consolidated form: the nine standalone sites became one Pages project, qwav (deep.qwav.tech/papers/ serves 497 papers
--       including Laws of Form, Ultrametric Paradigm, Hierarchical Universe, Two Ways of Measuring, Unity of Ultrametric) plus the qnfo-hub project (measure., unity.,
--       quantum.qnfo.org, 200, security headers). laws., paradigm., hierarchy., different., ai-poc.qnfo.org have no DNS record at all (curl: Could not resolve host)
--       and no file in the repository names them, so there is nothing to migrate or redirect.
--   46  RM-DNS-REDIRECTS-HEADERS-1  verified: 12 redirect hosts (qwav.tech, www.qwav.tech, score.qwav.tech, qwav.net, www.qwav.net, qwav.uk, www.qwav.uk, www.qwav.org,
--       qnfo.net, qnfo.uk, www.qnfo.org, www.q08.org) answer 301 to the canonical host with HSTS and nosniff; 14 served hosts answer 200 with HSTS, X-Content-Type-Options,
--       X-Frame-Options and Referrer-Policy.
--   117 RM-PAGES-DEPLOY-PATH-1  verified: the qnfo-publications production deployment 9f3be69c (2026-10-28T12:39:15Z, status success) carries commit 1d5c220e, the main merge of
--       #5081 one minute earlier, so the push trigger of deploy-pages-qnfo-publications.yml deploys it; pages_project_audit holds ten inventory rows (latest 2026-11-01).
--   47  RM-ARCHIVE-MIGRATION-1  superseded: the convention it names (qnfo/archive/projects/) was overtaken by the 2026-07-15 multi-bucket migration (qnfo bucket DEPRECATED.md read live:
--       63 objects moved to qnfo-releases, qnfo-skills, qnfo-audit, qnfo-projects); tasks AM-T001..T007 are completed; obsidian-vault/Archive/ exists; discovery_projects holds
--       37 ARCHIVED rows; the qnfo-archive worker was retired 2026-10-06. What is left of it is the disposition of the legacy qnfo bucket (read-only, still holds 13 prefixes), which is row 49.
--   48  RM-REPO-HYGIENE-1  verified: portfolio_repos (synced 2026-11-05T01:05Z) 19 of 19 graded public repositories carry a licence, description and topics (flags hygiene []);
--       PORTFOLIO-HYGIENE-1 repairs the rest; the 16 diverged branches of 2026-09-30 no longer exist (74 remote branches, all pushed within the last 4 days, 3 merged).
--   18, 19  RM-CONSOLIDATION-WAVE-B-1, RM-FLEET-BUDGET-WAVES-1  partial: of the seven queued merges kaizen, backlog-exec and skill-sync are gone (RETIRED or FOLDED, absent from the account); BLOCKED-PROOF
--       agent-orchestrator and DEFERRED errata-hub are gone too; the live remainder maps to the WORKER-COUNT-1 rows (agent_issues 1001901-1001908: observability 1.4, MCP 2 to 1 1.6,
--       radar-hub refused by the personal/research separation 1.7, evolve 1.2 merged, model-eval 1.3 in a branch). The two pieces no row covers (fleet_budget W3 qnfo-pdf design and
--       containers-pilot lessons, W4 stale Vectorize qnfo-tasks and qnfo-notes) become one ROADMAP-1 row with a code-probe below. reorg_work_queue 24 and 25 are CANCELLED as superseded by
--       1001906 and 1001904; 26 and 27 stay OPEN with the new row named.
-- PREDICTION: fleet_budget vectorize_indexes current 10 -> 8 and workers 38 -> 30 over the WORKER-COUNT-1 rows plus the new row; no metric moves from this file (status and ledger rows only).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = CASE id WHEN 20 THEN 'gate-verify' WHEN 45 THEN 'gate-verify' WHEN 46 THEN 'gate-verify' WHEN 117 THEN 'partial' WHEN 47 THEN 'not-built' WHEN 48 THEN 'not-built' WHEN 18 THEN 'partial' WHEN 19 THEN 'not-built' END, evidence = substr(evidence, 1, instr(evidence, ' | C6-S3 2026-11-05') - 1), verified_at = NULL WHERE id IN (18, 19, 20, 45, 46, 47, 48, 117) AND instr(evidence, ' | C6-S3 2026-11-05') > 0; UPDATE reorg_work_queue SET state = 'OPEN', evidence = substr(evidence, 1, instr(evidence, ' | C6-S3 2026-11-05') - 1) WHERE id IN (24, 25, 26, 27, 67, 68, 69, 70, 71) AND instr(evidence, ' | C6-S3 2026-11-05') > 0; DELETE FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA FLEET-BUDGET-W3W4-1%' AND status = 'open';
-- CAUSE-MAPPED: registers no metric.
-- spof-review: adds no worker, cron, D1 trigger, route or credential; it writes ledger rows and one issue row.

UPDATE roadmap_implementation SET status = 'verified', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: ALREADY DONE. Cloudflare workers list read 2026-11-05 (38 scripts) holds none of qnfo-email-orchestrator, qnfo-egress-probe, size-semantics-probe-a, size-semantics-probe-b, qnfo-ops-ledger-selftest; worker_live_audit qnfo-email-orchestrator http 404 NOT_DEPLOYED probed 2026-11-05 01:28:23; the four probe directories are absent from the repository and qnfo-email-orchestrator/ carries FOLDED; reorg_work_queue 67-71 set DONE by this migration.'
WHERE id = 20 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'verified', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: ALREADY DONE in consolidated form. Pages project qwav serves https://deep.qwav.tech/papers/ (HTTP 200, 497 papers, the Laws of Form, Ultrametric Paradigm, Hierarchical Universe, Two Ways of Measuring and Unity of Ultrametric papers are in its index, HSTS and nosniff and X-Frame-Options set); qnfo-hub serves measure., unity. and quantum.qnfo.org (200, headers set); primer.qwav.tech 301 to deep.qwav.tech. laws., paradigm., hierarchy., different., ai-poc.qnfo.org have no DNS record (curl: Could not resolve host) and no file in the repository names them. Pages projects on the account: 7 (qwav-demo-bt-qec, qwav, qnfo-publications, q08-archive, qnfo-landing, qnfo-hub, ask-qwav).'
WHERE id = 45 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'verified', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: ALREADY DONE. curl read 2026-11-05: qwav.tech, www.qwav.tech, score.qwav.tech, qwav.net, www.qwav.net, qwav.uk, www.qwav.uk, www.qwav.org -> 301 https://qwav.org/; qnfo.net, qnfo.uk, www.qnfo.org -> 301 https://qnfo.org/; www.q08.org -> 301 https://q08.org/ (each with Strict-Transport-Security and X-Content-Type-Options). 200 with HSTS, nosniff, X-Frame-Options and Referrer-Policy: qnfo.org, legal., graph-api., archive., hub., design., hensel., measure., unity., quantum.qnfo.org, qwav.org, ask.qwav.org, ask.qwav.tech, q08.org, deep.qwav.tech. docs/DOMAINS.md and scripts/cf_estate.py dns-drift keep the table honest.'
WHERE id = 46 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'verified', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: ALREADY DONE. .github/workflows/deploy-pages-qnfo-publications.yml has a push-to-main trigger; the Pages API lists qnfo-publications production deployment 9f3be69c-7f1d-4a4e-bb10-e57d72276ca3 created 2026-10-28T12:39:15Z, status success, commit 1d5c220e (the main merge of #5081 at 12:38:43Z), and three earlier deployments on main commits 3bdc28c1, 9a5431e9 and afe7a537; pages_project_audit holds ten inventory rows (latest 2026-11-01T17:19:18Z, 25 deployments, one file). archive.qnfo.org itself is served by qnfo-gateway since ARCHIVE-ON-GATEWAY-1, so the census row is the Pages project qnfo-publications.pages.dev.'
WHERE id = 117 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'superseded', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: SUPERSEDED by the 2026-07-15 multi-bucket R2 migration and by row 49 (RM-UNBOUND-R2-DISPOSITION-1). Read live 2026-11-05: R2 bucket qnfo holds DEPRECATED.md ("63 objects migrated with 0 failures" to qnfo-releases, qnfo-skills, qnfo-audit, qnfo-projects, read-only archive) and no archive/ prefix; qnfo-projects holds _manifests/ (one JSON per project); obsidian-vault holds Archive/ (_radars, _research-iterations); tasks AM-T001..AM-T007 are completed; discovery_projects holds 37 ARCHIVED rows; the qnfo-archive worker is RETIRED (2026-10-06). The remaining question, what to do with the legacy qnfo bucket and the other unbound buckets, is row 49.'
WHERE id = 47 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'verified', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: ALREADY DONE. portfolio_repos synced 2026-11-05T01:05:49Z: 19 of 19 graded public repositories (platform 3, governance 3, research 5, demo 8) have licence, description and topics (flags hygiene []), repaired by PORTFOLIO-HYGIENE-1 (docs/PORTFOLIO.md scoreboard hygiene score 1). Branch hygiene: git ls-remote 55 heads on origin, 74 remote refs fetched, all pushed within the last 4 days; the 16 diverged branches of 2026-09-30 (fix/q08-route-and-archive-numbers, chatbox/*, claude/loving-darwin) no longer exist. Tasks GH-P0-034, GH-P1-036, GH-SPN-016, GH-SPN-020 are closed.'
WHERE id = 48 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'partial', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: PARTIAL. Of the seven QUEUED merges, qnfo-kaizen (RETIRED), qnfo-backlog-exec (FOLDED) and qnfo-skill-sync (RETIRED) are absent from the account (workers list read 2026-11-05); BLOCKED-PROOF qnfo-agent-orchestrator and DEFERRED errata-hub are absent too. Still live: qnfo-ai-calibration, qnfo-fleet-dashboard, qnfo-observability, qnfo-lifecycle (its target fleet-exec is FOLDED, so the merge as written is void), qnfo-infra, qnfo-ai-search, qnfo-containers-pilot, radar-hub. Doers: WORKER-COUNT-1.4 observability (agent_issues 1001904), 1.6 MCP (1001906), 1.7 radar-hub refused by the personal/research separation (1001907), 1.2 evolve merged (#7447, #7490), 1.3 model-eval fold in branch worker-count-fold-model-eval-2; qnfo-fleet-dashboard into fleet-control is not planned (public product, 1.4 MB). Workers live 38 against cap 30.'
WHERE id = 18 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE roadmap_implementation SET status = 'partial', verified_at = '2026-11-05T01:40:00Z',
  evidence = evidence || ' | C6-S3 2026-11-05: PARTIAL. W1 MCP 4 to 1: qnfo-skills-mcp retired 2026-09-27, the rest is WORKER-COUNT-1.6 (agent_issues 1001906). W2 watchtower 5 to 2: qnfo-kaizen, job-market-watch and goal-author are gone, observability is WORKER-COUNT-1.4 (1001904). W3 and W4 (qnfo-pdf design fold, containers-pilot lessons to docs, Vectorize qnfo-tasks 111 vectors last written 2026-07-17 and qnfo-notes 5,502 vectors last written 2026-08-10 bound by qnfo-ai, qnfo-infra and qnfo-ops, r2 marking is row 49) had no doer: filed as the ROADMAP-1 row FLEET-BUDGET-W3W4-1 by this migration. fleet_budget today: workers 38/30, vectorize_indexes 10/10 (target 8), r2_buckets 19/20 (target 16).'
WHERE id = 19 AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE reorg_work_queue SET state = 'DONE', evidence = evidence || ' | C6-S3 2026-11-05: DONE. The script is absent from the Cloudflare workers list read 2026-11-05 (38 scripts); roadmap row 20.'
WHERE id IN (67, 68, 69, 70, 71) AND state = 'OPEN' AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE reorg_work_queue SET state = 'CANCELLED', evidence = evidence || ' | C6-S3 2026-11-05: SUPERSEDED by agent_issues 1001906 (WORKER-COUNT-1.6, MCP 2 to 1; qnfo-skills-mcp retired 2026-09-27; qnfo-ai-search stays, qnfo-ops depends on it).'
WHERE id = 24 AND state = 'OPEN' AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE reorg_work_queue SET state = 'CANCELLED', evidence = evidence || ' | C6-S3 2026-11-05: SUPERSEDED by agent_issues 1001904 (WORKER-COUNT-1.4, observability fold); qnfo-kaizen, job-market-watch and qnfo-goal-author are already retired.'
WHERE id = 25 AND state = 'OPEN' AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

UPDATE reorg_work_queue SET evidence = evidence || ' | C6-S3 2026-11-05: doer filed, ROADMAP-1 QNFO.INFRA FLEET-BUDGET-W3W4-1 (qnfo-pdf design fold, containers-pilot lessons to docs, qnfo-ipatent stays a product).'
WHERE id IN (26, 27) AND state = 'OPEN' AND instr(evidence, ' | C6-S3 2026-11-05') = 0;

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'ROADMAP-1: QNFO.INFRA FLEET-BUDGET-W3W4-1: drop the two stale Vectorize indexes (qnfo-tasks, qnfo-notes) and fold or document qnfo-pdf and qnfo-containers-pilot (vectorize_indexes 10 -> 8)',
 'session-task: repo=qnfo-workers path=qnfo-ops/wrangler.toml' || char(10) ||
 'edit-near: index_name = "qnfo-tasks"' || char(10) ||
 'code-probe: {"paths": ["qnfo-ops/wrangler.toml"], "absent": "index_name = \"qnfo-tasks\""}' || char(10) || char(10) ||
 'Charter pillar cost (program QNFO.INFRA); roadmap rows RM-FLEET-BUDGET-WAVES-1 (19) and RM-CONSOLIDATION-WAVE-B-1 (18); reorg_work_queue 26 and 27. Metric it should move: fleet_budget vectorize_indexes current 10 -> 8 (cap 10, target 8); worker_count -1 for qnfo-pdf.' || char(10) ||
 'Evidence (Cloudflare Vectorize API and repository, 2026-11-05): qnfo-tasks holds 111 vectors, last written 2026-07-17T06:00Z; qnfo-notes holds 5,502 vectors, last written 2026-08-10T09:07Z; both are bound by qnfo-ai, qnfo-infra and qnfo-ops (wrangler.toml index_name lines) and qnfo-archive (RETIRED). qnfo-ops-semcache (294 vectors, L1 semantic cache of routing_policy) and qnfo-infra (3 vectors) are live and stay. qnfo-pdf (594 KB with the KaTeX bundle) is called by qnfo-gateway PDF_SVC /math-check, by qnfo-fleet-control SVC_QNFO_PDF /backlog/tick and probed by qnfo-ops; qnfo-research-exec binds PDF_SVC but its worker.js never uses the name. qnfo-containers-pilot (DO ShellContainer) is bound by qnfo-ops and qnfo-research-exec.' || char(10) ||
 'DO (in this order, one PR each, claims first): (1) remove the qnfo-tasks and qnfo-notes bindings from qnfo-ops, qnfo-ai and qnfo-infra wrangler.toml and the code paths that query them (impact on d1t/binding ids first: GET https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/impact?id=binding:qnfo-ops.<NAME>), deploy, then cf-ops-actions delete-vectorize-index (VECTORIZE_RETIRED list in scripts/cf_ops_actions.py, backup of the vector ids first); (2) remove the unused PDF_SVC binding from qnfo-research-exec/wrangler.toml; (3) design note for folding qnfo-pdf into qnfo-gateway (its main caller) without the personal/research crossing, tracked next to WORKER-COUNT-1; (4) migrate the ShellContainer lessons of qnfo-containers-pilot into docs and keep the DO class.' || char(10) ||
 'Definition of done: merged and verified live: the Vectorize API no longer lists qnfo-tasks and qnfo-notes, fleet_budget vectorize_indexes reads 8 at the next hourly census, the code-probe passes; recorded in issue_triage.close_evidence.',
 'session:c6-s3', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA FLEET-BUDGET-W3W4-1%' AND status = 'open');
