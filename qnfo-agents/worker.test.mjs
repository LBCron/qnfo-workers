// CF-AGENTS-1 (qnfo-agents), offline. Locks the access rules and the bundle invariants the fleet's guards rely on.
// ADVERSARIAL: the helpers are tested directly; the bundle is checked by shape (it needs the Workers runtime to run). The live proof
// is GET https://agents.qnfo.org/health answering this VERSION, a public POST /run answering 403, and a console turn reaching done.
import { readFileSync } from "node:fs";
import { callerOf, scopeOf, opsToolAllowed, readOnlySql, repoPathOk, codeTaskText, scheduleWhen, safeToolName, sliceLines, OPS_READ_ONLY, validateRequest, loopInstance, requesterOk, DRAIN_PER_TICK, agentDrainPlan, agentNeurons, AGENT_DAILY_NEURONS_DEFAULT, AGENT_FLOOR_EVERY_TICKS, AGENT_TICK_MS, AGENT_SHED_MIN, EMPTY_TEXT, lastStepText, pickAnswer, hasToolMarkup, stripToolMarkup, SHORT_ANSWER_CHARS, FINAL_ANSWER_ASK, toolTranscript, codeSessionNeurons, codeSessionCost, isDynamicRoute, leanCaller, leanConfigOn, capResult, LEAN_MAX_STEPS, LEAN_RESULT_CHARS } from "./src/lib.js";
const here = (p) => new URL(p, import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

// Callers: only service-binding props from the two owner-verifying workers count.
ok(callerOf({ props: { caller: "qnfo-fleet-dashboard" } }) === "qnfo-fleet-dashboard", "dashboard is trusted");
ok(callerOf({ props: { caller: "qnfo-ops" } }) === "qnfo-ops", "qnfo-ops is trusted");
ok(callerOf({ props: { caller: "qnfo-social" } }) === "", "another worker is not trusted");
ok(callerOf({}) === "" && callerOf(null) === "", "no props, no caller");
ok(scopeOf("", "write") === "public", "a public request never gets write");
ok(scopeOf("qnfo-ops", "write") === "write" && scopeOf("qnfo-ops", "") === "read", "write only when the trusted caller asks");

// Ops tools: read-only names in read, everything in write, nothing in public.
ok(opsToolAllowed("fleet_status", "read") && !opsToolAllowed("github_file_write", "read"), "read scope keeps to read-only ops tools");
ok(opsToolAllowed("github_file_write", "write"), "write scope reaches mutating ops tools");
ok(!opsToolAllowed("fleet_status", "public"), "public scope reaches no ops tool");
const dash = readFileSync(here("../qnfo-fleet-dashboard/worker.js"), "utf8");
const m = /var CMD_TOOL_READ_ONLY = \{([^}]*)\}/.exec(dash);
const dashList = m ? m[1].split(",").map((s) => s.split(":")[0].trim()).filter(Boolean).sort() : [];
ok(dashList.length > 10 && JSON.stringify(dashList) === JSON.stringify(OPS_READ_ONLY.slice().sort()), "OPS_READ_ONLY equals the console's CMD_TOOL_READ_ONLY");

// SQL: read-only, one statement, no private tables, capped.
ok(readOnlySql("SELECT id FROM agent_issues").sql === "SELECT id FROM agent_issues LIMIT 200", "a select gets a row cap");
ok(!!readOnlySql("SELECT 1; DELETE FROM agent_issues").error, "two statements are refused");
ok(!!readOnlySql("UPDATE agent_issues SET status='closed'").error, "update is refused");
ok(!!readOnlySql("WITH x AS (SELECT 1) DELETE FROM agent_issues").error, "a write inside WITH is refused");
ok(!!readOnlySql("SELECT token FROM console_agent_auth").error, "the stored agent session is not readable");
ok(!!readOnlySql("SELECT * FROM owner_sessions").error, "owner sessions are not readable");
ok(!readOnlySql("SELECT author FROM papers").error, "an ordinary column named author is readable");

// Repository paths, code-task text, schedules, names, slices.
ok(repoPathOk("qnfo-ops/worker.js") && !repoPathOk("../etc/passwd") && !repoPathOk("/abs") && !repoPathOk(""), "repository paths stay inside the repo");
const ct = codeTaskText({ path: "qnfo-ops/worker.js", goal: "Answer 404 for an unknown route", anchor: "no such route" });
ok(/\ncode-task: repo=qnfo-workers path=qnfo-ops\/worker\.js\ncode-anchor: no such route$/.test(ct.text || ""), "a proposal carries the code loop's intake lines");
ok(!!codeTaskText({ path: "x/../y", goal: "something long enough" }).error, "a bad path is refused");
ok(scheduleWhen({ cron: "0 * * * *" }).kind === "cron" && !!scheduleWhen({ cron: "* * * * *" }).error, "cron at most every 5 minutes");
ok(scheduleWhen({ delay_s: 600 }).when === 600 && !!scheduleWhen({ delay_s: 5 }).error, "delays from 60 s");
ok(safeToolName("ops_github-repo.read") === "ops_github_repo_read" && safeToolName("9x") === "t_9x", "tool names are JS identifiers");
const sl = sliceLines("a\nb\nc\nd", 2, 2, 5000);
ok(sl.text === "2\tb\n3\tc" && sl.total_lines === 4, "line slices are numbered");

// Bundle invariants: VERSION first, mirror identical, the Durable Object exported and migrated, no banned model id.
const w = readFileSync(here("./worker.js"), "utf8");
const pkg = JSON.parse(readFileSync(here("./package.json"), "utf8"));
const v = /^var VERSION = "(\d+\.\d+\.\d+)";/.exec(w);
ok(!!v && v[1] === pkg.version, "worker.js starts with var VERSION equal to package.json version");
ok(w === readFileSync(here("./deployed-current.worker.js"), "utf8"), "deployed-current.worker.js is identical to worker.js");
ok(/export\{[^}]*\bFleetCodeAgent\b[^}]*\}/.test(w), "the bundle exports FleetCodeAgent");
ok(w.indexOf("glm-4.7-flash") < 0, "no banned model id in the bundle (MODEL-FLOOR-1)");
const toml = readFileSync(here("./wrangler.toml"), "utf8");
ok(/\[exports\.FleetCodeAgent\]\ntype = "durable-object"\nstorage = "sqlite"/.test(toml) && !/\[\[migrations\]\]/.test(toml) && /class_name = "FleetCodeAgent"/.test(toml), "the agent class is bound and declared in exports, never with the legacy migrations array (DO-EXPORTS-1)");
ok(/^# charter-pillar: autonomy/m.test(toml), "charter pillar declared");
ok(/props = \{ caller = "qnfo-agents" \}/.test(toml), "qnfo-ops sees this worker as caller qnfo-agents");
ok(/\[triggers\]\ncrons = \["\*\/5 \* \* \* \*"\]/.test(toml), "CF-AGENTS-LOOPS-1: one 5-minute cron drains cf_agent_requests");
ok(readFileSync(here("./WRANGLER-ONLY"), "utf8").length > 20, "WRANGLER-ONLY keeps the canonical /content deploy away");
const src = readFileSync(here("./src/index.ts"), "utf8");
ok(/if \(!caller\) return json\(\{ ok: false, error: "This route is for the fleet console/.test(src), "every route past the open ones needs a trusted caller");
ok(src.indexOf('path === "/mcp"') < src.indexOf("if (!caller) return json"), "/mcp is open, with the public tool set");

// CF-AGENTS-LOOPS-1: the loop scope and the request queue.
ok(opsToolAllowed("ops_d1_query", "loop") && !opsToolAllowed("deploy_worker", "loop") && !opsToolAllowed("d1_write", "loop"), "loop scope: read-only ops tools only");
ok(validateRequest({ requester: "program-manager:research", kind: "run", prompt: "summarise the focus issues" }).kind === "run", "a run request validates");
ok(!!validateRequest({ requester: "pm", kind: "run", prompt: "short" }).error, "a run needs a real prompt");
ok(!!validateRequest({ requester: "pm", kind: "sandbox", code: "" }).error && validateRequest({ requester: "pm", kind: "sandbox", code: "async () => 1" }).kind === "sandbox", "a sandbox request needs code");
ok(!!validateRequest({ requester: "pm", kind: "schedule", prompt: "check the queue", cron: "* * * * *" }).error && validateRequest({ requester: "pm", kind: "schedule", prompt: "check the queue", cron: "0 * * * *" }).kind === "schedule", "a schedule keeps the 5-minute floor");
ok(!!validateRequest({ requester: "pm", kind: "deploy", prompt: "do something big" }).error, "unknown kinds are refused");
ok(!requesterOk("") && !requesterOk("x y") && requesterOk("portfolio-manager"), "the requester names the loop");
ok(loopInstance("program-manager:research") === "loop-program-manager-research" && loopInstance("pm", "managers") === "managers", "one agent instance per requester unless it names its own");
ok(DRAIN_PER_TICK >= 1 && DRAIN_PER_TICK <= 5, "the drain is bounded per tick");
ok(/async scheduled\(/.test(src) && /drainRequests\(env\)/.test(src), "the cron runs drainRequests");
ok(/path === "\/requests\/drain" && request\.method === "POST"/.test(src), "POST /requests/drain is the second drain path (spof_registry)");
ok(/scope: "loop"/.test(src) && /if \(c\.scope !== "write"\) return t;\n    t\.mcp_connect/.test(src), "loop turns get schedules but never MCP connections");
const mig = readFileSync(new URL("../migrations/2026-10-26-cf-agent-requests.sql", import.meta.url), "utf8");
ok(/CREATE TABLE IF NOT EXISTS cf_agent_requests/.test(mig) && /INSERT OR IGNORE INTO queue_sla/.test(mig) && /analytics_metric_triggers/.test(mig), "the queue ships with its SLA row and metric trigger");

// EMPTY-TURN-ANSWER-1: a turn that ends on a tool step still answers.
ok(lastStepText([{ text: "first finding" }, { text: "", toolCalls: [{}] }]) === "first finding", "the last step that wrote text is the answer");
ok(lastStepText([{ text: "" }, { text: "  " }]) === "" && lastStepText(undefined) === "", "no text anywhere reads empty");

// FINAL-ANSWER-PICK-1: a preface or raw tool-call markup is not the answer; a real one is kept.
const PREFACE = "I'll start by reading the fleet's data and the repository.";
const LONG = "TITLE: Cache the metric breakdown\nWHY: " + "the breakdown is read on every tick. ".repeat(8) + "\ncode-task: repo=qnfo-workers path=qnfo-ops/worker.js\ncode-anchor: async function metricBreakdown(\nEDIT: memoize it.";
const TOOL = { text: "", toolCalls: [{}], finishReason: "tool-calls" };
ok(LONG.length > SHORT_ANSWER_CHARS && SHORT_ANSWER_CHARS === 200, "the fixture answer is longer than the threshold");
const prefaceOnly = pickAnswer("", [{ text: PREFACE, toolCalls: [{}], finishReason: "tool-calls" }, TOOL]);
ok(!prefaceOnly.answered && prefaceOnly.text === PREFACE, "a one-line preface before tool steps is not an answer");
ok(!pickAnswer(PREFACE, [TOOL, { text: PREFACE, toolCalls: [{ toolName: "fleet_sql" }], finishReason: "tool-calls" }]).answered, "a short text written beside the last tool call is not an answer");
ok(!pickAnswer("", [{ text: PREFACE, toolCalls: [], finishReason: "stop" }, { text: "", toolCalls: [], finishReason: "stop" }]).answered, "a preface followed by an empty last step is not an answer");
const markupOnly = pickAnswer('<|tool_calls_section_begin|><|tool_call_begin|>functions.ops_workspace_grep:0<|tool_call_argument_begin|>{"path": "a"}<|tool_call_end|>', [TOOL]);
ok(!markupOnly.answered && markupOnly.text === "", "raw tool-call tokens are not an answer and are not stored");
const markupInLong = pickAnswer(LONG + '<tool_call>{"name":"fleet_sql"}</tool_call>', []);
ok(!markupInLong.answered && markupInLong.text === LONG.trim(), "markup after a long text is cut and the turn still asks once more");
ok(!pickAnswer("We need a query.\n<|start|>assistant<|channel|>commentary to=", []).answered, "harmony channel tokens count as markup");
const real = pickAnswer(LONG, [TOOL, { text: LONG, toolCalls: [], finishReason: "stop" }]);
ok(real.answered && real.text === LONG, "a real answer is returned unchanged");
const SHORT_REAL = "No change needed: the metric already recovered.";
const shortReal = pickAnswer(SHORT_REAL, [TOOL, { text: SHORT_REAL, toolCalls: [], finishReason: "stop" }]);
ok(shortReal.answered && shortReal.text === SHORT_REAL, "a short final answer written with no tool call is kept");
const earlierLong = pickAnswer("", [{ text: LONG, toolCalls: [{}], finishReason: "tool-calls" }, TOOL]);
ok(earlierLong.answered && earlierLong.text === LONG, "a long text from an earlier step still stands as the answer (EMPTY-TURN-ANSWER-1)");
ok(!pickAnswer("", [{ text: "", toolCalls: [{}] }]).answered && !pickAnswer(undefined, undefined).answered, "an empty turn is unanswered");
ok(hasToolMarkup("a <function_calls> b") && !hasToolMarkup("I read <b> and a | b") && stripToolMarkup("x <|python_tag|>y") === "x", "markup detection is narrow and strips from the first marker");
ok(/format it asked for/.test(FINAL_ANSWER_ASK), "the final-answer ask keeps the request's format");
const tt = toolTranscript([{ toolResults: [{ toolName: "fleet_sql", input: { sql: "SELECT 1" }, output: { ok: true, rows: 1 } }] }, { toolResults: [{ toolName: "repo_read_file", args: { path: "a" }, result: "x".repeat(5000) }] }], 3000);
ok(tt.length <= 3000 && /repo_read_file/.test(tt), "the transcript keeps the newest tool results within its budget", tt.slice(0, 120));
ok(/tool fleet_sql \{"sql":"SELECT 1"\} -> \{"ok":true,"rows":1\}/.test(toolTranscript([{ toolResults: [{ toolName: "fleet_sql", input: { sql: "SELECT 1" }, output: { ok: true, rows: 1 } }] }], 9000)), "a tool result reads as name, input and output");
ok(codeSessionNeurons("@cf/deepseek-ai/deepseek-v4-flash-0731", 1000, 500) === 100, "CodeSession estimates DeepSeek Flash neurons from input/output tokens");
ok(codeSessionNeurons("@cf/deepseek-ai/deepseek-v4-pro-0813", 1000, 500) === 300, "CodeSession uses the higher Pro neuron rate");
ok(codeSessionNeurons("unknown-model", 1000, 500) === 0 && codeSessionCost(100) === 0.0011, "unknown models do not invent neuron usage and cost follows the published neuron price");
ok(isDynamicRoute("dynamic/standard") && isDynamicRoute("dynamic/qnfo-agentic"), "model overrides accept named AI Gateway dynamic routes");
ok(!isDynamicRoute("@cf/zai-org/glm-5.3-flash") && !isDynamicRoute("dynamic/") && !isDynamicRoute("dynamic/standard/v2"), "model overrides reject provider models and malformed dynamic routes");
const ts = readFileSync(here("./src/index.ts"), "utf8");
ok(/const DEFAULT_MODEL = "dynamic\/standard";/.test(ts) && /row && isDynamicRoute\(row\.value\)/.test(ts), "agent turns default to dynamic/standard and accept only dynamic-route overrides");
ok(/modelFor\(this\.env, "code-session"[,)]/.test(ts) && !/fallback:\s*\[/.test(ts) && !/CODE_SESSION_PRO/.test(ts), "CodeSession shares dynamic routing without a consumer-owned model fallback");
// PREFIX-CACHE-AGENTS-1 (#7067): every model call of a turn carries a session key (x-session-affinity), so the steps of one turn reach the same Workers AI instance and its prefix cache; the cached tokens are recorded in ai_spend_ledger.cached_tok.
ok(/async function modelFor\(env: Env, purpose\?: string, affinity\?: string\)/.test(ts) && /sessionAffinity: "qnfo-agents:" \+ ses/.test(ts), "modelFor passes a sanitised session key to createAI as sessionAffinity");
ok(/modelFor\(this\.env, undefined, id\)/.test(ts) && /modelFor\(this\.env, "code-session", this\.name \+ "-t" \+ turn\)/.test(ts), "agent turns key the cache by run id and code sessions by session and turn");
ok(/cacheReadTokens/.test(ts) && /cached_tok=cached_tok\+excluded\.cached_tok/.test(ts), "the meter records cache-read tokens in ai_spend_ledger.cached_tok");
ok(/const pick = pickAnswer\(out\.text, out\.steps\);\n\s+result = pick\.text;/.test(ts) && /if \(!pick\.answered\) \{[\s\S]{0,200}generateText\(\{ model: m\.model[^\n]*FINAL_ANSWER_ASK, abortSignal/.test(ts), "an unanswered turn (empty, preface-only or tool markup) gets one more call, without tools");
ok(/const ft = stripToolMarkup\(String\(fin\.text \|\| ""\)\.trim\(\)\);/.test(ts) && /if \(ft\) \{ result = ft; used\.push\("final-answer"\); \}/.test(ts), "the final-answer reply replaces the first text only when it holds text, with no markup");
ok(/result = result \|\| EMPTY_TEXT;/.test(ts) && EMPTY_TEXT === "(the model returned no text)", "an answer that stays empty still says so");
ok(/export class CodeSession extends Agent/.test(ts) && /CREATE TABLE IF NOT EXISTS code_session_events/.test(ts), "CodeSession persists session and ordered event state in its Durable Object");
ok(/for await \(const part of out\.fullStream\)/.test(ts) && /part\.type === "text-delta"/.test(ts) && /part\.type === "tool-result"/.test(ts), "CodeSession emits text and tool events as the model stream runs");
ok(/CODE_SESSION_NEURON_BUDGET = 100000/.test(ts) && /codeSessionNeurons\(CODE_SESSION_NEURON_BASELINE, inputTokens, outputTokens\)/.test(ts), "CodeSession retains neuron-budget and cost accounting with route-owned fallback");
ok(/cf_agent_session_usage/.test(ts) && /input_tokens, output_tokens, neurons, cost_usd/.test(ts), "each completed streamed turn records tokens, neurons and estimated cost");
ok(/function codeSessionStream/.test(ts) && /text\/event-stream/.test(ts) && /last-event-id/.test(ts), "authenticated SSE reconnects from its last event id");
ok(/CodeSession: DurableObjectNamespace<CodeSession>/.test(ts) && /name = "CodeSession"\nclass_name = "CodeSession"/.test(toml) && /\[exports\.CodeSession\]/.test(toml), "CodeSession has an exported SQLite-backed Durable Object binding");
const usageMigration = readFileSync(new URL("../migrations/2026-11-01-code-session-usage.sql", import.meta.url), "utf8");
ok(/CREATE TABLE IF NOT EXISTS cf_agent_session_usage/.test(usageMigration) && /cost_usd REAL/.test(usageMigration), "CI migration creates the per-turn usage ledger");

ok(/INSERT OR REPLACE INTO fleet_heartbeat \(worker, version, ts, ok\)/.test(ts) && /return beat\(1\)/.test(ts) && /return beat\(0\)/.test(ts), "every cron tick writes fleet_heartbeat, ok or not (CRON-HEARTBEAT-1)");

// ALARM-TIMEOUT-1: a hung model step is bounded, and nothing started from the alarm can reject out of it.
ok(/const STEP_TIMEOUT_MS = 3 \* 60 \* 1000;/.test(ts) && /timeout: \{ totalMs: TURN_TIMEOUT_MS, stepMs: STEP_TIMEOUT_MS \}/.test(ts), "each model step has its own timeout inside the turn timeout");
ok(/void this\.runFiber\("turn:" \+ id[^\n]*\.catch\(\(e\) => logErr\("fiber-recover", e\)\)/.test(ts), "the recovery fiber started from the alarm cannot reject out of it");
ok(/try \{ await this\.startRun\(\{ text: payload\.text[^\n]*catch \(e\) \{ logErr\("scheduled-turn", e\); \}/.test(ts), "a scheduled turn that throws is logged, not retried by the alarm");

// ALARM-TIMEOUT-2: a rejection nobody awaits is logged with its stack and kept from failing the alarm invocation.
ok(/addEventListener\("unhandledrejection"/.test(ts) && /where: "unhandledrejection".{0,200}stack:/.test(ts) && /ev\.preventDefault\(\)/.test(ts), "an unhandled rejection is logged with its stack and prevented from failing the invocation");
ok(/try \{\s*\(globalThis as any\)\.addEventListener\("unhandledrejection"[\s\S]*?\} catch \(e\) \{ \/\* the event is not supported here \*\/ \}/.test(ts), "registering the listener cannot throw at load");

// QNFO-AGENTS-BUDGET-1: the loop drain takes its share of a daily neuron budget (slower, never stopped).
ok(Math.abs(agentNeurons(23818312, 579237) - 1022000) < 15000, "pricing: 23.8M input and 0.58M output tokens are about 1.02M neurons (the Cloudflare meter read 1.04M on 2026-11-04)");
ok(agentNeurons(0, 0) === 0 && agentNeurons("x", null) === 0, "unusable token counts price as 0");
{
  const DAY0 = Date.UTC(2026, 10, 5, 0, 0, 1);
  let seed = 12345;
  const cost = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return 1500 + (seed % 3000); };   // 1,500 to 4,500, mean 3,000: the 2,500 estimate is wrong on purpose
  const simulate = (budget, est, perTick) => {
    let spent = 0, started = 0, maxTick = 0, floorMax = 0, firstFloor = -1;
    const startsAt = [];
    for (let k = 0; k < 288; k++) {
      const now = DAY0 + k * AGENT_TICK_MS;
      const pl = agentDrainPlan(spent, budget, now, est, perTick);
      for (let j = 0; j < pl.take; j++) { spent += cost(); started++; startsAt.push(k); }
      maxTick = Math.max(maxTick, pl.take);
      if (spent >= budget && firstFloor < 0) firstFloor = k;
    }
    return { spent, started, maxTick, startsAt, firstFloor };
  };
  const g = simulate(250000, 2500, DRAIN_PER_TICK);
  ok(g.spent <= 250000 * 1.1 + AGENT_FLOOR_EVERY_TICKS * 4500, "a whole UTC day spends the budget and not much more: " + g.spent);
  ok(g.spent >= 250000 * 0.7, "and it is used, not starved: " + g.spent);
  ok(g.maxTick <= DRAIN_PER_TICK, "no tick starts more than the drain's per-tick bound");
  ok(g.started < 288 * DRAIN_PER_TICK / 4, "against the ungoverned 864 starts a day: " + g.started);
  let emptyWindow = 0;
  for (let w = 0; w + 36 <= 288; w += 36) if (!g.startsAt.some((k) => k >= w && k < w + 36)) emptyWindow++;
  ok(emptyWindow === 0, "every three-hour window of the day starts at least one request (slower, never stopped)");
  // a spent day keeps one request an hour and nothing more
  const spentDay = [];
  for (let k = 0; k < 288; k++) spentDay.push(agentDrainPlan(500000, 250000, DAY0 + k * AGENT_TICK_MS, 2500, DRAIN_PER_TICK).take);
  ok(spentDay.reduce((a, b) => a + b, 0) === 288 / AGENT_FLOOR_EVERY_TICKS && Math.max(...spentDay) === 1, "a spent day starts exactly one request every " + AGENT_FLOOR_EVERY_TICKS + " ticks: " + spentDay.reduce((a, b) => a + b, 0));
  // an early, unspent day lets the drain work at its per-tick bound
  const early = agentDrainPlan(0, 3000000, DAY0, 2500, DRAIN_PER_TICK);
  ok(early.limited === true && early.take === DRAIN_PER_TICK && early.duty === 1, "a large budget early in the day runs at the drain's per-tick bound");
  // unreadable spend, no budget, 'off': not limited, at the per-tick bound
  ok(agentDrainPlan(null, 250000, DAY0, 2500, 3).limited === false && agentDrainPlan(null, 250000, DAY0, 2500, 3).take === 3, "an unreadable ledger never throttles the queue");
  ok(agentDrainPlan(1e9, 0, DAY0, 2500, 3).limited === false && agentDrainPlan(1e9, -1, DAY0, 2500, 3).take === 3, "budget 0 or below (off) disables the governor");
  ok(AGENT_DAILY_NEURONS_DEFAULT === 250000, "the default budget is 250k neurons a day");
  ok(AGENT_SHED_MIN < 120 && AGENT_SHED_MIN >= 60, "a request the budget cannot start leaves the queue before the 120-minute bar");
}
ok(/async function agentPlan\(env: Env\)[\s\S]*?FROM ai_spend_ledger WHERE day = \?1 AND caller = \?2/.test(ts), "the spend is read from the ledger rows this worker wrote");
ok(/const gov = await agentPlan\(env\);\s*let modelSlots = gov\.plan\.take;/.test(ts), "the drain asks the governor once a tick");
ok(/q\.priority !== "critical" && !\/\^lever-\/\.test\(String\(q\.instance \|\| ""\)\) && String\(q\.kind \|\| "run"\) === "run"\) \{\s*if \(modelSlots <= 0\) \{ out\.deferred\+\+; continue; \}\s*modelSlots--;/.test(ts), "critical, lever-* instance and no-model requests are never deferred");
ok(!/requester NOT LIKE 'lever-%'/.test(ts) && !/\^lever-\/\.test\(String\(q\.requester/.test(ts), "the lever exemption never reads the requester (lever rows: requester program-manager:QNFO.*, instance lever-<trigger>-<stamp>)");
ok(/COALESCE\(instance, ''\) NOT LIKE 'lever-%' AND COALESCE\(kind, 'run'\) = 'run' AND created_at < strftime/.test(ts), "a request on a lever-* instance is never shed either: its rows are a measured verdict window");
ok(/if \(gov\.plan\.limited\) \{\s*const old: any = await db\.prepare\("SELECT id FROM cf_agent_requests WHERE status = 'queued' AND priority != 'critical' AND COALESCE\(instance, ''\) NOT LIKE 'lever-%' AND COALESCE\(kind, 'run'\) = 'run' AND created_at < strftime/.test(ts) && /shed: waited over/.test(ts), "while limited, a queued non-critical model request older than AGENT_SHED_MIN minutes is failed with the reason");
ok(ts.indexOf("const gov = await agentPlan(env);") < ts.indexOf("const queued: any = await db.prepare(\"SELECT * FROM cf_agent_requests WHERE status = 'queued'"), "the shed runs before the queue is read, so a shed request is never started");
ok(/qnfo_agents_daily_neurons/.test(ts) && /raw === "off" \? 0/.test(ts), "ops_config qnfo_agents_daily_neurons sets the budget and off disables it");

// AGENTS-LEAN-1
ok(leanCaller("loop:issue-probe-agent") && leanCaller("issue-probe-agent") && leanCaller("loop:program-manager:QNFO.OPS"), "the loop callers as they arrive (loop:<requester>) are lean");
ok(!leanCaller("qnfo-fleet-dashboard") && !leanCaller("loop:code-agent") && !leanCaller("") && !leanCaller(null), "console and other loop callers keep every tool");
ok(leanConfigOn(undefined) && leanConfigOn("on") && !leanConfigOn("off") && !leanConfigOn(" OFF "), "ops_config qnfo_agents_lean = off is the kill switch");
ok(LEAN_MAX_STEPS <= 6, "a lean turn stops at 6 steps");
{
  const small = { ok: true, rows: 1, results: [{ a: 1 }] };
  ok(capResult(small, LEAN_RESULT_CHARS) === small, "a small tool result passes unchanged");
  const big = capResult({ ok: true, rows: 200, results: new Array(200).fill({ k: "x".repeat(100) }) }, LEAN_RESULT_CHARS);
  ok(big.truncated === true && JSON.stringify(big).length < LEAN_RESULT_CHARS + 400, "a big tool result is cut to the hard cap");
}
ok(/if \(c\.lean\) return t;/.test(ts) && /if \(c\.lean\) return tools;/.test(ts), "lean turns get no ops catalog, writes, code mode or MCP tools");
ok(/stepCountIs\(lean \? LEAN_MAX_STEPS/.test(ts) && !/\/\^issue-probe-agent\//.test(ts), "the step cap matches the loop: caller and no longer anchors on the bare requester name");
ok(/qnfo_agents_lean/.test(ts), "the kill switch key is read");

console.log("qnfo-agents worker.test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
