// KAIZEN-SCHEDULED-1 offline suite: replays migrations/2026-11-05-kaizen-scheduled-dispositions.sql on node:sqlite against a fixture with the live layout.
// Run: node migrations/kaizen-scheduled-dispositions.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const FILE = "2026-11-05-kaizen-scheduled-dispositions.sql";
const sql = readFileSync(new URL("./" + FILE, import.meta.url), "utf8");
const rollback = sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

const IDS = ["kc-20260904-errata-publish-flip", "kc-20260904-outreach-cap-classify", "kc-20260904-lifecycle-scan-unify", "kc-20260904-kaizen-autoapply", "kc-20260904-drift-cloud-migrate", "kc-20260904-router-selfopt", "kc-20260904-errata-source-repo", "b5f69d3b", "kc-20260908-quality-revision-wave", "kc-20260908-fleet-probe-coverage", "38ba2a60"];
function fixture() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE kaizen_candidates (id TEXT PRIMARY KEY, class TEXT, source TEXT, category TEXT, title TEXT, evidence TEXT, status TEXT DEFAULT 'proposed', created_at TEXT, updated_at TEXT);
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
  `);
  let rid = 5;
  const kc = d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (?, ?, ?, ?, 'scheduled')");
  for (const id of IDS) kc.run(++rid, id, "T " + id, "orig " + id);
  d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (60, 'kc-other', 'other', 'orig-other', 'promoted')").run();
  d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (61, 'kc-done', 'done already', 'orig-done', 'resolved')").run();
  d.exec("INSERT INTO roadmap_implementation (id, item, status, evidence) VALUES (62, 'RM-KAIZEN-GATE-CANDIDATES-1', 'built', 'gates'), (63, 'RM-KAIZEN-SCHEDULED-1', 'partial', 'VSM S3')");
  return d;
}
const n = (d, q) => Number(Object.values(d.prepare(q).get())[0]);
const snap = (d) => JSON.stringify([d.prepare("SELECT rowid, id, status, evidence FROM kaizen_candidates ORDER BY rowid").all(), d.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all()]);

const d = fixture();
const orig = snap(d);
d.exec(sql);
ok(n(d, "SELECT COUNT(*) FROM kaizen_candidates WHERE status = 'scheduled'") === 0, "no scheduled row is left");
ok(n(d, "SELECT COUNT(*) FROM kaizen_candidates WHERE status = 'resolved' AND evidence LIKE '% | KAIZEN-SCHEDULED-1 2026-11-05:%'") === 10, "ten rows are resolved with their evidence appended");
ok(d.prepare("SELECT status, evidence FROM kaizen_candidates WHERE id = 'kc-20260904-router-selfopt'").get().status === "promoted", "the router row is promoted to its issue");
ok(/RM-KAIZEN-SCHEDULED-1\.1/.test(d.prepare("SELECT evidence FROM kaizen_candidates WHERE id = 'kc-20260904-router-selfopt'").get().evidence), "the router row names its issue");
const kept = d.prepare("SELECT status, evidence FROM kaizen_candidates WHERE id IN ('kc-other', 'kc-done') ORDER BY id").all();
ok(kept[0].status === "resolved" && kept[0].evidence === "orig-done" && kept[1].status === "promoted" && kept[1].evidence === "orig-other", "rows that were not scheduled are untouched", kept);
ok(d.prepare("SELECT evidence FROM kaizen_candidates WHERE id = '38ba2a60'").get().evidence.startsWith("orig 38ba2a60 | KAIZEN-SCHEDULED-1"), "the original evidence is kept in front");
const r63 = d.prepare("SELECT status, evidence FROM roadmap_implementation WHERE id = 63").get();
ok(r63.status === "partial" && /RM-KAIZEN-SCHEDULED-1\.1/.test(r63.evidence) && /RM-KAIZEN-SCHEDULED-1\.2/.test(r63.evidence), "row 63 stays partial and names both open issues", r63);
ok(d.prepare("SELECT status FROM roadmap_implementation WHERE id = 62").get().status === "built", "row 62 is untouched");

// the doers: code-task, anchor and probe lines first, anchors occur once in the real files
const issues = d.prepare("SELECT title, description, priority, status FROM agent_issues ORDER BY id").all();
ok(issues.length === 2 && issues.every((i) => i.status === "open" && /^ROADMAP-1: QNFO\.OPS RM-KAIZEN-SCHEDULED-1\.[12]: /.test(i.title)), "two open ROADMAP-1 issues", issues.map((i) => i.title));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const count = (t, needle) => t.split(needle).length - 1;
for (const i of issues) {
  const L = i.description.split("\n");
  ok(/^code-task: repo=qnfo-workers path=\S+\/worker\.js$/.test(L[0]) && L[1].startsWith("code-anchor: ") && L[2].startsWith("code-probe: "), "the issue starts with code-task, code-anchor and code-probe: " + i.title.slice(0, 60), L.slice(0, 3));
  const file = L[0].split("path=")[1];
  const anchor = L[1].slice("code-anchor: ".length);
  ok(count(read("../" + file), anchor) === 1, "the code-anchor occurs exactly once in " + file, anchor);
  let probe;
  try { probe = JSON.parse(L[2].slice("code-probe: ".length)); } catch (e) { probe = null; }
  ok(probe && probe.paths && probe.paths[0] === file && (typeof probe.absent === "string" || typeof probe.contains === "string"), "the code-probe parses and names the same file", L[2]);
}
ok(n(d, "SELECT COUNT(*) FROM decision_log WHERE action LIKE 'KAIZEN-SCHEDULED-1:%'") === 1, "one decision_log row");

// applying again changes nothing; the Rollback line restores both tables
const after = snap(d);
d.exec(sql);
ok(snap(d) === after && n(d, "SELECT COUNT(*) FROM agent_issues") === 2 && n(d, "SELECT COUNT(*) FROM decision_log") === 1, "a second apply changes nothing");
d.exec(rollback);
ok(snap(d) === orig, "the Rollback line restores kaizen_candidates and roadmap_implementation byte for byte");

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- BACKUP: bak_20261105_kaizen_scheduled$/m.test(sql), "the file carries APPLY-BY, DB and BACKUP header lines");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
