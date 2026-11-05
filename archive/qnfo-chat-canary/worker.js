// qnfo-chat-canary v1.0.0
// Purpose: behavioral verification of the qnfo-ai chat endpoint (QNFO.OPS.011A) +
//   daily research-daily-brief send guard (QNFO.OPS.011B / WORKER-SEND-GUARD-1).
// Cron: 15 */3 * * * -> canary probes; 30 6 * * * -> sent-guard.
// /run?cron=canary|sentguard&token=<RUN_TOKEN> -> manual trigger (verification).
// Probes: UTC date grounding, QNFO calendar grounding, JPCUB grounding, fallback
//   regression, /v1/models shape (ChatBox parity). Results -> qnfo-audit.chat_canary;
//   ops-feed guard (QNFO.OPS.015): ops phrase sent as a chat client must NOT auto-express
//   failures -> qnfo-audit.alerts source='chat-canary' + out-of-band email.
// Self-doc: FLEET-SELF-DOC-1. Canonical: QNFO/qnfo-workers/qnfo-chat-canary.
const VERSION = "1.0.2"; // ops-feed guard probe (QNFO.OPS.015, audit P0-1 2026-09-03)
const ROUTER = "https://qnfo-ai.q08.workers.dev";
const UA = "qnfo-chat-canary/" + VERSION;
// NO personal-inbox email (user directive 2026-09-02): alerts live in qnfo-audit.alerts -> swept into qnfo-events ledger.
const FROM_EMAIL = "alerts@qnfo.org";
const FROM_NAME = "QNFO Ops";

function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

// Route chat probes through the QNFO_AI service binding when present (fleet pattern;
// same-account workers.dev public fetch returns 404 from a Worker). Falls back to global fetch.
async function aiFetch(env, path, init) {
  const target = env.QNFO_AI || { fetch: (u, o) => fetch(u, o) };
  return target.fetch(ROUTER + path, init);
}

async function ensureSchema(env) {
  try {
    await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS chat_canary (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, cron TEXT, probe TEXT, model TEXT, ok INTEGER DEFAULT 0, latency_ms INTEGER DEFAULT 0, detail TEXT)").run();
  } catch (e) {}
}

function isFallback(t) {
  const s = String(t || "");
  return s.indexOf("I could not generate a response") >= 0 || s.indexOf("I do not have a reliable answer for that right now") >= 0;
}

async function chatProbe(env, model, prompt, threadId, uaOverride) {
  const t0 = Date.now();
  const r = await aiFetch(env, "/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.ROUTER_AUTH_KEY, "User-Agent": uaOverride || UA },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], thread_id: threadId, stream: false })
  });
  const j = await r.json().catch(() => ({}));
  const content = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  return { status: r.status, content, model: (j && j.model) || model, latency: Date.now() - t0 };
}

async function record(env, cron, probe, model, ok, detail, latency) {
  try {
    await env.AUDIT.prepare("INSERT INTO chat_canary (ts, cron, probe, model, ok, latency_ms, detail) VALUES (?1,?2,?3,?4,?5,?6,?7)")
      .bind(new Date().toISOString(), cron, probe, String(model || "").slice(0, 60), ok ? 1 : 0, latency || 0, String(detail || "").slice(0, 400)).run();
  } catch (e) {}
}

async function alert(env, level, message) {
  try {
    const dup = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM alerts WHERE source='chat-canary' AND date(created_at)=?1 AND message=?2")
      .bind(new Date().toISOString().slice(0, 10), String(message).slice(0, 200)).first();
    if (dup && dup.n) return;
    await env.AUDIT.prepare("INSERT INTO alerts (source, level, message, created_at) VALUES ('chat-canary',?1,?2,datetime('now'))").bind(level, String(message).slice(0, 400)).run();
    if (env.SEND_EMAIL && env.ALERT_EMAIL_TO) {
      try {
        const r = await env.SEND_EMAIL.send({ to: env.ALERT_EMAIL_TO, from: { email: FROM_EMAIL, name: FROM_NAME }, subject: "QNFO chat-canary " + level, text: String(message).slice(0, 2000) });
        console.log("alert email ok", r && r.messageId || "sent");
      } catch (e) {
        console.log("alert email failed", String((e && e.message) || e));
      }
    }
  } catch (e) {}
}

async function runCanary(env) {
  const out = { version: VERSION, status: "ok", allOk: false, probes: [] };
  await ensureSchema(env);
  const today = new Date().toISOString().slice(0, 10);

  const p1 = await chatProbe(env, "deepseek-v4-flash", "CANARY PROBE: What is today's date (UTC)?", "canary-" + today + "-date");
  const ok1 = p1.status === 200 && p1.content.length > 0 && !isFallback(p1.content) && p1.content.indexOf(today) >= 0;
  await record(env, "canary", "date", p1.model, ok1, ok1 ? "ok" : "status=" + p1.status + " " + p1.content.slice(0, 140), p1.latency);
  if (!ok1) await alert(env, "HIGH", "chat-canary date probe FAILED " + today + ": " + p1.content.slice(0, 200));
  out.probes.push({ probe: "date", ok: ok1, model: p1.model, latency: p1.latency });

  const p2 = await chatProbe(env, "auto", "CANARY PROBE: List every event on the QNFO calendar for the next 21 days, with dates.", "canary-" + today + "-cal");
  const ok2 = p2.status === 200 && p2.content.length > 0 && !isFallback(p2.content);
  await record(env, "canary", "calendar", p2.model, ok2, ok2 ? "ok" : "status=" + p2.status + " " + p2.content.slice(0, 140), p2.latency);
  if (!ok2) await alert(env, "HIGH", "chat-canary calendar probe FAILED " + today + ": " + p2.content.slice(0, 200));
  out.probes.push({ probe: "calendar", ok: ok2, model: p2.model, latency: p2.latency });

  const p3 = await chatProbe(env, "auto", "CANARY PROBE: What is JPCUB?", "canary-" + today + "-jpcub");
  const cl = p3.content.toLowerCase();
  const ok3 = p3.status === 200 && p3.content.length > 0 && !isFallback(p3.content) && (cl.indexOf("joules") >= 0 || cl.indexOf("jpcub") >= 0);
  await record(env, "canary", "jpcub", p3.model, ok3, ok3 ? "ok" : "status=" + p3.status + " " + p3.content.slice(0, 140), p3.latency);
  if (!ok3) await alert(env, "HIGH", "chat-canary JPCUB probe FAILED " + today + ": " + p3.content.slice(0, 200));
  out.probes.push({ probe: "jpcub", ok: ok3, model: p3.model, latency: p3.latency });

  const m = await aiFetch(env, "/v1/models", { headers: { "User-Agent": uaOverride || UA } });
  const mj = await m.json().catch(() => ({}));
  const ids = (mj.data || []).map((x) => x.id);
  const ok4 = m.status === 200 && ids.length > 15 && ids.indexOf("auto") >= 0 && ids.indexOf("ensemble") >= 0;
  await record(env, "canary", "models", "list", ok4, ok4 ? "ok count=" + ids.length : "status=" + m.status + " count=" + ids.length, 0);
  if (!ok4) await alert(env, "HIGH", "chat-canary /v1/models probe FAILED " + today + " count=" + ids.length);
  out.probes.push({ probe: "models", ok: ok4, model: "list", latency: 0 });
  // ops-feed guard probe (QNFO.OPS.015 / audit P0-1 2026-09-03): an ops command sent with a
  // chat-client UA must NOT auto-express into the ideas stream. At most once per UTC day.
  const ranToday = await env.AUDIT.prepare("SELECT COUNT(*) n FROM chat_canary WHERE probe='opsguard' AND ts LIKE ?1").bind(today + "%").first();
  if (!(ranToday && ranToday.n)) {
    const opsPhrase = "check my email and show the last 3 messages";
    const opsThread = "canary-" + today + "-opsguard";
    const p5 = await chatProbe(env, "deepseek-v4-flash", opsPhrase, opsThread, "ChatBox/1.4.0 (dart:io)");
    await new Promise(function (res) { setTimeout(res, 4000); });
    const ie = await env.AUDIT.prepare("SELECT thread_id FROM intent_express_log WHERE thread_id = ?1").bind(opsThread).first();
    const ok5 = p5.status === 200 && !ie;
    await record(env, "canary", "opsguard", p5.model, ok5, ok5 ? "ok (no express row)" : "GUARD REGRESSION: express row " + (ie ? ie.thread_id : "none") + " status=" + p5.status + " " + p5.content.slice(0, 120), p5.latency);
    if (!ok5) {
      try { await env.AUDIT.prepare("DELETE FROM intent_express_log WHERE thread_id = ?1").bind(opsThread).run(); } catch (e2) {}
      try { await env.AUDIT.prepare("DELETE FROM intents WHERE desire LIKE ?1").bind("%" + opsPhrase.slice(0, 60) + "%").run(); } catch (e3) {}
      await alert(env, "HIGH", "OPS-FEED-GUARD REGRESSION: ops command auto-expressed on qnfo-ai " + today + " - research/ideas stream polluted. Check qnfo-ai _opsCmdLike guard.");
    }
    out.probes.push({ probe: "opsguard", ok: ok5, model: p5.model, latency: p5.latency });
  }

  out.allOk = out.probes.every((p) => p.ok);
  out.status = out.allOk ? "clean" : "failures";
  return out;
}

async function runSentGuard(env) {
  const out = { version: VERSION, status: "ok", probe: "sentguard", ok: false };
  await ensureSchema(env);
  try {
    const r = await env.OUTREACH.prepare("SELECT paper_id, status, brief_date, sent_at FROM sent_log ORDER BY sent_at DESC LIMIT 3").all();
    const rows = r.results || [];
    const newest = rows[0];
    if (!newest) {
      await record(env, "sentguard", "brief", "sent_log", false, "no sent_log rows at all", 0);
      await alert(env, "HIGH", "WORKER-SEND-GUARD-1: sent_log has no rows - research-daily-brief pipeline may be down");
      out.status = "failure";
      return out;
    }
    if (newest.paper_id === "__BRIEF__") {
      out.ok = newest.status === "sent";
      out.status = out.ok ? "clean" : "failure";
      await record(env, "sentguard", "brief", "sent_log", out.ok, "brief=" + newest.brief_date + " status=" + newest.status, 0);
      if (!out.ok) await alert(env, "HIGH", "WORKER-SEND-GUARD-1: __BRIEF__ status=" + newest.status + " for " + newest.brief_date + " (sent_at " + newest.sent_at + ")");
      return out;
    }
    if (newest.paper_id === "__DRY__") {
      out.ok = true;
      out.status = "clean";
      out.note = "latest row is dry run " + newest.brief_date;
      await record(env, "sentguard", "brief", "sent_log", true, "dry " + newest.brief_date + " (no send needed)", 0);
      return out;
    }
    out.ok = true;
    out.note = "latest sent_log row is paper send, not brief marker: " + newest.paper_id;
    await record(env, "sentguard", "brief", "sent_log", true, "other row " + newest.paper_id, 0);
    return out;
  } catch (e) {
    out.status = "error";
    out.error = String((e && e.message) || e);
    await record(env, "sentguard", "brief", "sent_log", false, "error " + out.error, 0);
    return out;
  }
}

export default {
  async scheduled(event, env, ctx) {
    const cron = (event && event.cron) || "";
    try {
      if (cron.indexOf("30 6") === 0) { const out = await runSentGuard(env); console.log("sentguard", JSON.stringify(out)); }
      else { const out = await runCanary(env); console.log("canary", JSON.stringify(out)); }
    } catch (e) { console.error("chat-canary", String((e && e.message) || e)); }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true, worker: "qnfo-chat-canary", version: VERSION, bindings: { audit: !!env.AUDIT, outreach: !!env.OUTREACH, sendEmail: !!env.SEND_EMAIL }, crons: ["15 */3 * * *", "30 6 * * *"] });
      if (url.pathname === "/run") {
        const tok = url.searchParams.get("token") || "";
        if (!env.RUN_TOKEN || tok !== env.RUN_TOKEN) return json({ error: "unauthorized" }, 401);
        const cron = url.searchParams.get("cron") || "canary";
        if (cron === "sentguard") return json(await runSentGuard(env));
        return json(await runCanary(env));
      }
      return json({ ok: true, name: "qnfo-chat-canary", endpoints: ["/health", "/run?cron=canary|sentguard&token=.."], crons: ["15 */3 * * *", "30 6 * * *"] });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  }
};
