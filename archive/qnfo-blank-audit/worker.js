// qnfo-blank-audit v1.0.0
// Purpose: daily audit of blank/fallback gateway responses (qnfo-ai ai_queries log in qnfo-audit D1)
// Capabilities: scheduled daily 04:40 UTC (Cron Trigger); /health; /run manual trigger
// Deploy: Cloudflare API PUT module + bindings (canonical source: QNFO/qnfo-workers repo, qnfo-blank-audit/ dir)
// Self-doc: FLEET-SELF-DOC-1. Alert row: qnfo-audit.alerts source='blank-audit' (schema: source/level/message/created_at).

const VERSION = "1.1.0"; // QNFO.OPS.011D: exclude internal model='web-search' rows (by-design blank RAG helper traffic distorted metrics, G4 47/2d); detect old+new fallback phrasings
// NO personal-inbox email (user directive 2026-09-02): blank-audit findings live in qnfo-audit.alerts (swept into qnfo-events ledger).
const FROM_EMAIL = "alerts@qnfo.org";
const FROM_NAME = "QNFO Ops";

function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

async function run(env) {
  const out = { version: VERSION, status: "ok", total_24h: 0, blank: 0, junk: 0, fallback: 0, hits: 0, alertInserted: false, email: null, emailError: null, error: null };
  if (!env.AUDIT) { out.status = "error"; out.error = "AUDIT D1 binding missing"; return out; }
  try {
    const q = await env.AUDIT.prepare(
      "SELECT COUNT(*) AS total_24h, " +
      "COALESCE(SUM(CASE WHEN response IS NULL OR TRIM(response)='' THEN 1 ELSE 0 END),0) AS blank, " +
      "COALESCE(SUM(CASE WHEN response IS NOT NULL AND LENGTH(TRIM(response)) BETWEEN 1 AND 7 THEN 1 ELSE 0 END),0) AS junk, " +
      "COALESCE(SUM(CASE WHEN response LIKE '%fallback%' OR response LIKE '%could not generate%' OR response LIKE '%do not have a reliable answer%' THEN 1 ELSE 0 END),0) AS fallback " +
      "FROM ai_queries WHERE ts > datetime('now','-1 day') AND model != 'web-search'"
    ).first();
    const row = q || {};
    out.total_24h = row.total_24h || 0;
    out.blank = row.blank || 0;
    out.junk = row.junk || 0;
    out.fallback = row.fallback || 0;
    out.hits = out.blank + out.junk + out.fallback;

    const today = new Date().toISOString().slice(0, 10);
    const dup = await env.AUDIT.prepare("SELECT COUNT(*) AS n FROM alerts WHERE source='blank-audit' AND date(created_at)=?1").bind(today).first();
    if ((dup && dup.n) > 0) { out.status = "skipped"; out.note = "alert row already exists for " + today; return out; }
    if (out.hits === 0) { out.status = "clean"; return out; }

    const msg = out.hits + " blank/fallback gateway responses in last 24h (" + out.blank + " blank, " + out.junk + " junk<8ch, " + out.fallback + " fallback-marked of " + out.total_24h + " total)";
    await env.AUDIT.prepare("INSERT INTO alerts (source, level, message, created_at) VALUES ('blank-audit','warning',?1,datetime('now'))").bind(msg).run();
    out.alertInserted = true;

    if (env.SEND_EMAIL && env.ALERT_EMAIL_TO) {
      try {
        const r = await env.SEND_EMAIL.send({ to: env.ALERT_EMAIL_TO, from: { email: FROM_EMAIL, name: FROM_NAME }, subject: "QNFO gateway blank/fallback daily report", text: msg });
        out.email = "sent:" + (r && r.messageId ? String(r.messageId).slice(0, 20) : "ok");
      } catch (e) {
        out.emailError = String((e && e.message) || e);
        await env.AUDIT.prepare("INSERT INTO alerts (source, level, message, created_at) VALUES ('blank-audit','error',?1,datetime('now'))").bind("blank-audit email send failed: " + out.emailError).run();
      }
    } else {
      out.email = "skipped: SEND_EMAIL binding missing";
    }
  } catch (e) {
    out.status = "error";
    out.error = String((e && e.stack) || e);
  }
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    try { const out = await run(env); console.log("blank-audit", JSON.stringify(out)); }
    catch (e) { console.error("blank-audit", String((e && e.message) || e)); }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true, worker: "qnfo-blank-audit", version: VERSION, bindings: { audit: !!env.AUDIT, sendEmail: !!env.SEND_EMAIL } });
      if (url.pathname === "/run") return json(await run(env));
      return json({ ok: true, name: "qnfo-blank-audit", endpoints: ["/health", "/run"] });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  }
};
