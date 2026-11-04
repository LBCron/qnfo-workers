// Q08-REVIEW-2026-10-31 offline suite (agent_issues 1716). Replays the review block from worker.js, with the reach helpers
// it reuses (reachRumQuery, reachGf, reachRumGroups), against an in-memory SQLite D1 and a stubbed CF GraphQL, and the
// cadence-cap reader from q08-signal-engine/worker.js. Proves: the pure tally, decision and cap rules; nothing runs before
// 2026-10-31T00:00Z; a failed or empty RUM read is 'deferred' in cloud_ops_events, writes no ops_config row (so the
// remediation probe stays failing) and is retried only after an hour; a real decision writes the probe key with the
// measurement, window, source and decision, and under 50 a week the cap q08-signal-engine reads becomes 2 in the same
// batch; a lower cap is never raised; a decision is never re-run; the watchmaker stuck query counts a review 48h overdue.
// Run: node qnfo-fleet-dashboard/q08-review.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const q08src = readFileSync(join(here, "..", "q08-signal-engine", "worker.js"), "utf8");

function fnSrc(text, name) {
  const m = new RegExp("\\n(async )?function " + name + "\\(").exec(text);
  if (!m) throw new Error("function " + name + " not found");
  const end = text.indexOf("\n}\n", m.index + 1);
  return text.slice(m.index + 1, end + 2);
}
function varSrc(text, name) {
  const m = new RegExp("\\nvar " + name + " = [^\\n]*").exec(text);
  if (!m) throw new Error("var " + name + " not found");
  return m[0].slice(1).replace(/;?\s*\/\/.*$/, ";");
}
const a = src.indexOf("// Q08-REVIEW-2026-10-31 (agent_issues 1716");
const b = src.indexOf("// Q08-REVIEW-2026-10-31 end");
if (a < 0 || b < a) throw new Error("Q08-REVIEW-2026-10-31 block not found in worker.js");

// ---- in-memory D1 ------------------------------------------------------------------------------------------------
function mkDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);`);
  let failBatch = false;
  const stmtOn = (sql) => {
    let args = [];
    // node:sqlite refuses positional ?N binding ("column index out of range") and the review's ops_config upsert is
    // written with ?1/?2/?3, so the whole batch threw and the decision was never written. Map ?N to named $pN.
    const q = /\?\d/.test(sql) ? sql.replace(/\?(\d+)/g, (m, n) => "$p" + n) : sql;
    const call = (m) => {
      const st = db.prepare(q);
      return q === sql ? st[m](...args) : st[m](Object.fromEntries(args.map((v, i) => ["p" + (i + 1), v])));
    };
    const self = {
      bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; },
      async all() { return { results: call("all") }; },
      async first() { return call("get") || null; },
      async run() { const r = call("run"); return { success: true, meta: { changes: Number(r.changes) } }; }
    };
    return self;
  };
  const AUDIT = {
    prepare: (sql) => stmtOn(sql),
    async batch(list) {
      if (failBatch) throw new Error("D1_ERROR: simulated batch failure");
      db.exec("BEGIN");
      try { for (const s of list) await s.run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      return list.map(() => ({ success: true }));
    }
  };
  return { db, AUDIT, setFailBatch(v) { failBatch = v; } };
}

// ---- stubbed CF GraphQL --------------------------------------------------------------------------------------------
let gqlMode = "ok";
let gqlCalls = [];
let humanGroups = [], allGroups = [];
async function fakeFetch(url, init) {
  const q = JSON.parse(init.body).query;
  gqlCalls.push(q);
  const filtered = q.includes("bot: 0");
  if (gqlMode === "reject-bot" && filtered) {
    return { ok: false, status: 400, json: async () => ({ data: null, errors: [{ message: "unknown field \"bot\" in filter" }] }) };
  }
  if (gqlMode === "down") throw new Error("network down");
  const groups = filtered ? humanGroups : allGroups;
  return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: groups }] } }, errors: null }) };
}
const g = (host, path, count) => ({ count, dimensions: { requestHost: host, requestPath: path } });

// ---- load the block ------------------------------------------------------------------------------------------------
const cx = vm.createContext({ console, Date, JSON, Math, Number, String, Object, Array, Map, isNaN, isFinite, AbortSignal, fetch: fakeFetch });
vm.runInContext(
  ["var VERSION = 'test'; var NAME = 'qnfo-fleet-dashboard'; var DAY_MS = 864e5;", varSrc(src, "ACCOUNT"), varSrc(src, "REACH_RUM_LIMIT"),
    src.slice(src.indexOf("const D1_PRIMARY_ONLY"), src.indexOf("\n__name(d1all")), fnSrc(src, "reachErr"), fnSrc(src, "reachShiftDay"), fnSrc(src, "reachYesterday"), fnSrc(src, "reachRumQuery"),
    fnSrc(src, "reachGf"), fnSrc(src, "reachRumGroups"), src.slice(a, b),
    "this.__api = { q08ReviewWindow, q08ReviewTally, q08ReviewDecide, q08ReviewCap, q08ReviewMeasure, q08Review, q08ReviewStatus, reachRumQuery, K: { Q08_REVIEW_KEY, Q08_REVIEW_EVENT, Q08_REVIEW_DUE, Q08_CAP_KEY, Q08_CAP_DEFAULT, Q08_CAP_CUT, Q08_REVIEW_THRESHOLD } };"
  ].join("\n"), cx);
const api = cx.__api;
const K = api.K;

// The reader in q08-signal-engine (Q08-CADENCE-CAP-1), loaded from its own source.
const qx = vm.createContext({ Number, String, Math });
vm.runInContext([varSrc(q08src, "MAX_PER_DAY"), varSrc(q08src, "CAP_KEY"), varSrc(q08src, "PROPERTY"), varSrc(q08src, "QUOTAS_KEY"), fnSrc(q08src, "parseDailyCap"), fnSrc(q08src, "parseQuota"), fnSrc(q08src, "propertyQuota"), fnSrc(q08src, "sweepForecastCriteria"), fnSrc(q08src, "dailyCap"),
  "this.__q = { parseDailyCap, dailyCap, CAP_KEY, MAX_PER_DAY };"].join("\n"), qx);
const q08 = qx.__q;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; } else { fail++; console.log("FAIL: " + name); }
}
const PROBE = "SELECT '1' AS expected, CASE WHEN EXISTS (SELECT 1 FROM ops_config WHERE key = 'q08_review_2026_10_31' AND value <> '') THEN '1' ELSE '0' END AS observed";
const STRICT_PROBE = "SELECT '1' AS expected, CASE WHEN EXISTS (SELECT 1 FROM ops_config WHERE key = 'q08_review_2026_10_31' AND CASE WHEN json_valid(value) THEN json_extract(value, '$.decision') END IN ('keep', 'cut-cadence') AND CASE WHEN json_valid(value) THEN json_type(value, '$.human_pageviews_week') END = 'integer') THEN '1' ELSE '0' END AS observed";
const probe = (db, sql) => db.prepare(sql || PROBE).get().observed;

// ---- pure rules ----------------------------------------------------------------------------------------------------
const t = api.q08ReviewTally([g("q08.org", "/", 5), g("q08.org", "/p/2026-10-25-essay-abc", 7), g("WWW.Q08.ORG.", "/p/x/", 2), g("q08.org", "", 1),
  g("reading.q08.org", "/", 40), g("qnfo.org", "/papers/a", 9), g("q08.org", "/p/y", 0), null]);
ok(t.pageviews === 15 && t.essay_pageviews === 9 && t.other_hosts_pageviews === 49, "tally counts q08.org and www.q08.org only; essays are /p/<slug>; reading.q08.org and other hosts are summed apart");
ok(t.top_paths[0][0] === "/p/2026-10-25-essay-abc" && t.top_paths[0][1] === 7 && t.top_paths.some((p) => p[0] === "/" && p[1] === 6), "top paths are ranked and an empty path is '/'");
const D = (n, other, lim) => api.q08ReviewDecide(n == null ? null : { pageviews: n, other_hosts_pageviews: other == null ? 100 : other }, !!lim);
ok(D(null).decision === "deferred", "a failed bot-filtered query defers");
ok(D(0, 0).decision === "deferred" && /no bot-filtered page views for any host/.test(D(0, 0).reason), "no page views on any host defers (RUM down or filter wrong), never a zero");
ok(D(0, 100).decision === "cut-cadence", "zero on q08 while other hosts have views is a real measurement");
ok(D(49).decision === "cut-cadence" && D(50).decision === "keep" && D(500).decision === "keep", "under 50 a week cuts the cadence; 50 and up keeps it");
ok(D(30, 100, true).decision === "deferred" && D(60, 100, true).decision === "keep", "a lower bound under 50 (group limit hit) defers; a lower bound at 50 or more is enough to keep");
ok(api.q08ReviewCap(null) === 2 && api.q08ReviewCap("10") === 2 && api.q08ReviewCap("1") === 1 && api.q08ReviewCap("0") === 0 && api.q08ReviewCap("abc") === 2 && api.q08ReviewCap(" 25 ") === 2, "the cut leaves at most 2 and never raises a lower cap");
const w = api.q08ReviewWindow("2026-10-30");
ok(w.from === "2026-10-24T00:00:00Z" && w.to === "2026-10-30T23:59:59Z" && w.days === 7, "the window is the 7 complete UTC days before 2026-10-31");
const qf = api.reachRumQuery("requestHost requestPath", w.from, w.to, "bot: 0"), qu = api.reachRumQuery("requestHost requestPath", w.from, w.to);
ok(/filter: \{ datetime_geq: "2026-10-24T00:00:00Z", datetime_leq: "2026-10-30T23:59:59Z", bot: 0 \}/.test(qf) && !/bot/.test(qu) && /accountTag: "edb167b78c9fb901ea5bca3ce58ccc4b"/.test(qu), "the reach query gains bot: 0 only when asked (the ingest's query is unchanged)");

// ---- q08-signal-engine reads the same knob -------------------------------------------------------------------------
ok(q08.CAP_KEY === K.Q08_CAP_KEY && q08.MAX_PER_DAY === K.Q08_CAP_DEFAULT, "q08-signal-engine reads the key the review writes, with the same default");
ok(q08.parseDailyCap(null) === 10 && q08.parseDailyCap("2") === 2 && q08.parseDailyCap("0") === 0 && q08.parseDailyCap("25") === 10 && q08.parseDailyCap("two") === 10 && q08.parseDailyCap("-1") === 10 && q08.parseDailyCap("") === 10, "q08 cap parsing: absent or invalid is 10 (current behaviour), 0..10 is honoured");
ok(await q08.dailyCap({}) === 10 && await q08.dailyCap({ AUDIT: { prepare() { throw new Error("no such table"); } } }) === 10, "q08 keeps 10 a day when qnfo-audit is unbound or unreadable");

// ---- the dated job: deferred, throttled, decided, idempotent -------------------------------------------------------
{
  const { db, AUDIT } = mkDb();
  const env = { AUDIT, CF_TOKEN: "t" };
  gqlCalls = [];
  let r = await api.q08Review(env, { nowMs: Date.parse("2026-10-30T23:45:00Z") });
  ok(r.not_yet === K.Q08_REVIEW_DUE && gqlCalls.length === 0 && db.prepare("SELECT COUNT(*) n FROM cloud_ops_events").get().n === 0, "nothing runs (no GraphQL, no D1 write) before 2026-10-31T00:00Z");
  ok(await q08.dailyCap(env) === 10, "before the review q08 keeps its 10 a day");

  gqlMode = "reject-bot";
  r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T00:00:05Z") });
  const ev = db.prepare("SELECT status, text, meta FROM cloud_ops_events WHERE id = 'q08-review-2026-10-31'").get();
  ok(r.decision === "deferred" && /unknown field \\"bot\\"|unknown field "bot"/.test(r.reason) && r.human_pageviews_week === null, "a rejected bot filter defers with the GraphQL reason and no number");
  ok(ev && ev.status === "deferred" && JSON.parse(ev.meta).attempts === 1 && /unknown field/.test(ev.text), "the deferral is recorded in cloud_ops_events with its reason and attempt");
  ok(probe(db) === "0" && db.prepare("SELECT COUNT(*) n FROM ops_config").get().n === 0, "a deferral writes no ops_config row, so the remediation probe stays at 0 and no cap is set");

  gqlCalls = [];
  r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T00:15:00Z") });
  ok(r.retry_after === "2026-10-31T01:00:05.000Z" && gqlCalls.length === 0, "a deferral is retried an hour later, not on every tick");

  gqlMode = "ok";
  humanGroups = [g("q08.org", "/", 11), g("q08.org", "/p/2026-10-27-a", 14), g("www.q08.org", "/p/2026-10-28-b", 12), g("reading.q08.org", "/", 30), g("qnfo.org", "/", 200)];
  allGroups = humanGroups.concat([g("q08.org", "/p/2026-10-27-a", 40)]);
  r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T01:00:10Z") });
  const row = db.prepare("SELECT value FROM ops_config WHERE key = 'q08_review_2026_10_31'").get();
  const v = row && JSON.parse(row.value);
  ok(r.decision === "cut-cadence" && v && v.decision === "cut-cadence" && v.human_pageviews_week === 37 && v.threshold === 50, "37 human page views a week records cut-cadence with the measurement");
  ok(v && v.window.from === "2026-10-24T00:00:00Z" && v.window.to === "2026-10-30T23:59:59Z" && /rumPageloadEventsAdaptiveGroups, filter bot: 0/.test(v.source) && v.all_pageviews_week === 77 && v.essay_pageviews_week === 26 && v.attempts === 2 && v.measured_at === "2026-10-31T01:00:10.000Z", "the value carries the window, the source, the bot-inclusive count for context and the attempt");
  ok(gqlCalls.some((q) => q.includes("bot: 0") && q.includes("2026-10-24T00:00:00Z") && q.includes("2026-10-30T23:59:59Z")), "the measurement asked RUM for the bot-filtered window");
  ok(db.prepare("SELECT value FROM ops_config WHERE key = 'q08_max_per_day'").get().value === "2" && v.action && v.action.to === 2 && v.action.from === null, "the cut sets ops_config q08_max_per_day to 2 and records it");
  ok(await q08.dailyCap(env) === 2, "q08-signal-engine now reads a cap of 2 a day");
  ok(probe(db) === "1" && probe(db, STRICT_PROBE) === "1", "the existing remediation probe (and the stricter one) pass on the real decision");
  ok(db.prepare("SELECT status FROM cloud_ops_events WHERE id = 'q08-review-2026-10-31'").get().status === "ok", "the event row closes as ok");

  gqlCalls = [];
  const before = row.value;
  r = await api.q08Review(env, { nowMs: Date.parse("2026-11-07T00:00:00Z") });
  ok(r.done === "q08_review_2026_10_31" && gqlCalls.length === 0 && db.prepare("SELECT value FROM ops_config WHERE key = 'q08_review_2026_10_31'").get().value === before, "once decided it never runs again");
  db.prepare("DELETE FROM ops_config WHERE key = 'q08_max_per_day'").run();
  await api.q08Review(env, { nowMs: Date.parse("2026-11-08T00:00:00Z") });
  ok(await q08.dailyCap(env) === 10 && db.prepare("SELECT COUNT(*) n FROM ops_config WHERE key = 'q08_max_per_day'").get().n === 0, "the cut is reversible: deleting the cap restores 10 a day and the review does not re-apply it");

  const st = await api.q08ReviewStatus(env);
  ok(st.decision && st.decision.decision === "cut-cadence" && st.last_attempt && st.last_attempt.status === "ok" && st.cap === null, "the status read shows the decision and the last attempt");

  // the watchmaker stuck query (WATCHMAKER_OPS q08-review) is 0 once decided
  const sqRaw = /key: "q08-review"[^\n]*stuck_sql: "([^"]+)"/.exec(src)[1];
  // node:sqlite refuses positional ?N binding; the stuck query uses ?1.
  const sqNamed = /\?\d/.test(sqRaw);
  const sq = sqNamed ? sqRaw.replace(/\?(\d+)/g, (m, n) => "$p" + n) : sqRaw;
  const sqArg = new Date(Date.parse("2026-11-05T00:00:00Z") - 48 * 36e5).toISOString();
  ok(db.prepare(sq).get(sqNamed ? { p1: sqArg } : sqArg).stuck === 0, "watchmaker: a decided review is not counted");
}
{
  // keep path, an existing lower cap, empty RUM, a down network, a failed write
  const { db, AUDIT, setFailBatch } = mkDb();
  const env = { AUDIT, CF_TOKEN: "t" };
  const sqRaw2 = /key: "q08-review"[^\n]*stuck_sql: "([^"]+)"/.exec(src)[1];
  const sqNamed = /\?\d/.test(sqRaw2);
  const sq = sqNamed ? sqRaw2.replace(/\?(\d+)/g, (m, n) => "$p" + n) : sqRaw2;
  const stuckAt = (iso) => { const a = new Date(Date.parse(iso) - 48 * 36e5).toISOString(); return db.prepare(sq).get(sqNamed ? { p1: a } : a).stuck; };
  ok(stuckAt("2026-10-31T12:00:00Z") === 0 && stuckAt("2026-11-02T00:00:01Z") === 1, "watchmaker: a review 48h past due with no decision counts, not before");

  gqlMode = "ok"; humanGroups = []; allGroups = [];
  let r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T00:00:00Z") });
  ok(r.decision === "deferred" && probe(db) === "0", "RUM returning nothing for any host defers instead of recording zero");

  gqlMode = "down";
  r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T01:00:00Z") });
  ok(r.decision === "deferred" && /network down/.test(r.reason) && probe(db) === "0", "a network failure defers with its reason");

  gqlMode = "ok"; humanGroups = [g("q08.org", "/", 30), g("q08.org", "/p/z", 10), g("qnfo.org", "/", 5)]; allGroups = humanGroups;
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('q08_max_per_day', '1')").run();
  setFailBatch(true);
  r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T02:00:00Z") });
  ok(r.write_error && probe(db) === "0" && db.prepare("SELECT status FROM cloud_ops_events WHERE id = 'q08-review-2026-10-31'").get().status === "deferred" && db.prepare("SELECT value FROM ops_config WHERE key = 'q08_max_per_day'").get().value === "1", "a failed D1 write records nothing and is retried");
  setFailBatch(false);
  r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T03:00:00Z") });
  ok(r.decision === "cut-cadence" && r.action.from === "1" && r.action.to === 1 && db.prepare("SELECT value FROM ops_config WHERE key = 'q08_max_per_day'").get().value === "1" && r.attempts === 4, "a lower cap already set is kept, not raised to 2");
}
{
  const { db, AUDIT } = mkDb();
  const env = { AUDIT, CF_TOKEN: "t" };
  gqlMode = "ok"; humanGroups = [g("q08.org", "/", 80), g("www.q08.org", "/p/a", 40)]; allGroups = humanGroups;
  const r = await api.q08Review(env, { nowMs: Date.parse("2026-10-31T00:00:00Z") });
  ok(r.decision === "keep" && r.human_pageviews_week === 120 && r.action === null && db.prepare("SELECT COUNT(*) n FROM ops_config WHERE key = 'q08_max_per_day'").get().n === 0 && probe(db) === "1", "120 a week keeps q08 as is, records the decision and sets no cap");
  const noTok = await api.q08Review({ AUDIT: mkDb().AUDIT }, { nowMs: Date.parse("2026-10-31T00:00:00Z") });
  ok(noTok.decision === "deferred" && /CF_TOKEN unset/.test(noTok.reason), "without CF_TOKEN the review defers with that reason");
}

// ---- routes through the real fetch handler -------------------------------------------------------------------------
{
  const { AUDIT } = mkDb();
  globalThis.fetch = fakeFetch;
  const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
  const c = { waitUntil() {}, passThroughOnException() {} };
  let res = await worker.fetch(new Request("https://fleet.qnfo.org/api/q08-review"), { AUDIT }, c);
  let j = await res.json();
  ok(res.status === 200 && j.key === "q08_review_2026_10_31" && j.due === "2026-10-31T00:00:00Z" && j.decision === null, "GET /api/q08-review is open and shows the pending review");
  gqlCalls = [];
  res = await worker.fetch(new Request("https://fleet.qnfo.org/api/q08-review?to=2026-09-30", { method: "POST" }), { AUDIT, LOOP_TOKEN: "L" }, c);
  ok(res.status === 401 && gqlCalls.length === 0, "a measurement without x-loop-token is refused before any GraphQL call");
  humanGroups = [g("q08.org", "/", 3)]; allGroups = humanGroups;
  res = await worker.fetch(new Request("https://fleet.qnfo.org/api/q08-review?to=2026-09-30", { method: "POST", headers: { "x-loop-token": "L" } }), { AUDIT, LOOP_TOKEN: "L", CF_TOKEN: "t" }, c);
  j = await res.json();
  ok(res.status === 200 && j.preview === true && j.written === false && j.window.from === "2026-09-24T00:00:00Z" && j.human_pageviews_week === 3, "a token holder can preview any past window");
  ok((await api.q08ReviewStatus({ AUDIT })).decision === null, "a preview writes nothing");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
