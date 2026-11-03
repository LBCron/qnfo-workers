// SUBSCRIBE-CONFIRM-POST-1 (#1904) and SUBSCRIBE-SEND-LOG-1 (#1905) offline test.
// (1) GET /confirm?token=<valid> leaves a pending row pending and returns a page with one button that POSTs the token;
//     the POST sets the row to subscribed. (2) Every send writes one cloud_ops_events row with the domain, never the
//     address; digest sends carry List-Unsubscribe + List-Unsubscribe-Post, and a header refusal falls back to a plain send.
// Run: node qnfo-subscribers/confirm-post.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x).slice(0, 400) : "")); } };

const TOKEN = "abc123def456";
function makeEnv(opts) {
  opts = opts || {};
  const row = { email: "reader@example.edu", status: "pending", unsub_token: TOKEN, confirmed_at: null };
  const events = [];
  const sends = [];
  const db = {
    prepare(sql) {
      let args = [];
      const s = {
        bind(...a) { args = a; return s; },
        async first() {
          if (/FROM subscribers WHERE unsub_token/.test(sql)) return args[0] === row.unsub_token ? { email: row.email, status: row.status } : null;
          return null;
        },
        async all() {
          if (/FROM papers/.test(sql)) return { results: [{ slug: "p-1", title: "A paper", created_at: "2026-10-04 10:00:00", doi: "10.5281/x.1" }] };
          if (/FROM subscribers WHERE status='subscribed'/.test(sql)) return { results: row.status === "subscribed" ? [{ email: row.email, unsub_token: row.unsub_token }] : [] };
          return { results: [] };
        },
        async run() {
          if (/UPDATE subscribers SET status='subscribed'/.test(sql) && args[0] === row.unsub_token) { row.status = "subscribed"; row.confirmed_at = "now"; return { meta: { changes: 1 } }; }
          if (/INSERT INTO cloud_ops_events/.test(sql)) { events.push({ id: args[0], kind: args[2], text: args[3], meta: JSON.parse(args[4]), status: args[5] }); return { meta: { changes: 1 } }; }
          return { meta: { changes: 0 } };
        }
      };
      return s;
    }
  };
  const SEND_EMAIL = {
    async send(m) {
      if (opts.refuseHeaders && m.headers) throw new Error("E_HEADER_NOT_ALLOWED: Header 'List-Unsubscribe' is not allowed");
      if (opts.failSend) throw new Error("E_DELIVERY_FAILED");
      sends.push(m);
      return { messageId: "msg-" + sends.length };
    }
  };
  return { env: { AUDIT: db, LIVING: db, SEND_EMAIL }, row, events, sends };
}
const ctx = { waitUntil() {} };
const call = (env, path, init) => worker.fetch(new Request("https://qnfo-subscribers.q08.workers.dev" + path, init), env, ctx);

// (1) GET does not confirm; it shows the button page.
{
  const t = makeEnv();
  const r = await call(t.env, "/confirm?token=" + TOKEN, { method: "GET" });
  const h = await r.text();
  ok(r.status === 200, "GET valid token answers 200", r.status);
  ok(t.row.status === "pending" && t.row.confirmed_at === null, "GET leaves the pending row pending", t.row);
  ok(/<form method="post" action="https:\/\/qnfo-subscribers\.q08\.workers\.dev\/confirm\?token=abc123def456">/.test(h), "the page's form POSTs to this worker with the token", h.slice(0, 600));
  ok((h.match(/<button[^>]*type="submit"/g) || []).length === 1 && /Confirm subscription/.test(h), "one Confirm subscription button");
  ok(/<input type="hidden" name="token" value="abc123def456">/.test(h), "token travels in the form body too");
  const fleet = (h.match(/<a id="fleet-ctl" href="([^"]+)"/) || [])[1] || "";
  ok(fleet && !fleet.includes(TOKEN), "the fleet link never carries the token", fleet);
  const ev = t.events.find((e) => e.kind === "subscribers-confirm");
  ok(ev && ev.status === "page" && ev.meta.changed === 0 && ev.meta.method === "GET", "GET records a confirm-page event with changed 0", t.events);
  ok(!JSON.stringify(t.events).includes("reader@"), "no address in the event log", t.events);
}
// HEAD (some scanners) never confirms either.
{
  const t = makeEnv();
  await call(t.env, "/confirm?token=" + TOKEN, { method: "HEAD" });
  ok(t.row.status === "pending", "HEAD leaves the row pending", t.row);
}
// POST confirms: token in the query string (the form's action) ...
{
  const t = makeEnv();
  const r = await call(t.env, "/confirm?token=" + TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" + TOKEN });
  const h = await r.text();
  ok(r.status === 200 && /Subscription confirmed/.test(h), "POST answers the confirmed page", h.slice(0, 300));
  ok(t.row.status === "subscribed" && t.row.confirmed_at, "POST sets the row to subscribed", t.row);
  const ev = t.events.find((e) => e.kind === "subscribers-confirm");
  ok(ev && ev.status === "confirmed" && ev.meta.changed === 1 && ev.meta.method === "POST", "POST records a confirmed event", t.events);
}
// ... or only in the form body.
{
  const t = makeEnv();
  await call(t.env, "/confirm", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=" + TOKEN });
  ok(t.row.status === "subscribed", "POST with the token only in the form body confirms", t.row);
}
// Unknown token: 404 on GET and POST, nothing changes.
{
  const t = makeEnv();
  const a = await call(t.env, "/confirm?token=nope", { method: "GET" });
  const b = await call(t.env, "/confirm?token=nope", { method: "POST" });
  ok(a.status === 404 && b.status === 404 && t.row.status === "pending", "unknown token is refused on GET and POST", [a.status, b.status, t.row.status]);
}
// A GET on an already-confirmed row still says so.
{
  const t = makeEnv();
  t.row.status = "subscribed";
  const h = await (await call(t.env, "/confirm?token=" + TOKEN, { method: "GET" })).text();
  ok(/Already confirmed/.test(h), "already-subscribed page unchanged");
}
// (2) Subscribe send is logged with the messageId and the domain only.
{
  const t = makeEnv();
  const r = await call(t.env, "/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "new.reader@example.org" }) });
  const j = await r.json();
  ok(j.ok && j.confirmation_sent, "subscribe sends the confirmation", j);
  ok(t.sends.length === 1 && !t.sends[0].headers, "the confirmation mail carries no list headers", t.sends);
  ok(t.sends[0] && t.sends[0].text.includes("/api/confirm?token="), "the emailed confirm link is unchanged");
  ok(t.sends[0] && t.sends[0].text.includes("Browse the corpus: https://qnfo.org/papers?utm_source=confirm&utm_medium=email&utm_campaign=corpus"), "DIGEST-LINKS-UTM-1: the corpus link in the confirmation mail is tagged (source confirm)", t.sends[0] && t.sends[0].text);
  ok(t.sends[0] && !/api\/confirm\?token=[^\s]*utm_/.test(t.sends[0].text), "the confirm link itself stays untagged");
  const ev = t.events.find((e) => e.kind === "subscribers-send");
  ok(ev && ev.status === "ok" && ev.meta.kind === "confirm" && ev.meta.messageId === "msg-1" && ev.meta.domain === "example.org", "confirm send logged ok with messageId and domain", t.events);
  ok(!JSON.stringify(t.events).includes("new.reader"), "the address is never written", t.events);
}
// A failed send is logged as an error.
{
  const t = makeEnv({ failSend: true });
  await call(t.env, "/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@example.net" }) });
  const ev = t.events.find((e) => e.kind === "subscribers-send");
  ok(ev && ev.status === "error" && /E_DELIVERY_FAILED/.test(ev.meta.error) && ev.meta.domain === "example.net", "failed send logged as error", t.events);
}
// Digest: List-Unsubscribe headers on every digest mail, logged as kind digest.
{
  const t2 = makeEnv();
  t2.row.status = "subscribed";
  let done;
  await worker.scheduled({}, t2.env, { waitUntil: (p) => { done = p; } });
  await done;
  ok(t2.sends.length === 1, "digest sent to the one confirmed subscriber", t2.sends.length);
  const h = t2.sends[0] && t2.sends[0].headers || {};
  ok(h["List-Unsubscribe"] === "<https://qnfo.org/api/unsubscribe?token=" + TOKEN + ">", "List-Unsubscribe carries the https unsubscribe URL", h);
  ok(h["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "List-Unsubscribe-Post is one-click", h);
  const ev = t2.events.find((e) => e.kind === "subscribers-send");
  ok(ev && ev.status === "ok" && ev.meta.kind === "digest" && ev.meta.list_unsubscribe === true && ev.meta.messageId, "digest send logged with list_unsubscribe true", t2.events);
  const dtext = t2.sends[0] && t2.sends[0].text || "";
  ok(dtext.includes("\n   https://qnfo.org/papers/p-1?utm_source=digest&utm_medium=email&utm_campaign=p-1\n"), "DIGEST-LINKS-UTM-1: every paper link in the digest carries utm_source=digest, utm_medium=email and the slug as campaign", dtext);
  ok(dtext.includes("Know someone who should read this? Forward this issue, or send them here:\nhttps://qnfo.org/?utm_source=digest&utm_campaign=digest-forward\n\nUnsubscribe: https://qnfo.org/api/unsubscribe?token=" + TOKEN + "\n"), "the digest forward link uses the tagged qnfo.org landing page immediately before the unchanged unsubscribe link", dtext);
  ok(!/utm_[a-z]+=[^&\s]*(token|reader|example)/.test(dtext) && /Unsubscribe: https:\/\/qnfo\.org\/api\/unsubscribe\?token=abc123def456\n/.test(dtext), "the tags never carry the recipient and the unsubscribe link stays untagged", dtext);
}
// Digest: a binding that refuses the headers still delivers, without them, and says so.
{
  const t = makeEnv({ refuseHeaders: true });
  t.row.status = "subscribed";
  let done;
  await worker.scheduled({}, t.env, { waitUntil: (p) => { done = p; } });
  await done;
  ok(t.sends.length === 1 && !t.sends[0].headers, "header refusal falls back to a plain send", t.sends);
  const ev = t.events.find((e) => e.kind === "subscribers-send");
  ok(ev && ev.status === "ok" && ev.meta.list_unsubscribe === false && /E_HEADER/.test(ev.meta.headers_refused || ""), "fallback recorded as headers_refused", t.events);
}
// The one-click POST (RFC 8058) unsubscribes.
{
  const t = makeEnv();
  let unsub = false;
  t.env.AUDIT = { prepare(sql) { const s = { bind() { return s; }, async run() { if (/status='unsubscribed'/.test(sql)) unsub = true; return { meta: { changes: 1 } }; }, async first() { return null; } }; return s; } };
  const r = await call(t.env, "/unsubscribe?token=" + TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  ok(r.status === 200 && unsub, "one-click POST unsubscribes", r.status);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
