// SMART-PLACEMENT-READ-1 offline suite (qnfo-infra; agent_issues 1000697). The infra snapshot used to PATCH {placement_mode:"smart"} to
// /workers/scripts/<name>/settings for the ten heaviest D1 workers on every tick. Cloudflare answered "Content-Type must be one of:
// multipart/form-data" for all ten (snapshot 2026-11-04T22:30Z: 0 patched, 10 errors), and a call that did work would have moved ten
// workers, the control plane among them, in one step instead of one component at a time (SMART-PLACEMENT-CANARY-1). Placement is
// declared in wrangler.toml and sent by the canonical deploy. Proves: the snapshot sends no write to the settings route, reads each
// worker's live placement mode from the settings it already fetched, lists which of the ten heaviest are on smart placement, and
// carries on when one settings read fails.
// Run: node --no-warnings qnfo-infra/smart-placement-read.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 600) : "")); } };

const a = src.indexOf("async function collectState(env) {"), b = src.indexOf('__name(collectState, "collectState");');
ok(a > 0 && b > a, "collectState is found");
const body = src.slice(a, b);
ok(!/placement_mode/.test(src), "the worker no longer sends placement_mode anywhere");
ok(!/method: "PATCH"[\s\S]{0,300}\/settings|\/settings"[\s\S]{0,200}method: "PATCH"/.test(body), "collectState sends no PATCH to a settings route");
ok(/var VERSION = "1\.(1[2-9]|[2-9]\d)\./.test(src), "VERSION is at least 1.12");
ok(!/\*\//.test(body.replace(/\/\*[\s\S]*?\*\//g, "")), "no stray comment terminator in collectState");

const MB = 1024 * 1024;
function run(opts) {
  const calls = [];
  const cf = async (env, path) => {
    calls.push({ path });
    if (path.startsWith("/workers/scripts?")) return { result: opts.workers.map((w) => ({ id: w.name })) };
    if (path.startsWith("/d1/database")) return { result: opts.dbs.map((d) => ({ name: d.name, uuid: d.id, file_size: d.size })) };
    const m = /^\/workers\/scripts\/([^/]+)\/settings$/.exec(path);
    if (m) {
      const w = opts.workers.find((x) => x.name === decodeURIComponent(m[1]));
      if (w.fail) throw new Error("settings read failed for " + w.name);
      const bindings = (w.d1 || []).map((id) => ({ type: "d1", id }));
      for (let i = 0; i < (w.secrets || 0); i++) bindings.push({ type: "secret_text", name: "S" + i });
      for (let i = 0; i < (w.store || 0); i++) bindings.push({ type: "secrets_store_secret", name: "ST" + i, store_id: "s", secret_name: "x" });
      return { result: { bindings, placement: w.placement } };
    }
    return { result: [] };
  };
  const cfRaw = async () => ({ text: async () => "{}", json: async () => ({ result: [] }) });
  const make = new Function("cf", "cfRaw", "__name", "AI_COST_LADDER", "fetch", body + "\nreturn collectState;");
  const fetchGuard = (url, init) => { calls.push({ fetch: String(url), method: init && init.method }); throw new Error("collectState must not call fetch directly"); };
  return make(cf, cfRaw, (f) => f, {}, fetchGuard)({ CF_ACCOUNT: "acc" }).then((state) => ({ state, calls }));
}

const dbs = [{ name: "big", id: "d-big", size: 300 * MB }, { name: "mid", id: "d-mid", size: 30 * MB }, { name: "small", id: "d-small", size: 1 * MB }];
const workers = [
  { name: "alpha", d1: ["d-big"], placement: {} },
  { name: "beta", d1: ["d-mid"], placement: { mode: "smart" } },
  { name: "gamma", d1: ["d-small"], placement: { mode: "smart" } },
  { name: "delta", d1: [], placement: { mode: "smart" } },  // no D1: not a candidate for the top list, but still on smart placement
  { name: "eps", d1: ["d-mid"], fail: true },                // one failing settings read is recorded, not fatal
];
const { state, calls } = await run({ workers, dbs });
const sp = state.d1 && state.d1.smart_placement;
ok(sp && Array.isArray(sp.top_heavy) && sp.top_heavy.join() === "alpha,beta,gamma", "the top list is the workers that bind D1, heaviest first, without the failing read", sp);
ok(sp.smart.join() === "beta,delta,gamma", "smart lists every worker whose live placement mode is smart", sp.smart);
ok(sp.top_heavy_smart.join() === "beta,gamma", "top_heavy_smart is the heavy workers already on smart placement", sp.top_heavy_smart);
ok(!("patched" in sp) && !("patch_errors" in sp), "the snapshot no longer reports patches");
ok(sp.candidates === 5, "candidates counts every worker read", sp.candidates);
ok(calls.every((c) => !c.fetch), "no direct fetch (no write path) was used", calls.filter((c) => c.fetch));
ok(calls.filter((c) => /\/settings$/.test(c.path || "")).length === 5, "each worker's settings are read once and only read", calls.length);

// SECRETS-CENSUS-1 (agent_issues 1000698): the same settings reads give the Secrets Store migration its measure
const w2 = workers.map((w) => ({ ...w })); w2[0].secrets = 4; w2[1].secrets = 2; w2[1].store = 1; w2[2].store = 3; w2[3].secrets = 5;
const cen = (await run({ workers: w2, dbs })).state.secrets_census;
ok(cen && cen.secret_text === 11 && cen.store_bindings === 4, "the census counts secret_text and secrets_store_secret bindings across the readable workers", cen);
ok(cen.workers === 5 && cen.store_bound.join() === "beta,gamma", "and names the workers that already have a store binding", cen);
ok((await run({ workers, dbs })).state.secrets_census.secret_text === 0, "no bindings reads as zero, never undefined");

const none = await run({ workers: [{ name: "solo", d1: ["d-big"], placement: {} }], dbs });
ok(none.state.d1.smart_placement.smart.length === 0 && none.state.d1.smart_placement.top_heavy_smart.length === 0, "with no smart worker both lists are empty");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
