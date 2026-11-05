// MONITORING-PASS-1 offline suite (qnfo-fleet-control, agent_issues 1000744, GitHub 5403, 2026-11-05). Slices rtMonitoringPass and the helpers it shares with remediationContractsTick out of
// worker.js and runs them against an in-memory SQLite D1. The contract of the pass: it probes the monitoring contracts of OPEN issues that the main loop never reads, writes ONE verification row each with
// the verifier 'qnfo-fleet-control/monitoring-pass@<VERSION>' and the probe's real expected and observed values (pass only when they are equal), touches nothing on the contract but last_attempt_at,
// respects its own limit and the tick budget, and stops on a D1 overload without writing more.
// Output MUST contain "0 failed" on success.   node qnfo-fleet-control/monitoring-pass-tick.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const cut = (from, to, start = 0) => { const a = src.indexOf(from, start), b = src.indexOf(to, a + from.length); if (a < 0 || b < a) throw new Error("block not found in worker.js: " + from); return src.slice(a, b); };
const line = (name) => { const m = new RegExp("^var " + name + " = .*$", "m").exec(src); if (!m) throw new Error(name + " not found"); return m[0]; };
const grab = (re) => { const m = re.exec(src); if (!m) throw new Error(String(re) + " not found"); return m[0]; };
const fnBody = (head) => { const a = src.indexOf(head); if (a < 0) throw new Error(head + " not found"); const b = src.slice(a + head.length).search(/\n(async )?function /); return src.slice(a, b < 0 ? src.length : a + head.length + b); };
const code = [
  line("__RT_WRITE_KW"), line("RT_SINK_TOKEN_RE"), line("RT_OVERLOAD_RE"), line("RT_OVERLOAD_STOP"), line("RT_MEASURED_WORDS"), line("RT_MEASURED_OPS"),
  grab(/^function rtIsD1Overload\(e\) \{.*\}$/m),
  cut("function rtLog(line) {", "\n}\n") + "\n}\n",
  cut("function rtSinkGuard(c, es, os) {", "\n}\n") + "\n}\n",
  cut("function rtIsMeasuredPending(os) {", "\n}\n") + "\n}\n",
  grab(/^function rtIsDeferral\(os\) \{.*\}$/m),
  "var VERSION = 'test-1';",
  cut("var RT_MONITORING_PASS_MAX = 60", "// MONITORING-PASS-1-END"),
].join("\n");
const logs = [];
const fallbacks = [];
const cx = vm.createContext({ Date, Number, String, Math, JSON, Object, Array, RegExp, Error, console: { error: (...a) => logs.push(a), warn: (...a) => logs.push(a), log() {} },
  verificationFallback: async (db, issueId, cls, url, transport, e, o, p, verifier) => { fallbacks.push({ cls, e, o, p, verifier }); return false; } });
vm.runInContext(code + "\nthis.api = { rtMonitoringPass, MAX: RT_MONITORING_PASS_MAX, AGE: RT_MONITORING_PASS_MIN_AGE_MIN, overload() { return rtOverloadSeen; } };", cx);
const api = cx.api;

function mk() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, status TEXT, module TEXT, last_attempt_at TEXT, last_verdict TEXT, attempts INTEGER DEFAULT 0, next_due_at TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, probe_url TEXT, transport TEXT, expected TEXT, observed TEXT, pass INTEGER, verifier TEXT, verified_at TEXT DEFAULT (datetime('now')));
CREATE TABLE metric_state (id INTEGER PRIMARY KEY, hit INTEGER);`);
  const stmt = (sql) => { let args = []; const self = { bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) || null; }, async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; } }; return self; };
  return { db, h: { prepare: stmt } };
}
const add = (db, n, opts = {}) => {
  const id = opts.issue || 1000 + n, cls = "issue-" + id;
  db.prepare("INSERT OR IGNORE INTO agent_issues VALUES (?, ?)").run(id, opts.issueStatus || "open");
  db.prepare("INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, module) VALUES (?, ?, ?, ?, ?, ?)").run(cls, id, opts.probe || "SELECT '1' AS expected, '1' AS observed", opts.transport || "d1-query", opts.status || "monitoring", opts.module || null);
  if (opts.lastAgoMin !== undefined) db.prepare("INSERT INTO remediation_verifications (issue_id, class, transport, expected, observed, pass, verifier, verified_at) VALUES (?, ?, 'd1-query', '1', '1', 1, ?, datetime('now', '-' || ? || ' minutes'))").run(id, cls, opts.verifier || "qnfo-fleet-control/monitoring-pass@0.66.0", opts.lastAgoMin);
  return cls;
};
const rowsOf = (db, cls) => db.prepare("SELECT * FROM remediation_verifications WHERE class = ? ORDER BY id").all(cls);
const contract = (db, cls) => db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get(cls);

{ // selection: monitoring + open + d1-query + no row of this pass newer than 40 minutes
  const { db, h } = mk();
  const a = add(db, 1);                                  // never verified
  const b = add(db, 2, { lastAgoMin: 120 });             // stale
  const c = add(db, 3, { lastAgoMin: 10 });              // fresh: left alone
  const d = add(db, 4, { status: "active" });            // active: the main loop's
  const e = add(db, 5, { issueStatus: "closed" });       // closed issue: never
  const f = add(db, 6, { transport: "runner-https" });   // another transport
  const g = add(db, 7, { lastAgoMin: 45 });              // 45 minutes: inside the issue's 55-minute window but past the pass's 40, so refreshed before the probe reads it stale
  const h2 = add(db, 8, { lastAgoMin: 5, verifier: "someone-else@1" }); // a fresh row of another verifier does not show this pass ran
  const res = await api.rtMonitoringPass(h, {});
  ok(api.AGE === 40, "the re-probe age is 40 minutes: " + api.AGE);
  ok(res.selected === 4 && res.written === 4, "the four contracts without a recent row of this pass are probed: " + JSON.stringify(res));
  ok(rowsOf(db, a).length === 1 && rowsOf(db, b).length === 2 && rowsOf(db, c).length === 1 && rowsOf(db, g).length === 2 && rowsOf(db, h2).length === 2, "a, b, g and h2 get a new row, c keeps its one");
  ok(rowsOf(db, d).length === 0 && rowsOf(db, e).length === 0 && rowsOf(db, f).length === 0, "active, closed-issue and other-transport contracts get none");
}
{ // the row: verifier, real values, pass only on equality; the contract keeps status, verdict and attempts
  const { db, h } = mk();
  const ok1 = add(db, 1, { probe: "SELECT '1' AS expected, '1' AS observed" });
  const bad = add(db, 2, { probe: "SELECT '1' AS expected, 'recovering' AS observed" });
  const pend = add(db, 3, { probe: "SELECT '1' AS expected, 'pending: 3 open, target 0' AS observed" });
  const dfr = add(db, 4, { probe: "SELECT '1' AS expected, 'pending' AS observed" });
  const nul = add(db, 5, { probe: "SELECT '1' AS expected, NULL AS observed" });
  for (const cls of [ok1, bad, pend, dfr, nul]) db.prepare("UPDATE remediation_contracts SET last_verdict = 'monitoring:metric-condition', attempts = 7 WHERE class = ?").run(cls);
  const res = await api.rtMonitoringPass(h, {});
  ok(res.written === 5 && res.pass === 1 && res.fail === 4, "one pass, four fails: " + JSON.stringify(res));
  const r = (cls) => rowsOf(db, cls)[0];
  ok(r(ok1).pass === 1 && r(ok1).expected === "1" && r(ok1).observed === "1" && r(ok1).verifier === "qnfo-fleet-control/monitoring-pass@test-1" && r(ok1).transport === "d1-query", "the pass row carries the real values and the pass verifier", r(ok1));
  ok(r(bad).pass === 0 && r(bad).observed === "recovering", "an unequal read is a fail with its real observed value", r(bad));
  ok(r(pend).pass === 0 && /^pending: 3/.test(r(pend).observed), "a measured pending read is a fail row, written as read", r(pend));
  ok(r(dfr).pass === 0 && r(dfr).observed === "pending", "a bare pending is a fail row (never a synthetic pass)", r(dfr));
  ok(r(nul).pass === 0 && r(nul).observed === "(null)" && r(nul).expected === "1", "a null observation is recorded as (null), pass 0", r(nul));
  for (const cls of [ok1, bad, pend, dfr, nul]) { const k = contract(db, cls); ok(k.status === "monitoring" && k.last_verdict === "monitoring:metric-condition" && k.attempts === 7 && k.last_attempt_at !== null, "contract " + cls + " keeps status, verdict and attempts and gets last_attempt_at", k); }
}
{ // errors and unexecutable probes
  const { db, h } = mk();
  const err = add(db, 1, { probe: "SELECT '1' AS expected, x AS observed FROM no_such_table" });
  const wr = add(db, 2, { probe: "UPDATE agent_issues SET status = 'closed'" });
  const multi = add(db, 3, { probe: "SELECT 1; SELECT 2" });
  const kw = add(db, 5, { probe: "SELECT '1' AS expected, ' delete ' AS observed" });
  const priv = add(db, 4, { probe: "SELECT 'a long free text value with spaces' AS expected, 'x' AS observed", module: "probe-author-1" });
  const res = await api.rtMonitoringPass(h, {});
  const e = rowsOf(db, err)[0];
  ok(e && e.pass === 0 && /^\(probe error\)/.test(e.observed), "a probe that throws is a fail row with the error text", e);
  ok(rowsOf(db, wr).length === 0 && rowsOf(db, multi).length === 0 && rowsOf(db, kw).length === 0, "a write, a multi-statement probe and a statement with a write keyword get no row");
  ok(res.selected === 3 && res.skipped === 1, "the write and the multi-statement probe never occupy a slot of the selection, the keyword one is skipped in the pass: " + JSON.stringify(res));
  ok(db.prepare("SELECT status FROM agent_issues WHERE id = 1002").get().status === "open", "the write probe changed nothing");
  const p = rowsOf(db, priv)[0];
  ok(p && p.pass === 0 && /^\(probe error\) .*free-text-value/.test(p.observed), "an authored probe whose value is free text is refused by the sink guard like in the main loop", p);
}
{ // its own limit
  const { db, h } = mk();
  for (let i = 0; i < api.MAX + 15; i++) add(db, i);
  const res = await api.rtMonitoringPass(h, {});
  ok(api.MAX === 60 && res.selected === 60 && res.written === 60, "at most 60 contracts per tick: " + JSON.stringify(res));
  const res2 = await api.rtMonitoringPass(h, {});
  ok(res2.selected === 15 && res2.written === 15, "the next tick takes the 15 that were left (the 60 just probed are fresh): " + JSON.stringify(res2));
  const res3 = await api.rtMonitoringPass(h, {});
  ok(res3.selected === 0, "then nothing is due");
}
{ // the budget of the tick
  const { db, h } = mk();
  for (let i = 0; i < 5; i++) add(db, i);
  const res = await api.rtMonitoringPass(h, { t0: Date.now() - 10000, budgetMs: 100 });
  ok(res.written === 0 && res.skipped === 5, "a spent tick budget leaves all five for the next slot: " + JSON.stringify(res));
}
{ // D1 overload: stop, write nothing more
  const { db, h } = mk();
  for (let i = 0; i < 4; i++) add(db, i, { probe: i === 1 ? "SELECT 'x' AS expected, 'y' AS observed FROM overloaded_marker" : "SELECT '1' AS expected, '1' AS observed" });
  const real = h.prepare;
  const hh = { prepare: (sql) => { if (/overloaded_marker/.test(sql)) { const s = real("SELECT 1"); s.first = async () => { throw new Error("D1 DB is overloaded. Requests queued for too long."); }; return s; } return real(sql); } };
  const res = await api.rtMonitoringPass(hh, {});
  ok(res.stopped === 1 && res.written === 1, "the pass stops at the overload after the one row it had written: " + JSON.stringify(res));
  ok(db.prepare("SELECT COUNT(*) n FROM remediation_verifications").get().n === 1, "no error row is written into the database that said it was full");
  ok(api.overload() >= 1, "the overload is counted for the tick (rtOverloadSeen)");
}
{ // the select failing (a database without the tables) never throws out of the pass
  const h = { prepare: () => ({ bind() { return this; }, async all() { throw new Error("no such table: remediation_contracts"); } }) };
  const res = await api.rtMonitoringPass(h, {});
  ok(res.selected === 0 && res.written === 0, "an unreadable ledger yields an empty pass, not an exception: " + JSON.stringify(res));
}
// the wiring: the tick calls the pass after the overload stop, and the version bump keeps the mirror
const tick = fnBody("async function remediationContractsTick(env, opts) {");
ok(/if \(out\.stopped\) return out;[\s\S]{0,400}rtMonitoringPass\(db, \{ t0: t0, budgetMs: budgetMs \}\)/.test(tick), "remediationContractsTick calls rtMonitoringPass after the overload stop with the tick budget");
ok((src.match(/function rtMonitoringPass\(/g) || []).length === 1 && /async function rtMonitoringPass\(db, o\) \{/.test(src), "the function is defined once");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
ok(mirror === src, "deployed-current.worker.js is identical to worker.js");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
