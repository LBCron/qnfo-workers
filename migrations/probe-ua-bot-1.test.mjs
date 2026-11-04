// PROBE-UA-BOT-1 (2026-11-04): the migration that takes the two click measures out of the outcome list.
// Proves: the header opts in; the two measures become proxies once, with the caveat and the earlier text kept; an unrelated measure is untouched; the prediction parses as
// "<metric> <op> <value> within <N> d" and names a registered metric; a second apply changes nothing; the Rollback line restores role and caveat byte for byte.
// Run: node migrations/probe-ua-bot-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };
const text = readFileSync(new URL("./2026-11-04-probe-ua-bot-1.sql", import.meta.url), "utf8");
ok(/^-- APPLY-BY: ci\s*$/m.test(text) && /^-- DB: qnfo-audit\s*$/m.test(text) && /^-- Rollback: .{40,}$/m.test(text), "header: APPLY-BY ci, DB, one-line Rollback");
ok(!/^\s*(DELETE\s+FROM|DROP\s+)/im.test(text) && !/^\s*(?:UPDATE|DELETE\s+FROM)\s+"?decision_log"?/im.test(text), "no destructive statement, decision_log only appended");

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE output_quality_measures (metric TEXT PRIMARY KEY, surface TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('outcome','proxy','validity')), polarity INTEGER NOT NULL, tol_rel REAL NOT NULL DEFAULT 0.1, tol_abs REAL NOT NULL DEFAULT 0, judged_by TEXT NOT NULL, caveat TEXT);
  CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
  CREATE TRIGGER decision_log_no_update BEFORE UPDATE ON decision_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
  INSERT INTO metric_registry VALUES ('outreach_human_clicks_7d', '940');
  INSERT INTO output_quality_measures VALUES
    ('outreach_human_clicks_7d', 'promotion', 'outcome', 1, 0.15, 10, 'people: UTM clicks classed human', 'clicks, not the quality of a post; email counts'),
    ('outreach_clicks_per_post_7d', 'promotion', 'outcome', 1, 0.15, 0.25, 'people: human clicks per post', 'one channel with a link can dominate it'),
    ('social_engagement_rate_30d', 'promotion', 'outcome', 1, 0.15, 0.02, 'people: engagements per post', 'zero for weeks'),
    ('engaged_human_sessions_28d', 'site', 'outcome', 1, 0.1, 200, 'Cloudflare Web Analytics page views with bots excluded', 'traffic, not satisfaction');
`);
const rows = () => Object.fromEntries(db.prepare("SELECT metric, role, caveat FROM output_quality_measures").all().map((r) => [r.metric, r]));
const before = rows();
db.exec(text);
const after = rows();
for (const m of ["outreach_human_clicks_7d", "outreach_clicks_per_post_7d"]) {
  ok(after[m].role === "proxy", m + " is a proxy now");
  ok(after[m].caveat.startsWith("PROBE-UA-BOT-1 2026-11-04:") && after[m].caveat.endsWith("Was: " + before[m].caveat), m + " keeps its earlier caveat after the new one");
}
ok(after.social_engagement_rate_30d.role === "outcome" && after.engaged_human_sessions_28d.role === "outcome", "other outcomes are untouched");
const preds = db.prepare("SELECT predicted_outcome p FROM decision_log WHERE predicted_outcome LIKE '% within %'").all().map((r) => r.p);
const mm = /^(\S+) (<=|>=|<|>|=) ([0-9.]+) within ([0-9]+) d$/.exec(preds[0] || "");
ok(preds.length === 1 && !!mm && !!db.prepare("SELECT 1 x FROM metric_registry WHERE metric = ?").get(mm[1]), "one parseable prediction naming a registered metric", preds);
db.exec(text);
ok(db.prepare("SELECT COUNT(*) c FROM decision_log").get().c === 1, "a second apply adds no decision");
ok(JSON.stringify(rows()) === JSON.stringify(after), "and changes no measure again (the caveat is not stacked)");
// the Rollback line restores role and caveat exactly
const rb = /^-- Rollback: (.+)$/m.exec(text)[1];
db.exec(rb);
ok(JSON.stringify(rows()) === JSON.stringify(before), "the Rollback line restores role and caveat byte for byte");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
