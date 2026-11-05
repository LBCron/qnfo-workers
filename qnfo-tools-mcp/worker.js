var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ROUTER = "https://qnfo-ai.q08.workers.dev";
var EMAIL_BASE = "https://qnfo-email.internal";
var NL = String.fromCharCode(10);
var FLEET = "https://fleet.qnfo.org";
// FULLSCOPE-1 (2026-10-31): intents_list no longer crashes when an intent row carries neither summary nor desire;
// email_check validates body_id; owner_act enforces snooze days 1-90 up front; JSON-RPC batch requests, ping,
// resources/list, resources/templates/list and prompts/list are answered; protocolVersion is negotiated;
// malformed tools/call returns -32602; tools carry readOnlyHint/destructiveHint annotations; /mcp/messages with a
// token but no live SSE session returns the result inline instead of dropping it; audit ids cannot collide and
// record the SSE session. Transports, tools, scopes and upstreams are unchanged.
var VERSION = "1.6.0-fullscope";
// 1.3.0 BP26-PROMPT-INJECTION-1 (agent_issues 1000359, pillar security): email_respond names its surface ("mcp") in the x-qnfo-agent-surface header, so qnfo-email 2.12.0 pins a reply to the sender of the email being answered, refuses a cold send outside the owner, QNFO addresses and the allow-list, and sends the body as plain text; the tool description says so. // 1.2.1 AUTOAUDIT-DEAD-CALLERS-1 (2026-10-12, agent_issues 2302, pillar personal): personal_search calls qnfo-intent-orchestrator /personal/search over the existing binding (it called a retired worker through a removed binding and failed on every call); topK is honoured; the retired worker leaves deps. // OWNER-QUEUE-MCP-1: owner_queue / owner_code / owner_act reach the fleet.qnfo.org queue from any MCP client; 1.1.6-capability-contract: MCP-TOKEN-NO-SCOPE-SEPARATION (954): MCP_TOKEN=read+write, MCP_READ_TOKEN=read-only
var SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
var DEFAULT_PROTOCOL = "2024-11-05";
var TOOLS = [
  { name: "web_search", description: "Search the web via DuckDuckGo (QNFO router). Returns title/url/snippet.", inputSchema: { type: "object", properties: { q: { type: "string", description: "search query" }, k: { type: "number", description: "result count (1-10)" } }, required: ["q"] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "web_fetch", description: "Fetch a URL and extract readable text (SSRF-guarded).", inputSchema: { type: "object", properties: { url: { type: "string" }, max: { type: "number", description: "max chars (500-20000)" } }, required: ["url"] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "papers_search", description: "Semantic search over the QNFO research corpus (Vectorize qwav-research-v2).", inputSchema: { type: "object", properties: { q: { type: "string" }, k: { type: "number" } }, required: ["q"] }, annotations: { readOnlyHint: true } },
  { name: "history_recall", description: "Semantic recall of past QNFO research notes and queries (qnfo-ai-log).", inputSchema: { type: "object", properties: { q: { type: "string" }, k: { type: "number" } }, required: ["q"] }, annotations: { readOnlyHint: true } },
  { name: "personal_search", description: "Search the personal-life index: notes, files, chat threads.", inputSchema: { type: "object", properties: { q: { type: "string" }, topK: { type: "number" } }, required: ["q"] }, annotations: { readOnlyHint: true } },
  { name: "express_desire", description: "Express a desire to the QNFO intent orchestrator. It classifies and routes automatically: notes are stored in Vectorize, tasks/events/emails/reminders are queued with due dates, and they appear in the daily digest.", inputSchema: { type: "object", properties: { desire: { type: "string", description: "what you want done" }, source: { type: "string", description: "where it comes from (optional)" } }, required: ["desire"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "intents_list", description: "List intents in the orchestrator queue (tasks/events/emails/reminders).", inputSchema: { type: "object", properties: { status: { type: "string", description: "filter: pending/done" }, limit: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "infra_status", description: "Cloudflare infrastructure state snapshot (workers, D1, Vectorize, R2, KV, Web Analytics sites, AI Gateway config, gateway logs + cost).", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "infra_analytics", description: "Cloudflare analytics over the last 30 days: Workers AI neurons + estimated cost by model, worker invocations by worker.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "infra_records", description: "QNFO records fleet: papers count, knowledge graph nodes/edges, logged queries, intents, personal store counts.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "email_check", description: "Check the qnfo.org (and other QNFO domain) email accounts: list recent inbound/outbound emails with status. Optionally fetch the full body of one email by id (body_id).", inputSchema: { type: "object", properties: { limit: { type: "number", description: "max rows (1-100, default 20)" }, status: { type: "string", description: "filter: received/processed/sent/replied/archived/spam/read/rejected" }, body_id: { type: "number", description: "email id whose full body/headers to fetch" } } }, annotations: { readOnlyHint: true } },
  { name: "email_stats", description: "Email account stats: total messages, last 24h, by classification, by status.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "email_search", description: "Search email subject/sender/body text across the QNFO domain email accounts.", inputSchema: { type: "object", properties: { q: { type: "string", description: "search query" }, limit: { type: "number", description: "max rows (1-100, default 20)" } }, required: ["q"] }, annotations: { readOnlyHint: true } },
  { name: "email_respond", description: "Send an email reply (or new email) FROM a QNFO domain account via the qnfo-email Worker. Pass reply_to_id to reply to an existing inbound email (worker marks it replied). `from` defaults to qnfo@qnfo.org; pass rowan.quni@qnfo.org for academic outreach. Body field is `body` (plain text) with optional `html`. Policy (BP26-PROMPT-INJECTION-1): a reply goes only to the sender of the email being answered; a new email only to the owner, a QNFO address or an allow-listed recipient; the body is sent as plain text and is refused if it carries a secret or another person's address.", inputSchema: { type: "object", properties: { to: { type: "string", description: "recipient email" }, subject: { type: "string", description: 'subject (use "Re: <original>" for replies)' }, body: { type: "string", description: "plain-text body" }, html: { type: "string", description: "optional HTML body" }, reply_to_id: { type: "number", description: "id of the inbound email being replied to (marks it replied)" }, affirm: { type: "boolean", description: "must be TRUE to send a NEW outbound email when reply_to_id is absent (MCP-COLD-SEND-UNGATED-1); replies do not need it" }, from: { type: "string", description: "QNFO domain sender (default qnfo@qnfo.org; rowan.quni@qnfo.org for outreach)" } }, required: ["to", "subject", "body"] }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  { name: "email_mark", description: "Update the status of an email row (received/processed/sent/replied/archived/spam/read/rejected).", inputSchema: { type: "object", properties: { id: { type: "number", description: "email id" }, status: { type: "string", description: "new status" } }, required: ["id", "status"] }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "owner_queue", description: "List what the fleet is waiting on the OWNER (a human) to do: the open cards on fleet.qnfo.org (key, title, why, the exact action, link, urgency, due). Read-only; the same public data as https://fleet.qnfo.org/api/human. Use the returned key with owner_act.", inputSchema: { type: "object", properties: { limit: { type: "number", description: "max cards (1-100, default 50)" } } }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: "owner_code", description: "Email a 6-digit code to the owner's fixed address (the dashboard decides where it goes; nobody can choose). The owner reads it in their inbox and passes it to owner_act. Valid 10 minutes; at most 6 an hour.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: "owner_act", description: "Act on owner cards through the dashboard's own gate. Needs `code`, the 6-digit code the owner received from owner_code (single use; ask the owner for it, never guess). One code covers every action in the batch. kind: done (mark finished), dismiss (not doing), snooze (days 1-90), note (text kept with the card and filed as fleet work). key is a key from owner_queue; done and dismiss only work on keys starting ha:.", inputSchema: { type: "object", properties: { code: { type: "string", description: "6-digit code from the owner's email" }, actions: { type: "array", maxItems: 10, items: { type: "object", properties: { key: { type: "string" }, kind: { type: "string", description: "done | dismiss | snooze | note" }, days: { type: "number", description: "snooze days 1-90" }, note: { type: "string", description: "note text (max 500)" } }, required: ["key", "kind"] } } }, required: ["code", "actions"] }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } }
];
function tokenEq(token, expected) {
  if (!expected || !token) return false;
  const a = new TextEncoder().encode(String(token));
  const b = new TextEncoder().encode(String(expected));
  if (a.byteLength !== b.byteLength) return false;
  let d = 0;
  for (let i = 0; i < a.byteLength; i++) d |= a[i] ^ b[i];
  return d === 0;
}
__name(tokenEq, "tokenEq");
// MCP-TOKEN-NO-SCOPE-SEPARATION (954): MCP_TOKEN is the FULL read+write credential.
// MCP_READ_TOKEN (optional) grants READ tools only and cannot invoke the write tools
// email_respond / email_mark / express_desire. With no MCP_READ_TOKEN set, behaviour is unchanged.
var WRITE_TOOLS = ["email_respond", "email_mark", "express_desire", "owner_code", "owner_act"];
function scopeFor(token, env) {
  if (tokenEq(token, env.MCP_TOKEN)) return { ok: true, write: true };
  if (env.MCP_READ_TOKEN && tokenEq(token, env.MCP_READ_TOKEN)) return { ok: true, write: false };
  return { ok: false, write: false };
}
__name(scopeFor, "scopeFor");
// CAP-TOKEN-1 (RM-BS-CAPABILITY-SECURITY-1, blue-sky roadmap B9 / AGT-18, pillar security): task-scoped attenuating tokens, with no new static secret.
// A holder of MCP_TOKEN or MCP_READ_TOKEN (or of any capability token) derives a child that can only do LESS: a tool allowlist (t), an expiry (x, epoch
// seconds), read-only (w:0) and a task tag (k) for the audit log. The child is `qcap1.<b64url json {i,r,c}>.<hex sig>`; sig is an HMAC chain (macaroon style):
// sig0 = HMAC(root secret, "qcap1|" + id), sig(n) = HMAC(sig(n-1), JSON caveat n). Adding a caveat needs only the parent token; removing one needs the root
// secret, so a sandbox or subagent holding a child never holds the credential that minted it. Unknown caveats, a bad chain, an expired token or a missing root all
// fail closed. The static tokens keep working unchanged; the mint route is POST /mcp/attenuate.
var CAP_PREFIX = "qcap1.";
var CAP_MAX_TTL_S = 86400;
var CAP_MAX_CAVEATS = 16;
function capB64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(capB64u, "capB64u");
function capFromB64u(str) {
  const b = atob(String(str).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
__name(capFromB64u, "capFromB64u");
function capHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return s;
}
__name(capHex, "capHex");
async function capHmac(keyBytes, text) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
__name(capHmac, "capHmac");
async function capChain(startSig, caveats) {
  let sig = startSig;
  for (const c of caveats) sig = await capHmac(sig, JSON.stringify(c));
  return sig;
}
__name(capChain, "capChain");
async function capRootSig(rootSecret, id) {
  return capHmac(new TextEncoder().encode(String(rootSecret)), CAP_PREFIX + "|" + id);
}
__name(capRootSig, "capRootSig");
// One caveat is an object with exactly one known key; anything else makes the token invalid.
function capCaveatOk(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  const keys = Object.keys(c);
  if (keys.length !== 1) return false;
  const k = keys[0], v = c[k];
  if (k === "t") return Array.isArray(v) && v.length > 0 && v.length <= 64 && v.every((x) => typeof x === "string" && x.length <= 64);
  if (k === "x") return typeof v === "number" && Number.isFinite(v) && v > 0;
  if (k === "w") return v === 0;
  if (k === "k") return typeof v === "string" && v.length > 0 && v.length <= 64;
  return false;
}
__name(capCaveatOk, "capCaveatOk");
function capEncode(body, sigBytes) {
  return CAP_PREFIX + capB64u(new TextEncoder().encode(JSON.stringify(body))) + "." + capHex(sigBytes);
}
__name(capEncode, "capEncode");
// -> { ok, write, caps: { id, root, tools|null, exp|null, task|null, sig, body } } or { ok:false }
async function capVerify(token, env, nowMs) {
  const bad = { ok: false, write: false };
  try {
    if (typeof token !== "string" || token.indexOf(CAP_PREFIX) !== 0) return bad;
    const parts = token.slice(CAP_PREFIX.length).split(".");
    if (parts.length !== 2) return bad;
    const body = JSON.parse(new TextDecoder().decode(capFromB64u(parts[0])));
    if (!body || typeof body.i !== "string" || !body.i || body.i.length > 64 || !Array.isArray(body.c) || body.c.length > CAP_MAX_CAVEATS) return bad;
    const rootSecret = body.r === "w" ? env.MCP_TOKEN : body.r === "r" ? env.MCP_READ_TOKEN : null;
    if (!rootSecret) return bad;
    if (!body.c.every(capCaveatOk)) return bad;
    const sig = await capChain(await capRootSig(rootSecret, body.i), body.c);
    if (!tokenEq(capHex(sig), parts[1])) return bad;
    let tools = null, exp = null, task = null, readOnly = body.r !== "w";
    for (const c of body.c) {
      if (c.t) tools = tools === null ? c.t.slice() : tools.filter((x) => c.t.indexOf(x) >= 0);
      else if (c.x !== void 0) exp = exp === null ? c.x : Math.min(exp, c.x);
      else if (c.w === 0) readOnly = true;
      else if (c.k !== void 0 && task === null) task = c.k;
    }
    if (exp !== null && nowMs >= exp * 1e3) return bad;
    return { ok: true, write: !readOnly, caps: { id: body.i, root: body.r, tools, exp, task, sig, body } };
  } catch (e) {
    return bad;
  }
}
__name(capVerify, "capVerify");
// Static tokens first (unchanged), then a capability token.
async function resolveScope(token, env) {
  const s = scopeFor(token, env);
  if (s.ok) return { ok: true, write: s.write, caps: null, root: s.write ? "w" : "r" };
  if (typeof token === "string" && token.indexOf(CAP_PREFIX) === 0) return capVerify(token, env, Date.now());
  return s;
}
__name(resolveScope, "resolveScope");
// CAP-TOKEN-2 (independent review of 1.5.0): an open stream outlives its token unless the session carries the token's expiry. True when a capability token's x caveat has passed.
function capExpired(caps, nowMs) {
  return !!caps && caps.exp !== null && caps.exp !== void 0 && nowMs >= caps.exp * 1e3;
}
__name(capExpired, "capExpired");
var CAP_MINT_KEYS = ["tools", "ttl_s", "read_only", "task"];
// Derive a child. `scope` is a resolveScope() result for the parent; opts: { tools, ttl_s, read_only, task }. Only ever adds caveats.
// CAP-TOKEN-2: a mint request is strict. An option the route does not know (a typo such as `tool`), a read_only that is not a boolean, a ttl_s that is not a number of at least 60
// and a task that is not a short string are refused (400) instead of minting a wider child than the caller meant.
async function capMint(scope, env, opts, nowMs) {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) throw new Error("body must be a JSON object");
  const o = opts;
  for (const key of Object.keys(o)) if (CAP_MINT_KEYS.indexOf(key) < 0) throw new Error("unknown option: " + key.slice(0, 32));
  const added = [];
  let ttl = 3600;
  if (o.ttl_s !== void 0) {
    if (typeof o.ttl_s !== "number" || !Number.isFinite(o.ttl_s) || o.ttl_s < 60) throw new Error("ttl_s must be a number of seconds, 60 or more");
    ttl = Math.min(Math.floor(o.ttl_s), CAP_MAX_TTL_S);
  }
  added.push({ x: Math.floor(nowMs / 1e3) + ttl });
  if (o.tools !== void 0) {
    if (!Array.isArray(o.tools) || !o.tools.length) throw new Error("tools must be a non-empty array of tool names");
    for (const n of o.tools) if (typeof n !== "string" || TOOLS.every((t) => t.name !== n)) throw new Error("unknown tool: " + String(n).slice(0, 64));
    added.push({ t: o.tools.slice() });
  }
  if (o.read_only !== void 0) {
    if (typeof o.read_only !== "boolean") throw new Error("read_only must be true or false");
    if (o.read_only) added.push({ w: 0 });
  }
  if (o.task !== void 0) {
    if (typeof o.task !== "string" || !o.task || o.task.length > 64) throw new Error("task must be a string of 1 to 64 characters");
    added.push({ k: o.task });
  }
  let body, startSig;
  if (scope.caps) {
    body = { i: scope.caps.body.i, r: scope.caps.body.r, c: scope.caps.body.c.slice() };
    startSig = scope.caps.sig;
  } else {
    const root = scope.root === "w" ? "w" : "r";
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    body = { i: id, r: root, c: [] };
    startSig = await capRootSig(root === "w" ? env.MCP_TOKEN : env.MCP_READ_TOKEN, id);
  }
  if (body.c.length + added.length > CAP_MAX_CAVEATS) throw new Error("too many caveats");
  const sig = await capChain(startSig, added);
  body.c = body.c.concat(added);
  const effExp = Math.min(...body.c.filter((c) => c.x !== void 0).map((c) => c.x));
  return { token: capEncode(body, sig), id: body.i, root: body.r, caveats: body.c, expires_at: new Date(effExp * 1e3).toISOString() };
}
__name(capMint, "capMint");
// CAP-TOKEN-2: a secret-free proof that the live isolate mints, verifies, narrows and expires tokens. It runs the production functions against an EPHEMERAL root and a stepped clock, so
// it touches no credential and writes nothing; GET /mcp/cap-selftest answers {"ok":true,...} while all of it holds (fm-capability-selftest-live reads it hourly).
async function capSelfTest() {
  const t0 = Date.now(), checks = [];
  const chk = (name, pass) => checks.push({ name, pass: !!pass });
  const rootBytes = crypto.getRandomValues(new Uint8Array(32));
  const env2 = { MCP_TOKEN: capB64u(rootBytes), MCP_READ_TOKEN: capB64u(rootBytes) + "-r" };
  try {
    const m = await capMint({ ok: true, write: true, caps: null, root: "w" }, env2, { tools: ["infra_status"], ttl_s: 60, task: "selftest" }, t0);
    const v = await capVerify(m.token, env2, t0);
    chk("a fresh token verifies with its allowlist, task and write scope", v.ok && v.write && v.caps.tools.length === 1 && v.caps.tools[0] === "infra_status" && v.caps.task === "selftest");
    chk("it is valid 59 s in and refused at 60 s", (await capVerify(m.token, env2, t0 + 59e3)).ok && !(await capVerify(m.token, env2, t0 + 60e3)).ok);
    chk("an open session sees the same expiry", !capExpired(v.caps, t0 + 59e3) && capExpired(v.caps, t0 + 60e3));
    const ro = await capMint(v, env2, { read_only: true, ttl_s: 3600 }, t0);
    const vro = await capVerify(ro.token, env2, t0);
    chk("a child is read-only and never outlives its parent", vro.ok && !vro.write && vro.caps.exp === v.caps.exp && vro.caps.tools.length === 1);
    const parts = m.token.split(".");
    const forged = parts[0] + "." + (parts[1][0] === "0" ? "1" : "0") + parts[1].slice(1);
    chk("a flipped signature fails closed", !(await capVerify(forged, env2, t0)).ok);
    chk("another root fails closed", !(await capVerify(m.token, { MCP_TOKEN: "x" + env2.MCP_TOKEN, MCP_READ_TOKEN: env2.MCP_READ_TOKEN }, t0)).ok);
    let refused = 0;
    for (const bad of [{ read_only: "true" }, { tool: ["infra_status"] }, { ttl_s: 0 }, { ttl_s: "5m" }, { ttl_s: 59 }, { task: 5 }, null, []]) {
      try { await capMint({ ok: true, write: true, caps: null, root: "w" }, env2, bad, t0); } catch (e) { refused++; }
    }
    chk("a typo, a string read_only and a bad ttl_s are refused", refused === 8);
  } catch (e) {
    chk("self-test ran without an exception: " + String(e && e.message || e).slice(0, 80), false);
  }
  return { ok: checks.length > 0 && checks.every((c) => c.pass), worker: "qnfo-tools-mcp", version: VERSION, checks };
}
__name(capSelfTest, "capSelfTest");
function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
__name(ok, "ok");
function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
__name(rpcErr, "rpcErr");
async function callEmail(env, path, opts = {}) {
  if (!env.EMAIL) throw new Error("EMAIL service binding not configured");
  const url = new URL(EMAIL_BASE + path);
  const headers = { "Authorization": "Bearer " + (env.EMAIL_API_KEY || "") };
  if (opts.body) headers["Content-Type"] = "application/json";
  // BP26-PROMPT-INJECTION-1: a call made on behalf of a model names its surface; the tool wrapper sets it, a model cannot. qnfo-email then applies the agent send policy.
  if (opts.surface) headers["x-qnfo-agent-surface"] = String(opts.surface);
  const resp = await env.EMAIL.fetch(url.toString(), {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : void 0
  });
  let j = null;
  try {
    j = await resp.json();
  } catch (e) {
    j = null;
  }
  if (!resp.ok) return { error: j && j.error || "email svc " + path + " HTTP " + resp.status };
  return j;
}
__name(callEmail, "callEmail");
// OWNER-QUEUE-MCP-1: the dashboard stays the only writer. These helpers call its public routes (the same ones the
// browser uses); no dashboard secret is held here, so the owner's emailed code is the whole gate, exactly as in the browser.
async function fleetJson(path, o) {
  const headers = { "x-fleet-ui": "1" };
  if (o.body !== void 0) headers["Content-Type"] = "application/json";
  if (o.cookie) headers["Cookie"] = "fleet_cmd=" + o.cookie;
  let resp;
  try {
    resp = await fetch(FLEET + path, { method: o.method, headers, body: o.body !== void 0 ? JSON.stringify(o.body) : void 0 });
  } catch (e) {
    return { error: "fleet.qnfo.org unreachable: " + String(e && e.message || e).slice(0, 120) };
  }
  let j = null;
  try {
    j = await resp.json();
  } catch (e) {
    j = null;
  }
  if (!j) return { error: "fleet.qnfo.org " + path + " HTTP " + resp.status + " (no JSON)" };
  if (!resp.ok && !j.error) j.error = "HTTP " + resp.status;
  if (o.wantCookie && resp.ok) {
    const sc = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie().join(", ") : resp.headers.get("set-cookie") || "";
    const m = /fleet_cmd=([0-9a-f]{64})/.exec(sc);
    if (!m) return { error: "the dashboard accepted the code but set no session" };
    j.cookie = m[1];
  }
  return j;
}
__name(fleetJson, "fleetJson");
// A code or session value must never reach the audit log (mcp_log keeps tool arguments).
function redactArgs(a) {
  const o = Object.assign({}, a || {});
  if (o.code !== void 0) o.code = "[redacted]";
  return o;
}
__name(redactArgs, "redactArgs");
async function callTool(env, name, args) {
  const H = { Authorization: "Bearer " + env.RT };
  const k = Math.min(parseInt(args.k || 5, 10) || 5, 20);
  if (name === "web_search") {
    const r = await env.QNFO_AI.fetch(ROUTER + "/v1/web/search?q=" + encodeURIComponent(String(args.q || "").slice(0, 300)) + "&k=" + Math.min(k, 10), { headers: H });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return { engine: j.engine || "duckduckgo", count: (j.results || []).length, results: (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })) };
  }
  if (name === "web_fetch") {
    // FULLSCOPE-1: the URL itself is length-capped before it goes upstream.
    const r = await env.QNFO_AI.fetch(ROUTER + "/v1/web/fetch?url=" + encodeURIComponent(String(args.url || "").slice(0, 2e3)) + "&max=" + Math.min(parseInt(args.max || 6e3, 10) || 6e3, 2e4), { headers: H });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return { url: j.url, text: j.text, truncated: j.truncated };
  }
  if (name === "papers_search") {
    const r = await env.QNFO_AI.fetch(ROUTER + "/v1/search?q=" + encodeURIComponent(String(args.q || "").slice(0, 300)) + "&k=" + k, { headers: H });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return { count: j.count || 0, results: (j.results || []).map((x) => ({ score: x.score, path: x.metadata && x.metadata.path, text: x.metadata && x.metadata.text })) };
  }
  if (name === "history_recall") {
    const r = await env.QNFO_AI.fetch(ROUTER + "/v1/history?q=" + encodeURIComponent(String(args.q || "").slice(0, 300)) + "&k=" + k, { headers: H });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return { count: j.count || 0, results: (j.results || []).map((x) => ({ score: x.score, model: x.metadata && x.metadata.model, text: x.metadata && x.metadata.text })) };
  }
  if (name === "express_desire") {
    const r = await env.QNFO_INTENT.fetch("https://qnfo-intent-orchestrator.q08.workers.dev/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.INTENT_TOKEN },
      body: JSON.stringify({ desire: String(args.desire || "").slice(0, 4e3), source: String(args.source || "mcp") })
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return j;
  }
  if (name === "infra_status" || name === "infra_analytics" || name === "infra_records") {
    const p = name === "infra_status" ? "/state" : name === "infra_analytics" ? "/analytics" : "/records";
    const r = await env.QNFO_INFRA.fetch("https://qnfo-infra.q08.workers.dev" + p, { headers: { Authorization: "Bearer " + env.INFRA_TOKEN } });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return j;
  }
  if (name === "intents_list") {
    const q = "?limit=" + Math.min(parseInt(args.limit || 20, 10) || 20, 100) + (args.status ? "&status=" + encodeURIComponent(String(args.status)) : "");
    const r = await env.QNFO_INTENT.fetch("https://qnfo-intent-orchestrator.q08.workers.dev/intents" + q, {
      headers: { "Authorization": "Bearer " + env.INTENT_TOKEN }
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    // FULLSCOPE-1: a row with neither summary nor desire used to throw (x.desire.slice on undefined) and fail the whole call.
    return { count: j.count || 0, intents: (j.intents || []).map((x) => ({ id: x.id, type: x.type, domain: x.domain, summary: x.summary || String(x.desire || "").slice(0, 100), due: x.due, status: x.status, created_at: x.created_at })) };
  }
  if (name === "personal_search") {
    // AUTOAUDIT-DEAD-CALLERS-1 (#2302): the personal index is served by qnfo-intent-orchestrator GET /personal/search
    // (1.4.0), reached over the binding and key this worker already holds; the search worker it used to call is retired.
    const tk = Math.min(parseInt(args.topK || args.k || 5, 10) || 5, 20);
    const r = await env.QNFO_INTENT.fetch("https://qnfo-intent-orchestrator.q08.workers.dev/personal/search?q=" + encodeURIComponent(String(args.q || "").slice(0, 300)) + "&topK=" + tk, {
      headers: { "Authorization": "Bearer " + env.INTENT_TOKEN }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error || "HTTP " + r.status };
    return { count: j.count || 0, files: (j.files || []).map((f) => ({ path: f.path, score: f.bestScore, snippet: f.snippet })) };
  }
  if (name === "email_check") {
    const lim = Math.min(parseInt(args.limit || 20, 10) || 20, 100);
    const st = args.status ? "&status=" + encodeURIComponent(String(args.status)) : "";
    const j = await callEmail(env, "/emails/recent?limit=" + lim + st);
    if (j.error) return { error: j.error };
    if (args.body_id !== void 0 && args.body_id !== null) {
      // FULLSCOPE-1: a non-numeric body_id used to go upstream as id=NaN.
      const bid = parseInt(args.body_id, 10);
      if (!Number.isFinite(bid) || bid <= 0) return { error: "body_id must be a positive integer email id" };
      const b = await callEmail(env, "/emails/body?id=" + bid);
      if (b.error) return { error: b.error };
      return { count: j.count || 0, emails: j.emails || [], body: b };
    }
    return { count: j.count || 0, emails: j.emails || [] };
  }
  if (name === "email_stats") {
    const j = await callEmail(env, "/stats");
    if (j.error) return { error: j.error };
    return j;
  }
  if (name === "email_search") {
    const lim = Math.min(parseInt(args.limit || 20, 10) || 20, 100);
    const j = await callEmail(env, "/emails/search?q=" + encodeURIComponent(String(args.q || "").slice(0, 200)) + "&limit=" + lim);
    if (j.error) return { error: j.error };
    return j;
  }
  if (name === "email_respond") {
    if (!String(args.to || "").includes("@")) return { error: "to is required" };
    if (!String(args.subject || "").trim()) return { error: "subject is required" };
    if (!String(args.body || "").trim() && !String(args.html || "").trim()) return { error: "body or html is required" };
    // MCP-COLD-SEND-UNGATED-1 (2026-09-24): a COLD send (no reply_to_id) must be explicitly
    // affirmed. The prior schema accepted to+subject+body alone, so an unattended caller could
    // cold-send with no gate. Replies (reply_to_id present) are completely unaffected.
    const _cold = !args.reply_to_id;
    if (_cold && args.affirm !== true) return { error: "cold send rejected: pass reply_to_id to reply, or affirm:true to confirm a NEW outbound email (MCP-COLD-SEND-UNGATED-1)" };
    if (_cold && /(^|[^a-z])(test|verify|canary|matrix)([^a-z]|$)/i.test(String(args.subject || ""))) return { error: "cold send rejected: subject carries a test/canary token (EMAIL-SUBJECT-SPAM-TOKENS-1)" };
    const payload = { to: String(args.to), subject: String(args.subject), body: String(args.body || "") };
    if (args.html) payload.html = String(args.html);
    if (args.reply_to_id) payload.reply_to_id = parseInt(args.reply_to_id, 10);
    if (args.from) payload.from = String(args.from);
    const j = await callEmail(env, "/send", { method: "POST", body: payload, surface: "mcp" });
    if (j.error) return { error: j.error };
    return { success: !!j.success, message_id: j.message_id || null, to: j.to, subject: j.subject, sent_at: j.sent_at || null };
  }
  if (name === "email_mark") {
    const id = parseInt(args.id, 10);
    const status = String(args.status || "");
    if (!id || !status) return { error: "id and status required" };
    const j = await callEmail(env, "/emails/status", { method: "PATCH", body: { id, status } });
    if (j.error) return { error: j.error };
    return j;
  }
  if (name === "owner_queue") {
    const lim = Math.min(parseInt(args.limit || 50, 10) || 50, 100);
    const j = await fleetJson("/api/human", { method: "GET" });
    if (j.error) return { error: j.error };
    const slim = (i) => ({ key: i.key, title: i.title, why: i.why, action: i.action, url: i.url || "", sev: i.sev, due: i.due || "", age_days: i.age == null ? null : i.age, fallback: i.fallback || "" });
    const items = (j.items || []).slice(0, lim).map(slim);
    return { verdict: j.verdict, open: j.count, snoozed: j.snoozed, shown: items.length, items, upcoming: (j.upcoming || []).slice(0, lim).map(slim), next: "owner_code emails the owner a code; owner_act uses it." };
  }
  if (name === "owner_code") {
    const j = await fleetJson("/api/cmd/code", { method: "POST", body: {} });
    if (j.error) return { error: j.error };
    return { sent: !!j.sent, note: j.note || "" };
  }
  if (name === "owner_act") {
    const code = String(args.code || "").replace(/\D/g, "");
    if (code.length !== 6) return { error: "code must be the 6 digits the owner received from owner_code" };
    const acts = Array.isArray(args.actions) ? args.actions.slice(0, 10) : [];
    if (!acts.length) return { error: "actions is empty" };
    for (const a of acts) {
      const kind = String(a && a.kind || "");
      if (["done", "dismiss", "snooze", "note"].indexOf(kind) < 0) return { error: "kind must be done|dismiss|snooze|note" };
      if (!/^[A-Za-z0-9:._-]{3,160}$/.test(String(a && a.key || ""))) return { error: "bad key: " + String(a && a.key || "").slice(0, 60) };
      // Days above 90 are clamped to 90 at dispatch (pinned by owner-queue.test.mjs), not refused.
      if (kind === "snooze" && !(Number(a.days) >= 1)) return { error: "snooze needs days 1-90" };
      if (kind === "note" && !String(a.note || "").trim()) return { error: "note needs text" };
    }
    const v = await fleetJson("/api/cmd/verify", { method: "POST", body: { code }, wantCookie: true });
    if (v.error) return { error: "code not accepted: " + v.error, results: [] };
    const results = [];
    for (const a of acts) {
      const kind = String(a.kind);
      const r = await fleetJson("/api/cmd/run", { method: "POST", cookie: v.cookie, body: { op: kind, args: { key: String(a.key), days: kind === "snooze" ? Math.min(90, Math.max(1, Math.round(Number(a.days)))) : void 0, note: kind === "note" ? String(a.note).slice(0, 500) : void 0 } } });
      results.push({ key: a.key, kind, ok: !r.error && r.ok !== false, text: r.text || void 0, error: r.error || void 0 });
    }
    return { ok: results.every((x) => x.ok), done: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
  }
  throw new Error("unknown tool: " + name);
}
__name(callTool, "callTool");
// FULLSCOPE-1: the client's requested protocol version is honoured when it is one this server supports
// (the MCP handshake rule: answer with a version both sides speak); otherwise the default is offered.
function negotiateProtocol(params) {
  const want = params && typeof params === "object" ? params.protocolVersion : null;
  return SUPPORTED_PROTOCOLS.indexOf(want) >= 0 ? want : DEFAULT_PROTOCOL;
}
__name(negotiateProtocol, "negotiateProtocol");
// One JSON-RPC message. Returns null for notifications (no id), which must never be answered.
async function handleJsonRpc(msg, env, allowWrite, sessionId, caps) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcErr(null, -32600, "Invalid Request");
  const m = msg.method;
  const isNotification = msg.id === void 0;
  if (typeof m !== "string" || !m) return isNotification ? null : rpcErr(msg.id, -32600, "Invalid Request: method required");
  if (allowWrite === void 0) allowWrite = true;
  if (m === "initialize") {
    return ok(msg.id, { protocolVersion: negotiateProtocol(msg.params), capabilities: { tools: { listChanged: false } }, serverInfo: { name: "qnfo-tools-mcp", version: VERSION } });
  }
  // Notifications: acknowledge by silence. Known and unknown alike get no response (JSON-RPC 2.0).
  if (m.indexOf("notifications/") === 0 || m === "initialized") return null;
  if (m === "ping") return isNotification ? null : ok(msg.id, {});
  if (m === "tools/list") return ok(msg.id, { tools: TOOLS.filter((t) => (allowWrite || WRITE_TOOLS.indexOf(t.name) < 0) && (!caps || !caps.tools || caps.tools.indexOf(t.name) >= 0)) });
  // FULLSCOPE-1: clients that probe resources/prompts on connect used to get -32601; answer with empty lists.
  if (m === "resources/list") return ok(msg.id, { resources: [] });
  if (m === "resources/templates/list") return ok(msg.id, { resourceTemplates: [] });
  if (m === "prompts/list") return ok(msg.id, { prompts: [] });
  if (m === "tools/call") {
    const params = msg.params && typeof msg.params === "object" ? msg.params : null;
    const tname = params ? String(params.name || "") : "";
    if (!tname) return rpcErr(msg.id, -32602, "Invalid params: tools/call needs params.name");
    if (TOOLS.every((t) => t.name !== tname)) return rpcErr(msg.id, -32602, "unknown tool: " + tname);
    if (!allowWrite && WRITE_TOOLS.indexOf(tname) >= 0) {
      return rpcErr(msg.id, -32003, "forbidden: token lacks write scope for '" + tname + "'");
    }
    if (caps && caps.tools && caps.tools.indexOf(tname) < 0) {
      return rpcErr(msg.id, -32003, "forbidden: capability token does not allow '" + tname + "'");
    }
    const targs = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
    try {
      const out = await callTool(env, tname, targs);
      try {
        if (env.AUDIT) {
          await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS mcp_log (id TEXT PRIMARY KEY, ts TEXT, tool TEXT, args TEXT, result TEXT, session TEXT)").run();
          // FULLSCOPE-1: Date.now alone collided on the PRIMARY KEY for two calls inside one millisecond
          // (the failed insert was swallowed and the log line lost); the random suffix makes collisions impossible.
          await env.AUDIT.prepare("INSERT INTO mcp_log (id, ts, tool, args, result, session) VALUES (?1,?2,?3,?4,?5,?6)").bind("mcp-" + Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8), (/* @__PURE__ */ new Date()).toISOString(), tname, JSON.stringify(redactArgs(targs)).slice(0, 2e3), JSON.stringify(out).slice(0, 4e3), caps ? "cap:" + caps.id + (caps.task ? ":" + caps.task : "") + (sessionId ? "|" + sessionId : "") : sessionId || "").run();
        }
      } catch (e2) {
      }
      return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok(msg.id, { content: [{ type: "text", text: "ERROR: " + (e && e.message || String(e)) }], isError: true });
    }
  }
  if (isNotification) return null;
  return rpcErr(msg.id, -32601, "method not found: " + m);
}
__name(handleJsonRpc, "handleJsonRpc");
// FULLSCOPE-1: a JSON-RPC batch is answered as a batch; notifications inside it drop out of the reply.
async function handleRpcBody(msg, env, allowWrite, sessionId, caps) {
  if (Array.isArray(msg)) {
    if (!msg.length) return { batch: true, body: [rpcErr(null, -32600, "Invalid Request: empty batch")] };
    const outs = [];
    for (const m2 of msg) {
      const o = await handleJsonRpc(m2, env, allowWrite, sessionId, caps);
      if (o) outs.push(o);
    }
    return { batch: true, body: outs.length ? outs : null };
  }
  return { batch: false, body: await handleJsonRpc(msg, env, allowWrite, sessionId, caps) };
}
__name(handleRpcBody, "handleRpcBody");
var sessions = /* @__PURE__ */ new Map();
async function selfRegister(env) {
  const manifest = {
    service: "qnfo-tools-mcp",
    kind: "worker",
    version: VERSION,
    base_url: "https://qnfo-tools-mcp.q08.workers.dev",
    purpose: "MCP server (SSE + streamable HTTP) exposing the QNFO machine tool surface (web, research corpus, personal KB, intent queue, infra/analytics, email) to any MCP-capable LLM client",
    capabilities: ["mcp-server", "sse", "streamable-http", "tools", "web-search", "web-fetch", "research-search", "personal-search", "intent-express", "intent-query", "infra-state", "infra-analytics", "email"],
    routes: ["/health", "/mcp/sse", "/mcp/messages", "/mcp", "/mcp/attenuate", "/mcp/cap-selftest"],
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    models: [],
    deps: ["qnfo-ai (router RT)", "qnfo-infra", "qnfo-intent-orchestrator", "qnfo-email"]
  };
  const resp = await env.QNFO_OPS.fetch("https://qnfo-ops.internal/registry/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (env.REGISTRY_TOKEN || "") },
    body: JSON.stringify(manifest)
  });
  return resp.ok;
}
__name(selfRegister, "selfRegister");
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (path === "/health" && method === "GET") {
      if (ctx && ctx.waitUntil && env.QNFO_OPS && env.REGISTRY_TOKEN) {
        ctx.waitUntil(selfRegister(env).catch((e) => console.log("self-register err", e && e.message || e)));
      }
      return new Response(JSON.stringify({ ok: true, worker: "qnfo-tools-mcp", version: VERSION, protocol: SUPPORTED_PROTOCOLS, capabilities: TOOLS.map((t) => t.name), limitations: ["MCP routes need a token (bearer or ?token=)", "write tools need a token with write scope", "email tools work only through the qnfo-email binding"], tools: TOOLS.map((t) => t.name), sessions: sessions.size, bindings: { email: !!env.EMAIL, email_key: !!env.EMAIL_API_KEY, audit: !!env.AUDIT }, tokens: { read_token_configured: !!env.MCP_READ_TOKEN } }), { headers: { "Content-Type": "application/json", ...cors } });
    }
    const tokenFrom = /* @__PURE__ */ __name((u, req) => u.searchParams.get("token") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), "tokenFrom");
    if (path === "/mcp/sse" && method === "GET") {
      const scSse = await resolveScope(tokenFrom(url, request), env);
      if (!scSse.ok) return new Response("unauthorized", { status: 401 });
      const sessionId = crypto.randomUUID();
      const encoder = new TextEncoder();
      let keep;
      const stream = new ReadableStream({
        start(controller) {
          sessions.set(sessionId, { c: controller, write: scSse.write, caps: scSse.caps || null });
          controller.enqueue(encoder.encode("event: endpoint" + NL + "data: /mcp/messages?sessionId=" + sessionId + NL + NL));
          keep = setInterval(() => {
            try {
              // CAP-TOKEN-2: the stream ends when the capability token's expiry passes (within one keepalive); each POST below is checked exactly.
              if (capExpired(scSse.caps, Date.now())) {
                clearInterval(keep);
                sessions.delete(sessionId);
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(": keepalive" + NL + NL));
            } catch (e) {
            }
          }, 15e3);
        },
        cancel() {
          clearInterval(keep);
          sessions.delete(sessionId);
        }
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...cors } });
    }
    if (path === "/mcp/messages" && method === "POST") {
      const sessionId = url.searchParams.get("sessionId") || "";
      let sess = sessions.get(sessionId);
      // CAP-TOKEN-2: the scope stored when the stream opened must not outlive the capability token's expiry (a 60 s token on an open stream worked for ever in 1.5.0).
      if (sess && capExpired(sess.caps, Date.now())) {
        sessions.delete(sessionId);
        try {
          sess.c.close();
        } catch (e) {
        }
        sess = void 0;
      }
      const controller = sess ? sess.c : null;
      const scMsg = await resolveScope(tokenFrom(url, request), env);
      // MCP-MESSAGES-UNAUTHENTICATED (953): this endpoint previously executed JSON-RPC
      // tools with NO auth check at all. Require either a live auth-established SSE
      // session or a valid MCP_TOKEN, matching /mcp and /mcp/sse.
      if (!controller && !scMsg.ok) return new Response("unauthorized", { status: 401 });
      let msg;
      try {
        msg = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400 });
      }
      const handled = await handleRpcBody(msg, env, sess ? !!sess.write : scMsg.write, sessionId || null, sess ? sess.caps : scMsg.caps);
      if (controller) {
        // SSE transport: results travel down the event stream; the POST is only acknowledged.
        if (handled.body) {
          const encoder = new TextEncoder();
          const frames = handled.batch ? handled.body : [handled.body];
          for (const out of frames) controller.enqueue(encoder.encode("event: message" + NL + "data: " + JSON.stringify(out) + NL + NL));
        }
        return new Response("Accepted", { status: 202, headers: cors });
      }
      // FULLSCOPE-1: a token-authenticated POST with no live SSE session used to compute the result
      // and drop it (202, no delivery channel). It now gets the result inline, like /mcp.
      if (!handled.body) return new Response("", { status: 202, headers: cors });
      return new Response(JSON.stringify(handled.body), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/mcp" && method === "POST") {
      const scMcp = await resolveScope(tokenFrom(url, request), env);
      if (!scMcp.ok) return new Response("unauthorized", { status: 401 });
      let msg;
      try {
        msg = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400 });
      }
      const handled = await handleRpcBody(msg, env, scMcp.write, null, scMcp.caps);
      if (!handled.body) return new Response("", { status: 202, headers: cors });
      return new Response(JSON.stringify(handled.body), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/mcp/cap-selftest" && method === "GET") {
      const st = await capSelfTest();
      return new Response(JSON.stringify(st), { status: st.ok ? 200 : 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
    }
    if (path === "/mcp/attenuate" && method === "POST") {
      // CAP-TOKEN-1: derive a narrower token from the one presented. A capability token as parent keeps every caveat it has; nothing here can widen.
      const scAtt = await resolveScope(tokenFrom(url, request), env);
      if (!scAtt.ok) return new Response("unauthorized", { status: 401 });
      let optsAtt;
      try {
        optsAtt = await request.json();
      } catch (e) {
        return new Response("bad json", { status: 400 });
      }
      let minted;
      try {
        minted = await capMint(scAtt, env, optsAtt, Date.now());
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e).slice(0, 200) }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
      }
      try {
        if (env.AUDIT) {
          await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS mcp_log (id TEXT PRIMARY KEY, ts TEXT, tool TEXT, args TEXT, result TEXT, session TEXT)").run();
          await env.AUDIT.prepare("INSERT INTO mcp_log (id, ts, tool, args, result, session) VALUES (?1,?2,?3,?4,?5,?6)").bind("mcp-" + Date.now().toString(36) + "-" + crypto.randomUUID().slice(0, 8), (/* @__PURE__ */ new Date()).toISOString(), "cap:attenuate", JSON.stringify({ id: minted.id, root: minted.root, caveats: minted.caveats }).slice(0, 2e3), "minted", scAtt.caps ? "cap:" + scAtt.caps.id : "static:" + (scAtt.write ? "w" : "r")).run();
        }
      } catch (e2) {
      }
      return new Response(JSON.stringify(minted), { headers: { "Content-Type": "application/json", ...cors } });
    }
    if (path === "/mcp" && method === "GET") {
      // Streamable-HTTP server stream is not offered here; SSE lives at /mcp/sse.
      return new Response("method not allowed: POST JSON-RPC here, or open the SSE stream at /mcp/sse", { status: 405, headers: { ...cors, Allow: "POST" } });
    }
    return new Response("not found", { status: 404, headers: cors });
  }
};
export {
  worker_default as default
};
