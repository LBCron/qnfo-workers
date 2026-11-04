import { readFileSync } from "node:fs";
import assert from "node:assert";
const s = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
assert.ok(s.includes("PRODUCT-FIRST-CLAIM-1"));
assert.ok(s.includes('"ORDER BY CASE WHEN " + PRODUCT_TASK_SQL + " THEN 0 ELSE 1 END'));
assert.equal(s, readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8"));
console.log("ok");
// PRODUCT-CLAIM-BOILERPLATE-1: the RED-DRAIN boilerplate "Definition of done and probe are on the issue" must not make a product task self-maintenance.
const sql = /const PRODUCT_TASK_SQL = "([^"]*)"/.exec(s)[1];
assert.ok(!/LIKE '%probe%'/.test(sql), "bare probe exclusion removed");
try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE q (path TEXT, goal TEXT)");
  const ins = db.prepare("INSERT INTO q VALUES (?, ?)");
  ins.run("personal-api/companion.js", "COMPANION-NO-TYPING-1 -- issue (RED-DRAIN-1 dispatch). Definition of done and probe are on the issue");
  ins.run("personal-api/worker.js", "METRIC-TRIGGER-2934 something");
  ins.run("qnfo-fleet-control/worker.js", "fix");
  ins.run("personal-api/worker.js", "PROBE-NEEDED-1 for issue");
  const rows = db.prepare("SELECT path, goal, (" + sql + ") AS p FROM q q").all().map((r) => r.p);
  assert.deepEqual(rows, [1, 0, 0, 0]);
} catch (e) { if (e.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && !/node:sqlite/.test(String(e.message))) throw e; }
console.log("ok behaviour");
