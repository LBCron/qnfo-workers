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

## Batch 4 (moved 2026-11-05, 10 directories; issue REPO-ARCHIVE-NEXT-1)

The sixteen candidates that batch 3 had not read line by line were read this time (git grep of each name over `.github`, `scripts`, every `*.toml`, `*.json`, `*.mjs`, `*.py`, `*.yml`, `*.txt` and `repos.json` outside `migrations/`, `docs/`, `audits/` and `archive/`, on origin/main). `docs/INDEX.md` and `docs/agent-catalog.json` are regenerated again.

| archive path | worker name declared | marker | last commit (date, short sha) | why it is dead | impact (fleet graph) | dependents found |
| --- | --- | --- | --- | --- | --- | --- |
| archive/events-radar | events-radar | FOLDED | 2026-10-01 00a21516b | code embedded in radar-hub (RADAR-HUB-REDEPLOY-1); the script vanished from the account | no worker node (`find` shows only the Workflow `events-radar-watch`, which radar-hub hosts) | a fixture row in `qnfo-code-orchestrator/folded-redirect.test.mjs` and a comment in `scripts/mirror-guard.py`; no path read |
| archive/jnl-referee | jnl-referee | RETIRED | 2026-10-17 54d908240 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | none (`scripts/cf_ops_d1_fold_test.py` builds its own fixture directory named jnl-referee) |
| archive/obsidian-writer | obsidian-writer | RETIRED | 2026-10-01 899f5d876 | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | `[[services]]` blocks in the retired events-radar, personal-events-radar and qnfo-autopilot wrangler.toml only (none is deployed; radar-hub removed its binding 2026-10-01) |
| archive/personal-events-radar | personal-events-radar | FOLDED | 2026-10-01 00a21516b | code embedded in radar-hub as the `perMod` module (RADAR-HUB-REDEPLOY-1) | no node | a note path string in `idea-hub/owner-signal-intake.test.mjs`; no directory read |
| archive/qnfo-arxiv-radar | (no wrangler.toml) | FOLDED | 2026-10-11 3fc959bc9 | folded into radar-hub (AUTOAUDIT-ACTIONABLE-2) | no worker node (`find` shows a route label) | a hostname list in `scripts/attach-surface-routes.py`; no path read |
| archive/qnfo-citation-watch | qnfo-citation-watch | FOLDED | 2026-10-10 aa412fcfd | duties live in radar-hub | no worker node (`find` shows a route label) | the same hostname list and a comment in the retired qnfo-autopilot wrangler.toml |
| archive/qnfo-research-radar | (no wrangler.toml) | FOLDED | 2026-10-21 e1889bd2c | folded into radar-hub (AUTOAUDIT-ACTIONABLE-2) | no worker node (`find` shows a route label) | the same hostname list; `radar-hub/arxiv-seed.test.mjs` slices radar-hub's own source at a version marker string |
| archive/qnfo-idea-factory | qnfo-idea-factory | RETIRED | 2026-10-10 aa412fcfd | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | an error-fixture string in `qnfo-cloud-ops/worker-health.test.mjs` |
| archive/qnfo-pipeline-ops | qnfo-pipeline-ops | RETIRED | 2026-10-10 aa412fcfd | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | `scripts/close-channel-guard.test.mjs` asserts that RETIRED directories are not scanned; its scan reads top-level directories only, so the assertion still holds |
| archive/qnfo-skill-sync | qnfo-skill-sync | RETIRED | 2026-10-06 a15af7d04 | WORKER-RETIRE-WAVE-2 (agent_issues 1756): a daily kaizen cycle, retired with qnfo-kaizen | no node | a comment in `qnfo-ops/wrangler.toml`, the same close-channel-guard assertion, a docstring in `scripts/cf_ops_delete_worker_test.py` (its fixtures build their own directories) |

## Batch 5 (moved 2026-11-05, 4 directories; issue REPO-ARCHIVE-NEXT-1)

The four candidates that batch 4 had read and found clean but held back for the 10-per-pull-request limit. `docs/INDEX.md` and `docs/agent-catalog.json` are regenerated if a README moved (`--check`).

| archive path | worker name declared | marker | last commit (date, short sha) | why it is dead | impact (fleet graph) | dependents found |
| --- | --- | --- | --- | --- | --- | --- |
| archive/qnfo-agent-orchestrator | qnfo-agent-orchestrator | RETIRED | 2026-10-10 ffeaf08e3 | ORCH-RETIRE-1 (agent_issues 1756 and 2010), owner standing grant OWNER-STANDING-GRANT-1 | no worker node (`find` shows only a host label) | the retired qnfo-idea-triage `wrangler.toml` binding block, comments in qnfo-agents, qnfo-intent-orchestrator and the stale `agent-orchestrator/` copy, and historic patch scripts; the stale copy `agent-orchestrator/` stays (its readers are in the table below) |
| archive/qnfo-artifacts | qnfo-artifacts | RETIRED | 2026-10-26 82a26217b | worker_count breach (36 against 30), trigger 344, agent_issues 99923 | no worker node (`find` shows only the retiring migration) | the `deploy-targets.txt` comment on line 14, updated to `archive/qnfo-artifacts/RETIRED` in this change; a comment in `qnfo-ops/wrangler.toml`; a docstring in `scripts/deployment_ledger_reconcile.py` |
| archive/qnfo-error-selfheal | qnfo-error-selfheal | RETIRED | 2026-10-10 aa412fcfd | not deployed, nothing consumes it (FOOTPRINT-MARKERS-1) | no node | fixtures in `qnfo-backlog-exec/exception-close.test.mjs`; the name is still in the `PROBE_WORKERS` variable of `qnfo-fleet-control/wrangler.toml`, where `runAudit` probes it against the account script list and reads `not-in-cf-worker-list` (a stale probe target, not a path; the doer of ARCHIVE-READERS-3 or the fleet-control owner removes it) |
| archive/qnfo-idea-triage | qnfo-idea-triage | FOLDED | 2026-10-17 54d908240 | duties live in idea-hub (FOOTPRINT-MARKERS-1) | no node | `scripts/model-floor-guard.test.mjs` uses the name as input of a pure function; no path read |

## Not moved yet, with the dependent that keeps each one (read 2026-11-05)

These stay at the top level until the named dependent changes. 34 directories remain after batch 5 (78 NOT_DEPLOYED candidates read on 2026-11-05, 44 archived): 32 are named in the table below with the reader found, and 2 were read in batch 4 and held back for the reason in the last rows. The reader families have doers: agent_issues 1002097 (fold-parity suites), 1002098 (workflow steps), 1002099 (guard scripts and path-reading tests).

| directories | dependent that keeps them |
| --- | --- |
| ai-health-prober, errata-hub, fleet-exec, qnfo-autonomy-scorer, qnfo-backlog-exec, qnfo-email-orchestrator, qnfo-errata-respond, qnfo-errata-watch, qnfo-evolve, qnfo-paper-indexer, qnfo-paper-reviser, qnfo-archive | a suite of another directory reads `../<name>/worker.js` or `../<name>/FOLDED` (fold parity: host tests in qnfo-ai-calibration, qnfo-research-exec, qnfo-code-orchestrator, qnfo-observability, qnfo-lifecycle, qnfo-cloud-ops, qnfo-infra) |
| calendar-api, notes-intake, qnfo-errata-publish, qnfo-paper-explainer | `qnfo-code-orchestrator/folded-redirect.test.mjs` and `dispatch-dedupe.test.mjs` use the path as fixture input; `deploy-gate.yml` runs `calendar-api` suites |
| qnfo-kaizen, qnfo-outreach, qnfo-signal-loop, qnfo-qwav, qnfo-code-agent, qnfo-fleet-advisor | a `deploy-gate.yml`, `pr-checks.yml`, `version-compare.yml`, `run-suites.mjs` or `codeql.yml` line names the path |
| jnl-pipeline, qnfo-autopilot | `scripts/ai-attribution-*-test.mjs` reads `../<name>/worker.js` |
| osf-integrity-check, paper-hub, agent-orchestrator, memory-mcp, qnfo-fleet-calibrator, qnfo-twin-maintain, vault-indexer, qnfo-calendar-intake | `mirror-guard.py`, `dup-worker-name-gate.py`, `deploy-drift-guard.py`, `cron_rate_guard.py`, `canary_revert.py`, `canonical-deploy.yml` or `charter.test.mjs` name them (read the line before moving) |
| qnfo-agent-ws | `qnfo-fleet-control/charter.fixture.json` carries the owner-decision row RM-AGENT-WS-DECISION-1 about this directory; archive it with that decision |
| qnfo-artifact-agent | `scripts/dependency-allowlist.txt` line 17 is keyed by the directory (RM-1414 baseline); change the allowlist in the same pull request |

## Known follow-up (filed as an issue with a doer)

`scripts/cf_ops_actions.py` (delete-worker, delete-vectorize-index, unbind-service) and `scripts/fleet_graph.mjs` (`retired` list of the doc-names-retired-worker finding) read the marker at `<name>/RETIRED` of the top level only; both files were under another session's claim on 2026-11-05. Until they read `archive/<name>/` too, a delete of an archived worker's script needs `git mv archive/<name> <name>` first. `deploy-drift-guard.py` and `cf_estate.py` already read the archive. The doers: agent_issues 1002076 (`scripts/fleet_graph.mjs`, ARCHIVE-MARKER-READ-2; after it the info finding doc-names-retired-worker, 397 before the first batch and 297 after the third, is restored), 1002077 (`scripts/cf_ops_actions.py`, ARCHIVE-MARKER-READ-3), 1002078 (UNBIND-LIVE-BINDING-1) and 1002079 (REPO-ARCHIVE-NEXT-1, the next batches).
