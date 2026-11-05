// AI-METER-AE-2 suite (RM-ANALYTICS-ENGINE-METERS-1, agent_issues 1001927): scripts/ai_meter_ae.py reads dataset qnfo_ai_calls back into qnfo-audit.ai_meter_ae_daily.
// Nothing here reads live state: the script's own selftest runs on fakes, and the source pins check that the reader, the table, the view and the workflow step agree.
// Run: node scripts/ai-meter-ae.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);
if (!PY) throw new Error("no python on PATH");

const self = spawnSync(PY, ["-I", join(here, "ai_meter_ae.py"), "--selftest"], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
ok(self.status === 0 && /selftest ok/.test(self.stdout), "the script's selftest passes (query shape, row cleaning, 8-row chunks under 100 parameters, unknown dataset and missing table are not failures)", (self.stdout + self.stderr).slice(-300));

const script = readFileSync(join(here, "ai_meter_ae.py"), "utf8");
ok(/DATASET = "qnfo_ai_calls"/.test(script), "the reader names the dataset the qnfo-ai binding writes");
ok(/analytics_engine\/sql/.test(script) && /_sample_interval/.test(script), "it reads through the Analytics Engine SQL API and weights by _sample_interval");

const mig = readFileSync(join(root, "migrations/2026-11-05-w2f-a-ai-meter-ae.sql"), "utf8");
ok(/^-- APPLY-BY: ci$/m.test(mig) && /^-- DB: qnfo-audit$/m.test(mig) && /^-- Rollback: .+/m.test(mig), "the migration carries the three runner header lines");
const code = mig.replace(/^--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
ok(!/\b(DELETE FROM|DROP TABLE|DROP VIEW)\b/i.test(code), "the migration destroys nothing");
for (const col of ["day", "provider", "caller", "model", "outcome", "calls", "in_tok", "out_tok", "cached_tok", "usd", "points", "updated_at"]) {
  ok(new RegExp("\\b" + col + " (TEXT|INTEGER|REAL) NOT NULL").test(mig), "table column " + col);
  ok(new RegExp("\\b" + col + "\\b").test(script.split("UPSERT_HEAD")[1].split("UPSERT_TAIL")[0]), "the upsert writes " + col);
}
ok(/PRIMARY KEY \(day, provider, caller, model, outcome\)/.test(mig) && /ON CONFLICT\(day, provider, caller, model, outcome\)/.test(script), "the table key is the upsert's conflict target");
ok(/CREATE VIEW IF NOT EXISTS v_ai_meter_ae_vs_ledger/.test(mig) && /LEFT JOIN ai_spend_ledger l ON l\.day = a\.day AND l\.provider = a\.provider AND l\.caller = a\.caller AND l\.model = a\.model/.test(mig), "the view joins the ledger on its own key");

const wf = readFileSync(join(root, ".github/workflows/remediation-consumer.yml"), "utf8");
const heavy = wf.slice(wf.indexOf("remediation-consumer-heavy"));
ok(/scripts\/ai_meter_ae\.py --selftest && python3 scripts\/ai_meter_ae\.py/.test(heavy), "the heavy job runs the reader after its selftest");
const at = heavy.indexOf("ai_meter_ae.py");
ok(at > 0 && /continue-on-error: true/.test(heavy.slice(Math.max(0, at - 300), at)), "the step never fails the job");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
