// COST-TASK-OUTCOMES-1 suite (RM-COST-PER-TASK-ALL-PATHS-1): scripts/cost_task_outcomes.py writes qnfo-audit.task_outcomes_daily and the view
// v_cost_per_task_all_paths reads it, so no counted path shows a NULL ok_tasks. Nothing here reads live state.
// Run: node scripts/cost-task-outcomes.test.mjs   -> prints "N passed, 0 failed"
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 400) : "")); } };
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"], { encoding: "utf8" }).status === 0);
if (!PY) throw new Error("no python on PATH");

const self = spawnSync(PY, ["-I", join(here, "cost_task_outcomes.py"), "--selftest"], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
ok(self.status === 0 && /selftest ok/.test(self.stdout), "the script's own selftest passes (zero days, chunking under 100 parameters, plane failure leaves the unit rows running)", (self.stdout + self.stderr).slice(-300));

const script = readFileSync(join(here, "cost_task_outcomes.py"), "utf8");
ok(!/personal-life/.test(script.replace(/PERSONAL-QNFO-SEPARATION-1|personal-life database is deliberately NOT read/g, "")), "the personal-life database is never named as a source");
ok(/SELECT substr\(published_at, 1, 10\) AS day, COUNT\(\*\) AS n FROM published_pieces/.test(script), "q08 is read as a per-day count only (no title or body column)");
ok(!/\bbody_md\b|\bbody_html\b|\btitle\b\s*FROM/.test(script.split("def read_q08")[1].split("UPSERT_HEAD")[0]), "the q08 read selects no content column");

const files = readdirSync(join(root, "migrations")).filter((f) => /^2026-11-05-w2f-a-task-outcomes\.sql$/.test(f));
ok(files.length === 1, "the schema migration exists", files);
const mig = files.length ? readFileSync(join(root, "migrations", files[0]), "utf8") : "";
ok(/^-- APPLY-BY: ci$/m.test(mig) && /^-- DB: qnfo-audit$/m.test(mig) && /^-- Rollback: .+/m.test(mig), "the migration carries the three runner header lines");
ok(!/\b(DELETE FROM|DROP TABLE|DROP VIEW)\b/i.test(mig.replace(/^--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''")), "the migration destroys nothing (no BACKUP table needed)");
ok(/CREATE TABLE IF NOT EXISTS task_outcomes_daily/.test(mig) && /PRIMARY KEY \(day, path, task_class\)/.test(mig), "task_outcomes_daily has the key the upsert conflicts on");
for (const col of ["day", "path", "task_class", "ok_tasks", "source", "updated_at"]) ok(new RegExp("\\b" + col + "\\b").test(mig.split("CREATE VIEW")[0]), "table column " + col);
ok(/CREATE VIEW IF NOT EXISTS v_cost_per_task_all_paths/.test(mig) && /FROM v_cost_per_task_class/.test(mig), "the view extends v_cost_per_task_class instead of replacing it");
ok(/ok_kind/.test(mig) && /'unit-call'/.test(mig) && /'outcome'/.test(mig), "the view says whether ok_tasks is an outcome or only a successful call");

const wf = readFileSync(join(root, ".github/workflows/remediation-consumer.yml"), "utf8");
const heavy = wf.slice(wf.indexOf("remediation-consumer-heavy"));
ok(/scripts\/cost_task_outcomes\.py --selftest && python3 scripts\/cost_task_outcomes\.py/.test(heavy), "the heavy job runs the script after its selftest");
const at = heavy.indexOf("cost_task_outcomes.py");
ok(at > 0 && /continue-on-error: true/.test(heavy.slice(Math.max(0, at - 400), at)), "the step never fails the job");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
