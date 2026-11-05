// LANE-WAITS-FOR-REVIEW-1 and BP26-SLO-MERGE-LANE-1 migration suite: migrations/2026-11-05-lane-review-slo.sql inserts the three switches with their defaults, two hold records with a read-only
// alternate probe each, the failure mode and its code-read detector (the marker occurs once in qnfo-fleet-control/worker.js), re-points the closing probe of issue 1000872 at the mechanism, files
// the step-(4) remainder with a code-task whose anchor occurs once, and moves roadmap row 1709 to built; a replay changes nothing.
// Run: node --no-warnings migrations/lane-review-slo.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-lane-review-slo.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- BACKUP: bak_20261105_lane_review_slo$/m.test(sql), "headers: APPLY-BY, DB, Rollback and BACKUP");

const OLD = "WITH merged AS (SELECT pr, merged_at FROM ci_gate_audit WHERE merged_at IS NOT NULL) SELECT '0' AS expected, '1' AS observed FROM merged";
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER, last_run_at TEXT);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, attempts INTEGER, last_verdict TEXT, deferred_since TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
INSERT INTO agent_issues (id, title, status, description) VALUES (1000872, 'LANE-WAITS-FOR-REVIEW-1: the merge lane merged PR 5366', 'open', 'base');
INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, attempts, last_verdict) VALUES ('issue-1000872', 1000872, '${OLD.replace(/'/g, "''")}', 'd1-query', 'active', 89, 'fail');
INSERT INTO roadmap_implementation (id, item, status) VALUES (1709, 'SLO-MERGE-LANE', 'planned'), (1710, 'other', 'planned');`);
db.exec(sql);
const one = (q, ...a) => db.prepare(q).get(...a), all = (q, ...a) => db.prepare(q).all(...a);

const cfg = Object.fromEntries(all("SELECT key, value FROM ops_config").map((r) => [r.key, r.value]));
ok(cfg.lane_review_hold === "on" && cfg.lane_review_wait_min === "8" && cfg.slo_merge_lane === "on", "the three switches default to on, 8 minutes, on", cfg);
const ctl = Object.fromEntries(all("SELECT * FROM control_registry").map((c) => [c.control, c]));
ok(ctl["lane-review-hold"].kind === "hold" && ctl["lane-review-hold"].critical_path === 1 && ctl["slo-merge-lane-freeze"].kind === "hold" && /exit|lifts/.test(ctl["slo-merge-lane-freeze"].alternate_path), "two hold records with a critical path and an exit", Object.keys(ctl));
const probes = Object.fromEntries(all("SELECT control, probe_sql p, enabled e FROM control_alternate_probes").map((r) => [r.control, r]));
ok(Object.keys(probes).length === 2 && Object.values(probes).every((r) => r.e === 1 && !r.p.includes(";")), "an enabled alternate probe without a semicolon per hold");
const run = (c) => db.prepare(probes[c].p).get().observed;
ok(run("lane-review-hold") === "ok", "the review-hold probe reads ok on the default");
ok(/slo_budget_spent is missing/.test(run("slo-merge-lane-freeze")), "the freeze probe is falsifiable: without the budget list row the freeze can never apply or lift");
db.prepare("INSERT INTO ops_config (key, value) VALUES ('slo_budget_spent', '')").run();
ok(run("slo-merge-lane-freeze") === "ok", "and reads ok once the budget list row exists (empty = nothing spent)");
db.prepare("UPDATE ops_config SET value = 'maybe' WHERE key = 'slo_merge_lane'").run();
ok(/other than on or off/.test(run("slo-merge-lane-freeze")), "and reads a reason for a value no reader understands");
db.prepare("UPDATE ops_config SET value = 'on' WHERE key = 'slo_merge_lane'").run();
db.prepare("DELETE FROM ops_config WHERE key = 'lane_review_hold'").run();
ok(/missing/.test(run("lane-review-hold")), "the review-hold probe reads missing without its lever row");
db.prepare("INSERT INTO ops_config (key, value) VALUES ('lane_review_hold', 'on')").run();

// the detector and the closing probe read the same marker, and it occurs once in the worker
const worker = readFileSync(join(here, "..", "qnfo-fleet-control", "worker.js"), "utf8");
const det = one("SELECT * FROM remediation_contracts WHERE class = 'fm-lane-merges-before-automated-review'");
const closing = one("SELECT * FROM remediation_contracts WHERE class = 'issue-1000872'");
ok(det && det.verify_transport === "code-read" && det.status === "active" && det.module === "failure-mode" && one("SELECT fm_key k FROM failure_modes WHERE fm_key = 'lane-merges-before-automated-review'"), "the failure mode and its standing detector exist");
const marker = JSON.parse(det.verify_probe);
ok(marker.paths[0] === "qnfo-fleet-control/worker.js" && worker.split(marker.contains).length - 1 === 1, "the marker occurs exactly once in qnfo-fleet-control/worker.js (so removing the call fails the detector)", marker);
ok(closing.verify_transport === "code-read" && closing.verify_probe === det.verify_probe && closing.status === "active" && closing.attempts === 0 && closing.last_verdict === null, "the closing probe of issue 1000872 reads the mechanism and is re-armed", closing);
ok(one("SELECT verify_probe p FROM bak_20261105_lane_review_slo WHERE class = 'issue-1000872'").p === OLD, "the backup keeps the old probe that counted every merge in the history");
ok(/steps \(1\) to \(3\)/.test(one("SELECT description d FROM agent_issues WHERE id = 1000872").d), "the issue says what shipped and where step (4) went");

// the remainder has a doer: a code-task whose anchor is a function signature that occurs once
const rem = one("SELECT * FROM agent_issues WHERE title LIKE 'LANE-REVIEW-REPAIR-1:%'");
const lines = rem.description.split("\n");
const cm = lines.find((l) => l.startsWith("code-task: ")), ca = lines.find((l) => l.startsWith("code-anchor: "));
ok(rem.status === "open" && cm === "code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js" && ca === "code-anchor: async function bhFileRepair(env, pr, rep) {", "step (4) is filed with a code-task and a function-signature anchor", { cm, ca });
ok(worker.split(ca.slice("code-anchor: ".length)).length - 1 === 1, "the anchor occurs once in qnfo-fleet-control/worker.js");
ok(/Definition of done/.test(rem.description) && /Charter pillar: autonomy/.test(rem.description), "with a definition of done and its pillar");

const rm = Object.fromEntries(all("SELECT id, status, evidence FROM roadmap_implementation").map((r) => [r.id, r]));
ok(rm[1709].status === "built" && /bhSloGate/.test(rm[1709].evidence) && rm[1710].status === "planned", "row 1709 built with its evidence, others untouched");

db.exec(sql);
ok(all("SELECT * FROM decision_log").length === 1 && all("SELECT * FROM control_registry").length === 2 && all("SELECT * FROM agent_issues WHERE title LIKE 'LANE-REVIEW-REPAIR-1:%'").length === 1 && one("SELECT description d FROM agent_issues WHERE id = 1000872").d.split("B-GOVERNANCE-2").length === 2, "a replay adds no second row and notes the issue once");
console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
