var VERSION = "0.1.2-glm53";
var WORKER = "qnfo-idea-miner";
var MODEL = "@cf/zai-org/glm-5.3-flash"; // 2026-09-08 model audit: extraction task; flash -> glm-5.3-flash (3x cheaper, fc+reasoning)
var MAX_IDEAS = 3;
var MAX_TOKENS = 1500;

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
function nowIso() { return new Date().toISOString(); }
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return "h" + (h >>> 0).toString(36) + s.length.toString(36);
}

async function runModel(env, prompt) {
  try {
    const r = await env.AI.run(MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: MAX_TOKENS, temperature: 0.4 });
    const c = r && r.choices && r.choices[0] && r.choices[0].message;
    const text = c ? String(c.content || "") : (r && typeof r.response === "string" ? r.response : "");
    return text.trim();
  } catch (e) { return ""; }
}

var MINER_PROMPT = [
  "From the recent research-session titles below, propose up to 3 specific, novel, publishable research questions.",
  "Each idea must be a concrete research direction - a falsifiable claim or a derivable mathematical/quantitative result - NOT a chat summary, NOT an ops command, NOT a meta question about the pipeline.",
  "Write each idea as one sentence stating the precise research question.",
  "Return JSON ONLY: {\"ideas\":[\"idea 1\",\"idea 2\",\"idea 3\"]}",
  "Titles:"
].join("\n");

async function run(env) {
  const cooldown = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE name='auto-miner' AND created_at > ?").bind(new Date(Date.now() - 3 * 3600 * 1000).toISOString()).first();
  if (cooldown && cooldown.n > 0) return { status: "ok", mined: 0, note: "cooldown: recent auto-miner idea" };
  const rows = await env.QNFO_AUDIT.prepare("SELECT thread_id, title, updated_at FROM chat_sessions WHERE category='research' ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 12").all();
  const titles = (rows.results || []).map(function(r) { return String(r.title || r.thread_id || "").slice(0, 120); }).filter(Boolean);
  if (!titles.length) return { status: "ok", mined: 0, note: "no research sessions" };
  const text = await runModel(env, MINER_PROMPT + "\n" + titles.join("\n"));
  if (!text) return { status: "error", mined: 0, note: "model empty" };
  let ideas = [];
  try { ideas = (JSON.parse(text).ideas || []).slice(0, MAX_IDEAS); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { ideas = (JSON.parse(m[0]).ideas || []).slice(0, MAX_IDEAS); } catch (e2) {} }
  }
  if (!ideas.length) ideas = [text.slice(0, 800)];
  let mined = 0;
  for (const idea of ideas) {
    const ideaText = String(idea).trim().slice(0, 2000);
    if (ideaText.length < 20) continue;
    const h = hash(ideaText);
    const dup = await env.QNFO_AUDIT.prepare("SELECT COUNT(*) AS n FROM idea_proposals WHERE ip_hash=?1").bind(h).first();
    if (dup && dup.n > 0) continue;
    await env.QNFO_AUDIT.prepare("INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES (?1,?2,?3,'new',?4,?5)").bind("auto-miner", ideaText, "", h, nowIso()).run();
    mined++;
  }
  return { status: "ok", mined: mined, total: ideas.length };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, worker: WORKER, version: VERSION });
    if (url.pathname === "/run" && request.method === "POST") { const out = await run(env); return json({ ok: true, worker: WORKER, version: VERSION, out: out }); }
    return json({ error: "not found" }, 404);
  }
};