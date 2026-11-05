// AGENT-RPC-1 (qnfo-ops 2.55.0), offline. Locks the two defects found on 2026-10-25:
//   1. AgenticOpsExec never called super(ctx, env): every request to /agents/ops-exec answered HTTP 500
//      (edge error 1101) because a derived-class constructor touched `this` before super().
//   2. The durable agent could only be driven over a WebSocket, so no dashboard or worker could use it.
// ADVERSARIAL: this is a source-shape test. It proves the constructor calls super() and that the HTTP RPC and the
// shared runTurn exist in the deployed file; it cannot prove the DO boots. The live proof is a POST to
// /agents/ops-exec answering {ok:true, reply:...} and a WebSocket upgrade answering 101.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

const cls = src.slice(src.indexOf("var AgenticOpsExec = class extends DurableObject"));
ok(cls.length > 0, "AgenticOpsExec class present");
const ctor = cls.slice(0, cls.indexOf("async fetch(request)"));
ok(/constructor\(ctx, env\) \{\s*super\(ctx, env\);/.test(ctor), "DO constructor calls super(ctx, env) before touching this");
ok(ctor.indexOf("super(ctx, env)") < ctor.indexOf("this.ctx = ctx"), "super() precedes the first this access");

const body = cls.slice(cls.indexOf("async fetch(request)"), cls.indexOf("async webSocketClose"));
ok(/request\.method === "POST"/.test(body), "DO fetch handles POST (HTTP RPC)");
ok(/op === "history"/.test(body) && /op === "reset"/.test(body) && /op === "run"|const op = String/.test(body), "HTTP RPC ops: run / history / reset");
ok(/this\.runTurn\(sid, text, body && body\.max_iters\)/.test(body), "HTTP RPC runs a real agent turn with the caller cap");

ok(/async runTurn\(sid, userContent, cap(?:, onStep)?(?:, opts)?\)/.test(cls), "runTurn is the shared agent loop");
ok(/webSocketMessage[\s\S]{0,900}await this\.runTurn\(sid, userContent\)/.test(cls), "the WebSocket path delegates to runTurn (no duplicated loop)");
ok((cls.match(/opsAgentChat\(this\.env/g) || []).length === 2, "exactly two model calls in runTurn (loop + final no-tools round)");
ok(/opsAgentSpan\("invoke_agent", conversationId/.test(cls), "each durable runTurn emits one invoke_agent span");
ok(/opsAgentChat\(this\.env, messages, DEFAULT_MAX_OUT, toolsPayload\(\), \{\}, conversationId\)/.test(cls), "model rounds are nested chat spans");
ok(/opsAgentTool\(this\.env, fn\.name, fn\.arguments, userContent, 16e3, conversationId\)/.test(cls), "tool rounds are nested execute_tool spans");
const traceHelpers = src.slice(src.indexOf("async function opsTraceConversationId"), src.indexOf("var AgenticOpsExec"));
ok(/crypto\.subtle\.digest\("SHA-256"/.test(traceHelpers) && /gen_ai\.conversation\.id/.test(traceHelpers), "trace conversation identity is an opaque stable hash");
ok(!/gen_ai\.(?:input|output)\.messages|gen_ai\.tool\.call\.(?:arguments|result)/.test(traceHelpers + cls), "agent tracing does not attach prompt, message, argument, or result payloads");

const manifest = src.slice(src.indexOf("function manifest()"), src.indexOf("function manifest()") + 4000);
ok(/"agent-http-rpc"/.test(manifest), "capability agent-http-rpc advertised");
ok(/"tool-bridge"/.test(manifest), "capability tool-bridge advertised");


// AGENT-SCHEDULE-1 (2.55.1) + AGENT-RPC-1.1 (the max_iters cap the console sends).
const iFn = src.indexOf("function agentWhen(v) {");
ok(iFn > 0, "agentWhen present");
const whenSrc = src.slice(iFn, src.indexOf("\n}\n", iFn) + 2);
const agentWhen = new Function(whenSrc + "\nreturn agentWhen;")();
const t0 = Date.now();
const near = (a, b) => Math.abs(a - b) < 3000;
ok(near(agentWhen("5m"), t0 + 300000), "5m is five minutes out");
ok(near(agentWhen("90s"), t0 + 90000), "90s is ninety seconds out");
ok(near(agentWhen("2h"), t0 + 7200000), "2h is two hours out");
ok(near(agentWhen("1d"), t0 + 86400000), "1d is one day out");
ok(near(agentWhen(String(t0 + 600000)), t0 + 600000), "an epoch ms value is taken as-is");
ok(agentWhen("nonsense") === 0 && agentWhen("") === 0 && agentWhen(null) === 0, "an unparseable when is 0, never a silent now");

ok(/async runTurn\(sid, userContent, cap(?:, onStep)?(?:, opts)?\)/.test(src), "runTurn takes a caller cap");
ok(/Math\.min\(_envMax, Math\.floor\(_capN\)\)/.test(src), "the cap is clamped to the worker ceiling, never raised");
ok(/this\.runTurn\(sid, text, body && body\.max_iters\)/.test(src), "the HTTP run passes body.max_iters");
ok(/op === "schedule"/.test(src) && /op === "schedules"/.test(src) && /op === "cancel"/.test(src) && /op === "receipts"/.test(src), "schedule / schedules / cancel / receipts ops");
ok(/async alarm\(\) \{/.test(src), "alarm() runs due schedules");
ok(/storage\.setAlarm\(min\)/.test(src) && /deleteAlarm/.test(src), "the alarm is re-armed from storage, and cleared when empty");
ok(/storage\.put\("receipt:" \+ v\.id/.test(src), "a finished schedule leaves a receipt");
ok(/storage\.delete\("schedule:" \+ v\.id\)/.test(src), "a due schedule is removed after it runs");
ok(/"agent-schedule"/.test(src), "capability agent-schedule advertised");

// CMD-AGENT-1 (2.60.0): background runs for the console command line.
ok(/op === "start"/.test(src) && /op === "result"/.test(src), "start / result ops for background agent runs");
ok(/storage\.put\("run:" \+ rid/.test(src) && /storage\.put\("schedule:" \+ rid, row\)/.test(src), "start stores the run and a due schedule row, then arms the alarm");
ok(/if \(v\.run\) \{/.test(src) && /status: r && r\.ok \? "done" : "failed"/.test(src), "alarm() runs a run row and records done or failed with the reply");
ok(/steps\.push\(\{ tool:/.test(src) && /onStep\(steps\)/.test(src), "each tool round is recorded as a live step");
const chatBudgetStart = src.indexOf("if (!withTools) {", src.indexOf("const runner ="));
const chatBudget = src.slice(chatBudgetStart, src.indexOf("const _dsOpts", chatBudgetStart));
ok(chatBudget.indexOf("opsBudgetPromote") >= 0 && chatBudget.indexOf("opsBudgetPromote") < chatBudget.indexOf("opsToolBudgetBail"), "the interactive loop attempts durable recovery before recording a bail");
ok(/if \(_firstBail && !promotedJobId\) opsToolBudgetBail\(env/.test(chatBudget), "a successful durable handoff is not counted as an interactive bail");
ok(/"ops_agent_session_budget"/.test(src), "durable agent-session budget events use a separate event kind");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
