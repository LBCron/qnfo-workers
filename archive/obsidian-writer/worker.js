var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var VERSION = "1.2.0";
function json(o, s) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
}
__name(json, "json");
async function handle(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true, worker: "obsidian-writer", version: VERSION });
  if (request.method === "OPTIONS") return new Response("ok", { status: 204 });
  if (request.method !== "POST") return new Response("Method Not Allowed - POST only", { status: 405, headers: { "content-type": "text/plain" } });
  let p;
  try {
    p = await request.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const { slug, section, content, date } = p || {};
  if (!slug || !content) return new Response("slug and content required", { status: 400 });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const [y, m, day] = d.split("-");
  const key = "notes/v1/" + y + "/" + m + "/" + day + "/_" + slug + "-" + d + ".md";
  const header = "# " + (section || slug) + "\n\n> " + (/* @__PURE__ */ new Date()).toISOString() + "\n\n---\n\n## " + (section || slug) + "\n\n";
  const body = header + content;
  await env.VAULT.put(key, body, { httpMetadata: { contentType: "text/markdown" } });
  return json({ ok: true, key, bytes: body.length });
}
__name(handle, "handle");
var worker_default = {
  async fetch(request, env) {
    return handle(request, env);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map