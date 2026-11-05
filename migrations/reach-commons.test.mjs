// REACH-COMMONS-1 migration suite (blue-sky roadmap rows 3261 to 3267): migrations/2026-11-05-reach-commons.sql adds the AI reach views over reach_signals, four metrics with one hourly
// refresh trigger, two metric triggers, the cause mappings and five follow-up issues. Run on a SQLite fixture with the production column layouts.
// Run: node --no-warnings migrations/reach-commons.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sql = readFileSync(join(here, "2026-11-05-reach-commons.sql"), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 300) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql) && /^-- CAUSE-MAPPED: .{10,}$/m.test(sql) && /^-- METRIC-EXEMPT: ai_assistant_fetches_7d and answer_engine_referrals_7d .{10,}$/m.test(sql), "headers: APPLY-BY, DB, Rollback, CAUSE-MAPPED and the exemption");
ok(!/\b(DELETE|DROP)\s/i.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")), "the file body runs no DELETE or DROP (no BACKUP table needed)");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE reach_signals (date TEXT NOT NULL, source TEXT NOT NULL, channel TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metric TEXT NOT NULL, value REAL, quality TEXT CHECK (quality IN ('human','bot','unknown')), collected_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, source, channel, entity_type, entity_id, metric));
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE fleet_tick (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT);
CREATE TABLE infra_state (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, data TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT, note TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);`);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const sig = db.prepare("INSERT INTO reach_signals (date, source, channel, entity_type, entity_id, metric, value, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
const fetchRow = (n, bot, v) => sig.run(day(n), "seo-crawl", "agent", "bot", bot, "fetches", v, "bot");
const refRow = (n, src, host, v) => sig.run(day(n), src, "web", "referrer", host, "pageloads", v, src === "reach-ae" ? "unknown" : "human");

// four days of fetches: under the five-day floor, the metric must read NULL / UNMEASURED
for (let n = 1; n <= 4; n++) { fetchRow(n, "gptbot", 100); fetchRow(n, "claudebot", 50); fetchRow(n, "googlebot-image", 999); }
for (let n = 1; n <= 4; n++) { refRow(n, "cf-rum-human", "(direct)", 50); refRow(n, "cf-rum-human", "bing.com", 5); }
db.exec(sql);
let v = db.prepare("SELECT * FROM v_ai_reach_7d").get();
ok(v.fetch_days === 4 && v.ai_fetches === 600 && v.answer_engine_referrals === 0 && v.referral_days === 4, "four days of data: counts are right and a non-AI bot (googlebot-image) is not an AI fetch", v);
const reg = (k) => db.prepare("SELECT last_value v, state s, refresh_class rc, kind FROM metric_registry WHERE metric = ?").get(k);
ok(reg("ai_assistant_fetches_7d").v === null && reg("ai_assistant_fetches_7d").s === "UNMEASURED", "under five days of fetches the metric is NULL and UNMEASURED, never 0", reg("ai_assistant_fetches_7d"));
ok(reg("answer_engine_referrals_7d").v === null && reg("answer_engine_referrals_7d").s === "UNMEASURED", "under five days of referrer data the referral metric is NULL too");

// seven days + an answer-engine referral on two instruments + today's partial row
for (let n = 5; n <= 7; n++) { fetchRow(n, "gptbot", 100); fetchRow(n, "claudebot", 50); refRow(n, "cf-rum-human", "(direct)", 50); }
fetchRow(0, "gptbot", 5000);                       // today is partial and outside the window
fetchRow(2, "chatgpt-user", 12);
refRow(2, "cf-rum-human", "chatgpt.com", 3); refRow(3, "cf-rum-human", "perplexity.ai", 2); refRow(3, "cf-rum", "claude.ai", 40);   // cf-rum (not human) is ignored
refRow(4, "reach-ae", "claude.ai", 7); refRow(4, "cf-rum-human", "claude.ai.evil.example", 9); refRow(4, "cf-rum-human", "notchatgpt.com", 9);
db.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:test')").run();
v = db.prepare("SELECT * FROM v_ai_reach_7d").get();
ok(v.fetch_days === 7 && v.ai_fetches === 7 * 150 + 12 && v.ai_user_fetches === 12, "seven days: today's partial row is outside the window; chatgpt-user is also counted on its own", v);
ok(v.answer_engine_referrals === 5 && v.answer_engine_referrals_edge === 7, "referrals count exact hosts of ai_referrer_hosts, cf-rum-human only, with the edge instrument beside; look-alike hosts and non-human rows do not count", v);
ok(reg("ai_assistant_fetches_7d").v === String(7 * 150 + 12) && reg("ai_assistant_fetches_7d").s === "MEASURED", "the tick refreshes the fetch metric from day five", reg("ai_assistant_fetches_7d"));
ok(reg("answer_engine_referrals_7d").v === "5" && reg("answer_engine_referrals_7d").s === "MEASURED" && reg("answer_engine_referrals_7d").rc === "computed", "the tick refreshes the referral metric");
const daily = db.prepare("SELECT * FROM v_ai_reach_daily ORDER BY date").all();
ok(daily.length >= 8 && daily.every((r) => Number.isFinite(r.ai_fetches) && Number.isFinite(r.referrer_loads)), "the 30-day series has one row per day with data", daily.length);

// atlas freshness metric
ok(reg("atlas_export_age_h").v === null && reg("atlas_export_age_h").s === "UNMEASURED", "before the first export atlas_export_age_h is NULL and UNMEASURED");
db.prepare("INSERT INTO infra_state VALUES ('atlas_export', ?, 'atlas_export', '{}')").run(new Date(Date.now() - 5 * 3600 * 1000).toISOString());
db.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:test')").run();
const age = Number(reg("atlas_export_age_h").v);
ok(age >= 4.9 && age <= 5.2 && reg("atlas_export_age_h").s === "MEASURED", "after an export 5 hours ago it reads about 5 (an ISO time with milliseconds and Z parses)", age);
db.prepare("INSERT INTO infra_state VALUES ('atlas_export_error', ?, 'x', '{\"error\":\"boom\"}')").run(new Date().toISOString());
db.prepare("INSERT INTO fleet_tick (source) VALUES ('migration:test')").run();
ok(Math.abs(Number(reg("atlas_export_age_h").v) - age) < 0.5, "an error row does not reset the age (only a success does)");

// registry, triggers, causes
ok(["ai_assistant_fetches_7d", "answer_engine_referrals_7d", "ai_crawler_block_zones", "atlas_export_age_h"].every((k) => !!reg(k)), "four metrics registered");
ok(reg("ai_crawler_block_zones").s === "UNMEASURED" && reg("ai_crawler_block_zones").v === null && reg("ai_crawler_block_zones").rc === "worker-written" && reg("ai_crawler_block_zones").kind === "guard", "the block guard starts UNMEASURED and is written by the worker");
const trg = db.prepare("SELECT metric_key k, operator o, threshold t, enabled e, queue_target q FROM analytics_metric_triggers ORDER BY metric_key").all();
ok(trg.length === 2 && trg[0].k === "ai_crawler_block_zones" && trg[0].o === "gt" && trg[0].t === 0 && trg[1].k === "atlas_export_age_h" && trg[1].t === 48 && trg.every((r) => r.e === 1 && r.q === "agent_issues"), "two metric triggers: a block above 0 and an export older than 48 hours", trg);
const CAUSES = ["publishing", "structure", "issue-backlog", "code-loop", "spend", "measurement", "heartbeat", "owner-routing", "breach-doctor"];
const cs = db.prepare("SELECT metric_key k, cause_key c FROM metric_breach_cause").all();
ok(cs.length === 4 && cs.every((r) => CAUSES.includes(r.c)), "all four metrics map to a known breach cause", cs);
ok(db.prepare("SELECT action FROM analytics_metric_triggers WHERE metric_key = 'atlas_export_age_h'").get().action.includes("code-anchor: async function publishAtlas(env, nowMs) {"), "the export trigger carries a code-task and an anchor");
const hosts = db.prepare("SELECT host FROM ai_referrer_hosts").all().map((r) => r.host);
ok(hosts.includes("chatgpt.com") && hosts.includes("perplexity.ai") && hosts.includes("claude.ai") && hosts.includes("gemini.google.com") && !hosts.some((h) => /google\.com$/.test(h) && h === "google.com"), "answer-engine hosts include the large assistants and not plain google.com");

// issues: doer, anchor once in the target file, probes parse
const issues = db.prepare("SELECT title, description, source, priority, status FROM agent_issues").all();
ok(issues.length === 6 && issues.every((i) => i.status === "open" && i.source === "session:W2-I" && /^ROADMAP-1: QNFO\.(REACH|RSCH) [A-Z0-9-]+: /.test(i.title)), "six open ROADMAP-1 issues from this session", issues.map((i) => i.title.slice(0, 50)));
for (const i of issues) {
  const task = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(i.description);
  const anchor = /^code-anchor: (.+)$/m.exec(i.description);
  const name = i.title.split(" ")[2].replace(/:$/, "");
  if (!task) { ok(/doer: program-manager:QNFO\.RSCH/.test(i.description) && /IDENTITY-BOUND:/.test(i.description), name + ": an issue without a code-task names its doer and its IDENTITY-BOUND step"); }
  else {
    const file = readFileSync(join(root, task[1]), "utf8");
    ok(anchor && file.split(anchor[1]).length - 1 === 1, name + ": the anchor occurs exactly once in " + task[1], anchor && file.split(anchor[1]).length - 1);
  }
  const probes = [...i.description.matchAll(/^(runtime-probe|code-probe): (\{.+\})$/gm)];
  ok(probes.length >= 1 && probes.every((p) => { try { return typeof JSON.parse(p[2]) === "object"; } catch (e) { return false; } }), name + ": every probe line is valid JSON");
  const rt = probes.find((p) => p[1] === "runtime-probe");
  ok(!rt || (JSON.parse(rt[2]).contains || JSON.parse(rt[2]).absent), name + ": a runtime probe names a marker, so it cannot pass on any page");
  const cp = probes.find((p) => p[1] === "code-probe");
  ok(!cp || (JSON.parse(cp[2]).contains && !file_has(JSON.parse(cp[2]))), name + ": the code probe's marker is not in the file yet, so it fails until the work is done");
}
function file_has(p) { return p.paths.some((f) => readFileSync(join(root, f), "utf8").includes(p.contains)); }
ok(db.prepare("SELECT COUNT(*) c FROM decision_log WHERE actor = 'session:W2-I'").get().c === 1, "one decision_log row");

// idempotent replay
db.exec(sql);
ok(db.prepare("SELECT COUNT(*) c FROM agent_issues").get().c === 6 && db.prepare("SELECT COUNT(*) c FROM analytics_metric_triggers").get().c === 2 && db.prepare("SELECT COUNT(*) c FROM decision_log").get().c === 1 && db.prepare("SELECT COUNT(*) c FROM metric_registry").get().c === 4 && db.prepare("SELECT COUNT(*) c FROM metric_breach_cause").get().c === 4, "a replay adds nothing");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
