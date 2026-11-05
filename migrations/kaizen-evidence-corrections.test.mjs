// KAIZEN-EVIDENCE-CORRECTIONS-1 offline suite: the correcting UPDATEs match the exact wording the two merged migrations wrote, change nothing else, are idempotent and roll back.
// Run: node migrations/kaizen-evidence-corrections.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8");
const sql = rd("2026-11-05-kaizen-evidence-corrections.sql");
const rollback = sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

// the wrong wording is the wording the earlier migrations wrote (so the guarded UPDATE can match it)
const WRONG63 = "Device side: the local cron 42b1988c is retired on the owner machine (GUARDS-LOCAL-ONLY-1)";
const WRONG_KC = "cost_source_registry (scope NOT NULL; 12 rows read 2026-11-05)";
ok(rd("2026-11-05-kaizen-scheduled-dispositions.sql").includes(WRONG63), "the row 63 wording is in the PR 7441 migration");
ok(rd("2026-11-05-kaizen-gate-runtime.sql").includes(WRONG_KC), "the registry count wording is in the PR 7407 migration");

const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, evidence TEXT); CREATE TABLE kaizen_candidates (id TEXT PRIMARY KEY, evidence TEXT);");
d.prepare("INSERT INTO roadmap_implementation VALUES (63, ?), (62, 'row 62 untouched')").run("head. Open: x. " + WRONG63);
d.prepare("INSERT INTO kaizen_candidates VALUES ('kc-fleet-vs-external-attr-20260926', ?), ('kc-other', 'other 12 rows read 2026-11-05')").run("orig | enforced at runtime: " + WRONG_KC + " and v_cost_fleet_30d exist");
const snap = () => JSON.stringify([d.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all(), d.prepare("SELECT * FROM kaizen_candidates ORDER BY id").all()]);
const orig = snap();
d.exec(sql);
const r63 = d.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 63").get().evidence;
ok(!/retired on the owner machine/.test(r63) && /cannot be read from here/.test(r63) && r63.startsWith("head. Open: x. Device side: no repository path reads the local cron 42b1988c"), "row 63 no longer claims the cron is retired", r63);
ok(d.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 62").get().evidence === "row 62 untouched", "row 62 is untouched");
const kc = d.prepare("SELECT id, evidence FROM kaizen_candidates ORDER BY id").all();
ok(kc[1].evidence === "other 12 rows read 2026-11-05" && /11 rows read 2026-11-05\) and v_cost_fleet_30d exist$/.test(kc[0].evidence) && kc[0].evidence.startsWith("orig | "), "only the registry row count changes, on the one candidate", kc);
const after = snap();
d.exec(sql);
ok(snap() === after, "a second apply changes nothing");
d.exec(rollback);
ok(snap() === orig, "the Rollback line restores both texts byte for byte");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- BACKUP: bak_20261105_kaizen_evidence$/m.test(sql), "the file carries APPLY-BY, DB and BACKUP header lines");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
