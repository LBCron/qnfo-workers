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

## Not moved yet, with the dependent that keeps each one (read 2026-11-05)

These stay at the top level until the named dependent changes. The next batches take the directories with no dependent first (candidates read 2026-11-05 with no workflow, script, suite or binding naming the path: personal-life-indexer, personal-life-maintain, personal-life-search, qnfo-analytics, qnfo-impact, qnfo-thread-ingest, jnl-reviser, jnl-watch, ops-gateway, qnfo-chameleon, qnfo-events, qnfo-proof, qnfo-venue-radar, research-daily-brief, retired-deposit-stage; each has a README.md that `docs/agent-catalog.json` and `docs/INDEX.md` list, so those two files are regenerated in the same pull request).

| directories | dependent that keeps them |
| --- | --- |
| ai-health-prober, errata-hub, fleet-exec, qnfo-autonomy-scorer, qnfo-backlog-exec, qnfo-email-orchestrator, qnfo-errata-respond, qnfo-errata-watch, qnfo-evolve, qnfo-paper-indexer, qnfo-paper-reviser, qnfo-archive | a suite of another directory reads `../<name>/worker.js` or `../<name>/FOLDED` (fold parity: host tests in qnfo-ai-calibration, qnfo-research-exec, qnfo-code-orchestrator, qnfo-observability, qnfo-lifecycle, qnfo-cloud-ops, qnfo-infra) |
| calendar-api, notes-intake, qnfo-errata-publish, qnfo-paper-explainer | `qnfo-code-orchestrator/folded-redirect.test.mjs` and `dispatch-dedupe.test.mjs` use the path as fixture input; `deploy-gate.yml` runs `calendar-api` suites |
| qnfo-kaizen, qnfo-outreach, qnfo-signal-loop, qnfo-qwav, qnfo-code-agent, qnfo-fleet-advisor | a `deploy-gate.yml`, `pr-checks.yml`, `version-compare.yml`, `run-suites.mjs` or `codeql.yml` line names the path |
| jnl-pipeline, qnfo-autopilot | `scripts/ai-attribution-*-test.mjs` reads `../<name>/worker.js` |
| osf-integrity-check, paper-hub, agent-orchestrator, memory-mcp, qnfo-fleet-calibrator, qnfo-twin-maintain, vault-indexer, qnfo-calendar-intake | `mirror-guard.py`, `dup-worker-name-gate.py`, `deploy-drift-guard.py`, `cron_rate_guard.py`, `canary_revert.py`, `canonical-deploy.yml` or `charter.test.mjs` name them (read the line before moving) |

## Known follow-up (filed as an issue with a doer)

`scripts/cf_ops_actions.py` (delete-worker, delete-vectorize-index, unbind-service) and `scripts/fleet_graph.mjs` (`retired` list of the doc-names-retired-worker finding) read the marker at `<name>/RETIRED` of the top level only; both files were under another session's claim on 2026-11-05. Until they read `archive/<name>/` too, a delete of an archived worker's script needs `git mv archive/<name> <name>` first. `deploy-drift-guard.py` and `cf_estate.py` already read the archive.
