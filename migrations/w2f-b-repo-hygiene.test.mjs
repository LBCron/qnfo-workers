// W2F-B offline suite: replays migrations/2026-11-05-w2f-b-repo-hygiene.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); rows 18, 19 and 21 of roadmap_implementation take status partial,
// keep their old evidence and append one dated reading; four ROADMAP-1 issue rows are filed once, each with the routing lines the loops read (a path that exists on this checkout, an
// anchor that occurs once in it, a code-probe that parses); a replay changes nothing; the Rollback line puts the rows back and removes the four issues. Output MUST contain "0 failed".
//   node migrations/w2f-b-repo-hygiene.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-w2f-b-repo-hygiene.sql");
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
ok(/CAUSE-MAPPED/.test(sql), "the file says it registers no metric");

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
  const before = { 18: "partial", 19: "partial", 21: "not-built" };
  for (const [id, st] of Object.entries(before)) w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence, verified_at) VALUES (?, ?, 's', 't', 'core', ?, ?, ?)").run(Number(id), "RM-" + id, st, "VSM old evidence " + id, id === "21" ? null : "2026-11-05T01:40:00Z");
  return w;
}
const snapshot = (w) => JSON.stringify({
  r: w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation ORDER BY id").all(),
  a: w.prepare("SELECT title, description, status FROM agent_issues ORDER BY id").all(),
});
const w = world();
const s0 = snapshot(w);
w.exec(sql);
const rows = Object.fromEntries(w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation").all().map((r) => [r.id, r]));
for (const id of [18, 19, 21]) {
  ok(rows[id].status === "partial", `row ${id} is partial`, rows[id].status);
  ok(rows[id].evidence.startsWith("VSM old evidence " + id + " | W2F-B 2026-11-05: "), `row ${id} keeps its old evidence and appends the dated reading`, rows[id].evidence.slice(0, 80));
  ok(rows[id].verified_at && /^2026-11-05T/.test(rows[id].verified_at), `row ${id} has verified_at`);
}
ok(/PR 7674/.test(rows[21].evidence), "row 21 names the first merged pull request");
ok(!/\bdeployed\b/i.test(rows[18].evidence + rows[19].evidence) || /not deployed|nothing deployed|no fold/i.test(rows[18].evidence + rows[19].evidence), "rows 18 and 19 claim no deployed fold");

const issues = w.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(issues.length === 4 && issues.every((i) => i.status === "open" && i.title.startsWith("ROADMAP-1: QNFO.INFRA ")), "four open ROADMAP-1 rows are filed", issues.map((i) => i.title.slice(0, 60)));
for (const i of issues) {
  const m = /^code-task: repo=qnfo-workers path=([^\n]+)\ncode-anchor: ([^\n]+)\ncode-probe: (\{[^\n]+\})\n/.exec(i.description) || /^session-task: repo=qnfo-workers path=([^\n]+)\nedit-near: ([^\n]+)\ncode-probe: (\{[^\n]+\})\n/.exec(i.description);
  ok(!!m, "the description opens with the routing lines and a probe: " + i.title.slice(24, 60), i.description.slice(0, 160));
  if (!m) continue;
  const rel = m[1], anchor = m[2];
  ok(existsSync(new URL(rel, root)), "the routed path exists: " + rel);
  if (existsSync(new URL(rel, root))) {
    const text = readFileSync(new URL(rel, root), "utf8");
    ok(text.split(anchor).length - 1 === 1, "the anchor occurs exactly once in " + rel + ": " + anchor.slice(0, 70), text.split(anchor).length - 1);
  }
  let probe = null; try { probe = JSON.parse(m[3]); } catch (e) { /* reported below */ }
  ok(probe && Array.isArray(probe.paths) && (typeof probe.contains === "string" || typeof probe.absent === "string"), "the code-probe parses with paths and contains or absent", m[3]);
  ok(/Definition of done:/.test(i.description), "the issue states its definition of done");
}

// replay changes nothing
const s1 = snapshot(w);
w.exec(sql);
ok(snapshot(w) === s1, "a replay changes nothing");

// rollback puts everything back
const rb = rollbackLines[0].replace(/^-- Rollback:\s*/, "");
w.exec(rb);
const after = JSON.parse(snapshot(w)), orig = JSON.parse(s0);
ok(JSON.stringify(after.r.map((r) => [r.id, r.status, r.evidence, r.verified_at])) === JSON.stringify(orig.r.map((r) => [r.id, r.status, r.evidence, r.verified_at])), "rollback restores status, evidence and verified_at of the three rows");
ok(after.a.length === 0, "rollback removes the four filed rows");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
