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
export const STREAM_REPLY = "Two pull requests are open and both are safe to merge.";

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
    CREATE TABLE product_registry (product TEXT PRIMARY KEY, host TEXT, worker TEXT, program_code TEXT, what_for TEXT, plus_cadence_h INTEGER, last_plus_at TEXT, rest_until TEXT, misses_in_row INTEGER DEFAULT 0, pluses_since_simplify INTEGER DEFAULT 0, state TEXT DEFAULT 'active', usage_metric TEXT, usage_value INTEGER, usage_window TEXT, usage_errors INTEGER, usage_read_at TEXT, usage_source TEXT);
    CREATE TABLE plus_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, product TEXT, kind TEXT, title TEXT, status TEXT, decided_at TEXT, issue_id INTEGER, pr_url TEXT, outcome TEXT);
    CREATE TABLE plus_digest (day TEXT PRIMARY KEY, products INTEGER, in_flight INTEGER, decided_7d INTEGER, deployed_7d INTEGER, reverted_7d INTEGER, body_md TEXT, created_at TEXT);
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
  raw.prepare("INSERT INTO product_registry (product,host,worker,program_code,what_for,plus_cadence_h,last_plus_at,usage_metric,usage_value,usage_window,usage_errors) VALUES ('jobs','jobs.q08.org','qnfo-jobsearch','QNFO.PERSONAL','live job matcher',24,?,'worker_requests_7d',6126,'7d',0),('shorts-channel','youtube','qnfo-youtube-shorts','QNFO.REACH','plain-language Shorts',24,NULL,'youtube_views_total',NULL,'lifetime',NULL)").run(iso(86400e3));
  raw.prepare("INSERT INTO plus_ledger (product,kind,title,status,decided_at) VALUES ('jobs','plus','Show the reason on every match','deployed',?)").run(iso(86400e3).slice(0, 19).replace('T', ' '));
  raw.prepare("INSERT INTO plus_digest VALUES (?,2,0,1,1,0,'What got better in the last 7 days: - jobs: Show the reason on every match [deployed]',?)").run(iso(0).slice(0, 10), iso(0));

  // The harness reaches nothing outside itself: a call to the loopback goes through, any other host answers 503 (the dashboard degrades each
  // section on its own, as it does when a source is down). Restored by close().
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const u = typeof input === "string" ? input : (input && input.url) || String(input);
    return /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u) ? realFetch(input, init) : Promise.resolve(new Response("{}", { status: 503 }));
  };
  const env = {
    AUDIT: d1(raw), LOOP_TOKEN: "harness-loop-token", OWNER_TOKEN, AI: {},
    // RM-CMD-FAILURES-1: qnfo-agents' CodeSession as the /cmd page meets it: POST /code-sessions starts a turn, /events replays it as server-sent events, GET /code-sessions/<id> is its status.
    SVC_QNFO_AGENTS: { async fetch(u, init) {
      const method = (init && init.method) || "GET";
      if (/\/events\?/.test(String(u))) {
        const sse = (id, type, data) => "id: " + id + "\nevent: " + type + "\ndata: " + JSON.stringify(data) + "\n\n";
        return new Response(sse(1, "status", { status: "running", turn: 1 }) + sse(2, "tool", { turn: 1, phase: "call", name: "ops_fleet_status", input: "{}" }) + sse(3, "text", { turn: 1, delta: STREAM_REPLY.slice(0, 12) }) + sse(4, "text", { turn: 1, delta: STREAM_REPLY.slice(12) }) +
          sse(5, "complete", { turn: 1, answer: STREAM_REPLY, model: "deepseek-v4-flash-wa", input_tokens: 120, output_tokens: 14, cost_usd: 0.0004 }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (method === "POST") return new Response(JSON.stringify({ ok: true, session_id: "run_harness000001", turn: 1, status: "queued" }), { status: 202 });
      return new Response(JSON.stringify({ ok: true, session: { id: "run_harness000001", status: "done", turns: [{ turn: 1, status: "done", answer: STREAM_REPLY, model: "deepseek-v4-flash-wa" }] } }), { status: 200 });
    } },
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
