// qnfo-agents: the fleet's Cloudflare Agents SDK worker (CF-AGENTS-1, charter pillar autonomy).
//
// Owner directive 2026-10-25 (verbatim): "ALL CLOUDFLARE AGENT TOOLS AND FUNCTIONALITY SHALL BE AVAILABLE VIA THE CLOUDFLARE
// QUNIVERSE FLEET DASHBOARD: https://fleet.qnfo.org/cmd" and "THIS SHALL ALSO APPLY TO OPS ENDPOINT: I WANT FULL POWER OF ALL
// CLOUDFLARE CODING AGENTS ACROSS QUNIVERSE FLEET".
//
// What it is: one Agent class (FleetCodeAgent, a SQLite-backed Durable Object from the `agents` package) that runs coding and
// operations turns for the fleet with
//   - Workers AI through AI Gateway dynamic routes (createAI from agents/models/ai-sdk, gateway "default"; routes own fallback),
//   - the whole qnfo-ops tool surface (/v1/tools, TOOL-BRIDGE-1) as Code Mode functions in a Dynamic Worker sandbox
//     (@cloudflare/codemode DynamicWorkerExecutor over the LOADER binding), plus direct tools for the repository, D1 reads,
//     code-task proposals, fleet issues, schedules and MCP connections,
//   - durable execution (runFiber: a turn survives eviction and is re-run once on recovery), schedules (cron or delay),
//     callable methods for WebSocket clients, and an MCP client (addMcpServer) whose tools join the turn,
//   - an MCP server at /mcp (createMcpHandler, stateless) so any MCP client reaches the same tools.
// Who may do what (secret-free; the caller is ctx.props.caller, which only a service binding can set):
//   public  GET /, /health, /tools, and /mcp with the public repository reader only. No model call, no fleet data.
//   read    qnfo-fleet-dashboard or qnfo-ops (both verify the owner first): turns, read-only tools, D1 reads, sandbox runs.
//   write   the same callers with x-agent-scope: write (the console sends it only after a fresh owner code): every ops tool,
//           fleet issues, schedules and MCP connections. Code changes still go through the code loop as owner tasks.
//   loop    a fleet loop's request in D1 cf_agent_requests (CF-AGENTS-LOOPS-1), drained every 5 minutes: the read tools plus fleet
//           issues, code-task proposals and schedules on the requester's own instance (loop-<requester>); no mutating ops tool.
// Deploy: WRANGLER-ONLY (a new Durable Object class needs a wrangler migration); .github/workflows/deploy-qnfo-agents.yml
// deploys it with the deploy-guard lock, the fleet_deploys ledger and a /health canary that reverts a push that did not arrive.
// Source is src/; worker.js is the esbuild bundle of src/index.ts (npm run build), kept identical to deployed-current.worker.js.

// Models are routed via AI Gateway dynamic routes — see qnfo-ops issue #7.

import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";
import { createAI } from "agents/models/ai-sdk";
import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { Workspace, unsafeToRepeat } from "@cloudflare/computer";
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
import { generateText, jsonSchema, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { callerOf, clip, scopeOf, codeTaskText, opsToolAllowed, readOnlySql, repoPathOk, runId, safeToolName, scheduleWhen, sliceLines, DRAIN_PER_TICK, loopInstance, validateRequest, EMPTY_TEXT, FINAL_ANSWER_ASK, lastStepText, toolTranscript, codeSessionNeurons, codeSessionCost, isDynamicRoute, emailApprovalPayload, pendingEmailApprovalMatches, emailApprovalGranted } from "./lib.js";

// VERSION is the first line of the bundle (build.mjs writes `var VERSION = "<package.json version>"` there for the fleet guards).
declare var VERSION: string;
const WORKER = "qnfo-agents";
const SDK = "agents@0.30.1";
const REPO = "QNFO/qnfo-workers";
const DEFAULT_MODEL = "dynamic/standard";
const MAX_STEPS = 16;
const TURN_TIMEOUT_MS = 10 * 60 * 1000;
// ALARM-TIMEOUT-1: one hung model call used to hold a Durable Object until the whole-turn timeout and surfaced as an alarm exception
// ("The operation was aborted due to timeout", post_deploy_error_workers); a step now fails after STEP_TIMEOUT_MS and the fallback model answers.
const STEP_TIMEOUT_MS = 3 * 60 * 1000;
const FINAL_ANSWER_TIMEOUT_MS = 2 * 60 * 1000;
const STALE_RUN_MIN = 20;
const APPROVED_SEND_EMAIL = Symbol("approved-send-email");

type Scope = "public" | "read" | "write" | "loop";
const REQUEST_STALE_MIN = 30;
interface Env {
  AI: any;
  AUDIT_DB: D1Database;
  LOADER: any;
  OPS: Fetcher;
  FleetCodeAgent: DurableObjectNamespace<FleetCodeAgent>;
  CodeSession: DurableObjectNamespace<CodeSession>;
}
interface RunInput { text: string; scope: Scope; caller: string; instance?: string; wait_ms?: number }
interface State { runs: number; last_run: string | null; last_status: string | null; version: string }

const CAPABILITIES = [
  "Agent Durable Objects with SQLite state (FleetCodeAgent and resumable CodeSession)",
  "durable turns and replayable CodeSession SSE streams (runFiber)",
  "schedules: cron or delay (schedule, getSchedules, cancelSchedule)",
  "callable methods over WebSocket (/agents/fleet-code-agent/<instance>, trusted callers)",
  "MCP server at /mcp (createMcpHandler)",
  "MCP client: connect any MCP server; its tools join the turn (addMcpServer)",
  "Code Mode: the model writes JavaScript that calls the tools inside a Dynamic Worker sandbox (LOADER)",
  "Workers AI through AI Gateway dynamic route dynamic/standard (createAI); the route owns model fallback for agent turns and CodeSession",
  "the qnfo-ops tool surface: Cloudflare API, D1, R2, KV, GitHub, workspace, containers, deploys (scope-gated)",
  "code changes as code-task proposals the owner files; the code loop opens and merges the PR",
  "fleet loops reach it through D1 cf_agent_requests (run, sandbox, schedule), drained every 5 minutes in the loop scope"
];

const LIMITATIONS = [
  "public routes (GET /, /health, /tools, POST /mcp) expose only the repository reader; every run, schedule and request route needs a trusted caller",
  "writes need the write scope; the default scope is read-only",
  "code changes are filed as code-task proposals for the owner, never merged by this worker",
  "model calls go through Workers AI and AI Gateway and follow the fleet budget routing (cheaper model at a cap)",
  "cf_agent_requests are drained every 5 minutes, so a loop request is not answered inside a single request"
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
function errText(e: unknown): string { return String((e as any)?.message || e).slice(0, 600); }

// ALARM-TIMEOUT-2: 0.2.4 cut the Durable Object alarm exceptions ("The operation was aborted due to timeout", post_deploy_error_workers) from
// 14 to 4 in three hours but not to 0, so a rejection nobody awaits still escapes (an AbortSignal timer firing inside a library that has
// already moved on). The listener records where it came from, with its stack, which the alarm exception never carried, and keeps the
// runtime from reporting it as the invocation's failure. A runtime without the event is left as it was.
try {
  (globalThis as any).addEventListener("unhandledrejection", (ev: any) => {
    try {
      const reason = ev && ev.reason;
      console.error(JSON.stringify({ worker: WORKER, version: VERSION, where: "unhandledrejection", error: errText(reason), stack: String((reason && reason.stack) || "").slice(0, 1500) }));
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    } catch (e) { /* logging must never throw */ }
  });
} catch (e) { /* the event is not supported here */ }
function logErr(where: string, e: unknown) { console.error(JSON.stringify({ worker: WORKER, version: VERSION, where, error: errText(e) })); }

// ---- the qnfo-ops tool surface (TOOL-BRIDGE-1). qnfo-ops trusts this worker by ctx.props.caller on /v1/tools and
// /v1/tools/call only; this worker decides read versus write before it calls (opsToolAllowed).
let opsCatalog: { at: number; tools: Array<{ name: string; description: string; parameters: any }> } | null = null;
async function opsTools(env: Env): Promise<Array<{ name: string; description: string; parameters: any }>> {
  if (opsCatalog && Date.now() - opsCatalog.at < 10 * 60 * 1000) return opsCatalog.tools;
  try {
    const r = await env.OPS.fetch("https://qnfo-ops/v1/tools", { method: "GET", signal: AbortSignal.timeout(15000) });
    const j: any = await r.json().catch(() => null);
    const tools = Array.isArray(j?.data) ? j.data.map((t: any) => { const f = t.function || t; return { name: String(f.name || ""), description: String(f.description || "").slice(0, 600), parameters: f.parameters || { type: "object", properties: {} } }; }).filter((t: any) => t.name) : [];
    if (tools.length) opsCatalog = { at: Date.now(), tools };
    return tools;
  } catch (e) { logErr("opsTools", e); return opsCatalog ? opsCatalog.tools : []; }
}
async function opsCall(env: Env, scope: Scope, name: string, args: unknown, approval?: typeof APPROVED_SEND_EMAIL): Promise<any> {
  if (!opsToolAllowed(name, scope)) return { ok: false, error: "'" + name + "' changes the fleet: it needs the write scope (on the console: cfagent! <request>, which asks for a fresh code)" };
  if (name === "send_email" && approval !== APPROVED_SEND_EMAIL) return { ok: false, error: "send_email requires the durable approval step; call codemode.ops_send_email" };
  try {
    const r = await env.OPS.fetch("https://qnfo-ops/v1/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, arguments: args || {} }), signal: AbortSignal.timeout(120000) });
    const t = await r.text();
    let j: any = null;
    try { j = JSON.parse(t); } catch (e) { j = null; }
    if (!j) return { ok: false, http: r.status, error: clip(t, 800) };
    return { ok: r.ok && j.ok !== false, http: r.status, result: j.result, error: j.error || undefined };
  } catch (e) { return { ok: false, error: errText(e) }; }
}

// ---- direct tools
async function readRepoFile(input: { path: string; ref?: string; from?: number; lines?: number }) {
  if (!repoPathOk(input.path)) return { ok: false, error: "path must be relative inside " + REPO + ", e.g. qnfo-ops/worker.js" };
  const ref = /^[A-Za-z0-9._\/-]{1,120}$/.test(String(input.ref || "")) ? String(input.ref) : "main";
  const url = "https://raw.githubusercontent.com/" + REPO + "/" + ref + "/" + input.path;
  const r = await fetch(url, { headers: { "user-agent": WORKER + "/" + VERSION }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return { ok: false, http: r.status, error: r.status === 404 ? "no such file on " + ref : "GitHub raw answered " + r.status };
  return Object.assign({ ok: true, path: input.path, ref }, sliceLines(await r.text(), input.from, input.lines, 60000));
}

async function fleetSql(env: Env, sql: string) {
  const p = readOnlySql(sql, 200);
  if (p.error) return { ok: false, error: p.error };
  try {
    const r = await env.AUDIT_DB.prepare(p.sql as string).all();
    const rows = r.results || [];
    const keep = JSON.stringify(rows).length > 40000 ? rows.slice(0, 50) : rows;
    return { ok: true, rows: rows.length, shown: keep.length, results: keep };
  } catch (e) { return { ok: false, error: errText(e) }; }
}

async function fileIssue(env: Env, input: { title: string; description: string; priority?: string; category?: string }, caller: string) {
  const title = String(input.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const desc = String(input.description || "").trim().slice(0, 4000);
  if (title.length < 8 || desc.length < 20) return { ok: false, error: "a fleet issue needs a title (8+ characters) and a description (20+)" };
  const pr = ["critical", "high", "medium", "low"].indexOf(String(input.priority)) >= 0 ? String(input.priority) : "medium";
  // A code-task line from here would be refused by the planner (INTAKE-PROVENANCE-1: this source is not an owner request), so
  // it is neutralised; code changes go through propose_code_task, which the owner files.
  const body = (desc + "\n\nFiled by " + WORKER + " " + VERSION + " for " + caller + " (CF-AGENTS-1).").replace(/code-task:/gi, "code-task -");
  const now = Date.now();
  try {
    const r = await env.AUDIT_DB.prepare("INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?6)").bind(title, body, WORKER, String(input.category || "agent").slice(0, 40), pr, now).run();
    return { ok: true, id: r.meta && r.meta.last_row_id, title, priority: pr };
  } catch (e) { return { ok: false, error: errText(e) }; }
}

interface ToolCtx { env: Env; scope: Scope; caller: string; agent: FleetCodeAgent | null; runId?: string; proposals: any[] }

function directTools(c: ToolCtx): Record<string, any> {
  const t: Record<string, any> = {
    repo_read_file: tool({
      description: "Read a file of the " + REPO + " repository (public) by line range. Returns numbered lines.",
      inputSchema: z.object({ path: z.string().describe("path relative to the repository root, e.g. qnfo-ops/worker.js"), ref: z.string().optional().describe("branch, tag or SHA (default main)"), from: z.number().optional().describe("first line, 1-based"), lines: z.number().optional().describe("how many lines (default 400)") }),
      execute: async (i: any) => readRepoFile(i)
    })
  };
  if (c.scope === "public") return t;
  t.fleet_sql = tool({
    description: "Read-only SQL (one SELECT or WITH) on the fleet's D1 qnfo-audit: agent_issues, v_issue_queue, code_tasks, metric_registry, v_metric_trigger_state, fleet_deploys, decision_log and the rest. Sign-in and secret tables are refused.",
    inputSchema: z.object({ sql: z.string() }),
    execute: async (i: any) => fleetSql(c.env, i.sql)
  });
  t.ops_catalog = tool({
    description: "List the qnfo-ops tools this turn may call (Cloudflare API, D1, R2, KV, GitHub, workspace, containers, deploys), with their descriptions.",
    inputSchema: z.object({ filter: z.string().optional() }),
    execute: async (i: any) => {
      const f = String(i.filter || "").toLowerCase();
      const all = await opsTools(c.env);
      return all.filter((x) => opsToolAllowed(x.name, c.scope) && (!f || (x.name + " " + x.description).toLowerCase().indexOf(f) >= 0)).map((x) => ({ name: x.name, description: x.description.slice(0, 240) }));
    }
  });
  t.ops_call = tool({
    description: "Call one qnfo-ops tool by name with its JSON arguments (see ops_catalog). Tools that change the fleet need the write scope.",
    inputSchema: z.object({ name: z.string(), arguments: z.record(z.string(), z.any()).optional() }),
    execute: async (i: any) => opsCall(c.env, c.scope, i.name, i.arguments || {})
  });
  t.propose_code_task = tool({
    description: "Propose a code change for the fleet's code loop: one repository file, what the change does, and a verbatim anchor that occurs once in that file near the edit. The owner files it with one tap; the code loop writes the patch, opens the PR and merges it on green checks.",
    inputSchema: z.object({ path: z.string(), goal: z.string(), anchor: z.string().optional() }),
    execute: async (i: any) => {
      const r = codeTaskText(i);
      if (r.error) return { ok: false, error: r.error };
      c.proposals.push({ kind: "code-task", path: i.path, goal: String(i.goal).slice(0, 300), task_text: r.text });
      return { ok: true, proposed: true, note: "Returned to the caller as a code-task proposal." };
    }
  });
  if (c.scope !== "write" && c.scope !== "loop") return t;
  t.file_issue = tool({
    description: "File a fleet issue in qnfo-audit.agent_issues (a defect or follow-up for the fleet's loops).",
    inputSchema: z.object({ title: z.string(), description: z.string(), priority: z.enum(["critical", "high", "medium", "low"]).optional(), category: z.string().optional() }),
    execute: async (i: any) => fileIssue(c.env, i, c.caller)
  });
  if (c.agent) {
    const agent = c.agent;
    t.schedule_turn = tool({
      description: "Schedule a later agent turn on this agent: a five-field cron (at most every 5 minutes) or a delay in seconds.",
      inputSchema: z.object({ text: z.string(), cron: z.string().optional(), delay_s: z.number().optional() }),
      execute: async (i: any) => agent.createSchedule({ text: i.text, cron: i.cron, delay_s: i.delay_s, scope: c.scope, caller: c.caller })
    });
    if (c.scope !== "write") return t;
    t.mcp_connect = tool({
      description: "Connect this agent to a remote MCP server by URL (Streamable HTTP); its tools join later turns.",
      inputSchema: z.object({ name: z.string(), url: z.string() }),
      execute: async (i: any) => agent.connectMcp(i.name, i.url)
    });
  }
  return t;
}

// Code Mode: one tool through which the model writes JavaScript that calls every direct tool and every allowed qnfo-ops tool as
// codemode.<name>(args), run in a Dynamic Worker with no outbound network of its own.
async function codeModeTool(c: ToolCtx, direct: Record<string, any>) {
  const fns: Record<string, any> = {};
  for (const k of Object.keys(direct)) fns[k] = direct[k];
  for (const o of await opsTools(c.env)) {
    if (!opsToolAllowed(o.name, c.scope)) continue;
    if (o.name === "send_email" && (!c.agent || !c.runId || c.scope !== "write")) continue;
    const n = safeToolName("ops_" + o.name);
    if (fns[n]) continue;
    fns[n] = tool({
      description: o.name === "send_email" ? o.description + " This action pauses for explicit approval and resumes the same durable execution." : o.description,
      inputSchema: jsonSchema(o.parameters || { type: "object", properties: {} }) as any,
      execute: async (args: any) => o.name === "send_email"
        ? c.agent!.sendEmail(args, c.runId!, c.caller)
        : opsCall(c.env, c.scope, o.name, args)
    });
  }
  const executor = new DynamicWorkerExecutor({ loader: c.env.LOADER, timeout: 120000, globalOutbound: null } as any);
  return createCodeTool({ tools: fns as any, executor, description: "Run JavaScript in an isolated sandbox. Inside it, every fleet tool is an async function on `codemode` (codemode.repo_read_file, codemode.fleet_sql, codemode.ops_<qnfo-ops tool>, ...). Use it to chain several calls, loop over results or compute; return the value you want back." } as any);
}

async function allTools(c: ToolCtx) {
  const direct = directTools(c);
  const tools: Record<string, any> = Object.assign({}, direct);
  if (c.scope !== "public" && c.env.LOADER) {
    try { tools.codemode = await codeModeTool(c, direct); } catch (e) { logErr("codemode", e); }
  }
  if (c.agent && c.scope !== "public") {
    try { await c.agent.mcp.waitForConnections?.({ timeout: 5000 } as any); } catch (e) { /* connections still coming up */ }
    try { Object.assign(tools, c.agent.mcp.getAITools()); } catch (e) { logErr("mcp-tools", e); }
  }
  return tools;
}

const SYSTEM = [
  "You are the Quniverse fleet's coding and operations agent (" + WORKER + ", Cloudflare Agents SDK), working on the " + REPO + " repository: about 40 Cloudflare Workers, the D1 database qnfo-audit, and the loops that run them.",
  "Work from evidence: read the code (repo_read_file, or codemode with ops_workspace_grep / ops_github_repo_read), the fleet graph (ops_fleet_graph impact before any change to a binding, table or route), and D1 (fleet_sql). Say what you read.",
  "Code changes go through the fleet's code loop: call propose_code_task with one file, the goal, and a verbatim anchor that occurs exactly once in that file. Never paste a patch as the only record.",
  "Use codemode when a task needs several tool calls, loops or computation. A tool that refuses (scope, guard, permission) is reported plainly with its reason; never retry it under another name.",
  "send_email is the single identity-bound action gated by a durable approval: use codemode.ops_send_email, and never bypass it through ops_call.",
  "Never print a secret, token or key. Keep the final answer short: what you found, what you did, what is proposed, and what is open."
].join("\n");

const CODE_SESSION_NEURON_BASELINE = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const CODE_SESSION_NEURON_BUDGET = 100000;
const CODE_SESSION_SYSTEM = SYSTEM;

async function modelFor(env: Env, purpose?: string) {
  let id = DEFAULT_MODEL;
  try {
    const row: any = await env.AUDIT_DB.prepare("SELECT value FROM ops_config WHERE key = 'qnfo_agents_model'").first();
    if (row && isDynamicRoute(row.value)) id = row.value;
  } catch (e) { /* ops_config unreadable: the default model */ }
  const metadata = purpose ? { worker: WORKER, purpose } : { worker: WORKER };
  const ai = createAI({ binding: env.AI, id: "default", metadata } as any);
  return { id, model: (ai as any)(id) };
}

async function ledger(env: Env, row: Record<string, unknown>) {
  try {
    await env.AUDIT_DB.prepare("INSERT OR REPLACE INTO cf_agent_runs (id, instance, caller, scope, status, model, steps, tools_used, prompt, result, error, created_ms, finished_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)")
      .bind(row.id, row.instance, row.caller, row.scope, row.status, row.model ?? null, row.steps ?? 0, row.tools_used ?? null, clip(String(row.prompt || ""), 2000), row.result == null ? null : clip(String(row.result), 8000), row.error ?? null, row.created_ms, row.finished_ms ?? null).run();
    // A turn whose Durable Object never finished it (the agent sweeps its own SQLite in onStart) is closed here too.
    await env.AUDIT_DB.prepare("UPDATE cf_agent_runs SET status = 'failed', error = 'abandoned: no progress for " + STALE_RUN_MIN + " minutes', finished_ms = ?1 WHERE status IN ('queued', 'running') AND created_ms < ?2").bind(Date.now(), Date.now() - STALE_RUN_MIN * 60000).run();
  } catch (e) { logErr("ledger", e); }
}

export class FleetCodeAgent extends Agent<Env, State> {
  initialState: State = { runs: 0, last_run: null, last_status: null, version: VERSION };
  private approvalWorkspace: Workspace | null = null;

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, prompt TEXT, scope TEXT, caller TEXT, status TEXT, attempts INTEGER DEFAULT 0, model TEXT, steps INTEGER DEFAULT 0, tools_used TEXT, result TEXT, proposals TEXT, error TEXT, created_ms INTEGER, finished_ms INTEGER)`;
    const cut = Date.now() - STALE_RUN_MIN * 60000;
    const why = "abandoned: no progress for " + STALE_RUN_MIN + " minutes";
    this.sql`UPDATE runs SET status = 'failed', error = ${why}, finished_ms = ${Date.now()} WHERE status IN ('queued', 'running') AND created_ms < ${cut}`;
  }

  private row(id: string): any {
    const r = this.sql`SELECT * FROM runs WHERE id = ${id}`;
    const x: any = r[0];
    if (!x) return null;
    try { x.proposals = x.proposals ? JSON.parse(x.proposals) : []; } catch (e) { x.proposals = []; }
    return x;
  }

  // Start a turn as a durable fiber and return at once, or wait up to wait_ms for it to finish.
  async startRun(input: RunInput) {
    const text = String(input.text || "").trim().slice(0, 8000);
    if (!text) return { ok: false, error: "empty request" };
    const scope: Scope = input.scope === "write" || input.scope === "loop" ? input.scope : "read";
    const id = runId();
    const now = Date.now();
    this.sql`INSERT INTO runs (id, prompt, scope, caller, status, created_ms) VALUES (${id}, ${text}, ${scope}, ${input.caller}, 'queued', ${now})`;
    await ledger(this.env, { id, instance: this.name, caller: input.caller, scope, status: "queued", prompt: text, created_ms: now });
    const done = this.runFiber("turn:" + id, async (fctx: any) => {
      fctx.stash({ id });
      await this.executeRun(id);
    }).catch((e) => logErr("fiber", e));
    const wait = Math.max(0, Math.min(25000, Number(input.wait_ms) || 0));
    if (wait) await Promise.race([done, new Promise((r) => setTimeout(r, wait))]);
    return { ok: true, run: this.row(id) };
  }

  async onFiberRecovered(ctx: any) {
    const id = ctx && ctx.stash && ctx.stash.id;
    if (!id) return;
    const r = this.row(id);
    if (!r || r.status === "done" || r.status === "failed" || r.status === "awaiting_approval") return;
    if ((r.attempts || 0) >= 2) {
      this.sql`UPDATE runs SET status = 'failed', error = 'evicted twice mid-turn', finished_ms = ${Date.now()} WHERE id = ${id}`;
      return;
    }
    // ALARM-TIMEOUT-1: this runs inside the alarm; a rejection here used to escape it and the platform retried the alarm.
    void this.runFiber("turn:" + id, async (fctx: any) => { fctx.stash({ id }); await this.executeRun(id); }).catch((e) => logErr("fiber-recover", e));
  }

  async executeRun(id: string) {
    const r = this.row(id);
    if (!r) return;
    this.sql`UPDATE runs SET status = 'running', attempts = attempts + 1 WHERE id = ${id}`;
    const proposals: any[] = [];
    let status = "done", result = "", error: string | null = null, steps = 0, used: string[] = [], modelId = DEFAULT_MODEL;
    try {
      const m = await modelFor(this.env);
      modelId = m.id;
      const tools = await allTools({ env: this.env, scope: r.scope, caller: r.caller, agent: this, runId: id, proposals });
      const out: any = await generateText({ model: m.model, system: SYSTEM + "\nScope of this turn: " + r.scope + ".", prompt: r.prompt, tools, stopWhen: stepCountIs(MAX_STEPS), timeout: { totalMs: TURN_TIMEOUT_MS, stepMs: STEP_TIMEOUT_MS } } as any);
      result = String(out.text || "").trim() || lastStepText(out.steps);
      steps = Array.isArray(out.steps) ? out.steps.length : 0;
      for (const s of out.steps || []) for (const tc of s.toolCalls || []) if (used.indexOf(tc.toolName) < 0) used.push(tc.toolName);
      // EMPTY-TURN-ANSWER-1: no step wrote text, so one more call without tools turns what the tools returned into the answer.
      if (!result) {
        try {
          const fin: any = await generateText({ model: m.model, system: SYSTEM + "\nScope of this turn: " + r.scope + ".", prompt: "Request:\n" + clip(r.prompt, 6000) + "\n\nTool results so far:\n" + (toolTranscript(out.steps, 24000) || "(none)") + "\n\n" + FINAL_ANSWER_ASK, abortSignal: AbortSignal.timeout(FINAL_ANSWER_TIMEOUT_MS) } as any);
          result = String(fin.text || "").trim();
          if (result) used.push("final-answer");
        } catch (eF) { logErr("final-answer", eF); }
      }
      result = result || EMPTY_TEXT;
    } catch (e) {
      status = "failed";
      error = errText(e);
    }
    const fin = Date.now();
    this.sql`UPDATE runs SET status = ${status}, model = ${modelId}, steps = ${steps}, tools_used = ${used.join(",")}, result = ${result}, proposals = ${JSON.stringify(proposals)}, error = ${error}, finished_ms = ${fin} WHERE id = ${id}`;
    this.setState({ runs: (this.state.runs || 0) + 1, last_run: id, last_status: status, version: VERSION });
    await ledger(this.env, { id, instance: this.name, caller: r.caller, scope: r.scope, status, model: modelId, steps, tools_used: used.join(","), prompt: r.prompt, result: result + (proposals.length ? "\n\nproposals: " + JSON.stringify(proposals) : ""), error, created_ms: r.created_ms, finished_ms: fin });
  }

  getRun(id: string) { return this.row(String(id)); }
  listRuns(limit = 20) {
    const n = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.sql`SELECT id, status, scope, caller, model, steps, tools_used, substr(prompt, 1, 160) AS prompt, substr(result, 1, 240) AS result, error, created_ms, finished_ms FROM runs ORDER BY created_ms DESC LIMIT ${n}`;
  }

  private async computerWorkspace(): Promise<Workspace> {
    if (!this.approvalWorkspace) {
      this.approvalWorkspace = new Workspace({
        storage: this.ctx.storage,
        backends: [new WorkerJavaScriptBackend({
          loader: this.env.LOADER,
          id: "worker-javascript",
          onInterrupt: "replay",
          modules: {
            "codemode:approval": {
              requestApproval: async ([input]: any[], call: any) => {
                if (!input || input.action !== "send_email") throw new Error("unsupported approval action");
                return emailApprovalGranted(await call.interrupt(input));
              },
              sendEmail: unsafeToRepeat(async ([input]: any[]) => {
                const row = this.row(String(input && input.run_id || ""));
                if (!row || row.scope !== "write" || row.caller !== input.caller || input.action !== "send_email") throw new Error("the approved email no longer matches its run");
                const result = await opsCall(this.env, "write", "send_email", input.arguments, APPROVED_SEND_EMAIL);
                if (!result || !result.ok) throw new Error(String(result && result.error || "send_email failed"));
                await this.finishApprovedEmail(String(input.run_id), row, result);
                return result;
              })
            }
          },
          onWait: (call: any) => this.markApprovalPending(call)
        })]
      });
    }
    await this.approvalWorkspace.ready();
    return this.approvalWorkspace;
  }

  private async markApprovalPending(call: any) {
    const input = call && call.payload;
    if (!input || input.kind !== "approval" || input.action !== "send_email") return;
    const row = this.row(String(input.run_id || ""));
    if (!row || row.scope !== "write" || row.caller !== input.caller) return;
    this.sql`UPDATE runs SET status = 'awaiting_approval' WHERE id = ${row.id} AND status = 'running'`;
    await this.env.AUDIT_DB.prepare("UPDATE cf_agent_runs SET status = 'awaiting_approval' WHERE id = ?1 AND caller = ?2 AND status = 'running'")
      .bind(row.id, row.caller).run();
  }

  private async finishApprovedEmail(id: string, row: any, result: any) {
    const now = Date.now(), text = clip(JSON.stringify(result), 8000);
    this.sql`UPDATE runs SET status = 'done', result = ${text}, finished_ms = ${now} WHERE id = ${id} AND status IN ('running', 'awaiting_approval')`;
    await this.env.AUDIT_DB.prepare("UPDATE cf_agent_runs SET status = 'done', result = ?2, finished_ms = ?3 WHERE id = ?1 AND status IN ('running', 'awaiting_approval')")
      .bind(id, text, now).run();
  }

  async sendEmail(args: unknown, id: string, caller: string) {
    const row = this.row(id);
    if (!row || row.scope !== "write" || row.caller !== caller) throw new Error("send_email needs the originating write-scoped run");
    const serialized = JSON.stringify(args || {});
    if (serialized.length > 12000) throw new Error("send_email arguments exceed the approval limit");
    const input = emailApprovalPayload(id, caller, JSON.parse(serialized));
    const payload = JSON.stringify(input).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const source = `import { requestApproval, sendEmail } from "codemode:approval";
export default async function() {
  const request = ${payload};
  if (!(await requestApproval(request))) throw new Error("email send was not approved");
  return await sendEmail(request);
}`;
    const workspace = await this.computerWorkspace();
    const execution = await workspace.runtime.exec(source, { backend: "worker-javascript", id: "computer_" + id + "_email", onInterrupt: "replay" });
    const result = await execution.result();
    if (result.status !== "completed" || result.exitCode !== 0) throw new Error(String(result.stderr || "email approval execution failed"));
    return result.value;
  }

  async pendingApprovals(caller: string) {
    const workspace = await this.computerWorkspace();
    const pending = await workspace.runtime.pending();
    return {
      ok: true,
      approvals: pending.filter((call: any) => {
        const input = call && call.payload;
        const row = input && this.row(String(input.run_id || ""));
        return !!row && row.scope === "write" && row.caller === caller &&
          pendingEmailApprovalMatches(call, String(row.id), String(call.callId), caller);
      }).map((call: any) => ({ id: call.id, callId: call.callId, payload: call.payload, since: call.since }))
    };
  }

  async respondToApproval(id: string, callId: string, caller: string, approved: boolean) {
    const row = this.row(id);
    if (!row || row.scope !== "write" || row.caller !== caller) return { ok: false, error: "no such pending approval" };
    const workspace = await this.computerWorkspace();
    const pending = await workspace.runtime.pending();
    const call = pending.find((item: any) => pendingEmailApprovalMatches(item, id, callId, caller));
    if (!call) return { ok: false, error: "no such pending approval" };
    this.sql`UPDATE runs SET status = 'running' WHERE id = ${id} AND status = 'awaiting_approval'`;
    await this.env.AUDIT_DB.prepare("UPDATE cf_agent_runs SET status = 'running' WHERE id = ?1 AND caller = ?2 AND status = 'awaiting_approval'")
      .bind(id, caller).run();
    try {
      await workspace.runtime.respond(call.id, call.callId, { approved });
    } catch (e) {
      this.sql`UPDATE runs SET status = 'awaiting_approval' WHERE id = ${id} AND status = 'running'`;
      await this.env.AUDIT_DB.prepare("UPDATE cf_agent_runs SET status = 'awaiting_approval' WHERE id = ?1 AND caller = ?2 AND status = 'running'")
        .bind(id, caller).run();
      return { ok: false, error: errText(e) };
    }
    if (!approved) {
      const now = Date.now();
      this.sql`UPDATE runs SET status = 'failed', error = 'send_email approval rejected', finished_ms = ${now} WHERE id = ${id} AND status = 'running'`;
      await this.env.AUDIT_DB.prepare("UPDATE cf_agent_runs SET status = 'failed', error = 'send_email approval rejected', finished_ms = ?3 WHERE id = ?1 AND caller = ?2 AND status = 'running'")
        .bind(id, caller, now).run();
    }
    return { ok: true, run_id: id, status: approved ? "resuming" : "rejected" };
  }

  // Schedules: each fires scheduledTurn with the stored request.
  async createSchedule(input: { text: string; cron?: string; delay_s?: number; scope: Scope; caller: string }) {
    const w = scheduleWhen(input);
    if (w.error) return { ok: false, error: w.error };
    const text = String(input.text || "").trim().slice(0, 4000);
    if (text.length < 8) return { ok: false, error: "say what the scheduled turn should do" };
    const s = await this.schedule(w.when as any, "scheduledTurn" as any, { text, scope: input.scope === "write" || input.scope === "loop" ? input.scope : "read", caller: input.caller });
    return { ok: true, id: s.id, kind: w.kind, when: w.when };
  }
  async scheduledTurn(payload: { text: string; scope: Scope; caller: string }) {
    // ALARM-TIMEOUT-1: a schedule fires from the alarm; a throw here makes the platform retry the whole alarm, so it is logged instead.
    try { await this.startRun({ text: payload.text, scope: payload.scope, caller: payload.caller + " (schedule)" }); } catch (e) { logErr("scheduled-turn", e); }
  }
  listSchedules() { return this.getSchedules().map((s: any) => ({ id: s.id, type: s.type, cron: s.cron, time: s.time, payload: s.payload })); }
  async dropSchedule(id: string) { return { ok: await this.cancelSchedule(String(id)) }; }

  // MCP client.
  async connectMcp(name: string, url: string) {
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/\S*$/.test(String(url))) return { ok: false, error: "an https URL of a remote MCP server" };
    try {
      const r: any = await this.addMcpServer(String(name).slice(0, 60), String(url));
      return { ok: true, id: r.id, state: r.state, auth_url: r.authUrl || undefined };
    } catch (e) { return { ok: false, error: errText(e) }; }
  }
  mcpServers() { return this.getMcpServers(); }
  async disconnectMcp(id: string) { await this.removeMcpServer(String(id)); return { ok: true }; }

  // Code Mode without a model: run the given JavaScript in the sandbox with the tools of the scope.
  async sandbox(code: string, scope: Scope, caller: string) {
    const c: ToolCtx = { env: this.env, scope, caller, agent: this, proposals: [] };
    const direct = directTools(c);
    const fns: Record<string, (a: any) => Promise<unknown>> = {};
    for (const k of Object.keys(direct)) fns[k] = (a: any) => direct[k].execute(a || {}, { toolCallId: "sandbox", messages: [] });
    for (const o of await opsTools(this.env)) if (opsToolAllowed(o.name, scope)) fns[safeToolName("ops_" + o.name)] = (a: any) => opsCall(this.env, scope, o.name, a || {});
    const ex = new DynamicWorkerExecutor({ loader: this.env.LOADER, timeout: 60000, globalOutbound: null } as any);
    const r = await ex.execute(String(code || "async () => null"), fns as any);
    return { ok: !r.error, result: r.result, error: r.error, logs: r.logs, proposals: c.proposals };
  }

  // WebSocket clients (useAgent / AgentClient) reach the same work through callable methods.
  @callable() async run(text: string) { return this.startRun({ text, scope: "read", caller: "websocket" }); }
  @callable() runs() { return this.listRuns(20); }
  @callable() status(id: string) { return this.getRun(id); }
  @callable() schedules() { return this.listSchedules(); }
}

export class CodeSession extends Agent<Env, State> {
  initialState: State = { runs: 0, last_run: null, last_status: null, version: VERSION };

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS code_session (id TEXT PRIMARY KEY, caller TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, neuron_budget REAL NOT NULL, neurons_used REAL NOT NULL DEFAULT 0, current_turn INTEGER NOT NULL DEFAULT 0, error TEXT, created_ms INTEGER NOT NULL, finished_ms INTEGER)`;
    this.sql`CREATE TABLE IF NOT EXISTS code_session_turns (turn INTEGER PRIMARY KEY, prompt TEXT NOT NULL, answer TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, model TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, neurons REAL NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, error TEXT, created_ms INTEGER NOT NULL, finished_ms INTEGER)`;
    this.sql`CREATE TABLE IF NOT EXISTS code_session_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL, created_ms INTEGER NOT NULL)`;
  }

  private sessionRow(): any {
    return this.sql`SELECT * FROM code_session LIMIT 1`[0] || null;
  }

  private event(type: string, data: unknown) {
    this.sql`INSERT INTO code_session_events (type, data, created_ms) VALUES (${type}, ${JSON.stringify(data).slice(0, 6000)}, ${Date.now()})`;
    const r: any = this.sql`SELECT last_insert_rowid() AS seq`;
    return Number(r[0] && r[0].seq) || 0;
  }

  async startSession(input: { text: string; scope: Scope; caller: string }) {
    const text = String(input.text || "").trim().slice(0, 8000);
    if (!text) return { ok: false, error: "empty request" };
    const now = Date.now();
    const scope: Scope = input.scope === "write" ? "write" : "read";
    this.sql`INSERT INTO code_session (id, caller, scope, status, neuron_budget, created_ms) VALUES (${this.name}, ${input.caller}, ${scope}, 'idle', ${CODE_SESSION_NEURON_BUDGET}, ${now})`;
    this.event("status", { status: "queued", turn: 1 });
    return this.startTurn(text, input.caller);
  }

  async startTurn(text: string, caller = "") {
    const session = this.sessionRow();
    if (!session || session.caller !== caller) return { ok: false, error: "no such code session" };
    if (session.status === "running" || (session.status === "queued" && Number(session.current_turn) > 0)) return { ok: false, error: "this code session is already running" };
    const prompt = String(text || "").trim().slice(0, 8000);
    if (!prompt) return { ok: false, error: "empty request" };
    const turn = Number(session.current_turn || 0) + 1;
    const now = Date.now();
    this.sql`INSERT INTO code_session_turns (turn, prompt, status, created_ms) VALUES (${turn}, ${prompt}, 'queued', ${now})`;
    this.sql`UPDATE code_session SET status = 'queued', current_turn = ${turn}, error = NULL, finished_ms = NULL WHERE id = ${this.name}`;
    if (turn > 1) this.event("status", { status: "queued", turn });
    void this.runFiber("code-session:" + turn, async (fctx: any) => {
      fctx.stash({ turn });
      await this.executeTurn(turn);
    }).catch((e) => this.failTurn(turn, errText(e)));
    return { ok: true, session_id: this.name, turn, status: "queued" };
  }

  async onFiberRecovered(ctx: any) {
    const turn = Number(ctx && ctx.stash && ctx.stash.turn);
    if (!turn) return;
    const rows: any = this.sql`SELECT status FROM code_session_turns WHERE turn = ${turn}`;
    if (!rows[0] || rows[0].status === "done" || rows[0].status === "failed") return;
    const prior: any = this.sql`SELECT attempts FROM code_session_turns WHERE turn = ${turn}`;
    const attempts = Number(prior[0] && prior[0].attempts) || 0;
    if (attempts >= 2) return this.failTurn(turn, "session turn was evicted twice");
    void this.runFiber("code-session:" + turn, async (fctx: any) => {
      fctx.stash({ turn });
      await this.executeTurn(turn);
    }).catch((e) => this.failTurn(turn, errText(e)));
  }

  private async failTurn(turn: number, error: string) {
    const now = Date.now();
    this.sql`UPDATE code_session_turns SET status = 'failed', error = ${error.slice(0, 600)}, finished_ms = ${now} WHERE turn = ${turn}`;
    this.sql`UPDATE code_session SET status = 'failed', error = ${error.slice(0, 600)}, finished_ms = ${now} WHERE id = ${this.name}`;
    this.event("error", { turn, error: error.slice(0, 600) });
  }

  private async executeTurn(turn: number) {
    const rows: any = this.sql`SELECT * FROM code_session WHERE id = ${this.name}`;
    const session = rows[0];
    const turns: any = this.sql`SELECT turn, prompt, answer FROM code_session_turns WHERE status = 'done' AND turn < ${turn} ORDER BY turn DESC LIMIT 8`;
    const current: any = this.sql`SELECT prompt FROM code_session_turns WHERE turn = ${turn}`;
    if (!session || !current[0]) return;
    const row = current[0];
    const now = Date.now();
    this.sql`UPDATE code_session_turns SET status = 'running', attempts = attempts + 1 WHERE turn = ${turn}`;
    this.sql`UPDATE code_session SET status = 'running', error = NULL WHERE id = ${this.name}`;
    this.event("status", { status: "running", turn });
    let answer = "", error: string | null = null, modelId = CODE_SESSION_NEURON_BASELINE;
    let routeId = DEFAULT_MODEL;
    let inputTokens = 0, outputTokens = 0, neurons = 0, costUsd = 0, steps = 0;
    try {
      const history = (turns || []).slice().reverse().map((x: any) => "User: " + clip(x.prompt, 1200) + "\nAssistant: " + clip(x.answer || "", 1800)).join("\n\n");
      const prompt = (history ? "Conversation so far:\n" + history + "\n\n" : "") + "Scope: " + session.scope + "\nCurrent request:\n" + row.prompt;
      const routed = await modelFor(this.env, "code-session");
      routeId = routed.id;
      modelId = routeId;
      const model = routed.model;
      const tools = await allTools({ env: this.env, scope: session.scope, caller: session.caller, agent: null, proposals: [] });
      const out: any = streamText({
        model, system: CODE_SESSION_SYSTEM, prompt, tools, stopWhen: stepCountIs(MAX_STEPS),
        timeout: { totalMs: TURN_TIMEOUT_MS, stepMs: STEP_TIMEOUT_MS }
      } as any);
      for await (const part of out.fullStream) {
        if (part.type === "text-delta") {
          answer += String(part.delta || "");
          this.event("text", { turn, delta: String(part.delta || "") });
        } else if (part.type === "tool-input-available") {
          steps++;
          this.event("tool", { turn, phase: "call", name: part.toolName, input: clip(part.input, 1600) });
        } else if (part.type === "tool-result") {
          this.event("tool", { turn, phase: "result", name: part.toolName, output: clip(part.output, 2600) });
        } else if (part.type === "tool-error") {
          this.event("tool", { turn, phase: "error", name: part.toolName, error: errText(part.error) });
        }
      }
      const usage = await out.totalUsage;
      inputTokens = Number(usage && usage.inputTokens) || 0;
      outputTokens = Number(usage && usage.outputTokens) || 0;
      const response = await out.response;
      modelId = String(response && response.modelId || routeId);
      neurons = codeSessionNeurons(modelId, inputTokens, outputTokens);
      if (!neurons) neurons = codeSessionNeurons(CODE_SESSION_NEURON_BASELINE, inputTokens, outputTokens);
      costUsd = codeSessionCost(neurons);
      const finish = Date.now();
      this.sql`UPDATE code_session_turns SET status = 'done', answer = ${answer.slice(0, 16000)}, model = ${modelId}, input_tokens = ${inputTokens}, output_tokens = ${outputTokens}, neurons = ${neurons}, cost_usd = ${costUsd}, finished_ms = ${finish} WHERE turn = ${turn}`;
      this.sql`UPDATE code_session SET status = 'done', neurons_used = neurons_used + ${neurons}, finished_ms = ${finish} WHERE id = ${this.name}`;
      try {
        await this.env.AUDIT_DB.prepare("INSERT OR REPLACE INTO cf_agent_session_usage (session_id, turn, caller, model, input_tokens, output_tokens, neurons, cost_usd, status, created_ms, finished_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'done', ?9, ?10)")
          .bind(this.name, turn, session.caller, modelId, inputTokens, outputTokens, neurons, costUsd, now, finish).run();
      } catch (e) { logErr("code-session-usage", e); }
      this.event("complete", { turn, answer: answer.slice(0, 16000), model: modelId, input_tokens: inputTokens, output_tokens: outputTokens, neurons, cost_usd: costUsd, neuron_budget: session.neuron_budget, neurons_remaining: Math.max(0, Number(session.neuron_budget) - Number(session.neurons_used || 0) - neurons), steps });
      this.setState({ runs: (this.state.runs || 0) + 1, last_run: this.name + ":" + turn, last_status: "done", version: VERSION });
    } catch (e) {
      error = errText(e);
      await this.failTurn(turn, error);
    }
  }

  readEvents(after = 0, caller = "") {
    const session = this.sessionRow();
    if (!session || session.caller !== caller) return { ok: false, error: "no such code session" };
    const cursor = Math.max(0, Number(after) || 0);
    const events: any = this.sql`SELECT seq, type, data, created_ms FROM code_session_events WHERE seq > ${cursor} ORDER BY seq LIMIT 100`;
    return { ok: true, session: { status: session.status, current_turn: session.current_turn }, events: (events || []).map((e: any) => ({ seq: e.seq, type: e.type, data: JSON.parse(e.data), created_ms: e.created_ms })) };
  }

  sessionStatus(caller = "") {
    const session = this.sessionRow();
    if (!session || session.caller !== caller) return { ok: false, error: "no such code session" };
    const turns: any = this.sql`SELECT turn, prompt, answer, status, model, input_tokens, output_tokens, neurons, cost_usd, error, created_ms, finished_ms FROM code_session_turns ORDER BY turn`;
    return { ok: true, session: { id: session.id, status: session.status, neuron_budget: session.neuron_budget, neurons_used: session.neurons_used, turns } };
  }
}

// ---- CF-AGENTS-LOOPS-1: the D1 request queue any fleet loop writes (cf_agent_requests), drained by the 5-minute cron.
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";
async function finishRequest(env: Env, id: number, status: string, result: unknown, error: string | null) {
  await env.AUDIT_DB.prepare("UPDATE cf_agent_requests SET status = ?2, result = ?3, error = ?4, finished_at = " + NOW_SQL + " WHERE id = ?1")
    .bind(id, status, result == null ? null : clip(typeof result === "string" ? result : JSON.stringify(result), 8000), error ? clip(error, 600) : null).run();
}

async function drainRequests(env: Env) {
  const db = env.AUDIT_DB;
  const out = { reconciled: 0, started: 0, failed: 0 };
  // 1. A running turn is finished when its cf_agent_runs row is; one with no result after REQUEST_STALE_MIN is re-queued (twice at
  //    most) and then failed with the reason, so nothing waits silently.
  const running: any = await db.prepare("SELECT q.id, q.attempts, q.started_at, a.status AS run_status, a.result AS run_result, a.error AS run_error FROM cf_agent_requests q LEFT JOIN cf_agent_runs a ON a.id = q.run_id WHERE q.status = 'running' LIMIT 50").all();
  for (const r of running.results || []) {
    if (r.run_status === "done" || r.run_status === "failed") { await finishRequest(env, r.id, r.run_status, r.run_result, r.run_error); out.reconciled++; continue; }
    const age = (Date.now() - Date.parse(String(r.started_at || ""))) / 60000;
    if (!(age > REQUEST_STALE_MIN)) continue;
    if ((r.attempts || 0) < 2) await db.prepare("UPDATE cf_agent_requests SET status = 'queued', run_id = NULL, error = ?2 WHERE id = ?1").bind(r.id, "re-queued: no result after " + REQUEST_STALE_MIN + " minutes").run();
    else { await finishRequest(env, r.id, "failed", null, "no result after " + REQUEST_STALE_MIN + " minutes, " + r.attempts + " attempts"); out.failed++; }
  }
  // 2. Start the next requests, critical first, then oldest.
  const queued: any = await db.prepare("SELECT * FROM cf_agent_requests WHERE status = 'queued' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, id LIMIT ?1").bind(DRAIN_PER_TICK).all();
  for (const q of queued.results || []) {
    const claim = await db.prepare("UPDATE cf_agent_requests SET status = 'running', attempts = attempts + 1, started_at = " + NOW_SQL + " WHERE id = ?1 AND status = 'queued'").bind(q.id).run();
    if (!claim.meta || !claim.meta.changes) continue;
    const v = validateRequest(q);
    if (v.error) { await finishRequest(env, q.id, "failed", null, v.error); out.failed++; continue; }
    const caller = "loop:" + q.requester;
    try {
      const stub: any = await getAgentByName(env.FleetCodeAgent as any, loopInstance(q.requester, q.instance));
      if (v.kind === "run") {
        const r = await stub.startRun({ text: q.prompt, scope: "loop", caller, wait_ms: 0 });
        if (!r.ok || !r.run) { await finishRequest(env, q.id, "failed", null, String(r.error || "the agent did not start the turn")); out.failed++; continue; }
        await db.prepare("UPDATE cf_agent_requests SET run_id = ?2 WHERE id = ?1").bind(q.id, r.run.id).run();
      } else if (v.kind === "sandbox") {
        const r = await stub.sandbox(String(q.code), "loop", caller);
        await finishRequest(env, q.id, r.ok ? "done" : "failed", { result: r.result, logs: r.logs, proposals: r.proposals }, r.error ? String(r.error) : null);
      } else {
        const r = await stub.createSchedule({ text: q.prompt, cron: q.cron || undefined, delay_s: q.delay_s || undefined, scope: "loop", caller });
        await finishRequest(env, q.id, r.ok ? "done" : "failed", r, r.ok ? null : String(r.error));
      }
      out.started++;
    } catch (e) {
      await finishRequest(env, q.id, "failed", null, errText(e));
      out.failed++;
    }
  }
  return out;
}

// ---- MCP server (stateless). Public clients get the repository reader; trusted callers get the scope's tools and the agent.
function mcpServer(env: Env, scope: Scope, caller: string) {
  const server = new McpServer({ name: WORKER, version: VERSION });
  const c: ToolCtx = { env, scope, caller: caller || "mcp-public", agent: null, proposals: [] };
  const tools = directTools(c);
  for (const name of Object.keys(tools)) {
    const t = tools[name];
    server.registerTool(name, { description: t.description, inputSchema: t.inputSchema } as any, (async (args: any) => {
      const out = await t.execute(args || {}, { toolCallId: "mcp", messages: [] });
      return { content: [{ type: "text", text: clip(out, 60000) }] };
    }) as any);
  }
  if (scope !== "public") {
    server.registerTool("agent_run", { description: "Start a turn of the fleet coding agent and wait up to 25 s; returns the run (poll agent_status with its id).", inputSchema: z.object({ text: z.string(), instance: z.string().optional() }) } as any, (async (a: any) => {
      const stub: any = await getAgentByName(env.FleetCodeAgent as any, instanceName(a.instance));
      const r = await stub.startRun({ text: a.text, scope, caller: caller + " (mcp)", wait_ms: 25000 });
      return { content: [{ type: "text", text: clip(r, 60000) }] };
    }) as any);
    server.registerTool("agent_status", { description: "Read one agent run by id.", inputSchema: z.object({ id: z.string(), instance: z.string().optional() }) } as any, (async (a: any) => {
      const stub: any = await getAgentByName(env.FleetCodeAgent as any, instanceName(a.instance));
      return { content: [{ type: "text", text: clip(await stub.getRun(a.id), 60000) }] };
    }) as any);
  }
  return server;
}

function instanceName(s: unknown): string {
  const n = String(s || "fleet").toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(n) ? n : "fleet";
}

function codeSessionStream(request: Request, stub: any, caller: string) {
  const url = new URL(request.url);
  let cursor = Math.max(0, Number(url.searchParams.get("after")) || Number(request.headers.get("last-event-id")) || 0);
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        const started = Date.now();
        let lastPing = started;
        try {
          while (!cancelled && Date.now() - started < 15 * 60 * 1000) {
            const batch = await stub.readEvents(cursor, caller);
            if (!batch || !batch.ok) {
              controller.enqueue(encoder.encode("event: error\ndata: " + JSON.stringify({ error: "no such code session" }) + "\n\n"));
              break;
            }
            for (const event of batch.events || []) {
              cursor = Math.max(cursor, Number(event.seq) || 0);
              controller.enqueue(encoder.encode("id: " + cursor + "\nevent: " + event.type + "\ndata: " + JSON.stringify(event.data) + "\n\n"));
            }
            if (["done", "failed"].includes(String(batch.session && batch.session.status)) && !(batch.events || []).length) break;
            if (Date.now() - lastPing > 15000) {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
              lastPing = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (!cancelled) controller.close();
        } catch (e) {
          if (!cancelled) {
            controller.enqueue(encoder.encode("event: error\ndata: " + JSON.stringify({ error: errText(e) }) + "\n\n"));
            controller.close();
          }
        }
      })();
    },
    cancel() { cancelled = true; }
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "connection": "keep-alive", "x-accel-buffering": "no" } });
}

async function body(request: Request): Promise<any> {
  try { return await request.json(); } catch (e) { return {}; }
}

function selfDoc(caller: string, scope: Scope) {
  return {
    worker: WORKER, version: VERSION, sdk: SDK, ok: true, you: { caller: caller || null, scope },
    what: "The fleet's Cloudflare Agents SDK agent: coding and operations turns over the whole fleet tool surface, durable, schedulable, with an MCP server and client and a Code Mode sandbox.",
    capabilities: CAPABILITIES,
    limitations: LIMITATIONS,
    model: { route: DEFAULT_MODEL, via: "Workers AI binding through AI Gateway 'default'", override: "ops_config qnfo_agents_model (dynamic routes only; invalid values use dynamic/standard)" },
    routes: {
      open: ["GET /", "GET /health", "GET /tools", "POST /mcp (public: repo_read_file)"],
      loops: ["INSERT INTO qnfo-audit.cf_agent_requests (requester, kind run|sandbox|schedule, prompt | code, cron | delay_s, instance?, priority?): drained every 5 minutes, outcome written back to the row"],
      trusted: ["POST /code-sessions {text}", "POST /code-sessions/<id>/turns {text}", "GET /code-sessions/<id>/events?after=<seq> (replayable SSE)", "GET /code-sessions/<id>", "GET /requests?status=&requester=", "POST /requests/drain", "POST /run {text, instance?, wait_ms?}", "GET /runs", "GET /runs/<id>", "GET /schedules", "POST /schedules {text, cron|delay_s}", "DELETE /schedules/<id>", "GET /mcp-servers", "POST /mcp-servers {name, url}", "DELETE /mcp-servers/<id>", "POST /sandbox {code}", "/agents/fleet-code-agent/<instance> (WebSocket, callable methods)"]
    },
    surfaces: { console: "https://fleet.qnfo.org/cmd (cfagent <request>, cfagent! <request> for the write scope)", ops: "https://ops.qnfo.org/v1/agents/..." }
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const caller = callerOf(ctx);
    const scope = scopeOf(caller, request.headers.get("x-agent-scope")) as Scope;
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept" } });
      if (path === "/health") return json({ ok: true, worker: WORKER, version: VERSION, sdk: SDK, capabilities: CAPABILITIES, limitations: LIMITATIONS, ts: new Date().toISOString() });
      if (path === "/" && request.method === "GET") return json(selfDoc(caller, scope));
      if (path === "/tools" && request.method === "GET") {
        const c: ToolCtx = { env, scope: caller ? "write" : "public", caller, agent: null, proposals: [] };
        const d = directTools(c);
        const ops = caller ? (await opsTools(env)).map((o) => ({ name: "ops_" + o.name, readonly: opsToolAllowed(o.name, "read"), description: o.description.slice(0, 200) })) : [];
        return json({ ok: true, version: VERSION, direct: Object.keys(d).map((k) => ({ name: k, description: d[k].description })), codemode: caller ? "every tool below is also codemode.<name>() in the sandbox" : null, ops_tools: ops, mcp: "POST /mcp" });
      }
      if (path === "/mcp") return createMcpHandler(() => mcpServer(env, scope, caller) as any, { route: "/mcp" } as any)(request, env, ctx);
      if (!caller) return json({ ok: false, error: "This route is for the fleet console and the ops endpoint. Use https://fleet.qnfo.org/cmd (cfagent <request>) or https://ops.qnfo.org/v1/agents.", open: ["/", "/health", "/tools", "/mcp"] }, 403);
      if (path.indexOf("/agents/") === 0) return (await routeAgentRequest(request, env)) || json({ ok: false, error: "no such agent" }, 404);
      const b = request.method === "POST" ? await body(request) : {};
      if (path === "/code-sessions" && request.method === "POST") {
        const text = String(b.text || "").trim();
        if (text.length < 1 || text.length > 8000) return json({ ok: false, error: "text must contain 1 to 8000 characters" }, 400);
        const id = runId();
        const session: any = await getAgentByName(env.CodeSession as any, id);
        return json(await session.startSession({ text, scope, caller }), 202);
      }
      let sessionMatch: RegExpExecArray | null;
      if ((sessionMatch = /^\/code-sessions\/(run_[a-z0-9_]{8,60})(?:\/(events|turns))?$/.exec(path))) {
        const session: any = await getAgentByName(env.CodeSession as any, sessionMatch[1]);
        if (sessionMatch[2] === "events" && request.method === "GET") return codeSessionStream(request, session, caller);
        if (sessionMatch[2] === "turns" && request.method === "POST") {
          const text = String(b.text || "").trim();
          if (text.length < 1 || text.length > 8000) return json({ ok: false, error: "text must contain 1 to 8000 characters" }, 400);
          const result = await session.startTurn(text, caller);
          return json(result, result.ok ? 202 : 409);
        }
        if (!sessionMatch[2] && request.method === "GET") return json(await session.sessionStatus(caller));
        return json({ ok: false, error: "no such route" }, 404);
      }
      const stub: any = await getAgentByName(env.FleetCodeAgent as any, instanceName(b.instance || url.searchParams.get("instance")));
      if (path === "/run" && request.method === "POST") return json(await stub.startRun({ text: b.text, scope, caller, wait_ms: b.wait_ms }));
      if (path === "/runs" && request.method === "GET") return json({ ok: true, runs: await stub.listRuns(Number(url.searchParams.get("limit")) || 20) });
      let m: RegExpExecArray | null;
      if ((m = /^\/runs\/(run_[a-z0-9_]{6,60})$/.exec(path)) && request.method === "GET") { const r = await stub.getRun(m[1]); return r ? json({ ok: true, run: r }) : json({ ok: false, error: "no such run" }, 404); }
      if (path === "/schedules" && request.method === "GET") return json({ ok: true, schedules: await stub.listSchedules() });
      if (scope !== "write" && (request.method === "DELETE" || path === "/schedules" || path === "/mcp-servers")) return json({ ok: false, error: "schedules and MCP connections change the agent: they need the write scope (cfagent! on the console)" }, 403);
      if (path === "/schedules" && request.method === "POST") return json(await stub.createSchedule({ text: b.text, cron: b.cron, delay_s: b.delay_s, scope, caller }));
      if ((m = /^\/schedules\/([A-Za-z0-9_-]{4,80})$/.exec(path)) && request.method === "DELETE") return json(await stub.dropSchedule(m[1]));
      if (path === "/mcp-servers" && request.method === "GET") return json({ ok: true, servers: await stub.mcpServers() });
      if (path === "/mcp-servers" && request.method === "POST") return json(await stub.connectMcp(b.name, b.url));
      if ((m = /^\/mcp-servers\/([A-Za-z0-9_-]{4,80})$/.exec(path)) && request.method === "DELETE") return json(await stub.disconnectMcp(m[1]));
      if (path === "/sandbox" && request.method === "POST") return json(await stub.sandbox(String(b.code || ""), scope, caller));
      // The second path for the 5-minute cron (spof_registry 'qnfo-agents cron */5'): a trusted caller drains the queue on demand.
      if (path === "/requests/drain" && request.method === "POST") return json({ ok: true, ...(await drainRequests(env)) });
      if (path === "/requests" && request.method === "GET") {
        const st = String(url.searchParams.get("status") || ""), rq = String(url.searchParams.get("requester") || "");
        const r: any = await env.AUDIT_DB.prepare("SELECT id, requester, kind, priority, status, attempts, run_id, substr(coalesce(prompt, code), 1, 200) AS request, substr(result, 1, 600) AS result, error, created_at, started_at, finished_at FROM cf_agent_requests WHERE (?1 = '' OR status = ?1) AND (?2 = '' OR requester = ?2) ORDER BY id DESC LIMIT 30").bind(st, rq).all();
        return json({ ok: true, requests: r.results || [] });
      }
      return json({ ok: false, error: "no such route", routes: selfDoc(caller, scope).routes }, 404);
    } catch (e) {
      logErr("fetch " + path, e);
      return json({ ok: false, error: errText(e) }, 500);
    }
  },

  // CF-AGENTS-LOOPS-1: every 5 minutes, drain the loops' request queue.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // CRON-HEARTBEAT-1: v_cron_activity reads fleet_heartbeat, so a tick that runs (or fails) is visible (metric crons_unobserved).
    const beat = (ok: number) => env.AUDIT_DB.prepare("INSERT OR REPLACE INTO fleet_heartbeat (worker, version, ts, ok) VALUES (?1, ?2, ?3, ?4)").bind(WORKER, VERSION, new Date().toISOString(), ok).run().catch((e) => logErr("heartbeat", e));
    ctx.waitUntil(drainRequests(env).then((r) => { console.log(JSON.stringify({ worker: WORKER, version: VERSION, where: "drain", ...r })); return beat(1); }).catch((e) => { logErr("drain", e); return beat(0); }));
  }
};
