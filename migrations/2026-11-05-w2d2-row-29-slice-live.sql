-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET evidence = (SELECT b.evidence FROM bak_20261105_w2d2_row29 b WHERE b.id = 29), verified_at = (SELECT b.verified_at FROM bak_20261105_w2d2_row29 b WHERE b.id = 29) WHERE id = 29; DROP TABLE IF EXISTS bak_20261105_w2d2_row29
-- BACKUP: bak_20261105_w2d2_row29
-- RM-CITATION-TRACKING-ALL-DOIS-1 (roadmap_implementation 29, charter pillar research; session w2d2, 2026-11-05). PR 7791 (qnfo-infra 1.16.1) is merged and live; the row stays partial.
-- Live read 2026-11-05 about 05:40Z: https://qnfo-infra.q08.workers.dev/indexer/stats lists 2 rows (10.64898/2026.07.27.740886 and pending, both score 0, last written 2026-10-17) and no 10.5281 DOI (20 of 20 rows
-- named one before), and carries coverage {"public_papers":728,"eligible_dois":1,"scored_dois":0,"last_collected":null,"scored_window_days":3}.

CREATE TABLE IF NOT EXISTS bak_20261105_w2d2_row29 AS
SELECT id, evidence, verified_at FROM roadmap_implementation WHERE id = 29;

UPDATE roadmap_implementation
SET evidence = evidence || ' | Slice live (PR 7791, qnfo-infra 1.16.1, read 2026-11-05T05:40Z): GET /indexer/stats no longer names any 10.5281 DOI and reports coverage public_papers 728, eligible_dois 1, scored_dois 0, last_collected null, so the measurable set is 1 of 728 public papers and it has not been scored since 2026-10-17 (its DOI appeared in living-paper on 2026-11-04T23:31Z; the 06:30Z slot is the next write). runImpact now counts 429/5xx/timeouts per source, keeps an earlier score when both sources were cut off, and uses OPENALEX_API_KEY when the secret exists (no key minted). Remainder: an identifier-free impact signal for the 727 papers without a DOI (readers: engaged_reader_sessions_7d, paper_readership.ext_30d); no further DOI work is possible while the registrar stays closed.',
    verified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = 29 AND item = 'RM-CITATION-TRACKING-ALL-DOIS-1';
