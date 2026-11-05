// REACH-JOURNEYS-PREDICTIONS-1 offline suite: replays migrations/2026-11-05-reach-journeys-predictions-1.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped); two decision rows land, once each, with a prediction in the parser's metric form;
// a replay writes nothing; every LIKE pattern is within D1's 50-byte limit.
// Output MUST contain "0 failed" on success.   node migrations/reach-journeys-predictions-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-reach-journeys-predictions-1.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO)\s+(decision_log|issue_lifecycle)\b/i.test(body), "APPEND-ONLY-LINT-1: decision_log is only inserted into");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

const w = new DatabaseSync(":memory:");
w.exec("CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT)");
w.exec(body);
const rows = w.prepare("SELECT action, predicted_outcome FROM decision_log ORDER BY id").all();
ok(rows.length === 2, "two decision rows", rows);
ok(rows.every((r) => /^[a-z_0-9]+\s*(<=|>=|<|>|=)\s*\d+\s+within\s+\d+\s*h$/.test(r.predicted_outcome)), "each prediction is in the parser's metric form", rows.map((r) => r.predicted_outcome));
ok(/REMEDIATION-OVERLOAD-BACKPRESSURE-1/.test(rows[0].action) && /PORTFOLIO-VIA-PR-1/.test(rows[1].action), "one row per change");
w.exec(body);
ok(w.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n === 2, "a replay writes nothing");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
