# The fleet command line as the product (CMDLINE-PRODUCT-1, agent_issues 1002233)

Charter pillars: autonomy, cost. Program: QNFO.OPS (program-manager:QNFO.OPS). Owner request 2026-11-06: the command line is everything;
the dashboard folds into fewer, better screens; anything Claude Code, GitHub Copilot's cloud agent or another cloud coding agent does on
its back end, the fleet does on Cloudflare; the program, product and portfolio managers keep improving it, front end and back end, and
anticipate needs. Builds on `docs/CODE-AGENT-UX.md` (slices 1-7) and `docs/CODE-AGENT-CONSOLE.md`.

## What happens when a cloud coding agent runs (public documentation and observed behaviour)
1. **Intake.** The request becomes a session with an id, a repository, a base branch and a permission mode. Instructions (CLAUDE.md, AGENTS.md,
   custom agents) and memory load first; MCP servers and skills attach by name.
2. **Isolated machine.** A fresh VM or container: repo cloned at the base, dependencies installed (a setup script, cached snapshot), a firewall
   with an allowlist, secrets injected as environment, no standing credentials. Destroyed or paused at the end. (Claude Code on the web and Copilot's
   cloud agent both run on ephemeral Linux runners; Copilot's is GitHub Actions.)
3. **Loop.** Model call, tool call (read, search, edit, shell, web, MCP), result back into context, repeated. Context is compacted when long;
   subagents take side work in their own context; a plan or todo list is kept; hooks run outside the model before and after tools.
4. **Safety layer.** Permission modes and allow/deny rules per tool, sandboxed shell, checkpoints before edits (rewind), protected branches.
5. **Delivery.** A branch (`claude/...`, `copilot/...`), commits with attribution, a draft PR with a body that names the issue, changed paths and
   checks; the session stays subscribed to the PR.
6. **Feedback.** Check runs, review comments and merge conflicts wake the same session, which fixes and pushes until green; the user is notified only
   at a decision or at the end.
7. **Background and scheduled work.** Sessions continue with the laptop closed; schedules and webhooks start new sessions; results are pushed to a phone.
8. **Observability.** A transcript, a diff view, cost and token meters, an audit log; sessions can be resumed, forked and shared.

## The fleet's equivalent, mapped to Cloudflare
| Cloud agent stage | Cloudflare building block | State today | Gap, owner issue |
|:--|:--|:--|:--|
| Session and resume | Agents SDK Durable Object (CodeSession), SQLite, replayable SSE | live (qnfo-agents 0.9.1) | fork and share a session; 1002236 |
| Instructions and memory | CLAUDE.md in the repo, SYSTEM-MAP, D1 `ops_config`, Vectorize | whole CLAUDE.md is read | summary plus keyword skills; 1002223 |
| Isolated machine | Sandbox SDK container (Container DO), snapshot of the repo, outbound allowlist | qnfo-ops container tools exist; not on the CodeSession path | run the changed suites in a sandbox before the PR; 1002221, 1002234 |
| Tools | qnfo-ops 70+ tools, Code Mode, MCP client and server, Cloudflare API MCP | live; owner turns run read scope | write scope for the signed-in owner; 1002216 |
| Plan and todo | plan gate, `propose_plan`, TaskCreate-like list in session SQLite | plan gate live | persistent task list in the UI; 1002222 |
| Subagents | child CodeSession with own context | none | Explore child runs; 1002224 |
| Hooks | gates, review gate, canary, deploy probes | structural hooks live | user-defined hooks table `cmd_hooks`; 1002235 |
| Checkpoints and undo | branch per run, canary revert | no UI | one-tap undo card; 1002222 |
| Delivery | `ship_change`, ISSUE-PER-PR-1, branch `ops/issue-N-*`, lane merge | live (qnfo-ops 2.69.1) | |
| Feedback loop | GitHub webhook to session (`/github/webhook`) | live, inert until the secret exists | GitHub App secret; 1002220 |
| Background and schedules | DO alarms, cron, `cf_agent_requests` queue | live | email-reply answers for questions; 1002235 |
| Observability | `cf_agent_runs`, `cmd_log`, AI Gateway, session usage | live; heartbeat 0.9.1 | metric `cmd_run_abandoned_7d`; 1002219 |

## Screens
Three screens plus the command line. The command line is the only way to do anything; screens are read models of the same routes.
1. **Now** (health, queue, spend, what the agent is doing, one card per decision with a reply-by-email path).
2. **Work** (issues, PRs, deploys and runs as one timeline; each item opens its diff, checks and undo).
3. **Portfolio** (programs, products, goals, metrics, anticipated needs; every number has its definition and last measure).
Back-end admin pages fold into `/cmd` verbs (`cmd`, `ops`, `sql`, `deploy`, `container`); no page without a verb, no verb without a probe. Work
is tracked in 1002237 (fold plan, with a UX journey per screen).

## Continuous improvement
The program manager of QNFO.OPS owns a standing goal, "the command line completes a full change with one ask", with a definition of done:
a run that opens an issue, a PR, merges and deploys with no manual step, measured weekly as `cmd_ask_to_deploy_share_30d`. The product and
portfolio managers read the parity table above each cycle and file the next gap as an issue with a doer. Front end and back end maintenance
(dependency age, bundle size, slow routes, dead verbs, unused pages) is a weekly sweep owned by the same manager, filed as issues (1002238).
Anticipation: the manager reads `cmd_log` verbs that fail or repeat, issues that reopen, and the parity gaps, and drafts the next three needs
before they are asked for, as goals in `goals` status `proposed` with the evidence line.

## Failure modes
- Every gap above is a claim about today's code: it is stated from a read on 2026-11-06 and each row carries an issue whose probe re-measures it.
- Folding screens removes a path some loop may read: run `impact` (FLEET-GRAPH-1) on each page route before it goes.
- A command line that can do everything is also the largest attack surface: the owner sign-in code, write scope per session, claims, review gate and
  canary stay the structural limits.
