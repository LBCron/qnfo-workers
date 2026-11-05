// W2F-B offline suite: replays migrations/2026-11-05-w2f-b-archive-readers.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); three open ROADMAP-1 issue rows are filed once, each opening with the
// routing lines the loops read (a session-task path that exists on this checkout, an edit-near text that occurs once in it, a code-probe that parses); a replay changes nothing; the Rollback line
// removes the three rows. Output MUST contain "0 failed".   node migrations/w2f-b-archive-readers.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const sql = readFileSync(new URL("migrations/2026-11-05-w2f-b-archive-readers.sql", root), "utf8");
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

const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
w.exec(sql);
const issues = w.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(issues.length === 3 && issues.every((i) => i.status === "open" && i.title.startsWith("ROADMAP-1: QNFO.INFRA ARCHIVE-READERS-")), "three open ARCHIVE-READERS rows are filed", issues.map((i) => i.title.slice(0, 60)));
for (const i of issues) {
  const m = /^session-task: repo=qnfo-workers path=([^\n]+)\nedit-near: ([^\n]+)\ncode-probe: (\{[^\n]+\})\n/.exec(i.description);
  ok(!!m, "the description opens with the routing lines and a probe: " + i.title.slice(24, 60), i.description.slice(0, 160));
  if (!m) continue;
  const rel = m[1], anchor = m[2];
  ok(existsSync(new URL(rel, root)), "the routed path exists: " + rel);
  if (existsSync(new URL(rel, root))) {
    const text = readFileSync(new URL(rel, root), "utf8");
    ok(text.split(anchor).length - 1 === 1, "the edit-near text occurs exactly once in " + rel + ": " + anchor.slice(0, 70), text.split(anchor).length - 1);
    let probe = null; try { probe = JSON.parse(m[3]); } catch (e) { /* reported below */ }
    ok(probe && Array.isArray(probe.paths) && probe.paths.includes(rel) && typeof probe.contains === "string", "the code-probe parses and names the routed path", m[3]);
    ok(probe && !text.includes(probe.contains), "the code-probe does not pass before the fix (the text it wants is absent today)", probe && probe.contains);
  }
  ok(/Definition of done:/.test(i.description) && /Charter pillar core/.test(i.description), "the issue names its pillar and its definition of done");
}
const snap = () => JSON.stringify(w.prepare("SELECT title, description, status FROM agent_issues ORDER BY id").all());
const s1 = snap();
w.exec(sql);
ok(snap() === s1, "a replay changes nothing");
w.exec(rollbackLines[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT COUNT(*) AS n FROM agent_issues").get().n === 0, "rollback removes the three filed rows");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
