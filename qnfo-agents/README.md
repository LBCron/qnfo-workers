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
Trusted: `POST /code-sessions {text}`, `POST /code-sessions/<id>/turns {text}`, `GET /code-sessions/<id>/events?after=<seq>` (replayable SSE), `GET /code-sessions/<id>`,
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
