// KAIZEN-ROWS-CONTRACTS-1 offline suite: replays migrations/2026-11-05-kaizen-rows-contracts.sql on node:sqlite against a fixture with the live layout,
// runs the rm-62 closing probe healthy and broken, and checks the repaired issue contract, row 63 and the Rollback line.
// Run: node migrations/kaizen-rows-contracts.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-kaizen-rows-contracts.sql", import.meta.url), "utf8");
const rollback = sql.split("\n").find((l) => l.startsWith("-- Rollback: ")).slice("-- Rollback: ".length);
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

function fixture() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
    CREATE TABLE kaizen_candidates (id TEXT PRIMARY KEY, title TEXT, evidence TEXT, status TEXT);
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT, verified_at TEXT);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT, last_verdict TEXT, attempts INTEGER);
    CREATE TABLE fleet_budget (node_class TEXT, cap INTEGER, current INTEGER);
    CREATE VIEW v_fleet_budget_undisposed AS SELECT node_class FROM fleet_budget WHERE current > cap;
    CREATE TABLE handoffs (claim_sheet TEXT); CREATE TABLE wbs_state (claim_sheet TEXT);
    CREATE TRIGGER handoffs_claim_sheet_required_ins BEFORE INSERT ON handoffs WHEN NEW.claim_sheet IS NULL BEGIN SELECT RAISE(ABORT, 'x'); END;
    CREATE TRIGGER wbs_claim_sheet_required_ins BEFORE INSERT ON wbs_state WHEN NEW.claim_sheet IS NULL BEGIN SELECT RAISE(ABORT, 'x'); END;
  `);
  for (let r = 34; r <= 45; r++) d.prepare("INSERT INTO kaizen_candidates (rowid, id, title, evidence, status) VALUES (?, ?, 't', 'e', 'resolved')").run(r, "kc" + r);
  d.exec("INSERT INTO roadmap_implementation (id, item, status, evidence) VALUES (62, 'RM-KAIZEN-GATE-CANDIDATES-1', 'built', 'ev62'), (63, 'RM-KAIZEN-SCHEDULED-1', 'partial', 'RM-KAIZEN-SCHEDULED-1 (PR NUMBER): the 11 items')");
  d.exec("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict) VALUES ('issue-1001919', 1001919, 'SELECT ''closed'' AS expected', 'd1-query', 'superseded', 'superseded:closure-observing-probe-at-birth')");
  for (const c of ["fm-fleet-budget-undisposed", "fm-claim-sheet-triggers", "fm-cost-source-scope"]) d.prepare("INSERT INTO remediation_contracts (class, status) VALUES (?, 'active')").run(c);
  return d;
}
const one = (d, q) => d.prepare(q).get();
const n = (d, q) => Number(Object.values(one(d, q))[0]);
const snap = (d) => JSON.stringify([d.prepare("SELECT * FROM roadmap_implementation ORDER BY id").all(), d.prepare("SELECT * FROM remediation_contracts ORDER BY class").all()]);
const probe = (d) => { const p = one(d, "SELECT verify_probe FROM remediation_contracts WHERE class = 'rm-62'").verify_probe; const r = d.prepare(p).get(); return [String(r.expected), String(r.observed)]; };

const d = fixture();
const orig = snap(d);
d.exec(sql);

// rm-62
const c = one(d, "SELECT * FROM remediation_contracts WHERE class = 'rm-62'");
ok(c && c.verify_transport === "d1-query" && c.module === "roadmap-dod-v1" && c.issue_id === null && c.escalate_to === "qnfo-github-steward" && c.status === "active", "rm-62 is a roadmap-dod-v1 d1-query contract for the steward", c);
ok(probe(d)[0] === probe(d)[1], "the rm-62 probe passes on a healthy fixture", probe(d));
d.exec("UPDATE kaizen_candidates SET status = 'proposed' WHERE rowid = 40");
ok(probe(d)[0] !== probe(d)[1], "an unresolved candidate makes the probe fail");
d.exec("UPDATE kaizen_candidates SET status = 'fixed' WHERE rowid = 40");
ok(probe(d)[0] === probe(d)[1], "fixed counts as resolved");
d.exec("DROP TRIGGER wbs_claim_sheet_required_ins");
ok(probe(d)[0] !== probe(d)[1], "a dropped claim_sheet trigger makes it fail");
d.exec("CREATE TRIGGER wbs_claim_sheet_required_ins BEFORE INSERT ON wbs_state WHEN NEW.claim_sheet IS NULL BEGIN SELECT RAISE(ABORT, 'x'); END; UPDATE remediation_contracts SET status = 'superseded' WHERE class = 'fm-cost-source-scope'");
ok(probe(d)[0] !== probe(d)[1], "a detector contract that is not active makes it fail");
d.exec("UPDATE remediation_contracts SET status = 'active' WHERE class = 'fm-cost-source-scope'; INSERT INTO fleet_budget VALUES ('workers', 30, 39)");
ok(probe(d)[0] === probe(d)[1], "a budget breach elsewhere does not hold the row open (the probe reads the enforcers, not the budget)");

// the evidence of the two rows
ok(/PR 7407 merged/.test(one(d, "SELECT evidence FROM roadmap_implementation WHERE id = 62").evidence) && one(d, "SELECT evidence FROM roadmap_implementation WHERE id = 62").evidence.startsWith("ev62 | "), "row 62 keeps its evidence and names PR 7407");
ok(one(d, "SELECT status FROM roadmap_implementation WHERE id = 62").status === "built", "row 62 stays built for the steward to verify");
const e63 = one(d, "SELECT status, evidence FROM roadmap_implementation WHERE id = 63");
ok(e63.status === "partial" && /\(PR 7441, migration_runs 1328 ok; doers agent_issues 1001929 and 1001930\)/.test(e63.evidence) && !/PR NUMBER/.test(e63.evidence), "row 63 names PR 7441 and its doers", e63);

// the repaired issue contract
const ic = one(d, "SELECT * FROM remediation_contracts WHERE class = 'issue-1001919'");
const pr = JSON.parse(ic.verify_probe);
ok(ic.verify_transport === "code-read" && ic.status === "active" && ic.last_verdict === null && pr.paths[0] === "qnfo-fleet-control/worker.js" && /spend_limits/.test(pr.absent), "the issue-1001919 contract is the code-read probe on the PUT body", ic);

ok(typeof pr.absent === "string" && pr.absent.length > 30, "the absent text is a real fragment, not a marker");

// idempotent, and the Rollback line restores
const after = snap(d);
d.exec(sql);
ok(snap(d) === after, "a second apply changes nothing");
const d2 = fixture();
d2.exec(sql);
d2.exec(rollback);
const strip = (s) => JSON.parse(s).map((rows) => rows.filter((r) => r.class !== "rm-62").map((r) => (r.class ? { class: r.class, status: r.status, verify_probe: r.verify_probe, verify_transport: r.verify_transport, last_verdict: r.last_verdict } : r)));
ok(JSON.stringify(strip(snap(d2))) === JSON.stringify(strip(orig)), "the Rollback line restores the rows and the issue contract probe, transport, status and verdict (rm-62 is superseded)");
ok(one(d2, "SELECT status FROM remediation_contracts WHERE class = 'rm-62'").status === "superseded", "the Rollback line supersedes rm-62");

ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- BACKUP: bak_20261105_kaizen_rows$/m.test(sql), "the file carries APPLY-BY, DB and BACKUP header lines");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
