-- YT-17-BUILT-1 (2026-11-04, charter pillar reach): roadmap row YT-17 is built by qnfo-youtube-shorts 0.5.1 (rankByInterest). Live proof: the next started Short's slug has the highest
-- paper_readership ext_30d among the 40 newest unmade plain articles; the cap (2 a week) means the next start is about 2026-11-10.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET status = 'planned' WHERE source = 'yt-shorts-2026' AND item = 'YT-17';
UPDATE roadmap_implementation SET status = 'built', evidence = 'qnfo-youtube-shorts 0.5.1: rankByInterest orders the 40 newest unmade plain articles by paper_readership ext_30d then pv_30d (newest first with no data); unit test in youtube-shorts.test.mjs; live proof pending the next started Short' WHERE source = 'yt-shorts-2026' AND item = 'YT-17';
