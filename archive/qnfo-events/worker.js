// qnfo-events v1.0.0 - central issue/event ledger for the QNFO fleet.
// Replaces email as the primary repeat/issue channel: alerts/errors/warnings are
// ingested here (dedupe by fingerprint, repeat-count, status lifecycle) and are
// queryable by API. Autonomous sweep mirrors qnfo-audit.alerts and
// qnfo-audit.cloud_ops_events so alerts that previously fired email are tracked.
// Canonical source: QNFO/qnfo-workers/qnfo-events (FLEET-SELF-DOC-1)
var VERSION = "1.1.0";
var SELF = { purpose: "central issue/event ledger + fleet sweep" };
function json(o, st) { return new Response(JSON.stringify(o), { status: st || 200, headers: { "Content-Type": "application/json" } }); }
function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function fingerprint(ev) { return (ev.fingerprint && String(ev.fingerprint).trim()) || hash(norm(ev.source) + "|" + norm(ev.category) + "|" + norm(ev.title)); }
async function ensureSchema(env) {
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS issue_ledger (fingerprint TEXT PRIMARY KEY, source TEXT, level TEXT, category TEXT, title TEXT, status TEXT DEFAULT 'open', first_seen TEXT, last_seen TEXT, occurrences INTEGER DEFAULT 1, last_detail TEXT, updated_at TEXT)").run();
  await env.AUDIT.prepare("CREATE TABLE IF NOT EXISTS issue_events (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT, source TEXT, level TEXT, category TEXT, title TEXT, detail TEXT, ts TEXT)").run();
  await env.AUDIT.prepare("CREATE INDEX IF NOT EXISTS idx_issue_ledger_status ON issue_ledger(status)").run();
}
function okAuth(req, env) {
  const t = env.EVENTS_TOKEN || "";
  if (!t) return true;
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  const a = h.slice(7), b = t;
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function ingest(env, ev) {
  await ensureSchema(env);
  const fp = fingerprint(ev);
  const now = new Date().toISOString();
  const level = String(ev.level || "info").toLowerCase();
  const source = String(ev.source || "unknown").slice(0, 80);
  const category = String(ev.category || "general").slice(0, 60);
  const title = String(ev.title || "").slice(0, 300);
  const detail = String(ev.detail || "").slice(0, 4000);
  const ts = String(ev.ts || now).slice(0, 40);
  const exist = await env.AUDIT.prepare("SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1").bind(fp).first();
  let created = false;
  if (!exist) {
    created = true;
    await env.AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1,?2,?3,?4,?5,'open',?6,?6,1,?7,?6)").bind(fp, source, level, category, title, ts, detail).run();
  } else {
    await env.AUDIT.prepare("UPDATE issue_ledger SET occurrences = occurrences + 1, last_seen = ?1, last_detail = ?2, updated_at = ?1 WHERE fingerprint = ?3").bind(ts, detail, fp).run();
  }
  await env.AUDIT.prepare("INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(fp, source, level, category, title, detail, ts).run();
  const row = await env.AUDIT.prepare("SELECT fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences FROM issue_ledger WHERE fingerprint=?1").bind(fp).first();
  return { created: created, issue: row };
}
async function setStatus(env, fp, status, note) {
  await ensureSchema(env);
  const row = await env.AUDIT.prepare("SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1").bind(fp).first();
  if (!row) return { error: "not found" };
  await env.AUDIT.prepare("UPDATE issue_ledger SET status=?1, last_detail=COALESCE(?2,last_detail), updated_at=?3 WHERE fingerprint=?4").bind(status, String(note || "").slice(0, 1000) || null, new Date().toISOString(), fp).run();
  return { ok: true };
}
async function sweep(env) {
  await ensureSchema(env);
  let alertsN = 0, coeN = 0;
  try {
    const alerts = await env.AUDIT.prepare("SELECT id, source, level, message, created_at FROM alerts WHERE created_at > datetime('now','-2 day') ORDER BY id ASC").all();
    for (const a of alerts.results || []) {
      const key = "src:alert:" + a.id;
      const seen = await env.AUDIT.prepare("SELECT id FROM issue_events WHERE detail=?1 LIMIT 1").bind(key).first();
      if (seen) { continue; }
      const fp = "alert:" + hash(norm(a.source || "unknown") + "|" + norm(a.message || "").slice(0, 180));
      const lvl = a.level === "HIGH" ? "high" : String(a.level || "warning").toLowerCase();
      const now = new Date().toISOString();
      const ex = await env.AUDIT.prepare("SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1").bind(fp).first();
      if (!ex) {
        await env.AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1,?2,?3,'alert','AUTO-SWEEP: ' || substr(?4,1,220),'open',?5,?5,1,?4,?5)").bind(fp, String(a.source || "unknown").slice(0, 80), lvl, String(a.message || ""), now).run();
      } else {
        await env.AUDIT.prepare("UPDATE issue_ledger SET occurrences=occurrences+1, last_seen=?1, last_detail=?2, updated_at=?1 WHERE fingerprint=?3").bind(now, String(a.message || "").slice(0, 1000), fp).run();
      }
      await env.AUDIT.prepare("INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?1,?2,?3,'alert','AUTO-SWEEP',?4,?5)").bind(fp, String(a.source || "unknown").slice(0, 80), lvl, key, now).run();
      alertsN++;
    }
  } catch (e) { alertsN = -1; }
  try {
    const coe = await env.AUDIT.prepare("SELECT id, kind, text, job, status, ts FROM cloud_ops_events WHERE ts > datetime('now','-2 day') AND status IN ('error','partial','failed') ORDER BY ts ASC").all();
    for (const c of coe.results || []) {
      const key = "src:coe:" + c.id;
      const seen = await env.AUDIT.prepare("SELECT id FROM issue_events WHERE detail=?1 LIMIT 1").bind(key).first();
      if (seen) { continue; }
      const fp = "coe:" + hash(norm(c.job || c.kind || "unknown") + "|" + norm(c.text || "").slice(0, 180));
      const now = new Date().toISOString();
      const ex = await env.AUDIT.prepare("SELECT fingerprint FROM issue_ledger WHERE fingerprint=?1").bind(fp).first();
      if (!ex) {
        await env.AUDIT.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, last_detail, updated_at) VALUES (?1,?2,'error','cloud-ops','AUTO-SWEEP: ' || substr(?3,1,220),'open',?4,?4,1,?3,?4)").bind(fp, String(c.job || c.kind || "unknown").slice(0, 80), String(c.text || ""), now).run();
      } else {
        await env.AUDIT.prepare("UPDATE issue_ledger SET occurrences=occurrences+1, last_seen=?1, last_detail=?2, updated_at=?1 WHERE fingerprint=?3").bind(now, String(c.text || "").slice(0, 1000), fp).run();
      }
      await env.AUDIT.prepare("INSERT INTO issue_events (fingerprint, source, level, category, title, detail, ts) VALUES (?1,?2,'error','cloud-ops','AUTO-SWEEP',?3,?4)").bind(fp, String(c.job || c.kind || "unknown").slice(0, 80), key, now).run();
      coeN++;
    }
  } catch (e) { coeN = -1; }
  return { alertsN: alertsN, coeN: coeN };
}
async function review(env) {
  await ensureSchema(env);
  const now = new Date().toISOString();
  const out = { reviewed: 0, autoResolved: 0, escalated: 0, staleResolved: 0 };
  try {
    const open = await env.AUDIT.prepare("SELECT fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences FROM issue_ledger WHERE status IN ('open','acknowledged') ORDER BY last_seen ASC").all();
    const rows = open.results || [];
    out.reviewed = rows.length;
    const ago = (iso, hours) => { try { return (Date.now() - new Date(iso).getTime()) > hours * 3600e3; } catch (e) { return false; } };
    for (const it of rows) {
      const fp = it.fingerprint;
      const occ = it.occurrences || 1;
      const source = String(it.source || "");
      if (occ >= 3 && (it.level === "high" || it.level === "error")) {
        const dup = await env.AUDIT.prepare("SELECT id FROM agent_issues WHERE title = ?1").bind(String(it.title || "").slice(0,180)).first();
        if (!dup) {
          await env.AUDIT.prepare("INSERT INTO agent_issues (priority, status, title, description, created_at, updated_at) VALUES ('high','open',?1,?2,?3,?3)").bind(String(it.title || "").slice(0,180), ("AUTO-ESCALATION from qnfo-events review " + now + " - repeated occurrence " + occ + "x, source " + source + ". Fix at the mechanism, not the symptom (RECURRENCE-ZERO-1).").slice(0,500), Date.now()).run();
          out.escalated++;
        }
      } else if (it.status === "acknowledged" && ago(it.last_seen, 24) && occ <= 2) {
        await env.AUDIT.prepare("UPDATE issue_ledger SET status='resolved', resolved_at=?1, last_detail='auto-resolved by review loop (stale acknowledged)', updated_at=?1 WHERE fingerprint=?2").bind(now, fp).run();
        out.staleResolved++;
      } else if (ago(it.last_seen, 72) && occ <= 2 && (it.level === "info" || it.level === "warning")) {
        await env.AUDIT.prepare("UPDATE issue_ledger SET status='resolved', resolved_at=?1, last_detail='auto-resolved by review loop (stale, no repeat)', updated_at=?1 WHERE fingerprint=?2").bind(now, fp).run();
        out.staleResolved++;
      }
    }
  } catch (e) {
    out.error = String(e && e.message || e).slice(0,300);
  }
  try {
    await env.AUDIT.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES (?1,?2,'review',?3,'qnfo-events','ok')").bind("review-" + Date.now().toString(36), now, JSON.stringify(out).slice(0,600)).run();
  } catch (e) { out.auditErr = String(e && e.message || e).slice(0,120); }
  return out;
}
async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;
  if (path === "/health" && m === "GET") {
    return json({ ok: true, worker: "qnfo-events", version: VERSION, self: SELF, audit: !!env.AUDIT, token: !!env.EVENTS_TOKEN });
  }
  if (!okAuth(req, env)) return json({ error: "unauthorized" }, 401);
  if (path === "/v1/events" && m === "POST") {
    let ev = {}; try { ev = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }
    return json(await ingest(env, ev));
  }
  if (path === "/v1/issues" && m === "GET") {
    await ensureSchema(env);
    const status = url.searchParams.get("status");
    const source = url.searchParams.get("source");
    const level = url.searchParams.get("level");
    let sql = "SELECT fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences FROM issue_ledger WHERE 1=1";
    const binds = [];
    if (status) { sql += " AND status=?"; binds.push(status); }
    if (source) { sql += " AND source=?"; binds.push(source); }
    if (level) { sql += " AND level=?"; binds.push(level); }
    sql += " ORDER BY last_seen DESC LIMIT 100";
    const res = binds.length ? await env.AUDIT.prepare(sql).bind(...binds).all() : await env.AUDIT.prepare(sql).all();
    return json({ issues: res.results || [], count: (res.results || []).length });
  }
  if (path.startsWith("/v1/issues/") && m === "POST") {
    const rest = path.slice("/v1/issues/".length).split("/");
    if (rest.length !== 2) return json({ error: "expected /v1/issues/:fp/:action" }, 400);
    const fp = decodeURIComponent(rest[0]);
    const action = rest[1];
    if (!["resolve", "acknowledge", "mute", "reopen"].includes(action)) return json({ error: "action must be resolve|acknowledge|mute|reopen" }, 400);
    const body = await req.json().catch(() => ({}));
    const statusMap = { resolve: "resolved", acknowledge: "acknowledged", mute: "muted", reopen: "open" };
    return json(await setStatus(env, fp, statusMap[action], body.note || ""));
  }
  if (path === "/v1/sync" && m === "POST") return json(await sweep(env));
  if (path === "/v1/review" && m === "POST") return json(await review(env));
  if (path === "/") return json({ ok: true, name: "qnfo-events", version: VERSION, endpoints: ["/v1/events POST", "/v1/issues GET", "/v1/issues/:fp/:action POST", "/v1/sync POST", "/health"] });
  return json({ error: "not found" }, 404);
}
export default {
  async scheduled(event, env, ctx) {
    try { const r = await sweep(env); console.log("qnfo-events sweep", JSON.stringify(r)); }
    catch (e) { console.error("qnfo-events sweep failed", String(e && e.message || e)); }
  },
  async fetch(request, env) { return handle(request, env).catch((e) => json({ error: String(e && e.message || e) }, 500)); }
};
