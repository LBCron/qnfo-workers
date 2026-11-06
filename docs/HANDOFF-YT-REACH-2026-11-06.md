# Handoff: YouTube Shorts design, narration, LinkedIn and reach (2026-11-06)

Written because the owner's weekly usage ran low; any later session continues from here. Canonical record: agent_issues (qnfo-audit) titled YT-REACH-HANDOFF-1.

## Done in this PR (qnfo-youtube-shorts 0.8.0-reach)
Pacing and upload-limit cooldown (YT-PACE-1), description rewrite (YT-META-1), social.json per Short (YT-LINKEDIN-1), narration rules. Tests: `node --test qnfo-youtube-shorts/youtube-shorts.test.mjs` (36 pass).

## Evidence read 2026-11-06
- 7 Shorts uploaded 02:00 to 08:00Z, the 09:00Z one refused: `uploadLimitExceeded`.
- All uploaded Shorts have NULL views and retention: the OAuth app is in Testing with the upload scope only (owner cards yt-oauth-publish, yt-oauth-production-and-analytics).
- GA4 engaged sessions by channel, 10 days: x 17 of 19, linkedin 5 of 20, bluesky 1 of 22, substack 0 of 110, mastodon 0 of 9 (agent_issues 1001820).
- Channel `@rwnquni`: 2 subscribers on 2026-11-04.

## Remaining, in priority order
1. YT-SCENE-VARIETY-1 (issue 1001963): templates 11 to 15 in container/short_scene.py (timeline, scale ladder, before-after, formula card), per-paper transitions and visual identity. Needs a machine with manim 0.22.0 to render one Short per template; it was not done here because the render could not run in this session.
2. YT-VOICE-RETRY-1 (issue 1001978): choose Aura only after a Kokoro render failure (ttsEngine).
3. LinkedIn native video: qnfo-social must read youtube/<id>/social.json and attach short.mp4 through Buffer (LinkedIn mode and API shape unverified here), with the YouTube link in the first comment where Buffer allows it.
4. REACH-FOCUS-1.1 (issue 1001820): per-channel composer; X is the only channel that converts today.
5. Owner steps (IDENTITY-BOUND): publish the OAuth app and consent (views and retention data), channel name, banner and description (docs/YOUTUBE-CHANNEL-PACKAGE.md).

## Reach levers
Measure: publish the OAuth app so views and retention are readable, then let the learner drop what does not hold viewers.
Fewer, better: YouTube can treat mass-produced templated video as low-value; cap daily output and raise variety before raising volume.
Hook: the first 2 seconds decide Shorts retention; the first beat is already large-type hook text.
Native video on X and LinkedIn instead of links; the link goes in the first comment or reply.
Put the Short on the paper page (UX-JOURNEY-1) with VideoObject markup and the transcript, so Google indexes it and the page links back to the channel.
Audio podcast feed from the same narrations (TTS exists).
Same 9:16 file to Instagram Reels and TikTok through Buffer if those channels are connected.
Personal first-person LinkedIn notes from the owner, a few a week; people engage with people, and the owner does not respond to machine-written messages himself.
Comment on and reply to authors and small accounts in the same fields, manually and by consent; no bulk cold email (GDPR, reputation).
Playlists by topic, an end-card subscribe line, and a pinned comment on each Short.
