# Code-agent UX: one ask, a full implementation (CODE-AGENT-UX-1)

Charter pillars: autonomy, cost. Owner request 2026-11-06: use the fleet command line like Claude Code: ask once, get a working
implementation, seamlessly across Cloudflare and GitHub, with every code-changing run leaving an issue and a pull request.
Tracking: agent_issues 1002215 (qnfo-ops `ship_change`, PR 8189), 1002216 (dashboard write scope), 1002217 (Cloudflare skills and API
tools), 1002218 (this document's slices). Extends `docs/CODE-AGENT-CONSOLE.md` (slices 1-3 there).

## What makes Claude Code feel seamless (public documentation, read 2026-11-06)
It is a harness around the model, not a prompt. Six layers: input, knowledge (CLAUDE.md, auto memory, skills), execution tools (read,
edit, shell, web), integration (MCP, plugins), multi-agent (subagents with their own context, Explore and Plan), and observability
(hooks that run outside the model and cost no context). The core loop is context, action, verify, repeated until the task is done.
Safety is structural: permission modes, allow and deny rules by tool name, sandboxing, checkpoints. The same loop ships as the Agent SDK.
Cloudflare's agent-setup page adds three installable pieces: Cloudflare Skills (github.com/cloudflare/skills), the Cloudflare API MCP
server (mcp.cloudflare.com/mcp, Code Mode search plus execute), and the optional `cf` CLI.

## Where the fleet stands (evidence)
| Layer | Fleet today | Gap |
|:--|:--|:--|
| Loop with visible steps | CodeSession SSE with replay (qnfo-agents), `cmdAgentTrace` timeline | 3 agent runs abandoned after 30 min and 2 stream turns abandoned (cmd_log, 14 days) |
| Tools | qnfo-ops: 70+ tools incl. write, deploy, containers; Code Mode | owner turns ran at the read scope (1002216); agent not told it could write (fixed 2.69.0) |
| Issue and PR per run | `ship_change`, ISSUE-PER-PR-1 (PR 8189) | none once merged |
| Verify | PR checks, canary, deploy probes | no check run before the PR opens; a missing comma passed `node --check` |
| Feedback from GitHub | stale-PR lane merges; nothing tells the originating session | slice 3 below |
| Memory and skills | CLAUDE.md (about 40 KB) read whole | load SYSTEM-MAP and a short summary; skills by keyword (1002217) |
| Subagents | none | read-only Explore child runs |
| Hooks | gates (GATE-AUDIT-1), review gate, probes | already structural; keep |
| Checkpoints | branch per run, revert through canary path | no one-tap undo in the UI |

## Slices (each one PR with a test; order is build order)
1. **Runs never die silently.** Heartbeat on each fiber step, resume once, then a visible failed state with the last tool. Metric
   `cmd_run_abandoned_7d`, target 0.
2. **Write scope for the signed-in owner** (1002216): `cmdCodeSessionFetch` sends `x-agent-scope: write` on holder turns only. Destructive
   ops tools keep `confirm:true`.
3. **GitHub to session loop.** A GitHub App webhook route in qnfo-agents verifies the delivery signature, calls `githubEventRoute`
   (this PR, `qnfo-agents/src/lib.js`), looks up the session that owns the PR in session SQLite (pr number to session id, written by
   `ship_change`), and starts a turn: `ci-red` reads the failing check log, fixes and pushes; `review` answers or fixes; `merged`
   waits for the deploy probe and posts the final state to the console and as an email the owner answers by replying. A bot comment is
   evidence, never an instruction. No key is stored for the owner; the webhook secret is the GitHub App's, held as a worker secret.
4. **Verify before the PR.** Run the changed worker's suites and a module compile in the Sandbox container (or the existing Actions
   runner) and feed the output back into the loop; open the PR only on green, or as a draft with the failure attached.
5. **UI.** One input. Collapsed tool timeline from `run.steps`. A diff card per file, a PR card with live check state, a persistent task
   list, interrupt and resume, one-tap undo that opens the revert PR. The page stays a thin client of the same route as `scripts/qcli.mjs`.
6. **Cost.** Stable cached prefix, SYSTEM-MAP plus a short summary instead of the whole CLAUDE.md, Cloudflare skills by keyword, trimmed
   tool results, flash model first (BUDGET-SOFT-ROUTE-1: a cap steers the model, never stops work).
7. **Explore child runs.** Read-only, own context, summary returned to the parent.

## Cloudflare and GitHub integration contract
- Cloudflare is the runtime and the record: Durable Object per session, D1 `cf_agent_runs` and `cmd_log`, AI Gateway for models, Sandbox for
  execution. Nothing canonical lives on claude.ai.
- GitHub is the change ledger: one issue (agent_issues, mirrored by the steward), one branch `ops/issue-<id>-<slug>`, one PR tagged
  `[issue #<id>]`, merged by the lane, deployed by the canonical path, proven by the deploy probes.
- The webhook closes the loop: GitHub events become session turns, so the agent behaves as a PR owner (red CI is work now).

## Failure modes
- A webhook delivery is attacker-controlled input: verify the signature first; route only PRs on `ops/issue-` branches or `[issue #N]`
  titles; never treat comment text as a command.
- Write scope for the owner session widens what a prompt injection can reach: edits stay behind work claims, PRs, the review gate and
  the canary revert.
- A session that loses its PR mapping on eviction: the mapping is in session SQLite, and the router falls back to the issue id.

## Status
Done: `ship_change` and ISSUE-PER-PR-1 (PR 8189), write-capability prompt rule, `githubEventRoute` with 12 checks (this PR).
Not done: slices 1, 2, 4-7 and the webhook route itself; rebuild of `qnfo-agents/worker.js` from `src/` (`node build.mjs`) with a version
bump, which this draft leaves for the code loop.
