// SECRET-CHANGE-WATCH-1 offline suite (qnfo-ops 2.38.39).
// Loads the real worker.js (the cloudflare:workers import swapped for stubs) and drives its scheduled handler against an
// in-memory SQLite qnfo-audit and a scripted Cloudflare API. Proves: a secret-triggered version inside the look-back
// window is recorded once in cloud_ops_events (worker, version, time; never a value) and opens one agent_issues row
// keyed to the change day that names the current secrets; old secret changes and code uploads are ignored; a second tick
// adds no duplicate event or issue; every tick writes a secret-watch-tick heartbeat; without CF_API_TOKEN the cron still
// completes and writes nothing.
// Run: node qnfo-ops/secret-watch.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const IMPORT = 'import { WorkflowEntrypoint, DurableObject, tracing } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
if (src.indexOf(IMPORT) < 0) throw new Error("worker.js import line changed: update the loader in this test");
const stubbed = src.replace(IMPORT, "var WorkflowEntrypoint = class {}; var DurableObject = class {}; var tracing = { enterSpan(_name, callback) { return callback({ setAttribute() {} }); } };");
const W = (await import("data:text/javascript;base64," + Buffer.from(stubbed).toString("base64"))).default;

const say = console.log.bind(console);
console.log = () => {};
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; say("FAIL " + m); } };

const SECRET_VALUE = "never-printed-Zx9Qw7Er5Ty3Ui1Op8As6Df";
const recent = new Date(Date.now() - 40 * 60e3).toISOString();
const recent2 = new Date(Date.now() - 38 * 60e3).toISOString();
const old = new Date(Date.now() - 30 * 3600e3).toISOString();

function d1(db) {
  const prep = (sql) => {
    let a = [];
    const q = {
      bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return q; },
      async all() { return { results: db.prepare(sql).all(...a) }; },
      async first() { return db.prepare(sql).get(...a) || null; },
      async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
    };
    return q;
  };
  return { prepare: prep, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

// BINDING-PROPS-RESTORE-1 fixtures: fx.toml is qnfo-ops/wrangler.toml on main (null = 404), fx.liveProps the props the live
// SVC_QNFO_AI binding carries (undefined = none). Dispatches of canonical-deploy.yml are recorded in t.dispatches.
const TOML_PROPS = 'name = "qnfo-ops"\n\n[[services]]\nbinding = "SVC_QNFO_AI"\nservice = "qnfo-ai"\n# INTERNAL-CALLER-PROPS-1\nprops = { caller = "qnfo-ops" }\n\n[[d1_databases]]\nbinding = "QNFO_AUDIT"\ndatabase_id = "x"\n';
function mk(env = {}, fx = {}) {
  const db = new DatabaseSync(":memory:");
  const dispatches = [];
  db.exec(`CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE ops_jobs (id TEXT PRIMARY KEY, status TEXT, error TEXT, updated_at TEXT);`);
  const calls = [];
  globalThis.fetch = async (u, o) => {
    const url = String(u && u.url || u);
    calls.push(url);
    const J = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (/\/workers\/scripts$/.test(url)) return J({ result: [{ id: "qnfo-ops" }, { id: "qnfo-ai" }, { id: "qnfo-email" }] });
    if (/\/scripts\/qnfo-ops\/versions/.test(url)) return J({ result: { items: [
      { number: 436, metadata: { created_on: recent2, source: "api" }, annotations: { "workers/triggered_by": "upload" } },
      { number: 435, metadata: { created_on: recent2, source: "api" }, annotations: { "workers/triggered_by": "secret" } },
      { number: 434, metadata: { created_on: recent, source: "api" }, annotations: { "workers/triggered_by": "secret" } }] } });
    if (/\/scripts\/qnfo-ai\/versions/.test(url)) return J({ result: { items: [{ number: 90, metadata: { created_on: old, source: "api" }, annotations: { "workers/triggered_by": "secret" } }] } });
    if (/\/scripts\/qnfo-email\/versions/.test(url)) return J({ result: { items: [{ number: 12, metadata: { created_on: recent, source: "wrangler" }, annotations: { "workers/triggered_by": "upload" } }] } });
    if (/\/scripts\/qnfo-ops\/secrets/.test(url)) return J({ result: [{ name: "OPS_ROUTER_AUTH_KEY", type: "secret_text", value: SECRET_VALUE }, { name: "OPS_ROUTER_AUTH_KEY_2", type: "secret_text" }] });
    if (/api\.github\.com\/repos\/QNFO\/qnfo-workers\/contents\/qnfo-ops\/wrangler\.toml/.test(url)) return fx.toml == null ? new Response("nf", { status: 404 }) : new Response(fx.toml, { status: 200 });
    if (/\/scripts\/qnfo-ops\/settings$/.test(url)) return J({ result: { bindings: [Object.assign({ type: "service", name: "SVC_QNFO_AI", service: "qnfo-ai" }, fx.liveProps ? { props: fx.liveProps } : {}), { type: "d1", name: "QNFO_AUDIT" }] } });
    if (/\/actions\/workflows\/canonical-deploy\.yml\/dispatches$/.test(url)) { dispatches.push({ method: o && o.method, body: JSON.parse(o && o.body || "{}"), auth: !!(o && o.headers && o.headers.Authorization) }); return new Response(null, { status: 204 }); }
    return new Response("{}", { status: 503 });
  };
  return { db, calls, dispatches, env: Object.assign({ QNFO_AUDIT: d1(db), CF_API_TOKEN: "cf-test", GITHUB_TOKEN: "gh-test" }, env) };
}
const tick = async (t) => {
  const pending = [];
  await W.scheduled({ cron: "*/30 * * * *", scheduledTime: Date.now() }, t.env, { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); } });
  await Promise.allSettled(pending);
};

// A. one tick records the recent secret changes and opens one issue.
{
  const t = mk();
  await tick(t);
  const ev = t.db.prepare("SELECT id, ts, text, meta FROM cloud_ops_events WHERE kind = 'secret-change' ORDER BY id").all();
  ok(ev.length === 2 && ev.map((r) => r.id).join(",") === "secret-change-qnfo-ops-434,secret-change-qnfo-ops-435", "A two recent qnfo-ops secret versions recorded: " + JSON.stringify(ev.map((r) => r.id)));
  ok(!ev.some((r) => /qnfo-ai|qnfo-email/.test(r.id)), "A old secret change and code uploads ignored");
  const iss = t.db.prepare("SELECT title, description, category, priority, status FROM agent_issues").all();
  ok(iss.length === 1 && iss[0].title === "SECRET-CHANGE-OBSERVED: qnfo-ops " + recent.slice(0, 10), "A one issue keyed to the change day: " + JSON.stringify(iss.map((r) => r.title)));
  ok(iss[0] && /OPS_ROUTER_AUTH_KEY, OPS_ROUTER_AUTH_KEY_2/.test(iss[0].description) && /versions 434, 435/.test(iss[0].description), "A issue names the current secrets and the versions");
  ok(iss[0] && /Current secret bindings \(not necessarily the changed binding; the version metadata does not identify which binding changed\):/.test(iss[0].description), "A distinguishes current binding inventory from the changed binding");
  ok(iss[0] && iss[0].status === "open" && iss[0].category === "security", "A issue is open, category security");
  const all = JSON.stringify(t.db.prepare("SELECT * FROM cloud_ops_events").all()) + JSON.stringify(iss);
  ok(all.indexOf(SECRET_VALUE) < 0, "A no secret value stored anywhere");
  const hb = t.db.prepare("SELECT status, text FROM cloud_ops_events WHERE kind = 'secret-watch-tick'").all();
  ok(hb.length === 1 && hb[0].status === "ok" && /3 scripts, 2 secret change/.test(hb[0].text), "A heartbeat written: " + JSON.stringify(hb));
  ok(t.dispatches.length === 0 && t.db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'binding-props-restore'").get().n === 0, "A a worker without wrangler.toml props on main gets no redeploy");

  // B. a second tick adds nothing new except its heartbeat.
  await tick(t);
  ok(t.db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'secret-change'").get().n === 2, "B no duplicate events");
  ok(t.db.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n === 1, "B no duplicate issue");
  ok(t.db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'secret-watch-tick'").get().n === 2, "B second heartbeat");
}

// C. without CF_API_TOKEN the cron completes and the watcher writes nothing.
{
  const t = mk({ CF_API_TOKEN: undefined });
  let threw = null;
  try { await tick(t); } catch (e) { threw = e; }
  ok(!threw, "C cron completes without CF_API_TOKEN");
  ok(t.db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind IN ('secret-change', 'secret-watch-tick')").get().n === 0, "C nothing written without the token");
  ok(!t.calls.some((u) => /\/versions/.test(u)), "C no Cloudflare version reads without the token");
}

// D. BINDING-PROPS-RESTORE-1 (agent_issues 2445): the secret version left the declared props off the live service binding ->
// one canonical-deploy dispatch for the worker, recorded once; the next tick dispatches nothing more for the same version.
{
  const t = mk({}, { toml: TOML_PROPS });
  await tick(t);
  ok(t.dispatches.length === 1 && t.dispatches[0].method === "POST" && t.dispatches[0].auth && t.dispatches[0].body.ref === "main" && t.dispatches[0].body.inputs.workers === "qnfo-ops", "D canonical-deploy.yml dispatched once with workers=qnfo-ops: " + JSON.stringify(t.dispatches));
  const ev = t.db.prepare("SELECT id, status, text, meta FROM cloud_ops_events WHERE kind = 'binding-props-restore'").all();
  ok(ev.length === 1 && ev[0].id === "binding-props-restore-qnfo-ops-435" && ev[0].status === "dispatched" && /SVC_QNFO_AI/.test(ev[0].text) && JSON.parse(ev[0].meta).dispatch_http === 204, "D one ledger row keyed to the worker and the newest secret version: " + JSON.stringify(ev));
  ok(t.calls.some((u) => /\/scripts\/qnfo-ops\/settings$/.test(u)) && !t.calls.some((u) => /PATCH/.test(u)), "D the live settings were read (GET only)");
  ok(JSON.stringify(ev).indexOf(SECRET_VALUE) < 0, "D no secret value in the ledger");
  await tick(t);
  ok(t.dispatches.length === 1 && t.db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'binding-props-restore'").get().n === 1, "D a second tick dispatches nothing more for the same secret version");
}
// E. the live binding already carries the declared props -> nothing to restore, no dispatch, no row.
{
  const t = mk({}, { toml: TOML_PROPS, liveProps: { caller: "qnfo-ops" } });
  await tick(t);
  ok(t.dispatches.length === 0 && t.db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'binding-props-restore'").get().n === 0, "E matching live props: no redeploy");
}
// F. props differ (a stale caller) -> restored like missing props.
{
  const t = mk({}, { toml: TOML_PROPS, liveProps: { caller: "someone-else" } });
  await tick(t);
  ok(t.dispatches.length === 1, "F differing props are restored too");
}
// G. without GITHUB_TOKEN the row records the missing token and nothing is dispatched.
{
  const t = mk({ GITHUB_TOKEN: undefined }, { toml: TOML_PROPS });
  await tick(t);
  const ev = t.db.prepare("SELECT status, text FROM cloud_ops_events WHERE kind = 'binding-props-restore'").all();
  ok(t.dispatches.length === 0 && ev.length === 1 && ev[0].status === "error" && /no GITHUB_TOKEN/.test(ev[0].text), "G no token: recorded as error, not dispatched: " + JSON.stringify(ev));
}

say(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
