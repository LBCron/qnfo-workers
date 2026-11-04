// HOME-PROBE-MARKERS-V3-1 offline suite: two non-liveness contract rows are repointed at markers the live pages carry, and nothing else changes
// (the two PAGE-LIVENESS-1 rows belong to migrations/2026-11-04-17-page-liveness-markers.sql, PR 7030).
// Run: node migrations/home-probe-markers-v3.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-04-home-probe-markers-v3.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, verify_probe TEXT, status TEXT)");
const ins = db.prepare("INSERT INTO remediation_contracts VALUES (?,?,?)");
const OLD = {
  "fm-page-css-never-sent": '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": ".fx-r{"}',
  "issue-1000784": '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": "Fix it"}',
  "rt-page-fleet-queue": '{"url": "https://fleet.qnfo.org/", "status": 200, "contains": "<title>QNFO fleet status", "max_ms": 15000}',
  "rt-page-qwav-home": '{"url": "https://qwav.org/", "status": 200, "contains": "QWAV Research Papers", "max_ms": 10000}',
  "rt-page-fleet-kpi": '{"url": "https://fleet.qnfo.org/kpi", "status": 200, "contains": "Fleet metrics", "max_ms": 15000}'
};
for (const [c, p] of Object.entries(OLD)) ins.run(c, p, "active");
db.exec(sql);
const raw = (c) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(c).p;
const get = (c) => JSON.parse(raw(c));

ok(get("fm-page-css-never-sent").contains === ".hero{border-radius" && get("fm-page-css-never-sent").url === "https://fleet.qnfo.org/", "the CSS probe uses the shell's inline CSS");
ok(get("issue-1000784").url === "https://fleet.qnfo.org/overview" && get("issue-1000784").contains === "Fix it", "the Fix it probe moved to the page that has the buttons");
ok(["rt-page-fleet-queue", "rt-page-qwav-home", "rt-page-fleet-kpi"].every((c) => raw(c) === OLD[c]), "the PAGE-LIVENESS-1 rows (PR 7030's) and unrelated rows are untouched");
ok(db.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE status = 'active'").get().n === 5, "no contract changed status or was removed");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "the migration carries the runner header lines");
ok(!/\b(DELETE|DROP)\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the migration deletes and drops nothing");
ok((sql.match(/^UPDATE /gm) || []).length === 2, "exactly two UPDATE statements");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
