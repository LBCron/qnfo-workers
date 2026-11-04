import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const start = src.indexOf("async function pollObservability(env) {");
const end = src.indexOf('\n__name(pollObservability, "pollObservability");', start);
assert.ok(start >= 0 && end > start, "pollObservability function is present");

const issues = Array.from({ length: 26 }, (_, i) => ({
  id: `issue-${i}`,
  title: `issue ${i}`,
  service: "qnfo-fleet-control",
  status: "active",
  count: 1
}));
const batches = [];
const directRuns = [];
const fetchCalls = [];
const db = {
  prepare(sql) {
    return {
      sql,
      bind(...args) { this.args = args; return this; },
      async run() { directRuns.push(this); return { success: true }; }
    };
  },
  async batch(statements) { batches.push(statements); return []; }
};
const sandbox = {
  __name: () => {},
  AbortSignal,
  Date,
  console: { error() {} },
  fetch: async (url, options = {}) => {
    fetchCalls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/issues/summary")) return { json: async () => ({ success: true, result: { activeIssues: issues.length } }) };
    if (String(url).includes("/issues?")) return { json: async () => ({ success: true, result: issues }) };
    if (String(url).includes("/usage?")) return { json: async () => ({ success: true, result: { breakdown: [] } }) };
    throw new Error(`Unexpected request: ${url}`);
  },
  cfObsPayload: (issue) => JSON.stringify(issue),
  cfObsClassify: () => "active"
};
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end) + "\nthis.pollObservability = pollObservability;", sandbox);

const result = await sandbox.pollObservability({ CF_API_TOKEN: "test", AUDIT_DB: db });
assert.equal(result.issuesIngested, issues.length, "all active groups are ingested");
assert.deepEqual(batches.map((batch) => batch.length), [50, 2], "two D1 writes per group are sent in bounded batches");
assert.ok(batches.every((batch) => batch.length <= 50), "no D1 batch exceeds 50 statements");
assert.equal(batches.flat().filter((statement) => statement.sql.startsWith("INSERT INTO fleet_issue_dispatch")).length, issues.length);
assert.equal(batches.flat().filter((statement) => statement.sql.startsWith("INSERT INTO fleet_issue_loop")).length, issues.length);
assert.equal(directRuns.length, 3, "the completion, event, and sweep records still run");
assert.equal(fetchCalls.filter((call) => call.method === "PATCH").length, 0, "active observability groups are not suppressed");

console.log("8 passed, 0 failed");
