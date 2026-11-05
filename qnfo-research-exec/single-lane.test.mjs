// SINGLE-LANE-1 (qnfo-research-exec 0.54.0, agent_issues 1001450, GitHub 6709; owner directive 2026-11-03: "NO MORE PARKED ITEMS! There shall only be a single line
// from idea to publish"). Offline: node:sqlite as D1. Proves, with no live state:
//   1. source guard: the string stage = 'parked' is written nowhere in worker.js (comments aside) except the one tolerant read of the old state, legacyParkedSweep,
//      and no UPDATE research_queue sets status 'wontfix';
//   2. a database that REFUSES any write of stage 'parked' or status 'wontfix' (a trigger) sees every failure route of the worker pass: markError on each route
//      (below the recover ceiling, review cap, second revise pass, no-op, poison), the stale-claim reaper at the ceiling, the revise no-op ceiling, and laneReenter
//      for every kind -- each ends queued or deferred in the lane, with the reason in error and ONE lane-reenter event;
//   3. the recover ceiling cannot loop hot: a cycle costs recover_max + 1 failures, every re-entry is counted in the durable terminal_rearms, the first
//      TERMINAL_RECOVERY_MAX cycles are status queued and every later one is status deferred (RESEARCH-BACKPRESSURE-1 orders it), and the claim selector never
//      picks a deferred row;
//   4. an old parked row is still recovered (legacyParkedSweep), nothing is stranded.
// Run: node --no-warnings qnfo-research-exec/single-lane.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { markError, rerunRoute, reclaimStaleResearching, reviseNoopBound, laneReenter, laneStageFor, laneStatusFor, legacyParkedSweep } from "./worker.js";
import { versionAtLeast } from "../scripts/version-at-least.mjs";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d !== undefined ? " -- " + JSON.stringify(d).slice(0, 500) : "")); } };
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");

// ---- 1. source guard ---------------------------------------------------------------------------------------------------------------------
{
  // full-line comments and block comments carry the history of the old behaviour; only code is scanned
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const fnStart = code.indexOf("async function legacyParkedSweep(");
  const fnEnd = code.indexOf("\n}\n", fnStart);
  ok(fnStart > 0 && fnEnd > fnStart, "legacyParkedSweep is present");
  const body = code.slice(fnStart, fnEnd);
  const outside = code.slice(0, fnStart) + code.slice(fnEnd);
  const park = /stage\s*=\s*'parked'|stage\s*:\s*["']parked["']|stage\s*=\s*["']parked["']/g;
  ok((outside.match(park) || []).length === 0, "stage = 'parked' is written nowhere outside the tolerant read", (outside.match(park) || []).slice(0, 3));
  ok((body.match(park) || []).length === 1 && /SELECT id, error, recover_count FROM research_queue WHERE stage = 'parked'/.test(body), "the one occurrence is the SELECT of legacyParkedSweep, not a write");
  ok(!/UPDATE research_queue[^"`]*status\s*=\s*'wontfix'/.test(code) && !/UPDATE research_queue[^"`]*status='wontfix'/.test(code), "no UPDATE research_queue sets status wontfix");
  ok(!/parkPoisonRow|parkMathRow|parkRearmTick|floorRearmTick|parkedRegroundTick/.test(code), "the park writers and the sweeps that undid them are gone");
  const ver = /var VERSION = "([^"]+)"/.exec(src)?.[1];
  const mirror = /var VERSION = "([^"]+)"/.exec(readFileSync(join(here, "deployed-current.worker.js"), "utf8"))?.[1];
  ok(versionAtLeast(ver, "0.54.0") && mirror === ver, "the capability is at least 0.54.0 and the deploy mirror carries the same VERSION", { ver, mirror });
}

// ---- a lane database: any write of stage parked or status wontfix aborts the statement ----
function laneDb(opts = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, status TEXT DEFAULT 'queued', stage TEXT, claimed_at TEXT, attempt INTEGER DEFAULT 0, error TEXT, recover_count INTEGER DEFAULT 0, revise_count INTEGER DEFAULT 0, terminal_rearms INTEGER DEFAULT 0, context TEXT, score REAL, created_at TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), next_due_at TEXT, last_verdict TEXT, attempts INTEGER DEFAULT 0);`);
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('research_recover_max', ?)").run(String(opts.recoverMax || 3));
  return db;
}
const forbid = (db) => db.exec(`CREATE TRIGGER no_park_upd BEFORE UPDATE ON research_queue WHEN NEW.stage = 'parked' OR NEW.status = 'wontfix' BEGIN SELECT RAISE(ABORT, 'SINGLE-LANE-1 violated: parked or wontfix written'); END;
CREATE TRIGGER no_park_ins BEFORE INSERT ON research_queue WHEN NEW.stage = 'parked' OR NEW.status = 'wontfix' BEGIN SELECT RAISE(ABORT, 'SINGLE-LANE-1 violated: parked or wontfix inserted'); END;`);
function envOf(db) {
  return { QNFO_AUDIT: { prepare(sql) {
    let args = [];
    const o = { bind(...a) { args = a; return o; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; } };
    return o;
  } } };
}
const get = (db, id) => db.prepare("SELECT * FROM research_queue WHERE id = ?").get(id);
const laneEvents = (db) => db.prepare("SELECT text FROM cloud_ops_events WHERE kind = 'lane-reenter'").all().map((e) => e.text);
const put = (db, id, o = {}) => db.prepare("INSERT INTO research_queue (id, source, source_id, status, stage, recover_count, revise_count, terminal_rearms, claimed_at, context, created_at) VALUES (?, 'proposal', ?, ?, ?, ?, ?, ?, ?, '{}', ?)")
  .run(id, "p:" + id, o.status || "researching", o.stage || "revise", o.recover || 0, o.revise || 0, o.rearms || 0, o.claimed === undefined ? "2026-11-05T00:00:00Z" : o.claimed, o.created || "2026-11-01T00:00:00Z");

// ---- 2. every failure route, against a database that refuses any parked or wontfix write --------------------------------------------------------
{
  const db = laneDb(); forbid(db); const env = envOf(db);
  let threw = null;
  try {
    // routes below the recover ceiling
    put(db, "ground-fail", { stage: "verify", recover: 0 });
    await markError(env, { ...get(db, "ground-fail") }, "ground: bibliography 2 < 5");
    put(db, "review-once", { stage: "review", recover: 0 });
    await markError(env, { ...get(db, "review-once") }, "review: reviewer unavailable");
    put(db, "review-cap", { stage: "review", recover: 0 });
    await markError(env, { ...get(db, "review-cap") }, "review: 2 HARD findings unresolved after 6 revise cycles (H1,H2)");
    put(db, "second-pass", { stage: "revise", recover: 1 });
    await markError(env, { ...get(db, "second-pass"), error: "RERUN-ROUTE-1 revise-once: review: x" }, "review: 1 HARD");
    put(db, "applied-zero", { stage: "revise", recover: 0 });
    await markError(env, { ...get(db, "applied-zero") }, "revise: no applicable edit (applied=0)");
    // the recover ceiling
    put(db, "ceiling", { stage: "verify", recover: 3 });
    await markError(env, { ...get(db, "ceiling") }, "verify: unresolved after revision - mismatch=true gates=");
    // a stale claim at the ceiling, and the revise no-op ceiling
    put(db, "stale", { stage: "revise", recover: 3, claimed: "2020-01-01T00:00:00Z" });
    await reclaimStaleResearching(env);
    put(db, "noop", { stage: "revise", revise: 1 });
    const nb = await reviseNoopBound(env, { ...get(db, "noop") });
    ok(nb.lane === true && nb.revise_count === 2, "reviseNoopBound at the ceiling reports a lane re-entry", nb);
    // every kind
    for (const kind of ["findings", "noop", "poison", "math", "stale", "legacy"]) {
      put(db, "kind-" + kind, { stage: "verify" });
      const r = await laneReenter(env, { ...get(db, "kind-" + kind) }, { kind, prior: "verify", reason: "reason for " + kind });
      ok(r.requeued === true && r.stage === (kind === "findings" ? "revise" : "ground"), "laneReenter(" + kind + ") re-enters at the stage the kind names", r);
    }
  } catch (e) { threw = e; }
  ok(threw === null, "no failure route writes stage parked or status wontfix (the database refuses both)", threw && threw.message);
  ok(db.prepare("SELECT count(*) n FROM research_queue WHERE stage = 'parked' OR status = 'wontfix'").get().n === 0, "no parked or wontfix row exists afterwards");
  const g = get(db, "ground-fail");
  ok(g.status === "queued" && g.stage === "ground" && g.recover_count === 1, "a failure below the ceiling is unchanged: queued at ground, recover_count + 1", g);
  const ro = get(db, "review-once");
  ok(ro.status === "researching" && ro.stage === "revise" && /^RERUN-ROUTE-1 revise-once:/.test(ro.error), "the one revise-once re-entry is unchanged", ro);
  for (const id of ["review-cap", "second-pass"]) {
    const r = get(db, id);
    ok(r.status === "queued" && r.stage === "revise" && /^SINGLE-LANE-1: re-entered at revise, no parked state\. Was: review: /.test(r.error) && r.recover_count === 0 && r.terminal_rearms === 1, id + " re-enters the lane at revise with the findings in error", r);
  }
  const az = get(db, "applied-zero");
  ok(az.status === "queued" && az.stage === "ground" && /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: revise: no applicable edit \(applied=0\)/.test(az.error), "a no-op re-enters at ground (another revise pass would repeat it)", az);
  const ce = get(db, "ceiling");
  ok(ce.status === "queued" && ce.stage === "ground" && /Was: recover_count exhausted \(3\); last error: verify: unresolved/.test(ce.error) && ce.error.length <= 300, "the recover ceiling re-enters at ground with the reason", ce);
  const st = get(db, "stale");
  ok(st.status === "queued" && st.stage === "ground" && st.claimed_at === null && /Was: stale researching claim with recover_count exhausted \(3\)/.test(st.error), "a stale claim at the ceiling re-enters the lane", st);
  const nz = get(db, "noop");
  ok(nz.status === "queued" && nz.stage === "ground" && nz.revise_count === 0 && /Was: REVISE-NOOP-BOUND-1 revise_count>=2/.test(nz.error), "the revise no-op ceiling re-enters at ground with revise_count reset", nz);
  const reentries = ["review-cap", "second-pass", "applied-zero", "ceiling", "stale", "noop", "kind-findings", "kind-noop", "kind-poison", "kind-math", "kind-stale", "kind-legacy"];
  ok(laneEvents(db).length === reentries.length, "exactly one lane-reenter event per re-entry", { events: laneEvents(db).length, expected: reentries.length });
  ok(rerunRoute({}, "review: 2 HARD findings unresolved after 6 revise cycles (H1)").stage === "lane" && rerunRoute({}, "revise: applied=0").stage === "lane" && rerunRoute({}, "ground: x").stage === "ground", "rerunRoute names the lane, not a parked state");
}

// ---- 3. the recover ceiling cannot loop hot ----------------------------------------------------------------------------------------------------
{
  const db = laneDb({ recoverMax: 3 }); forbid(db); const env = envOf(db);
  put(db, "hot", { stage: "verify" });
  const statuses = [], cycles = [];
  let ceilings = 0;
  for (let i = 0; i < 12; i++) {
    // the row is claimed again after each failure (the claim is simulated), then fails again
    db.prepare("UPDATE research_queue SET status = 'researching', claimed_at = '2026-11-05T00:00:00Z' WHERE id = 'hot'").run();
    const before = get(db, "hot").terminal_rearms;
    await markError(env, { ...get(db, "hot") }, "verify: unresolved after revision - mismatch=true gates=gate-length");
    const after = get(db, "hot");
    if (after.terminal_rearms > before) { ceilings++; statuses.push(after.status); cycles.push(after.terminal_rearms); }
  }
  ok(ceilings === 3, "12 failures cross the recover ceiling 3 times (recover_max + 1 failures per cycle), not every time", { ceilings });
  ok(JSON.stringify(cycles) === JSON.stringify([1, 2, 3]), "every re-entry is counted in terminal_rearms, which the stages never rewrite", cycles);
  ok(JSON.stringify(statuses) === JSON.stringify(["queued", "queued", "deferred"]), "the first TERMINAL_RECOVERY_MAX cycles re-enter as queued, every later one as deferred", statuses);
  ok(laneStatusFor(0) === "queued" && laneStatusFor(1) === "queued" && laneStatusFor(2) === "deferred" && laneStatusFor(9) === "deferred", "laneStatusFor is the ceiling rule");
  ok(laneStageFor("findings", 0) === "revise" && laneStageFor("findings", 1) === "revise" && laneStageFor("findings", 2) === "ground" && laneStageFor("poison", 0) === "ground" && laneStageFor("noop", 0) === "ground", "laneStageFor: findings keep their draft for the first two cycles, every other failure drafts again");
  // the claim selector (the one the executor runs) never picks a deferred row; a queued row is picked
  const sel = src.match(/var RESEARCH_CLAIM_ID_SQL = `([^`]+)`;/)[1];
  const pick = () => (db.prepare("SELECT (" + sel + ") AS id").get() || {}).id;
  const deferred = get(db, "hot");
  ok(deferred.status === "deferred" && deferred.stage === "ground" && pick() === null, "a deferred row is not claimable: it waits for the RESEARCH-BACKPRESSURE-1 release", { status: deferred.status, picked: pick() });
  put(db, "fresh", { status: "queued", stage: "ground", claimed: null });
  ok(pick() === "fresh", "a queued row is claimed as before", pick());
  // the release of qnfo-fleet-control only flips deferred -> queued; the row then carries its counter and its reason
  db.prepare("UPDATE research_queue SET status = 'queued', error = NULL WHERE id = 'hot' AND status = 'deferred'").run();
  ok(get(db, "hot").terminal_rearms === 3 && get(db, "hot").stage === "ground", "the release leaves the counter and the stage in place");
  ok(db.prepare("SELECT count(*) n FROM research_queue WHERE stage = 'parked' OR status = 'wontfix'").get().n === 0, "no parked or wontfix row at any point of the loop");
}

// ---- 4. an old parked row is still recovered ----------------------------------------------------------------------------------------------------
{
  const db = laneDb(); const env = envOf(db);
  put(db, "old-1", { status: "wontfix", stage: "parked" });
  db.prepare("UPDATE research_queue SET error = 'PARKED-POISON-1: recover_count exhausted (3); last error: verify: x' WHERE id = 'old-1'").run();
  put(db, "old-2", { status: "researching", stage: "parked" });
  put(db, "live", { status: "queued", stage: "ground", claimed: null });
  const r = await legacyParkedSweep(env);
  ok(r.reentered === 2, "both old rows are returned", r);
  ok(get(db, "old-1").status === "queued" && get(db, "old-1").stage === "ground" && /^SINGLE-LANE-1: re-entered at ground, no parked state\. Was: PARKED-POISON-1/.test(get(db, "old-1").error), "an old parked row re-enters at ground with its old reason kept", get(db, "old-1"));
  ok(get(db, "old-2").status === "queued" && get(db, "live").terminal_rearms === 0, "a researching row with the old stage is returned and a live row is untouched");
  ok(db.prepare("SELECT count(*) n FROM research_queue WHERE stage = 'parked'").get().n === 0, "nothing is left parked");
}

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
