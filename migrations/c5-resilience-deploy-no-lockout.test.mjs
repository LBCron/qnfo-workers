// RM-TP-9-DEPLOY-NO-LOCKOUT offline suite: replays migrations/2026-11-04-c5-resilience-deploy-no-lockout.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, nothing deleted or dropped); T9 lever 3 moves from pending to landed once and row 134 moves to built without being called verified;
// the file keeps the old evidence, a replay changes nothing, the Rollback line restores both rows; and every code artifact the evidence names still exists in the repository (so the status cannot outlive the code):
// the delete-after-unbind refusal, the 10143 prune test, the deployer fallback wired into canonical-deploy.yml with its ledger write, and the dangling-binding census.
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-deploy-no-lockout.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = rd("./2026-11-04-c5-resilience-deploy-no-lockout.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no trigger and no claude.ai link");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE transformation_levers (id INTEGER PRIMARY KEY AUTOINCREMENT, tp INTEGER, n INTEGER, key TEXT, status TEXT DEFAULT 'pending', note TEXT, landed_at TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);`);
const EVID = "measured 2026-10-06: 10 deployment_history failures naming 10143/10144 | exit: 0 such failures for 30 days, delete-after-unbind and the census live";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (134, 'RM-TP-9-DEPLOY-NO-LOCKOUT', 'docs/TRANSFORMATION-PROGRAM.md T9', 'partial', ?)").run(EVID);
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (135, 'RM-OTHER', 'x', 'partial', 'untouched')").run();
for (const [n, k, s] of [[1, "delete-after-unbind", "landed"], [2, "prune-accepts-10143", "landed"], [3, "deployer-fallback", "pending"], [4, "dangling-bindings-census", "landed"]]) {
  w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note, landed_at) VALUES (9, ?, ?, ?, '', ?)").run(n, k, s, s === "landed" ? "2026-10-06T07:15:13Z" : null);
}
w.prepare("INSERT INTO transformation_levers (tp, n, key, status, note) VALUES (8, 3, 'access-and-waf', 'pending', '')").run();
const one = (q, ...a) => w.prepare(q).get(...a);
const snap = () => JSON.stringify([w.prepare("SELECT * FROM transformation_levers").all(), w.prepare("SELECT * FROM roadmap_implementation").all()]);

w.exec(sql);
const l3 = one("SELECT status, note, landed_at FROM transformation_levers WHERE tp = 9 AND n = 3");
ok(l3.status === "landed" && l3.landed_at && /^C5-RESILIENCE:/.test(l3.note) && /deploy-direct/.test(l3.note), "T9 lever 3 is landed with its evidence", l3);
ok(one("SELECT COUNT(*) n FROM transformation_levers WHERE tp = 9 AND status = 'landed'").n === 4, "all four T9 levers read landed");
ok(one("SELECT status FROM transformation_levers WHERE tp = 8 AND n = 3").status === "pending", "other plans' levers are untouched");
const r = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 134");
ok(r.status === "built" && r.evidence.startsWith(EVID) && r.evidence.includes("C5-RESILIENCE-134"), "row 134 is built and keeps its old evidence", r.status);
ok(/exit window still running/.test(r.evidence) && /2026-11-05T06:30Z/.test(r.evidence) && !/verified live|status verified/i.test(r.evidence.replace("set this row verified from that reading", "")), "it names the open 30-day window and does not claim it is verified");
ok(/ids? 2959/.test(r.evidence) && /2961/.test(r.evidence) && /0 of 233/.test(r.evidence), "it quotes the deploy-direct ledger ids and the census count it read");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 135").evidence === "untouched", "other rows are untouched");

const before = snap();
w.exec(sql);
ok(before === snap(), "a replay changes nothing");
w.exec(rollback);
const l3b = one("SELECT status, note, landed_at FROM transformation_levers WHERE tp = 9 AND n = 3");
ok(l3b.status === "pending" && l3b.note === "" && l3b.landed_at === null, "the Rollback line restores lever 3");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 134").evidence === EVID && one("SELECT status FROM roadmap_implementation WHERE id = 134").status === "partial", "the Rollback line restores row 134 exactly");

// the evidence must still be true of the code
const ops = rd("../scripts/cf_ops_actions.py");
ok(/DELETE-AFTER-UNBIND-1/.test(ops) && /def delete_worker\(/.test(ops) && /UNBIND-BEFORE-DELETE-1/.test(ops), "lever 1: delete-worker refuses while a binder exists (DELETE-AFTER-UNBIND-1) and unbind-service is guarded");
ok(existsSync(new URL("../scripts/cf_ops_delete_worker_test.py", import.meta.url)) && existsSync(new URL("../scripts/cf_ops_unbind_service_test.py", import.meta.url)), "lever 1 has its tests");
ok(existsSync(new URL("../qnfo-ops/dangling-10143.test.mjs", import.meta.url)), "lever 2: the 10143 prune test exists");
const wf = rd("../.github/workflows/canonical-deploy.yml");
const direct = rd("../scripts/direct_content_deploy.py");
ok(/direct_content_deploy\.py --targets \/tmp\/fallback\.txt/.test(wf) && /--fallback-file/.test(wf), "lever 3: canonical-deploy.yml drains the fallback file through direct_content_deploy.py");
ok(/deploy-direct/.test(direct) && /deployment_history/.test(direct) && /DEPLOY-SECOND-PATH-LEDGER-1/.test(direct), "lever 3: the second path writes the landed path to deployment_history");
ok(/fallback_drill/.test(wf), "lever 3: the drill input still exists");
const fc = rd("../qnfo-fleet-control/worker.js");
ok(/DANGLING-BINDINGS-1/.test(fc) && existsSync(new URL("../qnfo-fleet-control/dangling-bindings.test.mjs", import.meta.url)) && existsSync(new URL("./2026-10-06-dangling-bindings.sql", import.meta.url)), "lever 4: the census, its test and its metric migration exist");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
