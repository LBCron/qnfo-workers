-- APPLY-BY: ci
-- DB: living-paper
-- Rollback: DROP VIEW IF EXISTS v_paper_provenance_coverage; DROP VIEW IF EXISTS v_paper_provenance_records;
-- PAPER-PROVENANCE-TRACE-1: expose each public paper's saved trace and measure rolling seven-day coverage.

CREATE VIEW v_paper_provenance_records AS
WITH metadata_rows AS (
  SELECT l.slug, l.seq, b.metadata
  FROM paper_change_ledger l
  JOIN paper_change_bodies b ON b.seq = l.seq
  WHERE b.metadata IS NOT NULL
  UNION ALL
  SELECT l.slug, l.seq, a.metadata
  FROM paper_change_ledger l
  JOIN paper_change_body_archive a ON a.seq = l.seq
  WHERE a.metadata IS NOT NULL
),
ranked_metadata AS (
  SELECT slug, seq, metadata,
         ROW_NUMBER() OVER (PARTITION BY slug ORDER BY seq DESC) AS rn
  FROM metadata_rows
  WHERE json_valid(metadata)
)
SELECT p.slug, p.status, p.first_published_at, p.created_at,
       m.seq AS provenance_seq, m.metadata,
       CASE WHEN m.metadata IS NOT NULL THEN 1 ELSE 0 END AS has_provenance
FROM papers p
LEFT JOIN ranked_metadata m ON m.slug = p.slug AND m.rn = 1
WHERE p.slug IS NOT NULL
  AND p.status IN ('published', 'distributed', 'external_preprint');

CREATE VIEW v_paper_provenance_coverage AS
SELECT COUNT(*) AS new_public_papers_7d,
       COALESCE(SUM(has_provenance), 0) AS papers_with_provenance_7d,
       CASE WHEN COUNT(*) = 0 THEN NULL
            ELSE ROUND(100.0 * SUM(has_provenance) / COUNT(*), 2)
       END AS coverage_pct_7d
FROM v_paper_provenance_records
WHERE datetime(COALESCE(first_published_at, created_at)) >= datetime('now', '-7 days');
