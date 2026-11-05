// CAP-TOKEN-1 offline suite for qnfo-tools-mcp (RM-BS-CAPABILITY-SECURITY-1, blue-sky roadmap B9 / AGT-18, charter pillar security).
// Proves: a token derived with POST /mcp/attenuate can only do LESS than its parent (tool allowlist, expiry, read-only, task tag), a child of a child keeps every caveat,
// a forged, truncated, re-ordered or caveat-stripped token fails closed, an expired token is refused, the static tokens behave as before, every call by a capability
// token is audited with its id, and the unauthenticated front door still answers 401.
// Run: node qnfo-tools-mcp/capability-token.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message || e)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "eq") + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion"); };
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const db = new DatabaseSync(":memory:");
const prep = (sql0) => {
  const order = [];
  const sql = sql0.replace(/\?(\d+)/g, (m, n) => { order.push(Number(n) - 1); return "?"; });
  let a = [];
  const st = { bind: (...x) => { a = order.length ? order.map((i) => (x[i] === undefined ? null : x[i])) : x; return st; }, run: async () => { db.prepare(sql).run(...a); return { success: true }; }, all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null };
  return st;
};
const calls = [];
const env = {
  MCP_TOKEN: "test-root-write-secret", MCP_READ_TOKEN: "test-root-read-secret", INFRA_TOKEN: "i", EMAIL_API_KEY: "e", REGISTRY_TOKEN: "r",
  AUDIT: { prepare: prep },
  QNFO_INFRA: { fetch: async (url) => { calls.push(String(url)); return J({ ok: true, route: new URL(String(url)).pathname }); } },
  EMAIL: { fetch: async (url) => { calls.push(String(url)); return J({ total: 42 }); } }
};
const B = "https://qnfo-tools-mcp.test";
const rpc = (token, method, params, id = 1) => worker.fetch(new Request(B + "/mcp", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }), env, { waitUntil() {} }).then(async (r) => ({ status: r.status, body: r.status === 200 ? await r.json() : await r.text() }));
const mint = async (parent, opts) => { const r = await worker.fetch(new Request(B + "/mcp/attenuate", { method: "POST", headers: { Authorization: "Bearer " + parent, "Content-Type": "application/json" }, body: JSON.stringify(opts) }), env, { waitUntil() {} }); return { status: r.status, body: r.status === 200 ? await r.json() : await r.text() }; };
const names = (r) => r.body.result.tools.map((x) => x.name);
const b64uJson = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

await t("front door: no token, wrong token and a garbled capability token all answer 401", async () => {
  eq((await rpc("", "tools/list")).status, 401);
  eq((await rpc("nope", "tools/list")).status, 401);
  eq((await rpc("qcap1.garbage", "tools/list")).status, 401);
  eq((await mint("nope", {})).status, 401);
});

let full;
await t("static MCP_TOKEN still lists every tool including the write tools", async () => {
  full = names(await rpc(env.MCP_TOKEN, "tools/list"));
  ok(full.includes("email_respond") && full.includes("infra_status") && full.length >= 18, "full list " + full.length);
});

let child;
await t("attenuate: a tool allowlist, a short expiry and a task tag", async () => {
  const m = await mint(env.MCP_TOKEN, { tools: ["infra_status", "email_stats"], ttl_s: 600, task: "t-123" });
  eq(m.status, 200);
  ok(m.body.token.startsWith("qcap1.") && m.body.id.length === 16 && m.body.root === "w", "token shape");
  ok(Date.parse(m.body.expires_at) - Date.now() <= 600 * 1e3 + 2e3 && Date.parse(m.body.expires_at) > Date.now(), "expiry within ttl");
  child = m.body;
});

await t("the child lists only its allowlist and can call an allowed tool", async () => {
  eq(names(await rpc(child.token, "tools/list")).sort(), ["email_stats", "infra_status"]);
  const r = await rpc(child.token, "tools/call", { name: "infra_status", arguments: {} });
  eq(r.status, 200);
  ok(!r.body.error && r.body.result && !r.body.result.isError, "allowed call succeeds: " + JSON.stringify(r.body).slice(0, 200));
});

await t("the child cannot call a tool outside the allowlist (including a write tool)", async () => {
  for (const tool of ["infra_records", "email_respond", "owner_act"]) {
    const r = await rpc(child.token, "tools/call", { name: tool, arguments: {} });
    eq(r.body.error && r.body.error.code, -32003, tool);
  }
});

await t("audit: the call is logged with the capability id and the task, and the mint is logged", async () => {
  const rows = db.prepare("SELECT tool, session FROM mcp_log ORDER BY ts").all();
  ok(rows.some((x) => x.tool === "infra_status" && x.session === "cap:" + child.id + ":t-123"), "call row: " + JSON.stringify(rows));
  ok(rows.some((x) => x.tool === "cap:attenuate" && x.session === "static:w"), "mint row");
});

await t("a child of a child keeps every caveat and can only narrow further", async () => {
  const g = await mint(child.token, { tools: ["email_stats", "web_search"] });
  eq(g.status, 200);
  eq(g.body.caveats.length, child.caveats.length + 2);
  eq(names(await rpc(g.body.token, "tools/list")), ["email_stats"]);
  const widened = await rpc(g.body.token, "tools/call", { name: "infra_status", arguments: {} });
  eq(widened.body.error && widened.body.error.code, -32003, "infra_status stays out");
  ok(Date.parse(g.body.expires_at) <= Date.parse(child.expires_at), "never later than the parent");
});

await t("read_only strips the write scope even from a token derived from the write root", async () => {
  const m = await mint(env.MCP_TOKEN, { read_only: true });
  const list = names(await rpc(m.body.token, "tools/list"));
  ok(!list.includes("email_respond") && !list.includes("owner_act") && list.includes("infra_status"), "read-only list");
  const r = await rpc(m.body.token, "tools/call", { name: "email_respond", arguments: {} });
  eq(r.body.error && r.body.error.code, -32003);
});

await t("a token derived from the READ root is read-only whatever caveats it carries", async () => {
  const m = await mint(env.MCP_READ_TOKEN, { ttl_s: 300 });
  eq(m.body.root, "r");
  const list = names(await rpc(m.body.token, "tools/list"));
  ok(!list.includes("email_respond"), "no write tools");
});

await t("forgery: a stripped caveat, a swapped caveat, a flipped signature and another root all fail closed", async () => {
  const [, payload, sig] = child.token.match(/^qcap1\.([^.]+)\.([0-9a-f]+)$/);
  const body = JSON.parse(Buffer.from(payload, "base64url").toString());
  const stripped = { ...body, c: body.c.filter((c) => c.t === undefined) };
  eq((await rpc("qcap1." + b64uJson(stripped) + "." + sig, "tools/list")).status, 401, "allowlist removed");
  const widened = { ...body, c: body.c.map((c) => (c.t ? { t: [...c.t, "email_respond"] } : c)) };
  eq((await rpc("qcap1." + b64uJson(widened) + "." + sig, "tools/list")).status, 401, "allowlist widened");
  const longer = { ...body, c: body.c.map((c) => (c.x ? { x: c.x + 86400 } : c)) };
  eq((await rpc("qcap1." + b64uJson(longer) + "." + sig, "tools/list")).status, 401, "expiry extended");
  eq((await rpc("qcap1." + payload + "." + (sig[0] === "0" ? "1" : "0") + sig.slice(1), "tools/list")).status, 401, "signature flipped");
  eq((await rpc("qcap1." + b64uJson({ ...body, r: "r" }) + "." + sig, "tools/list")).status, 401, "root swapped");
  eq((await rpc("qcap1." + b64uJson({ ...body, c: body.c.concat([{ z: 1 }]) }) + "." + sig, "tools/list")).status, 401, "unknown caveat");
  const other = { ...env, MCP_TOKEN: "a-different-root" };
  const r = await worker.fetch(new Request(B + "/mcp", { method: "POST", headers: { Authorization: "Bearer " + child.token, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), other, { waitUntil() {} });
  eq(r.status, 401, "token minted under another root");
});

await t("expiry: a token past its x caveat is refused", async () => {
  const real = Date.now;
  Date.now = () => real() + 3 * 3600 * 1e3;
  try { eq((await rpc(child.token, "tools/list")).status, 401); } finally { Date.now = real; }
  eq((await rpc(child.token, "tools/list")).status, 200, "still valid before expiry");
});

await t("mint bounds: ttl is clamped to 24 hours, unknown tools and an empty allowlist are refused", async () => {
  const m = await mint(env.MCP_TOKEN, { ttl_s: 99999999 });
  ok(Date.parse(m.body.expires_at) - Date.now() <= 86400 * 1e3 + 2e3, "ttl clamp");
  eq((await mint(env.MCP_TOKEN, { tools: ["no_such_tool"] })).status, 400);
  eq((await mint(env.MCP_TOKEN, { tools: [] })).status, 400);
  eq((await mint(env.MCP_TOKEN, { task: "" })).status, 400);
});

await t("SSE session: a capability token's allowlist applies to /mcp/messages on its session", async () => {
  const sse = await worker.fetch(new Request(B + "/mcp/sse?token=" + encodeURIComponent(child.token)), env, { waitUntil() {} });
  eq(sse.status, 200);
  const reader = sse.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  const sid = /sessionId=([0-9a-f-]+)/.exec(first)[1];
  const post = await worker.fetch(new Request(B + "/mcp/messages?sessionId=" + sid, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "infra_records", arguments: {} } }) }), env, { waitUntil() {} });
  eq(post.status, 202);
  const frame = new TextDecoder().decode((await reader.read()).value);
  ok(/-32003/.test(frame), "denied over the stream: " + frame.slice(0, 160));
  await reader.cancel();
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
