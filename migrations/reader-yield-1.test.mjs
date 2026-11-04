// READER-YIELD-1 (2026-11-04, pillar reach): the reader ledger, the per-paper readership table, the three measures and the research volume governor.
// Replays migrations/2026-11-04-reader-yield-1.sql on SQLite against a fixture with the live layout (including the existing hourly fleet_tasks event-metric-recompute the steps are
// appended to), then runs the task's steps the way the runner does (one statement a step, in order).
// Proves: the header opts in to the runner; engaged readers are counted from GA4 sources outside the fleet only ('(direct)', '(not set)' and the hosts in ops_config reader_internal_sources are left out); no new cron or task is created (fleet_budget caps are breached); the steps are appended after the original three, once; the ledger reads GA4
// channel rows and leaves a day with no GA4 rows NULL (never a zero); the 64 character campaign key joins a longer paper slug, a /quickread path is not a paper, and the first
// publication (not a later revision) names the idea source; stale paper rows are pruned and never read as current; the three metrics are NULL until 7 GA4 days exist; the governor is
// OFF by default (qnfo-ops owns the key) and when switched on moves the key toward engaged readers a day x 20000 inside the floor and ceiling by at most 10 percent a day, once a UTC day,
// does nothing inside the 2 percent dead band, pauses on a foreign write, with the governor off and with under 7 days of data, and logs one decision per move; the history backfill,
// the cause mapping, the trigger text (short, after the Pillar header) and the issue rows are written once; the machine-readable predictions parse.
// Run: node migrations/reader-yield-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const FILE = "2026-11-04-reader-yield-1.sql";
const text = readFileSync(new URL("./" + FILE, import.meta.url), "utf8");

// ---- header --------------------------------------------------------------------------------------------------------------------------------------------------------------
ok(/^-- APPLY-BY: ci\s*$/m.test(text), "opts in with APPLY-BY: ci");
ok(/^-- DB: qnfo-audit\s*$/m.test(text), "names DB qnfo-audit");
ok(/^-- Rollback: .{40,}$/m.test(text), "carries a one-line Rollback");
ok(/^-- CAUSE-MAPPED: .{10,}/m.test(text) && /INTO\s+metric_breach_cause\b/i.test(text), "maps the metric causes in this file (METRIC-CAUSE-AT-REGISTRATION-1)");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(text), "has no destructive statement of its own");
ok(!/^\s*(?:UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO)\s+"?decision_log"?\b/im.test(text), "never updates the append-only decision_log");
ok(!/^\s*(?:UPDATE(?:\s+OR\s+\w+)?)\s+"?ops_config"?\b/im.test(text), "writes research_daily_neurons only from the task, not from the migration");
ok(!/INTO\s+fleet_crons\b/i.test(text) && !/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+fleet_tasks\b/i.test(text), "adds no cron and no task row while fleet_budget caps are breached (the steps join event-metric-recompute)");

// ---- fixture with the live layout ------------------------------------------------------------------------------------------------------------------------------------
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT, collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));
  CREATE INDEX idx_rs_source_type_metric_date ON reach_signals(source, entity_type, metric, date);
  CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, paper_slug TEXT, score REAL, published_at TEXT);
  CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, neurons REAL DEFAULT 0, PRIMARY KEY (day, worker, purpose, model));
  CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT NOT NULL, kind TEXT NOT NULL, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
  CREATE TABLE metric_history (metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, meets INTEGER, target TEXT, ts TEXT, PRIMARY KEY (metric, day));
  CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
  CREATE TABLE output_quality_measures (metric TEXT PRIMARY KEY, surface TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('outcome','proxy','validity')), polarity INTEGER NOT NULL CHECK (polarity IN (-1,1)), tol_rel REAL NOT NULL DEFAULT 0.1, tol_abs REAL NOT NULL DEFAULT 0, judged_by TEXT NOT NULL, caveat TEXT);
  CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
  CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  CREATE TRIGGER decision_log_no_delete BEFORE DELETE ON decision_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT DEFAULT 'optimization', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'open', linked_session TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE roadmap_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, program_code TEXT NOT NULL, request_instance TEXT UNIQUE, title TEXT, rationale TEXT, path TEXT, anchor_line TEXT, status TEXT NOT NULL DEFAULT 'proposed', issue_id INTEGER, task_id TEXT, pr_url TEXT, outcome TEXT, deployed_at TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, definition TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retries INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
  CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, cron_expr TEXT NOT NULL, task_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, timezone TEXT NOT NULL DEFAULT 'UTC', last_fired TEXT, next_fire TEXT, updated_at TEXT);
  CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
  CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, title TEXT NOT NULL, why TEXT, default_in_effect TEXT, action TEXT, url TEXT, sev TEXT DEFAULT 'normal', due TEXT, status TEXT DEFAULT 'open', source TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), resolved_at TEXT, resolution TEXT);
`);
const ymd = (back) => new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
const rs = db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, ?, ?, ?, ?, ?, ?, 'human')");
const LONG = "a-very-long-paper-slug-that-is-more-than-sixty-four-characters-long-so-the-utm-campaign-key-truncates-it";
const KEY = LONG.toLowerCase().slice(0, 64);
// GA4 channel rows for the 10 complete days before today (engaged 10 + 2 + 3 + 2 = 17 a day); the 4 days before that have none.
for (let b = 1; b <= 10; b++) {
  const d = ymd(b);
  for (const [ch, ses, eng] of [["direct", 150, 20], ["organic social", 18, 2], ["referral", 4, 3], ["organic search", 6, 2], ["unassigned", 2, 0]]) {
    rs.run(d, "ga4", "web", "channel", ch, "sessions", ses);
    rs.run(d, "ga4", "web", "channel", ch, "engagedSessions", eng);
  }
  for (const [src, ses, eng] of [["google", 14, 12], ["x", 6, 5], ["(direct)", 150, 20], ["ask.qwav.tech", 3, 3], ["github.com", 2, 2], ["(not set)", 1, 0]]) {
    rs.run(d, "ga4", "web", "source", src, "sessions", ses);
    rs.run(d, "ga4", "web", "source", src, "engagedSessions", eng);
  }
  rs.run(d, "utm", "bluesky", "campaign", KEY, "clicks_human", 100);
  rs.run(d, "utm", "bluesky", "campaign", "other-paper", "clicks_human", 20);
  rs.run(d, "utm", "bluesky", "campaign", "bot-paper", "clicks_bot", 500);
  rs.run(d, "cf-rum-human", "web", "paper", LONG, "pageviews", 10);
  rs.run(d, "cf-rum-human", "web", "paper", LONG, "external_pageviews", b === 1 ? 2 : 0);
  rs.run(d, "cf-rum-human", "web", "paper", "other-paper", "pageviews", 4);
  rs.run(d, "cf-rum-human", "web", "page", "qnfo.org/about", "external_pageviews", 1);
  rs.run(d, "ga4", "web", "page", "/papers/" + LONG, "sessions", 3);
  rs.run(d, "ga4", "web", "page", "/papers/" + LONG + "/quickread", "sessions", 9);
  rs.run(d, "ga4", "web", "page", "/papers", "sessions", 7);
}
rs.run(ymd(12), "ga4", "web", "source", "(direct)", "sessions", 40);
rs.run(ymd(12), "ga4", "web", "source", "(direct)", "engagedSessions", 6);
rs.run(ymd(12), "ga4", "web", "source", "github.com", "sessions", 2);
rs.run(ymd(12), "ga4", "web", "source", "github.com", "engagedSessions", 2);
const ins = db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, neurons) VALUES (?, ?, 'p', 'm', ?)");
const rq = db.prepare("INSERT INTO research_queue (id, source, source_id, paper_slug, score, published_at) VALUES (?, ?, ?, ?, ?, ?)");
for (let b = 1; b <= 14; b++) {
  ins.run(ymd(b), "qnfo-research-exec", 500000); ins.run(ymd(b), "qnfo-paper-reviser", 80000); ins.run(ymd(b), "errata-hub", 20000); ins.run(ymd(b), "qnfo-social", 99999);
  for (let k = 0; k < 5; k++) rq.run("q" + b + "-" + k, "proposal", "s" + b + k, k === 0 && b === 1 ? LONG : "p-" + b + "-" + k, 0.7, ymd(b) + " 10:0" + k + ":00");
}
// the same paper published again later as a remediation (a revision): the first publication still names the idea source and the age
rq.run("rev-1", "remediation", "rev1", LONG, 0.9, ymd(1) + " 23:00:00");
rq.run("rev-0", "remediation", "rev0", LONG, 0.9, ymd(0) + " 00:30:00");
const ORIG_STEPS = [{ type: "sql", db: "AUDIT", name: "recompute-process-path-gaps", sql: "SELECT 1" }, { type: "sql", db: "AUDIT", name: "recompute-probe-review-refused", sql: "SELECT 1" }, { type: "sql", db: "AUDIT", name: "ledger", sql: "SELECT 1" }];
db.prepare("INSERT INTO fleet_tasks (id, name, type, definition, timeout_ms, retries, version, enabled, updated_at) VALUES ('event-metric-recompute', 'x', 'workflow', ?, 30000, 1, 2, 1, datetime('now'))").run(JSON.stringify({ steps: ORIG_STEPS }));
db.exec("INSERT INTO fleet_crons (name, cron_expr, task_id, enabled) VALUES ('event-metric-recompute-daily', '55 * * * *', 'event-metric-recompute', 1)");
db.exec(`
  INSERT INTO ops_config (key, value, note) VALUES ('research_daily_neurons', '360000', 'PIPELINE-FLOW-POLICY-1 history');
  INSERT INTO analytics_metric_triggers (metric_key, title, source_table, operator, threshold, action) VALUES ('outreach_human_clicks_7d', 't', 'registry', 'lt', 5, 'Pillar reach. Read SELECT * FROM v_channel_impact_7d ORDER BY clicks_per_post_7d DESC. Levers in order: (1) a channel with posts and no clicks; (2) shift volume to the channel with the most clicks per post (pipeline_flags.social_channel_caps)');
`);
const ORIG_TRIGGER = db.prepare("SELECT action FROM analytics_metric_triggers WHERE metric_key = 'outreach_human_clicks_7d'").get().action;

// ---- apply ---------------------------------------------------------------------------------------------------------------------------------------------------------------
db.exec(text);
const n = (sql, ...a) => db.prepare(sql).get(...a);
const rows = (sql, ...a) => db.prepare(sql).all(...a);

ok(n("SELECT COUNT(*) c FROM reader_yield_daily").c === 14, "the ledger holds the last 14 complete days");
const d1 = n("SELECT * FROM reader_yield_daily WHERE day = ?", ymd(1));
ok(d1.ga4_engaged === 27 && d1.ga4_sessions === 180 && d1.ga4_engaged_social === 2 && d1.ga4_sessions_social === 18, "GA4 channel rows sum into engaged, sessions and the organic social share", d1);
ok(d1.ga4_engaged_external === 17 && d1.ga4_sessions_external === 20 && d1.ga4_engaged_direct === 20, "externally sourced engaged sessions leave out (direct), (not set) and the fleet's own hosts (ask.qwav.tech, github.com)", d1);
const only = n("SELECT * FROM reader_yield_daily WHERE day = ?", ymd(12));
ok(only.ga4_engaged_external === 0 && only.ga4_sessions_external === 0 && only.ga4_engaged_direct === 6, "a day whose GA4 rows are all the fleet's own reads 0 external, not NULL", only);
db.exec("DELETE FROM reach_signals WHERE date = '" + ymd(12) + "'; DELETE FROM reader_yield_daily WHERE day = '" + ymd(12) + "'");
ok(d1.utm_clicks_human === 120, "utm_clicks_human counts human rows only (bot rows are not counted)", d1.utm_clicks_human);
ok(d1.ext_referred_pv === 3, "external referred page loads sum page and paper rows", d1.ext_referred_pv);
ok(d1.papers_published === 6, "papers published a day come from research_queue.published_at (5 and the revision)", d1.papers_published);
ok(d1.research_neurons === 600000, "research neurons sum the three research workers and not qnfo-social", d1.research_neurons);
const old = n("SELECT * FROM reader_yield_daily WHERE day = ?", ymd(14));
ok(old.ga4_engaged === null && old.ga4_sessions === null && old.ga4_engaged_external === null && old.utm_clicks_human === null, "a day with no GA4 or UTM rows is NULL, never a zero", old);
db.exec("UPDATE ops_config SET value = replace(value, 'github.com,', '') WHERE key = 'reader_internal_sources'");
ok(n("SELECT ga4_engaged_external e FROM v_reader_yield_source WHERE day = ?", ymd(1)).e === 19, "the internal source list is editable data: dropping github.com from it counts its 2 engaged sessions", n("SELECT ga4_engaged_external e FROM v_reader_yield_source WHERE day = ?", ymd(1)));
db.exec("UPDATE ops_config SET value = 'github.com,' || value WHERE key = 'reader_internal_sources'");

const pr = rows("SELECT * FROM paper_readership WHERE key64 = ?", KEY);
ok(pr.length === 1, "one row for the 64 character key of a longer slug", pr.length);
ok(pr[0].slug === LONG, "the slug is the full RUM slug", pr[0].slug);
ok(pr[0].utm_30d === 1000 && pr[0].ext_30d === 2 && pr[0].pv_30d === 100, "UTM clicks join the truncated key; external loads and page views sum from RUM", pr[0]);
ok(pr[0].ga4_sessions_30d === 30, "GA4 counts /papers/<slug> only (not /quickread, not /papers)", pr[0].ga4_sessions_30d);
ok(pr[0].idea_source === "proposal" && pr[0].idea_score === 0.7, "the first publication names the idea source, not the later revision", pr[0]);
ok(pr[0].published_at === ymd(1) + " 10:00:00", "and the age: the earliest publication", pr[0].published_at);
ok(pr[0].pv_7d === 70 && pr[0].pv_prev_7d === 30, "7 day and previous 7 day windows split at the same date", pr[0]);
ok(!rows("SELECT key64 FROM paper_readership").some((r) => r.key64 === "bot-paper"), "bot-only campaigns are not papers read");
const top = rows("SELECT slug, reader_score, suspect_automated FROM v_paper_readers_top");
ok(top.length >= 1 && top[0].slug === LONG && top[0].reader_score === 3 && top[0].suspect_automated === 0, "v_paper_readers_top ranks the externally read paper first", top[0]);
ok(rows("SELECT * FROM v_reader_yield_by_source").some((r) => r.idea_source === "proposal" && r.papers >= 1), "yield by idea source reads the table");

const mv = Object.fromEntries(rows("SELECT metric, last_value, state FROM metric_registry").map((r) => [r.metric, r]));
ok(mv.engaged_reader_sessions_7d.last_value === "119" && mv.engaged_reader_sessions_7d.state === "MEASURED", "engaged_reader_sessions_7d is the 7 day sum of externally sourced engaged sessions (7 x 17, not the 189 from all sources)", mv.engaged_reader_sessions_7d);
ok(mv.outreach_engaged_per_100_clicks_7d.last_value === "1.67", "engaged social sessions per 100 counted clicks (14 / 840)", mv.outreach_engaged_per_100_clicks_7d);
ok(mv.research_neurons_per_engaged_session_7d.last_value === "35294", "research neurons per externally sourced engaged session (4,200,000 / 119)", mv.research_neurons_per_engaged_session_7d);
ok(mv.social_engaged_sessions_7d.last_value === "14" && mv.social_engaged_sessions_7d.state === "MEASURED", "social_engaged_sessions_7d is the 7 day Organic Social engaged sum (7 x 2)", mv.social_engaged_sessions_7d);
ok(n("SELECT COUNT(*) c FROM metric_history WHERE metric = 'engaged_reader_sessions_7d'").c === 4 && n("SELECT COUNT(*) c FROM metric_history WHERE metric = 'social_engaged_sessions_7d'").c === 4, "history is backfilled for the 4 days that have a full 7 day GA4 window");
ok(n("SELECT COUNT(*) c FROM metric_breach_cause WHERE metric_key IN ('engaged_reader_sessions_7d','outreach_engaged_per_100_clicks_7d','research_neurons_per_engaged_session_7d','social_engaged_sessions_7d')").c === 4, "the four causes are mapped");
const oq = Object.fromEntries(rows("SELECT metric, surface, role, polarity FROM output_quality_measures").map((r) => [r.metric, r]));
ok(oq.engaged_reader_sessions_7d.role === "outcome" && oq.engaged_reader_sessions_7d.surface === "papers" && oq.engaged_reader_sessions_7d.polarity === 1, "readers are an outcome of the papers surface");
ok(oq.research_neurons_per_engaged_session_7d.role === "outcome" && oq.research_neurons_per_engaged_session_7d.polarity === -1, "cost per reader is an outcome, lower is better");
ok(oq.outreach_engaged_per_100_clicks_7d.role === "validity" && oq.outreach_engaged_per_100_clicks_7d.surface === "promotion", "the click-to-reader share is a validity measure, not an outcome");
ok(oq.social_engaged_sessions_7d.role === "outcome" && oq.social_engaged_sessions_7d.surface === "promotion" && oq.social_engaged_sessions_7d.polarity === 1, "engaged sessions from social are the promotion outcome");

// the trigger text: a short sentence after the Pillar header, the original levers intact inside the 300 characters a filed issue keeps
const trig = n("SELECT action FROM analytics_metric_triggers WHERE metric_key = 'outreach_human_clicks_7d'").action;
ok(trig.startsWith("Pillar reach. READER-YIELD-1: clicks are not readers;"), "the outreach trigger text points at the reader-grade measure right after the Pillar header", trig.slice(0, 80));
ok(trig.length - ORIG_TRIGGER.length <= 120, "and adds at most 120 characters", trig.length - ORIG_TRIGGER.length);
ok(trig.replace(/ READER-YIELD-1: [^;]*; read [a-z0-9_]+ before lever \(2\)\./, "") === ORIG_TRIGGER, "the original text is otherwise unchanged", trig);
ok(trig.slice(0, 300).includes("Levers in order: (1)"), "the first original lever still sits inside the 300 characters a filed issue keeps");
ok(n("SELECT COUNT(*) c FROM bak_20261104_research_neurons_cfg").c === 1 && n("SELECT COUNT(*) c FROM bak_20261104_outreach_trigger_action").c === 1 && n("SELECT COUNT(*) c FROM bak_20261104_recompute_task").c === 1, "the three edited rows are backed up first");

// predictions parse as "<metric> <op> <value> within <N> d" and name a registered metric
const preds = rows("SELECT predicted_outcome p FROM decision_log WHERE predicted_outcome LIKE '% within %'").map((r) => r.p);
ok(preds.length === 2, "two machine-readable predictions", preds);
for (const p of preds) {
  const m = /^(\S+) (<=|>=|<|>|=) ([0-9.]+) within ([0-9]+) d$/.exec(p);
  ok(!!m && !!n("SELECT 1 x FROM metric_registry WHERE metric = ?", m && m[1]), "prediction is parseable and names a registered metric: " + p);
}
const issues = rows("SELECT id, title, description FROM agent_issues ORDER BY id");
const road = issues.filter((i) => i.title.startsWith("ROADMAP-1: QNFO.REACH READER-YIELD-1."));
ok(issues.length === 5 && road.length === 4, "four ROADMAP-1 rows and the enabling issue", issues.map((i) => i.title));
ok(road.every((i) => /^code-task: repo=qnfo-workers path=[a-z0-9-]+\/worker\.js$/m.test(i.description) && /^code-anchor: .{10,}$/m.test(i.description) && /^code-probe: \{"paths": \["[^"]+"\], "contains": "[^"]+"\}$/m.test(i.description)), "each ROADMAP row carries code-task, code-anchor and code-probe lines");
// the anchors are single-use text the doer replaces; this suite does not read the workers (it would go red when each item lands)
const enable = issues.find((i) => i.title.startsWith("READER-YIELD-1.5:"));
ok(!!enable && /UPDATE ops_config SET value = 'on' WHERE key = 'research_yield_governor'/.test(enable.description) && /Definition of done:/.test(enable.description) && /qnfo-ops/.test(enable.description), "the enabling issue names the owner, the switch and its closing condition");
ok(rows("SELECT issue_id FROM roadmap_proposals").length === 4 && rows("SELECT issue_id FROM roadmap_proposals").every((r) => r.issue_id > 0), "four proposals link their issues");

const card = n("SELECT * FROM human_actions WHERE slug = 'ga4-internal-traffic-1'");
ok(!!card && card.status === "open" && /^IDENTITY-BOUND: /.test(card.why) && card.source === "session:reader-yield", "the GA4 internal-traffic card is filed with an IDENTITY-BOUND line", card && card.why.slice(0, 40));
ok(!!card && !/claude|anthropic/i.test([card.title, card.why, card.default_in_effect, card.action, card.url || ""].join(" ")), "and never routes work to Claude (human_actions_no_claude_ins)");
ok(!!card && card.default_in_effect.length > 40 && /Internal Traffic filter/.test(card.action), "its default stays in effect and its action names the GA4 setting");

// ---- no new task, no new cron: the steps join event-metric-recompute -----------------------------------------------------------------------------------------------------------
ok(n("SELECT COUNT(*) c FROM fleet_tasks").c === 1 && n("SELECT COUNT(*) c FROM fleet_crons").c === 1, "no task and no cron were added");
const task = n("SELECT * FROM fleet_tasks WHERE id = 'event-metric-recompute'");
let steps = [];
try { steps = JSON.parse(task.definition).steps; } catch (e) { ok(false, "the definition is valid JSON", String(e)); }
ok(task.version === 3 && task.timeout_ms === 60000 && task.type === "workflow" && task.enabled === 1, "version bumped, timeout raised to 60 s", { v: task.version, t: task.timeout_ms });
ok(steps.length === 11 && steps.every((s) => s.type === "sql" && s.db === "AUDIT" && typeof s.sql === "string"), "11 sql steps on AUDIT, each with a type", steps.map((s) => s.name));
ok(JSON.stringify(steps.slice(0, 3)) === JSON.stringify(ORIG_STEPS), "the original three steps come first and unchanged");
ok(steps.slice(3).map((s) => s.name).join(",") === "daily-ledger,paper-readership,paper-readership-prune,metrics,governor,remember-write,decision,reader-yield-event", "the eight new steps follow in order", steps.slice(3).map((s) => s.name));
const run = () => { for (const s of steps) db.exec(s.sql); };
const cfg = (k) => n("SELECT value, note, updated_at FROM ops_config WHERE key = ?", k);
const evCount = () => n("SELECT COUNT(*) c FROM cloud_ops_events WHERE kind = 'reader-yield'").c;
const decCount = () => n("SELECT COUNT(*) c FROM decision_log WHERE actor = 'fleet_task reader-yield-refresh'").c;

// shipped defaults, then the fixture calibration (the shipped 64000 x 5.6 a day is the live case; the fixture has 17 a day)
ok(cfg("research_yield_neurons_per_engaged_day").value === "64000" && cfg("research_yield_min_days").value === "28" && cfg("research_yield_floor").value === "180000" && cfg("research_yield_ceiling").value === "450000", "shipped defaults: 64000 neurons per engaged reader a day, 28 days of data, floor 180000, ceiling 450000");
ok(/ask\.qwav\.tech/.test(cfg("reader_internal_sources").value) && /github\.com/.test(cfg("reader_internal_sources").value), "the internal source list ships with the fleet's own hosts");
db.exec("UPDATE ops_config SET value = 'on' WHERE key = 'research_yield_governor'");
ok(n("SELECT reason FROM v_research_volume_target").reason === "needs 28 days of externally sourced GA4 engaged sessions, has 10", "with the shipped 28 days the governor holds still on 10 days of data", n("SELECT reason FROM v_research_volume_target").reason);
db.exec("UPDATE ops_config SET value = 'off' WHERE key = 'research_yield_governor'; UPDATE ops_config SET value = '20000' WHERE key = 'research_yield_neurons_per_engaged_day'; UPDATE ops_config SET value = '7' WHERE key = 'research_yield_min_days'");
// the governor is OFF by default: the key is left alone, the target is published
ok(cfg("research_yield_governor").value === "off", "the governor ships off (qnfo-ops is the single writer of research_daily_neurons)");
let g = n("SELECT * FROM v_research_volume_target");
ok(g.engaged_per_day === 17 && g.target === 340000 && g.reason === "governor off" && g.eligible === 0, "off: the view still publishes the target (340000 at 17 a day) and says why it does not move", g);
run();
ok(cfg("research_daily_neurons").value === "360000" && cfg("research_daily_neurons").note === "PIPELINE-FLOW-POLICY-1 history", "off: a run leaves the key and its note alone");
ok(evCount() === 1 && /governor off/.test(n("SELECT text FROM cloud_ops_events WHERE kind = 'reader-yield'").text), "off: one daily event carries the target and the reason");
ok(decCount() === 0, "off: no decision is logged");

// switched on: engaged 17 a day x 20000 = 340000, a legal single step from 360000 (5.6 percent)
db.exec("UPDATE ops_config SET value = 'on' WHERE key = 'research_yield_governor'; DELETE FROM cloud_ops_events");
g = n("SELECT * FROM v_research_volume_target");
ok(g.target === 340000 && g.step_target === 340000 && g.reason === "moving" && g.eligible === 1, "on: 340000 is a legal single step from 360000", g);
run();
ok(cfg("research_daily_neurons").value === "340000", "on: the first run moves the key to 340000", cfg("research_daily_neurons"));
ok(cfg("research_daily_neurons").note.startsWith("READER-YIELD-1 governor "), "on: and says so in the note");
ok(cfg("research_yield_last_written").value === "340000", "on: it remembers what it wrote");
ok(decCount() === 1 && evCount() === 1, "on: one decision and one daily event for the move");
run();
ok(cfg("research_daily_neurons").value === "340000" && decCount() === 1 && evCount() === 1, "a second run the same day changes nothing, logs nothing, adds no event");
// force a new legal move the same UTC day: the once-a-day guard (the event) holds it
db.exec("UPDATE reader_yield_daily SET ga4_engaged_external = 40 WHERE ga4_engaged_external IS NOT NULL");
g = n("SELECT * FROM v_research_volume_target");
ok(g.eligible === 1 && g.step_target === 374000, "(fixture) readers rise: the view would move again (340000 to 374000)", g);
for (const s of steps.filter((x) => x.name === "governor")) db.exec(s.sql);
ok(cfg("research_daily_neurons").value === "340000", "the governor step does not move the key twice in one UTC day (the event exists)");
db.exec("DELETE FROM cloud_ops_events");
for (const s of steps.filter((x) => x.name === "governor")) db.exec(s.sql);
ok(cfg("research_daily_neurons").value === "374000", "the next UTC day's first governor step moves it 10 percent", cfg("research_daily_neurons").value);
db.exec("UPDATE reader_yield_daily SET ga4_engaged_external = 17 WHERE ga4_engaged_external IS NOT NULL; UPDATE ops_config SET value = '340000', note = 'x' WHERE key = 'research_daily_neurons'; UPDATE ops_config SET value = '340000' WHERE key = 'research_yield_last_written'; DELETE FROM cloud_ops_events");
ok(n("SELECT reason FROM v_research_volume_target").reason === "inside the 2 percent dead band", "inside the dead band the view says so");

// a foreign write pauses the governor
db.exec("UPDATE ops_config SET value = '250000', note = 'someone else', updated_at = datetime('now') WHERE key = 'research_daily_neurons'");
g = n("SELECT * FROM v_research_volume_target");
ok(g.eligible === 0 && /^paused: research_daily_neurons was changed by another writer/.test(g.reason), "another writer's value pauses the governor", g.reason);
run();
ok(cfg("research_daily_neurons").value === "250000" && cfg("research_daily_neurons").note === "someone else", "and the run leaves their value and note alone");
db.exec("UPDATE ops_config SET value = '' WHERE key = 'research_yield_last_written'; DELETE FROM cloud_ops_events");
g = n("SELECT * FROM v_research_volume_target");
ok(g.eligible === 1 && g.step_target === 275000, "setting the memory empty resumes it, limited to 10 percent a day (250000 to 275000)", g);
run();
ok(cfg("research_daily_neurons").value === "275000", "the resumed run moves 10 percent", cfg("research_daily_neurons"));

// floor and ceiling
db.exec("UPDATE ops_config SET value = '360000', note = 'x' WHERE key = 'research_daily_neurons'; UPDATE ops_config SET value = '360000' WHERE key = 'research_yield_last_written'");
db.exec("DELETE FROM reach_signals WHERE source = 'ga4' AND metric = 'engagedSessions'");
for (let b = 1; b <= 10; b++) rs.run(ymd(b), "ga4", "web", "source", "google", "engagedSessions", 1);
db.exec("INSERT OR REPLACE INTO reader_yield_daily SELECT * FROM v_reader_yield_source");
g = n("SELECT * FROM v_research_volume_target");
ok(g.target === 180000 && g.step_target === 324000, "one engaged reader a day aims at the floor (180000) but moves 10 percent a day (324000)", g);
for (let b = 1; b <= 10; b++) db.prepare("UPDATE reach_signals SET value = 100 WHERE source = 'ga4' AND metric = 'engagedSessions' AND date = ?").run(ymd(b));
db.exec("INSERT OR REPLACE INTO reader_yield_daily SELECT * FROM v_reader_yield_source");
g = n("SELECT * FROM v_research_volume_target");
ok(g.target === 450000 && g.step_target === 396000, "100 engaged readers a day aims at the ceiling (450000) in steps of 10 percent (396000)", g);

// neutral with too little data, off, and outside the band
db.exec("UPDATE reader_yield_daily SET ga4_engaged_external = NULL WHERE day < '" + ymd(5) + "'");
g = n("SELECT * FROM v_research_volume_target");
ok(g.eligible === 0 && /^needs 7 days of externally sourced GA4 engaged sessions, has 5$/.test(g.reason), "under 7 days of GA4 rows the governor holds still", g.reason);
db.exec("INSERT OR REPLACE INTO reader_yield_daily SELECT * FROM v_reader_yield_source");
db.exec("UPDATE ops_config SET value = 'off' WHERE key = 'research_yield_governor'");
ok(n("SELECT reason FROM v_research_volume_target").reason === "governor off", "off means off");
db.exec("UPDATE ops_config SET value = 'on' WHERE key = 'research_yield_governor'; UPDATE ops_config SET value = '600000', note = 'owner' WHERE key = 'research_daily_neurons'; UPDATE ops_config SET value = '600000' WHERE key = 'research_yield_last_written'");
ok(/^paused: current value is outside the governor band/.test(n("SELECT reason FROM v_research_volume_target").reason), "a value above the ceiling is somebody's decision: paused");
db.exec("DELETE FROM ops_config WHERE key = 'research_daily_neurons'");
ok(n("SELECT reason FROM v_research_volume_target").reason === "research_daily_neurons unreadable", "a missing key is reported, not invented");

// stale paper rows: never read as current, pruned after 14 days
db.exec("INSERT INTO paper_readership (key64, slug, ext_30d, ga4_sessions_30d, published_at, idea_source, refreshed_at) VALUES ('stale-3d', 'stale-3d', 9, 9, date('now'), 'proposal', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 days')), ('stale-20d', 'stale-20d', 9, 9, date('now'), 'proposal', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-20 days'))");
ok(!rows("SELECT slug FROM v_paper_readers_top").some((r) => /^stale/.test(r.slug)), "a row not refreshed for 2 days is not read as a current top paper");
run();
ok(n("SELECT COUNT(*) c FROM paper_readership WHERE key64 = 'stale-3d'").c === 1 && n("SELECT COUNT(*) c FROM paper_readership WHERE key64 = 'stale-20d'").c === 0, "the prune step deletes rows not refreshed for 14 days and keeps the 3 day old row");

// idempotent apply: the guarded inserts and the appended steps do not duplicate
const snap = () => [n("SELECT COUNT(*) c FROM human_actions").c, n("SELECT COUNT(*) c FROM decision_log").c, n("SELECT COUNT(*) c FROM agent_issues").c, n("SELECT COUNT(*) c FROM roadmap_proposals").c, n("SELECT version FROM fleet_tasks WHERE id = 'event-metric-recompute'").version, n("SELECT definition FROM fleet_tasks WHERE id = 'event-metric-recompute'").definition];
const before = snap();
db.exec(text);
const after = snap();
ok(JSON.stringify(before) === JSON.stringify(after), "applying the file again adds no decision, issue, proposal or step and keeps the version", { before: before.slice(0, 4), after: after.slice(0, 4) });
ok(!/READER-YIELD-1: clicks are not readers;.*READER-YIELD-1: clicks are not readers;/.test(n("SELECT action FROM analytics_metric_triggers WHERE metric_key = 'outreach_human_clicks_7d'").action), "and does not stack the trigger text twice");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
