// MERGE-LANE-REQUIRED-1 migration suite (migrations/2026-11-05-merge-lane-required-checks.sql). The file files one issue for the code loop; this suite proves the filing is well formed
// without pinning any live state: one open issue, its description ends with a code-task, a code-anchor and a code-probe each on its own line, the code-probe is valid JSON of the shape the
// consumer reads (paths and one of absent or contains), the target file exists on this checkout, the file is idempotent, no title is closed or edited, and the Rollback line removes only the
// open issue. It does not assert that the anchor still occurs: once the doer lands the fix the anchor is gone, which is the point.
// Run: node migrations/merge-lane-required-checks.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-merge-lane-required-checks.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT)");
db.prepare("INSERT INTO agent_issues (title, status) VALUES ('MERGE-LANE-REQUIRED-1: a closed twin from an older attempt', 'closed')").run();
db.exec(sql);
let rows = db.prepare("SELECT * FROM agent_issues WHERE status = 'open'").all();
ok(rows.length === 1 && /^MERGE-LANE-REQUIRED-1:/.test(rows[0].title) && rows[0].priority === "high" && rows[0].category === "reliability", "exactly one open issue is filed, high priority", rows.map((r) => r.title));
ok(db.prepare("SELECT status FROM agent_issues WHERE id = 1").get().status === "closed", "a closed twin is left alone");
const d = rows[0].description;
const m = /\ncode-task: repo=qnfo-workers path=(\S+)\ncode-anchor: (.+)\ncode-probe: (\{.*\})$/.exec(d);
ok(!!m, "the description ends with a code-task, a code-anchor and a code-probe, each on its own line");
ok(m && existsSync(join(root, m[1])) && /^qnfo-fleet-control\/worker\.js$/.test(m[1]), "the code-task names a file that exists", m && m[1]);
let probe = null; try { probe = JSON.parse(m[3]); } catch (e) { /* reported below */ }
ok(probe && Array.isArray(probe.paths) && probe.paths.every((p) => existsSync(join(root, p))) && ((typeof probe.absent === "string") !== (typeof probe.contains === "string")), "the code-probe is JSON with existing paths and exactly one of absent or contains", probe);
ok(probe && probe.absent === m[2], "the probe passes exactly when the anchored line is gone", [probe && probe.absent, m && m[2]]);
ok(/Verify live:/.test(d) && /branch_hygiene_log/.test(d), "the description names its live measurement");
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 2, "applying the file twice files nothing more");
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: /m.test(sql), "the runner header lines are present");
db.exec(/^-- Rollback: (.*)$/m.exec(sql)[1]);
ok(db.prepare("SELECT COUNT(*) n FROM agent_issues WHERE status = 'open'").get().n === 0 && db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 1, "the Rollback line removes only the open issue");
ok(!/INSERT[^;]*INTO\s+metric_registry/i.test(sql) && !/\b(UPDATE|DROP)\b/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "no metric is registered and nothing is updated or dropped");

console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
