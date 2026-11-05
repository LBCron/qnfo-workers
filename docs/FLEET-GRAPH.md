# FLEET-GRAPH-1: the fleet code and topology graph

Charter pillar: autonomy (also core and cost). Shipped 2026-10-19. Owner request: integrate a Graphify-like capability
(github.com/Graphify-Labs/graphify) across the Quniverse fleet to improve efficiency and autonomous code and systems
administration, with no proprietary component, no added cost and no vendor lock-in.

See also `docs/KNOWLEDGE-GRAPH.md` (KG-CURATE-1): the content knowledge graph in the same database (`nodes` / `edges`), curated by `scripts/kg_curate.mjs`
in this build, joined to this graph at `worker:<name>`, `d1:<db>`, `r2:<bucket>` and `domain:<host>`.

## What it answers

One call instead of reading thirty `worker.js` files, thirty `wrangler.toml` files and the Cloudflare dashboard:

| Question | Query |
|---|---|
| What breaks if I change this table, binding, cron, route or function? | `GET /fleet-graph/impact?id=<node>&depth=3` (direction `up`) |
| What does this function or worker depend on? | `GET /fleet-graph/impact?id=<node>&direction=down` |
| Who reads and writes `agent_issues`? Which workers bind `qnfo-audit`? | `GET /fleet-graph/resource?id=d1t:qnfo-audit.agent_issues` |
| Everything about one worker: declared vs live bindings and crons, routes, tables, callers, findings | `GET /fleet-graph/worker?worker=qnfo-ops` |
| How is A connected to B? | `GET /fleet-graph/path?from=<a>&to=<b>` |
| Where is the drift? Dead references? Orphans? | `GET /fleet-graph/findings?severity=warn` |
| Is the graph current? | `GET /fleet-graph/freshness` |
| What is the exact id of `X`? | `GET /fleet-graph/find?query=X` (refuses an ambiguous name and lists the candidates) |

Host: `https://qnfo-memory-mcp.q08.workers.dev`. The routes are open and read-only (OPEN-ACCESS-1): parameterised queries,
bounded depth and rows, no caller SQL. The same queries are MCP tools on `/mcp` (bearer `MCP_TOKEN`):
`fleet_graph_find`, `fleet_graph_node`, `fleet_graph_impact`, `fleet_graph_path`, `fleet_graph_worker`,
`fleet_graph_resource`, `fleet_graph_findings`, `fleet_graph_freshness`. Secret NAMES (never values) are served only to
authenticated MCP clients; the open routes give a count.

Rule for sessions and loops (CLAUDE.md, FLEET-GRAPH-1): before changing a binding, D1 table or trigger, cron, route or an
exported function, run `impact` on it and act on what it returns; check `freshness` first and read the code when the graph
is older than the change you are reasoning about.

## Node ids

`worker:<name>`, `fn:<worker>#<function>` (top-level units; handlers are `fn:<worker>#default.fetch`,
`#default.scheduled` ...; class methods `#Class.method`), `class:<worker>.<Class>`, `binding:<worker>.<NAME>`,
`secret:<worker>.<NAME>`, `d1:<db>`, `d1t:<db>.<table>`, `d1v:<db>.<view>`, `d1trg:<db>.<trigger>`, `kv:<namespace id>`,
`r2:<bucket>`, `vz:<index>`, `queue:<name>`, `wf:<workflow>`, `do:<script>.<Class>`, `cron:<worker>@<expr>`,
`route:<pattern>`, `domain:<host>`, `host:<external host>`, `svc:workers-ai` (and other platform services),
`migration:<file>`, `gha:<workflow file>`, `script:<path>`.

Relations: `contains`, `calls`, `refs` (a function passed as a value), `uses_binding`, `has_binding`, `binds`,
`has_secret`, `reads`, `writes`, `creates`, `http_calls`, `references` (a fleet URL in a string), `has_cron`, `serves`,
`consumes`, `produces`, `fires_on` (trigger -> table), `defines` / `drops` (migration -> table/view/trigger), `runs`
(workflow -> script), `chained_after` (workflow_run), `tails_to`, `hosts_workflow`, `runs_container`.

Every edge carries `confidence` (Graphify's vocabulary plus one): `EXTRACTED` (read directly from code or config),
`INFERRED` (a heuristic: a table resolved by name, a URL held in a variable, a function passed as a value), `OBSERVED`
(read from the live Cloudflare account), `AMBIGUOUS`. Every row carries `scope`: `code` (the repository at the built
commit) or `live` (the account at build time). The same node can exist in both; their difference is the drift.

## How it is built

`scripts/fleet_graph.mjs`, run by `.github/workflows/fleet-graph.yml` on every push to main that changes code,
configuration, migrations, scripts or workflows (a dry run on pull requests), and by repository_dispatch
`fleet-graph-tick`, which qnfo-cloud-ops FLEET-GRAPH-CADENCE-1 sends from its 10-minute tick when main has been quiet for
60 minutes (the second path; GitHub `schedule` never fires here).

- **code scope**: every live worker directory (worker.js + wrangler.toml, no RETIRED/FOLDED), plus a root-level
  worker.js + wrangler.toml pair when present (identified by its configured worker name). worker.js is parsed with
  acorn 8.19.0 (MIT); wrangler.toml with smol-toml 1.9.1 (BSD-3). Extracted: top-level functions, handlers and class
  methods; calls between them; `env.X` reads (direct, `this.env.X`, destructured, aliased); SQL in string and template
  literals (tables read/written/created, resolved to the bound database); `fetch()` to literal or constant URLs (fleet
  hosts map to workers, others become `host:` nodes); migrations (which file defines each table, view, trigger); workflows
  and the scripts they run; scripts' SQL against qnfo-audit.
- **live scope**: Cloudflare API, read-only calls: scripts and their bindings (an allow-list of fields; `text` and `json`
  never pass, enforced by a canary in the selftest), crons, workers.dev, routes, custom domains, D1, KV, R2, queues,
  Vectorize, Workflows, and the live schema of every D1 database except qnfo-identity and qnfo-outreach (tables, views,
  triggers; what each trigger fires on, reads and writes; what each view reads).
- **findings** (both scopes): `env-undeclared`, `env-optional-unset`, `binding-declared-not-live`, `binding-live-not-declared`,
  `cron-drift`, `untracked-worker`, `undeployed-dir`, `sql-table-missing`, `resource-orphan`, `binding-unused`, `trigger-depth`
  (longest trigger cascade per database, and any cycle). `env-optional-unset` (info, OPTIONAL-ENV-1) is an undeclared env name
  whose every read carries its own fallback (`env.X ?? d`, `env.X || d`, `(env && env.X) || d`, `const { X = d } = env`, where d
  is not itself an env read) and that is not credential-shaped; a token, key, secret or password name stays a warn
  `env-undeclared` whatever its fallback, and so does a name with even one bare read.

Storage: qnfo-graph D1, tables `fg_node`, `fg_edge`, `fg_finding`, `fg_state` (the content knowledge graph's `nodes` and
`edges` are untouched). Writes are a diff by content hash, so a push that changes one worker writes a few hundred rows; a
build refuses to write more than `--max-writes` (150,000) row changes. qnfo-graph is in the weekly continuity export.

## Freshness, metrics and the loop

- `fleet_heartbeat` row `fleet-graph` and `cadence_sla` surface `fleet-graph` (interval 60, SLA 120): a stalled build is
  counted by `cadence_overdue_over_120m` and `sla_breaches_over_120m`.
- Metric `fleet_graph_findings_warn` (runner-written each build) with its trigger: evaluateMetricTriggers files one issue
  whose lever is the findings list, fixed at the cause through the canonical path.
- `capability_ledger` `fleet-graph`, `spof_registry` `fleet-graph build`, `decision_log` (migrations/2026-10-19-fleet-graph.sql).

## No lock-in

- The graph is plain SQL tables and a JSON file. Each build writes a gzipped node-link snapshot (NetworkX
  `node_link_data` shape: directed multigraph, links keyed by relation) to R2 `qnfo-backups/fleet-graph/latest.json.gz`
  and `fleet-graph/<yyyymmdd>.json.gz`; NetworkX, Gephi or a short script read it with no Cloudflare dependency.
- `node scripts/fleet_graph.mjs --scope code --sqlite-out graph.db` builds the same schema locally in seconds (Node 22,
  after `npm install --no-save acorn@8.19.0 acorn-walk@8.3.5 smol-toml@1.9.1`); `--json-out graph.json` writes the
  node-link file. The qnfo-memory-mcp queries run unchanged against it through a D1-shaped shim
  (qnfo-memory-mcp/fleet-graph.test.mjs does exactly that).
- No LLM is called anywhere in the build. Cost: GitHub Actions minutes on a public repository, D1 reads and diff writes
  inside the existing Workers Paid allowance, one R2 object per day.

## Why not run Graphify itself

Graphify (Apache-2.0/MIT) parses code into a graph well, but models none of what fleet administration turns on: bindings,
D1 tables and triggers, crons, routes, queues, live-versus-declared drift. Its token-savings figures are self-reported
against reading every file (about 1x on small corpora by its own table), its semantic pass calls a paid or third-party
model unless disabled, and it shipped 257 releases in six months. The graph here keeps Graphify's useful conventions
(deterministic AST extraction, confidence labels on edges, refusing ambiguous names, node-link export) and adds the
Cloudflare topology. code-review-graph and codebase-memory-mcp (MIT) were the other candidates for the parser and remain
drop-in alternatives behind the same tables; GitNexus was excluded (PolyForm Noncommercial).

## Limits and failure modes

- Static analysis, not data flow. Calls resolve by name within one file; a function reached through a variable or a
  dynamic import is missed. `env` access through a parameter not named `env` is caught only for declared names.
- SQL built at run time (`${table}`) is skipped and counted (`sql_dynamic_names`); lower-case SQL is not detected.
- Name-resolved edges are `INFERRED`: treat them as leads. A finding is a line to read, not a verdict.
- The graph is as current as its last build (`/fleet-graph/freshness`): a change deployed outside git appears within
  about 70 minutes on a quiet main, at once after a push.
- The topology is a reconnaissance map. Secret values never enter it; secret names are withheld from the open routes;
  the schema of qnfo-identity and qnfo-outreach is never read; the build log prints counts only (public repository).
