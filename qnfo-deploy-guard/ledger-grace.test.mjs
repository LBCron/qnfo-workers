// LEDGER-GRACE-1 (qnfo-deploy-guard 1.4.6, issues 6854 and 6864): a modified_on change younger than the grace with no ledger row yet is
// judged again on the next scan instead of filed as uncoordinated-deploy; one older than the grace and still unledgered is filed.
import assert from "node:assert/strict";
import worker from "./worker.js";

const original = globalThis.fetch;
let fleetMod;
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.endsWith("/fleet") ? { fleet: [{ name: "demo-w", modified_on: fleetMod }] } : { utc_day: { cost: 0 }, last_30d: { cost: 0 } };
  return { ok: true, status: 200, json: async () => body };
};

async function scanWith(modifiedOn) {
  fleetMod = modifiedOn;
  const puts = {}, sqls = [];
  const env = {
    AUDIT: { prepare(sql) { sqls.push(sql); const st = { bind() { return st; }, async all() { return { results: [] }; }, async run() { return { success: true, meta: { changes: 0 } }; }, async first() { return null; } }; return st; } },
    FLEET_CONFIG: {
      async get(k) { return k === "deploywatch:snapshot" ? JSON.stringify({ "demo-w": { mo: "2026-11-01T00:00:00.000000Z", at: "x" } }) : null; },
      async list() { return { keys: [] }; },
      async put(k, v) { puts[k] = v; },
      async delete() {},
    },
  };
  const pending = [];
  await worker.scheduled({ cron: "*/20 * * * *" }, env, { waitUntil(p) { pending.push(p); } });
  await Promise.all(pending);
  return { snap: JSON.parse(puts["deploywatch:snapshot"] || "{}"), sqls };
}

try {
  const fresh = new Date(Date.now() - 20000).toISOString().replace("Z", "123Z");
  const a = await scanWith(fresh);
  assert.equal(a.snap["demo-w"].mo, "2026-11-01T00:00:00.000000Z", "a 20 s old change with no row keeps the previous snapshot, so the next scan sees it again");
  assert.ok(!a.sqls.some((s) => /INSERT INTO agent_issues/i.test(s)), "and files no issue yet");

  const old = new Date(Date.now() - 20 * 60000).toISOString();
  const b = await scanWith(old);
  assert.equal(b.snap["demo-w"].mo, old, "a 20 minute old change is recorded in the snapshot as before");
  assert.ok(b.sqls.some((s) => /INSERT INTO agent_issues/i.test(s)), "and an unledgered one past the grace is still filed");
} finally { globalThis.fetch = original; }
console.log("ledger grace test OK");
