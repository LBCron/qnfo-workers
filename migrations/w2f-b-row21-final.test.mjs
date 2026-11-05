// W2F-B offline suite: replays migrations/2026-11-05-w2f-b-row21-final.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped in the body); row 21 keeps its old evidence (including the first W2F-B reading) and gains
// one more dated reading, stays partial and never claims done; a replay changes nothing; the Rollback line removes only the final reading. Output MUST contain "0 failed".
//   node migrations/w2f-b-row21-final.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const sql = readFileSync(new URL("migrations/2026-11-05-w2f-b-row21-final.sql", root), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
const rollbackLines = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollbackLines.length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(/CAUSE-MAPPED/.test(sql), "the file says it registers no metric");

const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT);");
const first = "VSM old evidence | W2F-B 2026-11-05: PARTIAL, 30 of the 78 directories archived";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence, verified_at) VALUES (21, 'RM-21', 's', 't', 'core', 'partial', ?, '2026-11-05T04:30:00Z')").run(first);
const row = () => w.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = 21").get();
w.exec(sql);
const r = row();
ok(r.status === "partial", "row 21 stays partial", r.status);
ok(r.evidence.startsWith(first + " | W2F-B 2026-11-05 (final): "), "the old evidence and the first reading are kept, the final reading is appended", r.evidence.slice(0, 120));
ok(/44 of the 78/.test(r.evidence) && /\b7785 \(batch 5/.test(r.evidence) && /1002097/.test(r.evidence), "the final reading names the count, the last pull request and a doer");
ok(!/\b(done|complete|fully deployed)\b/i.test(r.evidence.slice(first.length)), "the final reading claims nothing is finished");
ok(/^2026-11-05T/.test(r.verified_at) && r.verified_at !== "2026-11-05T04:30:00Z", "verified_at moves to the reading time", r.verified_at);
const s1 = JSON.stringify(row());
w.exec(sql);
ok(JSON.stringify(row()) === s1, "a replay changes nothing");
w.exec(rollbackLines[0].replace(/^-- Rollback:\s*/, ""));
const b = row();
ok(b.evidence === first && b.verified_at === "2026-11-05T04:30:00Z", "rollback removes only the final reading and restores verified_at", b);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
