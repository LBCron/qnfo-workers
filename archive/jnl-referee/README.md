# jnl-referee

AI referee + decision engine for the AI-reviewed journal overlay (isolated jnl-* stack).
Reviews records from an external community (or any recid), writes structured adversarial referee reports and deterministic decisions to D1 `jnl-audit` (`jnl_reviews`, `jnl_decisions`, `jnl_review_log`).

- Version: 0.1.0
- Cron: `23 */2 * * *` (seeds new records + runs up to 2 reviews per fire, daily cap 60)
- Endpoints: GET /health /queue /reviews /decisions; POST /enqueue /seed /run /run-next (Bearer via `x-jnl-token` header)
- Models: Workers AI llama-3.3-70b-instruct-fp8-fast + llama-4-scout-17b-16e-instruct (env JNL_MODELS override)
- Isolation: D1 jnl-audit + KV jnl-state + Workers AI binding; no QNFO-research mix
- Honesty: overlay-only (never stores paper bodies, never writes back to the source); metadata-only reviews never get PUBLISH; every report discloses basis + reviewer limitations

Deploy: `wrangler deploy` then set secret JNL_TOKEN. Requires existing D1 jnl-audit + KV jnl-state (see jnl-watch).

## Accuracy (JNL-GROUND-1, 0.9.2, owner directive 2026-10-10)

Reviewer prompts allow no external citation, source, fact, name, date or figure: a review may quote or paraphrase only the submitted text. `score_novelty` needs related work to compare against and the reviewer sees none, so it is recorded as the neutral 5 and left out of the decision mean (soundness, clarity and reproducibility). Suite: `ground.test.mjs`. The same change is in the bundled copy in `jnl-pipeline`. Both directories still carry their RETIRED marker (a charter decision, not changed here).
