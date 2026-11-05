-- YT-VOICE-RETRY-1 (2026-11-05, charter pillar reach, program QNFO.REACH; roadmap yt-shorts-2026 YT-9 and YT-14, owner complaint 2026-11-04 "robotic unsentenced speech").
-- Found while checking the YT-9 decision against youtube_spend: row 5 (rendered 2026-11-04T23:02Z, first attempt) has no tts_aura line and took 306 s in the container (the Kokoro CPU voice);
-- row 6 (distinction-lattice-framework, rendered 2026-11-05T00:00Z) has tts_aura 557 characters and took 138 s: it is voiced by Aura 2. Cause in qnfo-youtube-shorts/worker.js:
-- ttsEngine(attempts) returns "kokoro" only while attempts is 0. Row 6 was rejected at the director stage (0 supported beats, a model-output fault unrelated to audio), re-made by
-- YT-DIRECTOR-RETRY-1 (PR 7388), and its retry counted as attempts 1, so it fell back to the weaker voice although Kokoro never failed for it. The fallback exists for a Kokoro failure in the
-- container, not for any retry. Filed as an issue with a doer (the code loop, by the code-task line) and a measuring probe; no worker file is touched here (qnfo-youtube-shorts/worker.js is
-- under another session's work claim until about 03:00Z).
-- Prediction: after the fix a Short retried for a director or upload fault keeps Kokoro (no tts_aura line in youtube_spend for its row), and a Short whose render failed with Kokoro still falls back to Aura.
-- APPLY-BY: ci
-- DB: qnfo-audit
-- Rollback: DELETE FROM agent_issues WHERE title LIKE 'YT-VOICE-RETRY-1:%' AND status = 'open' AND source = 'session:C3-products';
-- CAUSE-MAPPED: registers no metric_registry row.

INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at)
SELECT 'YT-VOICE-RETRY-1: a Short retried for any reason is voiced by Aura instead of Kokoro (ttsEngine(row.attempts) falls back on every retry, not on a Kokoro failure)',
'Pillar reach, program QNFO.REACH, roadmap YT-9 (decision: Kokoro is the default voice, Aura 2 the fallback) and YT-14. Owner complaint 2026-11-04: robotic speech.
Evidence read 2026-11-05: qnfo-audit youtube_spend row 5 (first attempt) has no tts_aura line and 306 s of container time; row 6 has tts_aura 557 characters and 138 s. youtube_videos row 6 has attempts 1 after state rejected at 00:00Z (director left 0 supported beats, shape) and the YT-DIRECTOR-RETRY-1 re-make. qnfo-youtube-shorts/worker.js: function ttsEngine(attempts) { return (attempts || 0) < 1 ? "kokoro" : "aura"; }, used by stageAudio.
Defect: the engine is chosen from the retry count, so a retry caused by the director, the checker, the upload or a transient error is voiced by Aura although Kokoro never failed for that row. The Aura fallback is meant for a Kokoro failure in the render container.
Fix: choose Aura only when the previous failure happened in the rendering stage with Kokoro (record the failed stage or engine in the row note or a column when a stage fails, read it in ttsEngine), keep Kokoro for every other retry; a Kokoro render failure still falls back to Aura on the next attempt. Add a regression test in qnfo-youtube-shorts/youtube-shorts.test.mjs for both cases.
code-task: repo=qnfo-workers path=qnfo-youtube-shorts/worker.js
code-anchor: function ttsEngine(attempts) {
code-probe: {"paths": ["qnfo-youtube-shorts/worker.js"], "absent": "(attempts || 0) < 1 ? \"kokoro\" : \"aura\""}
Closing evidence also needs a live read: after the next retried Short, SELECT kind FROM youtube_spend WHERE row_id = <its id> shows no tts_aura line.',
'session:C3-products', 'optimization', 'medium', 'open', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM agent_issues WHERE title LIKE 'YT-VOICE-RETRY-1:%' AND status = 'open');
