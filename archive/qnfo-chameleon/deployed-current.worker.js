// qnfo-chameleon v0.1.0-M0 — preference telemetry plane (2026-09-09).
// Build plan: ops-workspace/plans/preference-evolution/2026-09-09-CHAMELEON-build-plan.md
// Canonical source: QNFO/qnfo-workers (dir qnfo-chameleon). Deployed via Cloudflare API.
//
// M0 scope (milestone gate): worker scaffold + D1 pref_* migrations (schema.sql) +
// POST /v1/events behavioral-signal ingest. Render/arm-selection ships at M1/M2; this
// worker returns 501 for /v1/render until then — no dead-end routes.
//
// Bindings (wrangler.toml):
//   PREF  = D1 personal-life (pref_* tables via schema.sql)
//   AUDIT = D1 qnfo-audit (cloud_ops_events log)
// Optional secret: EVENT_TOKEN — when set, POST /v1/events requires
//   Authorization: Bearer <EVENT_TOKEN> (recommended once render consumers attach at M2).

const VERSION = "0.1.0-M0";
const WORKER_NAME = "qnfo-chameleon";
const ACTION_ALLOW = new Set(["view", "scroll", "click", "copy", "save", "reply", "abandon", "open"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}

function cors(req) {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
    },
  });
}

async function audit(env, event, status, notes) {
  try {
    await env.AUDIT.prepare(
      "INSERT INTO cloud_ops_events (event_type, service, status, detail, created_at) VALUES (?1,?2,?3,?4, datetime('now'))"
    ).bind(event, WORKER_NAME, status, JSON.stringify(notes).slice(0, 800)).run();
  } catch (e) { /* audit write is best-effort */ }
}

function ok(t) { return t && t.length > 0; }
function s(v) { return typeof v === "string" ? v.trim() : ""; }
function cap(v, n) { const s2 = s(v); return s2.length > n ? s2.slice(0, n) : s2; }

// ---- POST /v1/events — fire-and-forget signal ingest (idempotent) ----
async function ingest(request, env, ctx) {
  if (env.EVENT_TOKEN) {
    const h = request.headers.get("authorization") || "";
    const want = "Bearer " + env.EVENT_TOKEN;
    if (h !== want) return json({ ok: false, error: "unauthorized" }, 401);
  }
  let p;
  try { p = await request.json(); } catch (e) { return json({ ok: false, error: "bad_json" }, 400); }
  const user_id = cap(p.user_id, 128);
  const session_id = cap(p.session_id, 128);
  const consumer_key = cap(p.consumer_key, 128);
  const action = s(p.action).toLowerCase();
  const variant_id = Number.isInteger(p.variant_id) ? p.variant_id : null;
  const ctx_json = p.ctx && typeof p.ctx === "object" ? JSON.stringify(p.ctx).slice(0, 2000) : null;
  const ts_bucket = s(p.ts_bucket) || new Date().toISOString().slice(0, 15); // minute bucket by default

  if (!user_id || !session_id || !consumer_key) return json({ ok: false, error: "missing user_id/session_id/consumer_key" }, 400);
  if (!ACTION_ALLOW.has(action)) return json({ ok: false, error: "bad action", allowed: [...ACTION_ALLOW] }, 400);

  // Idempotency: identical event (session + variant + action + ts bucket + consumer) already stored?
  try {
    const dup = await env.PREF.prepare(
      "SELECT id FROM pref_signals WHERE session_id=?1 AND consumer_key=?2 AND action=?3 AND ts_bucket=?4 AND (?5 IS NULL OR variant_id=?5) LIMIT 1"
    ).bind(session_id, consumer_key, action, ts_bucket, variant_id).first();
    if (dup) return json({ ok: true, deduped: true, id: dup.id }, 202);
  } catch (e) { /* fall through; insert will surface real errors */ }

  try {
    const res = await env.PREF.prepare(
      "INSERT INTO pref_signals (ts, ts_bucket, user_id, session_id, consumer_key, variant_id, action, ctx_json) VALUES (datetime('now'), ?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    ).bind(ts_bucket, user_id, session_id, consumer_key, variant_id, action, ctx_json).run();
    // touch consumer liveness (upsert)
    await env.PREF.prepare(
      "INSERT INTO pref_consumers (user_id, consumer_key, created_at, last_seen_at) VALUES (?1,?2,datetime('now'),datetime('now')) ON CONFLICT(user_id, consumer_key) DO UPDATE SET last_seen_at=datetime('now')"
    ).bind(user_id, consumer_key).run();
    const id = res.meta.last_row_id;
    ctx.waitUntil(audit(env, "chameleon.signal", "ok", { id, action, consumer_key }));
    return json({ ok: true, id, deduped: false }, 202);
  } catch (e) {
    await audit(env, "chameleon.signal", "error", { error: String(e.message || e) });
    return json({ ok: false, error: "db_error", detail: String(e.message || e) }, 500);
  }
}

// ---- GET /v1/stats — lightweight read-only diagnostics (counts since N hours) ----
async function stats(env, url) {
  const h = Math.min(720, Math.max(1, parseInt(url.searchParams.get("hours") || "24", 10)));
  try {
    const r = await env.PREF.prepare(
      "SELECT COUNT(*) AS n FROM pref_signals WHERE ts >= datetime('now', ?1)"
    ).bind("-" + h + " hours").first();
    const cons = await env.PREF.prepare("SELECT COUNT(*) AS n FROM pref_consumers").first();
    return json({ ok: true, service: WORKER_NAME, version: VERSION, since_h: h, signals_24h: r.n || 0, consumers: cons.n || 0 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(request);
    try {
      if (url.pathname === "/health") {
        return json({ ok: true, service: WORKER_NAME, version: VERSION, ts: new Date().toISOString(), m0: true });
      }
      if (url.pathname === "/v1/events" && request.method === "POST") return ingest(request, env, ctx);
      if (url.pathname === "/v1/stats" && request.method === "GET") return stats(env, url);
      if (url.pathname === "/v1/render") return json({ ok: false, error: "render ships at M1/M2", milestone: "M0" }, 501);
      return json({ ok: false, error: "not_found" }, 404);
    } catch (e) {
      return json({ ok: false, error: "internal", detail: String(e.message || e) }, 500);
    }
  },
  // M0 has no scheduled work; evolver cron (M3) lives in qnfo-chameleon-evolver.
  async scheduled(event, env, ctx) {},
};
