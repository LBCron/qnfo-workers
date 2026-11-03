import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("async function areaReadModel(");
const end = source.indexOf("// AREA-FEEDS-1:", start);
assert.ok(start > 0 && end > start);
const routes = source.slice(source.indexOf('  if (path === "/api/areas"'), source.indexOf('  if (path === "/api/human"'));

for (const snapshot of ["fresh", "stale", "missing", "no-probes", "failed-refresh"]) {
  let refreshes = 0, reads = 0;
  const background = [];
  const probes = [{ ok: true }, { ok: false }, { ok: true }];
  const rec = snapshot === "missing" ? null : {
    updatedAt: new Date(Date.now() - (snapshot === "stale" || snapshot === "failed-refresh" ? 6 * 60000 : 0)).toISOString(),
    state: snapshot === "no-probes" ? {} : { probes }
  };
  const context = vm.createContext({
    Date, loadState: async () => rec,
    runRefresh: () => {
      refreshes++;
      return snapshot === "failed-refresh" ? Promise.reject(new Error("refresh unavailable")) : new Promise(() => {});
    },
    areasModel: async (_env, sys) => { reads++; return sys; }
  });
  vm.runInContext(source.slice(start, end) + ";globalThis.read = areaReadModel;", context);
  let timer;
  try {
    const model = await Promise.race([
      context.read({}, { waitUntil: (p) => background.push(p) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("area read awaited fleet refresh")), 500); })
    ]);
    assert.equal(model.probes_total, snapshot === "missing" || snapshot === "no-probes" ? 0 : 3);
    assert.equal(model.probes_ok, snapshot === "missing" || snapshot === "no-probes" ? 0 : 2);
    assert.equal(reads, 1);
    assert.equal(refreshes, snapshot === "stale" || snapshot === "missing" || snapshot === "failed-refresh" ? 1 : 0);
    assert.equal(background.length, refreshes);
    if (snapshot === "failed-refresh") await Promise.all(background);
  } finally {
    clearTimeout(timer);
  }
}

for (const path of ["/api/areas", "/api/area/autonomy", "/api/area/reliability"]) {
  let models = 0, ages = 0;
  const area = { id: path.endsWith("reliability") ? "reliability" : "autonomy", all: [{ key: "test_breach" }] };
  const model = { areas: [area], generated_at: "2026-11-03T00:00:00Z" };
  const run = new Function("path", "request", "url", "env", "ctx", "deps",
    "return (async () => { const {areaReadModel, currentState, humanView, feedAreaOf, FEED_AREAS, AREA_STARS, areaDataAge, areaFeedView, rtRead, areasApiBody, rtDigest, json, RT_CACHE_PUBLIC} = deps;\n" + routes + "\n})();");
  const forbidden = () => { throw new Error("area route built unrelated human dashboard state"); };
  const result = await run(path, { method: "GET" }, new URL("https://fleet.qnfo.org" + path + "?full=1"), {}, {}, {
    areaReadModel: async () => { models++; return model; },
    currentState: forbidden, humanView: forbidden,
    feedAreaOf: (id) => ({ id }), FEED_AREAS: [], AREA_STARS: { autonomy: { key: "test_star" } },
    areaDataAge: async (_env, keys) => { ages++; assert.ok(keys.includes("test_breach")); return { age_min: 7, metrics: keys.length }; },
    areaFeedView: (row, fa, m, full, data) => {
      assert.equal(row, area);
      assert.equal(fa.id, area.id);
      assert.equal(m, model);
      assert.equal(full, true);
      return { schema_version: "fleet-area-feed/v1", data };
    },
    rtRead: (_req, _url, body) => body,
    areasApiBody: (m, full) => { assert.equal(m, model); assert.equal(full, true); return { schema_version: "fleet-areas/v3" }; },
    rtDigest: () => "rev-test", json: (body) => body, RT_CACHE_PUBLIC: "public"
  });
  assert.equal(models, 1);
  assert.equal(ages, path === "/api/areas" ? 0 : 1);
  assert.equal(result.schema_version, path === "/api/areas" ? "fleet-areas/v3" : "fleet-area-feed/v1");
}

console.log("Area feed latency: cached probe counts, background-only cold/stale refresh, and lean area routes passed");
