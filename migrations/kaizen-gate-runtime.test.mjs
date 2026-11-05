// KAIZEN-GATES-RUNTIME-1 offline suite: replays migrations/2026-11-05-kaizen-gate-runtime.sql on node:sqlite against a fixture with the live layout
// and runs the three detector probes, the view and the Rollback line.
// Run: node migrations/kaizen-gate-runtime.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const FILE = "2026-11-05-kaizen-gate-runtime.sql";
const sql = readFileSync(new URL("./" + FILE, import.meta.url), "utf8");
const rollback = sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

function fixture() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE kaizen_candidates (id TEXT PRIMARY KEY, class TEXT, source TEXT, category TEXT, title TEXT, evidence TEXT, status TEXT DEFAULT 'proposed', created_at TEXT, updated_at TEXT);
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
    CREATE TABLE fleet_budget (node_class TEXT PRIMARY KEY, cap INTEGER, target INTEGER, current INTEGER, unit TEXT, updated_at TEXT);
    CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, enabled INTEGER);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT NOT NULL, root_cause TEXT NOT NULL, remediation TEXT NOT NULL, detector TEXT NOT NULL, probe_class TEXT, first_seen TEXT NOT NULL, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
    CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    CREATE TABLE cost_source_registry (source TEXT PRIMARY KEY, label TEXT NOT NULL, scope TEXT NOT NULL, payer TEXT NOT NULL);
    CREATE VIEW v_cost_fleet_30d AS SELECT 'x' AS source, 0 AS usd;
    CREATE TABLE handoffs (id INTEGER PRIMARY KEY, claim_sheet TEXT);
    CREATE TABLE wbs_state (id INTEGER PRIMARY KEY, claim_sheet TEXT);
    CREATE TRIGGER handoffs_claim_sheet_required_ins BEFORE INSERT ON handoffs WHEN NEW.claim_sheet IS NULL OR length(NEW.claim_sheet) < 3 BEGIN SELECT RAISE(ABORT, 'FRAMEWORK-DOGFOOD-1'); END;
    CREATE TRIGGER wbs_claim_sheet_required_ins BEFORE INSERT ON wbs_state WHEN NEW.claim_sheet IS NULL OR length(NEW.claim_sheet) < 3 BEGIN SELECT RAISE(ABORT, 'FRAMEWORK-DOGFOOD-1'); END;
  `);
  let rid = 33; // the live rowids of the twelve gate rows are 34 to 45
  const kc = d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (?, ?, ?, ?, ?)");
  for (const id of ["kc-redinventory-20260926", "kc-buildgate-runtime-20260926", "kc-dead-binding-20260926", "kc-live-ahead-repo-20260926", "kc-cents-unit-trap-20260926", "kc-fleet-vs-external-attr-20260926", "kc-flock-rate-limit-brake-20260926", "kc-claim-sheet-db-enforcement-20260927", "kc-registry-drift-concurrent-20260927", "kc-stale-template-modelkey-20260927"]) kc.run(++rid, id, "T " + id, "orig " + id, "promoted");
  d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (44, NULL, ?, 'orig44', 'proposed')").run("GOVERNANCE-CAP-DISPOSITION-1: a periodic budget/cap node");
  d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (45, NULL, ?, 'orig45', 'proposed')").run("TEMPLATE-RUNTIME-INJECTION-PARITY-1: a clean canonical template store");
  d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (99, 'other', 'unrelated', 'orig-other', 'promoted')").run();
  d.exec("INSERT INTO roadmap_implementation (id, item, status, evidence) VALUES (62, 'RM-KAIZEN-GATE-CANDIDATES-1', 'partial', 'VSM S3'), (63, 'RM-KAIZEN-SCHEDULED-1', 'partial', 'VSM S3')");
  d.exec(`INSERT INTO fleet_budget VALUES ('workers', 30, 24, 39, 'workers', 'x'), ('d1_databases', 10, 8, 13, 'dbs', 'x'), ('ai_spend:workers-ai', 95, 78, 793, 'usd', 'x'), ('cost:fleet_all_in_month', 300, 250, 1151, 'usd', 'x'), ('kv_namespaces', 5, 4, 4, 'ns', 'x'), ('pages_projects', 7, 5, 7, 'p', 'x')`);
  d.exec("INSERT INTO analytics_metric_triggers VALUES (344, 'worker_count', 1), (354, 'workers_ai_cost_30d_usd', 1), (10930, 'fleet_cost_bound_month_usd', 1)");
  d.exec("INSERT INTO agent_issues (id, title, status) VALUES (1001824, 'SYSTEM-MAP-1: sweep stale drill-restore scratch D1 databases', 'open')");
  d.exec("INSERT INTO cost_source_registry VALUES ('a', 'A', 'fleet', 'u'), ('b', 'B', 'external', 'u'), ('c', 'C', 'owner-direct', 'u'), ('d', 'D', 'owner-clients', 'u')");
  return d;
}
const one = (d, q) => d.prepare(q).get();
const n = (d, q) => Number(Object.values(one(d, q))[0]);
const probe = (d, cls) => { const p = one(d, "SELECT verify_probe FROM remediation_contracts WHERE class = '" + cls + "'").verify_probe; const r = d.prepare(p).get(); return [String(r.expected), String(r.observed)]; };

// ---- apply
const d = fixture();
d.exec(sql);
ok(n(d, "SELECT COUNT(*) FROM kaizen_candidates WHERE status = 'resolved'") === 12, "all 12 gate candidates are resolved", n(d, "SELECT COUNT(*) FROM kaizen_candidates WHERE status = 'resolved'"));
ok(n(d, "SELECT COUNT(*) FROM kaizen_candidates WHERE status IN ('proposed', 'promoted')") === 1 && one(d, "SELECT evidence FROM kaizen_candidates WHERE id = 'other'").evidence === "orig-other", "an unrelated candidate is untouched");
ok(/orig44 \| KAIZEN-GATES-1/.test(one(d, "SELECT evidence FROM kaizen_candidates WHERE title LIKE 'GOVERNANCE-CAP-DISPOSITION-1:%'").evidence), "a candidate with a NULL id is found by title and keeps its evidence");
ok(one(d, "SELECT status FROM roadmap_implementation WHERE id = 62").status === "built" && one(d, "SELECT status FROM roadmap_implementation WHERE id = 63").status === "partial", "row 62 is built and row 63 is not touched");
ok(n(d, "SELECT COUNT(*) FROM fleet_budget_disposition") === 4, "the four breached classes are seeded");
ok(n(d, "SELECT COUNT(*) FROM v_fleet_budget_undisposed") === 0, "no breached class is left without a live disposition", d.prepare("SELECT * FROM v_fleet_budget_undisposed").all());
const issue = one(d, "SELECT title, description FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.OPS RM-KAIZEN-GATE-CANDIDATES-1.2:%'");
ok(issue && issue.description.startsWith("code-task: repo=qnfo-workers path=qnfo-fleet-control/worker.js\ncode-anchor: async function costImpactGuard(env) {\ncode-probe: "), "the ROADMAP-1 issue starts with its code-task, anchor and probe lines");
ok(n(d, "SELECT COUNT(*) FROM decision_log WHERE action LIKE 'KAIZEN-GATES-1:%'") === 1, "one decision_log row");

// ---- the lines the code loop and the probe runner read, against the real source text
const worker = readFileSync(new URL("../qnfo-fleet-control/worker.js", import.meta.url), "utf8");
const count = (t, needle) => t.split(needle).length - 1;
ok(count(worker, "async function costImpactGuard(env) {") === 1, "the code-anchor occurs exactly once in qnfo-fleet-control/worker.js");
const probeLine = issue.description.split("\n").find((l) => l.startsWith("code-probe: "));
const pr = JSON.parse(probeLine.slice("code-probe: ".length));
ok(Array.isArray(pr.paths) && pr.paths[0] === "qnfo-fleet-control/worker.js" && typeof pr.absent === "string", "the code-probe parses with a path and an absent text");
// the closing probe is a statement about the defect, so it must read the defect as present until the fix lands: nothing here pins that day
ok(pr.absent.length > 30 && /spend_limits/.test(pr.absent), "the absent text names the PUT body that sends spend_limits alone");

// ---- the view
d.exec("UPDATE analytics_metric_triggers SET enabled = 0 WHERE id = 344");
let v = d.prepare("SELECT node_class, why FROM v_fleet_budget_undisposed").all();
ok(v.length === 1 && v[0].node_class === "workers" && /doer is gone/.test(v[0].why), "a disabled trigger leaves its class undisposed", v);
d.exec("UPDATE analytics_metric_triggers SET enabled = 1 WHERE id = 344; UPDATE agent_issues SET status = 'closed' WHERE id = 1001824");
v = d.prepare("SELECT node_class FROM v_fleet_budget_undisposed").all();
ok(v.length === 1 && v[0].node_class === "d1_databases", "a closed issue leaves its class undisposed", v);
d.exec("UPDATE agent_issues SET status = 'open' WHERE id = 1001824; UPDATE fleet_budget SET current = 8 WHERE node_class = 'pages_projects'");
ok(n(d, "SELECT COUNT(*) FROM v_fleet_budget_undisposed") === 1, "a new class over its cap with no disposition is listed");
d.exec("INSERT INTO decision_log (id, action) VALUES (500, 'rebaseline pages'); INSERT INTO fleet_budget_disposition (node_class, disposition, ref_kind, ref_id, evidence) VALUES ('pages_projects', 'rebaseline', 'decision', 500, 'cap raised by a recorded decision')");
ok(n(d, "SELECT COUNT(*) FROM v_fleet_budget_undisposed") === 0, "a decision_log re-baseline disposes it");
d.exec("UPDATE fleet_budget_disposition SET expires_at = '2020-01-01T00:00:00Z' WHERE node_class = 'pages_projects'");
ok(n(d, "SELECT COUNT(*) FROM v_fleet_budget_undisposed") === 1, "an expired disposition no longer counts");
d.exec("UPDATE fleet_budget SET current = 7 WHERE node_class = 'pages_projects'");
ok(n(d, "SELECT COUNT(*) FROM v_fleet_budget_undisposed") === 0, "a class at its cap (not above it) is not a breach");

// ---- the detector probes: expected equals observed when healthy, differs when not
for (const cls of ["fm-fleet-budget-undisposed", "fm-claim-sheet-triggers", "fm-cost-source-scope"]) {
  const [e, o] = probe(d, cls);
  ok(e === o, cls + " reads healthy", [e, o]);
  ok(one(d, "SELECT verify_transport t, status s FROM remediation_contracts WHERE class = '" + cls + "'").t === "d1-query", cls + " is a d1-query contract");
}
d.exec("UPDATE fleet_budget SET current = 99 WHERE node_class = 'kv_namespaces'");
ok(probe(d, "fm-fleet-budget-undisposed")[1] === "1", "an undisposed breach makes the budget probe read 1");
d.exec("DROP TRIGGER wbs_claim_sheet_required_ins");
ok(probe(d, "fm-claim-sheet-triggers").join("/") === "2/1", "a dropped claim_sheet trigger makes the probe read 1 of 2");
d.exec("INSERT INTO cost_source_registry VALUES ('e', 'E', 'fleet-ish', 'u')");
ok(probe(d, "fm-cost-source-scope")[1] === "1", "an unknown scope makes the cost probe read 1");
d.exec("DELETE FROM cost_source_registry WHERE source = 'e'; DROP VIEW v_cost_fleet_30d");
ok(probe(d, "fm-cost-source-scope")[1] === "1", "a missing v_cost_fleet_30d makes the cost probe read 1");

// ---- applying the file again changes nothing (the runner re-applies an edited file)
const d2 = fixture();
d2.exec(sql);
const snap = () => JSON.stringify([d2.prepare("SELECT id, status, evidence FROM kaizen_candidates ORDER BY rowid").all(), d2.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all(), n(d2, "SELECT COUNT(*) FROM agent_issues"), n(d2, "SELECT COUNT(*) FROM failure_modes"), n(d2, "SELECT COUNT(*) FROM remediation_contracts"), n(d2, "SELECT COUNT(*) FROM decision_log"), n(d2, "SELECT COUNT(*) FROM fleet_budget_disposition")]);
const before = snap();
d2.exec(sql);
ok(snap() === before, "a second apply changes nothing");

// ---- the Rollback line restores the tables and drops the new objects
const d3 = fixture();
const orig = JSON.stringify([d3.prepare("SELECT id, status, evidence FROM kaizen_candidates ORDER BY rowid").all(), d3.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all()]);
d3.exec(sql);
d3.exec(rollback);
ok(JSON.stringify([d3.prepare("SELECT id, status, evidence FROM kaizen_candidates ORDER BY rowid").all(), d3.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all()]) === orig, "the Rollback line restores kaizen_candidates and roadmap_implementation byte for byte");
ok(n(d3, "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('fleet_budget_disposition', 'v_fleet_budget_undisposed')") === 0 && n(d3, "SELECT COUNT(*) FROM failure_modes") === 0 && n(d3, "SELECT COUNT(*) FROM remediation_contracts") === 0, "the Rollback line drops the new table, view, failure modes and contracts");

// ---- header rules of apply-migrations (APPLY-BY, DB, Rollback, BACKUP for a file that deletes or drops)
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- BACKUP: bak_20261105_kaizen_gates$/m.test(sql), "the file carries APPLY-BY, DB and BACKUP header lines");
ok(/CREATE TABLE IF NOT EXISTS bak_20261105_kaizen_gates AS/.test(sql), "the backup table is created before any change");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
