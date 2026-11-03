import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const functionBody = (name) => {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\n__name(${name},`, start);
  assert.ok(start >= 0 && end > start, `${name} helper is present`);
  return source.slice(start, end);
};

const liveScheduled = new Function(
  "d1all",
  "ACCOUNT",
  "fetch",
  `${functionBody("liveScheduled")}\nreturn liveScheduled;`
);
const probeTargets = new Function(
  "d1all",
  `${functionBody("probeTargets")}\nreturn probeTargets;`
);

test("scheduled and health-probe rosters remain independent of the static registry", async () => {
  assert.doesNotMatch(source, /(?:from\s+|require\s*\()\s*["']\.\/registry\.js["']/);

  const schedules = Array.from({ length: 40 }, (_, i) => ({
    name: `scheduled-${i}`,
    crons_json: '["*/15 * * * *"]',
    purpose: "",
    grp: "live",
    created_on: null
  }));
  const probes = Array.from({ length: 81 }, (_, i) => ({
    service: `probe-${i}`,
    base_url: `https://probe-${i}.example.test`
  }));
  const d1all = async (_db, sql) => {
    if (sql.includes("MAX(refreshed_at)")) return [{ ageh: 0 }];
    if (sql.includes("COUNT(*) AS c FROM worker_schedules")) return [{ c: schedules.length }];
    if (sql.includes("FROM worker_schedules WHERE refreshed_at")) return schedules;
    if (sql.includes("FROM service_registry WHERE state='live'")) return probes;
    throw new Error(`Unexpected dashboard query: ${sql}`);
  };
  const env = {
    AUDIT: {
      prepare(sql) {
        if (sql.includes("pragma_table_info")) {
          return { all: async () => ({ results: [{ name: "created_on" }] }) };
        }
        return { run: async () => ({}) };
      }
    }
  };

  const [scheduled, healthProbes] = await Promise.all([
    liveScheduled(d1all, "test-account", async () => {
      throw new Error("fresh schedule cache should not fetch");
    })(env, []),
    probeTargets(d1all)(env)
  ]);

  assert.equal(scheduled.length, 40);
  assert.equal(new Set(scheduled.map(({ name }) => name)).size, 40);
  assert.equal(healthProbes.length, 81);
  assert.equal(new Set(healthProbes.map(({ name }) => name)).size, 81);
});
