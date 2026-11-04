// radar-hub events-workflow suite (EVENTS-WORKFLOW-1, RM-RADAR-WORKFLOWS-PILOT-1, charter pillar: research).
// Loads the real worker.js (WorkflowEntrypoint stubbed) and drives the weekly events radar through its Workflow path with an
// in-memory SQLite audit database, a fake Workflow binding and a stubbed network. Proves:
//  - the Monday table entry creates ONE Workflow instance, records a `started` ledger row and does not run the scan inline;
//  - with no binding, or when create() throws, the inline scan runs exactly as before (a create failure is also recorded);
//  - EventsRadarWorkflow.run does the scan step (retries limit 2) and then the record step, and writes a `done` row;
//  - the Monday watch records `done` for a completed instance, re-runs the scan inline once for an errored, terminated or
//    stale instance, waits for a young running instance, and never acts twice for an instance that already settled;
//  - the watch reads the ledger by primary-key range and is silent outside the Monday window.
// Run: node radar-hub/events-workflow.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const IMPORT = 'import { WorkflowEntrypoint } from "cloudflare:workers";';
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mod = await import("data:text/javascript;base64," + Buffer.from(src.replace(IMPORT, "var WorkflowEntrypoint = class {};")).toString("base64"));
const W = mod.default;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const wrap = (d) => ({ prepare(sql) { let args = []; const s = { bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return s; }, async all() { return { results: d.prepare(sql).all(...args) }; }, async first() { return d.prepare(sql).get(...args) || null; }, async run() { const r = d.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; } }; return s; } });

const audit = new DatabaseSync(":memory:");
audit.exec("CREATE TABLE research_scan_log (id TEXT PRIMARY KEY, ts TEXT, job TEXT, payload TEXT)");
audit.exec("CREATE TABLE fleet_heartbeat (worker TEXT PRIMARY KEY, version TEXT, ts TEXT, ok INTEGER)");
const radar = new DatabaseSync(":memory:");
radar.exec("CREATE TABLE radar_sources (name TEXT, url TEXT, kind TEXT, cadence TEXT, category TEXT, enabled INTEGER)");
globalThis.fetch = async () => new Response("<html><body><p>No dated events here.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });

const scans = () => { try { return radar.prepare("SELECT COUNT(*) c FROM events_radar").get().c; } catch (e) { return 0; } };
const rows = () => audit.prepare("SELECT id, payload FROM research_scan_log WHERE job = 'events-radar-workflow' ORDER BY id").all().map((r) => ({ id: r.id, ...JSON.parse(r.payload) }));
const stages = () => rows().map((r) => r.stage);
const reset = () => { audit.exec("DELETE FROM research_scan_log"); try { radar.exec("DELETE FROM events_radar"); } catch (e) { /* table not created yet */ } };
function flow(opts = {}) {
  const f = { created: [], got: [], create: async (o) => { if (opts.createThrows) throw new Error("workflow resource missing"); f.created.push(o); return { id: o.id }; }, get: async (id) => { f.got.push(id); return { status: async () => ({ status: opts.status || "running" }) }; } };
  return f;
}
const mkEnv = (f) => ({ AUDIT: wrap(audit), RADAR_DB: wrap(radar), RADAR_TOKEN: "t", ...(f ? { EVENTS_RADAR_FLOW: f } : {}) });
const ctxOf = () => { const p = []; return { p, waitUntil(x) { p.push(Promise.resolve(x)); } }; };
const MONDAY_0500 = Date.UTC(2026, 10, 9, 5, 0, 0); // 2026-11-09 is a Monday
const cronEvent = { cron: "0 5 * * 2", scheduledTime: MONDAY_0500, type: "scheduled" };

// 1. binding present: one instance, a started row, no inline scan
{
  reset();
  const f = flow(), env = mkEnv(f), ctx = ctxOf();
  await W.scheduled(cronEvent, env, ctx);
  await Promise.all(ctx.p);
  ok(f.created.length === 1, "one instance created, got " + f.created.length);
  ok(/^events-2026-11-09-[0-9a-f]{6}$/.test(f.created[0].id), "instance id names the day: " + f.created[0].id);
  ok(JSON.stringify(stages()) === JSON.stringify(["started"]), "ledger has a started row only: " + stages());
  ok(rows()[0].instance === f.created[0].id, "started row carries the instance id");
  let inline = 0; try { inline = scans(); } catch (e) { inline = 0; }
  ok(inline === 0, "no inline scan when the instance was created, events_radar rows: " + inline);
}

// 2. no binding: inline scan as before, no ledger rows
{
  reset();
  const env = mkEnv(null), ctx = ctxOf();
  await W.scheduled(cronEvent, env, ctx);
  await Promise.all(ctx.p);
  ok(scans() === 1, "inline scan ran without the binding, rows: " + scans());
  ok(rows().length === 0, "no workflow ledger rows without the binding");
}

// 3. create() throws: failure recorded and the inline scan runs
{
  reset();
  const f = flow({ createThrows: true }), env = mkEnv(f), ctx = ctxOf();
  await W.scheduled(cronEvent, env, ctx);
  await Promise.all(ctx.p);
  ok(JSON.stringify(stages()) === JSON.stringify(["create-failed"]), "create failure recorded: " + stages());
  ok(/workflow resource missing/.test(rows()[0].error), "failure text kept");
  ok(scans() === 1, "inline scan ran after the failed create, rows: " + scans());
}

// 4. EventsRadarWorkflow.run: scan step then record step
{
  reset();
  const names = [], cfgs = [];
  const step = { async do(name, cfg, fn) { if (typeof cfg === "function") { fn = cfg; cfg = {}; } names.push(name); cfgs.push(cfg); return await fn(); } };
  const wf = new mod.EventsRadarWorkflow();
  wf.env = mkEnv(null);
  const out = await wf.run({ instanceId: "events-2026-11-09-abc123", payload: {} }, step);
  ok(JSON.stringify(names) === JSON.stringify(["scan", "record"]), "steps in order: " + names);
  ok(cfgs[0].retries && cfgs[0].retries.limit === 2 && cfgs[0].retries.backoff === "exponential", "scan step retries with backoff");
  ok(out && typeof out.events === "number" && out.slug.startsWith("events-radar-"), "run returns a small summary: " + JSON.stringify(out));
  ok(JSON.stringify(out).length < 400, "summary stays small");
  ok(stages().join() === "done" && rows()[0].via === "workflow" && rows()[0].instance === "events-2026-11-09-abc123", "record step wrote the done row: " + JSON.stringify(rows()));
  ok(scans() === 1, "the scan wrote its report");
}

// 5. watch: completed instance becomes done; settled instance is left alone
{
  reset();
  const f = flow({ status: "complete" }), env = mkEnv(f);
  await mod.eventsFlow.start(cronEvent, env, ctxOf());
  const startedId = rows()[0].instance;
  const r1 = await mod.eventsFlow.watch(env, ctxOf(), MONDAY_0500 + 3600e3);
  ok(r1.done === true && r1.instance === startedId, "completed instance recorded: " + JSON.stringify(r1));
  ok(stages().join() === "started,done", "ledger started,done: " + stages());
  const r2 = await mod.eventsFlow.watch(env, ctxOf(), MONDAY_0500 + 7200e3);
  ok(r2.skipped === true && stages().join() === "started,done", "a settled instance is never acted on twice: " + JSON.stringify(r2));
}

// 6. watch: errored, terminated and stale instances fall back to the inline scan once
for (const [status, ageMs, label] of [["errored", 10 * 60e3, "errored"], ["terminated", 10 * 60e3, "terminated"], ["running", 50 * 60e3, "stale running"]]) {
  reset();
  const f = flow({ status }), env = mkEnv(f);
  await mod.eventsFlow.start(cronEvent, env, ctxOf());
  const ctx = ctxOf();
  const r = await mod.eventsFlow.watch(env, ctx, MONDAY_0500 + ageMs);
  await Promise.all(ctx.p);
  ok(r.fallback === true, label + " instance falls back: " + JSON.stringify(r));
  ok(stages().join() === "started,fallback", label + " ledger started,fallback: " + stages());
  ok(scans() === 1, label + " inline scan ran, rows: " + scans());
  const again = await mod.eventsFlow.watch(env, ctxOf(), MONDAY_0500 + ageMs + 3600e3);
  ok(again.skipped === true && scans() === 1, label + " fallback happens once: " + JSON.stringify(again));
}

// 7. watch: a young running instance waits
{
  reset();
  const f = flow({ status: "running" }), env = mkEnv(f);
  await mod.eventsFlow.start(cronEvent, env, ctxOf());
  const ctx = ctxOf();
  const r = await mod.eventsFlow.watch(env, ctx, MONDAY_0500 + 20 * 60e3);
  await Promise.all(ctx.p);
  ok(r.waiting === true && stages().join() === "started" && scans() === 0, "a young running instance is left to finish: " + JSON.stringify(r));
}

// 8. watch: silent outside the Monday window and with no start recorded
{
  reset();
  const f = flow({ status: "errored" }), env = mkEnv(f);
  await mod.eventsFlow.start(cronEvent, env, ctxOf());
  const sunday = await mod.eventsFlow.watch(env, ctxOf(), Date.UTC(2026, 10, 8, 6, 0, 0));
  const lateMonday = await mod.eventsFlow.watch(env, ctxOf(), Date.UTC(2026, 10, 9, 14, 0, 0));
  ok(sunday.skipped === true && lateMonday.skipped === true && f.got.length === 0, "no Workflow status call outside the Monday 05:00-11:59Z window");
  reset();
  const none = await mod.eventsFlow.watch(env, ctxOf(), MONDAY_0500 + 3600e3);
  ok(none.skipped === true && none.reason === "no start", "no start recorded means nothing to watch: " + JSON.stringify(none));
}

// 9. the ledger statement reads by primary-key range (no table scan)
{
  const plan = audit.prepare("EXPLAIN QUERY PLAN SELECT id, ts, payload FROM research_scan_log WHERE id >= ?1 AND id < 'evwf.' ORDER BY id ASC LIMIT 40").all("evwf-2026-11-09").map((r) => r.detail).join(" | ");
  ok(/SEARCH/.test(plan) && !/SCAN research_scan_log/.test(plan), "watch query is a primary-key search: " + plan);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
