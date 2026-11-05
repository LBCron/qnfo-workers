# Code-agent console (CODE-AGENT-CONSOLE-1)

Charter pillars: autonomy, cost. Owner request 2026-10-29: the fleet dashboard command line (`/cmd`, qnfo-fleet-dashboard 1.77.1) should work like a desktop code agent
(Claude Code, GitHub Copilot agent), entirely server side on Cloudflare, cost-optimised. The owner reports it is kludgy and does not work.

## What exists
- `/cmd` is a deterministic verb parser inside a 17k-line worker plus, since 1.77.0 (CMD-AGENT-1), a hand-off of plain English to the durable qnfo-ops agent, polled by the page.
- `qnfo-agents` 0.2.6 is a Cloudflare Agents SDK worker (Agent Durable Object, fibers, schedules, MCP client and server, Code Mode sandbox, Workers AI).
- Models: `deepseek-v4-flash-wa` and `deepseek-v4-pro-wa` (1M context) in `scripts/model-policy.json`.
- Not reproduced: the failure itself. `/cmd` actions need the owner's emailed code, so the concrete failing cases are unmeasured. Slice 0 (below) records what a signed-out run showed.

## Target shape
One agent session is one Agents SDK Durable Object (`CodeSession`), streamed to the browser over SSE or WebSocket. The page and `scripts/qcli.mjs` are thin clients of the same route.

| Desktop-agent capability | Server-side Cloudflare piece |
|:--|:--|
| Streaming turn with visible tool steps, interrupt, resume | Agents SDK DO, streamed text, SSE; state survives reconnect |
| Read and edit files, run shell and tests | Sandbox SDK container with the repo, Code Mode for cheap tool use |
| Git and PRs | GitHub App token through the fleet's existing route; work claims taken before edits |
| Plan then approve | Plan message the page renders; destructive tools need the existing fresh code |
| Cheap context | stable cached prefix, trimmed tool results, rolling summary, two-tool code-mode surface (search plus execute) |
| Model | DeepSeek V4 Flash first, Pro on escalation, through AI Gateway (cache, logs); Workers AI free allowance first |
| Slash commands and `/cmd` verbs | existing parser stays as a fast path before any model call |

Cost levers, in order: deterministic verb parse (no tokens), flash model, cached prefix, trimmed tool output, code-mode surface, summary compaction, and a per-session neuron budget that downgrades the model and never stops work (BUDGET-SOFT-ROUTE-1).
Free-of-charge limits, stated plainly: Workers AI's free allowance is 10,000 neurons a day; the Sandbox container needs the Workers Paid plan the fleet already has, so it is cheap, not free.

## Slices
0. Failure inventory: ten real `/cmd` turns replayed through `qcli.mjs`, with the failing stage named (RM-CMD-FAILURES-1).
1. `CodeSession` streaming endpoint in qnfo-agents plus a chat pane at `/cmd` (RM-CODE-SESSION-1).
2. Sandbox file and shell tools with claims, plan/approve and PR creation (RM-CODE-SANDBOX-1).
3. Retire the polling hand-off and the duplicated verb UI in qnfo-fleet-dashboard once slice 1 passes the same ten turns.

Counter-argument: rewriting a working verb parser risks regressions, so the parser stays as the first stage and slice 3 removes only what slice 1 replaces.
Failure mode: a sandbox shell with repo write access is a prompt-injection target; edits stay behind work claims, PRs and the existing merge gates.

## Slice 0 inventory (RM-CMD-FAILURES-1, run 2026-10-29 12:40Z, signed out, `scripts/qcli.mjs` against fleet.qnfo.org)

This is a ten-turn signed-out public baseline, **not** the required ten authenticated owner turns. It did not execute a code change, fleet probe, or decision. Each failing row links to [#5442](https://github.com/QNFO/qnfo-workers/issues/5442), the inventory issue; no separate stage-specific remediation issue was found.

| # | Turn | Result | Failing stage / linked issue |
|:--|:--|:--|:--|
| 1 | `status` | answered in 1 s | none |
| 2 | `help` | answered in 1 s | none |
| 3 | `tools` | answered in 2 s (75 tools) | none |
| 4 | what is the constraint program right now | `error: bad id` after 5 s | polling — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |
| 5 | show open critical issues | `error: bad id` | polling — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |
| 6 | why did deploy-gate fail on main today | `error: bad id` | polling — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |
| 7 | fix the typo in docs/README.md and open a PR | `error: bad id` | polling — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |
| 8 | run the tests for qnfo-agents | `error: bad id` | polling — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |
| 9 | list workers behind main | `used today's 5 plain-English questions` | hand-off (public cap stopped dispatch) — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |
| 10 | `tool fleet_probe {}` | process crash `ERR_USE_AFTER_CLOSE` after emailing a sign-in code | render (qcli non-TTY sign-in prompt) — [#5442](https://github.com/QNFO/qnfo-workers/issues/5442) |

Read-only `qnfo-audit.cmd_log` aggregates checked on 2026-11-01 (only day, owner flag, kind, status, and counts queried; no prompt or answer text): owner-flagged rows were 5 on 2026-10-29, 16 on 2026-10-30, and 4 on 2026-10-31; one 2026-10-30 agent row had an error. These totals do not identify the turn categories or failing stages and are not a substitute for the authenticated replay.

Findings:
1. Every plain-English turn that was still running after the first poll failed. Cause: `send()` polled `/api/cmd/job/` + `j.id` after `j` had been replaced by the poll answer, which carries no id, so the second poll hit `/job/undefined` ("bad id"). The fix is present in `scripts/qcli.mjs` (CMD-CLI-POLL-1); `qnfo-fleet-dashboard/cmd-cli-poll.test.mjs` fails without it and passes with it. The web page's own poller was not tested; whether the owner's "does not work" is this bug or a page bug is still open.
2. A failed turn still spends one of the five public plain-English questions a day, so a client bug used the whole allowance in five turns.
3. A signed-out one-shot run that needs a code crashed after the code email was sent. It now prints how to sign in (`node scripts/qcli.mjs login`) and does not send one.
4. A plain-English answer takes 4-5 s to fail and a model turn is a polled job in `cmd_log`; there is no streamed output, which is the gap `CodeSession` closes.

Not yet measured: authenticated owner turns for a plain-English request, code change, fleet probe, and decision, plus the page's own poller. The aggregate above cannot reveal their inputs or outcomes, and this session did not sign in as the owner. The next valid measurement is a consented, authenticated replay with the exact failing stage recorded; do not infer success from the aggregate counts or from the existing CLI-only fixes. Streaming for model turns remains a separate follow-up tracked by [#5443](https://github.com/QNFO/qnfo-workers/issues/5443).

## Slice 0 inventory from the server's own log (RM-CMD-FAILURES-1, 2026-11-05, qnfo-fleet-dashboard 1.92.0)

The authenticated replay above cannot be run without the owner's emailed code, but the owner's real turns are in `qnfo-audit.cmd_log` (400 rows, 2026-10-02 to 2026-11-04: 195 deterministic actions, 158 plain-English answers, 21 fallbacks, 20 agent runs, 2 stream turns, 4 data answers).
Aggregates only (kind, status, error class and counts; no prompt or answer text was read). `GET https://fleet.qnfo.org/api/cmd/failures?days=30` now answers the same table live, by stage, and `cmdFailureStage` in `qnfo-fleet-dashboard/worker.js` is the single reading of a row.

| Stage | Rows | Of the owner's | What failed | Last seen | State |
|:--|--:|--:|:--|:--|:--|
| model (the AI answer leg timed out or was refused, the line fell back to stored data) | 21 of 179 model turns | 13 | 7 single-model 13 s timeouts (10-06..10-11), 10 three-leg `router_timeout`s (10-20..10-25), 3 multi-leg timeouts, 1 retried timeout, 1 HTTP 401 on every leg (10-12) | 2026-10-25 | none in the 10 days since the second transport (`CMD-DIRECT-LEG-1`) shipped; the last answer took 14 s |
| stream (a CodeSession turn, `kind agent-stream`) | 2 of 2 | 2 | marked `abandoned: the worker stopped before answering` three minutes after it started, although qnfo-agents had finished both (`cf_agent_session_usage` holds their `done` rows): nothing ever wrote the answer back, so every stream turn was logged as a failure | 2026-11-04 | fixed in 1.92.0: the row links to its session and is settled by the sweep, by the job poll and when the stream ends |
| render (the page) | every owner plain-English turn since 1.78.0 | all | the page and `qcli.mjs` had no branch for `kind: "stream"`, so the answer of a CodeSession turn was never drawn (an empty card) | client side, not in `cmd_log` | fixed in 1.92.0: the page draws the stream (text, tool steps, model, tokens, cost), resumes the session on the next line and falls back to polling; `qcli.mjs` polls the turn's job id |
| ops-exec (the qnfo-ops agent run) | 1 of 20 runs | 1 | `abandoned: the agent run did not finish in 30 minutes` (2026-10-30) | 2026-10-30 | the ops-exec path is now the fallback behind CodeSession; a refused start is logged as a `hand-off` row |
| hand-off (a start call refused and the line fell to the next path) | 0 logged | - | the refusal was only a console line, so it could not be counted | - | logged from 1.92.0 as `kind handoff`, `status fallback`, error `hand-off: <path>: <reason>`, with no prompt text |
| worker-stopped, other | 0 | - | - | - | counted by the same route |

Two further findings, both outside the dashboard worker:
1. The microphone ([#5469](https://github.com/QNFO/qnfo-workers/issues/5469)): the dashboard has sent `Permissions-Policy: camera=(), microphone=(self), geolocation=()` since 1.77.1 (MIC-POLICY-1), and `qnfo-fleet-dashboard.q08.workers.dev/cmd` still shows it, but `fleet.qnfo.org/cmd` answers `microphone=()`. The zone ruleset `http_response_headers_transform` (rule "Security headers for all QNFO Pages sites", expression `http.host wildcard "*.qnfo.org"`) sets the header with operation `set`, which replaces the origin's value on every `*.qnfo.org` response. A document served with `microphone=()` cannot call `getUserMedia` in any browser, which is the immediate `NotAllowedError` and the `denied` permission state seen in the Kimi in-app browser, so the denial is not that app's. The page now says this when `document.permissionsPolicy.allowsFeature('microphone')` is false. Changing a zone security-header rule is a security setting and is left to the owner (card `cmd-mic-zone-header-1`); the live journey `fleet / cmd-mic-allowed` fails until it is changed and closes itself afterwards.
2. The earlier ten-turn table is a signed-out baseline; an authenticated replay of a code change, a fleet probe and a decision turn through the stream is the next valid measurement and needs the owner's sign-in, so it stays an open follow-up on [#5443](https://github.com/QNFO/qnfo-workers/issues/5443) rather than being inferred.

Closing probe for the inventory (`remediation_contracts` class `issue-1000804`): failures in the last 24 hours that are defects of the command line itself (stages hand-off, ops-exec, stream, worker-stopped, other) are 0. Model fallbacks are reported separately: a graceful fallback to stored data when a provider times out is the designed degradation, not a defect of the line.
