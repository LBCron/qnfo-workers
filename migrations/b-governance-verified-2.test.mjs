// B-GOVERNANCE-3 migration suite: migrations/2026-11-05-b-governance-verified-2.sql verifies roadmap rows 1723 and 1709 with their live readings, moves 1706 to in_progress, touches no other row,
// never moves a row backwards on a replay, and writes one decision_log row.
// Run: node --no-warnings migrations/b-governance-verified-2.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "2026-11-05-b-governance-verified-2.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "headers");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO roadmap_implementation (id, item, status) VALUES (1723, 'CAPS', 'built'), (1709, 'SLO', 'built'), (1706, 'GRADUAL', 'planned'), (1722, 'READERS', 'in_progress'), (1710, 'other', 'planned');`);
db.exec(sql);
const rows = Object.fromEntries(db.prepare("SELECT * FROM roadmap_implementation").all().map((r) => [r.id, r]));
ok(rows[1723].status === "verified" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(rows[1723].verified_at) && /0\.48\.2/.test(rows[1723].evidence) && /Limit: no live trip/.test(rows[1723].evidence), "1723 verified with its reading and its stated limit", rows[1723]);
ok(rows[1709].status === "verified" && /0\.66\.3/.test(rows[1709].evidence) && /exercised offline only/.test(rows[1709].evidence), "1709 verified with its reading and its stated limit", rows[1709]);
ok(rows[1706].status === "in_progress" && rows[1706].verified_at === null && /PR 7633/.test(rows[1706].evidence), "1706 in progress with the next step", rows[1706]);
ok(rows[1722].status === "in_progress" && rows[1710].status === "planned", "1722 (readers) and other rows are untouched", [rows[1722].status, rows[1710].status]);
db.prepare("UPDATE roadmap_implementation SET status = 'verified' WHERE id = 1706").run();
db.exec(sql);
ok(db.prepare("SELECT status s FROM roadmap_implementation WHERE id = 1706").get().s === "verified", "a replay never moves a verified row back");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "one decision_log row");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
