// OPS-TOOL-ERRSHAPE-1 / OPS-WEBSEARCH-PATHS-1 offline suite (issues 5776, 5780, 6173, 6193, 6671, 6792, 6826). No network.
// The residual tool-failure shapes after OPS-ARG-ALIAS-1 (2.62.20), each seen in cloud_ops_events on 2026-11-04:
//   cf_worker_read {name:"cf_worker_read", arguments:{worker, maxChars}}   (function-call envelope sent as the arguments; then a 404 on the tool's own name)
//   workspace_grep {pattern:"(?i)qniverse|q08-tasks"}                      (PCRE inline flag, "Invalid group")
//   fleet_graph {op:"grep"|"routes"|"stats", query}                        (invented op, answered with an error the model retried)
//   fleet_graph impact id table:qnfo-audit:spof_registry                   (a node the graph does not hold, logged as a tool error)
//   web_search: one provider, HTTP error ended the call; the lite fallback was the same provider
// Run: node qnfo-ops/tool-errshape.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
const grab = (start, end) => { const i = src.indexOf(start), j = src.indexOf(end, i); return i >= 0 && j > i ? src.slice(i, j) : ""; };

const pieces = [
  grab("function opsArgPick(args, keys) {", "\nasync function fleetGraphTool"),
  grab("var FPA_GRAPH_OPS =", "\n// OPS-ARG-ALIAS-1"),
  grab("function fpaCap(s, n) {", "\nfunction fpaIssueRow"),
  grab("async function fleetGraphTool(env, args) {", "\nasync function dashboardFeed"),
  grab("async function cfWorkerRead(env, args) {", "\n__name(cfWorkerRead"),
  grab("async function workspaceGrep(env, args) {", "\n__name(workspaceGrep"),
  grab("function b64Utf8(b64) {", "\n// ---- UTF8-DEPLOY-1:END"),
  grab("var WS_UA =", "\n__name(webSearchTool"),
];
ok(pieces.every((p) => p.length > 10), "all functions found in worker.js", pieces.map((p) => p.length));
const logSrc = grab("function opsFitArgs(args, budget) {", "\n__name(logToolEvent");
ok(logSrc.length > 100 && /async function logToolEvent/.test(logSrc), "opsFitArgs and logToolEvent found");
const codeRe = new Function(grab("var OPS_USER_CODE_RE =", "\nfunction opsUserCodeHint") + "\nreturn OPS_USER_CODE_RE;")();
const codeHint = new Function(grab("function opsUserCodeHint(msg) {", "\nasync function runCodeTool") + "\nreturn opsUserCodeHint;")();
const execSrc = grab("async function execTool(env, name, rawArgs, userText, resultCap) {", "\n  const t0 = Date.now();");
ok(/args = opsUnwrapToolArgs\(name, args\);/.test(execSrc), "execTool unwraps the call envelope before dispatch");

const harness = pieces.join("\n").replace(/\n__name\w*\([^\n]*\);?/g, "") + "\nreturn { fleetGraphTool, cfWorkerRead, workspaceGrep, webSearchTool, opsUnwrapToolArgs, wsParseBing, wsParseDdgHtml, wsParseDdgLite };";
const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
let calls = [];
let responder = () => new Response("{}", { status: 404 });
globalThis.fetch = async (url, init) => { calls.push(String(url)); return responder(String(url), init || {}); };
const t = new Function("stripHtml", "CF_ACCOUNT_ID", harness)(stripHtml, "acct");
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });

// ---- envelope unwrap (6671, 6792)
const U = t.opsUnwrapToolArgs;
let a = U("cf_worker_read", { name: "cf_worker_read", arguments: { worker: "qnfo-workers", maxChars: 600 } });
ok(a.worker === "qnfo-workers" && a.maxChars === 600 && a.name === undefined && a.arguments === undefined, "{name:<tool>, arguments:{...}} is unwrapped to the inner arguments", a);
a = U("cf_worker_read", { name: "cf_worker_read", arguments: JSON.stringify({ worker: "qnfo-ops" }) });
ok(a.worker === "qnfo-ops", "an envelope whose arguments is a JSON string is unwrapped", a);
a = U("cf_worker_read", { arguments: { worker: "qnfo-ops" } });
ok(a.worker === "qnfo-ops", "arguments alone (no name) is unwrapped", a);
a = U("composio_execute", { tool_slug: "GMAIL_SEND", arguments: { to: "a@b" } });
ok(a.tool_slug === "GMAIL_SEND" && a.arguments && a.arguments.to === "a@b", "composio_execute keeps its own `arguments` parameter", a);
a = U("run_code", { code: "return 1", input: { a: 1 } });
ok(a.code === "return 1" && a.input && a.input.a === 1, "run_code keeps its own `input`", a);
a = U("ops_execute", { tool: "fleet_status", arguments: {} });
ok(a.tool === "fleet_status" && "arguments" in a, "the code-mode ops_execute wrapper is not an envelope for another tool", a);
a = U("cf_worker_read", { name: "qnfo-research-exec", maxChars: 200000 });
ok(a.name === "qnfo-research-exec" && a.maxChars === 200000, "a plain name alias (no envelope) is left for the tool's own alias handling", a);
a = U("fleet_graph", { name: "fleet_graph", input: { op: "find", query: "x" } });
ok(a.op === "find" && a.query === "x", "input inside an envelope named for the tool is unwrapped", a);
a = U("workspace_grep", { arguments: { pattern: "x" }, extra: 1 });
ok(a.extra === 1 && a.arguments, "an extra outer key means it is not an envelope", a);
ok(U("x", null) === null && U("x", "s") === "s" && Array.isArray(U("x", [1])), "non-object arguments pass through");

// the wrapped call end to end: cf_worker_read reads qnfo-workers, not the tool's own name
calls = [];
responder = () => new Response(JSON.stringify({ result: { id: "w" }, success: true }), { status: 200 });
await t.cfWorkerRead({ CF_API_TOKEN: "t" }, U("cf_worker_read", { name: "cf_worker_read", arguments: { worker: "qnfo-workers", maxChars: 600 } }));
ok(calls.length > 0 && calls.every((u) => /scripts\/qnfo-workers/.test(u)) && !calls.some((u) => /scripts\/cf_worker_read/.test(u)), "the unwrapped call targets the real worker", calls);

// ---- cf_worker_read on a name that is not deployed is a miss, not a failure
calls = [];
responder = (u) => /\/content\/v2$/.test(u) ? new Response("nope", { status: 404 }) : /scripts\?per_page/.test(u) ? J({ result: [{ id: "idea-hub" }, { id: "qnfo-ops" }] }) : J({ result: {} });
let r = await t.cfWorkerRead({ CF_API_TOKEN: "t" }, { worker: "cf_worker_read" });
ok(!r.ok && r.not_found === true && /not a deployed worker/.test(r.error) && /idea-hub/.test(r.error), "a worker name that is not deployed is not_found and lists real names", r);
const rows = [];
const envLog = { QNFO_AUDIT: { prepare() { let b = []; const s = { bind(...x) { b = x; return s; }, async run() { rows.push(b); return {}; } }; return s; } } };
// the same 600-character cut the real redactedSnippet applies, so a meta that does not fit shows up as invalid JSON here too
const logToolEvent = new Function("randId", "iso", "redactedSnippet", "logAuditTrail", logSrc + "\nreturn logToolEvent;")(() => "evt-x", () => "2026-11-05T00:00:00Z", (o, n) => JSON.stringify(o).slice(0, n || 2e3), async () => {});
const statusOf = async (name, res) => { rows.length = 0; await logToolEvent(envLog, name, {}, res, 1); return rows[0][6]; };
ok(await statusOf("cf_worker_read", r) === "ok", "that miss is logged status ok (no TOOL-FAILURE / LOOP-BREAKER row)");

// ---- run_code_net meta stays readable (6826)
rows.length = 0;
const longCode = "const pr = await (await fetch('https://api.github.com/repos/QNFO/qnfo-workers/pulls/6690')).json();\n" + "out.x = pr.files.map(f => f.filename);\n".repeat(60);
await logToolEvent(envLog, "run_code_net", { code: longCode, timeout: 5000, nested: { a: "x".repeat(400) } }, { ok: false, user_code_error: true, error: "(files || []).map is not a function" }, 30);
let meta;
try { meta = JSON.parse(rows[0][4]); } catch (e) { meta = null; }
ok(meta && meta._truncated === undefined && meta.error === "(files || []).map is not a function" && meta.resultOk === false && meta.ms === 30 && typeof meta.args.code === "string" && meta.args.code.length < 260 && meta.args.timeout === 5000 && rows[0][4].length <= 600 && rows[0][6] === "rejected", "a run_code_net failure with a 2 KB program keeps error, resultOk, ms and short args as one valid JSON object, and is logged rejected", rows[0]);
rows.length = 0;
await logToolEvent(envLog, "fleet_graph", { op: "impact", id: "worker:qnfo-ops", depth: 2 }, { ok: false, error: "x".repeat(300) }, 3);
meta = JSON.parse(rows[0][4]);
ok(meta.args.op === "impact" && meta.args.id === "worker:qnfo-ops" && meta.args.depth === 2, "short arguments (op, id, depth) are logged unchanged, so probes can read $.args.op", meta);
rows.length = 0;
await logToolEvent(envLog, "x", Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["k" + i, "v".repeat(300)])), { ok: false, error: "e".repeat(300) }, 1);
ok((() => { try { const m = JSON.parse(rows[0][4]); return m.error === "e".repeat(300) && !!m.args; } catch (e) { return false; } })(), "even 40 long arguments plus a 300-character error stay one valid JSON object", rows[0][4].length);
ok(codeRe.test("Code generation from strings disallowed for this context") && codeRe.test("Unexpected token 'R', \"Request fo\"... is not valid JSON") && codeRe.test("x is not a constructor") && !codeRe.test("D1_ERROR: D1 DB is overloaded") && !codeRe.test("fetch failed"), "the user-code matcher covers eval refusal, JSON.parse failures and constructors, and still excludes D1 overload and network failures");
ok(/new Function/.test(codeHint("Code generation from strings disallowed for this context")) && /\.map/.test(codeHint("x.map is not a function")), "the hint names the eval refusal specifically");

// ---- workspace_grep inline flags and bad patterns (5780)
const files = { "ops-workspace/a.txt": "Qniverse tasks\nnothing\nq08-TASKS here\n", "ops-workspace/b.txt": "lower qniverse\n" };
const gEnv = { BACKUPS_R2: { list: async () => ({ objects: Object.keys(files).map((key) => ({ key })) }), get: async (k) => ({ text: async () => files[k] }) } };
r = await t.workspaceGrep(gEnv, { pattern: "(?i)qniverse|q08-tasks|qniverse-tasks", context: 2 });
ok(r.ok && r.count === 3, "a leading (?i) is accepted as the i flag and matches across case", r);
r = await t.workspaceGrep(gEnv, { pattern: "(?is)QNIVERSE" });
ok(r.ok && r.count === 2, "(?is) combines flags", r);
r = await t.workspaceGrep(gEnv, { pattern: "QNIVERSE", ignoreCase: true });
ok(r.ok && r.count === 2, "ignoreCase:true sets the i flag", r);
r = await t.workspaceGrep(gEnv, { pattern: "QNIVERSE" });
ok(r.ok && r.count === 0, "without a flag the match stays case-sensitive", r);
r = await t.workspaceGrep(gEnv, { pattern: "foo(" });
ok(!r.ok && r.arg_error === true && /invalid regex/.test(r.error) && /ignoreCase/.test(r.hint), "an invalid regex is an arg_error with a hint", r);
ok(await statusOf("workspace_grep", r) === "rejected", "an invalid regex is logged status rejected, not error");

// ---- fleet_graph (6173, 6193)
let seen = [];
let graphReply = () => J({ nodes: [] });
const env = { MEMORY: { fetch: async (u) => { seen.push(u); return graphReply(u); } } };
r = await t.fleetGraphTool(env, { op: "grep", query: "/api/managers" });
ok(r.ok && r.op === "find" && /fleet-graph\/find\?/.test(seen[0]), "op:grep with a query is the find alias", [r, seen]);
seen = [];
r = await t.fleetGraphTool(env, { op: "scan", query: "/api/managers" });
ok(r.ok && r.op === "find" && /op 'scan' is not a fleet_graph op; ran 'find'/.test(r.note), "an invented op with a query runs find and says so", [r, seen]);
r = await t.fleetGraphTool(env, { op: "routes", query: "/api/managers" });
ok(r.ok && r.op === "find", "op:routes with a query runs find", r);
r = await t.fleetGraphTool(env, { op: "stats", query: "/api/managers" });
ok(r.ok && r.op === "freshness" && !/op 'stats'/.test(r.note || ""), "op:stats is the freshness alias", r);
r = await t.fleetGraphTool(env, { op: "bogus", id: "worker:qnfo-ops" });
ok(r.ok && r.op === "node" && /op 'bogus'/.test(r.note), "an unknown op with an id runs node", r);
r = await t.fleetGraphTool(env, { query: "x".repeat(150) });
ok(!r.ok && r.arg_error === true && r.hint, "an over-long query is an arg_error with a hint", r);
seen = [];
graphReply = (u) => /\/find\?/.test(u) ? J({ nodes: [{ id: "d1t:qnfo-audit.spof_registry", kind: "d1_table" }] }) : J({ error: "no node with id or name table:qnfo-audit:spof_registry; use fleet_graph_find" }, 400);
r = await t.fleetGraphTool(env, { op: "impact", id: "table:qnfo-audit:spof_registry" });
ok(!r.ok && r.not_found === true && !r.arg_error && Array.isArray(r.candidates) && r.candidates[0].id === "d1t:qnfo-audit.spof_registry" && /find/.test(r.hint) && /query=spof_registry/.test(seen[1] || ""), "a node the graph does not hold is not_found with the nearest nodes for the last id token", [r, seen]);
ok(await statusOf("fleet_graph", r) === "ok", "that miss is logged status ok");
graphReply = () => J({ error: "depth must be 1-6" }, 400);
r = await t.fleetGraphTool(env, { op: "impact", id: "worker:qnfo-ops", depth: 99 });
ok(!r.ok && r.arg_error === true && !r.not_found, "any other 400 is an arg_error", r);
graphReply = () => new Response("boom", { status: 500 });
r = await t.fleetGraphTool(env, { op: "freshness" });
ok(!r.ok && !r.arg_error && !r.not_found && r.status === 500, "a 500 stays a real tool error", r);

// ---- web_search paths (5776)
const BING = '<ol id="b_results"><li class="b_algo" data-id iid=SERP.5349><div class="b_tpcn"><a class="tilk" href="https://www.bing.com/ck/a?!&amp;&amp;p=25ba&amp;u=a1aHR0cHM6Ly93d3cuY2xvdWRmbGFyZS5jb20v&amp;ntb=1"><div class="tpic"></div></a></div><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=25ba&amp;u=a1aHR0cHM6Ly93d3cuY2xvdWRmbGFyZS5jb20v&amp;ntb=1" h="ID=SERP,5127.2">Cloudflare: Build for the agent era</a></h2><div class="b_caption"><p class="b_lineclamp2">Join thousands of developers who have eliminated complexity.</p></div></li>' +
  '<li class="b_algo" data-id iid=SERP.5350><h2><a href="https://en.wikipedia.org/wiki/Cloudflare" h="ID=SERP,5142.1">Cloudflare - Wikipedia</a></h2><div class="b_caption"><p class="b_lineclamp3">Cloudflare, Inc., is an American company.</p></div></li>' +
  '<li class="b_algo" data-id iid=SERP.5351><h2><a href="/relative/path">Relative</a></h2></li></ol>';
const bp = t.wsParseBing(BING, 5);
ok(bp.length === 2 && bp[0].url === "https://www.cloudflare.com/" && bp[0].title === "Cloudflare: Build for the agent era" && /Join thousands/.test(bp[0].snippet) && bp[1].url === "https://en.wikipedia.org/wiki/Cloudflare" && bp[1].snippet.startsWith("Cloudflare, Inc."), "the Bing parser decodes the ck/a wrapper (u=a1<base64url>), keeps direct links, skips relative links", bp);
ok(t.wsParseBing(BING, 1).length === 1 && t.wsParseBing("<html></html>", 5).length === 0, "the Bing parser is bounded by k and empty on a page with no results");
const isDdgHtml = (u) => /html\.duckduckgo\.com/.test(u);
const isLite = (u) => /lite\.duckduckgo\.com/.test(u);
const isBing = (u) => /bing\.com\/search/.test(u);
const DDG = '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2F">T</a><a class="result__snippet" href="x">S</a>';
const LITE = '<a href="https://lite.duckduckgo.com/lite/?uddg=https%3A%2F%2Fb.example%2F" class="result-link">B</a>';

responder = (u) => isDdgHtml(u) ? new Response("blocked", { status: 403 }) : isLite(u) ? new Response("<html>challenge</html>", { status: 202 }) : new Response(BING, { status: 200 });
calls = [];
r = await t.webSearchTool({}, { q: "cloudflare" });
ok(r.ok === true && r.search_path === "bing" && r.provider === "bing" && r.results.length === 2 && calls.length === 3, "DuckDuckGo refusing both ways falls through to Bing and names it", { r, calls });
ok(r.paths_tried.map((p) => p.path + ":" + p.status + ":" + p.results).join() === "ddg-html:403:0,ddg-lite:202:0,bing:200:2" && /challenge page/.test(r.paths_tried[1].error), "paths_tried records each path with its HTTP status, results and reason", r.paths_tried);
responder = (u) => isDdgHtml(u) ? new Response(DDG, { status: 200 }) : new Response("unused", { status: 500 });
calls = [];
r = await t.webSearchTool({}, { q: "p" });
ok(r.ok === true && r.search_path === "ddg-html" && r.path === "primary" && calls.length === 1, "a first-path hit makes one request and keeps the legacy path name", { r, calls });
responder = (u) => isDdgHtml(u) ? new Response("<html></html>", { status: 200 }) : isLite(u) ? new Response(LITE, { status: 200 }) : new Response("unused", { status: 500 });
calls = [];
r = await t.webSearchTool({}, { q: "p" });
ok(r.ok === true && r.search_path === "ddg-lite" && r.path === "fallback" && calls.length === 2 && r.results[0].url === "https://b.example/", "an empty first path runs the lite path next (legacy path name fallback)", { r, calls });
responder = (u) => { throw new Error("network down: " + u); };
calls = [];
r = await t.webSearchTool({}, { q: "p" });
ok(r.ok === false && r.search_unavailable === true && r.path === "all-failed" && r.paths_tried.length === 3 && /network down/.test(r.paths_tried[0].error) && !("results" in r), "when every path fails the call fails closed with no results list", r);
responder = () => new Response("<html></html>", { status: 200 });
r = await t.webSearchTool({}, { q: "p" });
ok(r.ok === false && r.search_unavailable === true && /0 results parsed/.test(r.error), "zero results from every provider is an error, not an empty success", r);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
