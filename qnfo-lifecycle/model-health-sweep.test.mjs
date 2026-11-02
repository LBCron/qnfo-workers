// MODEL-HEALTH-SWEEP-1 offline suite (qnfo-lifecycle 1.13.0): slices modelHealthDue and sweepModelHealthIssues out of worker.js and runs them against an in-memory SQLite D1
// (node:sqlite) that carries the close guard of issue_close_evidence_required. Measured 2026-10-19 21:5xZ: six "[ai-cal] model probe failing" and MODEL-DEGRADED issues open since
// 17:15Z while every named model read ok in ai_model_health; the backlog member runs once a day and reads only the first 40 rows by priority and oldest updated_at.
// Proves: a recovered model's issue is closed with close_evidence in the same call, and cloud_ops_events records it; a degraded model keeps it, and so does a failing one (the
// member's predicate tested only "degraded"); a model with no health row is closed; MODEL-DEGRADED lists close only when none of the named models is degraded or failing;
// unrelated, closed and [gw-fail] issues are untouched; ops_config model_health_sweep = off stops it; the sweep is due on the hourly tick and on no table entry or other cron;
// the host's scheduled handler calls it ahead of the daily member; VERSION is at least 1.13.0; the mirror is identical.
// Run: node qnfo-lifecycle/model-health-sweep.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const a = src.indexOf("function modelHealthDue(event)"), b = src.indexOf("// ---- ", a);
const endFn = src.indexOf("\n}\n", src.indexOf("async function sweepModelHealthIssues(")) + 3;
if (a < 0 || endFn < a) throw new Error("sweep block not found");
const cx = vm.createContext({ Date, Number, String, JSON, console, TICK_CRON: "0 * * * *", VERSION: "1.13.0-test" });
vm.runInContext(src.slice(a, endFn) + "\nthis.due = modelHealthDue; this.sweep = sweepModelHealthIssues;", cx);

function mk() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, rc TEXT NOT NULL, triage_state TEXT NOT NULL DEFAULT 'triaged', owner TEXT NOT NULL, sla_due_at TEXT NOT NULL, triaged_at TEXT, remediation TEXT, close_evidence TEXT, reopened_count INTEGER DEFAULT 0);
CREATE TABLE ai_model_health (model_id TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TRIGGER issue_close_evidence_required BEFORE UPDATE OF status ON agent_issues WHEN NEW.status = 'closed' AND OLD.status = 'open'
  AND NOT EXISTS (SELECT 1 FROM issue_triage t WHERE t.issue_id = NEW.id AND COALESCE(t.close_evidence, '') <> '')
BEGIN SELECT RAISE(ABORT, 'close requires issue_triage.close_evidence'); END;`);
  const stmt = (sql) => { let args = []; const self = { bind(...x) { args = x; return self; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; } }; return self; };
  return { db, env: { QNFO_AUDIT: { prepare: stmt } } };
}
const issue = (db, title, status = "open") => Number(db.prepare("INSERT INTO agent_issues (title, status, created_at, updated_at) VALUES (?, ?, ?, ?)").run(title, status, Date.now(), Date.now()).lastInsertRowid);
const health = (db, m, s) => db.prepare("INSERT INTO ai_model_health (model_id, status) VALUES (?, ?)").run(m, s);
const st = (db, id) => db.prepare("SELECT status FROM agent_issues WHERE id = ?").get(id).status;

{
  const { db, env } = mk();
  ["glm-5.3", "kimi-k2.7-code", "gpt-oss-120b"].forEach((m) => health(db, m, "ok"));
  health(db, "kimi-k2.6", "degraded"); health(db, "deepseek-v4-pro-wa", "failing"); health(db, "deepseek-v4-flash-wa", "ok");
  const i = {
    okAi: issue(db, "[ai-cal] model probe failing: glm-5.3"),
    okAi2: issue(db, "[ai-cal] model probe failing: kimi-k2.7-code"),
    degAi: issue(db, "[ai-cal] model probe failing: kimi-k2.6"),
    failAi: issue(db, "[ai-cal] model probe failing: deepseek-v4-pro-wa"),
    absentAi: issue(db, "[ai-cal] model probe failing: retired-model"),
    okList: issue(db, "MODEL-DEGRADED gpt-oss-120b,deepseek-v4-flash-wa"),
    badList: issue(db, "MODEL-DEGRADED kimi-k2.6,gpt-oss-120b,deepseek-v4-flash-wa,deepseek-v4-pro-wa"),
    gw: issue(db, "[gw-fail] 12 @cf/openai/gpt-oss-120b"),
    other: issue(db, "SOMETHING-ELSE-1: unrelated"),
    alreadyClosed: issue(db, "[ai-cal] model probe failing: gpt-oss-120b", "closed")
  };
  const out = await cx.sweep(env, Date.parse("2026-10-19T22:00:00Z"));
  const closed = new Set(out.closed);
  ok(["okAi", "okAi2", "absentAi", "okList"].every((k) => closed.has(i[k]) && st(db, i[k]) === "closed"), "recovered, absent-from-health and all-ok lists are closed", out);
  ok(["degAi", "failAi", "badList"].every((k) => !closed.has(i[k]) && st(db, i[k]) === "open"), "a degraded or failing named model keeps its issue open (failing counts)", out);
  ok(["gw", "other"].every((k) => st(db, i[k]) === "open") && st(db, i.alreadyClosed) === "closed", "[gw-fail], unrelated and closed issues are untouched");
  const t = db.prepare("SELECT * FROM issue_triage WHERE issue_id = ?").get(i.okAi);
  ok(t && t.triage_state === "closed" && t.owner === "qnfo-lifecycle" && t.close_evidence.includes("MODEL-HEALTH-SWEEP-1") && t.close_evidence.includes("glm-5.3") && t.close_evidence.includes("2026-10-19T22:00:00.000Z"), "close_evidence names the sweep, the model and the time", t);
  ok(db.prepare("SELECT close_evidence FROM issue_triage WHERE issue_id = ?").get(i.okList).close_evidence.includes("gpt-oss-120b,deepseek-v4-flash-wa"), "a MODEL-DEGRADED close names the models");
  ok(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE job = 'qnfo-lifecycle' AND text LIKE 'model-health sweep closed issue %'").get().n === 4, "one cloud_ops_events row per close");
  ok(out.checked === 7 && out.kept.length === 3, "7 checked, 3 kept", [out.checked, out.kept]);
  const again = await cx.sweep(env, Date.parse("2026-10-19T22:01:00Z"));
  ok(again.closed.length === 0 && again.checked === 3, "a second sweep closes nothing and re-checks only the three open rows", again);
  db.prepare("UPDATE ai_model_health SET status = 'ok' WHERE model_id IN ('kimi-k2.6', 'deepseek-v4-pro-wa')").run();
  const third = await cx.sweep(env, Date.parse("2026-10-19T23:00:00Z"));
  ok(third.closed.length === 3 && [i.degAi, i.failAi, i.badList].every((x) => st(db, x) === "closed"), "when the models recover the three close on the next tick", third);
}
{
  const { db, env } = mk();
  health(db, "glm-5.3", "ok");
  const id = issue(db, "[ai-cal] model probe failing: glm-5.3");
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('model_health_sweep', 'off')").run();
  const out = await cx.sweep(env);
  ok(out.off === true && st(db, id) === "open", "ops_config model_health_sweep = off stops the sweep", out);
  db.prepare("UPDATE ops_config SET value = 'on' WHERE key = 'model_health_sweep'").run();
  ok((await cx.sweep(env)).closed.length === 1, "any other value runs it");
}
{
  const { env } = mk();
  const out = await cx.sweep(env);
  ok(out.checked === 0 && out.closed.length === 0, "no open rows: nothing to do");
}
// due on the hourly tick only
ok(cx.due({ cron: "0 * * * *" }) === true && cx.due({ cron: "0 * * * *", scheduledTime: Date.parse("2026-10-19T07:00:00Z") }) === true, "due on the hourly tick at any hour");
ok(cx.due({ cron: "0 * * * *", tickEntry: true }) === false && cx.due({ cron: "5 5 * * *" }) === false && cx.due(null) === false && cx.due(undefined) === false, "not due on a table entry, another cron or no event");
// wiring
const sched = src.slice(src.indexOf("  async scheduled(event, env, ctx) {\n    if (modelHealthDue"));
const backlogAt = sched.indexOf("if (await backlogDue(event, env))");
ok(sched.indexOf("sweepModelHealthIssues(env)") > 0 && sched.indexOf("sweepModelHealthIssues(env)") < backlogAt, "the host's scheduled handler runs the sweep ahead of the daily member");
ok(/\.catch\(function \(e\) \{ console\.error\("model-health sweep: "/.test(sched.slice(0, 400)), "a sweep failure is logged and never stops the tick");
const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
ok(v && (Number(v[1]) > 1 || Number(v[2]) > 13 || (Number(v[2]) === 13 && Number(v[3]) >= 0)), "VERSION is at least 1.13.0", v && v[0]);
ok(mirror === src, "deployed-current.worker.js is identical to worker.js");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
