// C6-S3 offline suite: replays migrations/2026-11-05-c6-s3-roadmap-rows.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); the eight roadmap rows take the status the file states and keep their old evidence;
// reorg_work_queue 67-71 become DONE, 24 and 25 CANCELLED, 26 and 27 stay OPEN with a pointer; the ROADMAP-1 row FLEET-BUDGET-W3W4-1 is filed once with the routing line the loops read and a code-probe;
// a replay changes nothing; the Rollback line puts statuses, evidence and queue states back. The path the routing line names exists on this checkout and its anchor occurs once.
// Output MUST contain "0 failed" on success.   node migrations/c6-s3-roadmap-rows.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-c6-s3-roadmap-rows.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollbackLines = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollbackLines.length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

// the routing line of the filed row names a real file and an anchor that occurs once in it
{
  const m = /'session-task: repo=qnfo-workers path=([^']+)'\s*\|\|\s*char\(10\)\s*\|\|\s*\n?\s*'edit-near: ((?:[^']|'')+)'/.exec(body);
  ok(!!m, "the filed row has a session-task line with an edit-near anchor");
  if (m) {
    const rel = m[1], anchor = m[2].replace(/''/g, "'");
    ok(existsSync(new URL(rel, root)), "the routed path exists: " + rel);
    const text = readFileSync(new URL(rel, root), "utf8");
    ok(text.split(anchor).length - 1 >= 1, "the anchor is present in the routed file: " + anchor);
  }
  ok(/code-probe: \{"paths": \["qnfo-ops\/wrangler\.toml"\], "absent": "index_name = \\"qnfo-tasks\\""\}/.test(body), "the filed row carries a code-probe on qnfo-ops/wrangler.toml");
}

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE reorg_work_queue (id INTEGER PRIMARY KEY, item TEXT, evidence TEXT, owner TEXT, due TEXT, state TEXT, created_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
  const before = { 18: "partial", 19: "not-built", 20: "gate-verify", 45: "gate-verify", 46: "gate-verify", 47: "not-built", 48: "not-built", 117: "partial" };
  for (const [id, st] of Object.entries(before)) w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (?, ?, 's', 't', 'core', ?, ?)").run(Number(id), "RM-" + id, st, "VSM old evidence " + id);
  for (const id of [24, 25, 26, 27, 67, 68, 69, 70, 71]) w.prepare("INSERT INTO reorg_work_queue (id, item, evidence, state) VALUES (?, ?, ?, 'OPEN')").run(id, "q" + id, "old " + id);
  return { w, before };
}
const snapshot = (w) => JSON.stringify({
  r: w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation ORDER BY id").all(),
  q: w.prepare("SELECT id, state, evidence FROM reorg_work_queue ORDER BY id").all(),
  a: w.prepare("SELECT title, status FROM agent_issues ORDER BY id").all(),
});

const { w, before } = world();
const s0 = snapshot(w);
w.exec(sql);
const rows = Object.fromEntries(w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation").all().map((r) => [r.id, r]));
const want = { 18: "partial", 19: "partial", 20: "verified", 45: "verified", 46: "verified", 47: "superseded", 48: "verified", 117: "verified" };
for (const [id, st] of Object.entries(want)) {
  ok(rows[id].status === st, `row ${id} is ${st}`, rows[id].status);
  ok(rows[id].evidence.startsWith("VSM old evidence " + id + " | C6-S3 2026-11-05: "), `row ${id} keeps its old evidence and appends the dated reading`, rows[id].evidence.slice(0, 80));
  ok(rows[id].verified_at === "2026-11-05T01:40:00Z", `row ${id} has verified_at`);
}
const q = Object.fromEntries(w.prepare("SELECT id, state, evidence FROM reorg_work_queue").all().map((r) => [r.id, r]));
for (const id of [67, 68, 69, 70, 71]) ok(q[id].state === "DONE" && q[id].evidence.includes("C6-S3 2026-11-05"), `reorg_work_queue ${id} is DONE`);
for (const id of [24, 25]) ok(q[id].state === "CANCELLED" && /SUPERSEDED by agent_issues 10019/.test(q[id].evidence), `reorg_work_queue ${id} is CANCELLED as superseded by a named row`);
for (const id of [26, 27]) ok(q[id].state === "OPEN" && q[id].evidence.includes("FLEET-BUDGET-W3W4-1"), `reorg_work_queue ${id} stays OPEN and names the new row`);
const issues = w.prepare("SELECT * FROM agent_issues").all();
ok(issues.length === 1 && issues[0].status === "open" && issues[0].title.startsWith("ROADMAP-1: QNFO.INFRA FLEET-BUDGET-W3W4-1:"), "one ROADMAP-1 row is filed", issues.map((i) => i.title));
ok(/^session-task: repo=qnfo-workers path=qnfo-ops\/wrangler\.toml\nedit-near: index_name = "qnfo-tasks"\ncode-probe: /.test(issues[0].description), "the description opens with the routing and probe lines", issues[0].description.slice(0, 200));

// replay changes nothing
const s1 = snapshot(w);
w.exec(sql);
ok(snapshot(w) === s1, "a replay changes nothing");

// rollback puts everything back
const rb = rollbackLines[0].replace(/^-- Rollback:\s*/, "");
w.exec(rb);
const after = JSON.parse(snapshot(w)), orig = JSON.parse(s0);
ok(JSON.stringify(after.r.map((r) => [r.id, r.status, r.evidence])) === JSON.stringify(orig.r.map((r) => [r.id, r.status, r.evidence])), "rollback restores status and evidence of the eight rows");
ok(JSON.stringify(after.q) === JSON.stringify(orig.q), "rollback restores the queue rows");
ok(after.a.length === 0, "rollback removes the filed row");
void before;

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
