# Handoff: command line as the product (2026-11-06)

For any later session. Owner usage was running low, so everything is in `main`, in D1 issues or in this file. Start from `docs/COMMAND-LINE-PRODUCT.md`
(parity table) and `docs/CODE-AGENT-UX.md` (slices). Program QNFO.OPS; goals `cmdline-one-ask-full-change`, `dashboard-three-screens`, `anticipate-needs-weekly`.

## Live (verify with the probes before relying on it)
| What | Where | Probe |
|:--|:--|:--|
| `ship_change`, ISSUE-PER-PR-1, idempotent retries | qnfo-ops 2.69.1 | `GET https://ops.qnfo.org/health` version >= 2.69.1 |
| GitHub webhook route (inert until the secret exists) | qnfo-agents `POST /github/webhook` | unsigned POST answers 503 (no secret) or 401 (secret set) |
| Run heartbeat (`last_beat_ms`, `last_tool`) | qnfo-agents >= 0.9.1 | `GET https://agents.qnfo.org/health` |
| `explore` read-only child run | qnfo-agents (this PR) | `GET /tools` lists `explore` for a non-lean caller |

## Open work, in build order (agent_issues; each has a doer line and a probe)
1. 1002220 GitHub App and `GITHUB_WEBHOOK_SECRET` (IDENTITY-BOUND: the owner's GitHub account mints it; take the secret lease first).
2. 1002216 write scope for the signed-in owner in `cmdCodeSessionFetch` (dashboard). 1002237 fold the dashboard into Now, Work, Portfolio. 1002222 the `/cmd` UI cards.
   All three need `file:qnfo-fleet-dashboard/worker.js`; check `GET https://qnfo-deploy-guard.q08.workers.dev/work-locks` for the holder first.
3. 1002234 Sandbox container for the edit and test loop; 1002221 verify before the PR; 1002235 hooks and answer-by-email; 1002236 fork and share.
4. 1002238 weekly maintenance sweep and anticipated needs (qnfo-fleet-control); 1002217 Cloudflare skills and API tools; 1002223 context cost.
5. 1002219 remainder: D1 ledger sweep by last step, dashboard stream sweep, metric `cmd_run_abandoned_7d` with trigger and cause mapping.

## Rules that bit during this work
- Work claim before editing a file; the dashboard claim was renewed by another session's code task. Do not wait on it: take other work.
- A missing comma between prompt strings passed `node --check` and failed module load; tests compile the module (ship-change.test.mjs).
- Adding a doc file makes `docs/INDEX.md` and `docs/agent-catalog.json` stale: run `node scripts/build-agent-catalog.mjs` before pushing.
- `gh pr create` and marking a PR ready fail (GraphQL 403); use `gh api repos/QNFO/qnfo-workers/pulls --method POST --input file.json`.
- Review-gate findings from a single model family are claims: three of five on PR 8189 and all three on PR 8194 did not hold against the code.
