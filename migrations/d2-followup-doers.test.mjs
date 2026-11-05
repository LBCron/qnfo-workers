// D2 follow-up doers offline suite (migrations/2026-11-05-d2-followup-doers.sql). Two new issues with a doer (code-task, code-anchor, code-probe on lines of their own, real
// line breaks, charter pillar named), two notes appended once to existing issues, a second apply changes nothing, LIKE patterns stay under D1's 50-byte limit, header and Rollback line.
// It does not read the worker files: the anchors' uniqueness is the code loop's check at claim time, and a test pinning other sessions' live files would break on their next edit.
// Run: node migrations/d2-followup-doers.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-d2-followup-doers.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "nothing is deleted or dropped");
for (const m of body.matchAll(/LIKE\s+'([^']*)'/gi)) ok(Buffer.byteLength(m[1]) < 50, "LIKE pattern under D1's 50-byte limit: " + m[1]);

const d = new DatabaseSync(":memory:");
d.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);");
d.prepare("INSERT INTO agent_issues (id, title, description, status) VALUES (1001925, 'AI-CAL-ECHO-1: x', 'orig', 'open'), (1000610, 'CHAOS-DRILL-FAILED-1: control:social-weekly-caps', 'orig', 'open')").run();
d.exec(sql); d.exec(sql);
const rows = d.prepare("SELECT * FROM agent_issues ORDER BY id").all();
ok(rows.length === 4, "two issues added, once, after two applies", rows.map((r) => r.title));
const pr = rows.find((r) => /^PROBE-REVIEW-ROOT-CAUSE-1: /.test(r.title)), dp = rows.find((r) => /^SLO-DATAPATH-1: /.test(r.title));
for (const [name, row, path, anchor, probe] of [
  ["PROBE-REVIEW-ROOT-CAUSE-1", pr, "qnfo-cloud-ops/worker.js", "function probeReviewPrompt(title, description, probe) {", "root-cause-probe-at-birth-1"],
  ["SLO-DATAPATH-1", dp, "scripts/bp26_web.py", "def collect_web(ctx):", "api/v3/now"]]) {
  ok(row && row.status === "open", name + " is open");
  if (!row) continue;
  const desc = row.description;
  ok(new RegExp("^code-task: repo=qnfo-workers path=" + path.replace(/[./]/g, "\\$&") + "$", "m").test(desc), name + ": a code-task line of its own");
  ok(desc.split("\n").includes("code-anchor: " + anchor), name + ": a code-anchor line of its own (a function signature)");
  ok(desc.split("\n").some((l) => l === 'code-probe: {"paths": ["' + path + '"], "contains": "' + probe + '"}'), name + ": a code-probe line of its own");
  ok(!desc.includes("\\n") && desc.includes("\n"), name + ": real line breaks, no literal backslash-n");
  ok(/Charter pillar: (autonomy|reliability)/.test(desc) && /Done:/.test(desc) && /Lever:/.test(desc), name + ": pillar, lever and definition of done named");
}
const note = "DELTA-NOTE (D2-slo-journeys-probes, 2026-11-05)";
ok(d.prepare("SELECT description FROM agent_issues WHERE id = 1001925").get().description.split(note).length === 2 && /routedModel/.test(d.prepare("SELECT description FROM agent_issues WHERE id = 1001925").get().description), "AI-CAL-ECHO-1 gets the decided fix once");
ok(d.prepare("SELECT description FROM agent_issues WHERE id = 1000610").get().description.split(note).length === 2 && /boundary day/.test(d.prepare("SELECT description FROM agent_issues WHERE id = 1000610").get().description), "the drill issue gets the boundary note once");
d.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(d.prepare("SELECT COUNT(*) n FROM agent_issues WHERE status = 'open'").get().n === 2, "the Rollback line closes the two new issues");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
