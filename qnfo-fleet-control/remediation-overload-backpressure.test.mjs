// REMEDIATION-OVERLOAD-BACKPRESSURE-1 offline suite (qnfo-fleet-control, pillar autonomy; FLEET-JOURNEY-FAILED-1 traffic-health agent_issues 2562).
// Measured 2026-11-04 22:30-23:30Z: of 419 error-level "D1 DB is overloaded" lines in an hour, 210 came from the remediation tick, which stamped an overloaded probe as the
// contract's verdict probe-error and kept writing into the database that had just said it was full. Proves: an overloaded probe leaves its contract untouched (no verdict, no
// attempt, no due date moved, no verification row); an overload line is a warning, not an error line; an iteration that met an overload makes the next one wait 2 s times the streak and
// three in a row end the slot (the rest stays due, post-loop work waits); a clean iteration resets the streak; any other probe failure is still a probe-error with an error line.
// Run: node --no-warnings qnfo-fleet-control/remediation-overload-backpressure.test.mjs   -> prints "N checks, 0 failure(s)"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("var __RT_WRITE_KW"), b = src.indexOf('__name(rtReopenOnRelapse, "rtReopenOnRelapse");');
if (a < 0 || b < a) throw new Error("remediation block not found in worker.js");
let fails = 0, n = 0;
const check = (c, m, x) => { n++; if (!c) { fails++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x) : "")); } };

const OVERLOAD = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window";
const toNamed = (sql, args) => {
  const obj = {};
  let hit = false;
  const s = sql.replace(/\?(\d+)/g, (m, d) => { hit = true; obj["p" + d] = args[Number(d) - 1]; return ":p" + d; });
  return hit ? [s, obj] : [sql, args];
};
// throwOn(sql, callNo) decides whether the statement's first() throws; calls counts the probe reads.
const wrap = (db, throwOn) => {
  let probeCalls = 0;
  const stmt = (sql, args) => {
    const [q, named] = toNamed(sql, args);
    const par = Array.isArray(named) ? named : [named];
    return {
      bind: (...x) => stmt(sql, x),
      run: async () => { const r = db.prepare(q).run(...par); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
      first: async () => {
        if (/AS expected/.test(sql)) { probeCalls++; const e = throwOn && throwOn(sql, probeCalls); if (e) throw new Error(e); }
        return db.prepare(q).get(...par) || null;
      },
      all: async () => ({ results: db.prepare(q).all(...par) })
    };
  };
  return { prepare: (sql) => stmt(sql, []), calls: () => probeCalls };
};
const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER DEFAULT 1, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, attempts INTEGER DEFAULT 0, last_attempt_at TEXT, last_verdict TEXT, status TEXT DEFAULT 'active', ts TEXT DEFAULT CURRENT_TIMESTAMP, deferred_since TEXT, requires_container INTEGER DEFAULT 0);
    CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT NOT NULL, expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT CURRENT_TIMESTAMP, verifier TEXT, action_ref TEXT);
    CREATE TABLE remediation_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT NOT NULL, expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT CURRENT_TIMESTAMP, verifier TEXT, path TEXT);
    CREATE VIEW v_remediation_evidence_all AS SELECT id, issue_id, class, probe_url, transport, expected, observed, pass, verified_at, verifier, 'verifications' AS src FROM remediation_verifications UNION ALL SELECT id, issue_id, class, probe_url, transport, expected, observed, pass, verified_at, verifier, 'evidence' AS src FROM remediation_evidence;
    CREATE TABLE path_liveness (path TEXT PRIMARY KEY, checked_at TEXT, checked_by TEXT, detail TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);`);
  return db;
};
const seed = (db, count, probe) => {
  for (let i = 1; i <= count; i++) {
    db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?, 'x' || ?, 'open')").run(i, i);
    db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, expected_cadence_h) VALUES (?, ?, ?, 'd1-query', 1)").run("c" + i, i, probe || "SELECT 'ok' AS expected, 'ok' AS observed");
  }
};

const lines = { warn: [], error: [] }, delays = [];
const spy = { log: () => {}, warn: (l) => lines.warn.push(String(l)), error: (l) => lines.error.push(String(l)) };
const fastTimeout = (f, ms) => { delays.push(ms); f(); return 0; };
const ctx = vm.createContext({ VERSION: "test", __name: (f) => f, Date, Math, Number, String, JSON, Object, Array, console: spy, URL, AbortController, setTimeout: fastTimeout, clearTimeout, fetch: async () => ({ status: 599, headers: { get: () => null }, text: async () => "" }) });
const W = vm.runInContext(src.slice(a, b) + "\n;({ remediationContractsTick, rtIsD1Overload, rtLog });", ctx, { filename: "fleet-control#REMEDIATION-OVERLOAD-BACKPRESSURE-1" });
const reset = () => { lines.warn.length = 0; lines.error.length = 0; delays.length = 0; };

// the classifier
check(W.rtIsD1Overload(new Error(OVERLOAD)), "the 10-second-window message is an overload");
check(W.rtIsD1Overload(new Error("D1_ERROR: D1 DB exceeded its CPU time limit and was reset.")), "a CPU-time reset is an overload");
check(!W.rtIsD1Overload(new Error("D1_ERROR: no such column: foo")), "a schema error is not an overload");
check(!W.rtIsD1Overload(null) && !W.rtIsD1Overload(""), "nothing is not an overload");
reset(); W.rtLog(JSON.stringify({ evt: "x", error: OVERLOAD }));
check(lines.warn.length === 1 && lines.error.length === 0, "an overload line is a warning", lines);
reset(); W.rtLog(JSON.stringify({ evt: "x", error: "no such column" }));
check(lines.error.length === 1 && lines.warn.length === 0, "any other line stays an error", lines);

// 1. an overloaded probe leaves its contract untouched
{
  reset();
  const db = mk(); seed(db, 1);
  const out = await W.remediationContractsTick({ AUDIT: wrap(db, () => OVERLOAD) });
  const row = db.prepare("SELECT attempts, last_verdict, next_due_at FROM remediation_contracts WHERE class = 'c1'").get();
  check(row.attempts === 0 && row.last_verdict === null && row.next_due_at === null, "no attempt, no verdict, no due date moved", row);
  check(db.prepare("SELECT COUNT(*) AS n FROM remediation_verifications").get().n === 0, "no verification row written");
  check(out.overloaded === 1 && !out.stopped && !out.probe_error, "the summary says overloaded 1, not probe-error", out);
  // the post-loop path-health work logs its own schema complaints against this thin test schema; what matters is that nothing about the overload or a probe-error is an error line
  check(lines.warn.length === 1 && lines.error.every((l) => !/overload|d1-backpressure|probe-error/.test(l)), "one warning and no overload or probe-error error line", lines);
}

// 2. three overloaded iterations in a row end the slot; the waits are 2 s times the streak; the rest stays due
{
  reset();
  const db = mk(); seed(db, 5);
  const w = wrap(db, () => OVERLOAD);
  const out = await W.remediationContractsTick({ AUDIT: w });
  check(w.calls() === 3, "three probes asked, then the slot stops", w.calls());
  check(out.stopped === "d1-overloaded" && out.budget_left === 2 && out.overloaded === 3, "stopped, two left behind, three overloads counted", out);
  check(JSON.stringify(delays) === JSON.stringify([2000, 4000]), "waits of 2 s and 4 s between the iterations", delays);
  check(db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE attempts = 0 AND last_verdict IS NULL").get().n === 5, "all five contracts untouched");
  check(db.prepare("SELECT COUNT(*) AS n FROM path_liveness").get().n === 0, "the post-loop path-health work waited for the next slot");
  check(lines.error.length === 0, "no error line from a stopped slot", lines.error);
}

// 3. a clean iteration resets the streak
{
  reset();
  const db = mk(); seed(db, 4);
  const w = wrap(db, (sql, call) => (call === 1 || call === 3) ? OVERLOAD : null);
  const out = await W.remediationContractsTick({ AUDIT: w });
  check(!out.stopped && out.overloaded === 2 && out.budget_left === 0, "overload, clean, overload, clean: the slot runs to the end", out);
  const rows = db.prepare("SELECT class, last_verdict, attempts FROM remediation_contracts ORDER BY class").all();
  check(rows[0].attempts === 0 && rows[1].attempts === 1 && rows[2].attempts === 0 && rows[3].attempts === 1, "only the clean probes took a verdict", rows);
  check(db.prepare("SELECT COUNT(*) AS n FROM remediation_verifications").get().n === 2, "two verification rows for the two clean probes");
}

// 4. any other probe failure is still a probe-error with an error line (no regression of PROBE-ERROR-VISIBILITY-1)
{
  reset();
  const db = mk(); seed(db, 1);
  const out = await W.remediationContractsTick({ AUDIT: wrap(db, () => "D1_ERROR: no such table: nothing") });
  const row = db.prepare("SELECT attempts, last_verdict FROM remediation_contracts WHERE class = 'c1'").get();
  check(row.attempts === 1 && row.last_verdict === "probe-error" && out.probe_error === true, "a schema error is still the verdict probe-error", { row, out });
  check(lines.error.length >= 1 && lines.error.some((l) => /probe-error/.test(l)), "and still an error line", lines.error);
  check(!out.overloaded, "not counted as an overload", out);
}

// 5. JOURNEY-RECORD-OVERLOAD-1: the journey row waits out an overload twice before it gives up
{
  const m = /^async function jrnWaitOutOverload\(/m.exec(src);
  if (!m) throw new Error("jrnWaitOutOverload not found in worker.js");
  const fnSrc = src.slice(m.index, src.indexOf("\n}\n", m.index) + 3);
  const jctx = vm.createContext({ setTimeout: fastTimeout, Error, String });
  const jw = vm.runInContext(fnSrc + "\n;jrnWaitOutOverload;", jctx);
  reset();
  let calls = 0;
  const v = await jw(async () => { if (++calls < 3) throw new Error(OVERLOAD); return "row"; });
  check(v === "row" && calls === 3 && JSON.stringify(delays) === JSON.stringify([2500, 5000]), "two overloads then success: the row is written after waits of 2.5 s and 5 s", { v, calls, delays });
  reset(); calls = 0;
  let thrown = null;
  try { await jw(async () => { calls++; throw new Error(OVERLOAD); }); } catch (e) { thrown = e; }
  check(thrown && calls === 3 && /overloaded/.test(thrown.message), "three overloads: the third is thrown to the caller's own catch", { calls });
  reset(); calls = 0; thrown = null;
  try { await jw(async () => { calls++; throw new Error("D1_ERROR: no such table: journey_runs"); }); } catch (e) { thrown = e; }
  check(thrown && calls === 1 && delays.length === 0, "any other error is thrown at once, without a wait", { calls, delays });
  check(/await jrnWaitOutOverload\(function \(\) \{\s*return db\.prepare\("INSERT INTO journey_runs/.test(src), "the journey_runs insert goes through the wait");
  check(/await jrnWaitOutOverload\(function \(\) \{ return jrnIssue\(db, j, ok, failed, at, now\); \}\)/.test(src), "the journey issue update goes through the wait");
}

// 6. wiring
check(/overloaded: r\.overloaded \|\| 0, stopped: r\.stopped \|\| null/.test(src), "the 10-minute summary line carries overloaded and stopped");
{
  const t0 = src.indexOf("async function remediationContractsTick(env, opts) {\n"), tick = src.slice(t0, src.indexOf("\n}\n", t0) + 3);
  check(t0 > 0 && !/console\.error\(JSON\.stringify\(\{ evt: "fleet-control:remediation/.test(tick) && (tick.match(/rtLog\(JSON\.stringify/g) || []).length >= 10, "the tick function logs through rtLog");
}

console.log(n + " checks, " + fails + " failure(s)");
if (fails) process.exit(1);
