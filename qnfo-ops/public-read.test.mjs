// OPS-PUBLIC-READ-1 offline suite (qnfo-ops 2.38.35, OPEN-ACCESS-1).
// Loads the real worker.js (the cloudflare:workers import swapped for stubs) and drives its fetch handler against
// in-memory SQLite D1 (qnfo-audit and an ipatent store seeded with inventor PII), a scripted Workers AI binding and a
// recording fetch. Proves: a chat with no key is answered (not 401) in public read-only mode and is
// marked x-ops-access: public-read; only fleet_status, backlog_status and public_data are offered or executed; a model
// that asks for ops_d1_query, ops_d1_write, shell_exec or kv_get gets a refusal and nothing runs; ipatent_activity
// returns page views and redacted search text but never inventor names, emails, titles, disclosure text, IP addresses
// or user agents; no paid upstream, raw relay, cache read, durable job or checkpoint is touched; the per-visitor and
// daily caps answer 429; OPS_PUBLIC_READ=off restores the 401; a valid key still gets the full agent; async jobs still
// need the key.
// Run: node qnfo-ops/public-read.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const IMPORT = 'import { WorkflowEntrypoint, DurableObject, tracing } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
if (src.indexOf(IMPORT) < 0) throw new Error("worker.js import line changed: update the loader in this test");
const mod = await import("data:text/javascript;base64," + Buffer.from(src.replace(IMPORT, "var WorkflowEntrypoint = class {}; var DurableObject = class {}; var tracing = { enterSpan(_name, callback) { return callback({ setAttribute() {} }); } };")).toString("base64"));
const W = mod.default;

// The worker logs routing notes on every call; keep the suite's output to its own verdicts.
const say = console.log.bind(console);
console.log = () => {};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; say("FAIL " + m); } };

const PII = ["Ada Inventor", "inventor@example.com", "SECRET-DISCLOSURE-77", "Secret Widget Title", "203.0.113.7", "PII-UA/9.9", "sess-pii-1", "visitor@example.org", "+44 7700 900123"];
const GOOD_KEY = "good-key-0123456789";

function d1(db, log) {
  const prep = (sql) => {
    let a = [];
    const q = {
      bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return q; },
      async all() { if (log) log.push(sql); return { results: db.prepare(sql).all(...a) }; },
      async first() { if (log) log.push(sql); return db.prepare(sql).get(...a) || null; },
      async run() { if (log) log.push(sql); const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    };
    return q;
  };
  return { prepare: prep, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

function kv(log) {
  const m = new Map();
  return { m, async get(k) { log.push("get " + k); return m.has(k) ? m.get(k) : null; }, async put(k, v) { log.push("put " + k); m.set(k, v); }, async delete(k) { log.push("del " + k); m.delete(k); } };
}

// Workers AI: answer from a script keyed by the round; record every tool list and message list it was given.
function wai(script) {
  const seen = [];
  return {
    seen,
    async run(model, inputs) {
      if (!inputs || !Array.isArray(inputs.messages)) return { data: [[0.1, 0.2]] };
      seen.push({ model, tools: (inputs.tools || []).map((t) => t.function && t.function.name), messages: inputs.messages });
      const withTools = !!(inputs.tools && inputs.tools.length);
      const step = script(seen.length, withTools, inputs);
      return { choices: [{ message: step }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    }
  };
}
const tc = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

function mk(opt = {}) {
  const audit = new DatabaseSync(":memory:");
  audit.exec(`CREATE TABLE ops_ai_log (id TEXT PRIMARY KEY, ts TEXT NOT NULL, model TEXT, strategy TEXT, complexity TEXT, domain TEXT, prompt TEXT, response TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost_usd REAL, latency_ms INTEGER, tool_calls TEXT, source TEXT, ua TEXT, streamed INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, upstream_model TEXT, job_id TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE TABLE model_ladder_daily (tier INTEGER, day TEXT, spent_usd REAL DEFAULT 0, calls INTEGER DEFAULT 0, PRIMARY KEY (tier, day));
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE fleet_deploys (id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT, actor TEXT, session_id TEXT, from_sha TEXT, to_sha TEXT, source_path TEXT, ok INTEGER, note TEXT, ts TEXT);
  CREATE TABLE issue_ledger (fingerprint TEXT PRIMARY KEY, source TEXT, level TEXT, category TEXT, title TEXT, status TEXT, first_seen TEXT, last_seen TEXT, occurrences INTEGER, last_detail TEXT, updated_at TEXT);
  CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT, version TEXT, base_url TEXT);`);
  audit.prepare("INSERT INTO agent_issues (title, priority, category, status) VALUES ('Call my doctor about the results', 'high', 'owner-task', 'open')").run();
  audit.prepare("INSERT INTO fleet_deploys (worker, actor, to_sha, ok, note, ts) VALUES ('qnfo-ai-search', 'qnfo-ops/ops-deploy', '2.0.2-ask-loop', 1, 'x', ?)").run(new Date().toISOString());
  for (let i = 0; i < (opt.publicRowsToday || 0); i++) audit.prepare("INSERT INTO ops_ai_log (id, ts, model, strategy, source, ok) VALUES (?, ?, 'ops', 'chat', 'public', 1)").run("seed-" + i, new Date().toISOString());

  const ip = new DatabaseSync(":memory:");
  ip.exec(`CREATE TABLE submissions (id INTEGER PRIMARY KEY, submission_id TEXT, inventor_name TEXT, inventor_email TEXT, title TEXT, disclosure_text TEXT, document_html TEXT, r2_key TEXT, status TEXT, ip_address TEXT, user_agent TEXT, country TEXT, session_id TEXT, created_at TEXT, updated_at TEXT, claims TEXT, abstract TEXT, technical_field TEXT, background TEXT, summary TEXT, user_type TEXT);
  CREATE TABLE analytics (id INTEGER PRIMARY KEY, event_type TEXT, page_url TEXT, referrer TEXT, ip_address TEXT, user_agent TEXT, country TEXT, session_id TEXT, metadata TEXT, created_at TEXT);
  CREATE TABLE sessions (session_id TEXT, ip_address TEXT, user_agent TEXT, country TEXT, first_seen TEXT, last_seen TEXT, page_views INTEGER, total_events INTEGER, metadata TEXT);
  CREATE TABLE page_views (day TEXT, path TEXT, source TEXT, n INTEGER);`);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const today = now.slice(0, 10);
  ip.prepare("INSERT INTO submissions (submission_id, inventor_name, inventor_email, title, disclosure_text, status, ip_address, user_agent, session_id, created_at) VALUES ('USP-1', ?, ?, ?, ?, 'received', ?, ?, ?, ?)").run(PII[0], PII[1], PII[3], PII[2], PII[4], PII[5], PII[6], now);
  ip.prepare("INSERT INTO analytics (event_type, page_url, ip_address, user_agent, country, session_id, metadata, created_at) VALUES ('search', '/api/search', ?, ?, 'NL', ?, ?, ?)").run(PII[4], PII[5], PII[6], JSON.stringify({ query: "quantum computing", results: 5, ip: PII[4], ua: PII[5] }), now);
  ip.prepare("INSERT INTO analytics (event_type, page_url, ip_address, user_agent, country, session_id, metadata, created_at) VALUES ('search', '/api/search', ?, ?, 'GB', ?, ?, ?)").run(PII[4], PII[5], PII[6], JSON.stringify({ query: "patent by " + PII[7] + " call " + PII[8], results: 0 }), now);
  ip.prepare("INSERT INTO analytics (event_type, page_url, ip_address, user_agent, country, session_id, metadata, created_at) VALUES ('pageview', '/', ?, ?, 'GB', ?, 'not json', ?)").run(PII[4], PII[5], PII[6], now);
  ip.prepare("INSERT INTO sessions (session_id, ip_address, user_agent, country, first_seen, last_seen) VALUES (?, ?, ?, 'NL', ?, ?)").run(PII[6], PII[4], PII[5], now, now);
  ip.prepare("INSERT INTO page_views VALUES (?, '/', 'qnfo', 3)").run(today);

  const sql = { audit: [], ipatent: [] };
  const kvLog = [], eqLog = [];
  const fetches = [];
  globalThis.fetch = async (u, o) => {
    const url = String(u && u.url || u);
    let body = null;
    try { body = o && o.body ? JSON.parse(o.body) : null; } catch (e) { }
    fetches.push({ url, body });
    if (/gateway\.ai\.cloudflare\.com|api\.deepseek\.com|api\.openai\.com/.test(url)) {
      return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "Keyed answer from the paid upstream, long enough to be a real answer." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 503 });
  };
  const ai = wai(opt.script || ((n, withTools) => withTools && n === 1 ? { role: "assistant", content: "", tool_calls: [tc("c1", "public_data", { dataset: "ipatent_activity", days: 400 })] } : { role: "assistant", content: "The last ipatent searches were 'quantum computing' and one redacted query, both today." }));
  const env = Object.assign({
    QNFO_AUDIT: d1(audit, sql.audit), IPATENT: d1(ip, sql.ipatent), PERSONAL: d1(new DatabaseSync(":memory:"), null),
    OPS_CACHE_KV: kv(kvLog), EQCACHE_KV: kv(eqLog), WAI: ai,
    DEEPSEEK_API_KEY: "ds-x", CF_API_TOKEN: "cf-x", OPS_ROUTER_AUTH_KEY: GOOD_KEY
  }, opt.env || {});
  return { env, audit, ip, sql, kvLog, eqLog, fetches, ai };
}

async function call(t, body, headers = {}) {
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
  const req = new Request("https://ops.qnfo.org/v1/chat/completions", { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Linux; Android 12; ICL-LX9) Chatbox" }, headers), body: JSON.stringify(body) });
  const res = await W.fetch(req, t.env, ctx);
  const text = await res.text();
  for (let i = 0; i < 3; i++) await Promise.allSettled(pending.splice(0));
  return { res, text };
}
const Q = { model: "ops", messages: [{ role: "user", content: "What are recent ipatent web queries?" }] };
const PAID = /gateway\.ai\.cloudflare\.com|api\.deepseek\.com|api\.openai\.com/;
const PUBLIC_SET = ["backlog_status", "fleet_status", "owner_login", "owner_verify", "public_data"];
const toolResults = (t) => t.ai.seen.flatMap((s) => s.messages.filter((m) => m.role === "tool").map((m) => String(m.content)));

// A. no key: answered in public read-only mode, from the free tier, with only the public tools.
{
  const t = mk();
  const { res, text } = await call(t, Q, { "CF-Connecting-IP": "198.51.100.1" });
  ok(res.status === 200, "A no-key chat answered 200, got " + res.status + " " + text.slice(0, 200));
  ok(res.headers.get("x-ops-access") === "public-read", "A response marked x-ops-access: public-read");
  ok(text.indexOf("set Bearer") < 0 && text.indexOf("OPS_ROUTER_AUTH_KEY") < 0, "A no token instruction in the answer");
  ok(/quantum computing/.test(text), "A answer carries the model's final text");
  ok(t.ai.seen.length >= 2, "A free tier ran the tool round and the final round");
  ok(t.ai.seen.every((s) => s.tools.length === 0 || JSON.stringify(s.tools.slice().sort()) === JSON.stringify(PUBLIC_SET)), "A only fleet_status, backlog_status and public_data were offered: " + JSON.stringify(t.ai.seen.map((s) => s.tools)));
  ok(String(t.ai.seen[0].messages[0].content).indexOf("PUBLIC READ-ONLY") >= 0, "A public system prompt in use");
  ok(!t.fetches.some((f) => PAID.test(f.url)), "A no paid upstream fetched");
  const row = t.audit.prepare("SELECT source FROM ops_ai_log WHERE id NOT LIKE 'seed-%' ORDER BY ts DESC LIMIT 1").get();
  ok(row && row.source === "public", "A logged to ops_ai_log with source=public");
  ok(!t.kvLog.some((k) => /opschat:/.test(k)), "A chat cache neither read nor written: " + JSON.stringify(t.kvLog));
  ok(t.kvLog.some((k) => /^put opspub:/.test(k)), "A per-visitor counter recorded");
}

// B. ipatent_activity: the searches and page views, never the PII.
{
  const t = mk();
  await call(t, Q, { "CF-Connecting-IP": "198.51.100.2" });
  const r = toolResults(t).join("\n");
  ok(/quantum computing/.test(r), "B search query returned");
  ok(/\[email\]/.test(r) && /\[number\]/.test(r), "B emails and numbers in search text redacted");
  ok(/"page_views":\[\{"day":"\d{4}-\d{2}-\d{2}","path":"\/","source":"qnfo","n":3\}\]/.test(r), "B page views returned");
  ok(/"submissions_all_time":1/.test(r) && /"last_search":"/.test(r), "B counts and last-activity dates returned");
  for (const p of PII) ok(r.indexOf(p) < 0, "B PII absent from the tool result: " + p);
  ok(!t.sql.ipatent.some((s) => /inventor_|ip_address|disclosure|user_agent|session_id|\btitle\b|\*\s+FROM/i.test(s)), "B no PII column selected: " + JSON.stringify(t.sql.ipatent));
}

// C. a model that reaches for private or write tools gets a refusal and nothing runs.
{
  const t = mk({ script: (n, withTools) => withTools && n === 1 ? { role: "assistant", content: "", tool_calls: [
    tc("h1", "ops_d1_query", { db: "ipatent", sql: "SELECT inventor_email, ip_address FROM submissions" }),
    tc("h2", "ops_d1_write", { db: "audit", sql: "INSERT INTO agent_issues (title, status) VALUES ('pwned', 'open')", confirm: true }),
    tc("h3", "shell_exec", { cmd: "env" }),
    tc("h4", "kv_get", { key: "OPS_ROUTER_AUTH_KEY" })
  ] } : { role: "assistant", content: "Those tools are not available in public read-only mode." } });
  const { res } = await call(t, Q, { "CF-Connecting-IP": "198.51.100.3" });
  ok(res.status === 200, "C hostile tool round still answers 200");
  const r = toolResults(t);
  ok(r.length === 4 && r.every((x) => /not available in public read-only mode/.test(x)), "C all four calls refused: " + JSON.stringify(r).slice(0, 300));
  ok(!t.sql.ipatent.some((s) => /submissions/i.test(s)), "C no query reached ipatent submissions");
  ok(!t.audit.prepare("SELECT 1 FROM agent_issues WHERE title = 'pwned'").get(), "C ops_d1_write wrote nothing");
  ok(!t.eqLog.length, "C kv_get never read the KV namespace");
  ok(!t.fetches.some((f) => /containers|shell/.test(f.url)), "C shell_exec never reached a container");
}

// D. KEY-REJECTED-NOT-RATE-LIMITED-1 (2.55.3): a PRESENTED but invalid key is an authentication failure (401 with the
// reason), never a silent public-read session that later looks like a provider rate limit. A wrong key still buys no
// privilege, which is the part of OWNER-OTP-1 that matters; anonymous requests (no Authorization header) are unchanged.
{
  const t = mk();
  // call() already read the body into `text`; cloning a consumed Response throws
  // "Response.clone: Body has already been consumed", so read the text the helper returned.
  const { res, text } = await call(t, Q, { Authorization: "Bearer stale-key", "CF-Connecting-IP": "198.51.100.4" });
  ok(res.status === 401 && /authentication failure, not a rate limit/.test(text), "D stale key answered 401 with the reason, got " + res.status);
}

// E. model ids that would pick a paid upstream or a raw relay are ignored in public mode.
for (const m of ["deepseek-v4-flash", "ops-frontier", "gpt-5.5", "claude-sonnet-4.5"]) {
  const t = mk();
  const { res } = await call(t, Object.assign({}, Q, { model: m }), { "CF-Connecting-IP": "198.51.100.5" });
  ok(res.status === 200 && !t.fetches.some((f) => PAID.test(f.url)), "E model " + m + " stayed on the free public path");
}

// F. streaming (ChatBox streams): the SSE carries the answer and ends with [DONE].
{
  const t = mk();
  const { res, text } = await call(t, Object.assign({}, Q, { stream: true }), { "CF-Connecting-IP": "198.51.100.6" });
  ok(res.status === 200 && res.headers.get("x-ops-access") === "public-read", "F streamed public answer marked");
  ok(/quantum computing/.test(text) && /data: \[DONE\]/.test(text), "F SSE carries the answer and [DONE]");
  ok(!t.fetches.some((f) => PAID.test(f.url)), "F no paid streaming upstream");
}

// G. per-visitor hourly cap.
{
  const t = mk({ env: { OPS_PUBLIC_PER_IP_HOUR: "2" } });
  const a = await call(t, Q, { "CF-Connecting-IP": "198.51.100.7" });
  const b = await call(t, Q, { "CF-Connecting-IP": "198.51.100.7" });
  const c = await call(t, Q, { "CF-Connecting-IP": "198.51.100.7" });
  const d = await call(t, Q, { "CF-Connecting-IP": "198.51.100.8" });
  ok(a.res.status === 200 && b.res.status === 200, "G first two from one visitor answered");
  ok(c.res.status === 429 && /per visitor per hour/.test(c.text), "G third from the same visitor is 429: " + c.res.status + " " + c.text.slice(0, 160));
  ok(d.res.status === 200, "G another visitor still answered");
}

// H. daily cap across all public visitors.
{
  const t = mk({ env: { OPS_PUBLIC_DAY: "5" }, publicRowsToday: 5 });
  const { res, text } = await call(t, Q, { "CF-Connecting-IP": "198.51.100.9" });
  ok(res.status === 429 && /UTC day/.test(text), "H daily public cap answers 429: " + res.status);
  ok(t.ai.seen.length === 0, "H no model call over the cap");
}

// I. OPS_PUBLIC_READ=off restores the 401 (and still tells nobody to set a token).
{
  const t = mk({ env: { OPS_PUBLIC_READ: "off" } });
  const { res, text } = await call(t, Q);
  ok(res.status === 401 && text.indexOf("set Bearer") < 0, "I kill switch gives 401 without a token instruction");
}

// J. a valid key keeps the full agent (all tools offered, no public marker).
{
  const t = mk({ script: () => ({ role: "assistant", content: "Keyed answer from the free tier, long enough to be a real answer." }) });
  const { res } = await call(t, Q, { Authorization: "Bearer " + GOOD_KEY });
  ok(res.status === 200 && !res.headers.get("x-ops-access"), "J keyed chat answered without the public marker");
  const offered = new Set(t.ai.seen.flatMap((s) => s.tools).concat(t.fetches.flatMap((f) => (f.body && f.body.tools || []).map((x) => x.function && x.function.name))));
  ok(offered.has("ops_d1_write") && offered.has("shell_exec"), "J keyed agent offered the full tool set");
  ok(t.ai.seen.every((s) => String(s.messages[0] && s.messages[0].content || "").indexOf("PUBLIC READ-ONLY") < 0), "J keyed agent has no public prompt");
}

// K. async durable jobs still need the key.
{
  const t = mk();
  const { res } = await call(t, Q, { "x-ops-async": "1" });
  ok(res.status === 401, "K async job without a key is 401");
}

// L. a public turn that runs out of tool rounds leaves no checkpoint and promotes no durable job.
{
  const t = mk({ script: (n, withTools) => withTools ? { role: "assistant", content: "", tool_calls: [tc("l" + n, "backlog_status", {})] } : { role: "assistant", content: "Backlog read; final answer after the round cap." } });
  const { res } = await call(t, Q, { "CF-Connecting-IP": "198.51.100.10" });
  ok(res.status === 200, "L round-capped public turn answered");
  ok(t.ai.seen.filter((s) => s.tools.length).length <= 4, "L at most 4 tool rounds in public mode, saw " + t.ai.seen.filter((s) => s.tools.length).length);
  ok(!t.audit.prepare("SELECT 1 FROM cloud_ops_events WHERE kind IN ('ops_budget_checkpoint', 'ops_budget_promote')").get(), "L no checkpoint or promote row");
}

// M. a long ChatBox history is trimmed to the latest messages that fit; one oversized message is refused with 413.
{
  const t = mk();
  const long = "x".repeat(25000);
  const hist = [];
  for (let i = 0; i < 6; i++) hist.push({ role: "user", content: "old question " + i + " " + long }, { role: "assistant", content: "old answer " + i });
  hist.push({ role: "user", content: "What are recent ipatent web queries?" });
  const { res } = await call(t, { model: "ops", messages: hist }, { "CF-Connecting-IP": "198.51.100.11" });
  ok(res.status === 200, "M long history answered after trimming, got " + res.status);
  const sent = t.ai.seen[0] && t.ai.seen[0].messages.filter((m) => m.role !== "system") || [];
  ok(sent.length > 0 && sent.length < hist.length && /recent ipatent/.test(sent[sent.length - 1].content), "M the latest question kept, older turns dropped (" + sent.length + " of " + hist.length + ")");
  const big = await call(mk(), { model: "ops", messages: [{ role: "user", content: "y".repeat(70000) }] }, { "CF-Connecting-IP": "198.51.100.12" });
  ok(big.res.status === 413 && big.text.indexOf("set Bearer") < 0, "M a single oversized message is 413");
}

say(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
