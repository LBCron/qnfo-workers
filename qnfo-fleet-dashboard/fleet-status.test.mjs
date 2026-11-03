// FLEET-STATUS-1 (1.68.0) offline suite: the owner's home page and its one machine-readable document. Drives the real worker against an
// in-memory SQLite D1 that carries migrations/2026-10-26-fleet-status-metrics.sql. Proves:
//   S1 GET /api/status is fleet-status/v1, open, with an ETag; ?since=<revision> answers not_modified; /api lists it.
//   S2 a parked code task (code_tasks needs_human) is the fleet's: it is in fleet_handling, never in needs_you, and never in the owner
//      count /api/human reports; a billing card stays the owner's.
//   S3 metrics: one breach rule (v_metric_trigger_state.hit), one program per metric, metric_program_map overrides, trend judged by the
//      direction that is good for the metric, a stale reading is flagged; a metric with no value is unmeasured, never a breach.
//   S4 the 24-hour activity counts come from the ledgers; v_breach_by_cause is read when present and absent is a note, not blindness.
//   S5 GET / renders the document (headline, the five programs, the JSON link) and /classic and /?frag=1 still serve the old overview.
//   S6 an unreadable metric view reads "Can't confirm", never all clear.
// Run: node qnfo-fleet-dashboard/fleet-status.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(pathToFileURL(join(here, "worker.js")).href)).default;
const src = readFileSync(join(here, "worker.js"), "utf8");
const MIGRATION = readFileSync(join(here, "..", "migrations", "2026-10-26-fleet-status-metrics.sql"), "utf8");
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const STATE = { schema_version: "fleet-state/v1", generated_at: new Date().toISOString(), version: "t", verdict: "HEALTHY", window: {}, fleet: { workers: 30 }, totals: {}, scheduled: [], audits: [], probes: [{ name: "a", ok: true, status: 200 }, { name: "b", ok: true, status: 200 }], integration: {}, report_card: {}, chains: [], device: {}, issues: [], issue_counts: { err: 0, warn: 0, total: 0 }, queues: [], coverage: {}, unattributed_errors: 0, recovered_workers: [], error_workers: [], loop: {}, meta: {}, refresh_ms: 1 };
const LOOP = "loop-secret-fleet-status";

function mk() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fleet_dashboard_state (id INTEGER PRIMARY KEY, updated_at TEXT, state_json TEXT, refresh_ms INTEGER);
  CREATE TABLE fleet_loop_meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT DEFAULT 'normal', due TEXT, status TEXT DEFAULT 'open', source TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), resolved_at TEXT, resolution TEXT);
  CREATE TABLE intents (id TEXT PRIMARY KEY, desire TEXT, source TEXT, device TEXT, type TEXT, domain TEXT, priority TEXT, summary TEXT, due TEXT, status TEXT, wbs_code TEXT, created_at TEXT, processed_at TEXT, triage_decision TEXT);
  CREATE TABLE task_dod_register (id INTEGER PRIMARY KEY, title TEXT, dod TEXT, due TEXT, updated_at TEXT, owner TEXT, status TEXT);
  CREATE VIEW v_waiting_on_human AS SELECT id, title, dod, due, updated_at FROM task_dod_register WHERE owner IN ('user','mixed') AND status='open';
  CREATE TABLE gtd_register (id INTEGER PRIMARY KEY, line TEXT, dod TEXT, section TEXT, updated_at TEXT, owner TEXT, done INTEGER);
  CREATE TABLE fleet_issue_dispatch (fingerprint TEXT, category TEXT, owner TEXT, action TEXT, payload TEXT, gh_number INTEGER, exec_result TEXT, created_at TEXT, state TEXT, exec_state TEXT);
  CREATE TABLE code_tasks (id TEXT, goal TEXT, repo TEXT, last_error TEXT, pr_url TEXT, updated_at TEXT, status TEXT, created_at TEXT);
  CREATE TABLE shutdown_manifest (id INTEGER, phase INTEGER, component TEXT, condition TEXT, due_date TEXT, state TEXT);
  CREATE TABLE goals (id INTEGER PRIMARY KEY, goal_type TEXT, status TEXT, created_at TEXT, statement TEXT, alignment TEXT, updated_at TEXT);
  CREATE TABLE emails (id INTEGER, sender TEXT, subject TEXT, received_at TEXT, status TEXT);
  CREATE VIEW v_email_human_pending_v2 AS SELECT sender, subject, received_at FROM emails;
  CREATE TABLE invest_facts (key TEXT PRIMARY KEY, value TEXT, evidence TEXT, updated_at TEXT);
  CREATE TABLE owner_docs (key TEXT PRIMARY KEY, title TEXT NOT NULL, body_md TEXT NOT NULL, source TEXT, visibility TEXT NOT NULL DEFAULT 'private', updated_at TEXT);
  CREATE TABLE portfolio_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_date TEXT, kind TEXT, session TEXT, summary TEXT, scorecard_json TEXT, actions_json TEXT, needs_owner TEXT, created_at TEXT);
  CREATE TABLE sai_config (k TEXT PRIMARY KEY, v REAL, source TEXT, updated_at TEXT);
  CREATE TABLE objectives (id INTEGER PRIMARY KEY AUTOINCREMENT, objective_key TEXT UNIQUE NOT NULL, statement TEXT NOT NULL, source TEXT, ratified_by TEXT, ratified_on TEXT, version INTEGER DEFAULT 1, status TEXT DEFAULT 'ACTIVE');
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT, kind TEXT);
  CREATE TABLE programs (program_code TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY, ts TEXT);
  CREATE TABLE persona_actions (id INTEGER PRIMARY KEY, ts TEXT);
  CREATE TABLE breach_selfheal_actions (id INTEGER PRIMARY KEY, ts TEXT);
  CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY, issue_id INTEGER, event TEXT, ts TEXT);
  CREATE TABLE deployment_history (id INTEGER PRIMARY KEY, deployed_at TEXT);
  CREATE TABLE metric_history (metric TEXT, day TEXT, value REAL);
  CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
  CREATE TABLE analytics_action_log (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_id INTEGER, fired_at TEXT);
  CREATE VIEW v_metric_trigger_state AS
    SELECT t.id, t.metric_key, t.title, t.operator, t.threshold, t.owner, t.priority,
      CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = t.metric_key), 0) AS REAL) AS val,
      CASE WHEN t.operator = 'gt' THEN (CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = t.metric_key), 0) AS REAL) > t.threshold)
           WHEN t.operator = 'gte' THEN (CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = t.metric_key), 0) AS REAL) >= t.threshold)
           WHEN t.operator = 'lt' THEN (CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = t.metric_key), 0) AS REAL) < t.threshold)
           WHEN t.operator = 'lte' THEN (CAST(COALESCE((SELECT last_value FROM metric_registry WHERE metric = t.metric_key), 0) AS REAL) <= t.threshold)
           ELSE 0 END AS hit
    FROM analytics_metric_triggers t;`);
  db.exec(MIGRATION);
  db.prepare("INSERT INTO fleet_dashboard_state VALUES (1,?,?,1)").run(new Date().toISOString(), JSON.stringify(STATE));
  // Steady state: the money/return snapshot is fresh, so humanView does not fire a background re-measure while the test
  // compares two revisions (that write is real content and would move the revision mid-assertion, not a bug).
  db.prepare("INSERT INTO fleet_loop_meta (k,v) VALUES ('human_gov_snapshot', ?)").run(JSON.stringify({
    at: new Date().toISOString(),
    cost: { spend30: 120, cap: 150, balance: 40, credit_burn7: 8, credit_burn24: 1, metered30: 130, metered_top: [], workers_ai30: 3, period_gross: 120, gateway_limit: null, total_est30: 130 },
    ret: { subs_confirmed: 3, subs_total: 5, subs_new30: 1, pageviews30: 100, pageviews_mom: 5, pageviews_prior_days: 30, reports30: 2, publish_events30: 2, impact_per_usd: 0.1 },
    autonomy: { overall: 3, self_heal: 3 }, fleet: { workers: 30 }, early_trigger: null, trend: null, gates_met: 1, gates_total: 5, survival: 0.5
  }));
  db.prepare("INSERT INTO human_actions (slug,title,why,action,due,source) VALUES ('rt-one','Top up the AI credit','why it is yours','act','','billing')").run();
  // CI-TEST-CLOCKS-1 (2026-10-20): the worker adds the owner card "Decide: continue or stop (review gate due)" once REVIEW_GATE_DATE (2026-12-31) has passed with no
  // return evidence attested, so from that day this fixture's queue held one card more than every count below says. One attested credibility event (the target is
  // 2) gives the fixture the same verdict, CONTINUE, on either side of the gate.
  db.prepare("INSERT INTO invest_facts (key,value,evidence,updated_at) VALUES ('credibility_events','2','fixture: attested, so the verdict does not turn on the review gate date',datetime('now'))").run();
  db.prepare("INSERT INTO analytics_metric_triggers (metric_key,title,operator,threshold,priority,action,owner) VALUES ('fleet_ai_run_rate_30d_usd','Fleet AI run-rate above $15/30d','gt',95,8,'code-task: repo=QNFO/qnfo-workers path=qnfo-fleet-control/worker.js','qnfo-fleet-control')").run();
  db.prepare("INSERT INTO metric_registry (metric,last_value,last_refreshed) VALUES ('fleet_ai_run_rate_30d_usd','281.14',?)").run(new Date().toISOString());
  db.prepare("INSERT INTO metric_history (metric,day,value) VALUES ('fleet_ai_run_rate_30d_usd',date('now','-1 day'),200)").run();
  db.prepare("INSERT INTO metric_history (metric,day,value) VALUES ('fleet_ai_run_rate_30d_usd',date('now'),281.14)").run();
  const prep = (sql) => { let a = []; const q = { bind(...x) { a = x.map((v) => (v === undefined ? null : v)); return q; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const r = db.prepare(sql).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; }, async first() { return db.prepare(sql).get(...a) || null; } }; return q; };
  const env = { AUDIT: { prepare: prep, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } }, LOOP_TOKEN: LOOP };
  return { env, db };
}

const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); }, passThroughOnException() {} };
const get = async (env, path, headers) => worker.fetch(new Request("https://fleet.qnfo.org" + path, { headers: headers || {} }), env, ctx);
const iso = (minAgo) => new Date(Date.now() - minAgo * 6e4).toISOString();
const seed = (db) => {
  // The real view's shape: a metric with no reading has val NULL (rt-api's fixture reads it as 0).
  db.exec("DROP VIEW v_metric_trigger_state; CREATE VIEW v_metric_trigger_state AS SELECT t.id, t.metric_key, t.title, t.operator, t.threshold, t.owner, t.priority, v.val, CASE WHEN v.val IS NULL THEN NULL WHEN t.operator = 'gt' THEN v.val > t.threshold WHEN t.operator = 'lt' THEN v.val < t.threshold WHEN t.operator = 'lte' THEN v.val <= t.threshold ELSE v.val >= t.threshold END AS hit FROM analytics_metric_triggers t LEFT JOIN (SELECT metric, CAST(last_value AS REAL) AS val FROM metric_registry) v ON v.metric = t.metric_key WHERE COALESCE(t.enabled, 1) = 1");
  db.exec("INSERT INTO programs VALUES ('QNFO.RSCH','Research & Publications'),('QNFO.REACH','Reach & Distribution'),('QNFO.INFRA','Cloudflare Infrastructure'),('QNFO.OPS','Operations & Governance'),('QNFO.PERSONAL','Personal Twin')");
  const trig = db.prepare("INSERT INTO analytics_metric_triggers (metric_key,title,operator,threshold,priority,owner,enabled) VALUES (?,?,?,?,?,?,1)");
  const reg = db.prepare("INSERT INTO metric_registry (metric,last_value,last_refreshed,kind) VALUES (?,?,?,?)");
  const hist = db.prepare("INSERT INTO metric_history (metric,day,value) VALUES (?,date('now','-8 day'),?)");
  trig.run("publish_rate_ratio_24h", "Publishing below 0.4 of normal", "lt", 0.4, 7, "qnfo-fleet-control"); reg.run("publish_rate_ratio_24h", "0.26", iso(5), "target"); hist.run("publish_rate_ratio_24h", 0.6);
  trig.run("open_agent_issues", "Open issues above 260", "gt", 260, 5, "qnfo-fleet-control"); reg.run("open_agent_issues", "384", iso(5), "leading"); hist.run("open_agent_issues", 420);
  trig.run("pageviews_30d", "Pageviews below 100", "lt", 100, 5, "qnfo-fleet-control"); reg.run("pageviews_30d", "500", iso(5), "leading");
  trig.run("worker_count", "Workers above 30", "gt", 30, 4, "qnfo-fleet-control"); reg.run("worker_count", "36", iso(3000), "lagging");
  trig.run("blind_metric", "Never measured", "gt", 0, 4, "qnfo-fleet-control");
  trig.run("crons_unobserved", "A cron nobody observes", "gt", 0, 4, "qnfo-fleet-control"); reg.run("crons_unobserved", "1", iso(5), "guard");
  db.prepare("INSERT INTO metric_program_map (metric, program_code, note) VALUES ('crons_unobserved','QNFO.OPS','test override')").run();
  db.prepare("INSERT INTO code_tasks (id,goal,repo,last_error,pr_url,updated_at,status) VALUES ('ct_parked','Fix the errata confirm','qnfo-workers','model @cf/x proposed no change',NULL,?, 'needs_human')").run(iso(800));
  db.prepare("INSERT INTO code_tasks (id,goal,repo,last_error,pr_url,updated_at,status) VALUES ('ct_m','merged one','qnfo-workers','',NULL,?, 'merged')").run(iso(60));
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO decision_log (ts) VALUES (?)").run(iso(30));
  db.prepare("INSERT INTO decision_log (ts) VALUES (?)").run(iso(3000));
  for (let i = 0; i < 2; i++) db.prepare("INSERT INTO persona_actions (ts) VALUES (?)").run(iso(10));
  db.prepare("INSERT INTO issue_lifecycle (issue_id,event,ts) VALUES (1,'closed',?),(2,'closed',?),(3,'opened',?)").run(iso(20), iso(20), iso(20));
};

// S1 + S2 + S3 + S4
{
  const { env, db } = mk(); seed(db);
  const r = await get(env, "/api/status");
  const j = await r.json();
  ok(r.status === 200 && j.schema_version === "fleet-status/v1" && !!r.headers.get("ETag") && j.revision, "S1 /api/status is fleet-status/v1 with an ETag and a revision", { s: r.status, v: j.schema_version });
  const r2 = await get(env, "/api/status?since=" + encodeURIComponent(j.revision));
  const j2 = await r2.json();
  ok(j2.not_modified === true, "S1 ?since=<revision> answers not_modified", j2);
  const idx = await (await get(env, "/api")).json();
  ok(JSON.stringify(idx).indexOf('"/api/status"') >= 0, "S1 /api lists /api/status");
  ok(j.needs_you.count === 1 && j.needs_you.items[0].source === "queue" && /Top up/.test(j.needs_you.items[0].title), "S2 the billing card is the owner's and the only one", j.needs_you);
  ok(j.fleet_handling.count === 1 && j.fleet_handling.items[0].key === "code:ct_parked", "S2 the parked code task is in fleet_handling", j.fleet_handling);
  ok(!j.needs_you.items.some((x) => x.source === "code-loop"), "S2 no code-loop item is in needs_you");
  const hu = await (await get(env, "/api/human")).json();
  ok(hu.count === 1 && hu.fleet_handling.count === 1 && hu.attention.open === 1, "S2 /api/human counts the owner's item only and lists the parked task under fleet_handling", { count: hu.count, fleet: hu.fleet_handling, open: hu.attention.open });
  const m = j.metrics;
  // fleet_ai_run_rate_30d_usd (mk) + 6 seeded; blind_metric has no value.
  ok(m.total === 7 && m.measured === 6, "S3 every enabled metric is counted once; one with no value is unmeasured", { total: m.total, measured: m.measured });
  ok(m.in_breach === 5, "S3 in_breach is the view's hit count (run rate, publishing, issues, workers, crons)", m.in_breach);
  const prog = (c) => m.by_program.find((g) => g.code === c);
  ok(m.by_program.map((g) => g.code).join(",") === "QNFO.RSCH,QNFO.REACH,QNFO.INFRA,QNFO.OPS,QNFO.PERSONAL", "S3 the five programs, in order", m.by_program.map((g) => g.code));
  ok(prog("QNFO.RSCH").breaches.some((b) => b.metric === "publish_rate_ratio_24h"), "S3 a publishing metric belongs to Research");
  ok(prog("QNFO.REACH").in_breach === 0 && prog("QNFO.REACH").measured === 1, "S3 an on-target reach metric is measured, not in breach", prog("QNFO.REACH"));
  ok(prog("QNFO.INFRA").breaches.some((b) => b.metric === "worker_count") && prog("QNFO.INFRA").breaches.some((b) => b.metric === "fleet_ai_run_rate_30d_usd"), "S3 cost and worker metrics belong to Infrastructure");
  ok(prog("QNFO.OPS").breaches.some((b) => b.metric === "crons_unobserved"), "S3 metric_program_map overrides the rule (crons_unobserved moved to Operations)", prog("QNFO.OPS").breaches.map((b) => b.metric));
  const b = (c, k) => prog(c).breaches.find((x) => x.metric === k);
  ok(b("QNFO.RSCH", "publish_rate_ratio_24h").trend === "worse" && b("QNFO.RSCH", "publish_rate_ratio_24h").good === "up", "S3 a lower value of an up-is-good metric is worse", b("QNFO.RSCH", "publish_rate_ratio_24h"));
  ok(b("QNFO.OPS", "open_agent_issues").trend === "better", "S3 fewer open issues than 7 days ago is better, though still in breach", b("QNFO.OPS", "open_agent_issues"));
  ok(b("QNFO.INFRA", "worker_count").stale === true && b("QNFO.OPS", "open_agent_issues").stale === false, "S3 a reading older than a day plus 120 minutes is stale");
  ok(prog("QNFO.RSCH").breaches[0].trend === "worse", "S3 within a program the worsening breaches come first");
  ok(m.worse_7d === 1 && m.better_7d === 1, "S3 week-on-week counts", { w: m.worse_7d, b: m.better_7d });
  ok(/v_metric_trigger_state\.hit/.test(m.definition) && /7 days/.test(m.definition), "S3 the document defines breach and trend once");
  const a = j.activity_24h;
  ok(a.decisions_logged === 3 && a.manager_actions === 2 && a.issues_closed === 2 && a.issues_opened === 1 && a.code_merged === 1, "S4 the 24-hour activity comes from the ledgers", a);
  ok(j.causes === null && j.notes.length === 2 && j.blind.length === 0, "S4 without v_breach_by_cause the document says so in notes and is not blind", { c: j.causes, n: j.notes, b: j.blind });
  ok(j.headline.state === "needs_you" && /1 item needs you/.test(j.headline.sentence), "S4 the headline names the owner's item", j.headline);
}
// S4 causes + S5 pages
{
  const { env, db } = mk(); seed(db);
  db.exec("UPDATE code_tasks SET status = 'failed' WHERE id = 'ct_parked'; UPDATE human_actions SET status = 'done'");
  db.exec("CREATE TABLE breach_causes (cause_key TEXT, title TEXT, plain TEXT, lever TEXT, doer TEXT, needs_owner INTEGER); INSERT INTO breach_causes VALUES ('spend','AI spend above the ceiling','The fleet spends more.','Cheaper models.','qnfo-ai',1),('publishing','Papers move slowly','Publishing fell.','Spend on stages that publish.','qnfo-research-exec',0); CREATE VIEW v_breach_by_cause AS SELECT cause_key, title, plain, lever, doer, needs_owner, CASE cause_key WHEN 'spend' THEN 1 ELSE 2 END AS breaches, CASE cause_key WHEN 'spend' THEN 'fleet_ai_run_rate_30d_usd=281' ELSE 'publish_rate_ratio_24h=0.26, x=1' END AS metrics FROM breach_causes");
  const j = await (await get(env, "/api/status")).json();
  ok(Array.isArray(j.causes) && j.causes.length === 2 && j.causes[0].cause === "publishing" && j.causes[1].owner_decision === true && j.causes[0].metrics.join() === "publish_rate_ratio_24h,x", "S4 causes are read, ranked by breaches, with the owner-decision flag", j.causes);
  ok(j.needs_you.count === 0 && j.headline.state === "fleet_working" && /^Nothing needs you\./.test(j.headline.sentence) && /3 decisions/.test(j.headline.sentence), "S4 nothing for the owner reads as the fleet working, with what it did", j.headline);
  const page = await get(env, "/");
  const html = await page.text();
  ok(page.status === 200 && /Nothing needs you/.test(html) && /Why metrics are off target/.test(html) && /your decision/.test(html), "S5 the home page renders the headline and the causes");
  ok(["Research and publications", "Reach and distribution", "Infrastructure and cost", "Operations and the autonomy loop", "Personal twin"].every((n) => html.indexOf(n) >= 0), "S5 the page lists the five programs");
  ok(/href="\/api\/status"/.test(html) && /href="\/classic"/.test(html), "S5 the page links its JSON and the full overview");
  ok(!/things need you/.test(html), "S5 no owner count when nothing is the owner's");
  const classic = await (await get(env, "/classic")).text();
  ok(/Your queue/.test(classic) && /fetch\('\/\?frag=1'/.test(classic), "S5 /classic is the old overview and its poll still asks /?frag=1");
  const frag = await get(env, "/?frag=1");
  ok(frag.status === 200 && !/<html/.test(await frag.text()), "S5 /?frag=1 still serves the old fragment");
}
// Public homepage reads reuse the bounded edge entry, while authenticated renders remain private and bypass it.
{
  const previousCaches = globalThis.caches;
  const entries = new Map();
  let matches = 0, puts = 0, ttl = null;
  globalThis.caches = { default: {
    async match(request) {
      matches++;
      const cached = entries.get(request.url);
      return cached ? cached.clone() : undefined;
    },
    async put(request, response, options) {
      puts++;
      ttl = options && options.expirationTtl;
      entries.set(request.url, response.clone());
    }
  } };
  try {
    const { env } = mk();
    const first = await get(env, "/");
    const second = await get(env, "/");
    ok(first.headers.get("Cache-Control") === "public, max-age=60" && puts === 1 && ttl === 60, "S5 a public homepage response is cached for 60 seconds");
    ok(matches === 2 && /fleet-status\/v1/.test(await second.text()), "S5 the next public homepage request reuses the cached response");
    const token = "test-owner-token-with-enough-length";
    env.OWNER_TOKEN = token;
    const digest = createHash("sha256").update(token).digest("hex");
    const ownerPage = await get(env, "/", { Cookie: "fleet_owner=" + digest });
    ok(ownerPage.headers.get("Cache-Control") === "private, no-store" && matches === 2 && puts === 1, "S5 an authenticated homepage bypasses the public cache and remains private");
    ok(/data-vact="fix"/.test(await ownerPage.text()), "S5 an authenticated homepage still renders owner actions");
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
}
// S6
{
  const { env, db } = mk(); seed(db);
  db.exec("DROP VIEW v_fleet_metrics; UPDATE human_actions SET status = 'done'");
  const j = await (await get(env, "/api/status")).json();
  ok(j.headline.state === "blind" && j.metrics.in_breach === null && j.blind.some((x) => /v_fleet_metrics/.test(x)), "S6 an unreadable metric view is named and the headline cannot read all clear", { h: j.headline, b: j.blind });
}
ok((() => { const v = /^var VERSION = "(\d+)\.(\d+)\.(\d+)/m.exec(src); return v && (+v[1] > 1 || +v[2] >= 69); })(), "VERSION is at least 1.69.0");
console.log("fleet-status: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
