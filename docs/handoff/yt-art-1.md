# YT-ART-1 handoff (qnfo-youtube-shorts 0.10.0-art)
State: worker generates one abstract FLUX-schnell backdrop per beat at submit (`stageArt`), stores `youtube/<id>/bg_<n>.jpg`, passes `bg_b64` to the container; `render.py` writes `bg<i>.jpg`; `short_scene.py add_beat_art` shows it dimmed (0.42) with Ken Burns. Prompts come only from fixed motif x style lists (`artPrompt`), never paper claims, so nothing unverifiable is depicted.
Not verified: a real Manim render (no Manim locally). First live Short after deploy: check `youtube.art` warn events, `note` ends ", art N", watch the output for contrast with captions.
Next (code-task lines in the follow-up issues): stock-footage hybrid, extra templates (YT-SCENE-VARIETY-1), Remotion/HyperFrames evaluation, per-channel reach composer (REACH-FOCUS-1.1).
Verify: `node --test qnfo-youtube-shorts/youtube-shorts.test.mjs`.
