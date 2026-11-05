// W2A-BP26-ASK-DISCLOSURE-1 suite: replays migrations/2026-11-05-w2a-bp26-ask-disclosure.sql on node:sqlite.
// Proves: the header opts in and names its backup; row 1397 gains the scan evidence once and only while partial; the two doer issues carry a code-task whose anchor occurs exactly once in the real
// file and a closing probe; a replay inserts nothing twice; the Rollback line restores the evidence and closes both issues; nothing is deleted, dropped or set verified.
// Output MUST contain "0 failed" on success.   node migrations/w2a-bp26-ask-disclosure.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-w2a-bp26-ask-disclosure.sql", import.meta.url), "utf8");
const aiSearch = readFileSync(new URL("../qnfo-ai-search/worker.js", import.meta.url), "utf8");
const bp26web = readFileSync(new URL("../scripts/bp26_web.py", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.some((l) => /^-- BACKUP: bak_20261105_w2a_ask_disclosure\s*$/.test(l)) && /CREATE TABLE IF NOT EXISTS bak_20261105_w2a_ask_disclosure/.test(body), "the backup table is named and created first");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/status\s*=\s*'(verified|closed|resolved)'/i.test(body), "nothing is set verified or closed");
ok(!/\b(LIKE|GLOB)\s+'[^']{51,}'/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no long LIKE pattern, no claude.ai link");

const SCHEMA = `
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
`;
function world(status) {
  const w = new DatabaseSync(":memory:");
  w.exec(SCHEMA);
  w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (1397, 'AI-1000341', 'x', 't', 'agent_issue', ?, 'old')").run(status);
  return w;
}
const w = world("partial");
w.exec(sql);
const ev = () => w.prepare("SELECT status s, evidence e FROM roadmap_implementation WHERE id = 1397").get();
ok(ev().s === "partial" && ev().e.startsWith("old Independent scan of the visible text") && /ask\.qwav\.tech/.test(ev().e), "row 1397 stays partial and gains the scan evidence");
for (const [title, anchor, file] of [["BP26-AI-ASK-DISCLOSURE-1:%", aiSearch, "qnfo-ai-search/worker.js"], ["BP26-AI-ASK-DISCLOSURE-2:%", bp26web, "scripts/bp26_web.py"]]) {
  const iss = w.prepare("SELECT description d, status s FROM agent_issues WHERE title LIKE ?").get(title);
  ok(iss && iss.s === "open" && iss.d.includes("code-task: repo=qnfo-workers path=" + file), file + " doer issue is open with a code-task", iss && iss.d.slice(-160));
  const a = iss && (iss.d.match(/code-anchor: (.+)/) || [])[1];
  ok(a && anchor.split(a).length - 1 === 1, file + " code-anchor occurs exactly once in the real file", a);
  ok(iss && /(runtime-probe|code-probe): \{.*\}\s*$/.test(iss.d), file + " issue ends with a closing probe line");
}
w.exec(sql);
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 2 && (ev().e.match(/Independent scan of the visible text/g) || []).length === 1, "a replay inserts and appends nothing twice");

const other = world("verified");
other.exec(sql);
ok(other.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 1397").get().e === "old", "a row that is no longer partial is not touched");

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const r = world("partial");
r.exec(sql);
r.exec(rollback);
ok(r.prepare("SELECT evidence e FROM roadmap_implementation WHERE id = 1397").get().e === "old" && r.prepare("SELECT COUNT(*) n FROM agent_issues WHERE status = 'closed'").get().n === 2, "the Rollback line restores the evidence and closes both issues");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
