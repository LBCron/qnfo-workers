// THREAD-HISTORY-1 offline suite (qnfo-ai 5.41.0): GET /v1/conversations, /v1/conversations/:id and /threads read the chat log
// chatbox_conversations; a key is required, a thread of another worker is not served, LIKE wildcards in ?q= are literal.
// Run: node qnfo-ai/conversations.test.mjs -> prints "N passed, 0 failed".
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "qnfo-ai-conv-"));
writeFileSync(join(dir, "worker.mjs"), readFileSync(new URL("./worker.js", import.meta.url), "utf8"));
const worker = (await import(pathToFileURL(join(dir, "worker.mjs")).href)).default;
const say = console.log.bind(console);
console.log = () => {};
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; say("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
globalThis.fetch = async () => new Response("blocked in test", { status: 599 });

function d1(db) {
  return { prepare(sql) { let a = []; const q = { bind(...x) { a = x; return q; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async first() { return db.prepare(sql).get(...a) || null; }, async run() { db.prepare(sql).run(...a); return { meta: { changes: 1 } }; } }; return q; } };
}
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE chatbox_conversations (id TEXT PRIMARY KEY, thread_id TEXT, source TEXT, worker TEXT, model TEXT, messages_json TEXT, prompt TEXT, response TEXT, ts TEXT, ua TEXT)");
const ins = db.prepare("INSERT INTO chatbox_conversations (id, thread_id, source, worker, model, prompt, response, ts) VALUES (?,?,?,?,?,?,?,?)");
ins.run("1", "t1", "chatbox", "qnfo-ai", "glm-5.3-flash", "first idea about 100% coverage", "answer one", "2026-11-01T10:00:00Z");
ins.run("2", "t1", "chatbox", "qnfo-ai", "ensemble", "follow up", "answer two", "2026-11-01T10:05:00Z");
ins.run("3", "t2", "other", "qnfo-ai", "kimi-k2.7-code", "refactor the router", "done", "2026-11-03T09:00:00Z");
ins.run("4", "t3", "other", "personal-api", "personal", "private thing", "secret", "2026-11-04T09:00:00Z");
const env = { ROUTER_AUTH_KEY: "key-one", QNFO_AUDIT: d1(db), AI: { async run() { return { data: [[0.1]] }; } } };
async function req(path, headers) {
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const res = await worker.fetch(new Request("https://ai.qnfo.org" + path, { method: "GET", headers: headers || {} }), env, ctx);
  const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch (e) { }
  return { res, text, j };
}
const K = { Authorization: "Bearer key-one" };

let r = await req("/v1/conversations", {});
ok(r.res.status === 401, "A1 list without key is 401", r.res.status);
r = await req("/v1/conversations/t1", {});
ok(r.res.status === 401, "A2 thread without key is 401");
r = await req("/v1/conversations", K);
ok(r.res.status === 200 && r.j.count === 2, "B1 list has the two qnfo-ai threads", r.j);
ok(r.j && r.j.threads[0].thread_id === "t2" && r.j.threads[1].thread_id === "t1", "B2 newest thread first", r.j);
ok(r.j && r.j.threads[1].turns === 2 && r.j.threads[1].title.startsWith("first idea"), "B3 turns and title of t1", r.j);
ok(r.j && !r.j.threads.some((t) => t.thread_id === "t3"), "B4 another worker's thread is not listed");
r = await req("/v1/conversations?q=router", K);
ok(r.j && r.j.count === 1 && r.j.threads[0].thread_id === "t2", "C1 text filter", r.j);
r = await req("/v1/conversations?q=" + encodeURIComponent("%"), K);
ok(r.j && r.j.count === 1 && r.j.threads[0].thread_id === "t1", "C2 percent sign is literal (only t1 says 100%)", r.j);
r = await req("/v1/conversations?q=" + encodeURIComponent("_"), K);
ok(r.j && r.j.count === 0, "C3 underscore is literal", r.j);
r = await req("/v1/conversations/t1", K);
ok(r.res.status === 200 && r.j.count === 2 && r.j.turns[0].prompt.startsWith("first idea") && r.j.turns[1].response === "answer two", "D1 full thread in order", r.j);
r = await req("/v1/conversations/t3", K);
ok(r.res.status === 404, "D2 another worker's thread is 404", r.res.status);
r = await req("/v1/conversations/nope", K);
ok(r.res.status === 404, "D3 unknown thread is 404");
r = await req("/history", {});
ok(r.res.status === 200 && r.text.includes("Chat history") && !r.text.includes("answer one"), "E1 page serves without data");
say(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
