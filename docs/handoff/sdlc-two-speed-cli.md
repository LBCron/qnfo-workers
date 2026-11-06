# Handoff: two-speed, full-lifecycle command line (SDLC-OWN-1 build)

Charter pillar: autonomy. Program: QNFO.OPS. Owner directive 2026-11-06 (recorded as SDLC-OWN-1 in CLAUDE.md, merged in PR 8200).
Status: research and design done; build not started. Any code agent (Copilot, Claude Code, the code loop) can pick this up from this file and its issue.

## Goal
One ask to the command line returns a quick, token-lean answer first, then the same session continues, unprompted, through research, design,
build, test, deploy, verify and measure, acting as the product manager, covering front end and back end together, and leaving a handoff
(issue plus draft PR plus this kind of file) when it cannot finish. The session runs on the back end and keeps memory the front end reads.

## What already exists (read on 2026-11-06, do not rebuild)
- `docs/COMMAND-LINE-PRODUCT.md` maps a cloud coding agent's stages to Cloudflare and lists the gaps with owner issues (1002216-1002238 in D1 `agent_issues`):
  session and resume live (qnfo-agents CodeSession), delivery live (`ship_change`), GitHub webhook feedback live but inert until the App secret exists,
  persistent task list, subagent children, user hooks, fork/share, instructions-and-memory summary (1002223) all open.
- `qnfo-agents/README.md`: `FleetCodeAgent` Durable Object, `CodeSession` with replayable events (`GET /code-sessions/<id>/events?after=<seq>`),
  `runFiber` turns, schedules, MCP server and client, Code Mode.
- `docs/CODE-AGENT-CONSOLE.md`, `docs/CODE-AGENT-UX.md`, `docs/CLAUDE-CODE-CLOUD-VS-QUNIVERSE.md`: prior design and comparison.

## The gap this work closes
1. No lane split. A turn returns when the model stops; nothing starts a second, deeper pass by itself.
2. No product-manager step. Nothing restates the goal and metric, places it on the roadmap, or files the foreseeable follow-ups before or after the build.
3. No front-end/back-end pairing check. A change can ship one side with no counterpart issue.
4. No handoff-on-stop. A session cut off by a usage limit or timeout leaves no draft PR, handoff file or follow-up issue.
5. Memory the front end reads: session decisions are in session SQLite and `cf_agent_runs`; the dashboard and chat clients do not read a shared per-owner memory record (row 1002223 covers the instruction side only).

## Design
- **Lanes.** `CodeSession` turn 1 = fast lane: answer from SYSTEM-MAP and a targeted read, at most a few lines, event type `lane:fast`. On completion the
  session enqueues turn 2 = deep lane (`lane:deep`) in the same session, using the existing `runFiber` and `cf_agent_requests` queue. The deep lane runs the
  stages in order and writes one artifact per stage (note, issue, PR body, probe, metric), event type `stage:<name>`.
- **Product-manager step.** A fixed first stage of the deep lane: goal line, user, success metric, acceptance criteria, non-goals, charter pillar, roadmap place,
  follow-ups filed as issues. Output is a row in `goals` or an `agent_issues` row, never prose only.
- **Pairing check.** Before the PR opens, a check lists the front-end surface and the back-end surface the diff touches; a missing side becomes a filed
  counterpart issue with a doer and a closing probe, and the PR body links it. Reuses ISSUE-PER-PR-1.
- **Handoff on stop.** On any non-success end of a turn (eviction twice, usage limit, timeout, explicit stop), the session writes `docs/handoff/<slug>.md` to a draft
  PR branch, files the follow-up issue, and records both in the session's events. Reuses `ship_change`.
- **Shared memory.** A per-owner record in D1 (table name to be chosen by the implementer after `impact` on existing memory tables, see FLEET-GRAPH-1) holding
  decisions, preferences-in-force and open handoffs; written by the session, read by the dashboard `/cmd` view and the chat clients. Canonical copy is Cloudflare only.

## Acceptance criteria
- A single `/cmd` ask produces a fast answer event and then a deep-lane event sequence without a second ask, verified by a session transcript in `cf_agent_runs`.
- The deep lane records goal, metric and acceptance criteria before the first edit (a row exists with a timestamp earlier than the first `ship_change`).
- A change touching only one side files a counterpart issue (test with a worker-only diff and a dashboard-only diff).
- Killing a turn twice produces a draft PR with `docs/handoff/<slug>.md` and an issue (test through the existing `code-session.test.mjs` harness).
- The dashboard `/cmd` view shows the shared memory record. A phone journey exists for it (UX-JOURNEYS-1).
- Metric `cmd_ask_to_deploy_share_30d` (already named in COMMAND-LINE-PRODUCT.md) is registered with its trigger, or an existing registration is reused.

## Failure modes
- Runaway deep lane spends the budget on a trivial ask: cap stages by a classification of the ask; BUDGET-SOFT-ROUTE-1 steers to cheaper models, never stops work.
- Fast answer is wrong and the deep lane contradicts it: the deep lane must state the correction as its first event.
- Handoff file written but the PR cannot be opened (token, rate limit): the file and issue text are kept in session SQLite and retried by the existing queue; the issue carries a closing probe.
- Memory record becomes a second source of truth: Cloudflare D1 is the only copy; chat clients read and cache, never own.

## Unverified, to settle first
- Where the CodeSession system prompt lives. It is not in `qnfo-agents/src/session.js` (155 lines, read 2026-11-06); likely `qnfo-ops`. Locate it with `python scripts/worker_outline.py` before editing; never read a large worker whole (WORKER-OUTLINE-1).
- Whether `agent_issues` 1002223 and 1002235 already cover the memory and hooks parts; read them before filing duplicates (re-read main and open PRs immediately before building).
- Deploy rules for any worker touched: VERSION bump via `scripts/worker_release.py`, `probes.json`, mirror file, `probes: none (<reason>)` in the PR if none.
