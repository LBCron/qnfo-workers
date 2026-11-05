-- F2 follow-up (2026-11-05, charter pillar reach): the YT-18 channel packaging is now drafted (docs/YOUTUBE-CHANNEL-PACKAGE.md, PR 7406), so the owner card yt-channel-branding-owner asks for five minutes in YouTube Studio or the word keep, not for wording from scratch.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- BACKUP: bak_20261105_f2_yt_card
-- Rollback: UPDATE human_actions SET action = (SELECT b.action FROM bak_20261105_f2_yt_card b WHERE b.slug = human_actions.slug), default_in_effect = (SELECT b.default_in_effect FROM bak_20261105_f2_yt_card b WHERE b.slug = human_actions.slug) WHERE slug IN (SELECT slug FROM bak_20261105_f2_yt_card)
-- CAUSE-MAPPED: registers no metric_registry row.
-- The card keeps its IDENTITY-BOUND line (the channel is the owner's own account and name; the OAuth grant has no channel-edit scope). Its contract owner-card-yt-branding still closes on ops_config yt_channel_branding.
CREATE TABLE IF NOT EXISTS bak_20261105_f2_yt_card AS
SELECT slug, action, default_in_effect FROM human_actions WHERE slug = 'yt-channel-branding-owner';

UPDATE human_actions
SET action = 'The wording is drafted in docs/YOUTUBE-CHANNEL-PACKAGE.md: channel name "QNFO in plain language" (keep the @rwnquni handle), a description, two links, banner text and a thumbnail rule. Either paste it into YouTube Studio > Customisation (about five minutes; the Shorts uploader has no channel-edit scope, so only you can), or reply in the fleet prompt panel at https://fleet.qnfo.org with the word keep or your own wording. Tell the panel when you have applied it. The fleet records the answer in ops_config yt_channel_branding (applied, keep, or your wording) and the card closes when that key is set.',
    default_in_effect = 'The channel stays as it is; Shorts keep the tag QNFO IN PLAIN LANGUAGE on screen and the channel context in each description; the drafted package stays in docs/YOUTUBE-CHANNEL-PACKAGE.md.',
    updated_at = datetime('now')
WHERE slug = 'yt-channel-branding-owner' AND status = 'open' AND source = 'session:F2' AND instr(action, 'docs/YOUTUBE-CHANNEL-PACKAGE.md') = 0;
