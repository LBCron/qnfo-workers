// RM-BS-FLEET-TWIN-1 offline suite (qnfo-deploy-guard 1.5.0). Drives the real fetch handler against an in-memory SQLite D1 and a map-backed KV.
// Proves GET /twin/baseline: the denominator is bp26_deploy_events without the retired root stub; the numerator is the revert issues scripts/canary_revert.py files
// (control-plane and probe reverts, a revert that did not repair, a probe failure that reverted nothing counted apart); a drill is counted apart; a revert before the
// first recorded deployment is listed and not counted; a restore time runs from the deployment before the revert was filed to the next one and a p95 needs five
// restores; the answer is cached for ten minutes and a database refusal is a 503 that caches nothing.
// Run: node qnfo-deploy-guard/twin-baseline.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });

const NOW = Date.parse("2026-11-05T04:00:00Z");
Date.now = () => NOW;
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000, DAY = 86_400_000;

function mk({ failD1 = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE bp26_deploy_events (deployment_id TEXT PRIMARY KEY, worker TEXT, created_on TEXT);
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, created_at INTEGER);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);`);
  const prep = (sql) => {
    let a = [];
    const q = {
      bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return q; },
      async all() { if (failD1) throw new Error("D1 DB is overloaded. Too many resources consumed within a 10 second window"); return { results: db.prepare(sql).all(...a) }; },
      async run() { return { success: true }; },
    };
    return q;
  };
  const kv = new Map();
  const KV = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); }, async list() { return { keys: [] }; } };
  return { env: { AUDIT: { prepare: prep }, FLEET_CONFIG: KV }, db, kv };
}
const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); }, passThroughOnException() {} };
const get = async (env, path) => { const r = await worker.fetch(new Request("https://qnfo-deploy-guard.q08.workers.dev" + path), env, ctx); const t = await r.text(); return { status: r.status, j: JSON.parse(t) }; };
let seq = 0;
const dep = (db, w, ms) => db.prepare("INSERT INTO bp26_deploy_events VALUES (?,?,?)").run("d" + ++seq, w, iso(ms).replace("Z", "123Z"));
const issue = (db, title, ms) => db.prepare("INSERT INTO agent_issues (id, title, created_at) VALUES (?,?,?)").run(1000000 + ++seq, title, ms);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };

// A. the denominator, the numerator and the restore time
{
  const { env, db } = mk();
  for (let i = 0; i < 20; i++) dep(db, "qnfo-a", NOW - 10 * DAY + i * 6 * 3600_000);
  for (let i = 0; i < 10; i++) dep(db, "qnfo-b", NOW - 9 * DAY + i * 6 * 3600_000);
  for (let i = 0; i < 50; i++) dep(db, "qnfo-workers", NOW - 9 * DAY + i * 3600_000); // the retired stub is no deploy of ours
  const filed = NOW - 3 * DAY;
  dep(db, "qnfo-a", filed - 30 * MIN); // the bad deploy
  dep(db, "qnfo-a", filed + 10 * MIN); // the restoring deploy
  issue(db, "CONTROL-PLANE-REVERTED-1: push 1234567 reverted, qnfo-a never reached the pushed VERSION", filed);
  db.prepare("INSERT INTO metric_registry VALUES ('change_failure_rate', '0.0009', '2026-11-05T03:22:25Z')").run();
  const r = await get(env, "/twin/baseline");
  ok(r.status === 200 && r.j.ok === true && r.j.window_days === 30, "A1 answers 200 with the default 30 day window");
  ok(r.j.deploys.in_window === 32 && r.j.deploys.workers === 2, "A2 the denominator counts qnfo-a and qnfo-b deployments and leaves out the stub (" + JSON.stringify(r.j.deploys) + ")");
  ok(r.j.reverts.real === 1 && r.j.reverts.drills === 0, "A3 one real revert");
  ok(r.j.change_failure_rate.excluding_drills === Math.round(1 / 32 * 100000) / 100000, "A4 change failure rate is reverts over deployments (" + r.j.change_failure_rate.excluding_drills + ")");
  ok(r.j.change_failure_rate.reverts_per_100_deploys === 3.13, "A5 reverts per 100 deploys (" + r.j.change_failure_rate.reverts_per_100_deploys + ")");
  const ev = r.j.events[0];
  ok(ev.worker === "qnfo-a" && ev.push === "1234567" && ev.restore_minutes_upper_bound === 40, "A6 restore runs from the deployment before the filing to the next one: 40 minutes (" + JSON.stringify(ev) + ")");
  ok(r.j.restore_minutes_upper_bound.n === 1 && r.j.restore_minutes_upper_bound.p95 === null, "A7 one restore gives no p95 (unknown is never a value)");
  ok(r.j.per_worker.find((x) => x.worker === "qnfo-a").reverts === 1, "A8 per worker reverts");
  ok(r.j.bp26_metrics.length === 1 && r.j.bp26_metrics[0].value === 0.0009, "A9 the BP26 metric reading is shown beside it");
  ok(r.j.cached === false, "A10 first answer is computed");
  const r2 = await get(env, "/twin/baseline");
  ok(r2.j.cached === true && r2.j.deploys.in_window === 32, "A11 the second answer within ten minutes comes from KV");
  const h = await get(env, "/health");
  ok(h.j.capabilities.includes("twin-baseline"), "A12 /health lists the capability");
}

// B. drills, failed reverts, probe failures, the second worker of one title, before the denominator, the CANARY-FAILED shapes
{
  const { env, db } = mk();
  for (let i = 0; i < 40; i++) dep(db, "qnfo-evolve", NOW - 20 * DAY + i * 12 * 3600_000);
  for (let i = 0; i < 40; i++) dep(db, "qnfo-x", NOW - 20 * DAY + i * 12 * 3600_000);
  issue(db, "DEPLOY-PROBE-REVERTED-1: push 49ce59b reverted, qnfo-evolve failed its post-deploy probes", NOW - 2 * DAY);
  issue(db, "DEPLOY-PROBE-REVERTED-1: push a339688 revert opened as a pull request, qnfo-evolve failed its post-deploy probes", NOW - 2 * DAY + 5 * MIN);
  issue(db, "CONTROL-PLANE-CANARY-FAILED-1: push abcdef1 failed its post-deploy probes on qnfo-x and could not be reverted", NOW - 5 * DAY);
  issue(db, "DEPLOY-PROBE-CANARY-FAILED-1: push abcdef2 reverted on main as 99999aa but the redeploy of qnfo-evolve, qnfo-x was not dispatched", NOW - 6 * DAY);
  issue(db, "DEPLOY-PROBE-FAILED-1: qnfo-x probe failing (pre-existing): GET https://qnfo-x.q08.workers.dev/y", NOW - 1 * DAY);
  issue(db, "CONTROL-PLANE-REVERTED-1: push 0ddba11 reverted, qnfo-old never reached the pushed VERSION", NOW - 25 * DAY); // before the first recorded deployment
  issue(db, "AI-1: something else entirely", NOW - 1 * DAY);
  const r = (await get(env, "/twin/baseline?days=30")).j;
  ok(r.reverts.drills === 2 && r.reverts.real === 0, "B1 both drill pushes are counted apart (" + JSON.stringify(r.reverts) + ")");
  ok(r.reverts.revert_failed === 3, "B2 a revert that did not repair counts (three: one single-worker, two workers in one title) (" + JSON.stringify(r.reverts) + ")");
  ok(r.reverts.probe_failures_filed_not_reverted === 1, "B3 a probe failure that reverted nothing is counted apart");
  ok(r.reverts.before_deploy_coverage === 1 && r.before_deploy_coverage[0].worker === "qnfo-old", "B4 a revert before the first recorded deployment is listed and not counted");
  ok(r.change_failure_rate.including_drills > r.change_failure_rate.excluding_drills, "B5 the rate with drills is higher than without");
  ok(r.events.filter((e) => e.kind === "revert-failed").every((e) => e.restore_minutes_upper_bound === null), "B6 a failed revert has no restore time");
  ok(r.events.filter((e) => e.drill).length === 2, "B7 events carry the drill flag");
}

// C. a p95 only from five real restores
{
  const { env, db } = mk();
  for (let i = 0; i < 40; i++) dep(db, "qnfo-p", NOW - 20 * DAY + 3 * 3600_000 + i * 12 * 3600_000);
  const mins = [5, 8, 10, 20, 90];
  mins.forEach((m, i) => {
    const filed = NOW - (15 - i) * DAY;
    dep(db, "qnfo-p", filed - m * MIN / 2);
    dep(db, "qnfo-p", filed + m * MIN / 2);
    issue(db, "CONTROL-PLANE-REVERTED-1: push 00000" + (10 + i) + " reverted, qnfo-p never reached the pushed VERSION", filed);
  });
  const r = (await get(env, "/twin/baseline")).j;
  ok(r.restore_minutes_upper_bound.n === 5 && r.restore_minutes_upper_bound.p95 === 90 && r.restore_minutes_upper_bound.p50 === 10, "C1 five restores give a p50 and a p95 (" + JSON.stringify(r.restore_minutes_upper_bound) + ")");
  ok(r.restore_minutes_upper_bound.max === 90, "C2 max");
}

// D. no later deployment, a gap of more than a day
{
  const { env, db } = mk();
  for (let i = 0; i < 12; i++) dep(db, "qnfo-q", NOW - 20 * DAY + i * 2 * DAY);
  issue(db, "CONTROL-PLANE-REVERTED-1: push 7777777 reverted, qnfo-q never reached the pushed VERSION", NOW - 7 * DAY + 3600_000);
  const r = (await get(env, "/twin/baseline")).j;
  ok(r.events[0].restore_minutes_upper_bound === null && /more than a day/.test(r.events[0].restore_status), "D1 a next deployment more than a day later is no restore time (" + JSON.stringify(r.events[0]) + ")");
}

// E. days clamp, database refusal caches nothing, an empty denominator is not cached
{
  const { env, db, kv } = mk();
  dep(db, "qnfo-e", NOW - DAY);
  ok((await get(env, "/twin/baseline?days=1")).j.window_days === 7, "E1 days below 7 are 7");
  ok((await get(env, "/twin/baseline?days=999")).j.window_days === 40, "E2 days above 40 are 40 (the table keeps 40 days)");
  ok((await get(env, "/twin/baseline?days=abc")).j.window_days === 30, "E3 a non-number is 30");
  const bad = mk({ failD1: true });
  const r = await get(bad.env, "/twin/baseline");
  ok(r.status === 503 && r.j.error === "twin_db_unavailable" && bad.kv.size === 0, "E4 an overloaded database is a 503 and caches nothing");
  const empty = mk();
  const r0 = await get(empty.env, "/twin/baseline");
  ok(r0.status === 200 && r0.j.deploys.in_window === 0 && r0.j.change_failure_rate.excluding_drills === null && empty.kv.size === 0, "E5 no deployments: rate is null, nothing is cached");
  void kv;
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
