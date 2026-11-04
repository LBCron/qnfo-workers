// TRIGGER-DEPTH-PROBE-WINDOW-1 offline suite (migrations/2026-11-04-trigger-depth-probe-window.sql).
// fm-trigger-depth-compile read 'ok' only with a pass row younger than 25 minutes, but the sweep that writes it runs once per remediation-consumer run, about every 40 minutes, so the detector
// was red for most of every cycle while every sweep passed. Applies the migration on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback);
// the probe reads ok with a pass 40 minutes old after the change (it read stale-or-failing before), still reads stale-or-failing with a pass 100 minutes old, with only failed rows and with no
// row; only the window literal changed; a replay is a no-op; the Rollback restores the original probe byte for byte; scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/trigger-depth-probe-window.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-04-trigger-depth-probe-window.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 80, "one single-line Rollback");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDROP\b/i.test(body) && !/\bDELETE\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

// the live probe, as read from remediation_contracts on 2026-11-04
const OLD = "SELECT 'ok' AS expected, CASE WHEN (SELECT COUNT(*) FROM remediation_verifications WHERE class='fm-trigger-depth-compile' AND verified_at > datetime('now','-25 minutes') AND pass=1) > 0 THEN 'ok' ELSE 'stale-or-failing' END AS observed";
const DDL = `
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active');
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, verified_at TEXT, pass INTEGER, observed TEXT, verifier TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const fresh = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to) VALUES ('fm-trigger-depth-compile', NULL, 'p', 'a', ?, 'd1-query', 'qnfo-fleet-control')").run(OLD);
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to) VALUES ('fm-other', NULL, 'p', 'a', 'SELECT ''0'' AS expected, ''0'' AS observed', 'd1-query', 'qnfo-fleet-control')").run();
  return db;
};
const probeOf = (db) => db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-trigger-depth-compile'").get().p;
const addRow = (db, minutesAgo, passed) => db.prepare("INSERT INTO remediation_verifications (class, verified_at, pass, observed, verifier) VALUES ('fm-trigger-depth-compile', datetime('now', ?), ?, 'ok', 'trigger-depth-sweep')").run("-" + minutesAgo + " minutes", passed);
const read = (db) => db.prepare(probeOf(db)).get();
const clear = (db) => db.exec("DELETE FROM remediation_verifications");

const db = fresh();
addRow(db, 40, 1);
let r = read(db);
ok(r.expected === "ok" && r.observed === "stale-or-failing", "before the change a sweep pass 40 minutes old reads stale-or-failing (the false red)", r);
clear(db);

db.exec(sql);
const p = probeOf(db);
ok(p === OLD.replace("'-25 minutes'", "'-90 minutes'"), "only the window literal changed", p);
addRow(db, 40, 1);
r = read(db);
ok(r.expected === "ok" && r.observed === "ok", "a sweep pass 40 minutes old reads ok", r);
clear(db); addRow(db, 67, 1);
r = read(db);
ok(r.observed === "ok", "the longest observed gap (67 minutes) reads ok", r);
clear(db); addRow(db, 100, 1);
r = read(db);
ok(r.observed === "stale-or-failing", "a sweep silent for 100 minutes still reads stale-or-failing", r);
clear(db); addRow(db, 5, 0); addRow(db, 10, 0);
r = read(db);
ok(r.observed === "stale-or-failing", "recent failed rows never count: pass = 0 reads stale-or-failing", r);
clear(db);
r = read(db);
ok(r.observed === "stale-or-failing", "no row at all reads stale-or-failing", r);

const before = { rc: db.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n, dl: db.prepare("SELECT COUNT(*) n FROM decision_log").get().n };
db.exec(sql);
ok(probeOf(db) === p && db.prepare("SELECT COUNT(*) n FROM decision_log").get().n === before.dl && before.dl === 1, "replaying the file is a no-op and adds no second decision row", before);
ok(db.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-other'").get().p === "SELECT '0' AS expected, '0' AS observed", "no other contract is touched");

const rb = fresh();
rb.exec(sql);
rb.exec(rollback);
ok(probeOf(rb) === OLD, "the Rollback restores the original probe byte for byte");
ok(rb.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1, "the Rollback leaves the decision row");

const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", chk.stdout + chk.stderr);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
