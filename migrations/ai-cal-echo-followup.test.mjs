// AI-CAL-ECHO-1 offline suite: migrations/2026-11-05-ai-cal-echo-followup.sql files one open issue with a doer (code-task, code-anchor, code-probe on lines of their own, real
// line breaks), a second apply files nothing, and the LIKE pattern stays under D1's 50-byte limit. It does not read the worker file: the anchor's uniqueness is the code
// loop's check at claim time, and a test pinning another session's live file would break on its next edit.
// Run: node migrations/ai-cal-echo-followup.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-ai-cal-echo-followup.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
d.exec(sql); d.exec(sql);
const rows = d.prepare("SELECT * FROM agent_issues").all();
ok(rows.length === 1 && rows[0].status === "open" && /^AI-CAL-ECHO-1: /.test(rows[0].title), "one open AI-CAL-ECHO-1 row after two applies", rows.map((r) => r.title));
const desc = rows[0].description;
ok(/^code-task: repo=qnfo-workers path=qnfo-ai-calibration\/worker\.js$/m.test(desc), "a code-task line of its own");
ok(/^code-anchor: function pingMaxTokens\(model\) \{$/m.test(desc), "a code-anchor line of its own (a function signature)");
ok(/^code-probe: \{"paths": \["qnfo-ai-calibration\/worker\.js"\], "contains": "ECHO-DETAIL-1"\}$/m.test(desc), "a code-probe line of its own");
ok(!desc.includes("\\n") && desc.includes("\n"), "real line breaks, no literal backslash-n");
ok(/Charter pillar: autonomy/.test(desc) && /Done:/.test(desc), "names the pillar and the definition of done");
ok(Buffer.byteLength("AI-CAL-ECHO-1: %") < 50, "the LIKE pattern is under 50 bytes");
ok(/^-- APPLY-BY: ci/m.test(sql) && /^-- DB: qnfo-audit/m.test(sql) && /^-- Rollback: /m.test(sql), "header carries APPLY-BY, DB and Rollback");
console.log("ai-cal-echo-followup: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
