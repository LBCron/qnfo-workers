// VIEW-MATERIALIZE-1 offline suite: the view keeps its columns and each subquery sits in a MATERIALIZED CTE.
import { readFileSync } from "node:fs";
const s = readFileSync(new URL("./2026-11-04-issue-dead-end-materialize.sql", import.meta.url), "utf8");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
ok(/-- APPLY-BY: ci/.test(s) && /-- DB: qnfo-audit/.test(s) && /-- Rollback:/.test(s) && /-- BACKUP: bak_20261104_v_issue_dead_end/.test(s), "header");
ok(s.indexOf("CREATE TABLE IF NOT EXISTS bak_20261104_v_issue_dead_end") < s.indexOf("\nDROP VIEW"), "backup before drop");
ok((s.match(/AS MATERIALIZED/g) || []).length === 2, "two materialized CTEs");
for (const c of ["issue_id", "priority", "source", "age_min", "contract_class", "contract_status", "reason", "has_code_task_line", "code_task_status", "planner_outcome", "lane", "next_actor"]) ok(s.includes(c), "column " + c);
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
