// C5-INTEL migrations (2026-11-04-c5-intel-code-battery.sql, 2026-11-04-c5-intel-roadmap-rows.sql): offline checks that do not read live state.
//  - every code-task/code-anchor pair they write names a file that exists and an anchor that occurs exactly once in it (a doer edits at the anchor);
//  - the header lines the migration runner requires are present;
//  - the metric migration maps a breach cause for every metric it registers (METRIC-CAUSE-AT-REGISTRATION-1) and registers a trigger or a named exemption;
//  - the row update only touches the four rows it names and every UPDATE is guarded by the status it was read at.
// Run: node migrations/c5-intel-anchors.test.mjs   -> prints "N passed, 0 failed"
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } };
const read = (f) => readFileSync(join(here, f), "utf8");

const battery = read("2026-11-04-c5-intel-code-battery.sql");
const rows = read("2026-11-04-c5-intel-roadmap-rows.sql");

for (const [name, sql] of [["battery", battery], ["rows", rows]]) {
  ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), name + ": runner header lines present");
}
ok(/^-- BACKUP: bak_\d+_c5_intel_rows$/m.test(rows) && /CREATE TABLE IF NOT EXISTS bak_\d+_c5_intel_rows AS/.test(rows), "rows: backup table is named and created before the updates");

// code-task / code-anchor pairs (SQL string literals joined with char(10))
function pairs(sql) {
  const out = [];
  const re = /code-task: repo=qnfo-workers path=([^'\s]+)'\s*\|\|\s*char\(10\)\s*\|\|\s*\n?\s*'code-anchor: ([^']*(?:''[^']*)*)'/g;
  let m;
  while ((m = re.exec(sql))) out.push({ path: m[1], anchor: m[2].replace(/''/g, "'") });
  return out;
}
const all = pairs(battery).concat(pairs(rows));
ok(all.length === 2, "two code-task pairs are written (battery guard, conversion experiment)", all);
for (const p of all) {
  const f = join(root, p.path);
  ok(existsSync(f), "code-task path exists: " + p.path);
  if (!existsSync(f)) continue;
  const src = readFileSync(f, "utf8");
  const n = src.split(p.anchor).length - 1;
  ok(n === 1, "anchor occurs exactly once in " + p.path + ": " + p.anchor, n);
  ok(/^(async )?function /.test(p.anchor), "anchor is a function signature line", p.anchor);
}

// the metric migration
const regs = [...battery.matchAll(/\('((?:coding_battery)[a-z_]*)', 'operational'/g)].map((m) => m[1]);
ok(regs.length === 2 && regs.includes("coding_battery_pass_rate") && regs.includes("coding_battery_age_days"), "two metrics are registered", regs);
for (const metric of regs) {
  ok(new RegExp("INTO metric_breach_cause[\\s\\S]*'" + metric + "', '(code-loop|measurement|spend|structure)'").test(battery), "breach cause mapped: " + metric);
  const trig = new RegExp("INTO analytics_metric_triggers[\\s\\S]*\\('" + metric + "'").test(battery);
  const ex = new RegExp("INTO metric_unmeasured_exemptions[\\s\\S]*\\('" + metric + "'").test(battery);
  ok(trig || ex, "trigger or named exemption: " + metric);
}
ok(/refresh_cadence|'weekly'/.test(battery) && !/'1w'/.test(battery), "cadence token is canonical");
ok(/'worker-written'/.test(battery), "metrics are worker-written (the orchestrator writes them)");

// the row migration
const updates = [...rows.matchAll(/UPDATE roadmap_implementation[\s\S]*?WHERE id = (\d+)\s+AND item = '([A-Z0-9-]+)'\s+AND status = '([a-z-]+)';/g)].map((m) => ({ id: Number(m[1]), item: m[2], status: m[3] }));
ok(updates.length === 4, "four guarded row updates", updates);
ok(JSON.stringify(updates.map((u) => u.id).sort((a, b) => a - b)) === "[6,8,129,132]", "only rows 6, 8, 129 and 132 are touched");
ok(updates.every((u) => !/wontfix|closed|obsolete/.test(u.status)), "no row is closed or dropped");
ok(!/status = '(closed|wontfix|done)'/.test(rows), "no row is set closed");
ok(/UPDATE roadmap_implementation\s+SET status = 'partial',\s+artifact_ref = 'qnfo-code-orchestrator'/.test(rows), "row 6 becomes partial (verification pending), not built");
ok(rows.split("INSERT INTO agent_issues").length - 1 === 1 && /WHERE NOT EXISTS \(SELECT 1 FROM agent_issues WHERE title = /.test(rows), "one issue row, guarded by its title");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
