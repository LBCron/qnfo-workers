import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const start = source.indexOf("function getJson(");
const end = source.indexOf("\n// DECISION", start);
assert.ok(start >= 0 && end > start, "getJson helper found");
const helper = source.slice(start, end);

function getJsonFor(fetch, logs) {
  const context = vm.createContext({
    fetch,
    console: { error: (line) => logs.push(JSON.parse(line)) },
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
  });
  vm.runInContext(helper + "\nthis.getJson = getJson;", context);
  return context.getJson;
}

const urls = ["https://ops.qnfo.org/fleet", "https://qnfo-ops.q08.workers.dev/fleet"];

{
  const logs = [];
  const fetchCalls = [];
  const getJson = getJsonFor(async (url) => {
    fetchCalls.push(url);
    if (url === urls[0]) throw new TypeError("fetch failed");
    return { ok: true, json: async () => ({ fleet: [] }) };
  }, logs);
  const result = await getJson(urls, 1000, "fleet");
  assert.equal(result.ok, true);
  assert.equal(result.url, urls[1]);
  assert.deepEqual(fetchCalls.sort(), urls.slice().sort());
  assert.equal(logs.length, 0);
}

{
  const logs = [];
  const getJson = getJsonFor(async (url) => {
    if (url === urls[0]) return { ok: false, status: 503 };
    throw new TypeError("fetch failed");
  }, logs);
  const result = await getJson(urls, 1000, "fleet");
  assert.equal(result.ok, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].evt, "deploy-guard:getJson:caught");
  assert.equal(logs[0].probe, "fleet");
  assert.match(logs[0].error, /ops\.qnfo\.org: Error: status 503/);
  assert.match(logs[0].error, /qnfo-ops\.q08\.workers\.dev: TypeError: fetch failed/);
  assert.doesNotMatch(logs[0].error, /All promises were rejected/);
}

console.log("get-json test OK");
