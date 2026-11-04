// INTENTS-QUERY-ALL-1 (agent_issues 1001339) offline suite for qnfo-intent-orchestrator.
// Proves: GET /intents?status=all (what the ops intents_query tool sends for "all") lists the stored intents; a real status still
// filters; no status lists everything; limit is honoured; the route still needs the bearer token.
// Run: node qnfo-intent-orchestrator/intents-status-all.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message || e)); } };
const ok = (c, m) => { if (!c) throw new Error(m || "assertion"); };

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    run: async () => { db.prepare(sql).run(...args); return { success: true }; }
  });
  return { prepare: (sql) => stmt(sql) };
}
function mkEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE intents (id TEXT PRIMARY KEY, desire TEXT, source TEXT, device TEXT, type TEXT, domain TEXT, priority TEXT, summary TEXT, due TEXT, status TEXT, wbs_code TEXT, created_at TEXT, processed_at TEXT)");
  const ins = db.prepare("INSERT INTO intents (id, desire, status, created_at) VALUES (?, ?, ?, ?)");
  ins.run("int-1", "a", "done", "2026-11-01T00:00:01Z");
  ins.run("int-2", "b", "pending", "2026-11-01T00:00:02Z");
  ins.run("int-3", "c", "done", "2026-11-01T00:00:03Z");
  return { INTENT_TOKEN: "tok-test", D1: d1(db) };
}
const get = (env, qs, token = "tok-test") => worker.fetch(new Request("https://x/intents" + qs, { headers: token ? { Authorization: "Bearer " + token } : {} }), env, { waitUntil() {} });

await t("status=all lists every stored intent, newest first", async () => {
  const r = await get(mkEnv(), "?status=all&limit=5");
  const j = await r.json();
  ok(r.status === 200 && j.count === 3, JSON.stringify(j));
  ok(j.intents[0].id === "int-3" && j.intents[2].id === "int-1", "order " + j.intents.map((x) => x.id));
});
await t("status=ALL and status=* are the same no-filter request", async () => {
  for (const s of ["ALL", "*"]) {
    const j = await (await get(mkEnv(), "?status=" + encodeURIComponent(s))).json();
    ok(j.count === 3, s + ": " + JSON.stringify(j));
  }
});
await t("a real status still filters", async () => {
  const j = await (await get(mkEnv(), "?status=pending")).json();
  ok(j.count === 1 && j.intents[0].id === "int-2", JSON.stringify(j));
  const k = await (await get(mkEnv(), "?status=done")).json();
  ok(k.count === 2, JSON.stringify(k));
});
await t("no status lists everything and limit is honoured", async () => {
  const j = await (await get(mkEnv(), "")).json();
  ok(j.count === 3, JSON.stringify(j));
  const k = await (await get(mkEnv(), "?status=all&limit=2")).json();
  ok(k.count === 2, JSON.stringify(k));
});
await t("the route still needs the bearer token", async () => {
  const r = await get(mkEnv(), "?status=all", "");
  ok(r.status === 401, "status " + r.status);
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
