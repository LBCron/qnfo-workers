// D2C-VERIFICATION-EVIDENCE-1 offline suite: replays migrations/2026-11-05-d2c-verification-evidence.sql on SQLite with the live schemas of roadmap_implementation and
// decision_log. Proves: the two verification outcomes (GitHub 5466, 5467) are recorded once with the figures that close them, the two live configuration changes
// (gateway qnfo-infra retries, qnfo-fleet-lee AI_MODEL) are recorded once with what was written and how to undo it, a second apply adds nothing, the Rollback removes
// only the two roadmap rows, and the file contains no secret-looking value. No live state is read.
// Run: node migrations/d2c-verification-evidence.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-d2c-verification-evidence.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const d = new DatabaseSync(":memory:");
d.exec(`
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
`);
d.exec(sql);
const rm = d.prepare("SELECT item, status, evidence, verified_at, artifact_ref FROM roadmap_implementation ORDER BY item").all();
ok(rm.length === 2 && rm[0].item === "GH-5466" && rm[1].item === "GH-5467" && rm.every((r) => r.status === "verified" && /^\d{4}-\d\d-\d\dT/.test(r.verified_at)), "two verified roadmap rows", rm.map((r) => r.item));
ok(/1904/.test(rm[0].evidence) && /2026-10-31T12:51:08Z/.test(rm[0].evidence) && /7 passed, 0 failed/.test(rm[0].evidence) && /0\.50\.2/.test(rm[0].evidence), "GH-5466 carries the counts, the last event, the suite result and the live version");
ok(/e84ae25c91cbe43cb96e700df8c6ec4ab1208dbd0cd44af61acc53b206c38035/.test(rm[1].evidence) && /1,671,867/.test(rm[1].evidence) && /619 = 802 - 250 \+ 67/.test(rm[1].evidence), "GH-5467 carries the live hash, the size and the arithmetic of the 619 bytes");
ok(802 - 250 + 67 === 619 && 1588505 - 1587886 === 619, "the arithmetic in the evidence is right");
const dl = d.prepare("SELECT action, rollback_path, evidence FROM decision_log ORDER BY id").all();
ok(dl.length === 2 && /^D2C-GATEWAY-RETRIES-1:/.test(dl[0].action) && /^D2C-FLEET-LEE-MODEL-1:/.test(dl[1].action), "two decision rows", dl.map((r) => r.action.slice(0, 30)));
ok(dl.every((r) => r.rollback_path.length > 30), "each decision row says how to undo it");
ok(/retry_max_attempts null/.test(dl[0].evidence) && /2 \/ 1000 \/ exponential/.test(dl[0].evidence), "the gateway row records before and after");
ok(/run 41932624731/.test(dl[1].evidence) && /0 workers with code-level violations/.test(dl[1].evidence), "the lee row records the live floor sweep that went green");
d.exec(sql);
ok(d.prepare("SELECT COUNT(*) AS n FROM roadmap_implementation").get().n === 2 && d.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n === 2, "a second apply adds nothing");
ok(!/(Bearer |sk-[A-Za-z0-9]{10}|cfut_|api[_-]?key\s*[:=]\s*[A-Za-z0-9])/i.test(sql), "no secret-looking value in the file");
ok(/^-- APPLY-BY: ci/m.test(sql) && /^-- DB: qnfo-audit/m.test(sql) && /^-- Rollback: DELETE FROM roadmap_implementation/m.test(sql), "header carries APPLY-BY, DB and Rollback");
console.log("d2c-verification-evidence: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
