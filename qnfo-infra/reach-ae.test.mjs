// REACH-AE-1 offline suite (qnfo-infra 1.12.0; agent_issues 1000699, GitHub #5727). No network: the Analytics Engine SQL API is a stub fetch, qnfo-audit is a node:sqlite database
// with the live layout of reach_signals (its CHECK and primary key) and infra_state. Proves: the two queries read the qnfo_reach dataset with the event schema the gateway writes;
// the day-level rows (host, referrer with direct and internal, page) are summed and bad groups dropped; the upsert is idempotent and keeps the table's CHECK (quality unknown);
// an empty dataset (the state before the first gateway write) is a clean zero, an API refusal is recorded in infra_state and never thrown; the dead recordReach stub is gone and
// runScheduled calls the read-back every fire.
// Run: node --no-warnings qnfo-infra/reach-ae.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("// ---- REACH-AE-1:BEGIN"), b = src.indexOf("// ---- REACH-AE-1:END");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };
ok(a > 0 && b > a, "the read-back block is found between its markers");
ok(!/recordReach\(|function recordReach|const binding = env\.REACH\b/.test(src), "the dead recordReach stub (env.REACH.put) is gone");
const sched = src.slice(src.indexOf("async function runScheduled"));
ok(/collectReachAe\(env\)/.test(sched.slice(0, 3000)), "runScheduled calls collectReachAe on every fire");
ok(/var VERSION = "1\.(1[2-9]|[2-9]\d)\./.test(src), "VERSION is at least 1.12");
ok(!/\*\//.test(src.slice(a, b)), "no comment terminator inside the block");

const sandbox = { fetchImpl: null, calls: [] };
const make = new Function("sandbox", "infraSecret", "VERSION", "fetch", src.slice(a, b) + "\nreturn { REACH_AE_HOST_SQL, REACH_AE_PAGE_SQL, REACH_AE_UPSERT, reachAeSql, reachAeRows, collectReachAe };");
const secret = async (env, k, legacy) => env[legacy];
const L = make(sandbox, secret, "1.12.0-test", (url, init) => { sandbox.calls.push({ url, init }); return sandbox.fetchImpl(url, init); });

// ---- 1. the queries
for (const [name, sql] of [["host", L.REACH_AE_HOST_SQL], ["page", L.REACH_AE_PAGE_SQL]]) {
  ok(/FROM qnfo_reach WHERE blob1 = 'reach' AND timestamp > NOW\(\) - INTERVAL '2' DAY GROUP BY day, host, /.test(sql) && /sum\(_sample_interval \* double1\)/.test(sql) && /LIMIT \d+$/.test(sql), name + " query reads the qnfo_reach event rows, sample-interval weighted, grouped by day, bounded", sql);
}
ok(/blob2 AS host, blob4 AS ref/.test(L.REACH_AE_HOST_SQL) && /blob2 AS host, blob3 AS path/.test(L.REACH_AE_PAGE_SQL), "the blob positions are the gateway's: blob2 host, blob3 path, blob4 referrer host");

// ---- 2. the rows
const rows = L.reachAeRows([
  { day: "2026-11-04", host: "papers.qnfo.org", ref: "", loads: 10 },
  { day: "2026-11-04", host: "papers.qnfo.org", ref: "self", loads: 30 },
  { day: "2026-11-04", host: "papers.qnfo.org", ref: "news.ycombinator.com", loads: 4.5 },
  { day: "2026-11-04", host: "qnfo.org", ref: "News.YCombinator.com", loads: 1.25 },
  { day: "2026-11-03", host: "qnfo.org", ref: "google.com", loads: 7 },
  { day: "", host: "qnfo.org", ref: "x", loads: 5 },            // no day: dropped
  { day: "2026-11-04", host: "", ref: "y", loads: 5 },           // no host: no host row, referrer row kept
  { day: "2026-11-04", host: "qnfo.org", ref: "z", loads: 0 },   // zero: dropped
  { day: "2026-11-04", host: "qnfo.org", ref: "w", loads: "NaN" }], // not a number: dropped
[
  { day: "2026-11-04", host: "papers.qnfo.org", path: "/papers/alpha", loads: 12 },
  { day: "2026-11-04", host: "qnfo.org", path: "/", loads: 3 },
  { day: "2026-11-04", host: "qnfo.org", path: "/", loads: 2 }]);
const get = (d, t, id) => (rows.find((r) => r[0] === d && r[1] === t && r[2] === id) || [])[3];
ok(get("2026-11-04", "host", "papers.qnfo.org") === 44.5 && get("2026-11-04", "host", "qnfo.org") === 1.25, "host rows sum every referrer of the host", rows);
ok(get("2026-11-04", "referrer", "direct") === 10 && get("2026-11-04", "referrer", "internal") === 30, "a missing referrer is direct and a fleet host is internal, kept apart from outside referrers");
ok(get("2026-11-04", "referrer", "news.ycombinator.com") === 5.75 && get("2026-11-03", "referrer", "google.com") === 7, "an outside referrer is summed across hosts and lower-cased, per day");
ok(get("2026-11-04", "page", "papers.qnfo.org/papers/alpha") === 12 && get("2026-11-04", "page", "qnfo.org/") === 5, "page ids are host plus path and repeated groups are summed");
ok(!rows.some((r) => r[2] === "x" || r[2] === "z" || r[2] === "w") && !rows.some((r) => r[1] === "host" && r[2] === ""), "groups without a day, a positive number or a host are dropped");
ok(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && ["host", "referrer", "page"].includes(r[1]) && Number.isFinite(r[3])), "every row has an ISO day, a known entity type and a finite value");
ok(L.reachAeRows(null, undefined).length === 0, "null answers give no rows");

// ---- 3. collect: real SQLite with the live table definition
const mkdb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT CHECK (quality IN ('human','bot','unknown')), collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));CREATE TABLE infra_state (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, data TEXT)");
  const wrap = (stmt) => ({ bind: (...v) => ({ run: async () => stmt.run(...v), stmt, v }) });
  return { db, AUDIT: { prepare: (s) => { const st = db.prepare(s.replace(/\?(\d+)/g, "?$1")); return { bind: (...v) => ({ run: async () => st.run(...v), v, st }) }; }, batch: async (list) => { db.exec("BEGIN"); try { for (const x of list) x.st.run(...x.v); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; } } };
};
const answer = (data) => new Response(JSON.stringify({ meta: [], data, rows: data.length }), { status: 200, headers: { "Content-Type": "application/json" } });
const hostAns = [{ day: "2026-11-04", host: "papers.qnfo.org", ref: "", loads: "10" }, { day: "2026-11-04", host: "papers.qnfo.org", ref: "t.co", loads: "5" }];
const pageAns = [{ day: "2026-11-04", host: "papers.qnfo.org", path: "/papers/alpha", loads: "15" }];
let env = Object.assign(mkdb(), { CF_TOKEN: "tok", CF_ACCOUNT: "acc123" });
sandbox.fetchImpl = async (url, init) => answer(/blob3 AS path/.test(init.body) ? pageAns : hostAns);
let res = await L.collectReachAe(env);
ok(res.rows === 4 && res.loads === 15, "two groups of one host make 4 rows (host, 2 referrers, 1 page) and 15 loads", res);
const call = sandbox.calls[0];
ok(call.url === "https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql" && call.init.method === "POST" && call.init.headers.Authorization === "Bearer tok" && sandbox.calls.length === 2, "two POSTs to the account's Analytics Engine SQL endpoint with the bearer token", sandbox.calls.map((c) => c.url));
let all = env.db.prepare("SELECT * FROM reach_signals ORDER BY entity_type, entity_id").all();
ok(all.length === 4 && all.every((r) => r.source === "reach-ae" && r.channel === "web" && r.metric === "pageloads" && r.quality === "unknown" && r.collected_at), "rows land in reach_signals as source reach-ae, channel web, metric pageloads, quality unknown", all[0]);
const st = JSON.parse(env.db.prepare("SELECT data FROM infra_state WHERE id = 'reach_ae'").get().data);
ok(st.rows === 4 && st.loads === 15 && st.version === "1.12.0-test" && !st.error, "infra_state reach_ae records the run", st);

// idempotent upsert: a second run with higher counts updates the same keys
hostAns[0].loads = "12";
res = await L.collectReachAe(env);
all = env.db.prepare("SELECT * FROM reach_signals").all();
ok(all.length === 4 && env.db.prepare("SELECT value FROM reach_signals WHERE entity_type = 'referrer' AND entity_id = 'direct'").get().value === 12, "a second run updates the same primary keys and adds no rows", all.length);

// ---- 4. the state before the first gateway write: the dataset is empty
env = Object.assign(mkdb(), { CF_TOKEN: "tok", CF_ACCOUNT: "acc123" });
sandbox.fetchImpl = async () => answer([]);
res = await L.collectReachAe(env);
ok(res.rows === 0 && env.db.prepare("SELECT COUNT(*) n FROM reach_signals").get().n === 0 && JSON.parse(env.db.prepare("SELECT data FROM infra_state WHERE id = 'reach_ae'").get().data).rows === 0, "an empty dataset is a clean zero with a state row and no reach_signals rows", res);

// ---- 5. refusals are recorded, never thrown
env = Object.assign(mkdb(), { CF_TOKEN: "tok", CF_ACCOUNT: "acc123" });
sandbox.fetchImpl = async () => new Response('{"errors":[{"code":10000,"message":"Authentication error"}]}', { status: 403 });
res = await L.collectReachAe(env);
const es = JSON.parse(env.db.prepare("SELECT data FROM infra_state WHERE id = 'reach_ae'").get().data);
ok(/HTTP 403/.test(res.error || "") && /HTTP 403.*Authentication error/.test(es.error) && env.db.prepare("SELECT COUNT(*) n FROM reach_signals").get().n === 0, "a 403 is returned and recorded with its text, and writes no reach rows", [res, es]);
env = Object.assign(mkdb(), { CF_ACCOUNT: "acc123" });
res = await L.collectReachAe(env);
ok(/CF_TOKEN or CF_ACCOUNT/.test(res.error || ""), "a missing token is reported, not thrown", res);
res = await L.collectReachAe({});
ok(res.skipped === "no AUDIT", "no AUDIT binding skips", res);

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
