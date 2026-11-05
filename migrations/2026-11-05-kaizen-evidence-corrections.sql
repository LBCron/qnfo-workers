-- KAIZEN-EVIDENCE-CORRECTIONS-1 (2026-11-05, charter pillar: autonomy). Two statements in evidence text written by PR 7407 and PR 7441 were wrong when re-read against the sources:
--   1. roadmap row 63 says the local cron 42b1988c "is retired on the owner machine". Nothing readable from the repository or D1 shows that: no repository path reads the cron, and whether it still exists on the
--      owner machine cannot be read from here. The row now says exactly that.
--   2. the kaizen_candidates evidence of kc-fleet-vs-external-attr-20260926 says cost_source_registry holds "12 rows"; the read on 2026-11-05 returned 11 (fleet 8, external 1, owner-direct 1, owner-clients 1).
-- Merged migrations are never edited (MIGRATION-NO-CLOBBER-1), so the text is replaced by a guarded UPDATE that matches only the wrong wording.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_kaizen_evidence
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.t FROM bak_20261105_kaizen_evidence b WHERE b.tbl = 'roadmap_implementation' AND b.k = '63') WHERE id = 63; UPDATE kaizen_candidates SET evidence = (SELECT b.t FROM bak_20261105_kaizen_evidence b WHERE b.tbl = 'kaizen_candidates' AND b.k = 'kc-fleet-vs-external-attr-20260926') WHERE id = 'kc-fleet-vs-external-attr-20260926';
-- CAUSE-MAPPED: registers no metric_registry row.

CREATE TABLE IF NOT EXISTS bak_20261105_kaizen_evidence AS
SELECT 'roadmap_implementation' AS tbl, CAST(id AS TEXT) AS k, evidence AS t FROM roadmap_implementation WHERE id = 63
UNION ALL
SELECT 'kaizen_candidates', id, evidence FROM kaizen_candidates WHERE id = 'kc-fleet-vs-external-attr-20260926';

UPDATE roadmap_implementation
SET evidence = replace(evidence, 'Device side: the local cron 42b1988c is retired on the owner machine (GUARDS-LOCAL-ONLY-1)', 'Device side: no repository path reads the local cron 42b1988c; whether it still exists on the owner machine cannot be read from here (GUARDS-LOCAL-ONLY-1)')
WHERE id = 63 AND instr(COALESCE(evidence, ''), 'is retired on the owner machine') > 0;

UPDATE kaizen_candidates
SET evidence = replace(evidence, 'cost_source_registry (scope NOT NULL; 12 rows read 2026-11-05)', 'cost_source_registry (scope NOT NULL; 11 rows read 2026-11-05)')
WHERE id = 'kc-fleet-vs-external-attr-20260926' AND instr(COALESCE(evidence, ''), '12 rows read 2026-11-05') > 0;
