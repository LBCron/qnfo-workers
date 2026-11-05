# archive/ manifest: retired and folded worker directories (RM-REPO-DEAD-SOURCES-1)

Charter pillar: core. Owner row: `roadmap_implementation` 21 (RM-REPO-DEAD-SOURCES-1), source `worker_live_audit` (65 NOT_DEPLOYED + 9 NOT_A_WORKER repository directories on 2026-09-30; 78 NOT_DEPLOYED rows on 2026-11-05).

A directory is moved here with `git mv <name> archive/<name>` (history follows the rename) when all of these hold on the day of the move:

1. It carries a `RETIRED` or `FOLDED` marker, and the marker stays in `archive/<name>/`. Never delete the marker to get a deploy through.
2. Its worker is absent from the Cloudflare account (workers list read the same day).
3. `GET https://qnfo-memory-mcp.q08.workers.dev/fleet-graph/impact?id=worker:<name>` has no node for it (retired and folded directories are not graph nodes), and `/fleet-graph/find?query=<name>` finds none.
4. A repository search for the name found no workflow step, script, test, probe list, allowlist, `deploy-targets.txt` line, root file, `wrangler.toml` service binding or `../<name>/` read in another directory that depends on the path (mentions in comments, release notes, fixtures of names and `audits/` reports are not dependencies).
5. It is not the member side of a fold parity test in its host (`../<name>/worker.js` or `../<name>/FOLDED` read by a suite of another directory): those directories stay until the host drops the suite.

At most 10 directories move in one pull request. `scripts/archive-manifest.test.mjs` fails when an archived worker directory has no marker, no row below, a top-level twin, or a `deploy-targets.txt` line.

Restore (a worker is wanted again): `git mv archive/<name> <name>`, remove the marker in the same pull request only with the evidence that justifies the revival, and take the new-worker path (charter pillar, net-zero retirement).

Companion manifests in this directory: `APPLIER-WORKFLOWS-MANIFEST.md`, `ATTACH-WORKFLOWS-MANIFEST.md` (retired workflows). `qwav-pages-retired-2026-11-04/` is retired static pages, not a worker.

## Batch 1 (moved 2026-11-05, 10 directories)

| archive path | worker name declared | marker | last commit (date, short sha) | why it is dead | impact (fleet graph) | dependents found |
| --- | --- | --- | --- | --- | --- | --- |
| archive/errata-orchestrator | qnfo-errata-orchestrator | RETIRED | 2026-10-01 899f5d876 | retired before 2026-09-15; the errata pipeline is errata-hub | no node | none (names in `qnfo-observability/fleet.js`, `scripts/deploy-drift-guard-output.fixture.json` and the READMEs of the errata step workers only) |
| archive/companion-hub | companion-hub | FOLDED | 2026-10-11 b04fa82c2 | duties live in personal-companion (FOLDED 2026-10-01, FOOTPRINT-MARKERS-1) | no node | none (README mentions in personal-companion and archived personal-life-* directories) |
| archive/qnfo-blank-audit | qnfo-blank-audit | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/qnfo-chat-canary | qnfo-chat-canary | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/qnfo-ddocs-indexer | qnfo-ddocs-indexer | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/qnfo-idea-miner | qnfo-idea-miner | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/qnfo-register-guard | qnfo-register-guard | FOLDED | 2026-10-01 3d9f87df3 | added by a remediation-bridge commit, never created in the account (REGISTER-RELABEL-1) | no node | none |
| archive/qnfo-research-supervisor | qnfo-research-supervisor | RETIRED | 2026-10-01 899f5d876 | Workflow wrapper superseded by qnfo-research-exec's cron (worker_removals RETIRE 2026-09-13) | no node | none |
| archive/skills-discovery | qnfo-skills-discovery | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/qnfo-cf-one-dashboard | (no wrangler.toml) | RETIRED | 2026-10-28 8d863971 | worker_count breach (38 against 30) and a 404 health route; marker-only directory | no node | none |

## Batch 2 (moved 2026-11-05, 10 directories)

Eight of the ten have a README.md that `docs/agent-catalog.json` and `docs/INDEX.md` listed (qnfo-analytics and qnfo-impact hold only a marker and a `deployed-current.worker.js`), so both files are regenerated with `node scripts/build-agent-catalog.mjs` in the same pull request (`archive/` is outside the catalog by `isSystemDocument`).

| archive path | worker name declared | marker | last commit (date, short sha) | why it is dead | impact (fleet graph) | dependents found |
| --- | --- | --- | --- | --- | --- | --- |
| archive/personal-life-indexer | (no wrangler.toml) | RETIRED | 2026-10-11 3fc959bc9 | absent from the account; only a `deployed-current.worker.js` (and a README) remained (AUTOAUDIT-ACTIONABLE-2) | no node | none (URL strings in `qnfo-ai/QUICKSTART.md` and `qnfo-ai/scripts/verify-runtime.py` point at the dead host and are documentation) |
| archive/personal-life-maintain | (no wrangler.toml) | RETIRED | 2026-10-11 3fc959bc9 | same as above | no node | none |
| archive/personal-life-search | (no wrangler.toml) | RETIRED | 2026-10-11 3fc959bc9 | same as above | no node | none (two suites assert the name is absent from code, they do not read the directory) |
| archive/qnfo-analytics | (no wrangler.toml) | RETIRED | 2026-10-11 3fc959bc9 | same as above | no node | none |
| archive/qnfo-impact | (no wrangler.toml) | RETIRED | 2026-10-21 e1889bd2c | same as above | no node | none (a `qnfo-impact/0.1` user-agent string in qnfo-infra and qnfo-paper-indexer is not a path) |
| archive/qnfo-thread-ingest | (no wrangler.toml) | RETIRED | 2026-10-11 3fc959bc9 | same as above | no node | none |
| archive/jnl-reviser | jnl-reviser | RETIRED | 2026-10-10 ffeaf08e3 | retired before 2026-09-15 (commit "remove stale bindings from 3 retired workers") | no node | none (strings in the still-parked jnl-pipeline) |
| archive/jnl-watch | jnl-watch | RETIRED | 2026-10-10 ffeaf08e3 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (strings in the still-parked jnl-pipeline) |
| archive/ops-gateway | (no wrangler.toml) | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/qnfo-chameleon | qnfo-chameleon | RETIRED | 2026-10-01 899f5d876 | a parked M0 plan (preference telemetry for personal-life) that was never deployed | no node | none |

## Batch 3 (moved 2026-11-05, 10 directories)

`docs/INDEX.md` and `docs/agent-catalog.json` are regenerated again (`node scripts/build-agent-catalog.mjs`, then `--check`).

| archive path | worker name declared | marker | last commit (date, short sha) | why it is dead | impact (fleet graph) | dependents found |
| --- | --- | --- | --- | --- | --- | --- |
| archive/qnfo-events | qnfo-events | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (a `/qnfo-events/ingest` path in `qnfo-email/MIME-PARSER-FIX-20260921.md` is documentation) |
| archive/qnfo-proof | qnfo-proof | RETIRED | 2026-10-21 e1889bd2c | vanished unrecorded from the account (last proof event 2026-09-04); a mutation-gated ledger service, not redeployed (RADAR-HUB-REDEPLOY-1, issue 1644) | no node | none |
| archive/qnfo-venue-radar | qnfo-venue-radar | RETIRED | 2026-10-05 fd42fe758 | WORKER-RETIRE-WAVE-1 (agent_issues 1756), owner standing decision 3 of 2026-10-05 | no node | none (its `migrations/001_venue_radar.sql` is worker-local and moves with it) |
| archive/research-daily-brief | research-daily-brief | RETIRED | 2026-10-10 aa412fcfd | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none |
| archive/retired-deposit-stage | retired-deposit-stage | RETIRED | 2026-10-11 4a3999aee | retired before 2026-09-15 (commit "remove stale bindings from 3 retired workers") | no node | none |
| archive/audit-hub | audit-hub | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (the name appears in a one-shot patch script that already ran) |
| archive/qnfo-auditor | qnfo-auditor | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (a comment in `scripts/mirror-guard.py`) |
| archive/qnfo-scorecard | qnfo-scorecard | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (`qnfo-scorecard/1.0.0` is a version-string fixture in `qnfo-fleet-control/version-compare.test.mjs`) |
| archive/qnfo-fleet-deploy | qnfo-fleet-deploy | RETIRED | 2026-10-25 0561b8a60 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1; merge wave A into qnfo-fleet-control) | no node | none (comments in `qnfo-fleet-control/wrangler.toml` and a patch script that already ran) |
| archive/qnfo-fleet-feed | qnfo-fleet-feed | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (`qnfo-ops/dangling-10143.test.mjs` uses the name inside an error-message fixture) |

## Not moved yet, with the dependent that keeps each one (read 2026-11-05)

These stay at the top level until the named dependent changes. 48 candidate directories remain at the top level after batch 3 (78 NOT_DEPLOYED candidates on 2026-11-05, 30 archived): 32 are named in the table below with the reader found, and the last row lists the 16 whose mentions (live `wrangler.toml` lines, guard scripts, suites) have not yet been read line by line; the next batch starts there.

| directories | dependent that keeps them |
| --- | --- |
| ai-health-prober, errata-hub, fleet-exec, qnfo-autonomy-scorer, qnfo-backlog-exec, qnfo-email-orchestrator, qnfo-errata-respond, qnfo-errata-watch, qnfo-evolve, qnfo-paper-indexer, qnfo-paper-reviser, qnfo-archive | a suite of another directory reads `../<name>/worker.js` or `../<name>/FOLDED` (fold parity: host tests in qnfo-ai-calibration, qnfo-research-exec, qnfo-code-orchestrator, qnfo-observability, qnfo-lifecycle, qnfo-cloud-ops, qnfo-infra) |
| calendar-api, notes-intake, qnfo-errata-publish, qnfo-paper-explainer | `qnfo-code-orchestrator/folded-redirect.test.mjs` and `dispatch-dedupe.test.mjs` use the path as fixture input; `deploy-gate.yml` runs `calendar-api` suites |
| qnfo-kaizen, qnfo-outreach, qnfo-signal-loop, qnfo-qwav, qnfo-code-agent, qnfo-fleet-advisor | a `deploy-gate.yml`, `pr-checks.yml`, `version-compare.yml`, `run-suites.mjs` or `codeql.yml` line names the path |
| jnl-pipeline, qnfo-autopilot | `scripts/ai-attribution-*-test.mjs` reads `../<name>/worker.js` |
| osf-integrity-check, paper-hub, agent-orchestrator, memory-mcp, qnfo-fleet-calibrator, qnfo-twin-maintain, vault-indexer, qnfo-calendar-intake | `mirror-guard.py`, `dup-worker-name-gate.py`, `deploy-drift-guard.py`, `cron_rate_guard.py`, `canary_revert.py`, `canonical-deploy.yml` or `charter.test.mjs` name them (read the line before moving) |
| events-radar, jnl-referee, obsidian-writer, personal-events-radar, qnfo-agent-orchestrator, qnfo-agent-ws, qnfo-artifact-agent, qnfo-artifacts, qnfo-arxiv-radar, qnfo-citation-watch, qnfo-error-selfheal, qnfo-idea-factory, qnfo-idea-triage, qnfo-pipeline-ops, qnfo-research-radar, qnfo-skill-sync | not yet read line by line: each is named in a live `wrangler.toml` (`radar-hub`, `qnfo-agents`, `qnfo-intent-orchestrator`, `qnfo-ops`, `qnfo-fleet-control`), a guard script (`close-channel-guard.test.mjs`, `attach-surface-routes.py`, `deployment_ledger_reconcile.py`, `dependency-allowlist.txt`) or a suite, and a `[[services]]` binding would make it a live dependent |

## Known follow-up (filed as an issue with a doer)

`scripts/cf_ops_actions.py` (delete-worker, delete-vectorize-index, unbind-service) and `scripts/fleet_graph.mjs` (`retired` list of the doc-names-retired-worker finding) read the marker at `<name>/RETIRED` of the top level only; both files were under another session's claim on 2026-11-05. Until they read `archive/<name>/` too, a delete of an archived worker's script needs `git mv archive/<name> <name>` first. `deploy-drift-guard.py` and `cf_estate.py` already read the archive.
