import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(join(here, "../migrations/2026-10-27-jobsearch.sql"), "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...values) => stmt(sql, values),
  run: async () => {
    const result = db.prepare(sql).run(...args);
    return { meta: { last_row_id: Number(result.lastInsertRowid), changes: Number(result.changes) } };
  },
  first: async () => db.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
});
const env = { JOBS_DB: { prepare: (sql) => stmt(sql) }, LOOP_TOKEN: "test-token" };
const pending = [];
const ctx = { waitUntil: (promise) => pending.push(promise) };
const call = async (path, init) => {
  const response = await worker.fetch(new Request("https://x" + path, init), env, ctx);
  return [response.status, await response.json()];
};
const save = (answers) => call("/api/prefs", {
  method: "POST",
  headers: { "content-type": "application/json", "x-loop-token": env.LOOP_TOKEN },
  body: JSON.stringify({ answers }),
});
const settle = async () => { await Promise.all(pending.splice(0)); };

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [], data: [] }), { status: 200 });
try {
  assert.equal((await save({ loc_us: true, fam_edu: false }))[0], 200);
  await settle();
  assert.equal((await save({ loc_us: false }))[0], 200);
  await settle();

  let preferences = (await call("/api/prefs"))[1].survey;
  assert.equal(preferences.find((answer) => answer.id === "loc_us").answer, false);
  assert.equal(preferences.find((answer) => answer.id === "fam_edu").answer, false);

  assert.equal((await save({ fam_edu: null }))[0], 200);
  await settle();
  preferences = (await call("/api/prefs"))[1].survey;
  assert.equal(preferences.find((answer) => answer.id === "fam_edu").answer, null);
} finally {
  globalThis.fetch = realFetch;
  db.close();
}

console.log("qnfo-jobsearch partial preference updates: passed");
