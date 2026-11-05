// BP26-EDGE-TURNSTILE-Q08-1 (agent_issues 1000668): the q08.org subscribe and verdict forms carry the Turnstile widget and their handlers verify the
// token before they act. Fail-open only while TURNSTILE_SECRET is unbound. Run: node q08-signal-engine/turnstile-forms.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.js";

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE published_pieces (id TEXT, slug TEXT, title TEXT, body_md TEXT, core_concept TEXT,
    published_at TEXT, reads INTEGER DEFAULT 0, sources_json TEXT, feedback_score REAL, kind TEXT);
  CREATE TABLE q08_feedback (id INTEGER PRIMARY KEY, slug TEXT, signal TEXT, ip_key TEXT, note TEXT, created_at TEXT);
  CREATE TABLE q08_daily_reads (day TEXT PRIMARY KEY, human INTEGER DEFAULT 0, crawler INTEGER DEFAULT 0);
  CREATE TABLE q08_retractions (slug TEXT);
  CREATE TABLE subscribers (email TEXT PRIMARY KEY, status TEXT, token TEXT, created_at TEXT, confirmed_at TEXT);
  INSERT INTO published_pieces (id, slug, title, body_md, published_at)
    VALUES ('p1', 'piece-one', 'A piece', 'Article body', '2026-11-01T00:00:00Z');
`);
const sent = [];
const baseEnv = {
  DB: { prepare(sql) {
    let args = [];
    const st = {
      bind(...v) { args = v; return st; },
      async run() { return db.prepare(sql).run(...args); },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; }
    };
    return st;
  } },
  SEND_EMAIL: { async send(m) { sent.push(m); } }
};
const ctx = { waitUntil() {} };
const get = (url, headers) => worker.fetch(new Request(url, { headers: { "user-agent": "Mozilla/5.0", ...(headers || {}) } }), baseEnv, ctx);

// ---- the pages carry the widget (what scripts/bp26_web.py TURNSTILE_RX looks for) and load api.js once
{
  const piece = await (await get("https://q08.org/p/piece-one")).text();
  const fb = piece.match(/<form class="q08-fb"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(fb, /class="cf-turnstile"[^>]*data-action="q08_feedback"/, "the verdict form carries the widget");
  assert.match(piece, /<form method="post" action="\/subscribe">[\s\S]*?class="cf-turnstile"[^>]*data-action="q08_subscribe"[\s\S]*?<\/form>/, "the piece page's subscribe form carries the widget");
  assert.equal((piece.match(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/g) || []).length, 1, "api.js is loaded once per page");
  const sub = await (await get("https://q08.org/subscribe")).text();
  assert.match(sub, /class="cf-turnstile"[^>]*data-action="q08_subscribe"/, "the /subscribe page carries the widget in its rewritten form");
  assert.equal((sub.match(/turnstile\/v0\/api\.js/g) || []).length, 1, "api.js is loaded once on /subscribe");
  assert.match(piece, /turnstile\.reset/, "the vote script replaces a spent token after a failed vote");
}

// ---- siteverify stub
const calls = [];
const realFetch = globalThis.fetch;
function siteverify(result) {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://challenges.cloudflare.com/turnstile/v0/siteverify")) {
      calls.push(String(init.body));
      return { ok: true, json: async () => result };
    }
    return realFetch(url, init);
  };
}
const post = (path, fields, env, ip) => worker.fetch(new Request("https://q08.org" + path, {
  method: "POST",
  headers: { "user-agent": "Mozilla/5.0", "cf-connecting-ip": ip || "192.0.2.10", "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields)
}), env, ctx);
const subs = () => db.prepare("SELECT COUNT(*) n FROM subscribers").get().n;
const votes = () => db.prepare("SELECT COUNT(*) n FROM q08_feedback").get().n;

// ---- unbound secret: fail-open, nothing changes for readers (deploy order is safe)
{
  const r = await post("/subscribe", { email: "a@example.com" }, baseEnv);
  assert.equal(r.status, 200, "no TURNSTILE_SECRET: the subscription goes through");
  assert.equal(subs(), 1);
  const v = await post("/api/f?slug=piece-one&s=good", { note: "" }, baseEnv, "192.0.2.11");
  assert.equal(v.status, 200, "no TURNSTILE_SECRET: the vote goes through");
  assert.equal(votes(), 1);
}

// ---- bound secret: fail-closed without a valid token, on every path that stores something
const env = { ...baseEnv, TURNSTILE_SECRET: "test-secret" };
{
  siteverify({ success: true, action: "q08_subscribe" });
  calls.length = 0;
  let r = await post("/subscribe", { email: "b@example.com" }, env);
  assert.equal(r.status, 403, "secret bound, no token: refused");
  assert.match(await r.text(), /Verification failed/, "the refusal is the existing subscribe form with a plain message");
  assert.equal(subs(), 1, "a refused subscription stores nothing");
  assert.equal(sent.filter((m) => m.to === "b@example.com").length, 0, "a refused subscription mails nothing");
  assert.equal(calls.length, 0, "no token: siteverify is not even called");

  r = await post("/subscribe", { email: "b@example.com", "cf-turnstile-response": "tok" }, env);
  assert.equal(r.status, 200, "secret bound, valid token: accepted");
  assert.equal(subs(), 2);
  assert.ok(/secret=test-secret/.test(calls[0]) && /response=tok/.test(calls[0]) && /remoteip=192\.0\.2\.10/.test(calls[0]) , "siteverify gets the secret, the token and the visitor address: " + calls[0]);
  assert.equal(sent.filter((m) => m.to === "b@example.com").length, 1);

  siteverify({ success: true, action: "q08_feedback" });
  r = await worker.fetch(new Request("https://q08.org/subscribe?email=c%40example.com", { headers: { "user-agent": "Mozilla/5.0" } }), env, ctx);
  assert.equal(r.status, 403, "the GET that carries an address subscribes too, so it is refused without a token");
  assert.equal(subs(), 2);

  siteverify({ success: true, action: "q08_feedback" });
  r = await post("/subscribe", { email: "d@example.com", "cf-turnstile-response": "tok" }, env);
  assert.equal(r.status, 403, "a token minted for the vote form does not open the subscribe form");
  assert.equal(subs(), 2);

  siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
  r = await post("/subscribe", { email: "d@example.com", "cf-turnstile-response": "tok" }, env);
  assert.equal(r.status, 403, "a replayed or expired token is refused");

  // an invalid address is answered as before, without spending a token
  siteverify({ success: true, action: "q08_subscribe" });
  calls.length = 0;
  r = await post("/subscribe", { email: "not-an-email", "cf-turnstile-response": "tok" }, env);
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0, "an invalid address does not spend a token");

  // the verdict form
  siteverify({ success: true, action: "q08_feedback" });
  const before = votes();
  let v = await post("/api/f?slug=piece-one&s=flat", { note: "n" }, env, "192.0.2.12");
  assert.equal(v.status, 403, "secret bound, no token: the vote is refused");
  assert.equal((await v.json()).ok, false);
  assert.equal(votes(), before, "a refused vote stores nothing");
  v = await post("/api/f?slug=piece-one&s=flat", { note: "n", "cf-turnstile-response": "tok" }, env, "192.0.2.12");
  assert.equal(v.status, 200, "secret bound, valid token: the vote is stored");
  assert.equal(votes(), before + 1);
  calls.length = 0;
  v = await post("/api/f?slug=piece-one&s=no", { note: "n", "cf-turnstile-response": "tok2" }, env, "192.0.2.12");
  assert.equal((await v.json()).updated, false, "an address that already voted is told so");
  assert.equal(calls.length, 0, "and spends no token");
  siteverify({ success: true, action: "q08_subscribe" });
  v = await post("/api/f?slug=piece-one&s=good", { note: "n", "cf-turnstile-response": "tok" }, env, "192.0.2.13");
  assert.equal(v.status, 403, "a token minted for the subscribe form does not open the vote form");
}
globalThis.fetch = realFetch;

// ---- /health says whether the forms are enforcing, never the secret itself (the closing probe of the enforcement step reads this)
{
  const h0 = await (await get("https://q08.org/health")).json();
  assert.equal(h0.turnstile, "widget-only", "secret unbound: widget only");
  const h1 = await (await worker.fetch(new Request("https://q08.org/health?bound=1"), { ...baseEnv, TURNSTILE_SECRET: "test-secret" }, ctx)).json();
  assert.equal(h1.turnstile, "enforcing", "secret bound: enforcing");
  assert.ok(!JSON.stringify(h1).includes("test-secret"), "the secret is never echoed");
  assert.ok(h1.domains && h1.domains.tech === true, "the enabled policy and science domains are shown");
}
console.log("turnstile-forms.test.mjs ok");
