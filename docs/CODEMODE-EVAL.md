# Code-mode MCP surface for qnfo-ops: evaluation (CODEMODE-SURFACE-1)

Charter pillar: cost. Roadmap item RM-CODEMODE-MCP-SURFACE-1 (agent_issues 1000639, roadmap 1683). Source: cloudflare/agents codemode (about 1,000 tokens for two tools against about 1.17M for one tool per endpoint; abstract-level evidence, read the full text before relying on it, CITE-FULLTEXT-1).

## What shipped

`POST /mcp` with `tools/list?surface=codemode` (or `params.surface = "codemode"`) returns exactly two tools:

| Tool | What it does |
|:--|:--|
| `ops_search` | keyword search over the `OPS_TOOLS` names and descriptions; returns name plus the first description line |
| `ops_execute` | runs one named tool through the existing `execTool` path, so every gate (policy-gate shadow, arg aliases, redaction) and the audit row apply unchanged; refuses itself and unknown names |

The default `tools/list` stays the whole catalogue. Since qnfo-ops 2.63.0 the pair is no longer inside `OPS_TOOLS`: an earlier revision appended it there, which put two tools the agent loop cannot execute (`execTool` has no branch for them) into every model request and into the default REST and MCP lists.

Every `tools/list` and `tools/call` answer of the MCP route logs its size: `cloud_ops_events` kind `ops-surface-size`, `text` = `tools/list` or `tools/call:<tool>`, `meta` = `{"surface":"default"|"codemode","chars":<answer chars>,"req_chars":<request chars>}`. The first logger inserted a column the table does not have and wrote nothing (0 rows since 2026-11-03).

## Surface size (static)

`node scripts/codemode_surface_size.mjs --check` reads `qnfo-ops/worker.js` and prints the size of the tools/list answer a client pays once per session. Measured on the 2.63.0 source:

| Surface | Tools | Characters | Tokens (chars / 4) |
|:--|--:|--:|--:|
| default (`OPS_TOOLS`) | 77 | 40,866 | 10,217 |
| code mode (`OPS_CODEMODE_TOOLS`) | 2 | 548 | 137 |

The code-mode list is 1.34 percent of the default list. `--check` fails if the pair re-enters the catalogue, the code-mode list is not two tools, or it exceeds 5 percent of the default list; `qnfo-ops/codemode-surface.test.mjs` pins the same facts plus the logging columns and the route behaviour.

Failure mode stated plainly: the static size is the cost of the list, not of a task. A code-mode client also pays for every `ops_search` answer and for the extra round trip, and a model that does not know the tool names may search more than once, so the saving per task can be smaller than the list ratio. That is what the 20-task run measures.

## How the 20 tasks are measured

1. Take 20 fixed operator tasks (fleet status, one D1 read, one issue read, one graph lookup, ...), each with a deterministic success check on the final tool result.
2. Run each task twice through the same model: once against `tools/list` (default), once against `tools/list?surface=codemode`.
3. Tokens per task = the logged `ops-surface-size` rows of that run (`chars` and `req_chars`, summed per surface, divided by 4) plus the model's own turns from `ops_ai_log`; success = the check.
4. Keep the pair only if tokens per task fall and success does not drop.

## Pending: the 20-task result

The 20 live runs are not done; they need a model-driven client with the ops key, which this change does not have. The issue stays open on the heading that will carry the result. A follow-up row is filed (`ROADMAP-1: QNFO.OPS RM-CODEMODE-MCP-SURFACE-1.2`) with this file as its code anchor. Until the section that records the measured tokens per task and the task success on 20 tasks exists, the code-mode surface stays opt-in and the default list is unchanged.
