// Offline test (node:sqlite as D1 shim) for RESEARCH-POISON-PARK-1 (#1700), rewritten for SINGLE-LANE-1 (agent_issues 1001450, GitHub 6709).
// The recover ceiling used to leave a row parked (status wontfix, stage parked, PARKED-POISON-1). Owner directive 2026-11-03: "NO MORE PARKED ITEMS! There
// shall only be a single line from idea to publish". The same ceiling now re-enters the lane (laneReenter): status queued at ground (deferred once the row has
// used its TERMINAL_RECOVERY_MAX cycles), recover_count reset, the cycle counted in terminal_rearms, the reason in error and ONE lane-reenter event. What this
// suite still proves from the original: the bound holds (an exhausted row is not re-run with the same counter), nothing is deleted, a stale claim at the
// ceiling is handled, and the RESEARCH-TERMINAL issue and its self-closing contract (SELFCLOSE-1, HARD-REVIEW-SELFCLOSE-1, REARMED-1) are still filed.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { markError, reclaimStaleResearching } from "./worker.js";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, status TEXT DEFAULT 'queued', stage TEXT, claimed_at TEXT, attempt INTEGER DEFAULT 0, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, context TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), next_due_at TEXT, last_verdict TEXT, attempts INTEGER DEFAULT 0);`);
// This suite's recover_count values (3) assert exhaustion, and the worker's default ceiling is now RECOVER_MAX = 6
// (ops_config research_recover_max, raised from 3 on 2026-10-17). Pin the ceiling the assertions were written against
// instead of moving every row, so the test keeps testing the ceiling rather than the default.
db.prepare("INSERT INTO ops_config (key, value) VALUES ('research_recover_max','3')").run();
function stmt(sql) {
  let args = [];
  const o = { bind(...a) { args = a; return o; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; } };
  return o;
}
const env = { QNFO_AUDIT: { prepare: stmt } };
const get = (id) => db.prepare("SELECT * FROM research_queue WHERE id=?").get(id);
const old = "2020-01-01T00:00:00Z";
const events = (kind) => db.prepare("SELECT * FROM cloud_ops_events WHERE kind=?").all(kind);

// 1. markError below the cap re-queues with recover_count+1
db.prepare("INSERT INTO research_queue (id,status,stage,recover_count) VALUES ('a','researching','revise',1)").run();
await markError(env, get("a"), "boom");
assert.equal(get("a").status, "queued"); assert.equal(get("a").recover_count, 2);

// 2. an exhausted row re-enters the lane (not re-run with the same counter, not parked, not deleted), reason recorded, one event
db.prepare("INSERT INTO research_queue (id,status,stage,recover_count,terminal_rearms) VALUES ('b','researching','revise',3,0)").run();
await markError(env, get("b"), "revise: output too short");
let b = get("b");
assert.equal(b.status, "queued"); assert.equal(b.stage, "ground", "a fresh draft from ground");
assert.match(b.error, /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: recover_count exhausted \(3\); last error: revise: output too short/);
assert.equal(b.recover_count, 0, "the new cycle gets its own recoveries"); assert.equal(b.terminal_rearms, 1, "the cycle is counted in the durable column");
assert.equal(b.claimed_at, null); assert.equal(JSON.parse(b.context).laneCycle, 1);
assert.equal(events("lane-reenter").length, 1, "one event per re-entry"); assert.equal(events("poison-park").length, 0, "nothing is parked any more");
assert.equal(db.prepare("SELECT count(*) n FROM research_queue WHERE stage='parked' OR status='wontfix'").get().n, 0, "no parked or wontfix row exists");
// 2b. the bound: a row that keeps reaching the ceiling is counted every time, and after TERMINAL_RECOVERY_MAX cycles it re-enters as status deferred
// (the RESEARCH-BACKPRESSURE-1 release orders it) instead of status queued, so it cannot be claimed hot.
for (const n of [1, 2, 3, 4]) {
  db.prepare("UPDATE research_queue SET status='researching', stage='revise', recover_count=3 WHERE id='b'").run();
  await markError(env, get("b"), "revise: output too short");
  b = get("b");
  assert.equal(b.terminal_rearms, n + 1);
  assert.equal(b.status, n + 1 <= 2 ? "queued" : "deferred", "cycle " + (n + 1) + " status");
  assert.equal(b.stage, "ground"); assert.equal(b.recover_count, 0);
}
assert.equal(events("lane-reenter").length, 5);

// 3. stale researching: an exhausted row re-enters the lane, a healthy one is requeued with the counter bumped, a fresh claim is untouched
db.prepare("INSERT INTO research_queue (id,status,stage,claimed_at,recover_count) VALUES ('c','researching','revise',?,3),('d','researching','revise',?,0),('e','researching','revise',?,3)").run(old, old, new Date().toISOString());
const r = await reclaimStaleResearching(env);
assert.deepEqual(r, { reentered: 1, requeued: 1 });
assert.equal(get("c").status, "queued"); assert.equal(get("c").stage, "ground"); assert.match(get("c").error, /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: stale researching claim with recover_count exhausted \(3\)/);
assert.equal(get("c").recover_count, 0); assert.equal(get("c").terminal_rearms, 1);
assert.equal(get("d").status, "queued"); assert.equal(get("d").recover_count, 1);
assert.equal(get("e").status, "researching");

// 4. a second reclaim pass is a no-op (a re-entered row is queued, not researching)
assert.deepEqual(await reclaimStaleResearching(env), { reentered: 0, requeued: 0 });
assert.equal(db.prepare("SELECT count(*) n FROM research_queue").get().n, 5); // nothing deleted
// 5. RESEARCH-TERMINAL-SELFCLOSE-1: a content-only ceiling row (verify mismatch, every gate passed) files its issue with a
// remediation probe. Under SINGLE-LANE-1 the row re-enters the lane in the same step, so the probe resolves at once (the integrity
// gate withheld the paper, it was not published); a row still left in the old parked state stays pending. A gate failure gets a contract too.
const U1 = "18826b2d-d5f1-454f-9fc2-42a55a845415", U2 = "196536e3-44ee-4613-82e9-df08b180568d";
db.prepare("INSERT INTO research_queue (id,status,stage,recover_count) VALUES (?,'researching','verify',3),(?,'researching','verify',3)").run(U1, U2);
await markError(env, get(U1), "verify: unresolved after revision - mismatch=true gates=");
await markError(env, get(U2), "verify: unresolved after revision - mismatch=true gates=gate-refcount");
assert.equal(get(U1).status, "queued"); assert.equal(get(U1).stage, "ground");
const c1 = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'research-terminal-18826b2d'").get();
const i1 = db.prepare("SELECT id FROM agent_issues WHERE title LIKE 'RESEARCH-TERMINAL 18826b2d%'").get();
assert.ok(c1 && i1 && c1.issue_id === i1.id && c1.status === "active" && c1.verify_transport === "d1-query", "a content-only ceiling row gets an active d1-query contract on its issue");
assert.match(c1.precondition, /re-entered the lane for a verify mismatch/);
const cg = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'research-terminal-196536e3'").get();
assert.ok(cg && cg.status === "active" && /pipeline fault/.test(cg.precondition), "a gate failure gets a self-closing contract too");
assert.ok(/^select /i.test(c1.verify_probe) && !c1.verify_probe.includes(";"), "the probe is a literal SELECT the remediation tick will run");
let pr = db.prepare(c1.verify_probe).get();
assert.equal(pr.observed, pr.expected, "the row is in the lane (queued), so the probe passes");
db.prepare("UPDATE research_queue SET status='wontfix', stage='parked' WHERE id = ?").run(U1);   // the old state, left by a release before 0.54.0
assert.equal(db.prepare(c1.verify_probe).get().observed, "pending", "a row still in the old parked state keeps its issue pending until legacyParkedSweep returns it");
db.prepare("UPDATE research_queue SET status='deferred', stage='ground' WHERE id = ?").run(U1);
assert.equal(db.prepare(c1.verify_probe).get().observed, "resolved", "a deferred row is in the lane too");
await markError(env, { ...get(U1), status: "researching", recover_count: 3 }, "verify: unresolved after revision - mismatch=true gates=");
assert.equal(db.prepare("SELECT count(*) n FROM remediation_contracts WHERE class = 'research-terminal-18826b2d'").get().n, 1, "a repeat ceiling files no second contract");
// 6. RESEARCH-TERMINAL-HARD-REVIEW-SELFCLOSE-1: a row whose review HARD findings were not resolved by the revise cycles is the integrity gate withholding the
// paper, so its issue gets the same self-closing contract; "revise: no applicable edit" (a model that could not apply a fix) can be a pipeline fault and gets one too.
const UH = "ab12cd34-0000-4000-8000-000000000001", UN = "ef56ab78-0000-4000-8000-000000000002";
db.prepare("INSERT INTO research_queue (id,status,stage,recover_count) VALUES (?,'researching','review',3),(?,'researching','revise',3)").run(UH, UN);
await markError(env, get(UH), "review: 6 HARD findings unresolved after 7 revise cycles (H1,H2,H3,H4,H5,H6)");
await markError(env, get(UN), "revise: no applicable edit for 5 HARD fixes (H1,H2,H4,H5,H6) from two models, strict retry included (not advanced unrevised)");
const ch = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'research-terminal-ab12cd34'").get();
const ih = db.prepare("SELECT id FROM agent_issues WHERE title LIKE 'RESEARCH-TERMINAL ab12cd34%'").get();
assert.ok(ch && ih && ch.issue_id === ih.id && ch.status === "active" && ch.verify_transport === "d1-query", "a HARD-review ceiling row gets an active d1-query contract on its issue");
assert.match(ch.precondition, /HARD review findings/, "the contract names the HARD-review reason");
const cn = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'research-terminal-ef56ab78'").get();
assert.ok(cn && /pipeline fault/.test(cn.precondition), "no applicable edit gets a contract that waits on the row leaving the old state");
assert.ok(/^select /i.test(ch.verify_probe) && !ch.verify_probe.includes(";") && !/LIKE '[^']{50,}'/.test(ch.verify_probe), "the probe is a literal SELECT with no LIKE literal over D1's 50 byte limit");
assert.equal(db.prepare(ch.verify_probe).get().observed, "resolved", "the HARD-review row is back in the lane, so its probe passes");
assert.equal(db.prepare("SELECT count(*) n FROM remediation_contracts").get().n, 4, "one contract per ceiling row: mismatch, gate failure, HARD review, no applicable edit");
assert.equal(db.prepare("SELECT count(*) n FROM research_queue WHERE stage = 'parked'").get().n, 0, "no row is left parked: the worker wrote none and the hand-set one was moved back");
console.log("poison-park tests passed");
