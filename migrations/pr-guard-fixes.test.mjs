// PR-GUARD-FIXES-1 migration suite (agent_issues 100295). Applies migrations/2026-10-20-pr-guard-fixes.sql on SQLite (node:sqlite) over fixtures with the
// live column lists of failure_modes, remediation_contracts and the append-only decision_log, and proves
//   1. the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback that never touches decision_log), no DELETE or DROP in the body, no claude.ai link, no skip-CI token;
//   2. four failure modes and four code-read detector contracts (class fm-<key>, probe_class equal to the class, cadence 1), one decision row, and a replay that is a no-op;
//   3. each detector, run through the consumer's own parse_code_probe and run_code_probe, reads `ok` on the files of this repository and goes red on the file with the fix
//      taken out (missing-marker / present-marker), so a regression of a fixed guard shows up as a recurrence;
//   4. the Rollback removes what the file added, leaves the decision row (append-only), and the file applies again afterwards;
//   5. the file passes scripts/apply_migrations.py --check.
// Run: node --no-warnings migrations/pr-guard-fixes.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-10-20-pr-guard-fixes.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 500))); } };

const PY = (() => { for (const c of ["python3", "python"]) { const r = spawnSync(c, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" }); if (r.status === 0 && String(r.stdout).trim() === "3") return c; } return null; })();
ok(PY !== null, "a python 3 interpreter is available for the consumer's own functions and the migration check");

// ---- 1. header and vocabulary ----
const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
const rollback = hdr("Rollback");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 100, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDELETE\b|\bDROP\b/i.test(body) && hdr("BACKUP") === "", "the body has no DELETE or DROP, so no BACKUP header is needed");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");
ok(/decision_log is append-only/.test(sql), "the file says why the Rollback leaves the decision row");
const stmts = body.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
ok(stmts.length === 9 && stmts.slice(0, 4).every((s) => /^INSERT OR IGNORE INTO failure_modes\b/.test(s)) && stmts.slice(4, 8).every((s) => /^INSERT OR IGNORE INTO remediation_contracts\b/.test(s)) && /^INSERT INTO decision_log\b/.test(stmts[8]) && /WHERE NOT EXISTS \(SELECT 1 FROM decision_log WHERE action LIKE 'PR-GUARD-FIXES-1:%'\)$/.test(stmts[8]), "four failure modes, four contracts, then one guarded decision row", stmts.map((s) => s.slice(0, 40)));
ok(!stmts.some((s) => /^(INSERT( OR \w+)? INTO|UPDATE|DELETE FROM)\s+"?(agent_issues|issue_triage)\b/i.test(s)), "no statement writes agent_issues or issue_triage");

// ---- 2. fixture: the live shapes ----
const DDL = `
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER DEFAULT 45000, next_due_at TEXT, max_items INTEGER DEFAULT 5, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT);
CREATE TRIGGER remediation_contracts_cadence_1h_ai AFTER INSERT ON remediation_contracts WHEN NEW.expected_cadence_h IS NULL OR NEW.expected_cadence_h > 1 BEGIN UPDATE remediation_contracts SET expected_cadence_h = 1 WHERE class = NEW.class; END;
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const fresh = () => { const db = new DatabaseSync(":memory:"); db.exec(DDL); return db; };
const all = (db, q, ...a) => db.prepare(q).all(...a);
const one = (db, q, ...a) => db.prepare(q).get(...a);
const KEYS = ["version-bump-guard-reads-comment", "push-guard-cancelled-on-main", "conflict-repair-skips-required-check", "model-floor-guard-read-failure-as-finding"];

const db = fresh();
db.exec(sql);
const counts = (d) => ({ fm: one(d, "SELECT COUNT(*) n FROM failure_modes").n, rc: one(d, "SELECT COUNT(*) n FROM remediation_contracts").n, dl: one(d, "SELECT COUNT(*) n FROM decision_log").n });
ok(JSON.stringify(counts(db)) === JSON.stringify({ fm: 4, rc: 4, dl: 1 }), "the file adds four failure modes, four contracts and one decision row", counts(db));
db.exec(sql);
ok(JSON.stringify(counts(db)) === JSON.stringify({ fm: 4, rc: 4, dl: 1 }), "replaying the file is a no-op", counts(db));

const fms = all(db, "SELECT * FROM failure_modes ORDER BY fm_key");
ok(JSON.stringify(fms.map((r) => r.fm_key).sort()) === JSON.stringify([...KEYS].sort()), "the failure modes are the four named", fms.map((r) => r.fm_key));
ok(fms.every((r) => r.probe_class === "fm-" + r.fm_key && r.first_seen === "2026-10-20" && r.issue_id === 100295 && [r.failure_mode, r.root_cause, r.remediation, r.detector, r.trigger_condition, r.symptom, r.blast_radius].every((x) => typeof x === "string" && x.length > 20)), "each failure mode has a probe_class fm-<key>, the audit issue and every column filled");
const rcs = all(db, "SELECT * FROM remediation_contracts ORDER BY class");
ok(rcs.every((r) => KEYS.includes(r.class.replace(/^fm-/, ""))) && rcs.every((r) => r.verify_transport === "code-read" && r.status === "active" && r.expected_cadence_h === 1 && r.issue_id === null && r.escalate_to === "qnfo-fleet-control"), "each detector is an active code-read contract with cadence 1", rcs.map((r) => [r.class, r.verify_transport, r.status, r.expected_cadence_h]));
ok(fms.every((f) => rcs.some((r) => r.class === f.probe_class)), "every failure mode has the contract its probe_class names");
const dl = one(db, "SELECT * FROM decision_log");
ok(dl.actor.startsWith("session_") && dl.action.startsWith("PR-GUARD-FIXES-1:") && dl.rollback_path.length > 20 && dl.capability_gain.length > 20 && !/ within /.test(dl.predicted_outcome), "the decision row names the change, its rollback and its capability gain, and carries no ' within ' (decision_predictions would parse it)", dl);

// ---- 3. the detectors, judged by the consumer's own functions ----
const judge = (probeText, rootDir) => {
  if (!PY) return { err: "no python", observed: null };
  const r = spawnSync(PY, ["-I", "-c", "import sys, json; sys.path.insert(0, sys.argv[1]); import remediation_consumer as rc; p, e = rc.parse_code_probe(sys.argv[2]); print(json.dumps({'err': e, 'observed': rc.run_code_probe(p, sys.argv[3]) if p else None}))", join(root, "scripts"), probeText, rootDir], { encoding: "utf8" });
  try { return JSON.parse(String(r.stdout).trim().split("\n").pop()); } catch (e) { return { err: "no output", observed: null, stderr: r.stderr }; }
};
// MAIN-GUARD-RANGE-FLOOR-1 (2026-11-04): PUSH-COALESCE-1 replaced the per-sha group, so migrations/2026-11-04-push-guard-range-floor-detector.sql repoints the
// push-guard-cancelled-on-main detector. The detectors are judged as the live table holds them: with that later file applied on top of this one.
const finalDb = fresh();
finalDb.exec(sql);
finalDb.exec(readFileSync(join(here, "2026-11-04-push-guard-range-floor-detector.sql"), "utf8").replace(/\r\n/g, "\n"));
const finalRcs = all(finalDb, "SELECT * FROM remediation_contracts ORDER BY class");
const probeOf = (key) => finalRcs.find((r) => r.class === "fm-" + key).verify_probe;
const read = (rel) => readFileSync(join(root, rel), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "pgf-"));
const variant = (name, rel, edit) => { const d = join(tmp, name); mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), edit(read(rel))); return d; };
const cases = [
  ["version-bump-guard-reads-comment", "scripts/version-bump-guard.py", (t) => t.replace(/^VERSION_RE = .*$/m, "VERSION_RE = re.compile(r'var\\s+VERSION\\s*=\\s*\"([^\"]*)\"')"), "missing-marker:scripts/version-bump-guard.py"],
  ["push-guard-cancelled-on-main", ".github/workflows/version-bump-guard.yml", (t) => t.replace("range floor is the last green guard run", "range floor is gone"), "missing-marker:.github/workflows/version-bump-guard.yml"],
  ["conflict-repair-skips-required-check", "scripts/conflict_repair.py", (t) => t.replace('"mirror-guard.yml", ', ""), "missing-marker:scripts/conflict_repair.py"],
  ["model-floor-guard-read-failure-as-finding", "scripts/model-floor-guard.mjs", (t) => t.replace("class GuardReadError", "class Gone"), "missing-marker:scripts/model-floor-guard.mjs"],
  ["model-floor-guard-read-failure-as-finding", "scripts/model-floor-guard.mjs", (t) => t + '\nconst REPO_OLD = "C:/Users/LENOVO/Documents/GitHub/qnfo-workers";\n', "present-marker:scripts/model-floor-guard.mjs"],
];
for (const key of KEYS) {
  const j = judge(probeOf(key), root);
  ok(j.err === null && j.observed === "ok", "detector fm-" + key + " reads ok on the files of this repository", j);
}
cases.forEach(([key, rel, edit, want], i) => {
  const j = judge(probeOf(key), variant("v" + i, rel, edit));
  ok(j.err === null && j.observed === want, "detector fm-" + key + " goes red (" + want.split(":")[0] + ") when the fix is taken out of " + rel, j);
});
ok((read("scripts/version-bump-guard.py").match(/^VERSION_RE = /gm) || []).length === 1, "version-bump-guard.py declares VERSION_RE once, so the detector reads the line that is used");

// ---- 4. rollback ----
const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
ok(JSON.stringify(counts(rb)) === JSON.stringify({ fm: 0, rc: 0, dl: 1 }), "the Rollback removes the failure modes and contracts and leaves the decision row", counts(rb));
rb.exec(sql);
ok(JSON.stringify(counts(rb)) === JSON.stringify({ fm: 4, rc: 4, dl: 1 }), "the file applies again after the Rollback and adds no second decision row", counts(rb));
const other = fresh();
other.prepare("INSERT INTO failure_modes (fm_key, failure_mode, root_cause, remediation, detector, first_seen) VALUES ('unrelated', 'a', 'b', 'c', 'd', '2026-10-19')").run();
other.exec(sql); other.exec(rollback);
ok(one(other, "SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'unrelated'").n === 1, "the Rollback leaves other failure modes alone");

// ---- 5. the migration check ----
if (PY) {
  const chk = spawnSync(PY, [join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`pr-guard-fixes migration: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
