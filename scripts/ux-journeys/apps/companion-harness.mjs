// scripts/ux-journeys/apps/companion-harness.mjs (UX-JOURNEYS-1): serves the REAL companion (personal-api/companion.js: the page, the
// service worker and every /companion/api route) on 127.0.0.1 with an in-memory D1 (node:sqlite), so a headless phone can walk the
// signed-in journeys with no live data, no key and no model call. Only the outside world is faked: the sign-in e-mail (the code is kept
// here so the journey can read it, as the owner reads their inbox), Whisper (a fixed sentence), the chat model (a fixed reply) and the
// calendar. Seeded with a few next actions so Today and Do look like a real day. Never deployed; used by scripts/ux-journeys/run.mjs.
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import * as C from "../../../personal-api/companion.js";

function d1(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x)); return api; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async first(col) { const row = db.prepare(sql).get(...args) ?? null; return row && col ? row[col] : row; },
        async raw() { return db.prepare(sql).all(...args).map((r) => Object.values(r)); }
      };
      return api;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    async exec(sql) { db.exec(sql); return { count: 1 }; }
  };
}
function memR2() {
  const m = new Map();
  return {
    async put(k, v, o) { m.set(k, { v: typeof v === "string" ? v : new Uint8Array(await new Response(v).arrayBuffer()), o }); },
    async get(k) { const x = m.get(k); return x ? { body: x.v, httpMetadata: x.o && x.o.httpMetadata, arrayBuffer: async () => x.v } : null; },
    async delete(k) { for (const x of [].concat(k)) m.delete(x); },
    async list({ prefix } = {}) { return { objects: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((k) => ({ key: k, size: 1 })), truncated: false }; }
  };
}

export const DICTATED = "remember to call the dentist tomorrow";
export const CHAT_REPLY = "That sounds like a good plan. One small step: put the dentist's number on your phone now.";

export async function startCompanion({ port = 0 } = {}) {
  const raw = new DatabaseSync(":memory:");
  const mail = [];
  const env = {
    PERSONAL: d1(raw), MEDIA: memR2(), LOGIN_SALT: "harness",
    VZ: { async upsert() {}, async query() { return { matches: [] }; }, async deleteByIds() {} },
    AI: { async run(model) { if (/whisper/i.test(model)) return { text: DICTATED }; return { response: CHAT_REPLY }; } },
    SEND_EMAIL: { async send(msg) { mail.push(msg); } }
  };
  const deps = {
    version: "harness",
    auth: async (r) => r.headers.get("Authorization") === "Bearer harness",
    doStub: () => ({ fetch: async () => new Response("{}") }),
    embed: async (e, t) => t.map(() => new Array(768).fill(0.01)),
    llm: async () => null,
    vision: async () => ({ ok: true, text: "A photo" }),
    weather: async () => ({ ok: true, location: "Amsterdam", weather: "12C, light rain" }),
    calendar: async () => [],
    chat: async () => Response.json({ choices: [{ message: { role: "assistant", content: CHAT_REPLY } }] })
  };
  await C.ensureSchema(env.PERSONAL, true);
  const call = (path, init = {}) => C.handleCompanion(new Request("https://me.q08.org" + path, init), env, { waitUntil() {} }, deps);
  const post = (path, json) => call(path, { method: "POST", headers: { Authorization: "Bearer harness", "Content-Type": "application/json" }, body: JSON.stringify(json) });
  // A real-looking day: three next actions of different sizes.
  for (const a of [{ title: "Call the dentist", context: "@phone", energy: "low", minutes: 5 }, { title: "Tidy the desk", context: "@home", energy: "low", minutes: 15 },
    { title: "Read one chapter", context: "@anywhere", energy: "medium", minutes: 30 }]) await post("/companion/api/actions", a);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/__harness/last-code") {
        const m = mail.length ? /Your code is (\d{6})/.exec(mail[mail.length - 1].text || "") : null;
        res.writeHead(m ? 200 : 404, { "Content-Type": "text/plain" }); res.end(m ? m[1] : ""); return;
      }
      if (url.pathname === "/__harness/session") {
        // A phone that is already signed in (the owner's real state): a session row as verifyLoginCode writes it, without the e-mail round trip.
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
        raw.prepare("INSERT INTO cmp_sessions (token_hash, created_ms, expires_ms, last_seen_ms, device) VALUES (?, ?, ?, ?, 'harness')").run(hash, Date.now(), Date.now() + C.SESSION_MS, Date.now());
        res.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": C.SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax" }); res.end("ok"); return;
      }
      const path = url.pathname === "/" ? "/companion" : url.pathname === "/guide" ? "/companion/guide" : url.pathname;
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const r = await call(path + url.search, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer());
      const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(r.status, h); res.end(out);
    } catch (e) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("harness: " + (e && e.stack || e)); }
  });
  await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  return { base, raw, mail, close: () => new Promise((ok) => server.close(ok)) };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const h = await startCompanion({ port: Number(process.argv[2]) || 8787 });
  console.log("companion harness on " + h.base);
}
