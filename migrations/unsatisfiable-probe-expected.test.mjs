// PROBE-EXPECTED-UNSATISFIABLE-1 offline suite (migrations/2026-11-04-unsatisfiable-probe-expected.sql).
// The consumer passes a d1-query contract only when expected equals observed as text. issue-1001212 returned '<=10' against the number 5 and issue-1000715 returned
// '>=1 published policy or science analysis' against a count, so neither could ever read pass. This applies the migration on SQLite (node:sqlite) and proves:
// the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback); both probes now return the literal ok when their threshold holds and the measured value otherwise
// (the trigger-depth probe run against a shallow and a 12-deep trigger chain, the content probe against empty and filled rows); the detector reads 2 before, 0 after;
// a probe that returns its comparator literal from a CASE is left alone; a replay is a no-op; the Rollback restores both probes byte for byte and removes the detector;
// scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/unsatisfiable-probe-expected.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-04-unsatisfiable-probe-expected.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 300, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

// ---- the live probes, as read from remediation_contracts on 2026-11-04 ----
const OLD_1001212 = "WITH RECURSIVE names(name) AS (SELECT name FROM sqlite_master WHERE type='table'), edges(src,dst) AS (SELECT DISTINCT t.tbl_name, n.name FROM sqlite_master t JOIN names n WHERE t.type='trigger' AND t.sql IS NOT NULL AND (instr(lower(t.sql),'into '||lower(n.name))>0 OR instr(lower(t.sql),'upd'||'ate '||lower(n.name))>0)), walk(node,depth,path) AS (SELECT name,0,','||name||',' FROM names UNION ALL SELECT e.dst,w.depth+1,w.path||e.dst||',' FROM walk w JOIN edges e ON e.src=w.node WHERE w.depth<20 AND instr(w.path,','||e.dst||',')=0), mx AS (SELECT max(depth) AS d FROM walk) SELECT '<=10' AS expected, CAST((SELECT d FROM mx) AS TEXT) AS observed";
const KEYWORDS = ["policy", "regulation", "legislation", "government", "election", "climate", "biology", "physics", "neuroscience", "public health", "energy", "economics"];
const OLD_1000715 = "SELECT '>=1 published policy or science analysis' AS expected, CAST(COUNT(*) AS TEXT) AS observed FROM content_external_items WHERE property='q08.org' AND stage='published' AND (" + KEYWORDS.map((k) => "lower(title) LIKE '%" + k + "%'").join(" OR ") + ")";
const SATISFIABLE = "SELECT '<= 20000' AS expected, CASE WHEN CAST(last_value AS REAL) <= 20000 THEN '<= 20000' ELSE '> 20000 (' || last_value || ')' END AS observed FROM metric_registry WHERE metric = 'x'";

const DDL = `
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active');
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TABLE content_external_items (property TEXT, stage TEXT, title TEXT);
`;
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  const ins = db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to) VALUES (?, ?, 'p', 'a', ?, 'd1-query', 'qnfo-fleet-control')");
  ins.run("issue-1001212", 1001212, OLD_1001212);
  ins.run("issue-1000715", 1000715, OLD_1000715);
  ins.run("issue-1000802", 1000802, SATISFIABLE);
  return db;
};
const probeOf = (db, cls) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls)?.p;
const one = (db, q, ...a) => db.prepare(q).get(...a);
const run = (db, probe) => db.prepare(probe).get();

const db = fresh();
const DETECTOR_BEFORE = "SELECT COUNT(*) AS n FROM remediation_contracts WHERE status IN ('active', 'holding') AND verify_transport LIKE 'd1-query%' AND (instr(verify_probe, '''<=') > 0 OR instr(verify_probe, '''>=') > 0) AND instr(verify_probe, 'CASE') = 0";
ok(one(db, DETECTOR_BEFORE).n === 2, "before the migration two contracts carry a comparator literal with no CASE (the satisfiable one is not counted)", one(db, DETECTOR_BEFORE));
// the old probes cannot pass, whatever they measure
ok(run(db, OLD_1001212).expected !== run(db, OLD_1001212).observed, "the old trigger-depth probe reads expected <=10 against a number: never equal");

db.exec(sql);
const p1 = probeOf(db, "issue-1001212"), p2 = probeOf(db, "issue-1000715");
ok(p1.includes("SELECT 'ok' AS expected, CASE WHEN (SELECT d FROM mx) <= 10") && !p1.includes("'<=10'"), "issue-1001212 now returns ok when the depth is at most 10");
ok(p2.includes("SELECT 'ok' AS expected, CASE WHEN COUNT(*) >= 1") && !p2.includes("'>=1 published"), "issue-1000715 now returns ok when at least one analysis is published");
ok(p1.startsWith("WITH RECURSIVE names(name)") && p2.includes("lower(title) LIKE '%economics%'"), "the measurement (graph walk, keyword list) is untouched: only the token changed");

// ---- the new trigger-depth probe on real trigger chains ----
const chain = (n) => {
  const d = new DatabaseSync(":memory:");
  const names = Array.from({ length: n + 1 }, (_, i) => "node" + String.fromCharCode(65 + i));
  names.forEach((t) => d.exec("CREATE TABLE " + t + " (x INTEGER)"));
  for (let i = 0; i < n; i++) d.exec("CREATE TRIGGER trg_" + names[i] + " AFTER INSERT ON " + names[i] + " BEGIN INSERT INTO " + names[i + 1] + " VALUES (NEW.x); END");
  return d;
};
let r = run(chain(3), p1);
ok(r.expected === "ok" && r.observed === "ok", "a 3-deep trigger chain reads expected ok = observed ok", r);
r = run(chain(10), p1);
ok(r.expected === "ok" && r.observed === "ok", "a 10-deep chain (the limit) still passes", r);
r = run(chain(12), p1);
ok(r.expected === "ok" && r.observed === "max trigger nesting depth 12", "a 12-deep chain fails with the measured depth", r);

// ---- the new content probe ----
const content = new DatabaseSync(":memory:");
content.exec("CREATE TABLE content_external_items (property TEXT, stage TEXT, title TEXT)");
r = run(content, p2);
ok(r.expected === "ok" && r.observed === "0 published policy or science analyses on q08.org", "no published analysis: the observed text names the count", r);
content.exec("INSERT INTO content_external_items VALUES ('q08.org', 'draft', 'Energy policy outlook'), ('reading.q08.org', 'published', 'Energy policy outlook'), ('q08.org', 'published', 'A note on sailing')");
r = run(content, p2);
ok(r.observed === "0 published policy or science analyses on q08.org", "a draft, another property and an unrelated title do not count", r);
content.exec("INSERT INTO content_external_items VALUES ('q08.org', 'published', 'Climate policy after the election')");
r = run(content, p2);
ok(r.expected === "ok" && r.observed === "ok", "one published policy or science analysis on q08.org reads ok", r);

// ---- detector, replay, rows ----
const rcs = db.prepare("SELECT * FROM remediation_contracts WHERE class = 'fm-probe-expected-unsatisfiable'").all();
ok(rcs.length === 1 && rcs[0].verify_transport === "d1-query" && rcs[0].status === "active" && rcs[0].expected_cadence_h === 1 && rcs[0].issue_id === null, "one active hourly d1-query detector contract", rcs);
const detector = rcs[0].verify_probe;
let d = run(db, detector);
ok(d.expected === "0" && d.observed === "0", "the detector reads 0 after the migration", d);
db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to) VALUES ('x-bad', 1, 'p', 'a', ?, 'd1-query', 'q')").run("SELECT '<=5' AS expected, CAST(1 AS TEXT) AS observed");
d = run(db, detector);
ok(d.observed === "1", "a new comparator-literal probe with no CASE is counted", d);
ok(d.expected === "0", "the detector's expected token is the literal 0");
const fm = db.prepare("SELECT * FROM failure_modes WHERE fm_key = 'probe-expected-unsatisfiable'").all();
ok(fm.length === 1 && fm[0].probe_class === "fm-probe-expected-unsatisfiable" && fm[0].first_seen === "2026-11-04" && fm[0].issue_id === 1001212, "the failure mode row names its detector class, date and issue", fm);
const before = { rc: one(db, "SELECT COUNT(*) n FROM remediation_contracts").n, fm: one(db, "SELECT COUNT(*) n FROM failure_modes").n, dl: one(db, "SELECT COUNT(*) n FROM decision_log").n };
db.exec(sql);
const after = { rc: one(db, "SELECT COUNT(*) n FROM remediation_contracts").n, fm: one(db, "SELECT COUNT(*) n FROM failure_modes").n, dl: one(db, "SELECT COUNT(*) n FROM decision_log").n };
ok(JSON.stringify(before) === JSON.stringify(after) && probeOf(db, "issue-1001212") === p1 && probeOf(db, "issue-1000715") === p2, "replaying the file is a no-op", { before, after });
const dl = db.prepare("SELECT * FROM decision_log").all();
ok(dl.length === 1 && dl[0].action.startsWith("PROBE-EXPECTED-UNSATISFIABLE-1:") && dl[0].rollback_path.length > 20 && dl[0].capability_gain.length > 20, "one decision row names the change, its rollback and its gain", dl.length);

// ---- rollback ----
const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
ok(probeOf(rb, "issue-1001212") === OLD_1001212 && probeOf(rb, "issue-1000715") === OLD_1000715, "the Rollback restores both probes byte for byte");
ok(one(rb, "SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'fm-probe-expected-unsatisfiable'").n === 0 && one(rb, "SELECT COUNT(*) n FROM failure_modes").n === 0, "the Rollback removes the detector and the failure mode");
ok(one(rb, "SELECT COUNT(*) n FROM decision_log").n === 1 && probeOf(rb, "issue-1000802") === SATISFIABLE, "the Rollback leaves the decision row and the other contracts alone");

// ---- the migration check ----
const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
