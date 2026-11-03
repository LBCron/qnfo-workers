# YouTube pipeline from plain-language papers (YT-POC-1)

Charter pillar: `reach`. Status: proof of concept, run locally on one paper (2026-10-27). Nothing is uploaded.

## What exists
`scripts/youtube_poc/make_video.py <slug>` turns a paper's plain-language article (`papers.qnfo.org/papers/<slug>/quickread`, PLAIN-ARTICLE-1) into
`video.mp4` (1920x1080, narrated), `captions.srt`, `metadata.json` (title, description with chapters and source links, `containsSyntheticMedia: true`,
`privacyStatus: private`). Stages: fetch, scene script (hook = the short version, one scene per plain section, outro with link), edge-tts per sentence
(exact timing without alignment), Pillow frames, ffmpeg (imageio-ffmpeg binary) concat. Cost: $0, no API key.

Measured on `institutionalized-unfalsifiability-...`: 7 scenes, 3 min 38 s, 3.9 MB, h264 + aac, about 1 minute to build.

## Tool research (searched 2026-10-27)
| Option | License | Verdict |
|---|---|---|
| ffmpeg + Pillow (used) | LGPL/HPND | Fewest moving parts; enough for text cards. Chosen for the POC. |
| Remotion | source-available, paid for companies of 4+ | Best motion graphics, but licence cost and a Node/Chromium render step |
| Motion Canvas / Revideo | MIT | Good for animated diagrams; Revideo now follows a commercial product |
| MoviePy 2.x | MIT | Fine, slower, breaking changes between 1.x and 2.x |
| HyperFrames (HTML/GSAP + Kokoro) | open | Strong second step: animate the same scenes from HTML |
| MoneyPrinterTurbo / ShortGPT | MIT | Stock-footage "faceless" generators; the very format YouTube's inauthentic-content policy targets. Not used |
| TTS: edge-tts (used), Kokoro-82M, Piper | free / Apache | edge-tts is cloud and unofficial; Kokoro or Piper run offline and remove that dependency |

## Best practices that shaped it
- Source is the paper's own plain text; no new claims are generated, so nothing needs a second fact check beyond PLAIN-ARTICLE-1's verifier.
- Hook in the first sentence (the short version), chapters, captions file, link to the full article in the description.
- YouTube's "inauthentic content" policy (renamed July 2025) targets templated, mass-produced, low-effort video; channel-level detection is reported,
  and 16 mass-AI channels were reported terminated in January 2026 (third-party reports, not YouTube's own pages: verify before launch). Synthetic
  narration should be disclosed; the pipeline sets the flag.

## Update 2026-10-27: vertical Shorts with generated diagrams (YT-POC-2)
Owner feedback: text over slides is not engaging; start with TikTok-style Shorts and prove upload end to end.

GitHub survey (stars and push date read from the API today): MoneyPrinterTurbo (135k, MIT, active) and short-video-maker (1.4k, MIT, idle since 2025-06)
both put TTS and captions over *stock footage*: the look YouTube's inauthentic-content policy targets, and unrelated to a paper's argument.
ShortGPT (8k, idle) the same. For explainers the better fit is **Manim** (41.9k, MIT, active): it animates the paper's own idea (bars, meters, populations
changing). Remotion (68k) and Motion Canvas (19.5k, MIT) are the alternatives; HyperFrames/Kokoro for later. Word-timed captions come free from
edge-tts `WordBoundary` (no Whisper pass needed; whisper.cpp/WhisperX only if a non-edge voice is used).

Built: `directors/<name>.json` (7 beats: narration + one diagram template each) -> `make_short.py` (TTS with word times, Manim render of
`short_scene.py` at 1080x1920/30 fps, ASS karaoke captions with the spoken word highlighted, ffmpeg mux, `metadata.json` with #Shorts and the AI
disclosure) -> `upload_youtube.py` (YouTube Data API v3 resumable upload, private by default). Result: a 48 s short, 2.9 MB.
Visible "AI-GENERATED NARRATION" tag on every frame (BP26-AI-ACT-ART50-1).

Gaps: the director spec is hand-written for this paper; production needs an LLM director (qnfo-ai, a kimi-k2.6 writer plus a checker that every
number and claim in the narration appears in the plain article) choosing among the six templates. Six templates fit a game-theory paper; other
papers need more (timeline, flow, comparison). Upload needs a Google OAuth client (`client_secret.json`) and one browser consent by the channel
owner; an unaudited API project may upload private videos only until it passes the YouTube API compliance audit.

## Known weaknesses (honest)
1. The video is a text slideshow. This is the template look that policy and viewers punish. Next step: one generated diagram or illustrated scene per
   section, animated captions (word-level via edge-tts WordBoundary), a varied title card, a human-written opener.
2. Plain-article coverage is 25.9 % (184 of 710 papers, `_audit/quick-read` on 2026-10-27), so only covered papers can be made.
3. The fetch parses HTML class names (`qa-short`, `qa-sec`); a gateway markup change breaks it. Fix: expose `/api/plain/<slug>` JSON in qnfo-gateway.
4. No retention data exists. Measure before scaling: 5 videos, then average view duration and click-through per video.

## Path to automation (not built)
1. Gateway JSON endpoint for the article (removes weakness 3).
2. A runner outside Workers (GitHub Actions or a container; Workers cannot run ffmpeg) triggered by new `plain_article` rows, one video per paper, capped at a
   human-plausible cadence (2 a week) to stay clear of the inauthentic-content policy.
3. Upload by the YouTube Data API `videos.insert` as `private`, with `captions.insert`. The OAuth consent for the channel is owner-only (identity-bound):
   one card with an `IDENTITY-BOUND:` line. Publishing public stays a human click until retention data justifies otherwise.
4. Add `youtube_videos_30d` and average view duration to `metric_registry` with a trigger, in the PR that ships the runner.

## Server-side design (owner directive 2026-10-27: "all of this needs to run 100% server-side on Cloudflare Quniverse")
Proven locally: fetch, TTS, Manim render, captions, mux, upload (private Short `D6JC7fWWXns`, 2026-10-27, OAuth client `qnfo-youtube-uploader` in the QWAV project,
`rwnquni@gmail.com` as its test user). Nothing below is built yet. Workers cannot run ffmpeg or Manim, so the render step is a Cloudflare Container.

| Step | Local POC | Cloudflare replacement |
|---|---|---|
| Trigger | manual | worker cron (CRON-SINGLE-TRIGGER-1): newest `plain_article` row (status ok) with no `youtube_videos` row; cap 2 a week |
| Director (beats JSON) | hand-written | qnfo-ai writer (kimi-k2.6) + checker from another family; every number in a beat must occur in the article body, else the beat is dropped |
| TTS + word times | edge-tts (Microsoft cloud) | Workers AI TTS (`@cf/myshell-ai/melotts` or Deepgram Aura). Word times are not returned: align in the container (whisper.cpp tiny) or split by sentence |
| Render | Manim + ffmpeg on a laptop | Cloudflare Container (python 3.12, manim, pango/cairo, ffmpeg), driven by the worker through a Durable Object; output to R2 |
| Upload | `upload_youtube.py` | the worker calls `videos.insert` (resumable) from R2 with an access token refreshed from a Worker secret |
| Ledger | none | D1 `youtube_videos` (slug, rev, video id, privacy, created_at, views later) and a `metric_registry` row with trigger |

Constraints found, not assumed:
- **Refresh token lifetime:** an OAuth app in "Testing" mode issues refresh tokens that expire after 7 days. The app must be set to "In production" (unverified is allowed for
  the owner's own channel, with the warning screen) before a token is stored, or the automation stops weekly. Not yet done.
- **Secrets:** the refresh token and client secret go in as Worker secrets under the secret-lock lease (`/secret-lock/acquire`), never in git or D1. The local copies are
  `~/yt-client.json` and `~/yt-token.json`; delete them after the move.
- **Containers fragility:** qnfo-containers-pilot lost its bindings once (CONTAINER-CONFIG-RESTORE-*). The new worker needs its own `[[containers]]` block, a
  `deploy-*.yml` that verifies `/status`, and a second path (render in a GitHub runner) per ANTIFRAGILE-1.
- **Charter:** new worker directory needs `# charter-pillar: reach` and a named same-class retirement (net-zero rule); AI-label and provenance (BP26-AI-ACT-ART50-1,
  BP26-PROVENANCE-MARKING-1) are part of the render, not an addition.
- **Visibility (owner directive 2026-10-27, "ALL VIDEOS/SHORTS SHALL BE PUBLIC BY DEFAULT"):** the worker uploads `public` (PRIVACY in worker.js). YouTube forces `private` on
  videos from an API project that has not passed the YouTube API compliance audit, so the privacy YouTube returns is what `youtube_videos.privacy` stores; the audit form is an
  owner act (identity-bound). This supersedes "Shorts stay private until the owner reviews" below.
- **Channel:** the target is the owner's existing personal channel (2 subscribers, one 2025 community post). Aligning its name, banner and description with the
  content is a visible account change and needs the owner's wording; Shorts stay private until the owner reviews the first batch.

## Update 2026-10-28: overflow, voice, variety (YT-POC-3)
Owner feedback: text bleeds off screen, the voice is robotic, every video has the same template and visuals.
- **Overflow:** every Manim `Text` is fitted to a 7.6-unit safe width and each beat group to 8; captions are measured in the real font (Segoe UI Bold) and chunked to
  at most 4 words and 880 px, breaking at commas and sentence ends (edge-tts word events carry no punctuation, so `punctuate()` restores it from the narration).
  Layout keeps the top 1.6 and bottom 4.3 units clear for the Shorts UI; captions sit at MarginV 520.
- **Voice:** default `en-US-AndrewMultilingualNeural` (per-director `voice`; Ava also tested), rate +4 % for short-form pace, `speakable()` normalises dashes and symbols,
  directors are written for the ear (contractions, short sentences, commas and `?` for inflection, no spoken URLs), trailing silence cut, audio chain
  highpass + compressor + loudnorm -16 LUFS. Not yet compared by ear against Kokoro-82M (best open model in 2026 reviews, no word times: needs an alignment pass) or ElevenLabs.
- **Variety:** five themes (palette + animated background: bubbles, grid, rings, waves, stars) picked from the slug hash or `theme_name`; ten templates (added `bignum`,
  `flow`, `compare`, `list`); varied exits and a slow push-in during holds. Second example: `directors/brain-as-filter.json` (violet, flow/list/compare/bignum).
- Research basis (vendor blogs, treat figures as rules of thumb): hook in 2-3 s, sentences under 15 words, 30-45 s beats 60 s when the idea fits, a visual change every
  few seconds, captions in the safe zone, native 9:16, a second hook at the end instead of "subscribe", edit AI drafts before publishing.
- Gap: render is slow (about 9 min for 64 s; `always_redraw` text and updater backgrounds). Content clusters in the upper half; vertical centring is next.

## Analytics re-consent helper (#5479)

`qnfo-youtube-shorts` 0.4.0 adds two authenticated POST endpoints. Both require
the existing `x-run-token` (`YT_RUN_TOKEN`); neither exposes `YT_CLIENT_SECRET`.
They use the OAuth client already stored in Worker secrets, so no local client
JSON or Google console credential retrieval is needed.

1. POST `/oauth/consent` with `{}` (or `{"redirect_uri":"http://localhost:8765/"}`).
   The Desktop app client requires an HTTP loopback root redirect; its port may
   be changed. The response contains `url` and `state`, valid for 10 minutes.
   The URL requests `youtube.upload`, `youtube.readonly`, and
   `yt-analytics.readonly`, with `access_type=offline`, `prompt=consent`, and PKCE.
2. Google account consent remains **IDENTITY-BOUND**: the helper does not sign in
   or consent as the owner. After consent, collect `code` and `state` from the
   loopback redirect. Check that the returned state matches the consent response.
3. POST `/oauth/exchange` with `{"code":"<code>","state":"<returned state>"}`.
   The Worker validates the signed, expiring state, exchanges the code with the
   stored client secret and matching PKCE verifier, and checks every required
   scope and the presence of a refresh token. Partial consent is not success.
4. The authenticated, `no-store` response contains the new `refresh_token`.
   Keep it out of logs and git. Installation is deliberately separate:
   acquire the deploy-guard secret-lock lease for `qnfo-youtube-shorts`, put
   `YT_REFRESH_TOKEN` using the existing authorized secret installer, release the
   lease, and re-probe. No secret write is performed by these endpoints.
5. After canonical deployment and the hourly retention read, verify `/status`
   contains numeric `views` for `rhJc9xSP4fs` or `oQhsQVYanU8`. A successful code
   exchange or a merged PR alone does not close #5479.

Regression checks: `node --test qnfo-youtube-shorts/*.test.mjs`.
The existing uploader, analytics read, and cron are unchanged. Reverting the
Worker change and its mirror removes the helper; it does not revoke a Google
grant or revert a separately installed secret.

## Survey 2026-10-28: GitHub video-generator topic (stars, licence, last push read from the GitHub API today; fit is judgement from READMEs, code not audited)
| Project | Stars / licence / push | Fit |
|---|---|---|
| ViMax (HKUDS) | 12.8k / MIT / 2026-09-30 | **Pattern to copy**: screenwriter -> director -> producer agents. Our missing piece is the LLM director; borrow the staging, not the generative-video backend. |
| Agnes Video Generator | 0.6k / MIT / 2026-10-28 | Closest to our shape (multi-scene, narration, subtitles, web UI). Small and young: read for scene-spec ideas, do not depend on it. Avatars add nothing for papers. |
| Open Generative AI | 31.7k / MIT / 2026-10-24 | Studio that fronts third-party models and paid APIs ("unrestricted"). No fit: no diagram accuracy, spend outside the fleet, brand-risk. |
| Wan 2.2 | 18.2k / Apache-2.0 / 2026-09-21 | Best open diffusion video model here. Needs a GPU (no Cloudflare Container GPU in our setup) and cannot draw a correct bar chart or a number. Only candidate: 3-5 s abstract hook b-roll, after the director exists. |
| VideoCrafter / VGen | 5.1k NOASSERTION / 3.2k no licence | Older (last push 2026-01 / 2025-01), no licence clarity. Skip. |
| Kokoro-82M | 9.7k / Apache-2.0 / 2025-08 | Voice A/B candidate; no word times, so needs a whisper alignment pass. |
Decision: scientific shorts stay deterministic (Manim: every number on screen comes from the paper); generative video is at most decoration for the hook.

Next, in order: (1) LLM director with numeric-claim checker (qnfo-ai writer + other-family checker, beats must cite article sentences); (2) five more templates driven by the director; (3) Kokoro vs edge voice blind test by the owner; (4) publish 5 private shorts, read retention, then decide on generative hooks.

## Update 2026-10-28: LLM director and roadmap (YT-POC-4)
`scripts/youtube_poc/make_director.py <slug>` writes the beats JSON from the plain article: qnfo-ai writer (open endpoint, model `qnfo`; it reasons first, so max_tokens 24000 and
2-4 min per call; 429s back off), then a deterministic gate (known template, required fields, string lengths, sentences of at most 18 words, no spoken URL, **every number in
narration, labels and bignum values must occur in the article**, digits or words), then an LLM fact-check of each beat against the article. A failing beat is dropped and listed in
`<name>.report.json`; if the hook or too many beats fall, the writer is re-prompted with the checker's reasons (up to 4 rounds). Offline test: `test_director_checks.py`.
First run (bqp paper): the checker rejected the hook for dropping the "with a looser error budget" qualifier, which is the gate doing its job.
Roadmap rows YT-7..YT-13 (quality pass built, director built, voice test, template library, render speed, generative hooks parked, provenance) are in
`migrations/2026-10-28-yt-shorts-quality-roadmap.sql` under source `yt-shorts-2026`, goal YT-SHORTS. The server worker (YT-3, another session) calls `make_director.py` and
`make_short.py` inside its Container.

## Update 2026-10-28: the production worker gets the quality pass (qnfo-youtube-shorts 0.2.0, YT-QUALITY-1)
Finding: the live worker (container + Workers AI) had its own copy of the old scene and captions, melotts voice and a spoken URL, so the owner's complaints applied to what it
had already published (two public Shorts on 2026-10-27), not only to the laptop scripts. Ported server-side:
- **Voice:** Workers AI `@cf/deepgram/aura-2-en` (speaker luna, mp3) per sentence, melotts as per-sentence fallback; spend priced $0.03 per 1000 characters (`tts_aura` in `youtube_spend`).
- **Director:** prompt now offers `bignum`, `flow`, `compare`, `list` beside the old kinds, asks for 110-150 spoken words, speech-written narration and at least four kinds;
  `shapeOk` and `beatStrings` cover the new kinds, so the number gate also checks bignum values, node labels and compare rows. `numTokens` composes spelled numbers
  ("three hundred and fifty" is 350) as the Python gate does. The closing line no longer speaks a URL.
- **Container:** `short_scene.py` is the fitted, themed scene (old `points` and `stat` kinds kept); `render.py` measures captions in DejaVu Bold, picks one of five themes
  from the slug, loudness-normalises, writes the AI comment tag and `provenance.json` (BP26-AI-ACT-ART50-1).
- Deploy: merge to main runs deploy-youtube-shorts.yml (wrangler deploy of the worker and the container image, `/health` gate on 0.2.0, `/status` container check).
- Verify after deploy: `GET /status` shows version 0.2.0-quality; the next queued paper's row reaches `uploaded` with a `beats.json` containing at least four kinds
  (`youtube/<id>/beats.json` in R2). Known limit: Workers AI TTS returns no word times, so captions split each sentence's measured length by character count.
