-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'not-built', evidence = 'VSM S3 / OODA act | backlog mining 2026-09-30 (reconciled with master backlog v2)', verified_at = NULL WHERE id = 115 AND item = 'RM-ADR-013-014-ENFORCEMENT-1'; the append-only decision and session rows stay
-- RM-ADR-013-014-ENFORCEMENT-1 (roadmap_implementation 115, charter pillar security; session w2d2, 2026-11-05). Row set to partial after the live reads below (VERIFY-LIVE-1); PR 7699 built it, this file records what was read.
UPDATE roadmap_implementation
SET status = 'partial',
    evidence = 'PR 7699 (qnfo-lifecycle 1.19.0, living-paper migration, qnfo-audit migrations) merged and live, read 2026-11-05T05:03Z: migration_runs 1461, 1463 and 1464 ok; living-paper holds paper_ledger_chain, its three triggers, v_paper_ledger_chain_status, v_paper_ledger_chain_breaks, v_paper_ledger_chain_body_breaks, adr_enforcement (mode observe), adr014_publish_audit, trg_papers_adr014_publish_ins and _upd, v_adr014_authorship_status; the 05:00Z lifecycle tick sealed 500 of 3191 ledger rows (head seq 500, sha256:c6e98a83...), anchored it as paper_ledger_seals id 1 in qnfo-audit, and GET https://qnfo-lifecycle.q08.workers.dev/paper-ledger/chain?verify=1 re-computed 50 rows and 1 anchor with 0 breaks; metrics paper_ledger_chain_breaks 0, paper_ledger_unsealed_min 0, adr014_new_publication_violations 0, adr014_legacy_byline_papers 276 (MEASURED); the catch-up seals 500 rows an hour. ADR-014: 276 of 725 public papers carry an organisation byline (all first published 2025-01-01 to 2026-08-04), 0 since 2026-09-02; the publish check runs in observe mode. Found: both ADR texts in R2 are 310 bytes of failed-download output (card adr-013-014-text-restore). Open, each with a doer and a probe: PAPER-LEDGER-SIGN-1 (1002060, HMAC signature, needs the signing key), ADR014-ENFORCE-PROMOTE-1 (1002061), ADR014-LEGACY-BYLINE-1 (1002062), ADR013-ULA-PIN-1 (1002063, licence versions), ADR-TEXT-PROBE-1 (1002059). Not covered yet: signed ledger, artifact types other than papers, enforce mode.',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 115 AND item = 'RM-ADR-013-014-ENFORCEMENT-1';

INSERT INTO session_records
  (session_id, wbs_code, agent_name, summary, decisions_made, files_changed, commits, infrastructure_changes,
   handoff_notes, execution_ratio, total_tasks, completed_tasks, started_at, completed_at, created_at)
SELECT
  'w2d2-20261105', 'QNFO.RSCH', 'claude-agent-w2d2',
  'Roadmap rows 115 (ADR-013/014 enforcement) and 29 (citation tracking). Built and verified live a hash chain over the paper ledger with a cross-database anchor, a verification route and four metrics, plus an observe-mode ADR-014 publish check; diagnosed row 29 (premise obsolete, collector healthy, a public route still serves dead DOIs) and filed its doer.',
  'Host the sealer in qnfo-lifecycle because qnfo-cloud-ops and qnfo-infra worker.js were claimed; enforce the rule the fleet states in code (the ADR texts in R2 are unreadable), forward only: the 276 legacy organisation bylines are listed and left until the paper is next revised; publish check ships in observe mode with a one-statement switch; no signing key is used or minted.',
  'migrations/living-paper/2026-11-05-w2d2-paper-ledger-chain.sql; migrations/2026-11-05-w2d2-paper-ledger-seals.sql; migrations/2026-11-05-w2d2-adr-enforcement.sql; migrations/2026-11-05-w2d2-citation-tracking.sql; migrations/2026-11-05-w2d2-row-115-status.sql; qnfo-lifecycle/worker.js; qnfo-lifecycle/paper-ledger-chain.test.mjs; docs/PAPER-LEDGER.md',
  'PR 7699 (merged), PR 7707 (merged), follow-up PR for the route and this status file',
  'living-paper: paper_ledger_chain, adr_enforcement, adr014_publish_audit, 7 triggers, 5 views; qnfo-audit: paper_ledger_seals, 4 metrics, 2 failure modes, 2 contracts, 2 controls, 5 issues, 1 owner card; qnfo-lifecycle 1.19.0 and 1.19.1',
  'Row 115 is partial: the chain is live and sealing 500 rows an hour (500 of 3191 at 05:03Z, caught up by about 11:00Z); open items are the signing key slice, enforce mode, the legacy bylines, licence-version pins and the ADR text card, each filed with a doer and a probe. Row 29 stays partial: qnfo-infra/worker.js was claimed by two sessions, so CITATION-TRACKING-1 (1002056) carries the stats-route fix.',
  0.83, 6, 5, '2026-11-05T03:40:00Z', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM session_records WHERE session_id = 'w2d2-20261105');
