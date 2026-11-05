// Offline test for migrations/2026-11-05-c6-s1-evidence.sql: the UPDATEs of rows 13, 15, 17 and 56 take effect on a row that is already 'partial'
// (the earlier file's status guard skipped them), keep the earlier evidence text as a suffix for 13, 15 and 17, and are safe to apply twice.
// Run: node migrations/c6-s1-evidence.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-c6-s1-evidence.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT NOT NULL, source TEXT NOT NULL DEFAULT 's', title TEXT NOT NULL DEFAULT 't', artifact_type TEXT NOT NULL DEFAULT 'cost', status TEXT NOT NULL, evidence TEXT, verified_at TEXT);
INSERT INTO roadmap_implementation (id, item, status, evidence) VALUES
 (13, 'RM-COST-L6-DRAFT-VERIFY-1', 'partial', 'VSM S3 / OODA act | backlog mining 2026-09-30'),
 (15, 'RM-COST-PER-TASK-ALL-PATHS-1', 'partial', 'VSM S3 / OODA orient | backlog mining 2026-09-30'),
 (17, 'RM-COST-FREE-FIRST-PARITY-1', 'partial', 'VSM S3 / OODA orient | AUDIT 2026-10-01T15:30Z old audit text'),
 (56, 'RM-ANALYTICS-ENGINE-METERS-1', 'partial', 'PARTIAL (C6-S1, PR 7414): earlier text'),
 (99, 'RM-OTHER', 'partial', 'untouched');`);
db.exec(sql);
const row = (id) => db.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = ?").get(id);
for (const id of [13, 15, 17, 56]) ok(/^PARTIAL \(C6-S1, PR 7414 and 7425\)/.test(row(id).evidence) && row(id).status === "partial" && row(id).verified_at, "row " + id + " carries the C6-S1 evidence and stays partial", row(id).evidence.slice(0, 80));
ok(row(13).evidence.endsWith(" | EARLIER: VSM S3 / OODA act | backlog mining 2026-09-30"), "row 13 keeps its earlier text as a suffix");
ok(row(17).evidence.endsWith(" | EARLIER: VSM S3 / OODA orient | AUDIT 2026-10-01T15:30Z old audit text"), "row 17 keeps the 2026-10-01 audit text as a suffix");
ok(!/EARLIER/.test(row(56).evidence) && /1001927/.test(row(56).evidence) && /67\.5 percent/.test(row(56).evidence), "row 56 is replaced (the earlier text was ours) and names the AE issue and the measured coverage");
ok(/1001924/.test(row(17).evidence) && /1001926/.test(row(17).evidence), "row 17 names both AI-METER-COVER issues");
ok(row(99).evidence === "untouched", "no other row is touched");
const before = [13, 15, 17, 56].map((id) => row(id).evidence);
db.exec(sql);
ok(JSON.stringify([13, 15, 17, 56].map((id) => row(id).evidence)) === JSON.stringify(before), "applying twice changes nothing (no doubled suffix)");
// the Rollback header strips the suffix again
db.exec("UPDATE roadmap_implementation SET evidence = substr(evidence, instr(evidence, ' | EARLIER: ') + 12) WHERE id IN (13, 15, 17) AND instr(evidence, ' | EARLIER: ') > 0;");
ok(row(13).evidence === "VSM S3 / OODA act | backlog mining 2026-09-30" && row(17).evidence === "VSM S3 / OODA orient | AUDIT 2026-10-01T15:30Z old audit text", "the Rollback header restores the earlier text of 13, 15 and 17");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
