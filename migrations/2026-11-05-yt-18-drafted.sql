-- YT-18-DRAFTED-1 (2026-11-05, charter pillar reach): the channel packaging text is drafted in docs/YOUTUBE-CHANNEL-PACKAGE.md; applying it in YouTube Studio is the owner's step.
-- IDENTITY-BOUND: a visible change to the owner's own YouTube channel; the OAuth grant has no channel-edit scope.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: UPDATE roadmap_implementation SET evidence = 'IDENTITY-BOUND: a visible change to the owner''s own channel needs the owner''s wording; the channel still shows a 2025 community post and 19 videos with no series identity' WHERE source = 'yt-shorts-2026' AND item = 'YT-18';
UPDATE roadmap_implementation SET evidence = 'text drafted in docs/YOUTUBE-CHANNEL-PACKAGE.md (name, description, links, banner, thumbnail rule); IDENTITY-BOUND: pasting it into YouTube Studio is the owner step, no channel-edit scope in our OAuth grant' WHERE source = 'yt-shorts-2026' AND item = 'YT-18';
