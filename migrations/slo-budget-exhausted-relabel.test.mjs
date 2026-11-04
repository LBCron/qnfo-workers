// SLO-PROBE-BUDGET-1 offline suite (migrations/2026-11-04-slo-budget-exhausted-relabel.sql). Replays the file on node:sqlite over bp26_probe_results rows shaped like the live ones.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line); only 'down: budget-exhausted' availability rows change (ok becomes NULL, id/run_at/subject kept); a real
// 'down: timeout', a 'status 200 in ... ms' row and a row of another metric are untouched; the backup holds the before-state; the SLO readers' filter (ok IS NOT NULL) no longer counts the
// relabelled rows (good and total both drop); a replay changes nothing; the Rollback line restores the original rows.
// Output MUST contain "0 failed" on success.   node migrations/slo-budget-exhausted-relabel.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-04-slo-budget-exhausted-relabel.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "nothing is deleted or dropped");

function world() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT)");
  const ins = raw.prepare("INSERT INTO bp26_probe_results (run_at, metric, subject, ok, detail, producer) VALUES (?, ?, ?, ?, ?, 'bp26_web')");
  for (const h of ["qwav.org", "qnfo.org", "papers.qnfo.org"]) ins.run("2026-11-04T18:11:33Z", "slo_attainment_28d_min", "avail:" + h, 0, "down: budget-exhausted");
  ins.run("2026-11-04T09:50:42Z", "slo_attainment_28d_min", "avail:fleet.qnfo.org", 0, "down: timeout");
  ins.run("2026-11-03T10:31:59Z", "slo_attainment_28d_min", "avail:fleet.qnfo.org", 0, "status 200 in 9920 ms");
  for (let i = 0; i < 5; i++) ins.run("2026-11-04T1" + i + ":00:00Z", "slo_attainment_28d_min", "avail:qwav.org", 1, "status 200 in 200 ms");
  ins.run("2026-11-04T18:11:33Z", "security_headers_pass", "qwav.org", 0, "down: budget-exhausted");
  return raw;
}
const q = (r, s, ...p) => r.prepare(s).all(...p);
const q1 = (r, s, ...p) => r.prepare(s).get(...p);
const readerCounts = (r) => q1(r, "SELECT SUM(ok) good, COUNT(*) n FROM bp26_probe_results WHERE metric = 'slo_attainment_28d_min' AND subject = 'avail:qwav.org' AND ok IS NOT NULL");

const w = world();
const before = readerCounts(w);
w.exec(sql);
const rows = q(w, "SELECT * FROM bp26_probe_results ORDER BY id");
ok(rows.filter((r) => r.ok === null).length === 3 && rows.filter((r) => r.ok === null).every((r) => /^not sampled: budget-exhausted/.test(r.detail) && r.metric === "slo_attainment_28d_min"), "the three budget-exhausted availability rows are relabelled with ok NULL", rows.filter((r) => r.ok === null));
ok(rows.find((r) => r.detail === "down: timeout").ok === 0, "a real timeout stays a failed sample");
ok(rows.find((r) => r.detail === "status 200 in 9920 ms").ok === 0, "a slow answer stays a failed sample");
ok(rows.find((r) => r.metric === "security_headers_pass").detail === "down: budget-exhausted", "a row of another metric is untouched");
ok(rows.length === 11 && new Set(rows.map((r) => r.id)).size === 11, "no row is added or removed");
const bak = q(w, "SELECT * FROM bak_20261104_slo_budget_exhausted");
ok(bak.length === 3 && bak.every((r) => r.ok === 0 && r.detail === "down: budget-exhausted"), "the backup holds the three before-state rows");
const after = readerCounts(w);
ok(before.n === 6 && after.n === 5 && before.good === after.good, "the SLO readers' filter drops the relabelled rows: qwav.org 5 of 6 -> 5 of 5 (one bad sample removed)", { before, after });
w.exec(sql);
ok(q(w, "SELECT * FROM bak_20261104_slo_budget_exhausted").length === 3 && q(w, "SELECT * FROM bp26_probe_results WHERE ok IS NULL").length === 3, "a replay changes nothing");
w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
const restored = q(w, "SELECT * FROM bp26_probe_results WHERE detail = 'down: budget-exhausted' AND metric = 'slo_attainment_28d_min'");
ok(restored.length === 3 && restored.every((r) => r.ok === 0), "the Rollback line restores the original rows", restored);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
