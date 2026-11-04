// scripts/ux-journeys/apps/fleet-harness.mjs (UX-JOURNEYS-1): serves the REAL fleet dashboard (qnfo-fleet-dashboard/worker.js: the three-screen
// home page and every /api/v3 route) on 127.0.0.1 with an in-memory D1 (node:sqlite), so a headless phone can walk the signed-in journeys with
// no live data, no key and no model call. Only the outside world is faked: the ops executor (a fixed run with one step and a reply), the
// sign-in e-mail round trip (a session cookie is issued by /__harness/session, as a signed-in owner's phone has one) and Cloudflare Turnstile
// (the widget script is dropped from the page, as the harness reaches nothing outside itself). Seeded with two owner cards and a few
// heartbeats so the Now screen looks like a real day. Never deployed; used by scripts/ux-journeys/run.mjs.
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import worker from "../../../qnfo-fleet-dashboard/worker.js";

function d1(db) {
  return {
    prepare(sql) {
      let st = null, err = null;
      try { st = db.prepare(sql); } catch (e) { err = e; }
      let args = [];
      const fail = async () => { throw err; };
      const api = {
        bind(...a) { args = a.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x)); return api; },
        async run() { if (err) return fail(); const r = st.run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
        async all() { if (err) return fail(); return { results: st.all(...args) }; },
        async first(col) { if (err) return fail(); const row = st.get(...args) ?? null; return row && col ? row[col] : row; },
        async raw() { if (err) return fail(); return st.all(...args).map((r) => Object.values(r)); }
      };
      return api;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    async exec(sql) { db.exec(sql); return { count: 1 }; }
  };
}

export const OWNER_TOKEN = "harness-owner-token-".repeat(4);
export const RUN_REPLY = "Fleet is healthy: 3 workers listed.";

export async function startFleet({ port = 0 } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT, due TEXT, status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), source TEXT, resolution TEXT, updated_at TEXT, resolved_at TEXT);
    CREATE TABLE fleet_heartbeat (worker TEXT, version TEXT, ts TEXT, ok INTEGER);
    CREATE TABLE v_fleet_metrics (metric TEXT, breach INTEGER);
    CREATE TABLE intents (id TEXT PRIMARY KEY, desire TEXT, source TEXT, device TEXT, type TEXT, domain TEXT, priority TEXT, summary TEXT, due TEXT, status TEXT, wbs_code TEXT, created_at TEXT, processed_at TEXT, triage_decision TEXT);
    CREATE TABLE cmd_log (id TEXT, text TEXT, kind TEXT, status TEXT, answer TEXT, error TEXT, owner INTEGER, model TEXT, ts TEXT DEFAULT (datetime('now')), done_ms INTEGER, from_url TEXT, visitor TEXT, actions_json TEXT);
    CREATE TABLE deployment_history (id INTEGER PRIMARY KEY, deployed_at TEXT);
    CREATE TABLE code_tasks (id TEXT, status TEXT, updated_at TEXT, created_at TEXT);
    CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY, issue_id INTEGER, event TEXT, ts TEXT);
    CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, kind TEXT);
  `);
  const now = new Date();
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  raw.prepare("INSERT INTO human_actions (slug,title,why) VALUES ('renew-domain','Approve the annual domain renewal','IDENTITY-BOUND: money')").run();
  raw.prepare("INSERT INTO human_actions (slug,title,why) VALUES ('search-console','Add the fleet Google account to Search Console','IDENTITY-BOUND: your own account')").run();
  raw.prepare("INSERT INTO fleet_heartbeat VALUES ('qnfo-a','1',?,1),('qnfo-b','1',?,1),('qnfo-c','1',?,1)").run(iso(60e3), iso(120e3), iso(180e3));
  raw.prepare("INSERT INTO v_fleet_metrics VALUES ('m1',0),('m2',0)").run();
  raw.prepare("INSERT INTO deployment_history (deployed_at) VALUES (?)").run(iso(3600e3));
  raw.prepare("INSERT INTO code_tasks VALUES ('t1','merged',?,?)").run(iso(3600e3), iso(7200e3));
  raw.prepare("INSERT INTO issue_lifecycle (issue_id,event,ts) VALUES (1,'opened',?),(2,'dispositioned',?)").run(iso(1800e3), iso(1800e3));
  raw.prepare("INSERT INTO metric_registry VALUES ('open_agent_issues','120',?,'x'),('referral_30d','610',?,'x'),('publications_30d','262',?,'x')").run(iso(60e3), iso(60e3), iso(60e3));

  // The harness reaches nothing outside itself: a call to the loopback goes through, any other host answers 503 (the dashboard degrades each
  // section on its own, as it does when a source is down). Restored by close().
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const u = typeof input === "string" ? input : (input && input.url) || String(input);
    return /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) ? realFetch(input, init) : Promise.resolve(new Response("{}", { status: 503 }));
  };
  const env = {
    AUDIT: d1(raw), LOOP_TOKEN: "harness-loop-token", OWNER_TOKEN, AI: {},
    SVC_QNFO_OPS: { async fetch(u, init) {
      const b = init && init.body ? JSON.parse(init.body) : {};
      if (b.op === "start") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (b.op === "result") return new Response(JSON.stringify({ run: { status: "done", steps: [{ tool: "fleet_status", args: "", ms: 40 }], reply: RUN_REPLY } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    } }
  };
  const ownerCookie = "fleet_owner=" + createHash("sha256").update(OWNER_TOKEN).digest("hex");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/__harness/session") {
        res.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": ownerCookie + "; Path=/; SameSite=Lax" }); res.end("ok"); return;
      }
      if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const r = await worker.fetch(new Request("https://fleet.qnfo.org" + url.pathname + url.search, { method: req.method, headers, body }), env, { waitUntil() {}, passThroughOnException() {} });
      let out = Buffer.from(await r.arrayBuffer());
      const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
      if (/text\/html/.test(h["content-type"] || "")) {
        // The harness reaches nothing outside itself: drop the Cloudflare Turnstile widget and its script.
        out = Buffer.from(out.toString("utf8").replace(/<script src="https:\/\/challenges\.cloudflare\.com[^>]*><\/script>/g, "").replace(/<div class="cf-turnstile"[^>]*><\/div>/g, ""));
        delete h["content-length"];
      }
      res.writeHead(r.status, h); res.end(out);
    } catch (e) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("harness: " + (e && e.stack || e)); }
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  return { base, raw, close: () => { globalThis.fetch = realFetch; return new Promise((ok) => { server.close(ok); server.closeAllConnections && server.closeAllConnections(); }); } };
}
