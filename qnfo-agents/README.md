# qnfo-agents

The fleet's Cloudflare Agents SDK agent (CF-AGENTS-1, charter pillar `autonomy`). Owner directive 2026-10-25: every Cloudflare
agent tool and function is reachable from the fleet console (https://fleet.qnfo.org/cmd) and the ops endpoint (ops.qnfo.org).

Address: https://agents.qnfo.org (machine origin `qnfo-agents.q08.workers.dev`).

Models are routed via AI Gateway dynamic routes — see qnfo-ops issue #7.

## What it does

One Agent class, `FleetCodeAgent` (a SQLite-backed Durable Object from `agents@0.30.1`), runs coding and operations turns:

| Agents SDK feature | Here |
|---|---|
| Agent Durable Object, state, SQL | `FleetCodeAgent`, instance `fleet` by default; every turn is a row in its `runs` table and in D1 `cf_agent_runs` |
| Resumable code chat | `CodeSession` persists ordered events and turn state in SQLite; resume with `GET /code-sessions/<id>/events?after=<seq>` |
| Durable execution | each turn is a `runFiber`; a turn cut off by eviction is re-run once (`onFiberRecovered`), twice means failed |
| Scheduling | `POST /schedules` or the `schedule_turn` tool: a cron (at most every 5 minutes) or a delay; each fires a new turn |
| Callable methods | `run`, `runs`, `status`, `schedules` over WebSocket at `/agents/fleet-code-agent/<instance>` (trusted callers) |
| MCP server | `POST /mcp` (`createMcpHandler`, stateless): public clients get `repo_read_file`; trusted callers get every tool plus `agent_run` and `agent_status` |
| MCP client | `POST /mcp-servers {name, url}` or the `mcp_connect` tool; the server's tools join later turns |
| Code Mode | the `codemode` tool: the model writes JavaScript that calls every tool as `codemode.<name>()` in a Dynamic Worker (`LOADER`, no outbound network); `POST /sandbox {code}` runs code without a model |
| Models | Workers AI through AI Gateway `default` (`createAI`): agent turns and `CodeSession` use `dynamic/standard`; route overrides are dynamic-route-only, and the route owns model fallbacks |

Tools: `repo_read_file` (the public repository), `fleet_sql` (read-only SQL on qnfo-audit; sign-in and secret tables refused),
`ops_catalog` and `ops_call` (the qnfo-ops tool surface: Cloudflare API, D1, R2, KV, GitHub, workspace, containers, deploys),
every qnfo-ops tool again inside Code Mode as `codemode.ops_<name>`, `propose_code_task`, and with the write scope `file_issue`,
`schedule_turn` and `mcp_connect`.

Code changes go through the code loop: `propose_code_task` returns a proposal (`code-task: repo=qnfo-workers path=<file>` plus
an anchor) to the caller, and the console files it as an owner task when the owner taps it, so the issue carries the owner-request
provenance the planner trusts (INTAKE-PROVENANCE-1). The agent never writes a code task under its own name.

## Who may do what

There are no secrets. A caller is `ctx.props.caller`, which only a service binding can set.

| Scope | Who | What |
|---|---|---|
| public | anyone | `GET /`, `/health`, `/tools`; `POST /mcp` with `repo_read_file`. No model call, no fleet data |
| read | `qnfo-fleet-dashboard`, `qnfo-ops` (each verifies the owner first) | turns, read-only ops tools, D1 reads, sandbox runs, run history |
| write | the same callers with `x-agent-scope: write` (the console sends it only after a fresh owner code) | every ops tool, fleet issues, schedules, MCP connections |

The read-only ops tool list (`OPS_READ_ONLY` in src/lib.js) equals `CMD_TOOL_READ_ONLY` in the dashboard; worker.test.mjs holds them equal.

## Routes

Open: `GET /`, `GET /health`, `GET /tools`, `POST /mcp`.
Trusted: `POST /code-sessions {text}`, `POST /code-sessions/<id>/turns {text}`, `GET /code-sessions/<id>/events?after=<seq>` (replayable SSE), `GET /code-sessions/<id>`, `GET|POST /code-sessions/<id>/plan {approved}` (POST needs the write scope), `GET /approvals`, `POST /approvals/<run id>/<call id> {approved}` (write scope),
`POST /run {text, instance?, wait_ms?}`, `GET /runs`, `GET /runs/<id>`, `GET|POST /schedules`, `DELETE /schedules/<id>`,
`GET|POST /mcp-servers`, `DELETE /mcp-servers/<id>`, `POST /sandbox {code}`, `/agents/fleet-code-agent/<instance>`.

## Build and deploy

`src/index.ts` and `src/lib.js` are the source. `npm ci && npm run build` writes `worker.js`, one self-contained module (the fleet's
load gate and deploy transports take one module per worker), and copies it to `deployed-current.worker.js`. The version is
`package.json` `version`; the bundle's first line is `var VERSION = "<it>"` for the fleet's version guards. Bump it in package.json
and rebuild.

The directory is WRANGLER-ONLY: the Durable Object migration needs wrangler, so `.github/workflows/deploy-qnfo-agents.yml` deploys
it on a push to main (it rebuilds the bundle and fails when the committed one differs, takes the deploy-guard lock, writes
`fleet_deploys`, and fails closed unless `/health` answers the VERSION, `/tools` lists the tools and a public `POST /run` answers 403).

`node worker.test.mjs` is the offline suite.

## Fleet loops (CF-AGENTS-LOOPS-1, 0.2.0)

Any loop that writes `qnfo-audit` reaches the agent without a binding or a secret. Examples are a worker, a fleet-exec workflow's `sql` step, the hourly portfolio and program manager workflow, or the code loop. It inserts a row:

```sql
INSERT INTO cf_agent_requests (requester, kind, prompt) VALUES ('program-manager:research', 'run', 'Read v_program_focus for research and file an issue for each focus item with no doer.');
INSERT INTO cf_agent_requests (requester, kind, code) VALUES ('portfolio-manager', 'sandbox', 'async () => (await codemode.fleet_sql({sql: "SELECT * FROM v_program_risk"}))');
INSERT INTO cf_agent_requests (requester, kind, prompt, cron) VALUES ('portfolio-manager', 'schedule', 'Review allocations; file issues for slipping programs.', '35 * * * *');
```

The 5-minute cron drains up to 3 rows per tick, critical first, and writes `status`, `run_id`, `result` and `error` back to each row. Each requester runs on its own agent instance (`loop-<requester>`, or `instance` when given), so its schedules and history stay its own.

**Spend governor (QNFO-AGENTS-BUDGET-1, 0.7.0).** The drain takes its share of a daily neuron budget, `ops_config qnfo_agents_daily_neurons` (default 250000, `off` disables): each tick starts the model requests that fit `left / ticks-left`, a tick whose share is under one request starts one every few ticks, and a spent day keeps one request an hour (slower, never stopped). `critical` requests, requests on a `lever-*` instance (the lever replies of the program managers, a measured verdict window) and requests that call no model (`sandbox`, `schedule`) are never deferred; a request the budget cannot start leaves the queue after 110 minutes, failed with `shed: ...` (SLA-120M), and the loop that wrote it files the next one. Spend is read from `ai_spend_ledger` (caller `qnfo-agents`) and priced at 40,000 neurons per million input tokens and 120,000 per million output tokens (the Cloudflare meter, 2026-11-04). `ops_config qnfo_agents_run_neurons_est` (default 2500) is the planning estimate of one run.

The loop scope gives a request the read-only ops tools, D1 reads, the repository, Code Mode, and the MCP tools of servers the console connected. It can also file fleet issues (source `qnfo-agents`), propose code tasks (returned in `result`) and create schedules on its own instance. It has no mutating ops tools and cannot connect MCP servers.

`v_cf_agent_requests_health`, `queue_sla` row `cf-agent-request` and metric `cf_agent_requests_over_120m` watch the queue. `cfagent requests [requester]` lists the queue in `/cmd`.

## CodeSession budget, plan gate and approval pause (0.8.0)

**Budget (RM-CODE-SESSION-1).** Each `CodeSession` has a neuron budget (`POST /code-sessions {text, budget?}`, 1,000 to 1,000,000, default 100,000). Before each step the session replaces earlier tool results with a short head (1,200 characters; 240 past 60 percent of the budget), a session past 60 percent runs at most 10 steps, and a spent one runs at most 6 steps on `dynamic/value`: downgraded, never stopped (BUDGET-SOFT-ROUTE-1). `POST /code-sessions/<id>/turns {text, escalate:true}` runs one turn on `dynamic/premium` while the budget is ok. The stream announces the state in a `budget` event, a `complete` event carries tokens, neurons and cost, and every turn, done or failed, is one `cf_agent_session_usage` row. Measured before: the two completed sessions took 252,213 and 359,603 input tokens for one turn.

A loop starts a read-only session with `INSERT INTO cf_agent_requests (requester, kind, prompt) VALUES ('<loop>', 'code_session', '<request>')`; the drain gives it a 30,000-neuron session and writes the turn's tokens and cost back to the row. The worker seeds ten read-only replay turns (requester `rm-code-session-1`) once, because RM-CODE-SESSION-1 is done when ten turns have completed through the stream with tokens and cost recorded; `ops_config qnfo_agents_replay = off` stops the seeding.

**Plan gate (RM-CODE-SANDBOX-1).** A session started with the write scope (the console sends `x-agent-scope: write` only after a fresh code) reads freely. Every tool that changes something is refused until the model has called `propose_plan {title, steps, files}` and the owner has approved it (`POST /code-sessions/<id>/plan {approved:true}`, write scope). An edit (`workspace_write|edit|patch|delete`, `github_file_write`) then takes a work claim on its file through the `GUARD` service binding to qnfo-deploy-guard (owner `code-session:<id>`, one hour; a refusal names the holder; an unreachable service is recorded and the edit proceeds, CLAIM-UNREACHABLE-FALLBACK-1), and `github_pr` is refused until some edit has been claimed. Plan, denial, claim, edit and pull request are `plan`, `gate`, `claim`, `edit`, `pr` events on the stream and rows in `cf_agent_sandbox_log`. Merges stay with the lane.

**Approval pause (RM-DURABLE-INTERRUPT-1).** `send_email` (and `stage_irreversible_step`, which sends nothing) run as a `@cloudflare/computer` execution with `onInterrupt: "replay"`: the run pauses at the interrupt, survives a Durable Object restart, and resumes the same run when `POST /approvals/<run id>/<call id> {approved}` answers it (write scope; `GET /approvals` lists the pauses of the caller's runs). `cf_agent_approvals` holds one row per run and action: `awaiting`, `approved` or `rejected`, `executed` or `failed`, and `restart_survived`. The `approval_selftest` request (seeded once, no model call) stages a step, resets the object with `ctx.abort()`, finds the pause in the fresh instance, approves it as `selftest` and waits for `executed`.
