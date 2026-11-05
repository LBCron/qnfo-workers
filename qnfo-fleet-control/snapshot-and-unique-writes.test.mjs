// qnfo-fleet-control/snapshot-and-unique-writes.test.mjs
// CHARTER-SNAPSHOT-VALID-1, JOURNEY-RENAME-UNIQUE-1 and ADVISOR-INSERT-TARGET-1 (qnfo-fleet-control 0.66.6, pillar autonomy; GitHub 5764, 5753, 5213; agent_issues 1000798, 1000772).
// 1. charter_snapshots.state_json was JSON.stringify(ev).slice(0, 180000): ids 30 to 34 hold exactly 180000 characters and json_valid 0, GET /charter answers snapshot.state null and
//    charterLatest logs "Unterminated string in JSON at position 180000" (group 2633d0f0, 164 occurrences). The stored text is valid JSON now, cut on its structure.
// 2. jrnIssue renamed the first open issue of a journey to the title of the current failure; when a second open issue of the same journey already carries that title the UPDATE
//    violates idx_agent_issues_open_title_ci (group bddc26cc, 60 occurrences; journeys 'loop-heartbeats' had two open issues from 2026-10-31 11:00 to 19:16Z).
// 3. The advisor audit's INSERT INTO agent_issues ... ON CONFLICT(title) names no unique constraint of the live schema (both unique title indexes are partial): D1 answers
//    "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint", the audit's empty catch hid it, and no finding was filed since 0.58.x.
// Run: node qnfo-fleet-control/snapshot-and-unique-writes.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const src = readFileSync(process.env.WORKER_JS || new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

// ---- 1. the snapshot text
const ca = src.indexOf("// ---- CHARTER-LOOP-1:BEGIN"), cb = src.indexOf("// ---- CHARTER-LOOP-1:END ----");
ok(ca > 0 && cb > ca, "CHARTER-LOOP-1 markers found");
const C = new Function(src.slice(ca, cb) + "\nreturn { charterSnapshotJson: typeof charterSnapshotJson === 'function' ? charterSnapshotJson : null, CHARTER_SNAPSHOT_MAX: typeof CHARTER_SNAPSHOT_MAX === 'number' ? CHARTER_SNAPSHOT_MAX : null };")();
ok(typeof C.charterSnapshotJson === "function" && C.CHARTER_SNAPSHOT_MAX === 180000, "charterSnapshotJson and its 180000 budget exist");
ok(/\.bind\(ev\.ts, CHARTER_VERSION, VERSION, ev\.health, ev\.mvp_up, ev\.breaches\.length, charterSnapshotJson\(ev\), sha,/.test(src), "the snapshot row is bound to charterSnapshotJson(ev), not to a slice of the text");
if (C.charterSnapshotJson) {
  const mk = (n) => ({ charter_version: "1.0", ts: "2026-11-05T03:10:00Z", health: 0.59, mvp_up: 9, breaches: [{ key: "B1", text: "x".repeat(300) }],
    pillars: [{ key: "core", met: 3 }], metrics: Array.from({ length: 200 }, (_, i) => ({ metric: "m" + i, raw: i })), mvp: [{ worker: "w", up: true }],
    roadmap: Array.from({ length: n }, (_, i) => ({ item: "RM-" + i, status: "open", title: "t".repeat(110) })), objectives: [], shutdown: [] });
  const small = mk(50), s1 = C.charterSnapshotJson(small);
  ok(s1 === JSON.stringify(small), "a state inside the budget is stored unchanged, byte for byte");
  const big = mk(2000);                       // about 300 kB
  ok(JSON.stringify(big).length > 180000, "the fixture is over the budget");
  ok(!(() => { try { JSON.parse(JSON.stringify(big).slice(0, 180000)); return true; } catch (e) { return false; } })(), "the old cut is invalid JSON (the defect)");
  const s2 = C.charterSnapshotJson(big), p2 = JSON.parse(s2);
  ok(s2.length <= 180000, "an oversized state fits the budget", s2.length);
  ok(Array.isArray(p2.snapshot_trimmed) && p2.snapshot_trimmed.some((x) => x.indexOf("roadmap:2000->") === 0), "the cut is named in snapshot_trimmed", p2.snapshot_trimmed);
  ok(p2.health === 0.59 && p2.mvp_up === 9 && p2.breaches.length === 1 && p2.metrics.length === 200 && p2.roadmap.length > 0 && p2.roadmap.length < 2000, "the cut takes the largest list first and keeps the headline fields, breaches and metrics", { r: p2.roadmap.length });
  const huge = mk(2000); huge.metrics = Array.from({ length: 6000 }, (_, i) => ({ metric: "m" + i, raw: "y".repeat(80) })); huge.objectives = Array.from({ length: 4000 }, () => ({ o: "z".repeat(90) }));
  const s3 = C.charterSnapshotJson(huge), p3 = JSON.parse(s3);
  ok(s3.length <= 180000 && p3.health === 0.59 && p3.snapshot_trimmed.length >= 2, "several oversized lists are trimmed in turn and the result is still valid", p3.snapshot_trimmed);
  const absurd = mk(10); absurd.breaches = Array.from({ length: 3000 }, () => ({ text: "q".repeat(200) })); absurd.pillars = [];
  const s4 = C.charterSnapshotJson(absurd, 5000), p4 = JSON.parse(s4);
  ok(s4.length <= 5000 && p4.ts === absurd.ts && p4.snapshot_trimmed.indexOf("all") >= 0, "when no list helps, a headline-only state is stored (still valid JSON)", s4.length);
}

// ---- 2. the journey rename
const a = src.indexOf("// ---- FLEET-JOURNEYS-2:BEGIN ----"), b = src.indexOf("// ---- FLEET-JOURNEYS-2:END ----");
globalThis.__tf = async () => new Response("{}", { status: 404 });
const J = new Function("var VERSION = '0.66.6-test'; var timedFetch = globalThis.__tf;\n" + src.slice(src.indexOf("async function closeBlockedByContract("), src.indexOf("async function improvementLoopTick(")) + "\n" + src.slice(a, b) + "\nreturn { jrnIssue, JRN_PREFIX };")();
function mkDb() {
  const s = new DatabaseSync(":memory:");
  s.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, close_channel TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE UNIQUE INDEX idx_agent_issues_open_title ON agent_issues(title) WHERE status = 'open';
  CREATE UNIQUE INDEX idx_agent_issues_open_title_ci ON agent_issues(lower(trim(title))) WHERE status = 'open';
  CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, close_evidence TEXT);
  CREATE TABLE remediation_contracts (issue_id INTEGER, status TEXT, last_verdict TEXT);`);
  const wrap = (sql) => { let args = []; const st = s.prepare(sql); const o = { bind: (...x) => { args = x.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)); return o; }, all: async () => ({ results: st.all(...args) }), first: async () => st.get(...args) || null, run: async () => { const r = st.run(...args); return { meta: { changes: r.changes } }; } }; return o; };
  return { raw: s, db: { prepare: wrap } };
}
const P = J.JRN_PREFIX;
const jrn = (steps, failedN) => ({ name: "loop-heartbeats", steps: Array.from({ length: steps }, (_, i) => ({ name: "s" + i })), path: [] });
const failed = (n) => Array.from({ length: n }, (_, i) => ({ step: "s" + i, detail: "d" }));
{
  const { raw, db } = mkDb();
  const ins = raw.prepare("INSERT INTO agent_issues (title, description, status, created_at, updated_at) VALUES (?, 'old', 'open', 1, 1)");
  ins.run(P + ": loop-heartbeats (1 of 13 steps failing)"); ins.run(P + ": loop-heartbeats (2 of 7 steps failing)");
  // the legacy statement, to show the defect on this schema
  let legacyErr = "";
  try { raw.prepare("UPDATE agent_issues SET title = ?1, description = ?2, updated_at = ?3 WHERE id = ?4").run(P + ": loop-heartbeats (2 of 7 steps failing)", "d", 2, 1); } catch (e) { legacyErr = String(e.message); }
  ok(/UNIQUE constraint failed: index 'idx_agent_issues_open_title/.test(legacyErr), "the rename of the first open issue to its twin's title violates the open-title index (the defect)", legacyErr);
  let threw = "";
  try { await J.jrnIssue(db, jrn(7), false, failed(2), "t", 5); } catch (e) { threw = String(e.message); }
  ok(threw === "", "jrnIssue does not throw when an open twin already carries the new title", threw);
  const rows = raw.prepare("SELECT id, title, description FROM agent_issues ORDER BY id").all();
  ok(rows[0].title === P + ": loop-heartbeats (1 of 13 steps failing)" && rows[0].description === "old", "the first open issue is left alone", rows[0]);
  ok(rows[1].description !== "old" && rows[1].title === P + ": loop-heartbeats (2 of 7 steps failing)", "the twin that carries the title is the one kept current", rows[1]);
}
{
  const { raw, db } = mkDb();
  raw.prepare("INSERT INTO agent_issues (title, description, status, created_at, updated_at) VALUES (?, 'old', 'open', 1, 1)").run(P + ": loop-heartbeats (1 of 7 steps failing)");
  await J.jrnIssue(db, jrn(7), false, failed(3), "t", 5);
  const r = raw.prepare("SELECT title FROM agent_issues").all();
  ok(r.length === 1 && r[0].title === P + ": loop-heartbeats (3 of 7 steps failing)", "a single open issue is renamed to the current failure count as before", r);
  await J.jrnIssue(db, jrn(7), false, failed(3), "t", 6);
  ok(raw.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1, "the same failure again renames nothing and files nothing");
}

// ---- 3. the advisor INSERT
const m = /"(INSERT INTO agent_issues \(title, description, source, category, priority, status, created_at, updated_at\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?\)[^"]*)"/.exec(src);
ok(!!m, "the advisor audit's INSERT INTO agent_issues is found");
if (m) {
  const { raw } = mkDb();
  let err = "";
  const run = () => raw.prepare(m[1].replace(/\?/g, "?")).run("T1", "d", "qnfo-fleet-control", "k", "high", "open", 1, 1);
  try { run(); } catch (e) { err = String(e.message); }
  ok(err === "", "the statement is accepted by the live unique indexes (both partial)", err);
  let err2 = "", ch = -1;
  try { ch = Number(run().changes); } catch (e) { err2 = String(e.message); }
  ok(err2 === "" && ch === 0, "a second filing of an open title raises nothing and changes no row", { err2, ch });
  ok(!/ON CONFLICT\(title\)/.test(m[1]), "the conflict target no longer names a column the partial indexes do not cover");
  ok(/else filed\+\+;\s*\} catch \(e\) \{(?:\s*\/\/[^\n]*)*\s*console\.error\(JSON\.stringify\(\{ evt: "fleet-control:advisor:file"/.test(src), "the audit logs a filing error instead of swallowing it, and still counts only a written insert as filed");
  const legacy = "INSERT INTO agent_issues (title, description, source, category, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(title) DO UPDATE SET description=excluded.description";
  let le = ""; try { raw.prepare(legacy); } catch (e) { le = String(e.message); }
  ok(/ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/.test(le), "the legacy ON CONFLICT(title) is rejected by this schema (the defect)", le);
}

console.log((fail ? fail + " failed" : "0 failed") + ", " + pass + " passed");
process.exit(fail ? 1 : 0);
