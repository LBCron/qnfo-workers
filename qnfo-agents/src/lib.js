// qnfo-agents pure helpers (CF-AGENTS-1). No imports: worker.test.mjs loads this file directly with node, without node_modules.

// Service-binding callers this worker trusts. Only a service binding can set ctx.props, and only a deploy of the caller sets its
// value (the OPS-INTERNAL-CALLER-1 rule in qnfo-ops). Both callers verify the owner before they call: the dashboard by the emailed
// code session (FLEET-CMD-1), qnfo-ops by its own authOk (owner session or router key).
export const TRUSTED_CALLERS = ["qnfo-fleet-dashboard", "qnfo-ops"];

export function isDynamicRoute(model) {
  return typeof model === "string" && /^dynamic\/[a-z0-9][a-z0-9._-]{0,119}$/.test(model);
}

export function emailApprovalPayload(runId, caller, args) {
  return { kind: "approval", action: "send_email", run_id: String(runId), caller: String(caller), arguments: args };
}

export function pendingEmailApprovalMatches(call, runId, callId, caller) {
  const payload = call && call.payload && typeof call.payload === "object" ? call.payload : null;
  return !!payload && call.id === "computer_" + runId + "_email" && call.callId === callId &&
    payload.kind === "approval" && payload.action === "send_email" &&
    payload.run_id === runId && payload.caller === caller;
}

export function emailApprovalGranted(answer) {
  return !!answer && typeof answer === "object" && answer.approved === true;
}

export function callerOf(ctx) {
  const c = ctx && ctx.props && typeof ctx.props.caller === "string" ? ctx.props.caller : "";
  return TRUSTED_CALLERS.indexOf(c) >= 0 ? c : "";
}

// public: open to everyone (catalogue, health, public repository reads). read: a trusted caller, read-only tools.
// write: a trusted caller that asked for write (the dashboard sends it only after a fresh owner code, like sql! and merge).
export function scopeOf(caller, header) {
  if (!caller) return "public";
  return String(header || "").trim().toLowerCase() === "write" ? "write" : "read";
}

// The qnfo-ops tools that change nothing. Mirrors CMD_TOOL_READ_ONLY in qnfo-fleet-dashboard/worker.js (AGENT-TOOLS-1), so the
// console and this agent agree on what needs the write scope. Any other ops tool runs only with scope write.
export const OPS_READ_ONLY = ["fleet_status", "ops_issues_list", "ops_d1_query", "vectorize_query", "r2_list", "r2_get", "kv_get", "queue_read", "intents_query", "candidates_query", "service_discover", "backlog_status", "cf_analytics", "telemetry_report", "telemetry_analyze", "email_check", "email_stats", "ops_fleet_log", "fleet_graph", "dashboard_feed", "cf_docs", "workspace_read", "workspace_list", "workspace_grep", "workspace_glob", "workspace_diff", "workspace_stat", "workspace_read_multi", "cf_worker_read", "cf_worker_bindings", "github_repo_read", "github_issues_list", "github_issue_get", "github_projects_list", "git_op", "dr_validate_schema", "container_status", "web_search", "web_fetch", "run_code", "run_python", "run_code_net", "exec_pipeline"];

export function opsToolAllowed(name, scope) {
  if (scope === "write") return true;
  if (scope === "read" || scope === "loop") return OPS_READ_ONLY.indexOf(String(name)) >= 0;
  return false;
}

// A tool name the model can call as a JavaScript identifier inside Code Mode.
export function safeToolName(name) {
  const s = String(name || "").replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : "t_" + s;
}

// Read-only SQL for qnfo-audit: one SELECT or WITH statement, no write keyword, no sign-in or secret tables, and a row cap.
const SQL_WRITE = /\b(insert|update|delete|drop|alter|create|attach|detach|replace|vacuum|reindex|pragma|upsert|truncate)\b/i;
const SQL_PRIVATE = /\b(owner_sessions|owner_codes|console_agent_auth|ops_sessions|owner_docs|\w*secrets?|\w*_tokens?|\w*_passwords?)\b/i;
export function readOnlySql(sql, maxRows) {
  const cap = Math.max(1, Math.min(500, Number(maxRows) || 200));
  let s = String(sql || "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim().replace(/;\s*$/, "");
  if (!s) return { error: "empty SQL" };
  if (s.indexOf(";") >= 0) return { error: "one statement at a time" };
  if (!/^(select|with)\b/i.test(s)) return { error: "read-only: the statement must start with SELECT or WITH" };
  if (SQL_WRITE.test(s)) return { error: "read-only: write keywords are refused here (file the change as a code task or use the console's sql!)" };
  if (SQL_PRIVATE.test(s)) return { error: "sign-in, session, token and secret tables are not readable through the agent" };
  if (!/\blimit\s+\d+\s*$/i.test(s)) s += " LIMIT " + cap;
  return { sql: s };
}

// A repository path the agent may read: relative, no traversal, no NUL.
export function repoPathOk(path) {
  const p = String(path || "");
  return p.length > 0 && p.length <= 300 && p.indexOf("..") < 0 && p.indexOf("\0") < 0 && !/^\//.test(p) && /^[A-Za-z0-9._\/-]+$/.test(p);
}

// Slice a text file by 1-based line range, capped in characters.
export function sliceLines(text, from, count, maxChars) {
  const lines = String(text).split("\n");
  const a = Math.max(1, Number(from) || 1);
  const n = Math.max(1, Math.min(4000, Number(count) || 400));
  const cap = Math.max(1000, Math.min(120000, Number(maxChars) || 60000));
  let out = lines.slice(a - 1, a - 1 + n).map(function (l, i) { return (a + i) + "\t" + l; }).join("\n");
  const truncated = out.length > cap;
  if (truncated) out = out.slice(0, cap);
  return { total_lines: lines.length, from: a, to: Math.min(lines.length, a - 1 + n), truncated, text: out };
}

// A code-task proposal in the form the code loop reads (ISSUE-INTAKE-1 in qnfo-code-orchestrator): the dashboard files it as an
// owner task when the owner taps it, so the issue carries the owner-request provenance the planner trusts.
export function codeTaskText(p) {
  const path = String(p && p.path || "").trim();
  const goal = String(p && p.goal || "").replace(/\s+/g, " ").trim();
  const anchor = String(p && p.anchor || "").replace(/[\r\n]+/g, " ").trim();
  if (!repoPathOk(path)) return { error: "path must be a repository path like qnfo-ops/worker.js" };
  if (goal.length < 12) return { error: "say what the change does in at least 12 characters" };
  const lines = [goal.slice(0, 1500), "code-task: repo=qnfo-workers path=" + path];
  if (anchor) lines.push("code-anchor: " + anchor.slice(0, 300));
  return { text: lines.join("\n") };
}

// When a schedule runs: a cron expression (five fields), or a delay in seconds (60 s to 30 days).
export function scheduleWhen(input) {
  const cron = String(input && input.cron || "").trim();
  if (cron) {
    if (!/^(\S+\s+){4}\S+$/.test(cron)) return { error: "cron needs five fields, e.g. 0 * * * *" };
    if (/^\*\s/.test(cron) || /^\*\/[1-4]\s/.test(cron)) return { error: "a scheduled agent turn runs at most every 5 minutes" };
    return { when: cron, kind: "cron" };
  }
  const d = Number(input && input.delay_s);
  if (!Number.isFinite(d) || d < 60 || d > 30 * 86400) return { error: "give cron, or delay_s between 60 and 2592000" };
  return { when: Math.round(d), kind: "delay" };
}

export function clip(s, n) {
  const t = typeof s === "string" ? s : (function () { try { return JSON.stringify(s); } catch (e) { return String(s); } })();
  return t && t.length > n ? t.slice(0, n) + "... (" + (t.length - n) + " more characters)" : t;
}

// EMPTY-TURN-ANSWER-1: a turn that ends on a tool step (the step budget ran out, or the model only reasoned) has no final text,
// and 9 of the first 14 loop requests came back "(the model returned no text)". The last step that did write text is the answer;
// when no step wrote any, the caller asks once more without tools over a transcript of what the tools returned.
export const EMPTY_TEXT = "(the model returned no text)";
export const FINAL_ANSWER_ASK = "Stop calling tools. Using only what the tool results above show, answer the request now, in plain text, in the format it asked for. If the results were not enough, say what is known and what is not.";

export function lastStepText(steps) {
  const s = Array.isArray(steps) ? steps : [];
  for (let i = s.length - 1; i >= 0; i--) {
    const t = String(s[i] && s[i].text || "").trim();
    if (t) return t;
  }
  return "";
}

// FINAL-ANSWER-PICK-1: lastStepText is the right pick when the model wrote its answer in an earlier step, but it also returns a one-line
// preface ("I'll start by reading the fleet's data", 58 characters) when step 1 wrote that and the turn then ran its step budget out on tool
// steps. 288 of 332 lever reviews and the OPS and INFRA roadmap asks of 2026-11-04 stored such a preface (or a raw tool-call token string) as
// the result, so the manager re-asked at about 3.3k neurons a call. A turn is unanswered when its final text is empty, carries tool-call
// markup, or is a short text (under SHORT_ANSWER_CHARS) that came from a tool step or from an earlier step; the caller then runs the
// FINAL_ANSWER_ASK call once. A real answer, short or long, that the last step wrote with no tool call stays as it was.
export const SHORT_ANSWER_CHARS = 200;
const TOOL_MARKUP = /<\|tool_calls?_(?:section_)?(?:begin|end)\|>|<\|tool_call_(?:begin|end|argument_begin)\|>|<\/?tool_call>|<function_calls>|<\|python_tag\|>|<\|(?:start|channel|message|call|constrain)\|>/i;

export function hasToolMarkup(text) {
  return TOOL_MARKUP.test(String(text || ""));
}

// The text before the first tool-call marker: raw markup is never stored as an answer.
export function stripToolMarkup(text) {
  const s = String(text || "");
  const m = s.search(TOOL_MARKUP);
  return (m < 0 ? s : s.slice(0, m)).trim();
}

export function pickAnswer(text, steps) {
  const s = Array.isArray(steps) ? steps : [];
  const last = s[s.length - 1];
  const endedOnTool = !!last && ((Array.isArray(last.toolCalls) && last.toolCalls.length > 0) || last.finishReason === "tool-calls");
  const final = String(text || "").trim();
  const t = final || lastStepText(s);
  if (!t) return { text: "", answered: false };
  if (hasToolMarkup(t)) return { text: stripToolMarkup(t), answered: false };
  if (t.length < SHORT_ANSWER_CHARS && (!final || endedOnTool)) return { text: t, answered: false };
  return { text: t, answered: true };
}

export function toolTranscript(steps, maxChars) {
  const out = [];
  for (const st of Array.isArray(steps) ? steps : []) {
    for (const tr of st && st.toolResults || []) {
      const v = tr && (tr.output !== undefined ? tr.output : tr.result);
      out.push("tool " + (tr && tr.toolName || "?") + " " + clip(JSON.stringify(tr && (tr.input !== undefined ? tr.input : tr.args) || {}), 300) + " -> " + clip(v, 1500));
    }
  }
  const t = out.join("\n");
  return t.length > maxChars ? t.slice(t.length - maxChars) : t;
}

const CODE_SESSION_NEURON_RATES = {
  "@cf/deepseek-ai/deepseek-v4-flash-0731": [40000, 120000],
  "@cf/deepseek-ai/deepseek-v4-pro-0813": [120000, 360000]
};

export function codeSessionNeurons(model, inputTokens, outputTokens) {
  const rates = CODE_SESSION_NEURON_RATES[String(model || "")];
  if (!rates) return 0;
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  return (input * rates[0] + output * rates[1]) / 1000000;
}

export function codeSessionCost(neurons) {
  return Math.max(0, Number(neurons) || 0) * 11 / 1000000;
}

export function runId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return "run_" + Date.now().toString(36) + "_" + Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
}

// CF-AGENTS-LOOPS-1: a cf_agent_requests row a fleet loop wrote. The loop scope is read plus fleet issues, code-task proposals and
// loop-scope schedules on the requester's own instance; it never gets mutating ops tools or MCP connections.
export const REQUEST_KINDS = ["run", "sandbox", "schedule"];
export const DRAIN_PER_TICK = 3;

// QNFO-AGENTS-BUDGET-1 (0.7.0, 2026-11-04, pillar cost; BUDGET-SOFT-ROUTE-1: slower, never stopped). The loop drain started up to DRAIN_PER_TICK requests every
// five minutes with no daily bound: deepseek-v4.1-flash-1017 through dynamic/standard was 1.06M to 1.42M neurons a day on 11-02 and 11-03 (28 to 40 percent of the
// Cloudflare meter, USD 11 to 16 a day) while the owner's all-in target is about 757k neurons a day. The drain now takes its share of a daily neuron budget
// (ops_config qnfo_agents_daily_neurons, default 250000, 'off' disables): each tick may start the requests that fit left / ticks-left neurons, a tick whose share is
// under one request starts one every `duty` ticks, and a spent day keeps one request an hour. Critical requests and requests that call no model (sandbox,
// schedule) are never deferred, and a request the budget cannot start leaves the queue after AGENT_SHED_MIN minutes (SLA-120M), failed with the reason, so
// nothing waits past the 120-minute bar; the loop that wrote it files the next one. The spend is read from ai_spend_ledger (caller qnfo-agents), priced at the
// rates the Cloudflare meter showed on 2026-11-04 (1.04M neurons for 23.8M input and 0.58M output tokens).
export const AGENT_NEURONS_IN_PER_M = 40000;
export const AGENT_NEURONS_OUT_PER_M = 120000;
export const AGENT_DAILY_NEURONS_DEFAULT = 250000;
export const AGENT_RUN_NEURONS_EST_DEFAULT = 2500;
export const AGENT_FLOOR_EVERY_TICKS = 12;
export const AGENT_TICK_MS = 300000;
export const AGENT_SHED_MIN = 110;

export function agentNeurons(inTok, outTok) {
  return (Number(inTok) || 0) * AGENT_NEURONS_IN_PER_M / 1e6 + (Number(outTok) || 0) * AGENT_NEURONS_OUT_PER_M / 1e6;
}

// How many non-critical model requests this tick may start. spent is null when the ledger cannot be read: the drain is then not limited (a D1 fault never
// throttles the queue; the drain cannot claim a row without D1 either).
export function agentDrainPlan(spent, budget, nowMs, est, perTick) {
  const per = perTick > 0 ? perTick : DRAIN_PER_TICK;
  const e = est > 0 ? est : AGENT_RUN_NEURONS_EST_DEFAULT;
  if (!(budget > 0) || spent == null || !Number.isFinite(Number(spent))) return { limited: false, take: per, duty: 1, left: null, share: null };
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const dayStart = Math.floor(now / 864e5) * 864e5;
  const ticksLeft = Math.max(1, Math.ceil((dayStart + 864e5 - now) / AGENT_TICK_MS));
  const left = Math.max(0, budget - Number(spent));
  const share = left / ticksLeft;
  const runs = Math.floor(share / e);
  if (runs >= 1) return { limited: true, take: Math.min(per, runs), duty: 1, left, share };
  const duty = share > 0 ? Math.min(AGENT_FLOOR_EVERY_TICKS, Math.ceil(e / share)) : AGENT_FLOOR_EVERY_TICKS;
  const slot = Math.floor(now / AGENT_TICK_MS) % duty === 0;
  return { limited: true, take: slot ? 1 : 0, duty, left, share };
}

export function requesterOk(s) {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{1,79}$/.test(String(s || ""));
}

// The agent instance a request runs on: its own instance name when valid, else one per requester (loop-<requester>).
export function loopInstance(requester, instance) {
  const own = String(instance || "").toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{0,40}$/.test(own)) return own;
  const r = String(requester || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 35);
  return "loop-" + (r || "fleet");
}

export function validateRequest(row) {
  const kind = String(row && row.kind || "run");
  if (REQUEST_KINDS.indexOf(kind) < 0) return { error: "kind must be run, sandbox or schedule" };
  if (!requesterOk(row && row.requester)) return { error: "requester must name the loop (letters, digits, : . _ -)" };
  if (kind === "sandbox") {
    if (String(row.code || "").trim().length < 5) return { error: "a sandbox request needs code" };
    return { kind };
  }
  if (String(row.prompt || "").trim().length < 8) return { error: "a " + kind + " request needs a prompt of 8+ characters" };
  if (kind === "schedule") {
    const w = scheduleWhen({ cron: row.cron, delay_s: row.delay_s });
    if (w.error) return { error: w.error };
  }
  return { kind };
}
