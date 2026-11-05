// C5-OBSERVE: replays migrations/2026-11-04-c5-observe-probe-slices.sql (TP-2.3 slice evidence and the two follow-on issues) on in-memory tables.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE roadmap_implementation(id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT, verified_at TEXT);
INSERT INTO roadmap_implementation VALUES (127,'RM-TP-2-ONE-KERNEL','partial','read 2026-11-05: first part',NULL),(3,'other','built','keep',NULL);
CREATE TABLE transformation_levers(id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER, n INTEGER, status TEXT, note TEXT, updated_at TEXT, UNIQUE(tp,n));
INSERT INTO transformation_levers(tp,n,status,note) VALUES (2,3,'stalled','needs a session'),(2,4,'verified','keep');
CREATE TABLE agent_issues(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,description TEXT,source TEXT,category TEXT,priority TEXT,status TEXT,created_at TEXT,updated_at TEXT);
`);
const file = new URL("./2026-11-04-c5-observe-probe-slices.sql", import.meta.url);
const sql = readFileSync(file, "utf8");
db.exec(sql);

const r = db.prepare("SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = 127").get();
assert.equal(r.status, "partial", "the row stays partial");
assert.ok(r.evidence.startsWith("read 2026-11-05: first part | TP-2.3 slice 1"), "evidence is appended, not replaced");
assert.ok(r.verified_at);
assert.equal(db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 3").get().evidence, "keep");
// the Rollback line restores the original evidence
const rb = /^-- Rollback: (.*)$/m.exec(sql)[1];
db.exec(rb.split("; ").filter((s) => /UPDATE roadmap_implementation/.test(s)).join("; "));
assert.equal(db.prepare("SELECT evidence FROM roadmap_implementation WHERE id = 127").get().evidence, "read 2026-11-05: first part", "rollback strips the appended slice");

const lever = db.prepare("SELECT status, note FROM transformation_levers WHERE tp = 2 AND n = 3").get();
assert.equal(lever.status, "stalled", "the lever is not marked landed");
assert.match(lever.note, /PR 7430/);
assert.equal(db.prepare("SELECT note FROM transformation_levers WHERE tp = 2 AND n = 4").get().note, "keep");

const issues = db.prepare("SELECT title, description, status FROM agent_issues ORDER BY id").all();
assert.equal(issues.length, 2);
db.exec(sql.slice(sql.indexOf("INSERT INTO agent_issues"))); // the filing half applied a second time files nothing more
assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_issues").get().n, 2, "the issues are filed once");
const anchors = { "scripts/fleet-autoaudit.py": "def run_guard():", "qnfo-fleet-dashboard/worker.js": "async function healthProbes(env, liveNames) {" };
for (const i of issues) {
  assert.equal(i.status, "open");
  const p = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(i.description);
  assert.ok(p && anchors[p[1]], "a code-task line naming a file");
  assert.ok(i.description.includes("code-anchor: " + anchors[p[1]] + "\n"), "its anchor is a one-line signature");
  assert.match(i.description, /^code-probe: \{"paths": \["[^"]+"\], "contains": "[^"]+"\}$/m);
  // the anchor occurs exactly once in the file it names (when the file is in this checkout)
  const f = new URL("../" + p[1], import.meta.url);
  if (existsSync(f)) {
    const text = readFileSync(f, "utf8");
    assert.equal(text.split(anchors[p[1]]).length - 1, 1, p[1] + " holds the anchor once");
  }
}
console.log("c5-observe-probe-slices: ok");
