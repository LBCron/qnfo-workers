// D2C-CF-ACTIONS-1 offline suite: the follow-up row filed by migrations/2026-11-05-d2c-cf-actions-followup.sql is one open ROADMAP-1 issue with a doer
// (code-task, code-anchor, code-probe on lines of their own, real line breaks, no literal backslash-n), a second apply files nothing, and the LIKE pattern the
// guard and the Rollback use stays under D1's 50-byte limit. It does not read scripts/cf_ops_actions.py: the anchor's uniqueness is the code loop's check at claim time.
// Run: node migrations/d2c-cf-actions-followup.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-d2c-cf-actions-followup.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
d.exec(sql); d.exec(sql);
const rows = d.prepare("SELECT * FROM agent_issues").all();
ok(rows.length === 1 && rows[0].status === "open" && /^ROADMAP-1: QNFO\.OPS D2C-CF-ACTIONS-1:/.test(rows[0].title), "one open ROADMAP-1 row after two applies", rows.map((r) => r.title));
const desc = rows[0].description;
ok(/^code-task: repo=qnfo-workers path=scripts\/cf_ops_actions\.py$/m.test(desc), "a code-task line of its own");
ok(/^code-anchor: def unbind_d1\(target: str, acct: str, token: str\) -> int:$/m.test(desc), "a code-anchor line of its own (a function signature)");
ok(/^code-probe: \{"paths": \["scripts\/cf_ops_actions\.py"\], "contains": "set-worker-var"\}$/m.test(desc), "a code-probe line of its own");
ok(!desc.includes("\\n") && desc.includes("\n"), "real line breaks, no literal backslash-n");
ok(/Charter pillar: autonomy/.test(desc) && /Done:/.test(desc), "names the pillar and the definition of done");
ok(Buffer.byteLength("ROADMAP-1: QNFO.OPS D2C-CF-ACTIONS-1:%") < 50, "the LIKE pattern is under 50 bytes");
ok(/^-- APPLY-BY: ci/m.test(sql) && /^-- DB: qnfo-audit/m.test(sql) && /^-- Rollback: /m.test(sql), "header carries APPLY-BY, DB and Rollback");
console.log("d2c-cf-actions-followup: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
