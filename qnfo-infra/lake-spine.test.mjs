// LAKE-SPINE-1 offline suite (qnfo-infra 1.14.0; roadmap row 3258 RM-BS-DATA-SPINE-1). No network: the Pipelines stream and Basin SQL are stub fetches, qnfo-audit is a node:sqlite database with
// the live layout of fleet_probe_log (id AUTOINCREMENT, two indexes) and the two tables the migration adds. Proves: nothing runs while ops_config lake_spine is off; the first tick seeds the cursor at the
// first row of the previous UTC day and sends rows in id order in batches of 500 with exported_at; the cursor moves only after the stream accepted a batch; a refusal or a short commit is recorded and never
// thrown; the drift check compares completed days with the lake's distinct ids, counts duplicates without calling them drift, flags a different id set, and pauses the copy and files one issue only after a
// breach has lasted 24 hours; the routes await their token check; the Python script and the worker agree on the table's fields.
// Run: node --no-warnings qnfo-infra/lake-spine.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const py = readFileSync(new URL("../scripts/lake_spine.py", import.meta.url), "utf8");
const a = src.indexOf("// ---- LAKE-SPINE-1:BEGIN"), b = src.indexOf("// ---- LAKE-SPINE-1:END");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 600) : "")); } };
ok(a > 0 && b > a, "the lake block is found between its markers");
const block = src.slice(a, b);
ok(!/\*\//.test(block), "no comment terminator inside the block");
ok(/var VERSION = "1\.(1[4-9]|[2-9]\d)\./.test(src), "VERSION is at least 1.14");
const sched = src.slice(src.indexOf("async function runScheduled"));
ok(/lakeSpineTick\(env\)/.test(sched.slice(0, 5000)), "runScheduled calls lakeSpineTick on every fire");
ok(/path\.indexOf\("\/lake\/"\) === 0\) \{\s*if \(!\(await auth\(token, env\)\)\) return new Response\("unauthorized"/.test(src), "the /lake/ routes await the token check");
ok(/"cost-ledger", "lake-spine"\]/.test(src), "/health advertises the lake-spine capability");

// the Python second path and the worker must agree on the lake table's columns
const pyFields = [...py.matchAll(/\("(\w+)", "(?:int64|string)", (?:True|False)\)/g)].map((m) => m[1]);
const jsFields = (block.match(/fields: \[([^\]]*)\]/) || ["", ""])[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
ok(JSON.stringify(pyFields) === JSON.stringify([...jsFields, "exported_at"]), "scripts/lake_spine.py fields = worker fields + exported_at", { pyFields, jsFields });

const mk = new Function("infraSecret", "fetch", block + "\nreturn { LAKE_BATCH, LAKE_TABLES, lakeMode, lakeSeed, lakeTail, lakeDriftDay, lakeDriftTick, lakeSpineTick, lakeStatus, lakeRoute, lakePause };");

const mkdb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_probe_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT, name TEXT, url TEXT, transport TEXT, ok INTEGER, status INTEGER, ms INTEGER, body TEXT);
    CREATE INDEX idx_fpl_ts ON fleet_probe_log(ts);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE lake_spine_state (tbl TEXT PRIMARY KEY, cursor_id INTEGER NOT NULL, start_id INTEGER NOT NULL, start_day TEXT, rows_sent INTEGER NOT NULL DEFAULT 0, batches INTEGER NOT NULL DEFAULT 0, last_run_at TEXT, last_error TEXT, updated_at TEXT);
    CREATE TABLE lake_spine_drift (tbl TEXT NOT NULL, day TEXT NOT NULL, d1_rows INTEGER, lake_rows INTEGER, lake_distinct INTEGER, missing INTEGER, duplicates INTEGER, drift_pct REAL, verdict TEXT, first_checked_at TEXT, checked_at TEXT, note TEXT, PRIMARY KEY (tbl, day));`);
  const prep = (sql) => ({
    bind: (...v) => ({
      first: async () => db.prepare(sql).get(...v) || null,
      all: async () => ({ results: db.prepare(sql).all(...v) }),
      run: async () => db.prepare(sql).run(...v)
    }),
    first: async () => db.prepare(sql).get() || null,
    all: async () => ({ results: db.prepare(sql).all() }),
    run: async () => db.prepare(sql).run()
  });
  return { db, AUDIT: { prepare: prep } };
};
const iso = (ms) => new Date(ms).toISOString();
const DAY = 86400000;
const ydayStr = iso(Date.now() - DAY).slice(0, 10);
const todayStr = iso(Date.now()).slice(0, 10);
// 1300 rows: 100 two days ago (not copied), 700 yesterday, 500 today
const seedRows = (db) => {
  const ins = db.prepare("INSERT INTO fleet_probe_log (ts, source, name, url, transport, ok, status, ms, body) VALUES (?, 'qnfo-fleet-dashboard', ?, 'u', 'http', 1, 200, 5, 'b')");
  for (let i = 0; i < 100; i++) ins.run(iso(Date.now() - 2 * DAY).slice(0, 10) + "T10:00:00.000Z", "old" + i);
  for (let i = 0; i < 700; i++) ins.run(ydayStr + "T10:00:00.000Z", "y" + i);
  for (let i = 0; i < 500; i++) ins.run(todayStr + "T00:00:01.000Z", "t" + i);
};
const secret = async (env, k, legacy) => env[legacy];
const stream = { calls: [], status: 200, committedDelta: 0 };
const basin = { calls: [], n: null, d: null, s: null, status: 200 };
const fetchStub = async (url, init) => {
  const u = String(url);
  if (u.indexOf(".ingest.cloudflare.com") > 0) {
    const rows = JSON.parse(init.body);
    stream.calls.push({ url: u, auth: init.headers.Authorization, ua: init.headers["User-Agent"], rows });
    if (stream.status !== 200) return new Response("error code: 1010", { status: stream.status });
    return new Response(JSON.stringify({ success: true, result: { committed: rows.length + stream.committedDelta } }), { status: 200 });
  }
  if (u.indexOf("api.sql.cloudflarestorage.com") > 0) {
    const q = JSON.parse(init.body).query;
    basin.calls.push({ url: u, q });
    if (basin.status !== 200) return new Response("forbidden", { status: basin.status });
    const row = /sum\(id\)/.test(q) ? { s: basin.s } : { n: basin.n, d: basin.d };
    return new Response(JSON.stringify({ success: true, result: { rows: [row], metrics: { bytes_scanned: 12247 } } }), { status: 200 });
  }
  throw new Error("unexpected fetch " + u);
};
const reset = () => { stream.calls.length = 0; stream.status = 200; stream.committedDelta = 0; basin.calls.length = 0; basin.status = 200; basin.n = basin.d = basin.s = null; };
const setup = (mode) => {
  reset();
  const d = mkdb();
  seedRows(d.db);
  if (mode) d.db.prepare("INSERT INTO ops_config (key, value) VALUES ('lake_spine', ?)").run(mode);
  const env = { AUDIT: d.AUDIT, CF_TOKEN: "tok-123", CF_ACCOUNT: "acct" };
  return { db: d.db, env, L: mk(secret, fetchStub) };
};

// ---- 1. off by default
{
  const t = setup(null);
  ok(await t.L.lakeMode(t.env) === "off", "no ops_config row reads as off");
  const r = await t.L.lakeSpineTick(t.env);
  ok(r.skipped === true && stream.calls.length === 0 && basin.calls.length === 0, "off: nothing is sent and nothing is queried", r);
  ok(t.db.prepare("SELECT COUNT(*) AS n FROM lake_spine_state").get().n === 0, "off: no cursor row is created");
  t.db.prepare("INSERT OR REPLACE INTO ops_config (key, value) VALUES ('lake_spine', 'dual')").run();
  ok(await t.L.lakeMode(t.env) === "off", "an unknown or reserved value (dual) reads as off");
}

// ---- 2. shadow: seed, batches, order, exported_at, auth header and user agent
{
  const t = setup("shadow");
  const r = await t.L.lakeSpineTick(t.env);
  const st = t.db.prepare("SELECT * FROM lake_spine_state WHERE tbl = 'fleet_probe_log'").get();
  const firstY = t.db.prepare("SELECT MIN(id) AS id FROM fleet_probe_log WHERE ts >= ?").get(ydayStr + "T00:00:00").id;
  const maxId = t.db.prepare("SELECT MAX(id) AS id FROM fleet_probe_log").get().id;
  ok(st.start_id === firstY && st.start_day === ydayStr, "the cursor is seeded at the first row of the previous UTC day", st);
  ok(st.cursor_id === maxId && st.rows_sent === 1200 && st.batches === 3, "all 1200 rows from yesterday on are sent in 3 batches and the cursor reaches the max id", st);
  ok(stream.calls.length === 3 && stream.calls.map((c) => c.rows.length).join(",") === "500,500,200", "batches are 500, 500, 200", stream.calls.map((c) => c.rows.length));
  const sentIds = stream.calls.flatMap((c) => c.rows.map((x) => x.id));
  ok(sentIds.length === 1200 && sentIds.every((id, i) => i === 0 || id > sentIds[i - 1]) && sentIds[0] === firstY, "rows leave in strictly increasing id order starting at the seed");
  ok(!sentIds.some((id) => id < firstY), "rows older than the seed day are not copied");
  ok(stream.calls.every((c) => c.auth === "Bearer tok-123" && /qnfo-infra-lake/.test(c.ua)), "each POST carries the bearer token and a named user agent (the ingest edge refuses the default agent)");
  ok(stream.calls[0].rows.every((x) => typeof x.exported_at === "string" && x.exported_at.length === 24) && Object.keys(stream.calls[0].rows[0]).join(",") === "id,ts,source,name,url,transport,ok,status,ms,body,exported_at", "each row has the table's columns plus exported_at", Object.keys(stream.calls[0].rows[0]));
  ok(r.tail.fleet_probe_log.ok === true && r.tail.fleet_probe_log.behind_ids === 0 && r.errors.length === 0, "the tick reports ok with nothing behind", r);
  ok(basin.calls.length === 0 && r.drift.fleet_probe_log.checked.length === 0, "the fire that is still landing yesterday's rows does not check yesterday (the lake commits after the stream accepts)", { calls: basin.calls.length, drift: r.drift });
  // second tick: nothing new, so yesterday is now checked (the lake has had a fire's time to commit)
  stream.calls.length = 0;
  const sumY = t.db.prepare("SELECT SUM(id) AS s FROM fleet_probe_log WHERE ts >= ? AND ts < ?").get(ydayStr + "T00:00:00", todayStr + "T00:00:00").s;
  basin.n = 700; basin.d = 700; basin.s = sumY;
  const r2 = await t.L.lakeSpineTick(t.env);
  ok(stream.calls.length === 0 && r2.tail.fleet_probe_log.sent === 0, "a second tick with no new rows sends nothing", r2);
  ok(r2.drift.fleet_probe_log.checked.length === 1 && r2.drift.fleet_probe_log.checked[0].day === ydayStr && r2.drift.fleet_probe_log.checked[0].verdict === "ok", "the next fire checks yesterday and finds it complete", r2.drift);
  stream.calls.length = 0;
  ok(t.db.prepare("SELECT last_run_at FROM lake_spine_state").get().last_run_at != null, "an idle tick still records last_run_at (liveness)");
  // new rows arrive
  t.db.prepare("INSERT INTO fleet_probe_log (ts, source, name, url, transport, ok, status, ms, body) VALUES (?, 's', 'n', 'u', 'http', 0, 500, 9, 'x')").run(iso(Date.now()));
  const r3 = await t.L.lakeSpineTick(t.env);
  ok(r3.tail.fleet_probe_log.sent === 1 && stream.calls.length === 1 && stream.calls[0].rows[0].id === maxId + 1, "a new row is picked up exactly once", r3);
  ok(r3.drift.fleet_probe_log.checked.length === 0, "an ok day is not read again", r3.drift);
}

// ---- 3. the cursor moves only after the stream accepted the batch
{
  const t = setup("shadow");
  stream.status = 403;
  const r = await t.L.lakeSpineTick(t.env);
  const st = t.db.prepare("SELECT * FROM lake_spine_state").get();
  ok(r.errors.length >= 1 && /stream 403/.test(r.errors[0]), "a refusal is returned as an error line, not thrown", r);
  ok(st.cursor_id === st.start_id - 1 && st.rows_sent === 0 && /stream 403: error code: 1010/.test(st.last_error), "the cursor stays and last_error holds the refusal text", st);
  stream.status = 200;
  const r2 = await t.L.lakeSpineTick(t.env);
  const st2 = t.db.prepare("SELECT * FROM lake_spine_state").get();
  ok(r2.errors.length === 0 && st2.last_error === null && st2.rows_sent === 1200, "the next tick recovers from the same cursor and clears last_error", st2);
  // a short commit counts as a failure
  const t2 = setup("shadow");
  stream.committedDelta = -1;
  const r3 = await t2.L.lakeSpineTick(t2.env);
  ok(/committed 499 of 500/.test(JSON.stringify(r3.errors)), "a stream that commits fewer rows than sent is an error", r3);
  // no token
  const t3 = setup("shadow");
  delete t3.env.CF_TOKEN;
  const r4 = await t3.L.lakeSpineTick(t3.env);
  ok(/CF_TOKEN is not set/.test(JSON.stringify(r4.errors)), "a missing token is reported, not thrown", r4);
}

// ---- 4. drift check
{
  const t = setup("shadow");
  await t.L.lakeSpineTick(t.env);  // seeds; the drift tick inside it needs basin answers
  reset();
  t.db.prepare("DELETE FROM lake_spine_drift").run();
  t.db.prepare("DELETE FROM ops_config WHERE key <> 'lake_spine'").run();
  const sumY = t.db.prepare("SELECT SUM(id) AS s FROM fleet_probe_log WHERE ts >= ? AND ts < ?").get(ydayStr + "T00:00:00", todayStr + "T00:00:00").s;
  const st = t.db.prepare("SELECT * FROM lake_spine_state").get();
  basin.n = 700; basin.d = 700; basin.s = sumY;
  const ok1 = await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  ok(ok1.verdict === "ok" && ok1.d1_rows === 700 && ok1.missing === 0 && ok1.kill === false, "equal counts and sums: verdict ok", ok1);
  ok(/count\(DISTINCT id\)/.test(basin.calls[0].q) && /telemetry\.fleet_probe_log/.test(basin.calls[0].q) && basin.calls[0].q.indexOf("id >= " + st.start_id) > 0, "the lake query counts distinct ids of the day from start_id on the telemetry namespace", basin.calls[0].q);
  // duplicates are reported, not drift
  basin.n = 750; basin.d = 700;
  const dup = await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  ok(dup.verdict === "ok" && dup.duplicates === 50 && dup.missing === 0, "50 duplicate rows are counted as duplicates and are not drift", dup);
  // ids in the lake that D1 pruned are not drift
  basin.n = 720; basin.d = 720;
  const extra = await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  ok(extra.verdict === "ok" && extra.missing === 0, "ids the lake keeps and D1 pruned are not drift", extra);
  // missing 0.5 percent: breach, first_checked_at starts the 24 h window
  basin.n = basin.d = 696; basin.s = sumY - 100;
  const br = await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  ok(br.verdict === "breach" && br.missing === 4 && br.drift_pct > 0.5 && br.kill === false, "4 of 700 missing (0.57 percent) is a breach and does not kill on the first reading", br);
  ok(t.db.prepare("SELECT value FROM ops_config WHERE key = 'lake_spine'").get().value === "shadow", "the first breach reading leaves the copy running");
  // same count, different ids
  basin.n = basin.d = 700; basin.s = sumY + 5;
  const so = await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  ok(so.verdict === "breach", "the same count with a different id sum is a breach", so);
  // a breach older than 24 h kills: backdate first_checked_at
  basin.n = basin.d = 696; basin.s = sumY - 100;
  await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  t.db.prepare("UPDATE lake_spine_drift SET first_checked_at = ? WHERE tbl = 'fleet_probe_log'").run(iso(Date.now() - 25 * 3600 * 1000));
  const tick = await t.L.lakeDriftTick(t.env, "fleet_probe_log");
  ok(tick.checked.length === 0, "a non-ok day is not re-read before the 6 hour re-check interval", tick);
  t.db.prepare("UPDATE lake_spine_drift SET checked_at = ? WHERE tbl = 'fleet_probe_log'").run(iso(Date.now() - 7 * 3600 * 1000));
  const tick2 = await t.L.lakeDriftTick(t.env, "fleet_probe_log");
  ok(tick2.checked.length === 1 && tick2.checked[0].kill === true, "after 24 h of breach the drift tick kills", tick2);
  const cfg = t.db.prepare("SELECT value, note FROM ops_config WHERE key = 'lake_spine'").get();
  ok(cfg.value === "paused" && /LAKE-SPINE-1: paused/.test(cfg.note), "the kill sets ops_config lake_spine to paused with the reason", cfg);
  const issues = t.db.prepare("SELECT title, status FROM agent_issues").all();
  ok(issues.length === 1 && /^LAKE-SPINE-DRIFT-1:/.test(issues[0].title) && issues[0].status === "open", "one open LAKE-SPINE-DRIFT-1 issue is filed", issues);
  await t.L.lakePause(t.env, "fleet_probe_log", "again");
  ok(t.db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n === 1, "a second pause does not file a second open issue");
  const paused = await t.L.lakeSpineTick(t.env);
  ok(paused.skipped === true && paused.mode === "paused", "a paused copy sends nothing on the next tick", paused);
  // recovery: ok reading clears the streak
  basin.n = basin.d = 700; basin.s = sumY;
  const rec = await t.L.lakeDriftDay(t.env, "fleet_probe_log", ydayStr, st);
  ok(rec.verdict === "ok" && t.db.prepare("SELECT verdict FROM lake_spine_drift WHERE day = ?").get(ydayStr).verdict === "ok", "an ok reading replaces the breach row", rec);
  // basin refusal is an error line, not a throw
  const t2 = setup("shadow");
  await t2.L.lakeSpineTick(t2.env);   // the first fire lands the rows and defers the drift check
  basin.status = 403;
  const r = await t2.L.lakeSpineTick(t2.env);
  ok(/drift: basin-sql 403/.test(JSON.stringify(r.errors)) && r.tail.fleet_probe_log.ok === true, "a Basin SQL refusal is reported while the copy itself still ran", r);
}

// ---- 5. status and routes
{
  const t = setup("shadow");
  await t.L.lakeSpineTick(t.env);
  const s = await t.L.lakeStatus(t.env);
  ok(s.mode === "shadow" && s.tables.fleet_probe_log.behind_ids === 0 && s.tables.fleet_probe_log.state.rows_sent === 1200, "status shows mode, cursor state and zero behind", s);
  const url = (p) => new URL("https://x" + p);
  const call = async (p, method, body) => {
    const u = url(p);
    const res = await t.L.lakeRoute(new Request(u, { method, body: body ? JSON.stringify(body) : undefined }), t.env, u, u.pathname, method, {});
    return { status: res.status, json: await res.json() };
  };
  ok((await call("/lake/status", "GET")).json.ok === true, "GET /lake/status answers");
  ok((await call("/lake/query", "POST", { sql: "DELETE FROM x" })).status === 400, "query refuses a non-SELECT");
  ok((await call("/lake/query", "POST", { sql: "SELECT 1; SELECT 2" })).status === 400, "query refuses a second statement");
  ok((await call("/lake/query", "POST", { sql: "SELECT " + "x".repeat(2100) })).status === 400, "query refuses more than 2000 characters");
  basin.n = 3; basin.d = 3; basin.s = 6;
  const q = await call("/lake/query", "POST", { sql: "SELECT count(*) AS n FROM telemetry.fleet_probe_log" });
  ok(q.status === 200 && q.json.ok === true && q.json.rows.length === 1 && q.json.bytes_scanned === 12247, "a SELECT passes through to Basin SQL and returns rows and bytes scanned", q);
  const tl = await call("/lake/tail?limit=10", "POST");
  ok(tl.status === 200 && tl.json.ok === true && tl.json.sent === 0, "POST /lake/tail runs on demand", tl);
  t.db.prepare("UPDATE ops_config SET value = 'off' WHERE key = 'lake_spine'").run();
  ok((await call("/lake/tail", "POST")).status === 409, "POST /lake/tail refuses while the flag is off");
  t.db.prepare("UPDATE ops_config SET value = 'paused' WHERE key = 'lake_spine'").run();
  ok((await call("/lake/tail", "POST")).status === 409 && (await call("/lake/tail?force=1", "POST")).status === 200, "a paused copy needs force=1 to run on demand");
  ok((await call("/lake/nope", "GET")).status === 404, "an unknown lake route is 404");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
