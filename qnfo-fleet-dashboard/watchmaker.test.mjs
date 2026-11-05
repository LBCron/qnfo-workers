// WATCHMAKER-INDEX-1 offline suite: replays the watchmaker block from worker.js against an in-memory SQLite D1 with
// synthetic ledgers and proves: a fully fresh fleet reads 0; a stalled runner, a never-run one, an unreadable ledger,
// a research backlog, an evolve loop with neither a proposal nor a heartbeat, and the code-task merge runner when it is
// stalled or disabled or leaves work for a person (a PR green for 6h or waiting 48h, needs_human, a pushed branch with no
// PR for 6h, a merge or close outside the runner in 30 days and after its first ok tick, a failed revert) each count; a
// first run not yet due, runner merges, person merges from before the runner existed and the owner's by-policy approvals
// do not; the daily run writes one row and the metric once per day, never before 07:00Z;
// GET /api/watchmaker serves it.
// INBOUND-SLA-1: the inbound SLA step counts when its runner is stalled, disabled or not yet run after its first due date,
// or when a human inbound message is older than 120 min with no fleet action (a decision row or sent_at is one; SLA-120M).
// REACH-LOOPS-WATCH-1: the delegated identity and reach loops read their run records (social ledgers by meta.last_ok,
// stale job-market handoffs count, an error run proves nothing, a weekend is not a weekday job's stall).
// WORK-WITH-ME-METRIC-1: the work-with-me contacts op reads its own reach_signals rows (stalled after 48h, never ran).
// GRANT-FOLLOWUP-HONEST-1: a grant-followup run that left a mailbox unread is dated as a run and counted with its reason
// (gmail_pass_unset, errors) until a full read; only no run at all reads "never ran".
// WATCHMAKER-RESEARCH-REPO-SYNC-1: the research record sync of qnfo-research-exec reads the updated_at of its ops_config cursor row (never ran, stalled after 2h, fresh).
// BREACH-DOCTOR-WATCHMAKER-1 (agent_issues 1000398): the breach doctor tick of qnfo-fleet-control reads the newest event = 'tick' row of breach_diagnosis_events (fresh, stalled after 2h even while a newer event of another kind exists, not counted before its first due date, never ran after it).
// Run: node qnfo-fleet-dashboard/watchmaker.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
const a = src.indexOf("var WATCHMAKER_AFTER_UTC_HOUR");
const b = src.indexOf("// NO-CLAUDE-RUNTIME-DEPENDENCY-1: the owner's data and workflow live on Cloudflare.");
if (a < 0 || b < a) throw new Error("WATCHMAKER-INDEX-1 block not found in worker.js");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
CREATE TABLE portfolio_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_date TEXT, kind TEXT, created_at TEXT);
CREATE TABLE charter_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT);
CREATE TABLE portfolio_sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, status TEXT);
CREATE TABLE evolve_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT);
CREATE TABLE objective_constraint_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT);
CREATE TABLE improvement_loop_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT);
CREATE TABLE reach_idea_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT);
CREATE TABLE ask_loop_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, version TEXT, kind TEXT NOT NULL, ok INTEGER NOT NULL, note TEXT);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, last_attempt_at TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, verifier TEXT, verified_at TEXT);
CREATE TABLE scheduler_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE cf_changelog_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, status TEXT, items INTEGER, note TEXT);
CREATE TABLE intents (id TEXT PRIMARY KEY, status TEXT, type TEXT, created_at TEXT);
CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT, merged_by TEXT, merged_at TEXT, merge_state TEXT, green_since TEXT, merge_note TEXT, last_error TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE cron_fire_log (cron_name TEXT, task_id TEXT, cron_expr TEXT, fired_at TEXT, fired_epoch_ms INTEGER, outcome TEXT, source TEXT, note TEXT);
CREATE TABLE errata_watch (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE social_channels (channel_id TEXT PRIMARY KEY, service TEXT, name TEXT, connected INTEGER, checked_at TEXT, checked_day TEXT);
CREATE TABLE handoffs (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, project_id TEXT NOT NULL, timestamp TEXT NOT NULL, claim_sheet TEXT);
CREATE TABLE events_radar (slug TEXT PRIMARY KEY, scanned_at TEXT);
CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT, collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));
CREATE TABLE email_reply_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER, sender TEXT, received_at TEXT, decision TEXT, skip_reason TEXT, sent_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT,
  owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT);`);
const NOW = Date.parse("2026-10-06T08:00:00Z");
const ago = (h) => new Date(NOW - h * 36e5).toISOString();
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('portfolio-daily-2026-10-06', ?, 'ok')").run(ago(3));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('portfolio-dailyx', ?, 'ok')").run(ago(1));   // outside the id range
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('reach-ingest-2026-10-06', ?, 'ok')").run(ago(6));
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, status) VALUES ('ga4-ingest-2026-10-06', ?, 'ga4-ingest', 'error')").run(ago(6));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jo-qnfo-backlog-exec-abc', ?, 'ok')").run(ago(7));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-grant-followup-ok1', ?, 'ok')").run(ago(4));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('code-merge-tick-2026-10-06', ?, 'ok')").run(ago(0.5));
db.prepare("INSERT INTO cron_fire_log (task_id, cron_expr, fired_at, outcome) VALUES ('qnfo-gateway', '0 * * * *', ?, 'idle')").run(ago(0.4));   // READER-REPORT-WATCHMAKER-1 (100264): the hourly gateway tick that carries rrSweep
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('probe-review-tick', ?, 'ok')").run(ago(0.2));   // PROBE-REVIEW-WATCHMAKER-1 (#2131): qnfo-cloud-ops probe-review heartbeat
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('branch-hygiene-tick-2026-10-06', ?, 'ok')").run(ago(0.5));
// SECRET-CHANGE-WATCH-1 (qnfo-ops 2.38.39): the */30 heartbeat.
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, job, status) VALUES ('evt-secret-watch-1', ?, 'secret-watch-tick', 'qnfo-ops', 'ok')").run(ago(0.3));
// ERROR-DETAIL-CAPTURE-1 (qnfo-ops 2.38.40): the */30 heartbeat.
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, job, status) VALUES ('evt-error-capture-1', ?, 'error-capture-tick', 'qnfo-ops', 'ok')").run(ago(0.3));
db.prepare("INSERT INTO portfolio_runs (run_date, kind, created_at) VALUES ('2026-10-05', 'identity-weekly', ?)").run(new Date(NOW - 26 * 36e5).toISOString().replace("T", " ").slice(0, 19));
db.prepare("INSERT INTO charter_snapshots (ts) VALUES (?)").run(ago(5));
// WATCHMAKER-TICK-LEDGER-1 (1.29.4): the hourly D1 tick ledger, fresh.
db.exec("CREATE TABLE tick_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, step TEXT)");
db.prepare("INSERT INTO tick_runs (ts, step) VALUES (?, ?)").run(ago(0.5), "probe");
// COMPAT-WATCHMAKER-1 (1.36.1, agent_issues 2412): qnfo-ops compatSnapshot, every 6 hours.
db.exec("CREATE TABLE worker_compat_state (worker TEXT PRIMARY KEY, checked_at TEXT)");
db.prepare("INSERT INTO worker_compat_state (worker, checked_at) VALUES ('qnfo-ops', ?)").run(ago(3));
// FLEET-JOURNEYS-WATCHMAKER-1 (1.37.4, agent_issues 2554): the qnfo-fleet-control journey tick, every 20 minutes.
db.exec("CREATE TABLE journey_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, runner TEXT)");
db.prepare("INSERT INTO journey_runs (ts, runner) VALUES (?, 'cf')").run(ago(0.3));
db.prepare("INSERT INTO portfolio_sync_runs (ts, status) VALUES (?, 'ok')").run(ago(1));
db.prepare("INSERT INTO evolve_candidates (ts) VALUES (?)").run(ago(9));
db.prepare("INSERT INTO objective_constraint_runs (ts) VALUES (?)").run(ago(1));
db.prepare("INSERT INTO improvement_loop_runs (ts) VALUES (?)").run(ago(1));
db.prepare("INSERT INTO reach_idea_runs (ts) VALUES (?)").run(ago(1));
// ASK-LOOP-1 (qnfo-ai-search): an hourly measure row and the daily fix row prove both ask-loop ops; a failed row proves nothing.
db.prepare("INSERT INTO ask_loop_runs (ts, kind, ok) VALUES (?, 'measure', 1)").run(ago(0.3));
db.prepare("INSERT INTO ask_loop_runs (ts, kind, ok) VALUES (?, 'fix', 1)").run(ago(4.3));
db.prepare("INSERT INTO ask_loop_runs (ts, kind, ok) VALUES (?, 'fix', 0)").run(ago(0.1));
// PERFORMANCE-LOOP-1 (1.17.4): the experiment evaluator's daily ledger and the five KPIs it refreshes hourly.
db.exec("CREATE TABLE perf_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, day TEXT, kind TEXT)");
db.prepare("INSERT INTO perf_runs (ts, day, kind) VALUES (?, '2026-10-05', 'experiments')").run(ago(23));
const PERF_KPIS = ["issue_mttr_h_30d", "deploy_failure_rate_7d", "worker_health_failure_rate", "credibility_events_90d", "selected_works_citation_coverage"];
for (const k of PERF_KPIS) db.prepare("INSERT INTO metric_registry (metric, layer, kind, source_of_truth, disposition_actor, refresh_cadence, last_value, last_refreshed, state) VALUES (?, 'operational', 'leading', 's', 'a', 'hourly', 'n/a: unmeasured', ?, 'UNMEASURED')").run(k, ago(0.5));
db.prepare("INSERT INTO remediation_contracts (class, last_attempt_at) VALUES ('EVID-1', ?)").run(new Date(NOW - 2 * 36e5).toISOString().replace("T", " ").slice(0, 19));
const sp = (h) => new Date(NOW - h * 36e5).toISOString().replace("T", " ").slice(0, 19);
db.prepare("INSERT INTO remediation_verifications (verifier, verified_at) VALUES ('remediation-consumer@abc', ?)").run(sp(1));
db.prepare("INSERT INTO remediation_verifications (verifier, verified_at) VALUES ('session-x', ?)").run(sp(0.1));
db.prepare("INSERT INTO scheduler_state (key, value, updated_at) VALUES ('probe_cadence', '{}', ?)").run(sp(0.5));
db.prepare("INSERT INTO cf_changelog_runs (ts, status, items) VALUES (?, 'ok', 60)").run(ago(4));   // CF-CHANGELOG-WATCH-1
db.prepare("INSERT INTO intents (id, status, type, created_at) VALUES ('i1', 'pending', 'research', ?)").run(ago(1));
// errata-hub hourly ticks (#1747): the watchmaker reads $.last_ok, which a failed tick carries forward.
db.prepare("INSERT INTO errata_watch (key, value) VALUES ('tick:errata-watch', ?)").run(JSON.stringify({ ts: ago(0.5), ok: true, last_ok: ago(0.5) }));
db.prepare("INSERT INTO errata_watch (key, value) VALUES ('tick:errata-respond', ?)").run(JSON.stringify({ ts: ago(0.2), ok: false, last_ok: ago(1.2) }));
db.prepare("INSERT INTO errata_watch (key, value) VALUES ('tick:errata-publish', ?)").run(JSON.stringify({ ts: ago(0.1), ok: true, last_ok: ago(0.1) }));
// INBOUND-SLA-1: qnfo-email-orchestrator's */15 step upserts inbound-sla-run-<day> with meta.last_ok.
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, meta, job, status) VALUES ('inbound-sla-run-2026-10-06', ?, 'inbound-sla-run', ?, 'qnfo-email-orchestrator', 'ok')").run(ago(0.2), JSON.stringify({ last_ok: ago(0.2), runs: 30 }));
// REACH-LOOPS-WATCH-1: the delegated identity and reach loops, each fresh against its cadence.
// qnfo-social SOCIAL-RUN-LEDGER-1 rows: one per op per day, meta.last_ok = last completed run.
const socialRow = (op, day, status, lastOkH, tsH) => db.prepare("INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, meta, job, status) VALUES (?, ?, 'social-run', ?, 'qnfo-social', ?)").run("social-" + op + "-" + day, ago(tsH == null ? lastOkH : tsH), JSON.stringify({ op, last_ok: lastOkH == null ? null : ago(lastOkH), runs: 3 }), status);
socialRow("profile-sync", "2026-10-06", "ok", 1);
socialRow("drain", "2026-10-06", "ok", 1.5);
socialRow("scan", "2026-10-06", "ok", 2);
socialRow("engagement", "2026-10-06", "ok", 1);
socialRow("learner-update", "2026-10-05", "ok", 25);   // SOCIAL-DISTRIBUTION-LEARNER-1: Monday's weekly update
db.prepare("INSERT INTO social_channels (channel_id, service, connected, checked_at, checked_day) VALUES ('chL', 'linkedin', 1, ?, '2026-10-06')").run(ago(7));
db.prepare("INSERT INTO metric_registry (metric, layer, kind, source_of_truth, disposition_actor, refresh_cadence, last_value, last_refreshed, state) VALUES ('paper_render_defect_pages', 'product', 'guard', 's', 'a', 'daily', '0', ?, 'ok')").run(ago(2));   // RENDER-HEALTH-1
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-engagement-e1', ?, 'ok')").run(ago(3));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-email-triage-t1', ?, 'ok')").run(ago(20));
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, job, status) VALUES ('mention-radar-2026-10-05', ?, 'mention-radar', 'radar-hub', 'degraded')").run(ago(23.5));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-radar-r1', ?, 'ok')").run(ago(24.5));
// OUTREACH-LEARNER-1: the learner's daily heartbeat and a weekday outreach run with its logged allocation.
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('ol-tick-2026-10-06', ?, 'ok')").run(ago(2.7));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-outreach-o1', '2026-10-05T09:00:40.000Z', 'capped')").run();
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('ol-alloc-2026-10-05-a1', '2026-10-05T09:00:39.000Z', 'ok')").run();
db.prepare("INSERT INTO handoffs (session_id, project_id, timestamp, claim_sheet) VALUES ('cloud-workflow', 'job-market-watch-workflow-2026-10-05', ?, '{}')").run(ago(25));
db.prepare("INSERT INTO handoffs (session_id, project_id, timestamp, claim_sheet) VALUES ('s', 'job-market-watch-2026-10-06', ?, '{}')").run(ago(0.5));   // a session note, outside the id range
db.prepare("INSERT INTO events_radar (slug, scanned_at) VALUES ('events-radar-2026-10-05', ?)").run(ago(27));
// WORK-WITH-ME-METRIC-1: the snapshot rows the reach ingest writes (collected_at in D1's space format).
const wwmAt = (h) => new Date(NOW - h * 36e5).toISOString().replace("T", " ").slice(0, 19);
db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES ('2026-10-05', 'cf-rum', 'web', 'site', '(all)', 'pageviews', 90, 'unknown', ?)").run(wwmAt(1));
db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES ('2026-10-05', 'work-with-me', 'email', 'campaign', 'work-with-me:all', 'inbound_contacts_30d', 0, 'unknown', ?)").run(wwmAt(5.5));
// BREACH-DOCTOR-WATCHMAKER-1 (agent_issues 1000398): qnfo-fleet-control's doctor tick writes one event = 'tick' row to breach_diagnosis_events on every run (live shape: ts as
// strftime('%Y-%m-%dT%H:%M:%SZ'), event CHECK-constrained to a fixed list); a newer row of another event kind must not date the run.
db.exec("CREATE TABLE breach_diagnosis_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, issue_id INTEGER, diagnosis_id INTEGER, event TEXT NOT NULL, from_state TEXT, to_state TEXT, detail TEXT, tick_id TEXT)");
const bdTs = (h) => ago(h).slice(0, 19) + "Z";
db.prepare("INSERT INTO breach_diagnosis_events (ts, event, detail) VALUES (?, 'tick', 'mode=on rules=24 hits=4')").run(bdTs(0.2));
db.prepare("INSERT INTO breach_diagnosis_events (ts, issue_id, event) VALUES (?, 1000001, 'diagnosed')").run(bdTs(0.1));

function stmtOn(sql) {
  let args = [];
  const self = {
    bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; }
  };
  return self;
}
const AUDIT = { prepare: (sql) => stmtOn(sql) };
const cx = vm.createContext({ console, Date, JSON, Math, Number, String, Object, isNaN });
vm.runInContext("var VERSION = 'test'; var DAY_MS = 864e5; function squash(s) { return String(s).replace(/\\s+/g, ' '); }\n" +
  "async function d1all(db, sql, params) { let ps = db.prepare(sql); if (params && params.length) ps = ps.bind.apply(ps, params); const r = await ps.all(); return r.results || []; }\n" +
  src.slice(a, b) + "\n;this.__api = { watchmakerMeasure, watchmakerDaily, wmIso };", cx);
const api = cx.__api;
const env = { AUDIT };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const op = (m, k) => m.ops.find((o) => o.key === k);

{ // WATCHMAKER-TICK-LEDGER-1: a tick ledger with no row for over its cadence counts as stalled; a fresh row clears it
  db.exec("UPDATE tick_runs SET ts = '" + ago(5) + "'");
  const t = op(await api.watchmakerMeasure(env, NOW), "tick-sequence-ledger");
  ok(t && t.counted && t.runner === "d1-trigger:tick_driver_roster_tick", "a tick ledger silent for 5h counts as stalled (" + (t && t.state) + ")");
  db.exec("UPDATE tick_runs SET ts = '" + ago(0.5) + "'");
  const u = op(await api.watchmakerMeasure(env, NOW), "tick-sequence-ledger");
  ok(u && !u.counted && /^ok/.test(u.state), "a fresh tick ledger row is ok (" + (u && u.state) + ")");
}
{ // READER-REPORT-WATCHMAKER-1: the exact hourly gateway tick must fail closed when stale and clear when fresh.
  db.prepare("UPDATE cron_fire_log SET fired_at = ? WHERE task_id = 'qnfo-gateway' AND cron_expr = '0 * * * *'").run(ago(3));
  const stale = op(await api.watchmakerMeasure(env, NOW), "reader-report");
  ok(stale && stale.counted && stale.state === "stalled: last run 3h ago, cadence 1h", "a reader-report sweep silent for 3h counts as stalled");
  db.prepare("UPDATE cron_fire_log SET fired_at = ? WHERE task_id = 'qnfo-gateway' AND cron_expr = '0 * * * *'").run(ago(0.4));
  const fresh = op(await api.watchmakerMeasure(env, NOW), "reader-report");
  ok(fresh && !fresh.counted && /^ok, last run 0.4h ago$/.test(fresh.state), "a fresh reader-report sweep clears the stall");
}
{ // WATCHMAKER-RESEARCH-REPO-SYNC-1: qnfo-research-exec repoSyncTick rewrites ops_config research_repo_sync_cursor each time it advances; that row's updated_at dates the run.
  const wm = (h) => new Date(NOW - h * 36e5).toISOString().slice(0, 19).replace("T", " ");
  const never = op(await api.watchmakerMeasure(env, NOW), "research-repo-sync");
  ok(never && never.counted && never.state === "never ran" && never.runner === "cron:qnfo-research-exec", "a research repo sync whose cursor never moved counts as never ran (" + (never && never.state) + ")");
  db.prepare("INSERT OR REPLACE INTO ops_config (key, value, note, updated_at) VALUES ('research_repo_sync_cursor', 'a-paper-slug', '', ?)").run(wm(3));
  const stale = op(await api.watchmakerMeasure(env, NOW), "research-repo-sync");
  ok(stale && stale.counted && stale.state === "stalled: last run 3h ago, cadence 1h", "a research repo sync silent for 3h counts as stalled (" + (stale && stale.state) + ")");
  db.prepare("UPDATE ops_config SET updated_at = ? WHERE key = 'research_repo_sync_cursor'").run(wm(0.4));
  const fresh = op(await api.watchmakerMeasure(env, NOW), "research-repo-sync");
  ok(fresh && !fresh.counted && /^ok, last run 0.4h ago$/.test(fresh.state), "a research repo sync that advanced 24 minutes ago is ok (" + (fresh && fresh.state) + ")");
}
{ // BREACH-DOCTOR-WATCHMAKER-1 (agent_issues 1000398): the doctor tick dates its own run through breach_diagnosis_events; only event = 'tick' rows count.
  const bd = async (now) => op(await api.watchmakerMeasure(env, now || NOW), "breach-doctor");
  const fresh = await bd();
  ok(fresh && !fresh.counted && fresh.runner === "cron:qnfo-fleet-control" && /^ok, last run 0.2h ago$/.test(fresh.state), "a doctor tick 12 minutes ago is ok, run by qnfo-fleet-control (" + (fresh && fresh.state) + ")");
  db.exec("UPDATE breach_diagnosis_events SET ts = '" + bdTs(3) + "' WHERE event = 'tick'");
  const stale = await bd();
  ok(stale && stale.counted && stale.state === "stalled: last run 3h ago, cadence 1h", "a doctor tick silent for 3h counts as stalled, although a newer diagnosed event exists (" + (stale && stale.state) + ")");
  db.exec("DELETE FROM breach_diagnosis_events WHERE event = 'tick'");
  const before = await bd();
  ok(before && !before.counted && before.state === "first run due 2026-10-27T00:00:00Z", "with no tick row before the first due date the op is not counted (" + (before && before.state) + ")");
  const after = await bd(Date.parse("2026-10-27T01:00:00Z"));
  ok(after && after.counted && after.state === "never ran", "with no tick row after the first due date it counts as never ran: a diagnosed event does not prove the tick (" + (after && after.state) + ")");
  db.prepare("INSERT INTO breach_diagnosis_events (ts, event, detail) VALUES (?, 'tick', 'mode=on rules=24 hits=4')").run(bdTs(0.2));
  ok(!(await bd()).counted, "a fresh tick row clears the op again");
}
let m = await api.watchmakerMeasure(env, NOW);
{ const ce = op(m, "compat-exposure"); ok(ce && !ce.counted && ce.runner === "cron:qnfo-ops", "compat-exposure is listed, run by qnfo-ops, not counted when fresh (COMPAT-WATCHMAKER-1, " + (ce && ce.state) + ")"); }
ok(m.index === 0 && m.counted.length === 0, "a fully fresh fleet reads 0 (got " + m.index + ": " + m.counted.join(",") + ")");
ok(op(m, "portfolio-daily").state.startsWith("ok") && op(m, "portfolio-daily").age_h === 3, "the id range picks the real portfolio-daily row");
ok(op(m, "identity-weekly").state.startsWith("ok") && op(m, "time-gated-verification").state.startsWith("ok"), "space-format timestamps are read as UTC");
ok(!op(m, "linkedin-draft-approval").counted && /by policy/.test(op(m, "linkedin-draft-approval").state), "by-policy owner approvals are listed, not counted");
ok(!op(m, "code-task-merge").counted && op(m, "code-task-merge").runner === "cron:qnfo-fleet-control" && /^ok, last run 0.5h ago$/.test(op(m, "code-task-merge").state), "a fresh merge-runner heartbeat with nothing for a person: not counted");
ok(!op(m, "branch-hygiene").counted && op(m, "branch-hygiene").runner === "cron:qnfo-fleet-control", "a fresh branch-sweeper heartbeat: not counted (BRANCH-HYGIENE-1)");
ok(!op(m, "cf-changelog").counted && op(m, "cf-changelog").runner === "cron:qnfo-fleet-control" && op(m, "cf-changelog").age_h === 4, "a changelog run 4h ago: listed, not counted (CF-CHANGELOG-WATCH-1)");
{
  // a changelog audit whose last ok run is over 2 days old counts as stalled; a later error run does not prove it ran
  db.prepare("UPDATE cf_changelog_runs SET ts = ?").run(ago(50));
  db.prepare("INSERT INTO cf_changelog_runs (ts, status, items) VALUES (?, 'error', 0)").run(ago(1));
  const s = op(await api.watchmakerMeasure(env, NOW), "cf-changelog");
  ok(s.counted && /stalled/.test(s.state), "a changelog audit with no ok run for 50h counts as stalled (" + s.state + ")");
  db.prepare("DELETE FROM cf_changelog_runs WHERE status = 'error'").run();
  db.prepare("UPDATE cf_changelog_runs SET ts = ?").run(ago(4));
}
{
  // IDEA-TOPIC-METRIC-1: listed and not counted before its first due date; after it, no ok run counts, a fresh ok run clears it
  const it = (t) => op(m, "idea-topic-metric");
  ok(!it().counted && it().runner === "cron:qnfo-cloud-ops", "idea-topic-metric is listed and not counted before 2026-10-07 (" + it().state + ")");
  const LATER = Date.parse("2026-10-08T08:00:00Z");
  let s = op(await api.watchmakerMeasure(env, LATER), "idea-topic-metric");
  ok(s.counted, "after its first due date a missing run counts (" + s.state + ")");
  db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, job, status) VALUES ('jr-idea-topic-metric-t1', ?, 'job-run', 'idea-topic-metric', 'ok')").run(new Date(LATER - 3 * 36e5).toISOString());
  s = op(await api.watchmakerMeasure(env, LATER), "idea-topic-metric");
  ok(!s.counted && /^ok/.test(s.state), "a 3h-old ok run is fresh (" + s.state + ")");
  db.prepare("DELETE FROM cloud_ops_events WHERE id = 'jr-idea-topic-metric-t1'").run();
}
// CODE-TASK-MERGE-RUNNER-1: the runner merges; what a person still did or must do counts. The runner's first ok tick
// (code-merge-first-ok, written once) was 5 days ago: a person merge before it is history, not a dependency.
const cm = async () => op(await api.watchmakerMeasure(env, NOW), "code-task-merge");
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('code-merge-first-ok', ?, 'ok')").run(ago(5 * 24));
db.prepare("INSERT INTO code_tasks (id, status, updated_at, merged_by, merge_state) VALUES ('cm0', 'merged', ?, 'qnfo-fleet-control', 'verified')").run(ago(10));
let c = await cm();
ok(!c.counted && /\(by_runner 1\)$/.test(c.state), "a PR the runner merged is not person work", c.state);
db.prepare("INSERT INTO code_tasks (id, status, updated_at) VALUES ('cm1', 'merged', ?)").run(ago(10));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "code-task-merge").counted && /^1 code-loop PRs or tasks that needed a person \(by_person 1, by_runner 1\)$/.test(op(m, "code-task-merge").state) && m.index === 1, "a code-loop PR merged outside the runner (merged_by empty) in the last 30 days counts", op(m, "code-task-merge").state);
db.exec("UPDATE code_tasks SET merged_by = 'gh:rwnq8' WHERE id = 'cm1'");
ok((await cm()).counted, "a PR merged by a person's GitHub login counts");
// WATCHMAKER-BY-PERSON-PRECISION-1 (agent_issues 1726): a closed task counts only when a person or session closed it.
db.exec("UPDATE code_tasks SET status = 'closed', merged_by = NULL, merge_note = 'stale base: the branch is behind main and the rebase conflicted' WHERE id = 'cm1'");
ok(!(await cm()).counted, "a task the runner closed itself (stale base) is the loop deciding, not person work");
db.exec("UPDATE code_tasks SET merge_note = 'required checks failed' WHERE id = 'cm1'");
ok(!(await cm()).counted, "a task the runner closed on failed checks is not person work");
db.exec("UPDATE code_tasks SET merge_note = NULL, last_error = 'Closed by session 01ABC: the change landed by PR 715' WHERE id = 'cm1'");
ok((await cm()).counted, "a code-loop task a session closed in the last 30 days counts");
db.exec("UPDATE code_tasks SET last_error = NULL, merge_note = 'superseded: the fix is already on main' WHERE id = 'cm1'");
ok((await cm()).counted, "a code-loop task closed because a person landed the change on main counts");
db.prepare("UPDATE code_tasks SET status = 'merged', updated_at = ? WHERE id = 'cm1'").run(ago(6 * 24));
c = await cm();
ok(!c.counted && !/by_person/.test(c.state), "a person merge from before the runner's first ok tick is not counted", c.state);
db.prepare("UPDATE code_tasks SET updated_at = ?, merged_at = ? WHERE id = 'cm1'").run(ago(1), ago(6 * 24));
ok(!(await cm()).counted, "the merge time decides (merged_at before the runner existed, recorded later), not when it was recorded");
db.prepare("UPDATE code_tasks SET merged_at = ? WHERE id = 'cm1'").run(ago(4 * 24));
ok((await cm()).counted, "a person merge after the runner's first ok tick counts");
db.prepare("UPDATE code_tasks SET status = 'closed', merged_at = NULL, updated_at = ? WHERE id = 'cm1'").run(ago(6 * 24));
ok(!(await cm()).counted, "a person close from before the runner existed is not counted");
db.exec("DELETE FROM cloud_ops_events WHERE id = 'code-merge-first-ok'");
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('code-merge-tick-2026-09-29', ?, 'ok')").run(ago(7 * 24));
db.prepare("UPDATE code_tasks SET updated_at = ? WHERE id = 'cm1'").run(ago(6 * 24));
ok((await cm()).counted, "without the marker the earliest ok day row is the runner's start (a close after it counts)");
db.exec("DELETE FROM cloud_ops_events WHERE id = 'code-merge-tick-2026-09-29'");
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('code-merge-first-ok', ?, 'ok')").run(ago(5 * 24));
db.prepare("UPDATE code_tasks SET status = 'merged', updated_at = ? WHERE id = 'cm1'").run(ago(31 * 24));
ok(!(await cm()).counted, "a person merge older than 30 days no longer counts");
db.prepare("INSERT INTO code_tasks (id, status, updated_at, green_since) VALUES ('cm2', 'published', ?, ?)").run(ago(1.5), ago(1.5));
ok(!(await cm()).counted, "a PR green for 90 min is still the runner's to merge");
db.prepare("UPDATE code_tasks SET green_since = ? WHERE id = 'cm2'").run(ago(2.5));
c = await cm();
ok(c.counted && /\(stuck_prs 1/.test(c.state), "a PR green for more than 120 min and unmerged counts as stuck", c.state);
db.prepare("UPDATE code_tasks SET green_since = NULL, updated_at = ? WHERE id = 'cm2'").run(ago(3));
ok((await cm()).counted, "a PR waiting more than 120 min (checks never green) counts as stuck");
db.prepare("UPDATE code_tasks SET status = 'pr_open', updated_at = ? WHERE id = 'cm2'").run(ago(1));
ok(!(await cm()).counted, "a fresh pr_open row (code-agent path) is the runner's to merge");
db.prepare("INSERT INTO code_tasks (id, status, updated_at) VALUES ('cm3', 'needs_human', ?)").run(ago(40 * 24));
c = await cm();
ok(c.counted && /needs_person 1/.test(c.state), "a code task in needs_human counts at any age (a refused PR or an unverifiable task)", c.state);
db.prepare("UPDATE code_tasks SET status = 'branch_pushed', updated_at = ? WHERE id = 'cm3'").run(ago(1));
ok(!(await cm()).counted, "a freshly pushed branch is the runner's to open as a PR (not counted)");
db.prepare("UPDATE code_tasks SET updated_at = ? WHERE id = 'cm3'").run(ago(7));
c = await cm();
ok(c.counted && /needs_person 1/.test(c.state), "a pushed branch with no PR after 6h counts", c.state);
db.prepare("UPDATE code_tasks SET status = 'merged', merged_by = 'qnfo-fleet-control', merge_state = 'revert-failed', updated_at = ? WHERE id = 'cm3'").run(ago(3));
c = await cm();
ok(c.counted && /revert_failed 1/.test(c.state), "a failed automatic revert counts", c.state);
db.exec("DELETE FROM code_tasks");
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'code-merge-tick-2026-10-06'").run(ago(3));
c = await cm();
ok(c.counted && /^stalled: last run 3h ago, cadence 1h$/.test(c.state), "a runner silent for more than 2h counts as stalled", c.state);
db.prepare("UPDATE cloud_ops_events SET ts = ?, status = 'disabled' WHERE id = 'code-merge-tick-2026-10-06'").run(ago(0.2));
c = await cm();
ok(c.counted && /^runner disabled; never ran$/.test(c.state), "the kill switch off: counted, and the state says the runner is disabled", c.state);
db.prepare("UPDATE cloud_ops_events SET ts = ?, status = 'ok' WHERE id = 'code-merge-tick-2026-10-06'").run(ago(0.5));
db.exec("ALTER TABLE code_tasks RENAME TO code_tasks_full; CREATE TABLE code_tasks (id TEXT PRIMARY KEY, status TEXT, updated_at TEXT)");
c = await cm();
ok(c.counted && /^unmeasured/.test(c.state), "before the runner adds its columns the op is unmeasured, so counted", c.state);
db.exec("DROP TABLE code_tasks; ALTER TABLE code_tasks_full RENAME TO code_tasks");
ok(!(await cm()).counted, "back to a healthy runner with nothing for a person");
// EVOLVE-HEARTBEAT-1: an idle evolve loop (no proposal for days) is alive while its daily heartbeat is fresh; a heartbeat
// that is not 'ok' proves nothing, and with neither the runner counts as stalled.
db.prepare("UPDATE evolve_candidates SET ts = ?").run(ago(70));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('evolve-tick-2026-10-06', ?, 'ok')").run(ago(1));
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('evolve-tickx', ?, 'ok')").run(ago(0));   // outside the id range
m = await api.watchmakerMeasure(env, NOW);
ok(!op(m, "fleet-defects").counted && op(m, "fleet-defects").age_h === 1, "an idle evolve loop with a fresh heartbeat is ok, not stalled");
db.exec("UPDATE cloud_ops_events SET status = 'error' WHERE id = 'evolve-tick-2026-10-06'");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "fleet-defects").counted && /stalled: last run 70h ago/.test(op(m, "fleet-defects").state) && m.index === 1, "no proposal and no ok heartbeat in 48h: the evolve loop counts as stalled");
db.exec("DELETE FROM cloud_ops_events WHERE id IN ('evolve-tick-2026-10-06', 'evolve-tickx')");
db.prepare("UPDATE evolve_candidates SET ts = ?").run(ago(9));
ok(m.retired.length === 4, "retired claude.ai Routines are listed with what replaced them");
ok(!op(m, "q08-review").counted && op(m, "q08-review").state === "no backlog", "the one-shot q08 review is not counted before it is 48h overdue (Q08-REVIEW-2026-10-31)");
ok(op(m, "errata-watch").state.startsWith("ok") && op(m, "errata-respond").age_h === 1.2 && !op(m, "errata-publish").counted, "errata-hub ticks are read from errata_watch $.last_ok");
db.prepare("UPDATE errata_watch SET value = ? WHERE key = 'tick:errata-respond'").run(JSON.stringify({ ts: ago(0.2), ok: false, last_ok: ago(3) }));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "errata-respond").counted && /stalled: last run 3h ago, cadence 1h/.test(op(m, "errata-respond").state) && m.index === 1, "an errata member with no successful tick for over 2h counts as stalled");
db.prepare("UPDATE errata_watch SET value = ? WHERE key = 'tick:errata-respond'").run(JSON.stringify({ ts: ago(0.2), ok: true, last_ok: ago(0.2) }));
// SECRET-CHANGE-WATCH-1: an error tick does not prove the run; no ok heartbeat for over 2h counts the watcher as stalled.
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'evt-secret-watch-1'").run(ago(3));
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, job, status) VALUES ('evt-secret-watch-err', ?, 'secret-watch-tick', 'qnfo-ops', 'error')").run(ago(0.1));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "secret-change-watch").counted && /stalled: last run 3h ago, cadence 1h/.test(op(m, "secret-change-watch").state) && op(m, "secret-change-watch").runner === "cron:qnfo-ops" && m.index === 1, "a secret watcher with no ok heartbeat for over 2h counts as stalled (an error tick does not prove it)");
db.exec("DELETE FROM cloud_ops_events WHERE id = 'evt-secret-watch-err'");
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'evt-secret-watch-1'").run(ago(0.3));
// ERROR-DETAIL-CAPTURE-1: a refused telemetry query writes an error tick, which does not prove the run.
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'evt-error-capture-1'").run(ago(3));
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, job, status) VALUES ('evt-error-capture-err', ?, 'error-capture-tick', 'qnfo-ops', 'error')").run(ago(0.1));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "error-detail-capture").counted && /stalled: last run 3h ago, cadence 1h/.test(op(m, "error-detail-capture").state) && op(m, "error-detail-capture").runner === "cron:qnfo-ops" && m.index === 1, "an error capture with no ok heartbeat for over 2h counts as stalled (a refused query does not prove it)");
db.exec("DELETE FROM cloud_ops_events WHERE id = 'evt-error-capture-err'");
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'evt-error-capture-1'").run(ago(0.3));
ok(op(m, "objective-constraints").state.startsWith("ok") && op(m, "objective-constraints").runner === "cron:qnfo-fleet-control", "OBJECTIVE-CONSTRAINTS-1 is listed with its hourly kernel ledger");

// PERFORMANCE-LOOP-1: the experiment evaluator (daily perf_runs row) and its five hourly KPIs (MIN(last_refreshed)).
m = await api.watchmakerMeasure(env, NOW);
ok(m.index === 0 && op(m, "performance-experiments").state === "ok, last run 23h ago" && op(m, "performance-metrics").state === "ok, last run 0.5h ago" && op(m, "performance-experiments").runner === "cron:qnfo-fleet-control", "PERFORMANCE-LOOP-1: the evaluator and the KPIs read fresh (an unmeasured KPI still proves its run)");
db.prepare("UPDATE perf_runs SET ts = ?").run(ago(49));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "performance-experiments").counted && /stalled: last run 49h ago, cadence 24h/.test(op(m, "performance-experiments").state) && m.index === 1, "an evaluator with no ledger row for over 48h counts as stalled");
db.prepare("UPDATE perf_runs SET ts = ?").run(ago(23));
db.prepare("UPDATE metric_registry SET last_refreshed = ? WHERE metric = 'credibility_events_90d'").run(ago(3));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "performance-metrics").counted && /stalled: last run 3h ago, cadence 1h/.test(op(m, "performance-metrics").state) && m.index === 1, "one of the five KPIs not refreshed for over 2h stalls the op (the stalest decides)");
db.prepare("UPDATE metric_registry SET last_refreshed = ? WHERE metric = 'credibility_events_90d'").run(ago(0.5));
db.exec("DELETE FROM perf_runs");
m = await api.watchmakerMeasure(env, NOW);
ok(!op(m, "performance-experiments").counted && /^first run due 2026-10-06T12:00/.test(op(m, "performance-experiments").state), "before its first due date a never-run evaluator is not counted");
m = await api.watchmakerMeasure(env, Date.parse("2026-10-06T13:00:00Z"));
ok(op(m, "performance-experiments").counted && op(m, "performance-experiments").state === "never ran", "after its first due date a never-run evaluator counts");
db.prepare("INSERT INTO perf_runs (ts, day, kind) VALUES (?, '2026-10-05', 'experiments')").run(ago(23));

db.prepare("INSERT INTO intents (id, status, type, created_at) VALUES ('t1', 'pending', 'task', ?)").run(ago(1));
m = await api.watchmakerMeasure(env, NOW);
ok(!op(m, "task-intent-intake").counted, "a fresh task intent is not yet counted");
db.prepare("INSERT INTO intents (id, status, type, created_at) VALUES ('t2', 'pending', 'task', ?)").run(ago(100));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "task-intent-intake").counted && /^1 pending task intents older than 120 min with no consumer/.test(op(m, "task-intent-intake").state) && m.index === 1, "task intents nobody reads count once 120 min old");
db.exec("DELETE FROM intents WHERE id IN ('t1', 't2')");

// GRANT-FOLLOWUP-1: only a run that read both mailboxes clears the op; a 'degraded' run (no GMAIL_PASS) does not.
// GRANT-FOLLOWUP-HONEST-1 (1.18.6): such a run is a run, so the state says why the op counts instead of "never ran".
// The row is what qnfo-cloud-ops 1.18.3 writes (meta.reason, JOB-REASON-1); 1.18.2's rows carry the reason only in text.
const gfRow = (id, h, status, meta, text) => db.prepare("INSERT OR REPLACE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?, ?, 'job-run', ?, ?, 'grant-followup', ?)").run(id, ago(h), text || "grant-followup " + status, meta ? JSON.stringify(meta) : null, status);
gfRow("jr-grant-followup-ok1", 16, "ok", { job: "grant-followup", status: "ok" });
gfRow("jr-grant-followup-d1", 4, "degraded", { job: "grant-followup", status: "degraded", reason: "Gmail not read: the GMAIL_PASS secret is unset" }, 'grant-followup degraded {"channels":{"qnfo_email":"ok:0","gmail":"no-credential: GMAIL_PASS unset"}}');
m = await api.watchmakerMeasure(env, NOW);
let gf = op(m, "grant-followup");
ok(gf.counted && gf.age_h === 4 && gf.state === "1 grant-followup runs since the last full read that left a mailbox unread (gmail_pass_unset 1)" && m.index === 1, "a run that missed Gmail is dated as a run and counted with its reason (" + gf.state + ")");
gfRow("jr-grant-followup-d0", 10, "degraded", { job: "grant-followup", status: "degraded" }, 'grant-followup degraded {"channels":{"qnfo_email":"ok:0","gmail":"no-credential: GMAIL_PASS unset"}}');
gfRow("jr-grant-followup-e1", 8, "error", { job: "grant-followup", status: "error" }, "grant-followup error D1_ERROR: no such table: emails");
m = await api.watchmakerMeasure(env, NOW);
gf = op(m, "grant-followup");
ok(gf.counted && /^3 grant-followup runs since the last full read that left a mailbox unread \(gmail_pass_unset 2, errors 1\)$/.test(gf.state), "every run since the last full read counts, the reason read from meta or text (" + gf.state + ")");
db.exec("DELETE FROM cloud_ops_events WHERE id LIKE 'jr-grant-followup-%'");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "grant-followup").counted && op(m, "grant-followup").state === "never ran", "no run at all still reads never ran");
gfRow("jr-grant-followup-d1", 25, "degraded", { job: "grant-followup", status: "degraded", reason: "Gmail not read: the GMAIL_PASS secret is unset" });
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "grant-followup").counted && op(m, "grant-followup").state === "runner degraded; stalled: last run 25h ago, cadence 12h", "a runner silent for over 24h counts as stalled, with its last status (" + op(m, "grant-followup").state + ")");
db.exec("DELETE FROM cloud_ops_events WHERE id LIKE 'jr-grant-followup-%'");
gfRow("jr-grant-followup-d1", 16, "degraded", { job: "grant-followup", status: "degraded", reason: "Gmail not read: the GMAIL_PASS secret is unset" });
gfRow("jr-grant-followup-ok1", 4, "ok", { job: "grant-followup", status: "ok" });
m = await api.watchmakerMeasure(env, NOW);
ok(!op(m, "grant-followup").counted && /^ok, last run 4h ago$/.test(op(m, "grant-followup").state) && m.index === 0, "a fresh full grant-followup run clears the op, earlier degraded runs included");

// REACH-LOOPS-WATCH-1: the delegated identity and reach loops.
const REACH = ["social-profile-sync", "social-posting", "social-scan", "buffer-channel-audit", "social-engagement", "social-learner", "engagement-feed", "email-triage", "mention-radar", "cloud-ops-radar", "job-market-watch", "events-radar"];
m = await api.watchmakerMeasure(env, NOW);
ok(REACH.every((k) => op(m, k) && op(m, k).state.startsWith("ok")) && m.index === 0, "every reach loop is listed and reads fresh (" + REACH.filter((k) => !op(m, k) || !op(m, k).state.startsWith("ok")).join(",") + ")");
ok(op(m, "social-posting").runner === "cron:qnfo-social" && op(m, "job-market-watch").runner === "cron:radar-hub", "each loop names its Cloudflare runner");
ok(op(m, "job-market-watch").age_h === 25, "job-market reads the handoffs id range (not a session note)");
// A failed tick after a good one: status error, but meta.last_ok still proves the last completed run.
socialRow("profile-sync", "2026-10-06", "error", 1, 0.2);
m = await api.watchmakerMeasure(env, NOW);
ok(!op(m, "social-profile-sync").counted && op(m, "social-profile-sync").age_h === 1, "a failed profile-sync tick does not hide the last good one (meta.last_ok)");
// A day of failures only: last_ok null on today's row, yesterday's row still answers.
socialRow("profile-sync", "2026-10-06", "error", null, 0.2);
socialRow("profile-sync", "2026-10-05", "ok", 20);
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "social-profile-sync").counted && /stalled: last run 20h ago, cadence 2h/.test(op(m, "social-profile-sync").state), "a profile sync failing all day counts as stalled from its last completed run");
db.exec("DELETE FROM cloud_ops_events WHERE id LIKE 'social-profile-sync-%'");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "social-profile-sync").counted && op(m, "social-profile-sync").state === "never ran", "a social op with no ledger row past its first due date counts");
const early2 = await api.watchmakerMeasure(env, Date.parse("2026-10-03T08:00:00Z"));
ok(!op(early2, "social-profile-sync").counted && /^first run due 2026-10-03T12:00/.test(op(early2, "social-profile-sync").state), "before the ledger's first due date it is not counted");
socialRow("profile-sync", "2026-10-06", "ok", 1);
// SOCIAL-DISTRIBUTION-LEARNER-1: a weekly op; 'skipped' (learner switched off) carries no last_ok and proves nothing.
ok(op(m, "social-learner").runner === "cron:qnfo-social" && op(m, "social-learner").age_h === 25 && !op(m, "social-learner").counted, "the learner's weekly update reads its ledger row by meta.last_ok");
socialRow("learner-update", "2026-10-05", "ok", 340);
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "social-learner").counted && /stalled: last run 340h ago, cadence 168h/.test(op(m, "social-learner").state), "a learner update silent for over two weeks counts as stalled");
db.exec("DELETE FROM cloud_ops_events WHERE id LIKE 'social-learner-update-%'");
socialRow("learner-update", "2026-10-05", "skipped", null, 25);
m = await api.watchmakerMeasure(env, Date.parse("2026-10-14T08:00:00Z"));
ok(op(m, "social-learner").counted && op(m, "social-learner").state === "never ran", "a learner that only ever recorded 'skipped' (switched off) counts once its first run is due");
ok(!op(await api.watchmakerMeasure(env, NOW), "social-learner").counted && /^first run due 2026-10-13T12:00/.test(op(await api.watchmakerMeasure(env, NOW), "social-learner").state), "before its first due date it is not counted");
socialRow("learner-update", "2026-10-05", "ok", 25);
// Mention radar: an error run proves nothing; degraded (a source refused) is a run.
db.exec("UPDATE cloud_ops_events SET status = 'error' WHERE id = 'mention-radar-2026-10-05'");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "mention-radar").counted && op(m, "mention-radar").state === "never ran", "a mention-radar run whose every source failed does not prove the radar");
db.exec("UPDATE cloud_ops_events SET status = 'degraded' WHERE id = 'mention-radar-2026-10-05'");
// Stale data: the job market silent since 2026-09-08 counts.
db.exec("UPDATE handoffs SET timestamp = '2026-09-08T09:31:27.810Z' WHERE project_id = 'job-market-watch-workflow-2026-10-05'");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "job-market-watch").counted && /cadence 168h/.test(op(m, "job-market-watch").state) && m.index === 1, "the job market silent since 2026-09-08 counts as stalled");
db.prepare("UPDATE handoffs SET timestamp = ? WHERE project_id = 'job-market-watch-workflow-2026-10-05'").run(ago(25));
// Weekday-only jobs: the weekend is not a stall, a missed Monday is.
const MON = Date.parse("2026-10-05T07:05:00Z");
db.prepare("UPDATE cloud_ops_events SET ts = '2026-10-02T07:30:02.000Z' WHERE id = 'jr-radar-r1'").run();
db.prepare("UPDATE cloud_ops_events SET ts = '2026-10-02T12:00:20.000Z' WHERE id = 'jr-email-triage-t1'").run();
let wk = await api.watchmakerMeasure(env, MON);
ok(!op(wk, "cloud-ops-radar").counted && !op(wk, "email-triage").counted, "Friday to Monday morning is not a stall for the weekday radar and triage");
wk = await api.watchmakerMeasure(env, Date.parse("2026-10-06T13:00:00Z"));
ok(op(wk, "cloud-ops-radar").counted && op(wk, "email-triage").counted, "no weekday run since Friday by Tuesday afternoon counts for both");
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'jr-radar-r1'").run(ago(24.5));
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'jr-email-triage-t1'").run(ago(20));
// EMAIL-TRIAGE-D1-1: the 2026-09-30..10-01 'unauthorized' runs are errors and do not prove the triage.
db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-email-triage-unauth', ?, 'error')").run(ago(0.5));
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'jr-email-triage-t1'").run(ago(80));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "email-triage").counted && op(m, "email-triage").age_h === 80, "an error triage run (EMAIL_API_KEY 'unauthorized') does not prove the triage");
db.exec("DELETE FROM cloud_ops_events WHERE id = 'jr-email-triage-unauth'");
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'jr-email-triage-t1'").run(ago(20));
m = await api.watchmakerMeasure(env, NOW);
// WORK-WITH-ME-METRIC-1: proved by its own reach_signals rows (source 'work-with-me'), not by the ingest's event row.
ok(!op(m, "work-with-me-contacts").counted && op(m, "work-with-me-contacts").age_h === 5.5 && op(m, "work-with-me-contacts").runner === "cron:qnfo-fleet-dashboard", "work-with-me contacts read their snapshot row (space-format UTC)");
db.prepare("UPDATE reach_signals SET collected_at = ? WHERE source = 'work-with-me'").run(wwmAt(50));
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "work-with-me-contacts").counted && /stalled: last run 50h ago, cadence 24h/.test(op(m, "work-with-me-contacts").state) && m.index === 1, "work-with-me rows older than 48h count as stalled (fresh cf-rum rows do not prove them)");
db.exec("DELETE FROM reach_signals WHERE source = 'work-with-me'");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "work-with-me-contacts").counted && op(m, "work-with-me-contacts").state === "never ran", "no work-with-me rows past the first due date counts");
ok(!op(await api.watchmakerMeasure(env, Date.parse("2026-10-04T08:00:00Z")), "work-with-me-contacts").counted, "before its first due date it is not counted");
db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality, collected_at) VALUES ('2026-10-05', 'work-with-me', 'email', 'campaign', 'work-with-me:all', 'inbound_contacts_30d', 0, 'unknown', ?)").run(wwmAt(5.5));
m = await api.watchmakerMeasure(env, NOW);
ok(m.index === 0, "the fixture is fresh again before the stall checks (" + m.counted.join(",") + ")");

// INBOUND-SLA-1: counted when the runner is stalled or disabled, or a human inbound message waits over 72h with no action.
const sla = async () => op(await api.watchmakerMeasure(env, NOW), "inbound-sla");
let sl = await sla();
ok(!sl.counted && sl.runner === "cron:qnfo-email-orchestrator" && /^ok, last run 0.2h ago$/.test(sl.state), "a fresh inbound-SLA runner with nothing waiting is not counted", sl.state);
db.prepare("INSERT INTO email_reply_queue (email_id, sender, received_at, decision, skip_reason) VALUES (1, 'a@x.example', ?, 'escalate', 'awaiting authored draft')").run(ago(1.8));
ok(!(await sla()).counted, "a human message 110 min old is still inside the SLA");
db.prepare("UPDATE email_reply_queue SET received_at = ? WHERE id = 1").run(ago(2.2));
sl = await sla();
ok(sl.counted && /^1 human inbound messages older than 120 min with no fleet action$/.test(sl.state), "a human message older than 120 min with no fleet action counts", sl.state);
m = await api.watchmakerMeasure(env, NOW);
ok(m.index === 1 && m.counted[0] === "inbound-sla", "and it is the only counted op");
db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, meta, status) VALUES ('inbound-sla-q-1', ?, 'inbound-sla-decision', '{}', 'held')").run(ago(1));
ok(!(await sla()).counted, "an INBOUND-SLA-1 decision row is a fleet action");
db.exec("DELETE FROM cloud_ops_events WHERE id = 'inbound-sla-q-1'");
db.prepare("UPDATE email_reply_queue SET sent_at = ? WHERE id = 1").run(ago(2).slice(0, 19).replace("T", " "));
ok(!(await sla()).counted, "a row with sent_at is answered");
db.exec("UPDATE email_reply_queue SET sent_at = NULL, decision = 'pending', skip_reason = 'db-trigger: machine/marketing sender terminalized on first touch'");
ok(!(await sla()).counted, "a machine sender terminalised by the DB trigger is not human inbound");
db.exec("DELETE FROM email_reply_queue");
db.prepare("UPDATE cloud_ops_events SET meta = ? WHERE id = 'inbound-sla-run-2026-10-06'").run(JSON.stringify({ last_ok: ago(3), runs: 31 }));
sl = await sla();
ok(sl.counted && /^stalled: last run 3h ago, cadence 1h$/.test(sl.state), "an inbound-SLA runner silent for over 2h counts as stalled", sl.state);
db.prepare("UPDATE cloud_ops_events SET ts = ?, status = 'disabled' WHERE id = 'inbound-sla-run-2026-10-06'").run(ago(0.1));
sl = await sla();
ok(sl.counted && /^runner disabled; stalled/.test(sl.state), "the inbound_sla_enabled kill switch off: counted, and the state says the runner is disabled", sl.state);
db.prepare("UPDATE cloud_ops_events SET ts = ?, status = 'ok', meta = ? WHERE id = 'inbound-sla-run-2026-10-06'").run(ago(0.2), JSON.stringify({ last_ok: ago(0.2), runs: 32 }));
db.exec("ALTER TABLE cloud_ops_events RENAME TO coe_full; CREATE TABLE cloud_ops_events AS SELECT * FROM coe_full WHERE id NOT LIKE 'inbound-sla-run-%'");
const earlySla = op(await api.watchmakerMeasure(env, Date.parse("2026-10-04T08:00:00Z")), "inbound-sla");
ok(!earlySla.counted && /^first run due 2026-10-05/.test(earlySla.state), "with no ledger before its first due date the op is not counted", earlySla.state);
ok((await sla()).counted && (await sla()).state === "never ran", "with no ledger after its first due date the op counts as never ran");
db.exec("DROP TABLE cloud_ops_events; ALTER TABLE coe_full RENAME TO cloud_ops_events");
m = await api.watchmakerMeasure(env, NOW);
ok(m.index === 0, "fresh again after the inbound-SLA checks (" + m.counted.join(",") + ")");
// OUTREACH-LEARNER-1: the daily update step and the allocation inside each outreach run.
{
  const ol = async (now) => op(await api.watchmakerMeasure(env, now || NOW), "outreach-learner");
  let o = await ol();
  ok(o && !o.counted && o.runner === "cron:qnfo-cloud-ops" && /^ok, last run 2.7h ago$/.test(o.state), "a fresh learner tick with every outreach run's allocation logged is not counted (" + (o && o.state) + ")");
  db.exec("UPDATE cloud_ops_events SET status = 'degraded' WHERE id = 'ol-tick-2026-10-06'");
  ok(!(await ol()).counted, "a degraded tick (a metric row refused) still proves the learner ran");
  db.exec("UPDATE cloud_ops_events SET status = 'error' WHERE id = 'ol-tick-2026-10-06'");
  o = await ol();
  ok(!o.counted && /^first run due 2026-10-06T12:00/.test(o.state), "before its first due time a learner with no ok tick is not counted");
  o = await ol(Date.parse("2026-10-06T13:00:00Z"));
  ok(o.counted && o.state === "never ran", "an error tick proves nothing once the first run is due");
  db.prepare("UPDATE cloud_ops_events SET status = 'ok', ts = ? WHERE id = 'ol-tick-2026-10-06'").run(ago(50));
  o = await ol();
  ok(o.counted && /stalled: last run 50h ago, cadence 24h/.test(o.state), "a learner silent for over 48h counts as stalled");
  db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'ol-tick-2026-10-06'").run(ago(2.7));
  db.prepare("INSERT INTO cloud_ops_events (id, ts, status) VALUES ('jr-outreach-o2', '2026-10-06T07:00:10.000Z', 'ok')").run();
  o = await ol();
  ok(o.counted && /^1 outreach runs in 48h with no logged learner allocation/.test(o.state), "an outreach run with no allocation row that day counts as stuck (" + o.state + ")");
  db.exec("UPDATE cloud_ops_events SET status = 'gated' WHERE id = 'jr-outreach-o2'");
  ok(!(await ol()).counted, "a gated outreach run (kill switch off) needs no allocation");
  db.exec("UPDATE cloud_ops_events SET status = 'ok', id = 'jr-outreach-learner-x1' WHERE id = 'jr-outreach-o2'");
  ok(!(await ol()).counted, "the learner's own job-run rows are not outreach runs");
  db.exec("DELETE FROM cloud_ops_events WHERE id = 'jr-outreach-learner-x1'");
  ok(!(await ol()).counted, "fresh again");
}

// Stalled, never-run, backlog, live merges, unreadable
db.prepare("UPDATE cloud_ops_events SET ts = ? WHERE id = 'portfolio-daily-2026-10-06'").run(ago(60));
db.exec("DELETE FROM charter_snapshots");
db.prepare("INSERT INTO intents (id, status, type, created_at) VALUES ('i2', 'pending', 'research', ?)").run(ago(72));
db.prepare("INSERT INTO code_tasks (id, status, updated_at) VALUES ('c1', 'published', ?)").run(ago(49));
db.exec("DROP TABLE evolve_candidates");
m = await api.watchmakerMeasure(env, NOW);
ok(op(m, "portfolio-daily").counted && /stalled: last run 60h ago, cadence 24h/.test(op(m, "portfolio-daily").state), "a runner silent for over twice its cadence counts as stalled");
ok(op(m, "charter-loop").counted && op(m, "charter-loop").state === "never ran", "a runner past its first due date that never ran counts");
ok(op(m, "research-intent-triage").counted && /^1 pending research intents older than 120 min/.test(op(m, "research-intent-triage").state), "a research backlog older than 120 min counts");
ok(op(m, "code-task-merge").counted && /^1 code-loop PRs or tasks that needed a person \(stuck_prs 1\)$/.test(op(m, "code-task-merge").state), "a code-loop PR the runner left waiting for 49h counts");
ok(op(m, "fleet-defects").counted && /^unmeasured/.test(op(m, "fleet-defects").state), "an unreadable ledger counts as unmeasured");
ok(m.index === 5 && m.counted.join(",") === "charter-loop,fleet-defects,portfolio-daily,research-intent-triage,code-task-merge".split(",").sort((x, y) => m.counted.indexOf(x) - m.counted.indexOf(y)).join(","), "the index is the number of counted operations (" + m.index + ")");
// first_due in the future: not counted
const early = await api.watchmakerMeasure(env, Date.parse("2026-10-01T15:00:00Z"));
ok(/^first run due/.test(op(early, "charter-loop").state) && !op(early, "charter-loop").counted, "a new loop is not counted before its first run is due");

// Daily run: once a day, after 07:00Z, writes the row and the metric
let d = await api.watchmakerDaily(env, { now: Date.parse("2026-10-06T06:30:00Z") });
ok(/before 7:00Z/.test(d.skipped || ""), "nothing runs before 07:00Z");
d = await api.watchmakerDaily(env, { now: NOW });
const row = db.prepare("SELECT day, index_value, counted FROM watchmaker_runs").get();
ok(row && row.day === "2026-10-06" && row.index_value === 5 && row.counted.includes("portfolio-daily"), "one watchmaker_runs row per day");
const mr = db.prepare("SELECT * FROM metric_registry WHERE metric = 'watchmaker_index'").get();
ok(mr && mr.last_value === "5" && mr.refresh_cadence === "daily" && mr.target === "0" && mr.source_of_truth && mr.disposition_actor, "metric_registry carries the index with the METRIC-INTEGRITY-1 fields");
d = await api.watchmakerDaily(env, { now: NOW + 36e5 });
ok(/already measured/.test(d.skipped || "") && db.prepare("SELECT COUNT(*) n FROM watchmaker_runs").get().n === 1, "a second run the same day is skipped");
ok(api.wmIso(1790849435000) === "2026-10-01T10:10:35.000Z" && api.wmIso(1790849435) === "2026-10-01T10:10:35.000Z" && api.wmIso("x") === null, "epoch ms, epoch s and junk are handled");

// WATCHMAKER-REMEASURE-1: a day whose stored measurement holds an operation that failed on a transient database error is measured again (at most every 20 minutes);
// a persistent error, a recent row and a clean row are not.
{
  const seed = (day, state, createdAt) => db.prepare("INSERT OR REPLACE INTO watchmaker_runs (day, index_value, counted, json, created_at) VALUES (?, 1, 'seed-op', ?, ?)")
    .run(day, JSON.stringify({ ops: [{ key: "seed-op", counted: true, state }] }), createdAt);
  const at = (day, hh) => Date.parse(day + "T" + hh + ":00:00Z");
  seed("2026-10-07", "unmeasured: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window", "2026-10-07 08:00:00");
  let r = await api.watchmakerDaily(env, { now: at("2026-10-07", "09") });
  const re = db.prepare("SELECT json FROM watchmaker_runs WHERE day = '2026-10-07'").get();
  ok(!r.skipped && re && !re.json.includes("seed-op"), "a day with a transiently unmeasured operation is measured again after 20 minutes and the row is replaced", r.skipped);
  seed("2026-10-08", "unmeasured: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window", "2026-10-08 08:50:00");
  r = await api.watchmakerDaily(env, { now: at("2026-10-08", "09") });
  ok(/already measured/.test(r.skipped || ""), "but not within 20 minutes of the last measurement", r.skipped);
  seed("2026-10-09", "unmeasured: D1_ERROR: no such table: nope", "2026-10-09 07:30:00");
  r = await api.watchmakerDaily(env, { now: at("2026-10-09", "09") });
  ok(/already measured/.test(r.skipped || ""), "a persistent error (a missing table) is a finding, not a retry", r.skipped);
  seed("2026-10-10", "ok, last run 0.2h ago", "2026-10-10 07:30:00");
  r = await api.watchmakerDaily(env, { now: at("2026-10-10", "09") });
  ok(/already measured/.test(r.skipped || ""), "a clean day is measured once", r.skipped);
  db.prepare("INSERT OR REPLACE INTO watchmaker_runs (day, index_value, counted, json, created_at) VALUES ('2026-10-11', 1, 'x', 'not json', '2026-10-11 07:30:00')").run();
  r = await api.watchmakerDaily(env, { now: at("2026-10-11", "09") });
  ok(/already measured/.test(r.skipped || ""), "a stored row that is not JSON is left alone", r.skipped);
  // WATCHMAKER-REMEASURE-1b: before 07:00Z the newest stored row that holds a transient failure is measured again, into its own day
  db.prepare("DELETE FROM watchmaker_runs WHERE day > '2026-10-06'").run();
  seed("2026-10-12", "unmeasured: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window", "2026-10-12 07:00:00");
  r = await api.watchmakerDaily(env, { now: Date.parse("2026-10-13T03:00:00Z") });
  const early = db.prepare("SELECT day, json FROM watchmaker_runs WHERE day >= '2026-10-12'").all();
  ok(!r.skipped && early.length === 1 && early[0].day === "2026-10-12" && !early[0].json.includes("seed-op"), "before 07:00Z a transiently unmeasured row from the day before is measured again into its own day", { r: r.skipped, early: early.map((e) => e.day) });
  seed("2026-10-14", "unmeasured: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window", "2026-10-15 02:50:00");
  r = await api.watchmakerDaily(env, { now: Date.parse("2026-10-15T03:00:00Z") });
  ok(/before 7:00Z/.test(r.skipped || ""), "but not within 20 minutes of the last measurement", r.skipped);
  seed("2026-10-16", "ok, last run 0.2h ago", "2026-10-16 02:00:00");
  r = await api.watchmakerDaily(env, { now: Date.parse("2026-10-17T03:00:00Z") });
  ok(/before 7:00Z/.test(r.skipped || ""), "and a clean newest row is left alone before 07:00Z", r.skipped);
  seed("2026-10-18", "unmeasured: D1_ERROR: no such table: nope", "2026-10-18 02:00:00");
  r = await api.watchmakerDaily(env, { now: Date.parse("2026-10-19T03:00:00Z") });
  ok(/before 7:00Z/.test(r.skipped || ""), "and a persistent error is left alone before 07:00Z", r.skipped);
  db.prepare("DELETE FROM watchmaker_runs WHERE day > '2026-10-06'").run();   // the GET test below reads the latest run: keep it the NOW day
}

// GET /api/watchmaker through the real fetch handler (no OWNER_TOKEN configured: full view)
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const r = await worker.fetch(new Request("https://fleet.qnfo.org/api/watchmaker"), { AUDIT }, { waitUntil() {}, passThroughOnException() {} });
const j = await r.json();
ok(r.status === 200 && j.day === "2026-10-06" && j.index === 5 && Array.isArray(j.ops) && j.ops.length >= 10, "GET /api/watchmaker serves the latest run");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
