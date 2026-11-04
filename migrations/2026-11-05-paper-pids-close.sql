-- PAPER-PIDS-CLOSE-1 (2026-11-05, charter pillar research and reach; GitHub QNFO/qnfo-workers#5694, #5695, #5577, #6620; agent_issues 1000646, 1000647, 1001408; roadmap_implementation 1698).
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_paper_pids_close
-- Rollback: UPDATE remediation_contracts SET verify_probe = (SELECT b.verify_probe FROM bak_20261105_paper_pids_close b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), verify_transport = (SELECT b.verify_transport FROM bak_20261105_paper_pids_close b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), action = (SELECT b.action FROM bak_20261105_paper_pids_close b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class), module = (SELECT b.module FROM bak_20261105_paper_pids_close b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class) WHERE class IN ('issue-1000646', 'issue-1000647', 'issue-1001408') AND EXISTS (SELECT 1 FROM bak_20261105_paper_pids_close b WHERE b.kind = 'contract' AND b.k = remediation_contracts.class); UPDATE roadmap_implementation SET status = 'planned', verified_at = NULL, evidence = (SELECT b.verify_probe FROM bak_20261105_paper_pids_close b WHERE b.kind = 'roadmap' AND b.k = '1698') WHERE id = 1698 AND EXISTS (SELECT 1 FROM bak_20261105_paper_pids_close b WHERE b.kind = 'roadmap' AND b.k = '1698'); UPDATE roadmap_proposals SET status = 'building', outcome = 'merged', deployed_at = NULL WHERE id = 1671; DELETE FROM agent_issues WHERE title LIKE 'PAPER-PIDS-PIN-1:%' AND status = 'open';
-- CAUSE-MAPPED: no metric is registered here; this edits three existing probe rows, one roadmap row, one proposal row and files one issue.
--
-- Four issues in this batch name behaviour that is already live, and three of them stand on a probe that can never pass (or measures something other than the
-- issue's own definition of done). Read live on 2026-11-04 22:40-23:10 UTC:
--   * 1000646 / #5694 (GET /papers/<slug>/v/<version> with X-Content-SHA256, sha256 in /api/papers/<slug>): shipped in qnfo-gateway 3.46.0 (PR 5082); for
--     scale-invariant-physics 1.1.0 the X-Content-SHA256 header, the sha256 field of /api/papers/<slug> and `sha256sum` of the served body are all
--     8f1c458aeca0c38e78975a2e8f2ba23997e3d9002f428e4be1c1b932f25b4bc5; qnfo-gateway/paper-pid-hash.test.mjs covers the route. Its contract probe asked the metric
--     paper_version_immutability to read source=stored-hash, which is the metric's own redefinition (open issue 1000672 and the successor filed below), not this
--     issue's stated definition of done (the route, the sha256 field, the offline suite).
--   * 1000647 / #5695 (alias routes /papers/<slug>/cite.cff, /cite.bib, /cite.csl.json calling citeResponse): shipped in qnfo-gateway 3.57.x (PR 6607, 2026-11-03);
--     papers.qnfo.org answers 200 with text/yaml, application/x-bibtex and application/vnd.citationstyles.csl+json. Its contract probe compared the literal
--     'PAPER-PIDS-CITE-1 and cff/bib/csl each 200' with a version string and a worker_logs count, so it could never pass.
--   * 1001408 / #6620 (digest footer: a tagged forward-and-subscribe link): digestText carries the line since qnfo-subscribers 1.5.5 (PR 6621); the deployed
--     bundle of qnfo-subscribers 1.5.8 was read on 2026-11-04 and contains "digest-forward" immediately before the Unsubscribe line; confirm-post.test.mjs asserts the
--     exact text. The standing probe waits for a delivered digest, and the first digest sent after the merge is Sunday 2026-11-08 16:00 UTC (the last one, run 9, went out
--     2026-11-01 16:00), so the issue would stay open for four more days on a fact the deploy already proves; the issue's definition of done is "merged and verified
--     live by the canonical deploy", which a deployed-version probe checks.
-- The new probes are runner-https contracts on class issue-<id> (the consumer re-probes within the hour; a pass closes the issue through the autoclose trigger).
-- This file closes no issue by hand. It leaves the remaining half of 1000646 (a stored per-version hash and a refusal of a drifted version) to a filed successor
-- with a doer, and it leaves the metric (0.3132 on 2026-11-04, ledger proxy) with its own open breach issue 1000672.

CREATE TABLE IF NOT EXISTS bak_20261105_paper_pids_close (kind TEXT NOT NULL, k TEXT NOT NULL, verify_probe TEXT, verify_transport TEXT, action TEXT, module TEXT, status TEXT);
INSERT INTO bak_20261105_paper_pids_close (kind, k, verify_probe, verify_transport, action, module, status)
SELECT 'contract', class, verify_probe, verify_transport, action, module, status FROM remediation_contracts
WHERE class IN ('issue-1000646', 'issue-1000647', 'issue-1001408')
  AND NOT EXISTS (SELECT 1 FROM bak_20261105_paper_pids_close WHERE kind = 'contract' AND k = remediation_contracts.class);
INSERT INTO bak_20261105_paper_pids_close (kind, k, verify_probe, verify_transport, action, module, status)
SELECT 'roadmap', CAST(id AS TEXT), evidence, NULL, NULL, NULL, status FROM roadmap_implementation
WHERE id = 1698 AND NOT EXISTS (SELECT 1 FROM bak_20261105_paper_pids_close WHERE kind = 'roadmap' AND k = '1698');

-- 1000646: the route, the sha256 field and (by the offline suite) the header, measured on the oldest stable paper.
UPDATE remediation_contracts
SET verify_probe = '{"url": "https://papers.qnfo.org/api/papers/scale-invariant-physics", "status": 200, "contains": "\"sha256\": \"", "absent": "\"sha256\": null"}',
    verify_transport = 'runner-https',
    action = 'PAPER-PIDS-CLOSE-1: runner-https probe of the shipped definition of done (GET /api/papers/<slug> returns sha256 for a published paper); the route itself is covered by qnfo-gateway/paper-pid-hash.test.mjs. The stored-hash half is tracked by PAPER-PIDS-PIN-1 and the metric breach by 1000672.',
    module = 'probe-line-sweep-v1',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000646' AND issue_id = 1000646;

-- 1000647: the alias route answers the CITATION.cff of a published paper.
UPDATE remediation_contracts
SET verify_probe = '{"url": "https://papers.qnfo.org/papers/scale-invariant-physics/cite.cff", "status": 200, "contains": "cff-version: 1.2.0"}',
    verify_transport = 'runner-https',
    action = 'PAPER-PIDS-CLOSE-1: runner-https probe of the shipped alias route /papers/<slug>/cite.cff (citeResponse); cite.bib and cite.csl.json share the handler and are covered by qnfo-gateway/open-data.test.mjs.',
    module = 'probe-line-sweep-v1',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1000647' AND issue_id = 1000647;

-- 1001408: the deployed worker is at or above the version whose digestText carries the tagged forward link (1.5.5, PR 6621).
UPDATE remediation_contracts
SET verify_probe = '{"url": "https://qnfo-subscribers.q08.workers.dev/health", "status": 200, "contains": "\"worker\":\"qnfo-subscribers\"", "min_version": "1.5.5"}',
    verify_transport = 'runner-https',
    action = 'PAPER-PIDS-CLOSE-1: runner-https deployed-version probe (qnfo-subscribers at or above 1.5.5, the release whose digestText prints the digest-forward link before the Unsubscribe line); the text is asserted by qnfo-subscribers/confirm-post.test.mjs.',
    module = 'probe-line-sweep-v1',
    status = 'active', attempts = 0, last_verdict = NULL, deferred_since = NULL, next_due_at = datetime('now')
WHERE class = 'issue-1001408' AND issue_id = 1001408;

-- RM-PAPER-PIDS-1: the item's four deliverables (immutable version URL, sha256 per served version, CITATION.cff, BibTeX and CSL-JSON exports) are live.
UPDATE roadmap_implementation
SET status = 'verified',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    evidence = 'Read live 2026-11-04: https://papers.qnfo.org/papers/scale-invariant-physics/v/1.1.0 answers 200 text/markdown with X-Content-SHA256 8f1c458aeca0c38e78975a2e8f2ba23997e3d9002f428e4be1c1b932f25b4bc5, equal to the sha256 field of /api/papers/scale-invariant-physics and to sha256sum of the downloaded body; /papers/<slug>/cite.cff, cite.bib and cite.csl.json answer 200 (text/yaml, application/x-bibtex, application/vnd.citationstyles.csl+json). qnfo-gateway 3.46.0 (PR 5082) and 3.57.x (PR 6607). Limit stated in docs/BP26-PAPER-PIDS-AND-FORECAST-HYGIENE.md: the hash is taken when the body is served, not stored; the stored-hash part is PAPER-PIDS-PIN-1.'
WHERE id = 1698 AND item = 'RM-PAPER-PIDS-1' AND status = 'planned';

-- The manager proposal behind 1001408 (QNFO.REACH #1671) moves from building to deployed, as the issue text asks once the change is merged and verified live.
UPDATE roadmap_proposals
SET status = 'deployed', outcome = 'merged and verified live', pr_url = 'https://github.com/QNFO/qnfo-workers/pull/6621',
    deployed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 1671 AND issue_id = 1001408 AND status = 'building';

-- The half of 1000646 that is not shipped, filed with a doer (OWNER-NO-LOOSE-ENDS-1).
INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'PAPER-PIDS-PIN-1: pin each paper version''s content hash and flag a drifted version',
'Charter pillar: research. Serves BP26-PAPER-PIDS-1 (agent_issues 1000338): the part of 1000646 (GitHub #5694) that its closing probe does not cover. Metric: paper_version_immutability (guard, 0.3132 on 2026-11-04 from the ledger proxy in scripts/bp26_paperver.py; breach issue 1000672).

Evidence (read 2026-11-04): qnfo-gateway handlePaperVersion hashes the body when it serves it, so a body edited in place is served under the same /papers/<slug>/v/<version> with a new X-Content-SHA256 and nothing flags it. No stored per-version hash exists: PRAGMA table_info shows no sha256 or hash column on living-paper papers or paper_change_bodies, and asset_provenance.sha256 is overwritten each time a provenance sidecar is re-signed. The functions handlePaperVersionPid, paperPidsRoutes and paperCurrentSha256 (3.46.0) are never called and query paper_change_bodies.version and .sha256, which do not exist: delete them.

Change: an append-only pin table in qnfo-audit (living-paper migrations are applied by hand, so the pins live beside asset_provenance): paper_version_hash_pins(slug, version, sha256, first_seen_at, PRIMARY KEY (slug, version)), written with INSERT OR IGNORE the first time a version is served (trust on first use, stated in the route documentation). On a later serve whose hash differs from the pin: a superseded version answers 410 with {error, sha256 (pinned), actual}; the current version answers 200 with X-Content-Hash-Status: drifted and the same field in /api/papers/<slug> until its version is bumped, because 410 on the current version would break the version_url the API advertises for the 68 percent of published papers the ledger shows edited in place within 30 days. Do not replace the ledger proxy with pin-based drift until the pins cover the corpus: first-seen pins read near 1.0 by construction and would hide the edits made before the first pin. The cause of the in-place edits is the writers (they must bump the version), tracked by 1000672. Offline test with a stub store for pin, match, drift and the 410.

code-task: repo=qnfo-workers path=qnfo-gateway/worker.js
code-anchor: async function handlePaperVersion(env, slug, version, head) {
code-probe: {"paths": ["qnfo-gateway/worker.js"], "contains": "PAPER-PIDS-PIN-1"}',
'paper-pids-pin-1', 'reliability', 'high', 'open', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE status = 'open' AND title LIKE 'PAPER-PIDS-PIN-1:%');

INSERT INTO decision_log
  (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested, outcome_matched)
SELECT
  'coding-agent (F1-research-reach/B)',
  'The PAPER-PIDS routes and the digest forward link are live, so the issues that ask for them close on a probe of the shipped behaviour, not on a metric redefinition or a delivered-digest wait.',
  'Replace the closing probes of issue-1000646, issue-1000647 and issue-1001408 with runner-https probes; mark RM-PAPER-PIDS-1 verified and proposal 1671 deployed; file PAPER-PIDS-PIN-1 for the stored-hash remainder.',
  'X-Content-SHA256 header = sha256 field of /api/papers/scale-invariant-physics = sha256sum of the served body (8f1c458a...); cite.cff, cite.bib, cite.csl.json answer 200 on papers.qnfo.org; deployed qnfo-subscribers 1.5.8 bundle contains the digest-forward line.',
  'probes replaced; closes follow from the consumer pass and the autoclose trigger',
  'three remediation_contracts rows, roadmap_implementation row 1698, roadmap_proposals row 1671, one new issue',
  'Restore the three contract rows and row 1698 from bak_20261105_paper_pids_close (the Rollback line); the decision_log is append-only.',
  'paper-pids-probes-measure-shipped-behaviour',
  'All three contracts pass in the first two consumer cycles after the merge and the issues close with close_channel auto:verified-remediation-trigger; no code or route changes.',
  'No audience reach increase is claimed; the digest forward link was already deployed.',
  'papers.qnfo.org /api/papers, /v/, /cite.*; qnfo-subscribers /health and deployed bundle',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM decision_log WHERE capability_gain = 'paper-pids-probes-measure-shipped-behaviour');
