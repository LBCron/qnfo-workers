import assert from "node:assert/strict";
import worker from "./worker.js";

const originalFetch = globalThis.fetch;
const fetchCalls = [];
globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  fetchCalls.push(requestUrl);
  const body = requestUrl.endsWith("/fleet")
    ? { fleet: [] }
    : { utc_day: { cost: 0 }, last_30d: { cost: 0 } };
  return { ok: true, status: 200, json: async () => body };
};

const statement = {
  bind() { return this; },
  async all() { return { results: [] }; },
  async run() { return { success: true, meta: { changes: 0 } }; },
};
const env = {
  AUDIT: { prepare() { return statement; } },
  FLEET_CONFIG: {
    async get() { return null; },
    async list() { return { keys: [] }; },
    async put() {},
    async delete() {},
  },
};
const pending = [];

try {
  await worker.scheduled({ cron: "*/20 * * * *" }, env, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);

  assert.deepEqual(
    fetchCalls.filter((url) => url.endsWith("/fleet")).sort(),
    ["https://ops.qnfo.org/fleet", "https://qnfo-ops.q08.workers.dev/fleet"],
    "scheduled scan and capability snapshot share one fleet probe",
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("scheduled fleet probe test OK");
