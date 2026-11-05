// RM-1757-FM4-VERIFY-1 offline suite (migrations/2026-11-05-rm-1757-fm4-verify.sql).
// ROADMAP-BUILT-VERIFY-1: qnfo-github-steward verifies a built roadmap item when its rm-<id> contract (module roadmap-dod-v1) reads a pass and closes the mirror. FM-4 (id 1757) was built by
// PR 7357 and had no contract. This applies the migration on SQLite (node:sqlite) and proves: the header (APPLY-BY ci, DB qnfo-audit, one single-line Rollback, a BACKUP table naming the table the file
// extends, nothing deleted or dropped in the body); the contract is inserted only for a built, deployed or implemented item 1757 named FM-4 (not for a planned one, not for another id); it carries the
// roadmap-dod-v1 shape (issue_id NULL, d1-query, escalate to qnfo-github-steward, hourly); its probe reads the literal ok only when vacuous_probe_share is MEASURED, fresh (3 hours), at most 0.15, and no open
// METRIC-UNMEASURED-1 or CF-OBS-ISSUE-1 issue sits on a VACUOUS-PROBE contract, and a named reason otherwise; a replay adds nothing; the Rollback supersedes the contract and leaves the decision row;
// scripts/apply_migrations.py --check accepts the file.
// Run: node --no-warnings migrations/rm-1757-fm4-verify.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const FILE = join(here, "2026-11-05-rm-1757-fm4-verify.sql");
const sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => l.startsWith("-- " + k + ": ")) || "").slice(k.length + 4).trim();
const rollback = hdr("Rollback");
const body = lines.filter((l) => !l.startsWith("--")).join("\n");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
ok(lines.filter((l) => /^-- Rollback: /.test(l)).length === 1 && rollback.length > 80, "one single-line Rollback");
ok(hdr("BACKUP") === "remediation_contracts", "the BACKUP header names the table the file extends (no row is deleted)");
ok(!/decision_log/i.test(rollback), "the Rollback never touches decision_log (append-only)");
ok(!/\bDELETE\b/i.test(body) && !/\bDROP\b/i.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/\[skip|skip[ -]ci|skip-checks/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

const DDL = `
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT, verified_at TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL, action TEXT NOT NULL, verify_probe TEXT NOT NULL, verify_transport TEXT NOT NULL, max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT, next_due_at TEXT, last_verdict TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, state TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, status TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'DOCTRINE-1: decision_log is append-only (doctrine section 12)'); END;
`;
const fresh = (status = "built", item = "FM-4", id = 1757) => {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  db.prepare("INSERT INTO roadmap_implementation (id, item, status) VALUES (?, ?, ?)").run(id, item, status);
  return db;
};
const one = (db, q, ...a) => db.prepare(q).get(...a);
const count = (db) => one(db, "SELECT COUNT(*) n FROM remediation_contracts WHERE class = 'rm-1757'").n;

ok((() => { const d = fresh("built"); d.exec(sql); return count(d); })() === 1, "a built item 1757 gets the contract");
ok((() => { const d = fresh("deployed"); d.exec(sql); return count(d); })() === 1 && (() => { const d = fresh("implemented"); d.exec(sql); return count(d); })() === 1, "a deployed or implemented item gets it too");
ok((() => { const d = fresh("planned"); d.exec(sql); return count(d); })() === 0, "a planned item gets none");
ok((() => { const d = fresh("built", "FM-5"); d.exec(sql); return count(d); })() === 0 && (() => { const d = fresh("built", "FM-4", 1758); d.exec(sql); return count(d); })() === 0, "another item name or id gets none");

const db = fresh();
db.exec(sql);
const c = one(db, "SELECT * FROM remediation_contracts WHERE class = 'rm-1757'");
ok(c.issue_id === null && c.verify_transport === "d1-query" && c.module === "roadmap-dod-v1" && c.escalate_to === "qnfo-github-steward" && c.expected_cadence_h === 1 && c.status === "active" && c.max_attempts === 48, "the contract has the roadmap-dod-v1 shape", c);
const P = c.verify_probe;
const iso = (offH) => new Date(Date.now() + offH * 3600000).toISOString().slice(0, 19) + "Z";
const setMetric = (v, refreshedH, state = "MEASURED") => { db.exec("DELETE FROM metric_registry"); if (v !== undefined) db.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed, state) VALUES ('vacuous_probe_share', ?, ?, ?)").run(v, iso(refreshedH), state); };
const read = () => db.prepare(P).get();
setMetric("0.043", -0.5);
ok(read().expected === "ok" && read().observed === "ok", "0.043 measured 30 minutes ago reads ok against ok");
setMetric("0.15", -1);
ok(read().observed === "ok", "the threshold itself (0.15) reads ok");
setMetric("0.268", -0.5);
ok(/above 0.15/.test(read().observed), "0.268 reads a named reason");
setMetric("0.043", -4);
ok(/not refreshed in 3 hours/.test(read().observed), "a figure 4 hours old reads stale");
setMetric(undefined);
ok(/not measured/.test(read().observed), "no metric row reads not measured");
setMetric("0.043", -0.5, "UNMEASURED");
ok(/not measured/.test(read().observed), "an UNMEASURED state reads not measured");
setMetric(null, -0.5);
ok(/not measured/.test(read().observed), "a NULL figure reads not measured");
setMetric("0.043", -0.5);
db.exec("INSERT INTO agent_issues (id, title, status) VALUES (1, 'METRIC-UNMEASURED-1: qnfo-ops has metrics with no value', 'open'), (2, 'CF-OBS-ISSUE-1: x', 'open'), (3, 'OTHER-1: y', 'open'), (4, 'METRIC-UNMEASURED-1: closed one', 'closed')");
db.exec("INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status) VALUES ('issue-3', 3, 'p', 'VACUOUS-PROBE-V3-1 placeholder', 'SELECT 1', 'd1-query', 'x', 'active'), ('issue-4', 4, 'p', 'VACUOUS-PROBE-V3-1 placeholder', 'SELECT 1', 'd1-query', 'x', 'active'), ('issue-1', 1, 'p', 'REAL-PROBE-1: cleared', 'SELECT 1', 'd1-query', 'x', 'active')");
ok(read().observed === "ok", "a vacuous marker on another family, a closed issue, or a cleared marker does not count");
db.exec("UPDATE remediation_contracts SET action = 'VACUOUS-PROBE-V3-1 placeholder' WHERE class = 'issue-1'");
ok(/still sits on a vacuous probe/.test(read().observed), "an open METRIC-UNMEASURED-1 issue back on the marker reads a named reason");
db.exec("UPDATE remediation_contracts SET action = 'REAL-PROBE-1: cleared' WHERE class = 'issue-1'; INSERT INTO remediation_contracts (class, issue_id, precondition, action, verify_probe, verify_transport, escalate_to, status) VALUES ('issue-2', 2, 'p', 'VACUOUS-PROBE-V3-1 placeholder', 'SELECT 1', 'd1-query', 'x', 'holding')");
ok(/still sits on a vacuous probe/.test(read().observed), "a CF-OBS-ISSUE-1 issue on a holding marker reads a named reason");

db.exec(sql);
ok(count(db) === 1 && one(db, "SELECT COUNT(*) n FROM decision_log").n === 1, "a replay adds no second contract or decision row");
db.exec(rollback);
ok(one(db, "SELECT status s, last_verdict v FROM remediation_contracts WHERE class = 'rm-1757'").s === "superseded" && one(db, "SELECT COUNT(*) n FROM decision_log").n === 1, "the Rollback supersedes the contract and leaves the decision row");

const PY = ["python3", "python"].find((c) => spawnSync(c, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0);
if (PY) {
  const chk = spawnSync(PY, ["-I", join(root, "scripts", "apply_migrations.py"), "--check", FILE], { encoding: "utf8" });
  ok(chk.status === 0 && /"ok": true/.test(chk.stdout), "the file passes scripts/apply_migrations.py --check", [chk.status, chk.stdout, chk.stderr]);
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
