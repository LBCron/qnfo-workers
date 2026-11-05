// W2F-A wrap-up suite: migrations/2026-11-05-w2f-a-wrapup-issues.sql files three issues (SPEND-GOVERNOR-2, AI-METER-AE-3, AI-METER-KIMI-1), each with a code-task line, a code-anchor that occurs exactly once in
// its file, a code-probe and a definition of done. Replayed on node:sqlite: filed once, a replay adds nothing, the Rollback line closes them.
// Run: node --no-warnings migrations/w2f-a-wrapup-issues.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const sql = readFileSync(new URL("migrations/2026-11-05-w2f-a-wrapup-issues.sql", root), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)) && header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "header opts in with one Rollback line");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
w.exec(body);
const rows = w.prepare("SELECT title, description, status FROM agent_issues ORDER BY id").all();
ok(rows.length === 3 && rows.every((r) => r.status === "open"), "three issues are filed open", rows.map((r) => r.title.slice(0, 30)));
for (const r of rows) {
  const task = /code-task: repo=qnfo-workers path=(\S+)/.exec(r.description), anchor = /code-anchor: (.+)/.exec(r.description), probe = /code-probe: (\{.*\})/.exec(r.description);
  ok(!!task && !!anchor && !!probe, "code-task, code-anchor and code-probe lines: " + r.title.slice(0, 24));
  if (task && anchor) {
    ok(existsSync(new URL(task[1], root)), "the routed path exists: " + task[1]);
    const text = readFileSync(new URL(task[1], root), "utf8");
    ok(text.split(anchor[1]).length - 1 === 1, "the anchor occurs exactly once in " + task[1], text.split(anchor[1]).length - 1);
  }
  let parsed = null; try { parsed = JSON.parse(probe[1]); } catch (e) { parsed = null; }
  ok(parsed && Array.isArray(parsed.paths) && typeof parsed.contains === "string", "the code-probe is valid JSON with paths and contains");
  ok(/Definition of done:/.test(r.description) && /DO:/.test(r.description), "the issue has a DO and a Definition of done");
}
w.exec(body);
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 3, "a replay files nothing twice");
const rb = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
w.exec(rb);
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues WHERE status = 'open'").get().n === 0, "the Rollback line closes the three");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
