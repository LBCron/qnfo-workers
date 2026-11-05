// LOOP-FAILURES-1 offline suite: each rewritten closing probe still fails on the condition it was written for and passes on the recovered state; the evidence-guard window, the 499 class
// and the three cron expressions move as described; a second run changes nothing.
// Run: node --no-warnings migrations/loop-failure-probes.test.mjs   (exit 0 = all passed)
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const rd = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = rd("2026-11-05-loop-failure-probes.sql");
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (x !== undefined ? "  -- " + JSON.stringify(x).slice(0, 400) : "")); } };
ok(/^-- APPLY-BY: ci$/m.test(sql) && /^-- DB: qnfo-audit$/m.test(sql) && /^-- Rollback: .+/m.test(sql), "migration opts in with APPLY-BY, DB and Rollback headers");

// the live probe texts of 2026-11-04 23:20Z (the text each UPDATE replaces)
const OLD = {
  "issue-1000793": "WITH info AS (SELECT (SELECT COUNT(*) FROM pragma_table_info('products') WHERE name='key') AS has_key, (SELECT COUNT(*) FROM products) AS n) SELECT 'products table has key column and at least 6 rows' AS expected, CASE WHEN has_key=1 AND n>=6 THEN 'products table has key column and at least 6 rows' WHEN has_key=0 THEN 'products table has no key column' ELSE 'products table has only ' || n || ' rows' END AS observed FROM info",
  "issue-1001682": "SELECT 'ok' AS expected, COALESCE((SELECT status FROM migration_runs WHERE file = 'migrations/2026-11-02-management-personas-metric-intake.sql' ORDER BY applied_at DESC, id DESC LIMIT 1), 'missing') AS observed",
  "issue-1000610": "WITH p AS (SELECT platform, published_at, json_extract(engagement_metrics,'$.via') AS via, LAG(published_at) OVER (PARTITION BY platform ORDER BY published_at) AS prev, LAG(json_extract(engagement_metrics,'$.via')) OVER (PARTITION BY platform ORDER BY published_at) AS prev_via, (julianday(substr(published_at,1,19)) - julianday(substr(LAG(published_at) OVER (PARTITION BY platform ORDER BY published_at),1,19))) * 1440 AS gap_min FROM social_media_posts WHERE status = 'published' AND platform IN ('buffer-linkedin','buffer-x','buffer-mastodon','bluesky-rollup') AND published_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days')), w AS (SELECT platform, prev, published_at, via, prev_via, gap_min FROM p WHERE gap_min IS NOT NULL ORDER BY gap_min LIMIT 1) SELECT 'ok' AS expected, CASE WHEN (SELECT COUNT(*) FROM w) = 0 THEN 'ok' ELSE (SELECT platform || ' ' || prev || ' (' || prev_via || ') -> ' || published_at || ' (' || via || '), gap ' || CAST(ROUND(gap_min,1) AS TEXT) || ' min < 360' FROM w) END AS observed",
  "issue-1001636": "SELECT 'runs_without_0_1_figure_7d=0' AS expected, 'runs_without_0_1_figure_7d=' || COUNT(*) AS observed FROM improvement_loop_runs WHERE ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days') AND (json_extract(state_json,'$.fix_target_hold_rate_30d') IS NULL OR json_type(state_json,'$.fix_target_hold_rate_30d') NOT IN ('integer','real') OR json_extract(state_json,'$.fix_target_hold_rate_30d') <= 0 OR json_extract(state_json,'$.fix_target_hold_rate_30d') >= 1)",
  "issue-1001568": "SELECT 'verified' AS expected, CASE WHEN EXISTS (SELECT 1 FROM cf_model_evals e JOIN cf_model_eval_battery b ON b.battery_version = e.battery_version AND b.kind = 'chat' AND b.enabled = 1 WHERE e.model_id = '@cf/qwen/qwen3-30b-a3b-fp8' AND e.battery_version = 'cfmb-2' AND e.verdict = 'promote' AND b.grader = 'json_field' AND (b.options IS NULL OR trim(b.options) = '')) THEN 'unverified: chat-json passes under json_field with no options' ELSE 'verified' END AS observed",
  "issue-1001569": "SELECT 'active=0 pending canary' AS expected, 'active=' || CAST(active AS TEXT) AS observed FROM model_ladder_models WHERE model_id='@cf/google/gemma-4-26b-a4b-it'",
  "issue-1001463": "WITH f AS (SELECT COALESCE(SUM(count),0) AS c499, MAX(ts) AS last_ts FROM ai_gateway_failures WHERE status = 499 AND model = 'dynamic/value' AND source = 'qnfo-ai-calibration' AND ts >= unixepoch('now')*1000 - 86400000) SELECT 'no 499 on dynamic/value' AS expected, CASE WHEN c499 = 0 THEN 'no 499 on dynamic/value' ELSE '499 x' || c499 || ' on dynamic/value' END AS observed FROM f",
  "issue-1001618": "SELECT '0' AS expected, CAST(COALESCE(SUM(count), 0) AS TEXT) AS observed FROM ai_gateway_failures WHERE model = 'dynamic/premium' AND status = 499 AND source = 'qnfo-ai-calibration' AND ts >= CAST(strftime('%s','now') AS INTEGER) * 1000 - 86400000",
};
const EVIDENCE_PROBE = "SELECT 'ok' AS expected, CASE WHEN NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'agent_issues_evidence_annotate_ai' AND tbl_name = 'agent_issues' AND sql LIKE '%NO-SILENT%') THEN 'the annotate trigger agent_issues_evidence_annotate_ai is missing' WHEN EXISTS (SELECT 1 FROM agent_issues a WHERE a.source LIKE 'cloud_ops_events:%' AND typeof(a.created_at) = 'integer' AND a.created_at > (CAST(strftime('%s', 'now') AS INTEGER) - 1209600) * 1000 AND NOT EXISTS (SELECT 1 FROM cloud_ops_events e WHERE e.id = substr(a.source, 18)) AND COALESCE(a.description, '') NOT LIKE '%the cited evidence event%') THEN 'an issue of the last 14 days cites a missing event and carries no annotation' ELSE 'ok' END AS observed";

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, status TEXT, verify_probe TEXT, verify_transport TEXT, last_verdict TEXT, attempts INTEGER, next_due_at TEXT);
CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT);
CREATE TABLE fleet_crons (id INTEGER PRIMARY KEY, name TEXT, cron_expr TEXT, next_fire TEXT, updated_at TEXT);
CREATE TABLE ai_gateway_failures (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, model TEXT, status INTEGER, count INTEGER, error_class TEXT, sample_detail TEXT, source TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT, status TEXT, applied_at TEXT);
CREATE TABLE products (slug TEXT PRIMARY KEY);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE model_ladder_models (id TEXT PRIMARY KEY, active INTEGER);
CREATE TABLE social_media_posts (id INTEGER PRIMARY KEY, platform TEXT, status TEXT, published_at TEXT, engagement_metrics TEXT);
CREATE TABLE improvement_loop_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, state_json TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, source TEXT, created_at INTEGER, description TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT);
CREATE TABLE cf_model_evals (model_id TEXT, battery_version TEXT, verdict TEXT);
CREATE TABLE cf_model_eval_battery (battery_version TEXT, kind TEXT, enabled INTEGER, grader TEXT, options TEXT);
INSERT INTO cf_model_evals VALUES ('@cf/qwen/qwen3-30b-a3b-fp8', 'cfmb-2', 'promote');
INSERT INTO cf_model_eval_battery VALUES ('cfmb-2', 'chat', 1, 'json_field', NULL);
CREATE TRIGGER agent_issues_evidence_annotate_ai AFTER INSERT ON agent_issues WHEN NEW.source LIKE 'cloud_ops_events:%' BEGIN SELECT 'NO-SILENT-DROP-1'; END;
`);
for (const [c, p] of Object.entries(OLD)) db.prepare("INSERT INTO remediation_contracts VALUES (?, 'active', ?, 'd1-query', 'fail', 3, '2026-11-04 22:00:00')").run(c, p);
db.prepare("INSERT INTO control_alternate_probes VALUES ('agent-issues-evidence-guard', ?, '14 days: the trigger text')").run(EVIDENCE_PROBE);
db.exec(`INSERT INTO fleet_crons (id, name, cron_expr) VALUES (84, 'management-personas-b-hourly', '42 * * * *'), (85, 'management-personas-c-hourly', '49 * * * *'), (87, 'staff-roster-hourly', '52 * * * *'), (90, 'blind-spot-audit-hourly', '55 * * * *')`);
const ts = (daysAgo) => Date.now() - daysAgo * 86400000;
db.prepare("INSERT INTO ai_gateway_failures (ts, model, status, count, error_class, source) VALUES (?, 'dynamic/value', 499, 2, 'other', 'qnfo-ai-calibration'), (?, 'dynamic/premium', 499, 3, 'other', 'qnfo-ai-calibration'), (?, 'dynamic/value', 499, 1, 'client-closed', 'qnfo-ai-calibration'), (?, 'dynamic/value', 504, 1, 'upstream', 'qnfo-ai-calibration'), (?, 'dynamic/value', 499, 1, 'other', 'qnfo-ai-calibration')").run(ts(0.2), ts(0.3), ts(0.1), ts(0.05), ts(30));

const probe = (cls) => db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get(cls).verify_probe;
const run = (cls) => {
  try { const r = db.prepare(probe(cls)).get(); return { expected: r.expected, observed: r.observed, pass: String(r.expected) === String(r.observed) }; }
  catch (e) { return { expected: null, observed: "probe error: " + e.message, pass: false }; }
};
const evidence = () => { const r = db.prepare(db.prepare("SELECT probe_sql FROM control_alternate_probes").get().probe_sql).get(); return String(r.expected) === String(r.observed) ? "ok" : String(r.observed); };

// state before: recovered facts, but the old probes cannot see them
db.exec(`INSERT INTO migration_runs (file, status, applied_at) VALUES ('migrations/2026-10-29-plus-1-products.sql', 'ok', '2026-11-01T08:36:52Z'), ('migrations/2026-11-02-management-personas-metric-intake.sql', 'ok', '2026-11-02T17:41:49Z'), ('migrations/2026-11-02-management-personas-metric-intake.sql', 'error', '2026-11-04T15:55:14Z')`);
db.exec(`INSERT INTO products VALUES ('a'), ('b'), ('c'), ('d'), ('e'), ('f'), ('g')`);
db.exec(`INSERT INTO ops_config VALUES ('code_merge_trusted_sources', 'x,management-personas|METRIC-UNMEASURED-1:,y')`);
db.exec(`INSERT INTO decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path) VALUES ('s', 'a', 'MANAGEMENT-PERSONAS-METRIC-INTAKE-1: x', 'e', 'o', 'b', 'r')`);
db.exec(`INSERT INTO model_ladder_models VALUES ('@cf/qwen/qwen3-30b-a3b-fp8', 1)`);
// 1000610: the smallest gap is 420 minutes (above the 360 floor) in the recovered state
db.exec(`INSERT INTO social_media_posts (platform, status, published_at, engagement_metrics) VALUES ('bluesky-rollup', 'published', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days'), '{"via":"rollup"}'), ('bluesky-rollup', 'published', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 days','+420 minutes'), '{"via":"rollup"}')`);
// 1001636: three bad runs 7 to 15 hours ago, five good runs in the last 6 hours
for (const h of [15, 10, 7]) db.prepare("INSERT INTO improvement_loop_runs (ts, state_json) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now',?), '{}')").run("-" + h + " hours");
for (const h of [5, 4, 3, 2, 1]) db.prepare("INSERT INTO improvement_loop_runs (ts, state_json) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now',?), '{\"fix_target_hold_rate_30d\":0.53}')").run("-" + h + " hours");
// evidence guard: an old closed issue cites a pruned event, a fresh one is annotated
db.prepare("INSERT INTO agent_issues VALUES (1, 'cloud_ops_events:evt-gone', ?, 'old closed issue')").run(Math.floor(ts(10)));

const before = { o1: run("issue-1000793"), o2: run("issue-1001682"), o3: run("issue-1000610"), o4: run("issue-1001636"), o5: run("issue-1001568"), o6: run("issue-1001569"), o7: run("issue-1001463"), o8: run("issue-1001618") };
ok(before.o5.pass === false && before.o6.pass === false, "before: 1001568 reads unverified and 1001569 reads a column that does not exist", [before.o5, before.o6]);
ok(before.o1.pass === false, "before: 1000793 probe reads no key column", before.o1);
ok(before.o3.pass === false && /gap 420\.0 min < 360/.test(before.o3.observed), "before: 1000610 reports a gap of 420 minutes as a violation of 360", before.o3);
ok(before.o4.pass === false, "before: 1001636 sees the old bad runs in its 7-day window", before.o4);
ok(before.o7.pass === false && before.o8.pass === false, "before: 1001463 and 1001618 count the raw 499 rows", [before.o7, before.o8]);
ok(evidence() !== "ok" && /last 14 days/.test(evidence()), "before: the evidence-guard probe flags the 10-day-old closed issue", evidence());

db.exec(sql);

ok(run("issue-1000793").pass === true, "1000793: passes on the recovered state (latest run ok, 7 products)", run("issue-1000793"));
ok(run("issue-1001682").pass === true, "1001682: passes although the newest migration_runs row is an error (the effect is present)", run("issue-1001682"));
ok(run("issue-1000610").pass === true, "1000610: a smallest gap of 420 minutes is no violation", run("issue-1000610"));
ok(run("issue-1001636").pass === true && /_6h=/.test(run("issue-1001636").observed), "1001636: the 6-hour window holds no bad run", run("issue-1001636"));
ok(run("issue-1001568").pass === true && run("issue-1001569").pass === false, "1001568 passes (model registered); 1001569 fails while its model is not a ladder row", [run("issue-1001568"), run("issue-1001569")]);
db.exec("INSERT INTO model_ladder_models VALUES ('@cf/google/gemma-4-26b-a4b-it', 1)");
ok(run("issue-1001569").pass === true, "1001569: passes once the model is a ladder row", run("issue-1001569"));
ok(run("issue-1001463").pass === true && run("issue-1001618").pass === true, "1001463 and 1001618 pass: the 499 rows are client-closed now", [run("issue-1001463"), run("issue-1001618")]);
ok(db.prepare("SELECT status, last_verdict, attempts FROM remediation_contracts WHERE class = 'issue-1001569'").get().status === "active", "the contracts are re-armed (status active)");
ok(db.prepare("SELECT last_verdict FROM remediation_contracts WHERE class = 'issue-1000610'").get().last_verdict === null, "the old fail verdict is cleared so the close guard does not hold on it");

// each probe still fails on the defect it was written for
db.exec("DELETE FROM migration_runs WHERE file LIKE '%plus-1-products%'");
ok(run("issue-1000793").pass === false, "1000793 fails again when the file has no ok run", run("issue-1000793"));
db.exec("INSERT INTO migration_runs (file, status) VALUES ('migrations/2026-10-29-plus-1-products.sql', 'error')");
ok(run("issue-1000793").pass === false, "1000793 fails when the latest run is an error", run("issue-1000793"));
db.exec("UPDATE ops_config SET value = 'x,y' WHERE key = 'code_merge_trusted_sources'");
ok(run("issue-1001682").pass === false && /trusted-source/.test(run("issue-1001682").observed), "1001682 fails when the trusted-source entry is gone", run("issue-1001682"));
db.exec(`INSERT INTO social_media_posts (platform, status, published_at, engagement_metrics) VALUES ('buffer-linkedin', 'published', strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days'), '{"via":"channel-drain"}'), ('buffer-linkedin', 'published', strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 days','+300 minutes'), '{"via":"cross-post"}')`);
ok(run("issue-1000610").pass === false && /gap 300\.0 min < 360/.test(run("issue-1000610").observed), "1000610 still fails on a real 300-minute pair", run("issue-1000610"));
db.exec("INSERT INTO improvement_loop_runs (ts, state_json) VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 minutes'), '{}')");
ok(run("issue-1001636").pass === false, "1001636 fails when a run in the last 6 hours lacks the figure", run("issue-1001636"));
db.prepare("INSERT INTO ai_gateway_failures (ts, model, status, count, error_class, source) VALUES (?, 'dynamic/value', 499, 1, 'other', 'qnfo-ai-calibration')").run(ts(0.01));
ok(run("issue-1001463").pass === false, "1001463 still fails on a 499 that is not client-closed", run("issue-1001463"));

// the 499 rows: recent 'other' became client-closed, the 30-day-old row and the 504 are untouched
ok(db.prepare("SELECT COUNT(*) n FROM ai_gateway_failures WHERE status = 499 AND error_class = 'client-closed'").get().n === 3, "three recent 499 rows are client-closed", db.prepare("SELECT status, error_class FROM ai_gateway_failures").all());
ok(db.prepare("SELECT error_class FROM ai_gateway_failures WHERE status = 504").get().error_class === "upstream", "the 504 row keeps its class");
ok(db.prepare("SELECT error_class FROM ai_gateway_failures WHERE ts < ?").get(Math.floor(ts(20))).error_class === "other", "a 499 row older than 7 days is left alone");
ok(db.prepare("SELECT COUNT(*) n FROM bak_20261105_loop_failure_gw499").get().n === 2, "the backup holds the 2 rewritten 499 rows");

// evidence guard
ok(evidence() === "ok", "evidence guard: the 10-day-old closed issue no longer trips the 2-day probe", evidence());
db.prepare("INSERT INTO agent_issues VALUES (2, 'cloud_ops_events:evt-gone2', ?, 'fresh and unannotated')").run(Math.floor(ts(0.5)));
ok(/last 2 days/.test(evidence()), "evidence guard: a fresh unannotated issue citing a missing event still trips it", evidence());
db.exec("UPDATE agent_issues SET description = description || ' the cited evidence event is missing' WHERE id = 2");
ok(evidence() === "ok", "evidence guard: annotation clears it");

// crons
const cron = (n) => db.prepare("SELECT cron_expr FROM fleet_crons WHERE name = ?").get(n).cron_expr;
ok(cron("management-personas-b-hourly") === "40 * * * *" && cron("management-personas-c-hourly") === "15 * * * *" && cron("staff-roster-hourly") === "25 * * * *" && cron("blind-spot-audit-hourly") === "55 * * * *", "crons moved to :40, :15, :25 and the grid cron is untouched");
ok(db.prepare("SELECT COUNT(*) n FROM fleet_crons WHERE CAST(substr(cron_expr, 1, instr(cron_expr, ' ') - 1) AS INTEGER) % 5 <> 0").get().n === 0, "no fleet_crons row is off the 5-minute grid");

// idempotent
const snap = JSON.stringify([db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all(), db.prepare("SELECT * FROM fleet_crons ORDER BY id").all(), db.prepare("SELECT * FROM control_alternate_probes").all()]).replace(/"updated_at":"[^"]*"/g, "").replace(/"next_due_at":"[^"]*"/g, "");
db.exec(sql);
const snap2 = JSON.stringify([db.prepare("SELECT * FROM remediation_contracts ORDER BY class").all(), db.prepare("SELECT * FROM fleet_crons ORDER BY id").all(), db.prepare("SELECT * FROM control_alternate_probes").all()]).replace(/"updated_at":"[^"]*"/g, "").replace(/"next_due_at":"[^"]*"/g, "");
ok(snap === snap2, "a second run changes no probe, cron or control row");
ok(db.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'LOOP-FAILURES-1:%'").get().n === 1, "one decision_log row after two runs");

console.log((fail ? "FAIL " : "ok ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
