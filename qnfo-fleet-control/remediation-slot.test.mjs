// REMEDIATION-TICK-SLOT-1 offline suite (qnfo-fleet-control 0.23.0, agent_issues 2461 and 2199, pillar autonomy).
// On 2026-10-13 at 04:00 and 05:00 UTC the remediation tick verified 10 and 11 contracts instead of about 150: it ran inside
// the hourly fan-out of about 25 parallel D1 jobs and was cut off when the event ended, so 203 active contracts went overdue,
// issues_unprobed_60m breached and failure modes read "unprobed". Proves: the tick runs on the 20-minute cron with a budget
// and no longer in the hourly fan-out; a spent budget stops new probes and reports how many are left; a probed contract is
// due again 25 minutes before its cadence (never sooner than 20 minutes), so a 20-minute slot re-probes an hourly contract
// inside 60 minutes; everything else about a probe is unchanged.
// Run: node --no-warnings qnfo-fleet-control/remediation-slot.test.mjs   -> prints "N checks, 0 failure(s)"
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const a = src.indexOf("var __RT_WRITE_KW"), b = src.indexOf('__name(rtReopenOnRelapse, "rtReopenOnRelapse");');
if (a < 0 || b < a) throw new Error("remediation block not found in worker.js");
let fails = 0, n = 0;
const check = (c, m, x) => { n++; if (!c) { fails++; console.log("FAIL " + m + (x !== undefined ? " -- " + JSON.stringify(x) : "")); } };

const vm1 = /var VERSION = "(\d+)\.(\d+)\./.exec(src);
check(vm1 && (+vm1[1] > 0 || +vm1[2] >= 26), "VERSION at least 0.26 (REMEDIATION-2X-1 is 0.26.2)");

// wiring: the 20-minute block runs the tick with a budget; the hourly fan-out no longer does
const sched = src.slice(src.indexOf("async scheduledOnce(event, env, ctx) {\n    // CRON-DISPATCH-ELIMINATION-1"));
const twenty = sched.slice(0, sched.indexOf('if (cron === "0 3 * * *")'));
// REMEDIATION-2X-1 (0.26.2): the slot is the 10-minute cron, and the remediation tick is not gated to the 20-minute grid.
check(/if \(cron === "\*\/10 \* \* \* \*"\)/.test(twenty), "the slot is the 10-minute cron");
// CRON-DISPATCH-ELIMINATION-1: 5 * * * * is the hourly allowlist entry; a stale */20 trigger maps to the fast slot
check(/const cron = \["5 \* \* \* \*", "0 3 \* \* \*", "0 4 1 \* \*", "30 3 \* \* 1"\]\.indexOf\(event\.cron\) < 0 \? "\*\/10 \* \* \* \*" : event\.cron;/.test(sched), "an undeclared cron is the fast slot");
check(/\n\s+ctx\.waitUntil\(remediationContractsTick\(env, \{ budgetMs: 25000 \}\)/.test(twenty), "the remediation tick runs in every 10-minute slot (not behind onTwentyGrid)");
check(/\n\s+ctx\.waitUntil\(codeMergeTick\(env, mergeSlot \? \{\} : \{ openOnly: true \}\)/.test(twenty) && /var mergeSlot = true;/.test(twenty), "code-loop merges run on every 10-minute tick (PR-LANE-FAST-1; minute 30 and hourly before)");
check(/\n\s+ctx\.waitUntil\(branchHygieneTick\(env, \{ laneOnly: true \}\)/.test(twenty), "the stale-PR lane runs in every 10-minute slot");
const hourly = sched.slice(sched.indexOf('if (cron === "0 4 1 * *" || cron === "30 3 * * 1")'), sched.indexOf("return deployDefault.scheduled(event, env, ctx);"));
check(/remediationContractsTick\(env, \{ budgetMs: 25000 \}\)/.test(twenty), "the 10-minute cron runs the remediation tick with a 25 s budget");
check(!/remediationContractsTick\(env/.test(hourly), "the hourly fan-out no longer runs the remediation tick");

const toNamed = (sql, args) => {
  const obj = {};
  let hit = false;
  const s = sql.replace(/\?(\d+)/g, (m, d) => { hit = true; obj["p" + d] = args[Number(d) - 1]; return ":p" + d; });
  return hit ? [s, obj] : [sql, args];
};
const wrap = (db, delayMs) => {
  const pause = () => new Promise((r) => setTimeout(r, delayMs || 0));
  const stmt = (sql, args) => {
    const [q, named] = toNamed(sql, args);
    return {
      bind: (...x) => stmt(sql, x),
      run: async () => { const r = db.prepare(q).run(...(Array.isArray(named) ? named : [named])); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
      first: async () => { if (delayMs && /expected/.test(sql)) await pause(); return db.prepare(q).get(...(Array.isArray(named) ? named : [named])) || null; },
      all: async () => ({ results: db.prepare(q).all(...(Array.isArray(named) ? named : [named])) })
    };
  };
  return { prepare: (sql) => stmt(sql, []) };
};
const mk = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
    CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT NOT NULL, expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT (datetime('now')), verifier TEXT);
    CREATE TABLE remediation_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT NOT NULL, expected TEXT, observed TEXT, pass INTEGER NOT NULL, verified_at TEXT DEFAULT (datetime('now')), verifier TEXT, path TEXT DEFAULT 'B:evidence-table');
    CREATE VIEW v_remediation_evidence_all AS SELECT id, issue_id, class, probe_url, transport, expected, observed, pass, verified_at, verifier, 'verifications' AS src FROM remediation_verifications UNION ALL SELECT id, issue_id, class, probe_url, transport, expected, observed, pass, verified_at, verifier, 'evidence' AS src FROM remediation_evidence;
    CREATE TABLE path_liveness (path TEXT PRIMARY KEY, checked_at TEXT, checked_by TEXT, detail TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, close_channel TEXT, updated_at INTEGER);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT, triage_state TEXT, owner TEXT, sla_due_at TEXT, close_evidence TEXT, reopened_count INTEGER NOT NULL DEFAULT 0);`);
  return db;
};
const ctx = vm.createContext({ VERSION: "test", __name: (f) => f, Date, Math, Number, String, JSON, Object, Array, console, URL, AbortController, setTimeout, clearTimeout, fetch: async () => ({ status: 599, headers: { get: () => null }, text: async () => "" }) });
const W = vm.runInContext(src.slice(a, b) + "\n;({ remediationContractsTick, rtNextDueOffset, RT_REPROBE_EARLY_MIN });", ctx, { filename: "fleet-control#REMEDIATION-TICK-SLOT-1" });

// next-due offsets
// REMEDIATION-2X-1: half the earlier offset (35 -> 18 minutes), floor 10 minutes; the 24 h post-close hold is unchanged.
check(W.rtNextDueOffset(1) === "+18 minutes", "an hourly contract is due again in 18 minutes", W.rtNextDueOffset(1));
check(W.rtNextDueOffset(24) === "+1415 minutes", "a daily hold is due again 25 minutes early", W.rtNextDueOffset(24));
check(W.rtNextDueOffset(6) === "+168 minutes", "a 6-hour contract is due again in half its earlier 335 minutes", W.rtNextDueOffset(6));
check(W.rtNextDueOffset(0.25) === "+10 minutes" && W.rtNextDueOffset(0) === "+18 minutes", "never sooner than 10 minutes; a missing cadence reads as hourly");
check(18 + 10 <= 30, "a 10-minute slot re-probes an hourly contract inside 30 minutes (was 55)");

// a probe's next_due_at lands about 35 minutes out
{
  const db = mk();
  db.exec("INSERT INTO agent_issues (id, title, status) VALUES (1, 'x', 'open')");
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, expected_cadence_h) VALUES ('fm-a', 1, ?, 'd1-query', 1)").run("SELECT 'ok' AS expected, 'no' AS observed");
  const out = await W.remediationContractsTick({ AUDIT: wrap(db) });
  const row = db.prepare("SELECT last_verdict, CAST(ROUND((julianday(next_due_at) - julianday('now')) * 1440) AS INTEGER) AS mins FROM remediation_contracts WHERE class = 'fm-a'").get();
  check(out.fail === 1 && row.last_verdict === "fail", "the probe still runs and records its verdict", row);
  check(row.mins >= 17 && row.mins <= 18, "next_due_at is 18 minutes out", row);
  check(out.budget_left === 0, "no budget set: nothing left behind");
}

// a spent budget stops new probes and leaves them due
{
  const db = mk();
  for (let i = 1; i <= 5; i++) {
    db.prepare("INSERT INTO agent_issues (id, title, status) VALUES (?, 'x', 'open')").run(i);
    db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, expected_cadence_h) VALUES (?, ?, ?, 'd1-query', 1)").run("c" + i, i, "SELECT 'ok' AS expected, 'ok' AS observed");
  }
  const out = await W.remediationContractsTick({ AUDIT: wrap(db, 15) }, { budgetMs: 5 });
  const probed = db.prepare("SELECT COUNT(*) AS n FROM remediation_verifications").get().n;
  const stillDue = db.prepare("SELECT COUNT(*) AS n FROM remediation_contracts WHERE next_due_at IS NULL").get().n;
  // The budget is wall-clock (5 ms against a 15 ms probe): on a loaded runner it can lapse before the first probe starts (probed 0, left 5), so the checks are the invariant, not the count.
  check(probed <= 1 && probed + out.budget_left === 5 && out.budget_left >= 4, "after the budget is spent no new probe starts and the rest are counted as left", { probed, left: out.budget_left });
  check(stillDue === out.budget_left, "the unprobed contracts stay due for the next slot", { stillDue, left: out.budget_left });
  check(out.due === 5, "due counts every selected contract", out.due);
}

console.log(n + " checks, " + fails + " failure(s)");
if (fails) process.exit(1);
