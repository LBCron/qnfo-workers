# qnfo-chameleon — Autonomous Preference-Adaptive Output System

Status: **M0 (telemetry plane)** — scaffold committed 2026-09-09, awaiting deploy.
Build plan: `ops-workspace/plans/preference-evolution/2026-09-09-CHAMELEON-build-plan.md`
Owner: qnfo-ops. Canonical repo: QNFO/qnfo-workers (this dir). Deployed worker mirrors this source.

## What this is

A closed loop in which every output (content AND its look-feel) is a *variant* served under an
inferred-preference policy, and the policy evolves itself from behavioral outcomes. No settings UI;
preferences are **revealed** (behavior), never stated. The rendering grammar is itself a learned
artifact, bounded by non-learnable legibility/accessibility hard constraints.

Core loop: `serve arm → observe outcome → update posterior → evolve policy → serve again`.

## M0 contents (this commit)

| File | Purpose |
|---|---|
| `wrangler.toml` | Worker config: D1 `PREF` (personal-life, id e8d6c61a…) + `AUDIT` (qnfo-audit, id 35e2e573…), observability on. `main = worker.js`. |
| `schema.sql` | D1 `pref_*` table set: consumers, signals, variants, outcomes, state (posteriors), grammar, drift. Apply to **personal-life**. |
| `worker.js` | v0.1.0-M0: `POST /v1/events` (idempotent signal ingest), `GET /v1/stats`, `GET /health`, 501 on `/v1/render` until M1/M2. Optional `EVENT_TOKEN` secret gates ingest. |

Routes:
- `POST /v1/events` — body `{user_id, session_id, consumer_key, action, variant_id?, ctx?, ts_bucket?}`;
  action ∈ view|scroll|click|copy|save|reply|abandon|open. Returns `202 {ok:true,id}` or `{deduped:true}`.
  Idempotency key: (session_id, consumer_key, action, ts_bucket, variant_id).
- `GET /v1/stats?hours=24` — signal/consumer counts (diagnostics).
- `GET /health` — registry-conformant probe `{ok, service, version}`.

## Deploy checklist (next executor)

1. Apply schema: `wrangler d1 execute personal-life --remote --file schema.sql`
2. (Recommended before consumers attach) `wrangler secret put EVENT_TOKEN`
3. Deploy: `wrangler deploy` from this dir (or fleet-deploy control plane).
4. Register in the service registry (self-registration on /health per fleet convention:
   purpose/capabilities/deps) — qnfo-register-guard verifies.
5. Verify: `fleet_status` shows qnfo-chameleon healthy; probe `/health` + one synthetic
   `POST /v1/events`; confirm row in D1 personal-life `pref_signals`.

M0 acceptance (plan §7): served renders produce ≥1 signal (renders arrive M2); p50 ingest <100ms;
registry entry + /health probe added.

## Milestone gates (from build plan)

- **M0 — done (this commit):** telemetry plane: scaffold + migrations + /v1/events.
- **M1 — v0.2:** arm selection + pref_state Thompson posteriors (5% exploration floor).
- **M2 — v0.3:** render endpoint + grammar arms; consumer #1 research-daily-brief, consumer #2
  personal-api reply. **Anti-dead-end gate: no render path ships without a live consumer.**
- **M3 — evolver v0.1:** daily batch update, CUSUM drift (freeze + file agent_issue, never silent),
  R2 snapshot to qnfo-backups `pref-state/YYYY-MM-DD.json`, >90d purge, audit rows.
- **M4 — v0.4:** weekly owner-review mutation loop via qnfo-cloud-ops digest + 14-day A/B vs fixed
  baseline. If adaptive ≤ baseline: keep fixed baseline + telemetry, do not widen scope.

Hard constraints are NOT learnable (4.5:1 contrast floor, no dark theme, no motion, font scale ≥1.0).
Reward (plan §5) excludes raw dwell time — no engagement-bait convergence by construction.

## Operational notes

- Embedding model for phase-3 user/item vectors must NOT be @cf/baai/bge-base-en-v1.5 (measured
  429-saturated, 4,780 fails/24h on 2026-09-08). Re-pick from catalog at that phase.
- D1 personal-life now hosts pref_* tables; monitor growth, isolate to dedicated pref-db if >~1GB.
- Storage/PPI: signals purged after 90d; outcomes + pref_state (aggregate posteriors) retained;
  no raw content stored — content_hash + prompt_hash only.
