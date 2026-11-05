// CLOSE-REFUSAL-1 offline suite (qnfo-lifecycle): slices closeIssue, closeIssueGuarded and sweepModelHealthIssues out of worker.js and runs them against an in-memory SQLite D1 (node:sqlite)
// that carries the live close guard issue_close_evidence_required (CLOSE-BINDS-TO-PROBE-1: RAISE(ABORT, 'close-while-contract-fails') while the issue's own contract reads a failing verdict).
// Measured 2026-11-04: qnfo-lifecycle logged "close-while-contract-fails" 23 times from 03-05:00Z and the 02:00 UTC run never wrote its summary job-run event, the evidence the drill probe of
// model-health-sweep reads (CHAOS-DRILL-FAILED-1, agent_issues 1001590). Proves: (1) closeIssueGuarded closes an issue whose contract passes and returns "" ; (2) it returns the refusal text,
// instead of throwing, when the guard refuses; (3) any other error is still thrown; (4) the sweep closes the recovered models whose contract is clean, keeps the one whose contract fails and
// goes on to the rows after it; (5) the folded reference qnfo-backlog-exec carries the same helper and call sites; (6) the host mirror is identical.
// Run: node qnfo-lifecycle/close-refusal.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
const ref = readFileSync(new URL("../qnfo-backlog-exec/worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const a = src.indexOf("async function closeIssue(env, id, now, target, evidence)");
const b = src.indexOf("async function closeIssueGuarded(");
const bEnd = src.indexOf("\n}\n", b) + 3;
const s0 = src.indexOf("function modelHealthDue(event)");
const sEnd = src.indexOf("\n}\n", src.indexOf("async function sweepModelHealthIssues(")) + 3;
if (a < 0 || b < a || s0 < 0 || sEnd < s0) throw new Error("blocks not found");
const cx = vm.createContext({ Date, Number, String, JSON, console, setTimeout, Promise, TICK_CRON: "0 * * * *", VERSION: "1.17.9-test" });
vm.runInContext(src.slice(a, bEnd) + "\n" + src.slice(s0, sEnd) + "\nthis.guarded = closeIssueGuarded; this.sweep = sweepModelHealthIssues;", cx);

function mk() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT, remediation TEXT, close_evidence TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, status TEXT, last_verdict TEXT);
CREATE TABLE ai_model_health (model_id TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TRIGGER issue_close_evidence_required
BEFORE UPDATE OF status ON agent_issues
WHEN NEW.status IN ('closed','resolved','wontfix') AND OLD.status NOT IN ('closed','resolved','wontfix')
BEGIN
  SELECT RAISE(ABORT,'close-without-evidence')
    WHERE NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND t.close_evidence IS NOT NULL AND TRIM(t.close_evidence) <> '');
  SELECT RAISE(ABORT,'close-while-contract-fails')
    WHERE NEW.status IN ('closed','resolved')
      AND EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.issue_id = NEW.id
                    AND c.status IN ('active','holding')
                    AND COALESCE(c.last_verdict,'') IN ('fail','vacuous-probe-result','probe-error','probe-not-machine-executable','probe-same-account-host'));
END;`);
  const stmt = (sql) => { let args = []; const self = { bind(...x) { args = x; return self; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; } }; return self; };
  return { db, env: { AUDIT: { prepare: stmt }, QNFO_AUDIT: { prepare: stmt } } };
}
const issue = (db, title, verdict) => {
  const id = Number(db.prepare("INSERT INTO agent_issues (title, status, created_at, updated_at) VALUES (?, 'open', ?, ?)").run(title, Date.now(), Date.now()).lastInsertRowid);
  if (verdict) db.prepare("INSERT INTO remediation_contracts (class, issue_id, status, last_verdict) VALUES (?, ?, 'active', ?)").run("issue-" + id, id, verdict);
  return id;
};
const st = (db, id) => db.prepare("SELECT status FROM agent_issues WHERE id = ?").get(id).status;

// 1-3. closeIssueGuarded
{
  const { db, env } = mk();
  const clean = issue(db, "x clean", "pass"), bad = issue(db, "x failing", "fail"), noContract = issue(db, "x none", null);
  ok((await cx.guarded(env, clean, 1, null, "evidence")) === "" && st(db, clean) === "closed", "a clean issue closes and the helper returns an empty string");
  ok((await cx.guarded(env, noContract, 1, null, "evidence")) === "" && st(db, noContract) === "closed", "an issue with no contract closes");
  const r = await cx.guarded(env, bad, 1, null, "evidence");
  ok(/close-while-contract-fails/.test(r) && st(db, bad) === "open", "a failing contract is a returned refusal, not a throw; the issue stays open", r);
  db.exec("DROP TABLE issue_triage");
  let thrown = null; try { await cx.guarded(env, clean, 1, null, "evidence"); } catch (e) { thrown = String(e.message); }
  ok(thrown && /no such table/.test(thrown), "any other error is still thrown", thrown);
}
// 4. the sweep goes on past a refused row
{
  const { db, env } = mk();
  ["glm-5.3", "kimi-k2.7-code", "gpt-oss-120b"].forEach((m) => db.prepare("INSERT INTO ai_model_health (model_id, status) VALUES (?, 'ok')").run(m));
  const first = issue(db, "[ai-cal] model probe failing: glm-5.3", "fail");
  const second = issue(db, "[ai-cal] model probe failing: kimi-k2.7-code", "pass");
  const third = issue(db, "MODEL-DEGRADED gpt-oss-120b", null);
  const out = await cx.sweep(env, Date.parse("2026-11-05T01:00:00Z"));
  ok(st(db, first) === "open" && out.kept.includes(first), "the refused row is kept", out);
  ok(st(db, second) === "closed" && st(db, third) === "closed" && out.closed.length === 2, "the rows after the refused one still close (the sweep does not abort)", out);
  const again = await cx.sweep(env, Date.parse("2026-11-05T02:00:00Z"));
  ok(again.closed.length === 0 && again.kept.includes(first), "the next tick keeps the refused row and closes nothing new", again);
  db.prepare("UPDATE remediation_contracts SET last_verdict = 'pass' WHERE issue_id = ?").run(first);
  const third2 = await cx.sweep(env, Date.parse("2026-11-05T03:00:00Z"));
  ok(st(db, first) === "closed" && third2.closed.includes(first), "once its contract passes the issue closes on the next tick", third2);
}
// 5-6. source parity
ok(src.indexOf("async function closeIssueGuarded(") > 0 && ref.indexOf("async function closeIssueGuarded(") > 0, "host and folded reference both carry the helper");
ok((src.match(/await closeIssueGuarded\(env, row\.id, now/g) || []).length === 8 && (ref.match(/await closeIssueGuarded\(env, row\.id, now/g) || []).length === 8, "eight call sites in the backlog run in both");
ok(!/\n\s+await closeIssue\(env, row\.id, now/.test(src) && !/\n\s+await closeIssue\(env, row\.id, now/.test(ref), "no bare closeIssue call is left in the run loop");
ok(mirror === src, "deployed-current.worker.js is identical to worker.js");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
