// D1-LOCK-OVERLOAD-1 offline suite (qnfo-deploy-guard 1.4.7; GitHub 6456 and 6731, agent_issues 1001280 and 1001391).
// qnfo-audit refuses statements for seconds at a time while the fleet tick runs ("D1 DB is overloaded. Too many resources consumed within a 10 second
// window"). The lock routes answered the first refusal with HTTP 500 (acquire, release) or 503 (GET /work-locks): 180 and 45 such responses since 2026-10-22.
// Proves: a refusal of the lock INSERT or DELETE that clears within the retry window is absorbed (the call succeeds); one that does not clear is a 503 with
// acquired:false / released:false and Retry-After, never a 500; a refusal that is not an overload is not retried; the open read retries and then answers 503 with Retry-After (never a
// false list); a route that throws answers a JSON body, 503 for a database refusal and 500 with the route for anything else.
// Run: node qnfo-deploy-guard/d1-overload-resilience.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
const realError = console.error;
const logged = [];
console.error = (...a) => { logged.push(a.join(" ")); };

let T = 1_790_000_000_000;
Date.now = () => T;

const OVERLOAD = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window: SQLITE_ERROR";

function mk() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE deploy_locks (worker TEXT PRIMARY KEY, token_hash TEXT NOT NULL, owner TEXT, actor TEXT, session_id TEXT, since TEXT NOT NULL, expires_at INTEGER NOT NULL, expected_version TEXT, released_at TEXT, released_by TEXT);
  CREATE TABLE service_registry (service TEXT PRIMARY KEY, version TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);`);
  const fault = { match: null, left: 0, msg: OVERLOAD, hits: 0 };
  const maybe = (sql) => { if (fault.match && fault.left > 0 && fault.match(sql)) { fault.left--; fault.hits++; throw new Error(fault.msg); } };
  const prep = (sql) => { let a = []; const q = { bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return q; }, async all() { maybe(sql); return { results: db.prepare(sql).all(...a) }; }, async run() { maybe(sql); const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; }, async first() { maybe(sql); return db.prepare(sql).get(...a) || null; } }; return q; };
  const kv = new Map();
  const kvFault = { err: null };
  const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { if (kvFault.err) throw new Error(kvFault.err); kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list(o) { const p = (o && o.prefix) || ""; return { keys: [...kv.keys()].filter((k) => k.startsWith(p)).map((name) => ({ name })) }; } };
  return { env: { AUDIT: { prepare: prep }, FLEET_CONFIG: KV }, db, fault, kvFault };
}
const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); }, passThroughOnException() {} };
const O = "https://qnfo-deploy-guard.q08.workers.dev";
const call = (env, path, init) => worker.fetch(new Request(O + path, init), env, ctx);
const post = async (env, path, body) => { const r = await call(env, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* the assertions below report a non-JSON body */ } return { status: r.status, j, t, retryAfter: r.headers.get("retry-after") }; };
const get = async (env, path) => { const r = await call(env, path); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* reported by the assertions */ } return { status: r.status, j, t, retryAfter: r.headers.get("retry-after") }; };

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; realError("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
const isLockInsert = (sql) => sql.startsWith("INSERT INTO deploy_locks");
const isLockDelete = (sql) => sql.startsWith("DELETE FROM deploy_locks WHERE worker=?1 AND token_hash");
const isWorkListRead = (sql) => sql.includes("substr(worker,1,5)='work:'");

// A. a refusal that clears inside the retry window is absorbed
{
  const { env, fault } = mk();
  fault.match = isLockInsert; fault.left = 1;
  const t0 = Date.now();
  const r = await post(env, "/work-lock/acquire", { key: "file:qnfo-ai/worker.js", owner: "session-A", ttl_sec: 600 });
  ok(r.status === 200 && r.j && r.j.acquired === true && typeof r.j.token === "string", "A1 one overload refusal of the lock INSERT is retried and the claim is granted", r);
  ok(fault.hits === 1, "A2 the INSERT was refused exactly once", fault.hits);
  const rel = await post(env, "/work-lock/release", { key: "file:qnfo-ai/worker.js", token: r.j.token });
  ok(rel.status === 200 && rel.j.released === true, "A3 the holder releases it afterwards", rel);
  fault.match = isLockDelete; fault.left = 0;
  const b = await post(env, "/work-lock/acquire", { key: "file:qnfo-ai/worker.js", owner: "session-A", ttl_sec: 600 });
  fault.left = 3; fault.hits = 0;
  const rel2 = await post(env, "/work-lock/release", { key: "file:qnfo-ai/worker.js", token: b.j.token });
  ok(rel2.status === 200 && rel2.j.released === true && fault.hits === 3, "A4 three overload refusals of the release DELETE are absorbed by the three retries", { rel2, hits: fault.hits });
}

// B. a refusal that does not clear is a 503 with Retry-After, never a 500
{
  const { env, fault } = mk();
  fault.match = isLockInsert; fault.left = 99;
  const r = await post(env, "/work-lock/acquire", { key: "file:qnfo-ai/worker.js", owner: "session-A", ttl_sec: 600 });
  ok(r.status === 503, "B1 a lasting refusal of the lock INSERT answers 503, not 500", r.status);
  ok(r.j && r.j.acquired === false && r.j.reason === "lock_db_unavailable" && r.j.retry_after_sec === 5, "B2 the body says acquired:false, why, and when to ask again", r.j);
  ok(r.retryAfter === "5", "B3 the Retry-After header is set", r.retryAfter);
  ok(fault.hits === 4, "B4 one attempt and three retries, no more (a retry storm would add to the overload)", fault.hits);
  ok(!("token" in (r.j || {})), "B5 no token is issued");

  const { env: env2, fault: f2 } = mk();
  const g = await post(env2, "/work-lock/acquire", { key: "file:qnfo-ai/worker.js", owner: "session-A", ttl_sec: 600 });
  f2.match = isLockDelete; f2.left = 99;
  const rel = await post(env2, "/work-lock/release", { key: "file:qnfo-ai/worker.js", token: g.j.token });
  ok(rel.status === 503 && rel.j && rel.j.released === false && rel.j.reason === "lock_db_unavailable" && rel.retryAfter === "5", "B6 a lasting refusal of the release DELETE answers 503 with released:false and Retry-After", rel);
}

// C. an error that is not an overload is not retried
{
  const { env, fault } = mk();
  fault.match = isLockInsert; fault.left = 99; fault.msg = "D1_ERROR: no such table: deploy_locks: SQLITE_ERROR";
  const r = await post(env, "/work-lock/acquire", { key: "file:qnfo-ai/worker.js", owner: "session-A", ttl_sec: 600 });
  ok(fault.hits === 1, "C1 a schema error is raised once and not retried", fault.hits);
  ok(r.status === 503 && r.j && r.j.acquired === false, "C2 and still answers a structured 503", r);
}

// D. the open read retries a refusal three times, and a lasting refusal is a 503 with Retry-After, never a false list (work-lock.test.mjs E1 keeps the contract)
{
  const { env, fault } = mk();
  await post(env, "/work-lock/acquire", { key: "file:qnfo-ai/worker.js", owner: "session-A", ttl_sec: 3600 });
  fault.match = isWorkListRead; fault.left = 3; fault.hits = 0;
  const absorbed = await get(env, "/work-locks");
  ok(absorbed.status === 200 && absorbed.j.count === 1 && fault.hits === 3 && absorbed.j.claims[0].holder === "session-A", "D1 three overload refusals of the read are absorbed and the live list is returned", { s: absorbed.status, hits: fault.hits });
  fault.left = 99; fault.hits = 0;
  const lasting = await get(env, "/work-locks");
  ok(lasting.status === 503 && lasting.j.error === "lock_db_unavailable" && lasting.retryAfter === "5" && !("claims" in lasting.j), "D2 a lasting refusal is a 503 with Retry-After and no list", lasting);
  ok(fault.hits === 4, "D3 one attempt and three retries", fault.hits);
  fault.left = 0;
  const live = await get(env, "/work-locks");
  ok(live.status === 200 && live.j.count === 1 && !/token/i.test(live.t), "D4 the next read is live again and shows no token", live.j);
}

// E. a route that throws answers a JSON body, and names the route
{
  const { env, kvFault } = mk();
  kvFault.err = "boom: KV unavailable";
  const before = logged.length;
  const r = await post(env, "/thresholds", { day_usd: 5, month_usd: 50 });
  ok(r.status === 500 && r.j && r.j.error === "internal" && r.j.path === "/thresholds", "E1 an unexpected exception answers a JSON 500 that names the route", r);
  ok(logged.slice(before).some((l) => l.includes("deploy-guard:fetch:caught") && l.includes("/thresholds")), "E2 and is logged with the route");
  kvFault.err = OVERLOAD;
  const r2 = await post(env, "/thresholds", { day_usd: 5, month_usd: 50 });
  ok(r2.status === 503 && r2.j && r2.j.error === "lock_db_unavailable" && r2.retryAfter === "5", "E3 an exception that is a database refusal answers 503 with Retry-After", r2);
  kvFault.err = null;
  const r3 = await post(env, "/thresholds", { day_usd: 5, month_usd: 50 });
  ok(r3.status === 200 && r3.j.set === true, "E4 the same route works when nothing throws", r3);
}

console.error = realError;
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
