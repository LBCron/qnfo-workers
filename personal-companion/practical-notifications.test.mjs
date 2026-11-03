// Run: node personal-companion/practical-notifications.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as W from "./wellbeing-wire.js";

const db = new DatabaseSync(":memory:");
const env = { PERSONAL: { prepare(sql) {
  let args = [];
  const stmt = {
    bind(...a) { args = a; return stmt; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; }
  };
  return stmt;
} } };
await W.ensureWellbeing(env.PERSONAL);
let sends = 0;
const send = async () => { sends++; return { ok: true }; };
for (const hour of ["08", "12", "20"]) {
  const nowIso = "2026-11-02T" + hour + ":00:00Z";
  assert.deepEqual(await W.briefCheckinLines(env, nowIso), []);
  assert.equal(await W.noteCheckinInBrief(env, nowIso), false);
  assert.equal((await W.wellbeingTick(env, { send, nowIso, force: true })).skipped, "practical-notifications-only");
}
assert.equal(sends, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM companion_nudges").get().n, 0);
db.close();
console.log("No unsolicited mood prompts in morning briefs or email ticks");
