var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker_ingest.js
var worker_ingest_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }
    const auth = request.headers.get("X-Sync-Token");
    if (path !== "/health" && (!auth || !env.SYNC_TOKEN || auth !== env.SYNC_TOKEN)) {
      return json({ error: "Unauthorized: missing or invalid X-Sync-Token" }, 401);
    }
    try {
      if (path === "/health") {
        return json({
          worker: "qnfo-thread-ingest",
          version: "1.0.0",
          status: "ok",
          bindings: { d1: !!env.QNFO_AUDIT, sync_token: !!env.SYNC_TOKEN }
        });
      }
      if (path === "/threads" && request.method === "POST") {
        return handleThreads(request, env);
      }
      if (path === "/stats" && request.method === "GET") {
        const res = await env.QNFO_AUDIT.prepare(
          "SELECT category, COUNT(*) n FROM chat_sessions GROUP BY category"
        ).all();
        return json({ sessions: res.results });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: "Server error: " + e.message }, 500);
    }
  }
};
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token"
  };
}
__name(cors, "cors");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, cors())
  });
}
__name(json, "json");
async function handleThreads(request, env) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > 3e6) return json({ error: "payload too large (max 3MB)" }, 413);
  const body = await request.json().catch(() => null);
  if (!body || !body.session_id) return json({ error: "session_id required" }, 400);
  if (!Array.isArray(body.messages)) return json({ error: "messages array required" }, 400);
  const sessionId = String(body.session_id).slice(0, 200);
  const messages = body.messages.filter((m) => m && m.role && typeof m.content === "string" && m.content.trim()).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content).slice(0, 2e4),
    timestamp: m.timestamp || null
  }));
  const category = body.category === "infra" ? "infra" : "research";
  const title = String(body.title || "").slice(0, 500);
  const agentId = String(body.agent_id || "").slice(0, 100);
  const modelId = String(body.model_id || "").slice(0, 100);
  const source = String(body.source || "deepchat").slice(0, 50);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let createdAt = now;
  if (body.created_at) {
    const ms = Number(body.created_at);
    if (Number.isFinite(ms) && ms > 1e12) createdAt = new Date(ms).toISOString();
  }
  let updatedAt = now;
  if (body.updated_at) {
    const ms = Number(body.updated_at);
    if (Number.isFinite(ms) && ms > 1e12) updatedAt = new Date(ms).toISOString();
  }
  const res = await env.QNFO_AUDIT.prepare(
    `INSERT INTO chat_sessions (thread_id, messages, created_at, updated_at, category, agent_id, title, model_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       messages = excluded.messages,
       updated_at = excluded.updated_at,
       category = excluded.category,
       agent_id = excluded.agent_id,
       title = excluded.title,
       model_id = excluded.model_id,
       source = excluded.source`
  ).bind(sessionId, JSON.stringify(messages), createdAt, updatedAt, category, agentId, title, modelId, source).run();
  return json({ success: true, session_id: sessionId, category, message_count: messages.length, changed: res.meta.changes });
}
__name(handleThreads, "handleThreads");
export {
  worker_ingest_default as default
};
//# sourceMappingURL=worker_ingest.js.map