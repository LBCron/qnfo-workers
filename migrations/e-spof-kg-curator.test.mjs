// SPOF-ALTERNATE-RAN-E-2 offline suite. Run: node migrations/e-spof-kg-curator.test.mjs
// One registry row ('kg curator') is stamped once with the drill evidence; every other row is untouched; the old row is saved.
import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE spof_registry (component TEXT PRIMARY KEY, alternate_tested_at TEXT, evidence TEXT, reviewed_at TEXT)");
const ins = db.prepare("INSERT INTO spof_registry VALUES (?, ?, ?, ?)");
ins.run("kg curator", null, "KG-CURATE-2 evidence", "2026-11-05T03:24:32Z");
ins.run("qnfo-evolve cron", null, "EVOLVE-1", "2026-10-17T16:59:56Z");
ins.run("other", "2026-10-01T00:00:00Z", "old", "2026-10-01T00:00:00Z");
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL " + m); } };
const sql = readFileSync(new URL("./2026-11-05-e-spof-kg-curator.sql", import.meta.url), "utf8");
db.exec(sql);
const row = (c) => db.prepare("SELECT * FROM spof_registry WHERE component = ?").get(c);
ok(row("kg curator").alternate_tested_at === "2026-11-05T04:19:05Z", "kg curator is stamped with the run time");
ok(row("kg curator").evidence.startsWith("KG-CURATE-2 evidence | SPOF-ALTERNATE-RAN-E-2") && /41967048930/.test(row("kg curator").evidence), "the evidence is appended and names the run");
ok(/not read: whether the script skipped/.test(row("kg curator").evidence), "the evidence states what it does not prove");
ok(row("qnfo-evolve cron").alternate_tested_at === null && row("qnfo-evolve cron").evidence === "EVOLVE-1", "an untested row of another component stays untested");
ok(row("other").alternate_tested_at === "2026-10-01T00:00:00Z" && row("other").evidence === "old", "a tested row is untouched");
db.exec(sql);
ok((row("kg curator").evidence.match(/SPOF-ALTERNATE-RAN-E-2/g) || []).length === 1, "re-running adds nothing");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_e_spof_kg").get().n === 1 && db.prepare("SELECT alternate_tested_at a FROM bak_20261105_e_spof_kg").get().a === null, "the old row is saved untested");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql) && /^-- BACKUP: /m.test(sql), "migration header lines");
console.log(fail ? fail + " failed" : "all passed"); process.exit(fail ? 1 : 0);
