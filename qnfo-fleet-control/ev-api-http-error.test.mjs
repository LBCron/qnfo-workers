import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const start = src.indexOf("async function evApi(env, method, path, body) {");
const end = src.indexOf('\n__name(evApi, "evApi");', start);
assert.ok(start >= 0 && end > start, "evApi function is present");

const errors = [];
let response;
const sandbox = {
  EVOLVE_REPO: "QNFO/qnfo-workers",
  __name: () => {},
  evGh: () => ({}),
  timedFetch: async () => response,
  console: { error: (message) => errors.push(message) }
};
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end) + "\nthis.evApi = evApi;", sandbox);

response = new Response("Service Unavailable", { status: 503 });
const unavailable = await sandbox.evApi({}, "POST", "/test", {});
assert.deepEqual({ status: unavailable.status, ok: unavailable.ok, j: unavailable.j }, { status: 503, ok: false, j: null });
assert.equal(errors.length, 0, "a non-JSON HTTP error does not emit a secondary parse-error log");

response = new Response(JSON.stringify({ success: false, errors: [{ message: "rate limited" }] }), { status: 503 });
const structuredError = await sandbox.evApi({}, "POST", "/test", {});
assert.equal(structuredError.j.errors[0].message, "rate limited", "structured error responses remain available to callers");

response = new Response("not JSON", { status: 200 });
const malformedSuccess = await sandbox.evApi({}, "POST", "/test", {});
assert.equal(malformedSuccess.j, null);
assert.equal(errors.length, 1, "malformed successful responses still emit diagnostics");
assert.equal(JSON.parse(errors[0]).status, 200);

console.log("7 passed, 0 failed");
