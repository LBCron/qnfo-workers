// V3-DASH-1 (1.82.0) offline suite: the three-screen home page and its small endpoints. Drives the real worker against an in-memory SQLite D1.
//   V1 GET / is the static three-screen shell (Now, Readers, Code), makes no cost/reach read, and its client script parses.
//   V2 /api/v3/now lists only owner-lane cards (identity-bound), hides their detail from strangers, and reports worker heartbeats.
//   V3 a source that cannot be read is named in its own section (ok:false) and never blanks the other sections.
//   V4 the command line is closed to strangers (401 need:code) and opens the executor for the owner (loop token): start, then poll steps.
//   V5 /classic and /?frag=1 still reach the old overview; the mirror equals worker.js.
// Run: node qnfo-fleet-dashboard/v3-dash.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const src = readFileSync(join(here, "worker.js"), "utf8");
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT, due TEXT, status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now')), source TEXT);
CREATE TABLE fleet_heartbeat (worker TEXT, version TEXT, ts TEXT, ok INTEGER);
CREATE TABLE v_fleet_metrics (metric TEXT, breach INTEGER);
CREATE TABLE cmd_log (id TEXT, text TEXT, kind TEXT, status TEXT, answer TEXT, error TEXT, owner INTEGER, model TEXT, ts TEXT DEFAULT (datetime('now')), done_ms INTEGER, from_url TEXT, visitor TEXT);`);
db.prepare("INSERT INTO human_actions (slug,title,why) VALUES ('pay','Approve the annual domain renewal','IDENTITY-BOUND: money')").run();
db.prepare("INSERT INTO human_actions (slug,title,why) VALUES ('tidy','Tidy the label set','reversible cleanup')").run();
db.prepare("INSERT INTO human_actions (slug,title,why) VALUES ('tag','Tag your clients','needs a credential refresh, optional')").run();
const iso = (ms) => new Date(Date.now() - ms).toISOString();
db.prepare("INSERT INTO fleet_heartbeat VALUES ('qnfo-a','1',?,1),('qnfo-b','1',?,1)").run(iso(60e3), iso(6 * 3600e3));
db.prepare("INSERT INTO v_fleet_metrics VALUES ('m1',1),('m2',0),('m3',0)").run();
let queries = [];
const wrap = (sql) => {
  queries.push(sql);
  const st = db.prepare(sql);
  const mk = (args) => ({
    all: async () => ({ results: st.all(...args) }), first: async () => st.get(...args) || null,
    run: async () => { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; }, bind: (...a) => mk(a)
  });
  return mk([]);
};
const calls = [];
const env = {
  AUDIT: { prepare: (s) => wrap(s) }, LOOP_TOKEN: "loop-secret-v3-test-token", AI: {},
  SVC_QNFO_OPS: { fetch: async (u, init) => {
    const b = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ u, b });
    if (b.op === "start") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (b.op === "result") return new Response(JSON.stringify({ run: { status: "done", steps: [{ tool: "shell_exec", args: "ls", ms: 40 }], reply: "listed" } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  } }
};
const ctx = { waitUntil() {}, passThroughOnException() {} };
const get = (p, h) => worker.fetch(new Request("https://fleet.qnfo.org" + p, { headers: h || {} }), env, ctx);
const post = (p, b, h) => worker.fetch(new Request("https://fleet.qnfo.org" + p, { method: "POST", headers: Object.assign({ "content-type": "application/json", "x-fleet-ui": "1" }, h || {}), body: JSON.stringify(b || {}) }), env, ctx);

// V1
queries = [];
let t0 = Date.now();
let r = await get("/");
const html = await r.text();
ok(r.status === 200 && /text\/html/.test(r.headers.get("content-type")), "V1 / is html", r.status);
ok(Date.now() - t0 < 1500, "V1 / paints without waiting on data");
ok(["n-now", "n-readers", "n-code"].every((i) => html.includes('id="' + i + '"')), "V1 three screens in the nav");
ok(!/ai_call_counters|reach_|v_metric_trigger_state/.test(queries.join(" ")), "V1 / reads no cost/reach table", queries);
const script = /<script>(\(function\(\)\{[\s\S]*?\}\)\(\);)<\/script>/.exec(html);
let parses = false;
try { new Function(script[1]); parses = true; } catch (e) { console.log(String(e)); }
ok(script && parses, "V1 the client script parses");
ok(!/classic|\/area\//.test(html), "V1 the page links no other tabs");

// V2 + V3
r = await get("/api/v3/now");
let d = await r.json();
ok(r.status === 200 && d.screen === "now" && d.version, "V2 /api/v3/now answers", d);
ok(d.needs.ok && d.needs.count === 1 && d.needs.optional === 1 && d.needs.items[0].key === "ha:pay" && d.needs.items[0].bound === true && d.needs.items[1].bound === false && d.needs.fleet_handles === 1, "V2 only the identity-bound card is the owner's", d.needs);
ok(d.needs.items[0].why === "", "V2 a stranger gets no detail text");
ok(d.health.ok && d.health.workers_total === 2 && d.health.workers_reporting === 1 && d.health.stale_workers[0] === "qnfo-b" && d.health.metrics_off_target === 1, "V2 heartbeats and metric breaches", d.health);
ok(d.spend && d.spend.ok === false && typeof d.spend.error === "string", "V3 an unreadable source is named in its own section", d.spend);
r = await get("/api/v3/readers");
d = await r.json();
ok(r.status === 200 && d.reach && d.reach.ok === false && d.content && d.content.ok === false, "V3 readers degrade per section, not as a whole page", d);
r = await get("/api/v3/now", { "x-loop-token": env.LOOP_TOKEN });
d = await r.json();
ok(d.needs.items[0].why.indexOf("IDENTITY-BOUND") === 0, "V2 the signed-in owner sees the detail");

// V4
r = await post("/api/v3/code", { text: "ls" });
ok(r.status === 401 && (await r.json()).need === "code", "V4 a stranger cannot run commands");
r = await get("/api/v3/code/cmd-0123456789abcdef0123");
ok(r.status === 401, "V4 a stranger cannot poll a run");
r = await post("/api/v3/code", { text: "list the workers", sid: "web-test1" }, { "x-loop-token": env.LOOP_TOKEN });
d = await r.json();
ok(r.status === 202 && /^cmd-[0-9a-f]{20}$/.test(d.id), "V4 the owner starts a run", d);
ok(calls.some((c) => c.b.op === "start" && c.b.run_id === d.id && c.b.sid === "web-test1" && c.b.max_iters >= 16), "V4 the run goes to the ops executor with the page's session id", calls);
r = await get("/api/v3/code/" + d.id, { "x-loop-token": env.LOOP_TOKEN });
const st = await r.json();
ok(st.status === "done" && st.reply === "listed" && st.steps[0].tool === "shell_exec", "V4 polling returns the steps and the reply", st);
const origFetch = env.SVC_QNFO_OPS.fetch;
env.SVC_QNFO_OPS.fetch = async (u, init) => { const b = init && init.body ? JSON.parse(init.body) : {}; return b.op === "result" ? new Response(JSON.stringify({ run: { status: "timeout", steps: [] } }), { status: 200 }) : origFetch(u, init); };
r = await get("/api/v3/code/" + d.id, { "x-loop-token": env.LOOP_TOKEN });
const st2 = await r.json();
ok(st2.status === "failed" && /timeout/.test(st2.error), "V4 an unknown executor status ends the poll as failed", st2);
env.SVC_QNFO_OPS.fetch = origFetch;
r = await post("/api/v3/warm", {}, { "x-loop-token": env.LOOP_TOKEN });
ok(r.status === 200, "V4 warm-up route answers");

// V6 (1.83.0) the Readers screen compares output with readership and reads the registry figures
ok(html.includes("Output vs readers") && /visits_per_publication/.test(src) && src.includes("FROM metric_registry WHERE metric IN ('pageviews_30d','referral_30d','publications_30d'"), "V6 Readers card compares papers published with referred visits");

// V5
r = await get("/classic");
ok(r.status === 200 && !(await r.text()).includes('id="n-code"'), "V5 /classic is still the old overview");
r = await get("/health");
ok(r.status === 200 && /^1\.(8[2-9]|9\d)\.\d+$/.test((await r.json()).version), "V5 version is at least 1.82.0");
ok(readFileSync(join(here, "deployed-current.worker.js"), "utf8") === src, "V5 mirror equals worker.js");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
