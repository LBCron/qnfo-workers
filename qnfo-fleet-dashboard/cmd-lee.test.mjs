// RM-LEE-CMD-1 (qnfo-fleet-dashboard 1.95.0): Lee, the Cloudflare-account assistant, in the fleet command line (GitHub 5482). Proves: the verb parser keeps ordinary lines ordinary ("Lee is
// not a person", "cf cache"), every tool validates its arguments and only reads (no write call is ever issued, even when the model asks for one), a missing token permission is
// reported as a permission, the route needs the owner session and honours ops_config cmd_lee, the model loop runs as a polled job, and /api/cmd/lee/health reports booleans only.
// Run: node qnfo-fleet-dashboard/cmd-lee.test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.js";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

// ---- the Lee block on its own (parser, tools) with a stubbed Cloudflare API
const calls = [];
let cfReply = () => ({ status: 200, json: { success: true, result: [] } });
const cfFetch = async (url, init) => {
  const u = String(url);
  calls.push({ method: (init && init.method) || "GET", url: u, body: init && init.body ? String(init.body) : null });
  const r = cfReply(u, init);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, text: async () => JSON.stringify(r.json) };
};
const block = src.slice(src.indexOf("var LEE_MODEL"), src.indexOf("// ==== AREA-MAP platform: fleet console")) + "\nthis.leeParse = leeParse; this.leeTool = leeTool; this.leeText = leeText; this.leeRun = leeRun; this.leeEnabled = leeEnabled; this.LEE_TOOL_DEFS = LEE_TOOL_DEFS;";
const ctx = { ACCOUNT: "acc123", VERSION: "t", AbortSignal, fetch: cfFetch, setTimeout, clearTimeout, Promise, JSON, Math, Number, String, Object, Array, Date, Error, RegExp, encodeURIComponent, console, cmdRandHex: () => "abcdef0123" };
vm.createContext(ctx);
vm.runInContext(block, ctx);
const P = ctx.leeParse;

ok(P("cf zones").tool === "list_zones", "cf zones is the zones read");
ok(JSON.stringify(P("cf dns qnfo.org")) === JSON.stringify({ tool: "list_dns_records", args: { zone: "qnfo.org" } }), "cf dns takes a zone", P("cf dns qnfo.org"));
ok(P("cf traffic qnfo.org 7").args.days === "7" && P("cf stats my-worker 12").args.hours === "12" && P("cf logs my-worker 30").args.minutes === "30", "optional numbers are read in order");
ok(P("CF Workers").tool === "list_workers", "verbs are case-insensitive");
ok(P("cf help").help === true && P("lee").help === true && P("lee:").help === true, "help forms");
ok(P("lee: how many zones are there?").ask === "how many zones are there?" && P("ask lee: dns of q08.org").ask === "dns of q08.org", "lee: with the colon is a model question");
ok(P("Lee is not a person") === null && P("lee@example.com is not a person") === null && P("lee, what is the status") === null, "a line that merely starts with the name Lee stays an ordinary question");
ok(P("cf cache rules") === null && P("cfagent runs") === null && P("status") === null && P("tools") === null, "other cf words and other verbs are not Lee");

// tools: arguments are validated before any request
calls.length = 0;
let r = await ctx.leeTool({ CF_TOKEN: "t" }, "list_dns_records", { zone: "../../accounts" });
ok(r.ok === false && /zone must be a domain/.test(r.error) && calls.length === 0, "a zone that is not a domain is refused with no request", r);
r = await ctx.leeTool({ CF_TOKEN: "t" }, "get_worker", { script: "a/b" });
ok(r.ok === false && /Worker script name/.test(r.error) && calls.length === 0, "a script name with a slash is refused with no request", r);
r = await ctx.leeTool({ CF_TOKEN: "t" }, "list_pages_deployments", { name: "x y" });
ok(r.ok === false && calls.length === 0, "a Pages project name with a space is refused", r);
r = await ctx.leeTool({}, "list_zones", {});
ok(r.ok === false && /CF_TOKEN is not set/.test(r.error), "no token is said plainly", r);

// tools: reads
cfReply = (u) => u.includes("/zones?per_page=50") ? { status: 200, json: { success: true, result: [{ id: "a".repeat(32), name: "qnfo.org", status: "active" }, { id: "b".repeat(32), name: "q08.org", status: "active" }] } } : { status: 404, json: { success: false, errors: [{ message: "nope" }] } };
calls.length = 0;
r = await ctx.leeTool({ CF_TOKEN: "t" }, "list_zones", {});
ok(r.ok && r.rows.length === 2 && r.rows[0].zone === "qnfo.org", "list_zones returns zone, id, status", r);
ok(/zones \(2\):\n {2}zone qnfo\.org \| id a{32} \| status active/.test(ctx.leeText("list_zones", r)), "the verb text is one line per row", ctx.leeText("list_zones", r));
ok(calls.length === 1 && calls[0].method === "GET" && calls[0].url === "https://api.cloudflare.com/client/v4/zones?per_page=50", "one GET", calls);

cfReply = (u) => u.includes("/zones?name=") ? { status: 200, json: { success: true, result: [{ id: "c".repeat(32) }] } } : u.includes("/dns_records") ? { status: 200, json: { success: true, result: [{ type: "A", name: "qnfo.org", content: "1.2.3.4", proxied: true, ttl: 1, id: "r1" }] } } : { status: 404, json: { success: false, errors: [] } };
calls.length = 0;
r = await ctx.leeTool({ CF_TOKEN: "t" }, "list_dns_records", { zone: "QNFO.org" });
ok(r.ok && r.rows[0].type === "A" && r.rows[0].name === "qnfo.org", "dns records come back by zone name", r);
ok(calls.length === 2 && calls[0].url.endsWith("/zones?name=qnfo.org&per_page=1") && calls[1].url.endsWith("/zones/" + "c".repeat(32) + "/dns_records?per_page=100"), "the zone name is resolved first, exactly", calls.map((c) => c.url));

cfReply = () => ({ status: 403, json: { success: false, errors: [{ message: "Authentication error" }] } });
r = await ctx.leeTool({ CF_TOKEN: "t" }, "list_workers", {});
ok(r.ok === false && /HTTP 403: Authentication error/.test(r.error) && /lacks the Workers Scripts Read permission/.test(r.hint), "a 403 names the missing token permission", r);
ok(/Workers Scripts Read/.test(ctx.leeText("list_workers", r)), "and the verb text says it");

cfReply = (u) => u.includes("graphql") ? { status: 200, json: { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 10, errors: 2, cpuTime: 4000, wallTime: 9 }, dimensions: { scriptName: "qnfo-ops", status: "success" } }] }] } } } } : { status: 404, json: {} };
calls.length = 0;
r = await ctx.leeTool({ CF_TOKEN: "t" }, "get_worker_analytics", { script: "qnfo-ops", hours: 9999 });
ok(r.ok && r.rows[0].script === "qnfo-ops" && r.rows[0].cpu_ms === 4 && calls[0].method === "POST" && /graphql$/.test(calls[0].url), "worker analytics is a read-only GraphQL query", r);
ok(JSON.parse(calls[0].body).variables.n === "qnfo-ops" && Date.now() - Date.parse(JSON.parse(calls[0].body).variables.s) <= 168 * 36e5 + 5e3, "hours are capped at 168", JSON.parse(calls[0].body).variables);

// the model loop: asks for one read, then answers; a write tool the model invents is refused and issues no request
let modelCalls = 0;
const writeAttempt = { tool_calls: [{ name: "delete_dns_record", arguments: { zone: "qnfo.org", record_id: "r1" } }, { name: "rollback_worker", arguments: { script: "qnfo-ops", version_id: "v" } }] };
const aiEnv = (script) => ({ CF_TOKEN: "t", AI: { async run(model, input) { modelCalls++; return script(model, input); } } });
cfReply = (u) => u.includes("/zones?per_page=50") ? { status: 200, json: { success: true, result: [{ id: "a".repeat(32), name: "qnfo.org", status: "active" }] } } : { status: 404, json: {} };
calls.length = 0; modelCalls = 0;
let out = await ctx.leeRun(aiEnv((m, i) => i.messages.some((x) => x.role === "tool") ? { response: "One zone: qnfo.org." } : { tool_calls: [{ name: "list_zones", arguments: "{}" }] }), "how many zones?", 20000);
ok(out.ok && out.text === "One zone: qnfo.org." && out.steps.length === 1 && out.steps[0].tool === "list_zones" && modelCalls === 2, "the loop reads, then answers", out);
calls.length = 0;
out = await ctx.leeRun(aiEnv((m, i) => i.messages.filter((x) => x.role === "tool").length ? { response: "I cannot change that here." } : writeAttempt), "delete the dns record r1", 20000);
ok(out.ok && calls.length === 0 && out.steps.length === 2 && out.steps.every((s) => s.ok === false), "write tools the model invents are refused and issue no Cloudflare request", { out, calls });
ok(!ctx.LEE_TOOL_DEFS.some((d) => /delete|create|update|rollback|add_/.test(d.function.name)), "the tool list has no write tool", ctx.LEE_TOOL_DEFS.map((d) => d.function.name));
out = await ctx.leeRun(aiEnv(() => { throw new Error("capacity exceeded"); }), "x", 20000);
ok(out.ok === false && /^model: .*capacity exceeded/.test(out.error), "a model failure names the model leg (the failure stage is the model)", out);
out = await ctx.leeRun(aiEnv(() => ({ tool_calls: [{ name: "list_zones", arguments: {} }] })), "loop forever", 20000);
ok(out.ok === false && out.steps.length === 5 && /step or time limit/.test(out.error), "the loop stops at five steps", out);
out = await ctx.leeRun({ CF_TOKEN: "t" }, "x", 20000);
ok(out.ok === false && /no Workers AI binding/.test(out.error), "no AI binding is said plainly");
out = await ctx.leeRun(aiEnv(() => ({ choices: [{ message: { content: "openai shaped" } }] })), "x", 20000);
ok(out.ok && out.text === "openai shaped", "an OpenAI-shaped answer is read too");

// ---- the route on the real worker with an in-memory D1
function d1(db) {
  return { prepare(sql) {
    let stmt = null, err = null; try { stmt = db.prepare(sql); } catch (e) { err = e; }
    let args = [];
    const api = { bind(...a) { args = a.map((x) => (x === undefined ? null : x)); return api; }, async run() { if (err) throw err; const x = stmt.run(...args); return { success: true, meta: { changes: Number(x.changes) } }; }, async all() { if (err) throw err; return { results: stmt.all(...args) }; }, async first() { if (err) throw err; return stmt.get(...args) ?? null; } };
    return api;
  } };
}
const raw = new DatabaseSync(":memory:");
raw.exec("CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT)");
const LOOP = "test-loop-token";
const waits = [];
const wctx = { waitUntil(p) { waits.push(p); }, passThroughOnException() {} };
const env = { AUDIT: d1(raw), LOOP_TOKEN: LOOP, CF_TOKEN: "t", AI: { async run(m, i) { return i.messages.some((x) => x.role === "tool") ? { response: "Two zones are active." } : { tool_calls: [{ name: "list_zones", arguments: {} }] }; } } };
const realFetch = globalThis.fetch;
globalThis.fetch = (u, init) => /^https:\/\/api\.cloudflare\.com\//.test(String(u)) ? cfFetch(u, init) : Promise.resolve(new Response("{}", { status: 503 }));
cfReply = (u) => u.includes("/zones?per_page=50") ? { status: 200, json: { success: true, result: [{ id: "a".repeat(32), name: "qnfo.org", status: "active" }, { id: "b".repeat(32), name: "q08.org", status: "active" }] } } : u.includes("/zones?per_page=1") || u.includes("/workers/scripts") || u.includes("/pages/projects") ? { status: 200, json: { success: true, result: [] } } : { status: 404, json: { success: false, errors: [] } };
const call = (method, path, body, withLoop = true) => worker.fetch(new Request("https://fleet.qnfo.org" + path, { method, headers: Object.assign({ "x-fleet-ui": "1", "content-type": "application/json" }, withLoop ? { "x-loop-token": LOOP } : {}), body: body ? JSON.stringify(body) : undefined }), env, wctx);
try {
  let res = await call("POST", "/api/cmd", { text: "cf zones" }, false);
  let j = await res.json();
  ok(res.status === 401 && j.need === "code", "a visitor without the owner session gets the sign-in prompt, not the account", j);
  calls.length = 0;
  res = await call("POST", "/api/cmd", { text: "cf zones" });
  j = await res.json();
  ok(res.status === 200 && j.kind === "answer" && /qnfo\.org/.test(j.text) && /q08\.org/.test(j.text) && j.holder === true, "the owner's cf zones answers from the account with no model", j);
  const row = raw.prepare("SELECT kind, status, model FROM cmd_log WHERE text = 'cf zones'").get();
  ok(row && row.kind === "lee" && row.status === "answered" && row.model === "cf-api", "the read is logged as kind lee", row);
  res = await call("POST", "/api/cmd", { text: "lee: how many zones are there?" });
  j = await res.json();
  ok(res.status === 202 && j.kind === "pending" && /^cmd-[0-9a-f]{20}$/.test(j.id), "a Lee question is a polled job", j);
  await Promise.all(waits);
  res = await call("GET", "/api/cmd/job/" + j.id);
  const jj = await res.json();
  ok(jj.status === "answered" && /Two zones are active\./.test(jj.answer) && /> list_zones/.test(jj.answer), "the job settles with the tool step and the answer", jj);
  raw.prepare("INSERT INTO ops_config (key, value) VALUES ('cmd_lee', 'off')").run();
  res = await call("POST", "/api/cmd", { text: "cf zones" });
  j = await res.json();
  ok(/switched off/.test(j.text), "ops_config cmd_lee = off switches Lee off without a deploy", j);
  raw.prepare("UPDATE ops_config SET value = 'on' WHERE key = 'cmd_lee'").run();
  res = await call("POST", "/api/cmd", { text: "cf help" });
  j = await res.json();
  ok(/Lee reads the Cloudflare account/.test(j.text) && /read only/.test(j.text) && /lee: <question>/.test(j.text), "cf help says what Lee can and cannot do", j);
  ok(calls.every((c) => c.method === "GET"), "no write request reached the Cloudflare API in any route test", calls.filter((c) => c.method !== "GET"));
  // health: booleans and statuses only
  res = await call("GET", "/api/cmd/lee/health", null, false);
  j = await res.json();
  ok(j.ok === true && j.cf_token_set === true && j.ai_binding === true && j.can.workers === true && j.can.zones === true && j.can.pages === true, "health says per area whether the token reaches the account", j);
  ok(!/qnfo\.org|q08\.org|acc123/.test(JSON.stringify(j)), "health carries no account data");
  const help = await call("POST", "/api/cmd", { text: "help" });
  ok(/cf <zones\|dns\|workers/.test((await help.json()).text), "the help text lists the cf verbs");
} finally {
  globalThis.fetch = realFetch;
}
ok(/data-c="cf help">lee</.test(src), "the page has a lee chip");
// MODEL-FLOOR-1: the original Lee ran a llama model, which the model floor bans (scripts/model-floor-guard.mjs flagged var LEE_MODEL on 2026-11-05); the default must be in the policy table.
const leeModel = /var LEE_MODEL = "([^"]+)"/.exec(src)[1];
const policy = JSON.parse(readFileSync(new URL("../scripts/model-policy.json", import.meta.url), "utf8"));
ok(policy.allowed.some((r) => r.wa === leeModel) && !/llama/i.test(leeModel), "Lee's default model is in the model policy table and not a banned family", leeModel);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
