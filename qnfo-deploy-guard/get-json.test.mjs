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
  const signals = [];
  const getJson = getJsonFor(async (url, { signal }) => {
    fetchCalls.push(url);
    signals.push(signal);
    if (url === urls[0]) throw new TypeError("fetch failed");
    return { ok: true, json: async () => ({ fleet: [] }) };
  }, logs);
  const result = await getJson(urls, 1000, "fleet");
  assert.equal(result.ok, true);
  assert.equal(result.url, urls[1]);
  assert.deepEqual(fetchCalls.sort(), urls.slice().sort());
  assert.equal(logs.length, 0);
  assert.ok(signals.every((signal) => signal.aborted), "release outstanding requests after success");
}

{
  const logs = [];
  let calls = 0;
  const getJson = getJsonFor(async (url) => {
    calls++;
    if (url === urls[0]) return { ok: false, status: 503 };
    throw new TypeError("fetch failed");
  }, logs);
  const result = await getJson(urls, 1000, "fleet");
  assert.equal(result.ok, false);
  assert.equal(calls, 2, "HTTP/network failures are not retried");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].evt, "deploy-guard:getJson:caught");
  assert.equal(logs[0].probe, "fleet");
  assert.match(logs[0].error, /ops\.qnfo\.org: Error: status 503/);
  assert.match(logs[0].error, /qnfo-ops\.q08\.workers\.dev: TypeError: fetch failed/);
  assert.doesNotMatch(logs[0].error, /All promises were rejected/);
}

{
  const logs = [];
  let loserAborted = false;
  const getJson = getJsonFor((url, { signal }) => {
    if (url === urls[1]) return Promise.resolve({ ok: true, json: async () => ({ fleet: [] }) });
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        loserAborted = true;
        reject(new DOMException("The operation was aborted", "AbortError"));
      }, { once: true });
    });
  }, logs);
  const result = await getJson(urls, 1000, "fleet");
  assert.equal(result.ok, true);
  assert.equal(result.url, urls[1]);
  assert.equal(loserAborted, true, "abort the hanging primary when the mirror wins");
  assert.equal(logs.length, 0, "loser cancellation is not a probe failure");
}

{
  const logs = [];
  const signals = [];
  const getJson = getJsonFor((url, { signal }) => {
    signals.push(signal);
    if (signals.length > urls.length) {
      return Promise.resolve({ ok: true, json: async () => ({ fleet: [] }) });
    }
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")), { once: true });
    });
  }, logs);
  const result = await getJson(urls, 10, "fleet");
  assert.equal(result.ok, true, "one retry recovers a transient timeout");
  assert.equal(signals.length, 4);
  assert.notEqual(signals[0], signals[2], "retry uses a fresh abort signal");
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(logs.length, 0, "recovered timeout does not log an outage");
}

for (const stalledBody of [false, true]) {
  const logs = [];
  const signals = [];
  const getJson = getJsonFor((url, { signal }) => {
    signals.push(signal);
    // Deliberately ignore abort: the deadline must bound fetch AND body consumption.
    return stalledBody
      ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) })
      : new Promise(() => {});
  }, logs);
  const result = await getJson(urls, 10, "fleet");
  assert.equal(result.ok, false);
  assert.equal(signals.length, 4, "persistent timeout stops after two attempts");
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].probe, "fleet");
  assert.match(logs[0].error, /TimeoutError: exceeded 10ms/);
  assert.equal(logs[0].attempts, 2);
}

{
  const logs = [];
  let calls = 0;
  const getJson = getJsonFor(async () => {
    calls++;
    return { ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } };
  }, logs);
  const result = await getJson(urls, 1000, "fleet");
  assert.equal(result.ok, false);
  assert.equal(calls, 2, "invalid JSON is not retried");
  assert.equal(logs.length, 1);
  assert.match(logs[0].error, /SyntaxError: invalid JSON/);
}

console.log("get-json test OK");
