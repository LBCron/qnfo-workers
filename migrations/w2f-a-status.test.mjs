// W2F-A status suite (roadmap rows 13, 15, 17, 56): replays migrations/2026-11-05-w2f-a-status.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped); the four rows take the status the file states and keep their old evidence; a replay changes
// nothing; the two stream issues carry a code-task line whose path exists and whose anchor occurs exactly once in it; the Rollback line puts statuses and evidence back.
// Output MUST contain "0 failed" on success.   node --no-warnings migrations/w2f-a-status.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-w2f-a-status.sql");
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
ok(!/INSERT INTO metric_registry/i.test(body), "no metric is registered (so no breach cause to map)");

// every code-task line names a path that exists and an anchor that occurs exactly once in it
{
  const re = /code-task: repo=qnfo-workers path=([^']+)'\s*\|\|\s*char\(10\)\s*\|\|\s*\n\s*'code-anchor: ((?:[^']|'')+)'/g;
  const found = Array.from(body.matchAll(re));
  ok(found.length === 2, "the two stream issues carry a code-task and a code-anchor", found.length);
  for (const m of found) {
    const rel = m[1], anchor = m[2].replace(/''/g, "'");
    ok(existsSync(new URL(rel, root)), "the routed path exists: " + rel);
    const text = readFileSync(new URL(rel, root), "utf8");
    ok(text.split(anchor).length - 1 === 1, "the anchor occurs exactly once in " + rel + ": " + anchor, text.split(anchor).length - 1);
  }
}

const BEFORE = { 13: "RM-COST-L6-DRAFT-VERIFY-1", 15: "RM-COST-PER-TASK-ALL-PATHS-1", 17: "RM-COST-FREE-FIRST-PARITY-1", 56: "RM-ANALYTICS-ENGINE-METERS-1" };
function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
  for (const [id, item] of Object.entries(BEFORE)) w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (?, ?, 's', 't', 'cost', 'partial', ?)").run(Number(id), item, "PARTIAL (C6-S1) old text " + id);
  w.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001924, 'AI-METER-COVER-3a: qnfo-model-eval calls Workers AI with no attribution (6 call sites)', 'old description', 'open')").run();
  return w;
}
const snap = (w) => JSON.stringify({ r: w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation ORDER BY id").all(), a: w.prepare("SELECT id, title, description, status FROM agent_issues ORDER BY id").all() });

{
  const w = world();
  const before = snap(w);
  w.exec(body);
  const rows = Object.fromEntries(w.prepare("SELECT id, status, evidence FROM roadmap_implementation").all().map((r) => [r.id, r]));
  ok(rows[15].status === "verified" && rows[13].status === "partial" && rows[17].status === "partial" && rows[56].status === "partial", "row 15 is verified; rows 13, 17 and 56 stay partial", Object.values(rows).map((r) => r.status));
  for (const id of [13, 15, 17, 56]) ok(rows[id].evidence.startsWith("PARTIAL (C6-S1) old text " + id) && rows[id].evidence.includes(" | W2F-A 2026-11-05: "), "row " + id + " keeps its old evidence and appends the new one");
  ok(/Open:/.test(rows[13].evidence) && /Open:/.test(rows[17].evidence) && /Open:/.test(rows[56].evidence), "each partial row names what is open");
  ok(/doer: agent_issues 1001813/.test(rows[13].evidence) && /doer: agent_issues 1001927/.test(rows[56].evidence), "each partial row names its doer");
  const issues = w.prepare("SELECT id, title, description, status FROM agent_issues ORDER BY id").all();
  const stream = issues.filter((i) => /^AI-METER-STREAM-1[ab]:/.test(i.title));
  ok(stream.length === 2 && stream.every((i) => i.status === "open" && /^code-task: repo=qnfo-workers path=/.test(i.description) && /code-probe: /.test(i.description)), "two stream issues are filed open with code-task and code-probe lines", stream.length);
  const once = snap(w);
  w.exec(body);
  ok(snap(w) === once, "a replay changes nothing");
  // the Rollback line puts statuses and evidence back
  const rb = rollbackLines[0].replace(/^-- Rollback:\s*/, "");
  w.exec(rb);
  const after = w.prepare("SELECT id, status, evidence FROM roadmap_implementation ORDER BY id").all();
  ok(after.every((r) => r.status === "partial" && r.evidence === "PARTIAL (C6-S1) old text " + r.id), "the Rollback line restores statuses and evidence", after.map((r) => r.status));
  ok(w.prepare("SELECT COUNT(*) n FROM agent_issues WHERE title LIKE 'AI-METER-STREAM-1%' AND status = 'open'").get().n === 0, "and closes the two issues it filed");
  ok(before !== once, "the migration changed something");
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
