// COST-QUALITY-FLOOR-ENFORCE-1 offline suite (qnfo-ai 5.40.0, 2026-10-26, pillar cost; agent_issues 1000408; OWNER_DIRECTIVE_2026_10_21_COST_QUALITY_1:
// "quality may not be reduced to cut cost; prefer lower-cost paths only when quality is preserved").
// The router downgrades a model at a breached spend cap in three places: spendGovern (the route gate), spendGovernWA (the Workers AI chokepoint) and fleetSteerRun (the fleet-cap twin
// switch). The worker's own source runs in a vm with a fake D1. Proves, for each of the three points, that the downgrade is lifted while v_output_quality_headline.worse is above 0 and is
// still made when worse is 0; that the lift is named in the ledger reason / _router.quality_floor; that the read is cached, retried after a failure but not on every request, keeps its last
// known value when a read fails, and that a missing binding or a failed read never stops work; and that the SELECT names only columns the view has (5.39.11 asked for updated_at, which the view
// does not have, so the check failed on every call and never applied).
// Run: node qnfo-ai/quality-floor.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
const a1 = src.indexOf("var SPEND_DEFAULT_CAPS"), b1 = src.indexOf("// Chokepoint for direct-key / gateway calls");
const a2 = src.indexOf("// ---- FLEET-CAP-STEER-BEGIN"), b2 = src.indexOf("// ---- FLEET-CAP-STEER-END ----");
if (a1 < 0 || b1 < a1 || a2 < 0 || b2 < a2) throw new Error("spend governor or FLEET-CAP-STEER block not found");
const logs = [];
const rates = JSON.parse("{" + /var __AI_ATTR_RATES = \{([^\n]*)\};/.exec(src)[1] + "}");
const sb = { console: { warn: (s) => logs.push(["warn", s]), error: (s) => logs.push(["error", s]), log() {} }, Math, Number, String, Object, JSON, Array, Date, Promise, isFinite, VERSION: "test", __AI_ATTR_RATES: rates, estimateInputTokens: () => 0, internalCaller: () => "", d1AttrWriteSkip: () => false, d1OverloadTrip: () => false };
vm.createContext(sb);
vm.runInContext(src.slice(a1, b1) + "\n" + src.slice(a2, b2) + "\n;__x = { spendGovern, spendGovernWA, spendQualityBlock, fleetSteerRun, SPEND_CHEAP_MODEL, SPEND_CHEAP_WA, QUALITY_FLOOR_TTL_MS, QUALITY_FLOOR_RETRY_MS };", sb);
const X = sb.__x;
const reset = () => { vm.runInContext("__qualityFloor = { at: 0, worse: 0, err: null }; __fleetSteer = { at: 0, st: null }; __spendState = { at: 0, by: {}, pending: {}, ensured: false, err: null, account: null, accountAt: 0 };", sb); logs.length = 0; };
const expire = () => vm.runInContext("__qualityFloor.at = 1;", sb);
const floor = () => vm.runInContext("__qualityFloor", sb);

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 500) : "")); } };

// A fake D1. o.worse: the headline row (undefined = no row); o.qThrows: that read fails; o.spend: {provider: usd30d}; o.budget: fleet_budget rows.
function fakeDb(o) {
  o = o || {};
  const writes = [], reads = { quality: 0 };
  const stmt = (sql) => {
    let args = [];
    const s = {
      bind: (...xs) => { args = xs; return s; },
      first: async () => {
        if (/FROM output_quality_headline_cache/.test(sql)) { reads.quality++; if (o.qThrows) throw new Error("no such column: updated_at"); return o.worse === undefined ? null : { worse: o.worse }; }
        return null;
      },
      all: async () => {
        if (/FROM ai_spend_ledger/.test(sql)) return { results: Object.entries(o.spend || {}).map(([provider, usd]) => ({ provider, usd })) };
        if (/FROM fleet_budget/.test(sql)) return { results: o.budget || [] };
        return { results: [] };
      },
      run: async () => { if (o.runThrows && /ai_call_counters/.test(sql)) throw new Error("counter write refused"); writes.push({ sql, args }); return { success: true }; },
    };
    return s;
  };
  return { prepare: stmt, writes, reads };
}
const caps = { SPEND_CAP_WORKERS_AI_USD: "35", SPEND_CAP_TOTAL_USD: "60" };
const mkEnv = (db, extra) => Object.assign({ QNFO_AUDIT: db, __spendCaller: "idea-hub", __spendCtx: { waitUntil() {} }, __fleetSteers: [], __qualityLifts: [] }, caps, extra || {});
const PREMIUM = "@cf/moonshotai/kimi-k2.6";
ok(rates[PREMIUM] && rates["@cf/zai-org/glm-5.3"] && rates["@cf/zai-org/glm-5.3-flash"], "the rate table has the models these cases use");
const ledgerDowngrades = (db) => db.writes.filter((w) => /INSERT INTO ai_spend_ledger/.test(w.sql) && w.args[8] === 1);

// 1. spendGovern, the route gate.
{
  reset();
  let db = fakeDb({ spend: { "workers-ai": 40 }, worse: 0 });
  let env = mkEnv(db);
  let d = await X.spendGovern(env, "workers-ai", PREMIUM, false);
  ok(d.action === "downgrade" && d.to === X.SPEND_CHEAP_MODEL, "worse = 0: spendGovern still downgrades a premium model at the soft threshold", d);
  ok(env.__qualityLifts.length === 0 && !/quality floor/.test(d.reason), "worse = 0: nothing is named as lifted", { d, lifts: env.__qualityLifts });

  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2 });
  env = mkEnv(db);
  d = await X.spendGovern(env, "workers-ai", PREMIUM, false);
  ok(d.action === "allow" && d.to === undefined && d.noEnsemble === false, "worse > 0: spendGovern lifts the downgrade and serves the requested model", d);
  ok(/quality floor: output quality fell \(v_output_quality_headline worse 2\), downgrade lifted/.test(d.reason) && /workers-ai 30d spend 40\.00/.test(d.reason), "worse > 0: the ledger reason names the quality floor and keeps the cap reason", d.reason);
  ok(env.__qualityLifts.length === 1 && env.__qualityLifts[0].point === "spendGovern", "worse > 0: _router.quality_floor carries the lift", env.__qualityLifts);
  ok(ledgerDowngrades(db).length === 0, "worse > 0: no downgrade row is written to the spend ledger", ledgerDowngrades(db));

  // an ensemble collapse is a downgrade too
  reset();
  db = fakeDb({ spend: { "workers-ai": 30 }, worse: 1 });
  env = mkEnv(db);
  d = await X.spendGovern(env, "workers-ai", "ensemble", true);
  ok(d.action === "allow" && d.noEnsemble === false, "worse > 0: an ensemble keeps its layers (the collapse is lifted)", d);
  reset();
  db = fakeDb({ spend: { "workers-ai": 30 }, worse: 0 });
  d = await X.spendGovern(mkEnv(db), "workers-ai", "ensemble", true);
  ok(d.action === "downgrade" && d.noEnsemble === true, "worse = 0: the ensemble still collapses to one cheap leg", d);

  // over the total cap: still never a refusal, still lifted by the floor
  reset();
  db = fakeDb({ spend: { "workers-ai": 61 }, worse: 3 });
  d = await X.spendGovern(mkEnv(db), "workers-ai", PREMIUM, false);
  ok(d.action === "allow", "worse > 0 over the total cap: allowed, never refused", d);
  reset();
  db = fakeDb({ spend: { "workers-ai": 61 }, worse: 0 });
  d = await X.spendGovern(mkEnv(db), "workers-ai", PREMIUM, false);
  ok(d.action === "downgrade", "worse = 0 over the total cap: downgraded as before, never refused", d);

  // under every cap nothing changes and nothing is read
  reset();
  db = fakeDb({ spend: { "workers-ai": 1 }, worse: 5 });
  d = await X.spendGovern(mkEnv(db), "workers-ai", PREMIUM, false);
  ok(d.action === "allow" && db.reads.quality === 0, "under the caps there is no downgrade to lift and no quality read", { d, reads: db.reads });
}

// 2. spendGovernWA, the Workers AI chokepoint.
{
  reset();
  let db = fakeDb({ spend: { "workers-ai": 40 }, worse: 0 });
  let env = mkEnv(db);
  let m = await X.spendGovernWA(env, PREMIUM);
  ok(m === X.SPEND_CHEAP_WA, "worse = 0: spendGovernWA serves the cheap model for a premium one at the soft threshold", m);
  ok(ledgerDowngrades(db).length === 1, "worse = 0: the downgrade is recorded in the ledger", ledgerDowngrades(db));

  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2 });
  env = mkEnv(db);
  m = await X.spendGovernWA(env, PREMIUM);
  ok(m === PREMIUM, "worse > 0: spendGovernWA returns the requested model", m);
  ok(ledgerDowngrades(db).length === 0, "worse > 0: no downgrade is recorded", ledgerDowngrades(db));
  ok(env.__qualityLifts.length === 1 && env.__qualityLifts[0].point === "spendGovernWA" && env.__qualityLifts[0].model === PREMIUM && /quality floor/.test(env.__qualityLifts[0].reason), "worse > 0: the lift is named with its point and model", env.__qualityLifts);

  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2 });
  m = await X.spendGovernWA(mkEnv(db), X.SPEND_CHEAP_WA);
  ok(m === X.SPEND_CHEAP_WA && db.reads.quality === 0, "a call already on the cheap model needs no quality read", { m, reads: db.reads });
  reset();
  db = fakeDb({ spend: { "workers-ai": 1 }, worse: 2 });
  m = await X.spendGovernWA(mkEnv(db), PREMIUM);
  ok(m === PREMIUM && db.reads.quality === 0, "under the caps the model is served and nothing is read", { m, reads: db.reads });
}

// 3. fleetSteerRun, the fleet-cap twin switch.
{
  const GLM = "@cf/zai-org/glm-5.3", FLASH = "@cf/zai-org/glm-5.3-flash";
  const breached = [{ node_class: "ai_spend:workers-ai", cap: 95, current: 113.07 }];
  const ANS = (t) => ({ choices: [{ message: { content: t } }] });
  const runner = () => { const calls = []; return { calls, run: async (m) => { calls.push(m); return ANS(m === FLASH ? "flash" : "glm"); } }; };

  reset();
  let db = fakeDb({ budget: breached, worse: 0 });
  let env = mkEnv(db);
  let r = runner();
  let out = await X.fleetSteerRun(env, GLM, false, r.run);
  ok(r.calls.join() === FLASH && out.choices[0].message.content === "flash", "worse = 0: over the fleet cap the twin still answers", r.calls);
  ok(env.__fleetSteers.length === 1 && env.__qualityLifts.length === 0, "worse = 0: the switch is recorded, nothing is lifted", { steers: env.__fleetSteers, lifts: env.__qualityLifts });

  reset();
  db = fakeDb({ budget: breached, worse: 2 });
  env = mkEnv(db);
  r = runner();
  out = await X.fleetSteerRun(env, GLM, false, r.run);
  ok(r.calls.join() === GLM && out.choices[0].message.content === "glm", "worse > 0: the requested model answers and the twin is not called", r.calls);
  ok(env.__fleetSteers.length === 0, "worse > 0: no switch is recorded", env.__fleetSteers);
  ok(env.__qualityLifts.length === 1 && env.__qualityLifts[0].point === "fleetSteerRun" && env.__qualityLifts[0].model === GLM && new RegExp(FLASH).test(env.__qualityLifts[0].reason), "worse > 0: the lift names the point, the model and the unused twin", env.__qualityLifts);
  ok(!db.writes.some((w) => /INSERT INTO ai_call_counters/.test(w.sql) && w.args[1] === "fleet-cap-steer"), "worse > 0: no steer outcome is counted", db.writes.map((w) => w.args));

  reset();
  db = fakeDb({ budget: [{ node_class: "ai_spend:workers-ai", cap: 95, current: 80 }], worse: 2 });
  r = runner();
  await X.fleetSteerRun(mkEnv(db), GLM, false, r.run);
  ok(r.calls.join() === GLM && db.reads.quality === 0, "under the fleet cap there is no switch to lift and no quality read", { calls: r.calls, reads: db.reads });
}

// 3b. Every lift and every read leaves a counter row (QUALITY-FLOOR-RECORD-1, 5.40.1).
{
  const counters = (db) => db.writes.filter((w) => /INSERT INTO ai_call_counters/.test(w.sql)).map((w) => ({ purpose: w.args[1], model: w.args[2], failed: w.args[3] }));
  reset();
  let db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2 });
  await X.spendGovern(mkEnv(db), "workers-ai", PREMIUM, false);
  let c = counters(db);
  ok(c.some((x) => x.purpose === "quality-floor-lift:spendGovern" && x.model === PREMIUM && x.failed === 0), "a lift at spendGovern is counted by point and requested model", c);
  ok(c.filter((x) => x.purpose === "quality-floor-read").length === 1 && c.find((x) => x.purpose === "quality-floor-read").failed === 0 && c.find((x) => x.purpose === "quality-floor-read").model === "v_output_quality_headline", "the read is counted once, without an error", c);
  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2 });
  await X.spendGovernWA(mkEnv(db), PREMIUM);
  ok(counters(db).some((x) => x.purpose === "quality-floor-lift:spendGovernWA" && x.model === PREMIUM), "a lift at spendGovernWA is counted", counters(db));
  reset();
  db = fakeDb({ budget: [{ node_class: "ai_spend:workers-ai", cap: 95, current: 113.07 }], worse: 2 });
  await X.fleetSteerRun(mkEnv(db), "@cf/zai-org/glm-5.3", false, async () => ({ choices: [{ message: { content: "x" } }] }));
  ok(counters(db).some((x) => x.purpose === "quality-floor-lift:fleetSteerRun" && x.model === "@cf/zai-org/glm-5.3"), "a lift at fleetSteerRun is counted", counters(db));
  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 0 });
  await X.spendGovernWA(mkEnv(db), PREMIUM);
  ok(!counters(db).some((x) => /^quality-floor-lift/.test(x.purpose)), "a downgrade that is not lifted is not counted as a lift", counters(db));
  reset();
  db = fakeDb({ qThrows: true });
  await X.spendQualityBlock(mkEnv(db));
  ok(counters(db).length === 1 && counters(db)[0].purpose === "quality-floor-read" && counters(db)[0].failed === 1, "a failed read is counted with an error (the signal a detector reads)", counters(db));
  // the counter write is off the request path and fail-soft
  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2, runThrows: true });
  const waits = [];
  const m = await X.spendGovernWA(mkEnv(db, { __spendCtx: { waitUntil: (p) => waits.push(p) } }), PREMIUM);
  await Promise.all(waits);
  ok(m === PREMIUM && waits.length >= 1, "a refused counter write changes nothing: the requested model is served, the write is handed to waitUntil", { m, waits: waits.length });
  ok(logs.some((l) => l[0] === "error" && /quality-floor-count-failed/.test(l[1])), "and is logged", logs);
  reset();
  const noDb = mkEnv(null);
  noDb.QNFO_AUDIT = undefined;
  let threw = null; try { await X.spendGovernWA(noDb, PREMIUM); } catch (e) { threw = e; }
  ok(!threw, "no binding: nothing to count, nothing thrown");
}

// 4. The shared check: caching, failure, missing binding.
{
  reset();
  let db = fakeDb({ worse: 2 });
  let env = mkEnv(db);
  ok((await X.spendQualityBlock(env)) === true && (await X.spendQualityBlock(env)) === true && (await X.spendQualityBlock(env)) === true, "worse > 0 blocks");
  ok(db.reads.quality === 1, "three checks inside the TTL read the view once", db.reads);
  db.reads.quality = 0;
  expire();
  ok((await X.spendQualityBlock(env)) === true && db.reads.quality === 1, "after the TTL the view is read again", db.reads);

  // the value follows the view
  reset();
  db = fakeDb({ worse: 2 }); env = mkEnv(db);
  await X.spendQualityBlock(env);
  const db0 = fakeDb({ worse: 0 });
  expire();
  ok((await X.spendQualityBlock(mkEnv(db0))) === false && floor().worse === 0, "when the view reads 0 again the block is released after the TTL", floor());

  // a failed read: not retried on every request, last known value kept, logged
  reset();
  db = fakeDb({ worse: 4 }); env = mkEnv(db);
  await X.spendQualityBlock(env);
  const bad = fakeDb({ qThrows: true });
  expire();
  const benv = mkEnv(bad);
  ok((await X.spendQualityBlock(benv)) === true, "a failed read keeps the last known value (still blocked)", floor());
  ok(floor().err && /updated_at/.test(floor().err) && logs.some((l) => l[0] === "error" && /quality-floor-load-failed/.test(l[1])), "the failure is recorded and logged", { floor: floor(), logs });
  await X.spendQualityBlock(benv); await X.spendQualityBlock(benv); await X.spendQualityBlock(benv);
  ok(bad.reads.quality === 1, "after a failure the next three checks do not read again", bad.reads);
  vm.runInContext("__qualityFloor.at = Date.now() - " + (X.QUALITY_FLOOR_RETRY_MS + 1000) + ";", sb);
  await X.spendQualityBlock(benv);
  ok(bad.reads.quality === 2, "after the retry window the view is read again", bad.reads);

  // never read before and the read fails: nothing is blocked
  reset();
  const bad2 = fakeDb({ qThrows: true });
  ok((await X.spendQualityBlock(mkEnv(bad2))) === false, "a first read that fails blocks nothing (the cheaper path stays the default)");
  // a failed read followed by a good one: the error is cleared and the new value used (the review of 5.40.0 found this path untested)
  reset();
  db = fakeDb({ worse: 3 }); env = mkEnv(db);
  await X.spendQualityBlock(env);
  const down = fakeDb({ qThrows: true });
  expire();
  await X.spendQualityBlock(mkEnv(down));
  ok(floor().err && floor().worse === 3, "a failed read sets the error and keeps the last value", floor());
  vm.runInContext("__qualityFloor.at = Date.now() - " + (X.QUALITY_FLOOR_RETRY_MS + 1000) + ";", sb);
  const back = fakeDb({ worse: 0 });
  ok((await X.spendQualityBlock(mkEnv(back))) === false && floor().err === null && floor().worse === 0 && back.reads.quality === 1, "the retry after the window succeeds: error cleared, the new value (0) used, block released", floor());
  // the windows are the ones the version note states (an hour for a good read, five minutes after a failure)
  ok(X.QUALITY_FLOOR_TTL_MS === 36e5 && X.QUALITY_FLOOR_RETRY_MS === 3e5, "TTL is one hour and the retry window five minutes", [X.QUALITY_FLOOR_TTL_MS, X.QUALITY_FLOOR_RETRY_MS]);
  // the lift record is capped at 8 a request, and an env without the array is served the requested model without throwing
  reset();
  db = fakeDb({ spend: { "workers-ai": 40 }, worse: 2 });
  env = mkEnv(db);
  for (let i = 0; i < 12; i++) await X.spendGovernWA(env, PREMIUM);
  ok(env.__qualityLifts.length === 8, "twelve lifts in one request keep eight entries in _router.quality_floor", env.__qualityLifts.length);
  const bare = mkEnv(fakeDb({ spend: { "workers-ai": 40 }, worse: 2 }));
  delete bare.__qualityLifts;
  ok((await X.spendGovernWA(bare, PREMIUM)) === PREMIUM, "an env without a lift array is served the requested model and does not throw");
  // no binding, no row
  reset();
  ok((await X.spendQualityBlock({})) === false && (await X.spendQualityBlock(null)) === false && (await X.spendQualityBlock(undefined)) === false, "no QNFO_AUDIT binding blocks nothing and does not throw");
  ok((await X.spendQualityBlock(mkEnv(fakeDb({})))) === false && floor().worse === 0, "no headline row blocks nothing");
  ok((await X.spendGovern({ SPEND_CAP_WORKERS_AI_USD: "1" }, "workers-ai", PREMIUM, false)).action === "allow", "spendGovern without a binding does not throw and has nothing to downgrade");
}

// 5. The SELECT names only columns the view has.
{
  const sel = /prepare\("(SELECT [^"]*output_quality_headline_cache[^"]*)"\)/.exec(src.slice(a2, b2));
  ok(!!sel, "the quality read is a single SELECT on the one-row cache (D1-OVERLOAD-1c), never the view", sel && sel[1]);
  ok(sel && sel[1] === "SELECT worse FROM output_quality_headline_cache WHERE id = 1", "it reads worse and nothing else", sel && sel[1]);
  ok(!/prepare\("SELECT[^"]*FROM v_output_quality_headline/.test(src), "no query in the worker scans the view");
  ok(!/updated_at/.test(src.slice(src.indexOf("async function spendGovern("), src.indexOf("// Chokepoint for direct-key / gateway calls"))), "spendGovern no longer reads a column the view does not have");
  const mig = readFileSync(new URL("../migrations/2026-10-26-output-quality-ledger.sql", import.meta.url), "utf8");
  const view = /CREATE VIEW[^;]*v_output_quality_headline[\s\S]*?;/.exec(mig);
  ok(view && /\bworse\b/.test(view[0]) && !/updated_at/.test(view[0]), "the view definition in migrations exposes worse and has no updated_at", view && view[0].slice(0, 300));
  ok((src.match(/v_output_quality_headline/g) || []).length >= 3 && (src.match(/await spendQualityBlock\(env\)/g) || []).length === 3, "the three downgrade points each call the shared check", (src.match(/await spendQualityBlock\(env\)/g) || []).length);
}

// 6. Release bookkeeping.
{
  const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
  ok(v && (+v[1] > 5 || (+v[1] === 5 && (+v[2] > 40 || (+v[2] === 40 && +v[3] >= 1)))), "VERSION is at least 5.40.1 (QUALITY-FLOOR-RECORD-1)", v && v[0]);
  ok(/QUALITY-FLOOR-RECORD-1/.test(src.slice(0, src.indexOf("\n", src.indexOf("var VERSION")))) && /which is only the in-memory decision/.test(src.slice(0, src.indexOf("\n", src.indexOf("var VERSION")))), "the VERSION line carries the record note and the correction of the ledger-reason claim");
  ok(/COST-QUALITY-FLOOR-ENFORCE-1/.test(src.slice(0, src.indexOf("\n", src.indexOf("var VERSION")))), "the VERSION line carries the COST-QUALITY-FLOOR-ENFORCE-1 note");
  ok(src === mirror, "deployed-current.worker.js is identical to worker.js");
}
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
