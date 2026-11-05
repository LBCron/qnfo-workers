var __defProp = Object.defineProperty;
var VERSION = "2.7.4-doi-scrub";
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js — qnfo-idea-factory v2.0.0
// Public read-only window into QNFO research conversations.
// LIVE source: qnfo-ai worker chat log ('chat' table — per-message rows written by qnfo-ai
//   on every /v1/chat/completions, threaded by thread_id). Fixes the bug where the Ideas
//   chat read stale DeepChat session syncs (chat_sessions) instead of the qnfo-ai chat logs.
// ARCHIVE source: DeepChat research session snapshots (chat_sessions category='research').

/* ---- Adaptive research-domain suggestions (v2.7.0) ----
   SUGGESTION-DOMAIN-1 (HARD GATE): the Ideas ASK suggestion surface stays in the
   research domain. Personal/ops actions (email, inbox, calendar, tasks, reminders,
   social posting, infrastructure ops) are NEVER suggested. Live suggestions come from
   real research threads that pass the domain filter, plus a rotating frontier set. */
var SUGGEST_DENY = [
  "check my email", "check email", "check the inbox", "read my email", "read my inbox",
  "my inbox", "any new email", "send an email", "send email", "draft an email", "reply to",
  "outlook", "gmail", "mailbox", "inbox", "calendar", "appointment", "meeting today",
  "my tasks", "add a task", "remind me", "set a reminder", "reminder", "to-do",
  "post to bluesky", "post this", "to bluesky", "tweet", "social media", "linkedin",
  "whatsapp", "who should i contact", "reach out to", "suggest contacts", "contact me",
  "daily brief", "the fleet", "infra status", "cloudflare", "d1 database", "r2 bucket",
  "backup", "obsidian", "vault", "cron", "secret", "deploy", "wrangler", "worker status", "what's the tl;dr", "this would be good for a research paper"
];
var DENY_WORDS = ["email", "inbox", "mailbox", "gmail", "outlook", "calendar", "appointment",
  "bluesky", "tweet", "whatsapp", "remind", "reminder", "meeting", "contact", "notifications", "to-do", "task "];
function suggestDomainSafe(t) {
  const s = String(t || "").toLowerCase();
  if (!s) return false;
  if (s.length < 12 || s.length > 130) return false;
  if (/[\n\r]/.test(s)) return false;
  for (let i = 0; i < SUGGEST_DENY.length; i++) if (s.indexOf(SUGGEST_DENY[i]) !== -1) return false;
  for (let i = 0; i < DENY_WORDS.length; i++) {
    const re = new RegExp("(^|[^a-z0-9])" + DENY_WORDS[i] + "($|[^a-z0-9])");
    if (re.test(s)) return false;
  }
  if (/^(what time|what day|what is the time|write a|write code|implement a|run |execute |check |read |send |reply |post |remind )/.test(s)) return false;
  return true;
}
var FRONTIER_STARTERS = [
  "What is the Landauer floor for cryogenic quantum controllers?",
  "Can joules-per-compute benchmarking stay fair across very different architectures?",
  "Where does the Margolus-Levitin bound bind for a 1,000-logical-qubit surface code?",
  "Is energy per logical qubit the right normalization for quantum advantage claims?",
  "What would falsify p-adic valuations as a model of physical measurement?",
  "How do ultrametric geometries constrain what a discrete spacetime can compute?",
  "Can Laws-of-Form calculus be grounded in a measurable quantum process?",
  "Which thermodynamic constraints separate computation from physical evolution?",
  "Is wall-clock latency a more honest quantum metric than qubit count?",
  "What experiment would distinguish resonance computing from classical coupling?",
  "How should open-science audits handle papers that overclaim quantum advantage?",
  "What does the cmb higher-n point-function literature imply for early-universe models?",
  "When does a strange-loop architecture become a testable physical claim?",
  "What is the smallest honest demonstration of topological quantum computation?",
  "Can an LLM energy audit reach chip-benchmark rigor?",
  "Which condensed-matter systems give the most honest error-correction energy budget?"
];
function frontierPick(n) {
  const day = Math.floor(Date.now() / 86400000);
  const out = [];
  for (let k = 0; k < n && k < FRONTIER_STARTERS.length; k++) out.push(FRONTIER_STARTERS[(day + k * 5) % FRONTIER_STARTERS.length]);
  return out;
}
async function handleSuggest(url, env) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const ql = q.toLowerCase();
  let live = [];
  try { live = await liveThreads(env); } catch (e) { live = []; }
  const recency = (s) => { const ms = Date.parse(s.updated_at || s.created_at || ""); return Number.isFinite(ms) ? ms : 0; };
  const dom = (live || []).filter((s) => suggestDomainSafe(s.title));
  dom.sort((a, b) => {
    const sa = Math.min(Number(a.message_count) || 0, 30) - Math.max(0, (Date.now() - recency(a)) / 86400000) * 0.35;
    const sb = Math.min(Number(b.message_count) || 0, 30) - Math.max(0, (Date.now() - recency(b)) / 86400000) * 0.35;
    return sb - sa;
  });
  const dedupe = (arr) => { const seen = {}; const out = []; for (const it of arr) { const k = String(it.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); if (!k || seen[k]) continue; seen[k] = 1; out.push(it); } return out; };
  const recent = dedupe(dom).slice(0, 20);
  const toItem = (s) => ({ title: String(s.title || "").slice(0, 120), source: "recent", thread: s.id || null });
  const groups = [];
  const qIsOps = ql.length >= 2 && (SUGGEST_DENY.some((p) => ql.indexOf(p) >= 0) || DENY_WORDS.some((w) => { try { return new RegExp("(^|[^a-z0-9])" + w + "($|[^a-z0-9])").test(ql); } catch (e) { return false; } }));
  if (ql.length >= 2 && !qIsOps) {
    const matched = dedupe(recent.filter((s) => s.title.toLowerCase().indexOf(ql) >= 0).slice(0, 6).map(toItem));
    const fm = FRONTIER_STARTERS.filter((t) => t.toLowerCase().indexOf(ql) >= 0).slice(0, 2).map((t) => ({ title: t, source: "frontier" }));
    let cm = [];
    try {
      const ids = await searchThreadIds(env, q);
      const seenTitles = {};
      matched.concat(fm).forEach((m) => { seenTitles[String(m.title).toLowerCase()] = 1; });
      cm = recent.filter((s) => ids[s.id] && !seenTitles[s.title.toLowerCase()]).slice(0, 3).map(toItem);
    } catch (e) { cm = []; }
    const items = matched.concat(fm, cm).slice(0, 6);
    if (items.length) groups.push({ id: "match", label: "Live suggestions for your question", items });
    groups.push({ id: "recent", label: "Recent research questions", items: recent.filter((s) => s.title.toLowerCase().indexOf(ql) < 0).slice(0, 4).map(toItem) });
    groups.push({ id: "frontier", label: "Frontier questions", items: frontierPick(3) });
  } else {
    groups.push({ id: "recent", label: "Recent research questions", items: recent.slice(0, 6).map(toItem) });
    groups.push({ id: "frontier", label: "Frontier questions", items: frontierPick(4) });
  }
  return json({ q, policy: "research-domain only; personal/ops actions are never suggested", groups });
}
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }
    try {
      if (path === "/health") return json({ status: "ok", worker: "qnfo-idea-factory", version: VERSION, bindings: { d1: !!env.QNFO_AUDIT } });
      if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" } });
      if (path === "/rss.xml") return handleRss(env);
      if (path === "/embed") return serveEmbed();
      if (path === "/api/sessions") return handleSessions(url, env);
      if (path.startsWith("/api/session/")) return handleSession(path, env);
      if (path === "/api/feed") return handleFeed(url, env);
      if (path === "/api/ask" && request.method === "POST") return handleAsk(url, request, env);
      if (path === "/api/suggest" && request.method === "GET") return handleSuggest(url, env);
      if (path === "/api/proposals" && request.method === "POST") return handleProposalPost(request, env);
      if (path === "/api/proposals" && request.method === "GET") return handleProposalList(request, env);
      if (path === "/") return serveUI();
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: "Server error: " + e.message }, 500);
    }
  }
};
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
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
var REDACT = "[redacted]";
function redact(s) {
  if (!s) return s;
  let t = String(s);
  const protectedParts = [];
  t = t.replace(/(https?:\/\/[^\s"'<>()]+)/g, (m) => {
    protectedParts.push(m);
    return "\0P" + (protectedParts.length - 1) + "\0";
  });
  t = t.replace(/(10\.\d{4,9}\/\S+)/g, (m) => {
    protectedParts.push(m);
    return "\0P" + (protectedParts.length - 1) + "\0";
  });
  t = t.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, REDACT);
  t = t.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer " + REDACT);
  t = t.replace(/(\b(?:api[_-]?key|secret|password|passwd|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|cf[_-]?token|github[_-]?token)\b\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{8,}/gi, "$1" + REDACT);
  t = t.replace(/\b(?:wWbJ|AoG|cf-api|glpat|ghp_|xox[baprs]-)[A-Za-z0-9_-]{6,}/g, REDACT);
  t = t.replace(/\b[0-9a-fA-F]{32,}\b/g, REDACT);
  t = t.replace(/\b[A-Za-z]:\\[^\s"'<>|]*/g, REDACT);
  t = t.replace(/\/(?:c|d|e|f|g)\/Users\/[^\s"'<>|]*/gi, REDACT);
  t = t.replace(/%[A-Za-z]+%/g, REDACT);
  t = t.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, REDACT);
  t = t.replace(/\+\d{1,3}[\d\s()-]{7,}\b/g, REDACT);
  t = t.replace(/\b(?:session|thread|run|task|delegation|bg_|th_)[A-Za-z0-9_-]{10,}\b/gi, (m) => m.split(/[:_-]/)[0] + ":" + REDACT);
  t = t.replace(/\b[A-Za-z0-9_-]{24,}\b/g, REDACT);
  t = t.replace(/\u0000P(\d+)\u0000/g, (_, i) => protectedParts[Number(i)] || "");
  return t;
}
__name(redact, "redact");
// ROLE-LABEL-NORMALIZE-1 (feed-side guard, 2026-09-04): strip a leading transport role-label
// wrapper (User message:/Assistant message:/etc) from thread titles so legacy/wrapped rows never
// surface the label and identical normalized titles dedupe in collapseThreads (defense-in-depth
// behind the qnfo-ai v5.20.13 ingestion fix).
function normLabel(s) {
  if (typeof s !== "string") return s;
  return s.replace(/^(?:User message|Assistant message|System message|User|Assistant|Human|AI|System)\s*:\s*(?:\r?\n)+/i, "").replace(/^\r?\n+/, "");
}
__name(normLabel, "normLabel");
function collapseThreads(items) {
  var map = {}, order = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var key = (it.title || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
    if (!key || key === "test" || key === "hi" || key === "hello" || key === ".") continue;
    if (!(key in map)) {
      map[key] = it;
      order.push(key);
    } else if ((it.message_count || 0) > (map[key].message_count || 0)) {
      map[key] = it;
    }
  }
  return order.map(function(k) {
    return map[k];
  });
}
__name(collapseThreads, "collapseThreads");
var INTERNAL_MARKERS = ["INTENT_TOKEN", "rotation verification", "intent orchestrator accepts", "You decide how a newly extracted memory", "You synthesize a few durable", "memory relates to what is already known", "accepted the rotated", "web-search find email",
  "email received from", "email sync", "calendar event", "read-only context data", "the following sections are read-only",
  "strategy locked", "dedup-probe", "parity-probe", "filter-probe", "fix-ok", "fil-ok", "verify-5.8.0",
  "express desire", "intent-orchestrator", "auto-express note", "qnfo-ops.007", "mandate-chain", "object object"];
function isInternalThread(title) {
  const t = String(title || "").toLowerCase();
  return INTERNAL_MARKERS.some((m) => t.indexOf(m.toLowerCase()) >= 0);
}
__name(isInternalThread, "isInternalThread");
var JUNK_MARKERS = ["say ok", "say okay", "test", "testing", "first turn", "second turn", "third turn", "auto-express", "block the response", "opening turn", "capital of", "what is the capital", "who is", "who are you", "what is your name", "tell me a joke", "write a poem", "write me a", "make me a", "create me", "explain simply", "explain everything", "explain like i", "3 sentences", "5 years old", "five years old", "good morning", "good night", "thank you", "thanks", "you're welcome", "are you sure", "can you", "please", "what can you tell me about", "what do you know about", "what is love", "the meaning of life", "continue", "repeat", "again", "this sucks", "terrible response", "needs remediation", "what time is it", "what time", "write a python", "write code", "implement a", "based on the chat history", "give this conversation a name", "reply with exactly", "reply with the single word ok", "list every event on the qnfo calendar", "qnfo calendar", "guard-probe", "probe-", "rotation verification", "you decide how a newly extracted memory", "you synthesize a few durable", "probe does", "probe: does", "does auto-express", "what is the capital of", "say the word", "just say", "use your ", "call the ", "express_intent", "social_compose", "email_check", "search_research", "tool with action", "say hello", "hello world", "what is 2+2", "reply with the single word", "source detection", "gateway passed", "note these as fixes", "note for remediation", "mismatch-probe", "reasoning-leak", "filter-probe", "verify-5.8.0", "say the word", "nebul", "fil-ok", "fix-ok", "guard-probe", "what should i do today", "be more productive", "personally and professionally", "productivity", "daily planning", "life advice"];
function isJunkThread(title) {
  const raw = String(title || "").trim();
  if (!raw) return true;
  if (raw.length < 12) return true;
  const t = raw.toLowerCase();
  return JUNK_MARKERS.some((m) => t.indexOf(m) >= 0);
}
__name(isJunkThread, "isJunkThread");
function isSystemContent(c) {
  const sc = String(c || "").trim();
  if (!sc) return true;
  if (sc[0] === "{" && /^\{\s*"type"\s*:/.test(sc)) return true;
  if (sc.indexOf("data: ") === 0) return true;
  if (/^1\.\s*\*\*Analyze/i.test(sc)) return true;
  if (/^Okay, the user is asking/i.test(sc) || /^The user is asking/i.test(sc) || /^Let me understand/i.test(sc)) return true;
  return false;
}
__name(isSystemContent, "isSystemContent");


// ---- Live + archive thread sources ----
async function liveThreads(env) {
  // qnfo-ai worker chat log: per-message rows grouped by thread_id
  try {
    const res = await env.QNFO_AUDIT.prepare(
      "SELECT c.thread AS id, COUNT(*) AS n, MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts, " +
      "(SELECT content FROM chat c2 WHERE c2.thread = c.thread AND c2.role = 'user' ORDER BY c2.ts ASC, c2.id ASC LIMIT 1) AS title, " +
      "(SELECT model FROM chat c2 WHERE c2.thread = c.thread ORDER BY c2.ts DESC LIMIT 1) AS model, " +
      "(SELECT COUNT(*) FROM chatbox_conversations cc WHERE cc.thread_id = c.thread AND cc.source IN ('chatbox','deepchat')) AS human_n, " +
      "(SELECT COUNT(*) FROM chatbox_conversations cc WHERE cc.thread_id = c.thread AND cc.source = 'other' AND cc.ua LIKE 'Mozilla/%') AS human_browser_n " +
      "FROM chat c GROUP BY c.thread ORDER BY last_ts DESC LIMIT 200"
    ).all();
    const items = [];
    for (const t of res.results || []) {
      const firstTs = normTs(t.first_ts);
      const lastTs = normTs(t.last_ts);
      if (!firstTs && !lastTs) continue;
      const rawTitle = String(t.title || "(untitled)");
      if (isInternalThread(rawTitle)) continue;
      if (isJunkThread(rawTitle)) continue;
      const humanN = Number(t.human_n) || 0;
      const browserN = Number(t.human_browser_n) || 0;
      const msgN = Number(t.n) || 0;
      // API-client threads (curl/Dart/agents) are also real conversations: show any thread
      // with >=2 messages (a user+assistant exchange) that passed the junk/internal filters.
      if (humanN <= 0 && browserN <= 0 && msgN < 2) continue;
      items.push({
        id: t.id,
        kind: "thread",
        source: "live",
        title: redact(normLabel(String(t.title || "(untitled)")).slice(0, 200)),
        created_at: firstTs || lastTs,
        updated_at: lastTs || firstTs,
        message_count: Number(t.n) || 0,
        model: t.model || null,
        tags: ["conversation", "live"]
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}
__name(liveThreads, "liveThreads");
async function archiveThreads(env) {
  // DeepChat research session snapshots (historical archive)
  try {
    const res = await env.QNFO_AUDIT.prepare(
      "SELECT thread_id, title, messages, created_at, updated_at FROM chat_sessions WHERE category = 'research' ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 300"
    ).all();
    const items = [];
    for (const t of res.results || []) {
      let messages = [];
      try {
        messages = JSON.parse(t.messages || "[]");
      } catch (e) {
        messages = [];
      }
      if (!Array.isArray(messages) || messages.length === 0) continue;
      const userMsg = messages.find((m) => m && m.role === "user");
      items.push({
        id: t.thread_id,
        kind: "thread",
        source: "archive",
        title: redact((t.title || (userMsg && userMsg.content) || t.thread_id).slice(0, 200)),
        created_at: normTs(t.updated_at || t.created_at),
        updated_at: normTs(t.updated_at || t.created_at),
        message_count: messages.length,
        model: t.model_id || null,
        tags: ["conversation", "archive"]
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}
__name(archiveThreads, "archiveThreads");
async function allThreads(env) {
  const live = await liveThreads(env);
  live.sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  return live;
}
__name(allThreads, "allThreads");
async function searchThreadIds(env, q) {
  const like = "%" + q + "%";
  const ids = {};
  try {
    const live = await env.QNFO_AUDIT.prepare("SELECT DISTINCT thread AS id FROM chat WHERE content LIKE ? LIMIT 300").bind(like).all();
    (live.results || []).forEach((r) => { ids[r.id] = 1; });
  } catch (e) {}
  return ids;
}
__name(searchThreadIds, "searchThreadIds");
async function handleSessions(url, env) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  let all = await allThreads(env);
  if (q) {
    const ids = await searchThreadIds(env, q);
    all = all.filter((s) => ids[s.id]);
  }
  const page = all.slice(offset, offset + limit);
  return json({
    count: all.length,
    limit,
    offset,
    sessions: page.map((s) => ({ id: s.id, kind: s.kind, source: s.source, title: s.title, created_at: s.created_at, message_count: s.message_count, model: s.model, tags: s.tags }))
  });
}
__name(handleSessions, "handleSessions");
async function handleSession(path, env) {
  const id = decodeURIComponent(path.split("/").slice(3).join("/"));
  if (!id) return json({ error: "Missing id" }, 400);
  // LIVE: qnfo-ai worker chat log
  const chatRes = await env.QNFO_AUDIT.prepare(
    "SELECT ts, role, content, model FROM chat WHERE thread = ? ORDER BY ts ASC, CASE WHEN role = 'user' THEN 0 ELSE 1 END, id ASC LIMIT 500"
  ).bind(id).all();
  const chatRows = chatRes.results || [];
  if (chatRows.length) {
    const firstUser = chatRows.find((m) => m && m.role === "user");
    if (isInternalThread(firstUser && firstUser.content || "")) return json({ error: "Session not found or not public" }, 404);
    if (isJunkThread(firstUser && firstUser.content || "")) return json({ error: "Session not found or not public" }, 404);
    const messages = chatRows
      .filter((m) => !(m.role === "assistant" && isSystemContent(m.content)))
      .map((m) => ({
      role: m.role || "unknown",
      content: redact(String(m.content || "").slice(0, 2e5)),
      timestamp: normTs(m.ts),
      model: m.model || null
    }));
    return json({
      id,
      kind: "thread",
      source: "live",
      title: redact(String(firstUser && firstUser.content || "(untitled)").slice(0, 500)),
      model: chatRows[chatRows.length - 1].model || null,
      created_at: normTs(chatRows[0].ts),
      updated_at: normTs(chatRows[chatRows.length - 1].ts),
      message_count: messages.length,
      messages
    });
  }
  return json({ error: "Session not found or not public" }, 404);
}
__name(handleSession, "handleSession");
async function handleFeed(url, env) {
  const afterParam = url.searchParams.get("after");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "30", 10), 1), 100);
  let afterMs = 0;
  if (afterParam) {
    const n = Number(afterParam);
    afterMs = Number.isFinite(n) && n > 1e12 ? n : Date.parse(afterParam) || 0;
  }
  const now = Date.now();
  let all = await allThreads(env);
  const items = all.filter((s) => {
    const ms = Date.parse(s.updated_at || s.created_at || "");
    return Number.isFinite(ms) && ms > afterMs;
  }).slice(0, limit);
  const collapsed = collapseThreads(items);
  return json({ after: now, count: collapsed.length, sessions: collapsed });
}
__name(handleFeed, "handleFeed");
function normTs(v) {
  if (!v) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  let s = String(v).replace(" ", "T");
  if (!/Z$|[+-]\d\d:\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
__name(normTs, "normTs");
async function handleAsk(url, request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  const query = String(body.query || "").trim().slice(0, 500);
  if (!query) return json({ error: "Missing query" }, 400);
  try {
    const [qwavResp, threadRes] = await Promise.all([
      fetch("https://qnfo-qwav.q08.workers.dev/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "qnfo-idea-factory/2.0" },
        body: JSON.stringify({ query })
      }).then((r) => r.json()).catch(() => ({ error: "ask backend unreachable" })),
      relatedThreads(query, env)
    ]);
    const threads = [];
    for (const t of threadRes || []) {
      threads.push({
        id: t.id,
        title: t.title,
        created_at: t.created_at,
        message_count: t.message_count
      });
    }
    return json({
      query,
      answer: qwavResp.answer || null,
      sources: (qwavResp.sources || []).slice(0, 6).map((s) => ({ file: redact(s.file || ""), slug: s.slug, score: s.score })),
      model: qwavResp.model || null,
      backend_error: qwavResp.error || null,
      threads
    });
  } catch (e) {
    return json({ error: "Ask failed: " + e.message }, 502);
  }
}
__name(handleAsk, "handleAsk");
async function relatedThreads(query, env, limit = 6) {
  const terms = String(query || "").toLowerCase().replace(/[^a-z0-9+\- ]+/g, " ").split(/\s+/).filter((t) => t.length >= 3).slice(0, 8);
  if (!terms.length) return [];
  const hay = {};
  const meta = {};
  try {
    const chatRes = await env.QNFO_AUDIT.prepare("SELECT thread, role, content, ts FROM chat ORDER BY ts ASC").all();
    for (const r of chatRes.results || []) {
      if (!meta[r.thread]) meta[r.thread] = { title: "", n: 0, first_ts: r.ts, last_ts: r.ts };
      meta[r.thread].n++;
      if (r.ts < meta[r.thread].first_ts) meta[r.thread].first_ts = r.ts;
      if (r.ts > meta[r.thread].last_ts) meta[r.thread].last_ts = r.ts;
      if (!hay[r.thread]) hay[r.thread] = "";
      hay[r.thread] += " " + String(r.content || "");
      if (r.role === "user" && !meta[r.thread].title) meta[r.thread].title = String(r.content || "").slice(0, 200);
    }
  } catch (e) {}

  const scored = [];
  for (const id of Object.keys(hay)) {
    const lowerHay = hay[id].toLowerCase();
    let score = 0;
    for (const term of terms) { if (lowerHay.includes(term)) score++; }
    if (terms.length <= 3 ? score >= 1 : score >= 2) {
      const m = meta[id] || {};
      scored.push({ id, title: redact(String(m.title || id).slice(0, 200)), created_at: normTs(m.last_ts), message_count: m.n || 0, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || (b.created_at || "").localeCompare(a.created_at || ""));
  return scored.slice(0, limit);
}
__name(relatedThreads, "relatedThreads");
async function handleProposalPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  if (String(body.website || "").trim()) return json({ ok: true, status: "submitted" }, 200);
  const idea = String(body.idea || "").trim().slice(0, 2e3);
  if (idea.length < 20) return json({ error: "Please share a bit more (at least 20 characters)." }, 400);
  const name = String(body.name || "").trim().slice(0, 100);
  const contact = String(body.contact || "").trim().slice(0, 200);
  const cf = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = await sha256(cf).catch(() => "");
  const hourAgo = new Date(Date.now() - 3600 * 1e3).toISOString();
  const recent = await env.QNFO_AUDIT.prepare(
    "SELECT COUNT(*) AS n FROM idea_proposals WHERE ip_hash = ? AND created_at > ?"
  ).bind(ipHash, hourAgo).first();
  if ((recent && recent.n || 0) >= 3) return json({ error: "Please wait a bit before submitting again." }, 429);
  const res = await env.QNFO_AUDIT.prepare(
    "INSERT INTO idea_proposals (name, idea, contact, status, ip_hash, created_at) VALUES (?, ?, ?, 'new', ?, ?)"
  ).bind(name, idea, contact, ipHash, (/* @__PURE__ */ new Date()).toISOString()).run();
  return json({ ok: true, status: "submitted", id: res.meta.last_row_id });
}
__name(handleProposalPost, "handleProposalPost");
async function handleProposalList(request, env) {
  const auth = request.headers.get("X-Sync-Token");
  if (!auth || auth !== (env.SYNC_TOKEN || "")) return json({ error: "Unauthorized" }, 401);
  const res = await env.QNFO_AUDIT.prepare(
    "SELECT id, name, idea, contact, status, created_at FROM idea_proposals ORDER BY created_at DESC LIMIT 100"
  ).all();
  return json({ count: res.results.length, proposals: res.results });
}
__name(handleProposalList, "handleProposalList");
async function sha256(s) {
  const data = new TextEncoder().encode(String(s));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
var UI_HTML = String.raw`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QNFO Ideas</title>
<meta name="description" content="A public, read-only window into the QNFO research conversations — live from the QNFO AI worker chat log.">
<meta property="og:title" content="QNFO Ideas">
<meta property="og:description" content="Public read-only window into QNFO research conversations — live from the QNFO AI worker.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://ideas.qnfo.org">
<link rel="canonical" href="https://ideas.qnfo.org">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2324315e'/%3E%3Ctext x='16' y='23' text-anchor='middle' font-size='17' fill='%23faf7f2' font-family='Georgia,serif'%3EQ%3C/text%3E%3C/svg%3E">
<script>window.MathJax={tex:{inlineMath:[['$','$'],['\\(','\\)']],displayMath:[['$$','$$'],['\\[','\\]']],processEscapes:true},options:{skipHtmlTags:['script','noscript','style','textarea','pre','code'],enableMenu:false}};</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js" onerror="this.onerror=null;var s=document.createElement('script');s.src='https://unpkg.com/mathjax@3/es5/tex-svg.js';document.head.appendChild(s);"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Public+Sans:wght@400;500;600&display=swap');
:root{--paper:#faf7f2;--surface:#f2eee6;--ink:#1b1915;--muted:#8a8376;--border:#e2dcd0;--accent:#24315e;--accent-soft:#eceef6;--live:#2f6d4f;--arch:#8a8376}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:'Public Sans',system-ui,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.top{display:flex;align-items:baseline;gap:1.5rem;padding:1.4rem 1.6rem 1rem;max-width:880px;margin:0 auto;border-bottom:1px solid var(--border)}
.brand{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:1.35rem;letter-spacing:-.01em;color:var(--ink)}
.brand em{font-style:italic;color:var(--accent)}
.top nav{margin-left:auto;display:flex;gap:1.1rem}
.top nav a{font-size:.82rem;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:.2rem 0;border-bottom:2px solid transparent}
.top nav a:hover{color:var(--ink);text-decoration:none}
.top nav a.on{color:var(--ink);border-bottom-color:var(--accent)}
.live-dot{margin-left:.25rem;font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--live)}
main{max-width:880px;margin:0 auto;padding:2.2rem 1.6rem 4rem}
.page{max-width:720px;margin:0 auto}
.lede{color:var(--muted);font-size:.95rem;margin:0 0 1.8rem;max-width:56ch}
.toolbar{display:flex;align-items:center;gap:1rem;margin-bottom:1.6rem}
#search{flex:1;font:inherit;font-size:1rem;padding:.55rem 0;border:none;border-bottom:1.5px solid var(--border);background:transparent;color:var(--ink);outline:none;border-radius:0}
#search:focus{border-bottom-color:var(--accent)}
#search::placeholder{color:var(--muted)}
#count-label{font-size:.75rem;color:var(--muted);white-space:nowrap}
.list{display:flex;flex-direction:column}
.row{padding:1.05rem .2rem;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s}
.row:hover{background:var(--surface)}
.row-title{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:1.08rem;margin:0 0 .3rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.row-meta{font-size:.78rem;color:var(--muted);margin:0;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.tag{font-size:.64rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.12rem .45rem;border-radius:999px}
.tag.live{color:var(--live);background:#e7f0ea}
.tag.arch{color:var(--arch);background:#efede7}
.load-more{margin:1.6rem auto 0;display:block;font:inherit;font-size:.82rem;font-weight:500;color:var(--accent);background:transparent;border:1px solid var(--border);border-radius:999px;padding:.5rem 1.3rem;cursor:pointer;transition:all .12s}
.load-more:hover{border-color:var(--accent);background:var(--accent-soft)}
.empty,.loading,.err{padding:2.5rem 0;text-align:center;color:var(--muted)}
.back{display:inline-block;font-size:.8rem;color:var(--muted);margin-bottom:1.6rem;letter-spacing:.02em}
.back:hover{color:var(--accent)}
.detail-title{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:1.75rem;margin:0 0 .5rem;line-height:1.3}
.detail-meta{font-size:.8rem;color:var(--muted);margin:0 0 2.2rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.messages{display:flex;flex-direction:column;gap:1.4rem}
.msg{display:flex}
.msg.user{justify-content:flex-end}
.msg .bubble{max-width:78%;padding:.8rem 1rem;border-radius:10px;font-size:.94rem;line-height:1.7;white-space:pre-wrap;word-break:break-word;position:relative}
.msg.asst .bubble{max-width:100%;width:100%;background:var(--surface);border-left:2px solid var(--accent);border-radius:0;overflow-x:auto}
.msg.user .bubble{background:var(--ink);color:#f6f3ec;border-radius:10px 2px 10px 10px}
.msg .bubble pre{background:#26231d;color:#e8e2d6;padding:.6rem .8rem;border-radius:6px;overflow-x:auto;font-size:.8rem;white-space:pre-wrap}
.msg .bubble code{font-family:ui-monospace,Consolas,monospace;font-size:.86em}
.msg .meta{display:block;font-size:.68rem;color:var(--muted);margin-top:.45rem}
.msg.user .meta{color:rgba(246,243,236,.62);text-align:right}
.msg .bubble table,.ans table{border-collapse:collapse;width:100%;margin:.5rem 0 .9rem;font-size:.87rem;line-height:1.5}
.msg .bubble th,.msg .bubble td,.ans th,.ans td{border:1px solid var(--border);padding:.42rem .6rem;text-align:left;vertical-align:top}
.msg .bubble thead th,.ans thead th{background:var(--accent-soft);font-weight:600}
.msg .bubble tbody tr:nth-child(even),.ans tbody tr:nth-child(even){background:#fff}
.ask-row{display:flex;gap:.6rem;margin-bottom:.8rem}
#ask-input{flex:1;font:inherit;font-size:1.05rem;padding:.7rem .9rem;border:1.5px solid var(--border);border-radius:8px;background:#fff;color:var(--ink);outline:none}
#ask-input:focus{border-color:var(--accent)}
#ask-go{font:inherit;font-size:.9rem;font-weight:600;padding:.7rem 1.4rem;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;transition:opacity .12s}
#ask-go:hover{opacity:.9}
#ask-go:disabled{opacity:.5;cursor:wait}
.chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1.4rem}
.chips button{font:inherit;font-size:.74rem;color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:999px;padding:.28rem .7rem;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips button:hover{color:var(--accent);border-color:var(--accent)}
.chips{row-gap:.35rem}.chips .grp{flex-basis:100%;font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-top:.2rem;user-select:none}
.ans{background:var(--surface);border-left:2px solid var(--accent);padding:1rem 1.2rem;border-radius:2px 10px 10px 2px;font-size:.95rem;line-height:1.75;white-space:pre-wrap;word-break:break-word;margin:0 0 1rem}
.srcs h4,.rel h4{font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:1.2rem 0 .5rem}
.src{padding:.45rem 0;border-bottom:1px solid var(--border);font-size:.85rem;margin:0;display:flex;justify-content:space-between;gap:.6rem}
.src a{color:var(--accent);font-weight:500}
.score{color:var(--muted);font-size:.75rem;white-space:nowrap}
.rel-link{display:block;padding:.55rem 0;border-bottom:1px solid var(--border);font-size:.88rem;color:var(--ink);font-weight:500}
.rel-link:hover{color:var(--accent);text-decoration:none}
#propose-page textarea{width:100%;min-height:130px;font:inherit;font-size:.98rem;padding:.8rem .9rem;border:1.5px solid var(--border);border-radius:8px;background:#fff;color:var(--ink);outline:none;resize:vertical;margin-bottom:.8rem}
#propose-page textarea:focus{border-color:var(--accent)}
.prop-fields{display:flex;gap:.6rem;margin-bottom:.9rem;flex-wrap:wrap}
.prop-fields input{flex:1;min-width:200px;font:inherit;font-size:.9rem;padding:.6rem .8rem;border:1.5px solid var(--border);border-radius:8px;background:#fff;color:var(--ink);outline:none}
.prop-fields input:focus{border-color:var(--accent)}
.hp{position:absolute;left:-9999px;opacity:0;height:0;width:0}
#prop-go{font:inherit;font-size:.9rem;font-weight:600;padding:.65rem 1.5rem;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
#prop-go:disabled{opacity:.5;cursor:wait}
#propose-status{font-size:.82rem;color:var(--muted);margin-top:.8rem}
.foot{max-width:880px;margin:0 auto;padding:1.4rem 1.6rem 2.4rem;border-top:1px solid var(--border);font-size:.74rem;color:var(--muted);display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
@media(max-width:640px){.top{flex-wrap:wrap;gap:.8rem}.top nav{margin-left:0;width:100%;gap:1.4rem}.brand{width:100%}.msg .bubble{max-width:92%}.detail-title{font-size:1.45rem}}
</style>
</head>
<body>
<header class="top">
  <a class="brand" href="#/">QNFO <em>Ideas</em></a>
  <nav>
    <a href="#/" data-nav="feed">Conversations</a>
    <a href="#/ask" data-nav="ask">Ask</a>
    <a href="#/propose" data-nav="propose">Propose</a>
  </nav>
  <span class="live-dot" id="live-dot" hidden>&#9679; live</span>
</header>
<main id="view"></main>
<footer class="foot">
  <span>QNFO Ideas — a read-only window into the QNFO research conversations.</span>
  <a href="https://qnfo.org" target="_blank" rel="noopener">qnfo.org</a>
  <a href="/rss.xml">RSS</a>
</footer>
<script>
(function(){
var $=function(s){return document.querySelector(s);};
var view=$('#view');
var state={q:'',offset:0,limit:50,hasMore:false,lastAfter:Date.now(),sessions:[],selected:null,timer:null};
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtAgo(ts){
  if(!ts)return '';
  var d=new Date(ts);if(isNaN(d.getTime()))return '';
  var s=(Date.now()-d.getTime())/1000;
  if(s<60)return 'just now';
  if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';
  if(s<86400*7)return Math.floor(s/86400)+'d ago';
  return d.toLocaleDateString([],{month:'short',day:'numeric',year:d.getFullYear()===new Date().getFullYear()?undefined:'numeric'});
}
function fmtTs(ts){if(!ts)return '';var d=new Date(ts);if(isNaN(d.getTime()))return '';var now=new Date();return d.toDateString()===now.toDateString()?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{month:'short',day:'numeric'});}
function renderRich(s){
  var BK=String.fromCharCode(96);
  var A=String.fromCharCode(42);
  var raw=String(s||'').replace(/\r\n/g,'\n');
  var esc=function(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var blocks=[];
  var fence=new RegExp(BK+BK+BK+'([\\s\\S]*?)'+BK+BK+BK,'g');
  raw=raw.replace(fence,function(m,code){
    var lang='';
    var lines=code.split('\n');
    if(lines.length&&lines[0].trim()&&/^[A-Za-z0-9_+.-]+$/.test(lines[0].trim())){lang=lines[0].trim();code=lines.slice(1).join('\n');}
    blocks.push('<pre><code'+(lang?' class="lang-'+esc(lang)+'"':'')+'>'+esc(code.replace(/\n$/,''))+'</code></pre>');
    return '\u0002'+String(blocks.length-1)+'\u0002';
  });
  // Recover blank-line-collapsed markdown (producer stripped \n\n -> space).
  // (1) Glued table header: split prose off BEFORE a header whose next line is a
  //     separator with matching column count (lookahead preserves the existing newline).
  raw=raw.replace(/([^\n])[ \t]+(\|[^\n]*\|)[ \t]*(?=\n([ \t]*\|?[\s:|-]+\|?[ \t]*\n))/g,function(m,pre,hdr,sep){
    var nh=(hdr.split('|').filter(function(x){return x.trim()!=='';})).length;
    var ns=(sep.match(/-+/g)||[]).length;
    return (nh>0&&nh===ns)?(pre+'\n'+hdr):m;
  });
  // (2) Horizontal rules glued to text: "text. --- ##" -> "text.\n---\n##".
  raw=raw.replace(/([^\n])[ \t]+(---)[ \t]+(?=#{1,6}[ \t])/g,'$1\n$2\n');
  raw=raw.replace(/([^\n])[ \t]+(---)[ \t]*(?=\n)/g,'$1\n$2\n');
  // (3) Headings glued to preceding text.
  raw=raw.replace(/([^\n])[ \t]+(#{1,6}[ \t])/g,'$1\n$2');
  // (4) Blockquote glue: "text. > quote" -> "text.\n> quote".
  raw=raw.replace(/([^\n])[ \t]+(>[ \t]*\S)/g,'$1\n$2');
  var inline=function(x){
    var h=esc(x);
    var math=[];
    h=h.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*?\$/g,function(m){math.push(m);return '\u0001'+String(math.length-1)+'\u0001';});
    h=h.replace(new RegExp(BK+'([^'+BK+']+)'+BK,'g'),function(m,c){return '<code>'+c+'</code>';});
    h=h.split(A+A).map(function(p,i){return i%2?'<strong>'+p+'</strong>':p;}).join('');
    h=h.split(A).map(function(p,i){return i%2?'<em>'+p+'</em>':p;}).join('');
    h=h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
    h=h.replace(/\u0001(\d+)\u0001/g,function(m,i){return math[+i]||'';});
    return h;
  };
  var lines=raw.split('\n');
  var html=[],i,para=[],ul=0,ol=0,quote=0;
  function flush(){
    if(ul){html.push('</ul>');ul=0;}
    if(ol){html.push('</ol>');ol=0;}
    if(quote){html.push('</blockquote>');quote=0;}
    if(para.length){html.push('<p>'+para.map(inline).join('<br>')+'</p>');para=[];}
  }
  for(i=0;i<lines.length;i++){
    var line=lines[i];
    var t=line.trim();
    if(t===''){flush();continue;}
    if(/^\u0002\d+\u0002$/.test(t)){flush();html.push(blocks[+t.slice(1,-1)]);continue;}
    var hm=t.match(/^(#{1,6})\s+(.*)$/);
    if(hm){flush();var hh=hm[1].length;html.push('<h'+hh+'>'+inline(hm[2])+'</h'+hh+'>');continue;}
    if(/^(-{3,}|\*{3,}|_{3,})$/.test(t)){flush();html.push('<hr>');continue;}
    var bq=t.match(/^>\s?(.*)$/);
    if(bq){if(!quote){flush();html.push('<blockquote>');quote=1;}html.push(bq[1]);continue;}
    // Tolerant table parse: recover producer-collapsed blank lines and never swallow prose.
    // Table separator requires a real pipe row (a bare --- is an hr, not a table).
    if(t.indexOf('|')>=0&&lines[i+1]&&lines[i+1].indexOf('|')>=0&&/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i+1])&&lines[i+1].indexOf('-')>=0){
      var sepCols=(lines[i+1].split('|').map(function(x){return x.trim();}).filter(function(x){return x!=='';})).length||1;
      var hdrCells=line.split('|').map(function(x){return x.trim();}).filter(function(x){return x!=='';});
      var prefixProse=null;
      // Glued header: prose ran onto the same line as the table header (blank line stripped).
      if(line.trim().charAt(0)!=='|'&&hdrCells.length>sepCols){
        var cut=line.indexOf('|');
        prefixProse=line.slice(0,cut).trim();
        hdrCells=hdrCells.slice(hdrCells.length-sepCols);
      } else if(hdrCells.length>sepCols){
        hdrCells=hdrCells.slice(0,sepCols);
      }
      var body=[];var tailProse=null;
      i+=2;
      while(i<lines.length&&lines[i].trim()!==''&&lines[i].indexOf('|')>=0){
        var rc=lines[i].split('|').map(function(x){return x.trim();}).filter(function(x){return x!=='';});
        // Row with trailing prose glued after the last cell: keep the row, carry the prose.
        if(rc.length>sepCols){
          var segs=lines[i].split('|');
          var used=0,cutIdx=segs.length-1;
          for(var k=0;k<segs.length;k++){if(segs[k].trim()!==''){used++;if(used===sepCols){cutIdx=k;break;}}}
          rc=segs.slice(0,cutIdx+1).map(function(x){return x.trim();}).filter(function(x){return x!=='';});
          tailProse=segs.slice(cutIdx+1).join('|').trim();
          body.push(rc);
          i++;
          break;
        }
        body.push(rc);
        i++;
      }
      flush();
      if(prefixProse&&prefixProse.length){para.push(prefixProse);flush();}
      if(hdrCells.length){
        var th='';hdrCells.forEach(function(c){th+='<th>'+inline(c)+'</th>';});
        var tb='';body.forEach(function(rw){if(rw.length){tb+='<tr>'+rw.map(function(c){return '<td>'+inline(c)+'</td>';}).join('')+'</tr>';}});
        html.push('<table><thead><tr>'+th+'</tr></thead><tbody>'+tb+'</tbody></table>');
      }
      if(tailProse&&tailProse.length){para.push(tailProse);}
      continue;
    }
    var um=t.match(/^[-*+]\s+(.*)$/);
    if(um){if(!ul){flush();html.push('<ul>');ul=1;}html.push('<li>'+inline(um[1])+'</li>');continue;}
    var om=t.match(/^\d+\.\s+(.*)$/);
    if(om){if(!ol){flush();html.push('<ol>');ol=1;}html.push('<li>'+inline(om[1])+'</li>');continue;}
    para.push(t);
  }
  flush();
  return html.join('\n');
}
function typeset(el){
  function run(){if(window.MathJax&&MathJax.typesetPromise){MathJax.typesetPromise([el]).catch(function(){});}}
  if(window.MathJax){run();}else{setTimeout(run,300);setTimeout(run,1200);}
}
function tagHtml(s){return '<span class="tag live">LIVE</span>';}
/* feed */
function renderFeed(){
  state.offset=0;state.sessions=[];
  $('#live-dot').hidden=true;
  view.innerHTML='<section class="page"><p class="lede">Live research conversations submitted through the QNFO AI worker — the most recent threads, newest first.</p><div class="toolbar"><input id="search" type="search" placeholder="Search conversations…" autocomplete="off" aria-label="Search conversations"><span id="count-label"></span></div><div id="feed-empty" class="empty" hidden>No conversations yet — new QNFO AI worker conversations will appear here live.</div><div id="session-list" class="list"></div></section>';
  var si=$('#search');si.addEventListener('input',function(){state.q=this.value.trim();loadSessions(true);});
  loadSessions(true);
  startPoll();
}
function renderList(){
  var el=$('#session-list');
  if(!state.sessions.length){el.innerHTML='';$('#feed-empty').hidden=false;return;}
  $('#feed-empty').hidden=true;
  el.innerHTML=state.sessions.map(function(s){
    var model=s.model?' · '+esc(s.model):'';
    return '<article class="row" data-id="'+esc(s.id)+'"><h3 class="row-title">'+esc(s.title||'(untitled)')+'</h3><p class="row-meta"><span>'+fmtAgo(s.created_at)+'</span><span>'+s.message_count+' messages</span>'+model+' '+tagHtml(s)+'</p></article>';
  }).join('');
  var lb=$('#count-label');lb.textContent=state.sessions.length+' conversations';
  if(state.hasMore)el.insertAdjacentHTML('beforeend','<button class="load-more" id="load-more">Load more</button>');
  Array.prototype.forEach.call(document.querySelectorAll('.row'),function(n){n.onclick=function(){location.hash='#/s/'+encodeURIComponent(n.getAttribute('data-id'));};});
  var lm=$('#load-more');if(lm)lm.onclick=loadMore;
}
function loadSessions(reset){
  if(reset){state.offset=0;state.sessions=[];}
  var params=new URLSearchParams({limit:String(state.limit),offset:String(state.offset)});
  if(state.q)params.set('q',state.q);
  fetch('/api/sessions?'+params.toString()).then(function(r){return r.json();}).then(function(d){
    if(d.error)return;
    state.sessions=d.sessions||[];
    state.hasMore=state.sessions.length>=state.limit;
    renderList();
  }).catch(function(){});
}
function loadMore(){
  state.offset+=state.limit;
  var params=new URLSearchParams({limit:String(state.limit),offset:String(state.offset)});
  if(state.q)params.set('q',state.q);
  fetch('/api/sessions?'+params.toString()).then(function(r){return r.json();}).then(function(d){
    if(d.error)return;
    state.sessions=state.sessions.concat(d.sessions||[]);
    state.hasMore=(d.sessions||[]).length>=state.limit;
    renderList();
  }).catch(function(){});
}
function startPoll(){
  stopPoll();
  state.timer=setInterval(function(){
    if(location.hash!=='#/'&&location.hash!=='')return;
    fetch('/api/feed?after='+state.lastAfter).then(function(r){return r.json();}).then(function(d){
      if(d.error)return;
      state.lastAfter=d.after||Date.now();
      if(d.sessions&&d.sessions.length&&!state.q){
        var known={};state.sessions.forEach(function(s){known[s.id]=1;});
        var fresh=d.sessions.filter(function(s){return !known[s.id];});
        if(fresh.length){state.sessions=fresh.concat(state.sessions);state.hasMore=state.sessions.length>=state.limit;renderList();$('#live-dot').hidden=false;}
      }
    }).catch(function(){});
  },30000);
}
function stopPoll(){if(state.timer){clearInterval(state.timer);state.timer=null;}}
/* detail */
function renderDetail(id){
  stopPoll();
  state.selected=id;
  $('#live-dot').hidden=true;
  view.innerHTML='<section class="page"><a class="back" href="#/">&#8592; Conversations</a><p class="loading">Loading conversation…</p></section>';
  fetch('/api/session/'+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
    if(d.error){view.innerHTML='<section class="page"><a class="back" href="#/">&#8592; Conversations</a><p class="err">'+esc(d.error)+'</p></section>';return;}
    var head='<section class="page"><a class="back" href="#/">&#8592; Conversations</a><h1 class="detail-title">'+esc(d.title||'Conversation')+'</h1><p class="detail-meta"><span>'+d.message_count+' messages</span><span>started '+fmtAgo(d.created_at)+'</span>'+(d.model?'<span>'+esc(d.model)+'</span>':'')+' '+tagHtml(d)+'</p><div class="messages">';
    var body='';
    if(d.messages&&d.messages.length){
      body=d.messages.map(function(m){
        var who=m.role==='user'?'user':'asst';
        var inner=(m.role==='user')?esc(m.content):renderRich(m.content);
        return '<div class="msg '+who+'"><div class="bubble">'+inner+'<span class="meta">'+fmtTs(m.timestamp)+(m.role==='user'?' · you':' · QNFO')+'</span></div></div>';
      }).join('');
    }else{body='<p class="empty">No messages in this record.</p>';}
    view.innerHTML=head+body+'</div></section>';
    typeset(view);
  }).catch(function(e){view.innerHTML='<section class="page"><a class="back" href="#/">&#8592; Conversations</a><p class="err">Failed to load: '+esc(String(e))+'</p></section>';});
}
/* ask */
function renderAsk(){
  stopPoll();
  $('#live-dot').hidden=true;
  view.innerHTML='<section class="page"><p class="lede">Ask the QNFO research corpus — the indexed papers and knowledge base answer, with sources.</p><div class="ask-row"><input id="ask-input" type="text" maxlength="500" placeholder="Ask anything…" autocomplete="off" aria-label="Ask the research corpus"><button id="ask-go">Ask</button></div><div class="chips" id="ask-chips"></div><div id="ask-result"></div></section>';
  var ai0=$('#ask-input');
  ai0.addEventListener('keydown',function(e){if(e.key==='Enter')doAsk();});
  $('#ask-go').addEventListener('click',doAsk);
  ai0.addEventListener('input',function(){var v=ai0.value.trim();if(askDebounce)clearTimeout(askDebounce);askDebounce=setTimeout(function(){loadAskChips(v.length>=2?v:'');},320);});
  loadAskChips('');
}
var askDebounce=null;
function loadAskChips(q){
  var el=$('#ask-chips');if(!el)return;
  var clean=String(q||'').trim().slice(0,120);
  var url='/api/suggest'+(clean?'?q='+encodeURIComponent(clean):'');
  fetch(url).then(function(r){return r.json();}).then(function(d){
    if(!d.groups||!d.groups.length){el.innerHTML='';return;}
    var html='';
    d.groups.forEach(function(g){
      html+='<span class="grp">'+esc(g.label||'')+'</span>';
      (g.items||[]).forEach(function(it){
        var full=String(it.title||'ask');
        var shown=full.length>84?full.slice(0,84)+'…':full;
        html+='<button type="button" data-ask="'+esc(full)+'" title="'+esc(full)+'">'+esc(shown)+'</button>';
      });
    });
    el.innerHTML=html;
    var bs=el.querySelectorAll('button');
    for(var bj=0;bj<bs.length;bj++){
      (function(b){b.addEventListener('click',function(){var inp=$('#ask-input');if(inp){inp.value=b.getAttribute('data-ask')||'';doAsk();}});})(bs[bj]);
    }
  }).catch(function(){});
}
function doAsk(){
  var inp=$('#ask-input');if(!inp)return;
  var q=inp.value.trim();if(!q)return;
  var box=$('#ask-result');if(!box)return;
  box.style.display='block';box.innerHTML='<p class="ans">Searching for "'+esc(q)+'"…</p>';
  var go=$('#ask-go');go.disabled=true;
  fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})}).then(function(r){return r.json();}).then(function(d){
    if(d.error){box.innerHTML='<p class="ans">'+esc(d.error)+'</p>';return;}
    var html='';
    if(d.answer){html+='<div class="ans">'+renderRich(d.answer)+'</div>';}
    else if(d.backend_error){html+='<p class="ans">'+esc(d.backend_error)+'</p>';}
    if(d.sources&&d.sources.length){
      html+='<div class="srcs"><h4>Sources ('+d.sources.length+')</h4>';
      d.sources.forEach(function(s){
        var label=esc(s.file||s.slug||'source');
        html+='<p class="src">'+(s.slug?'<a href="https://papers.qnfo.org/papers/'+encodeURIComponent(s.slug)+'" target="_blank" rel="noopener">'+label+'</a>':'<span>'+label+'</span>')+(s.score!=null?' <span class="score">'+Number(s.score).toFixed(3)+'</span>':'')+'</p>';
      });
      html+='</div>';
    }
    if(d.threads&&d.threads.length){
      html+='<div class="rel"><h4>Related conversations ('+d.threads.length+')</h4>';
      d.threads.forEach(function(t){
        html+='<a class="rel-link" href="#/s/'+encodeURIComponent(t.id)+'">'+esc(t.title||'(untitled)')+' <span class="score">'+t.message_count+' messages</span></a>';
      });
      html+='</div>';
    }
    if(!d.answer&&!d.backend_error&&(!d.threads||!d.threads.length)){html='<p class="ans">No research found for that yet — try a different phrasing.</p>';}
    box.innerHTML=html;typeset(box);
  }).catch(function(e){box.innerHTML='<p class="ans">Failed: '+esc(String(e))+'</p>';}).finally(function(){go.disabled=false;});
}
/* propose */
function renderPropose(){
  stopPoll();
  $('#live-dot').hidden=true;
  view.innerHTML='<section class="page" id="propose-page"><p class="lede">Have an idea, question, or direction QNFO research should explore? Proposals land directly in the research queue for review.</p><textarea id="prop-idea" maxlength="2000" placeholder="Describe the idea, question, or experiment…" aria-label="Your idea"></textarea><div class="prop-fields"><input id="prop-name" maxlength="100" placeholder="Your name (optional)" autocomplete="off"><input id="prop-contact" maxlength="200" placeholder="Email / handle (optional)" autocomplete="off"></div><input class="hp" id="prop-website" tabindex="-1" autocomplete="off"><button id="prop-go">Submit proposal</button><p id="propose-status"></p></section>';
  $('#prop-go').addEventListener('click',doPropose);
}
function doPropose(){
  var idea=$('#prop-idea');if(!idea)return;
  var st=$('#propose-status');
  if(idea.value.trim().length<20){st.textContent='Please share a bit more (at least 20 characters).';return;}
  var go=$('#prop-go');go.disabled=true;st.textContent='Submitting…';
  var nm=$('#prop-name'),ct=$('#prop-contact'),wb=$('#prop-website');
  fetch('/api/proposals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idea:idea.value.trim(),name:nm?nm.value.trim():'',contact:ct?ct.value.trim():'',website:wb?wb.value:''})}).then(function(r){return r.json();}).then(function(d){
    if(d.error){st.textContent=esc(d.error);}
    else{st.textContent='Submitted — thank you. It will be reviewed for the research queue.';idea.value='';if(nm)nm.value='';if(ct)ct.value='';}
  }).catch(function(e){st.textContent='Failed: '+esc(String(e));}).finally(function(){go.disabled=false;});
}
/* router */
function route(){
  var h=location.hash||'#/';
  var navKey=(h.indexOf('#/ask')===0)?'ask':(h.indexOf('#/propose')===0)?'propose':'feed';
  Array.prototype.forEach.call(document.querySelectorAll('.top nav a'),function(a){a.classList.toggle('on',a.getAttribute('data-nav')===navKey);});
  if(h.indexOf('#/s/')===0){renderDetail(decodeURIComponent(h.slice(4)));}
  else if(h.indexOf('#/ask')===0){renderAsk();}
  else if(h.indexOf('#/propose')===0){renderPropose();}
  else{renderFeed();}
}
window.addEventListener('hashchange',route);
route();
})();
</script>
</body>
</html>
`;
async function handleRss(env) {
  const items = await allThreads(env);
  const base = "https://ideas.qnfo.org";
  const itemsXml = items.slice(0, 40).map((it) => {
    const title = xmlEsc(redact(String(it.title || it.id).slice(0, 200)));
    const link = base + "/#/s/" + encodeURIComponent(it.id);
    const desc = xmlEsc(redact(it.title || ""));
    const pub = it.updated_at || it.created_at ? new Date(it.updated_at || it.created_at).toUTCString() : (/* @__PURE__ */ new Date()).toUTCString();
    return "  <item>\n    <title>" + title + "</title>\n    <link>" + link + "</link>\n    <guid isPermaLink=\"false\">" + it.id + "</guid>\n    <description>" + desc + "</description>\n    <pubDate>" + pub + "</pubDate>\n  </item>";
  }).join("\n");
  const now = (/* @__PURE__ */ new Date()).toUTCString();
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>QNFO Idea Factory</title>\n  <link>' + base + "/</link>\n  <description>Public read-only research conversations from QNFO \u2014 ideas as they develop.</description>\n  <lastBuildDate>" + now + "</lastBuildDate>\n" + itemsXml + "\n</channel>\n</rss>";
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
__name(handleRss, "handleRss");
function xmlEsc(t) {
  return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
__name(xmlEsc, "xmlEsc");
function serveEmbed() {
  const html = `<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>QNFO Ideas \u2014 live</title>
<style>
:root{--ink:#1b1915;--muted:#8a8376;--border:#e2dcd0;--accent:#24315e;--live:#2f6d4f}
*{box-sizing:border-box}
body{margin:0;font-family:'Public Sans',system-ui,sans-serif;background:#faf7f2;color:var(--ink);padding:12px 14px;line-height:1.45}
.head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.head .dot{width:8px;height:8px;border-radius:50%;background:var(--live);animation:p 2s infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.3}}
.head b{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
a{color:var(--accent);text-decoration:none;font-size:13px;font-weight:600}
a:hover{text-decoration:underline}
.item{padding:6px 0;border-bottom:1px solid var(--border)}
.item .t{font-family:'Fraunces',Georgia,serif;font-size:13.5px;line-height:1.35}
.item .m{color:var(--muted);font-size:11px}
.foot{font-size:10px;color:var(--muted);margin-top:8px;text-align:right}
</style></head><body>
<div class="head"><span class="dot"></span><b>QNFO Ideas \u2014 live</b></div>
<div id="list">loading\u2026</div>
<div class="foot"><a href="https://ideas.qnfo.org" target="_blank" rel="noopener">Open the full factory \u2192</a></div>
<script>
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function load(){
  fetch('/api/sessions?limit=10').then(function(r){return r.json();}).then(function(d){
    var el=document.getElementById('list');
    if(!d.sessions||!d.sessions.length){el.textContent='No research threads yet.';return;}
    el.innerHTML=d.sessions.map(function(s){
      var d2=s.created_at?s.created_at.slice(0,10):'';
      return '<div class="item"><div class="t"><a href="https://ideas.qnfo.org/#/s/'+encodeURIComponent(s.id)+'" target="_blank" rel="noopener">'+esc(s.title||'(untitled)')+'</a></div><div class="m">'+d2+' \u00B7 '+s.message_count+' messages'+(s.source==='live'?' \u00B7 LIVE':'')+'</div></div>';
    }).join('');
  }).catch(function(){});
}
load();
setInterval(load,60000);
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" } });
}
__name(serveEmbed, "serveEmbed");
function serveUI() {
  return new Response(UI_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60"
    }
  });
}
__name(serveUI, "serveUI");
export {
  worker_default as default
};
