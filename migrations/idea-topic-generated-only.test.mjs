// TOPIC-DERIVE-GENERATED-1 offline suite: applies migrations/2026-11-05-idea-topic-generated-only.sql on SQLite (node:sqlite) over fixtures of the three tables it touches.
// Proves: the file opts in (APPLY-BY ci, DB qnfo-audit, one single-line Rollback), deletes and drops nothing, writes no metric value (only the daily job does), appends the definition once,
// is re-runnable, and its Rollback restores the formula and the trigger note text for text; and the two worker changes it documents are on this branch (the shared block derives over the
// non-owner producers in both workers, and idea-hub holds a generated accept on the generated population).
// Run: node migrations/idea-topic-generated-only.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "2026-11-05-idea-topic-generated-only.sql"), "utf8");
const hub = readFileSync(join(here, "..", "idea-hub", "worker.js"), "utf8");
const ops = readFileSync(join(here, "..", "qnfo-cloud-ops", "worker.js"), "utf8");
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const lines = sql.split("\n");
const hdr = (k) => (lines.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
ok(hdr("APPLY-BY") === "ci" && hdr("DB") === "qnfo-audit", "the file opts in with APPLY-BY: ci and DB: qnfo-audit");
const rollback = hdr("Rollback");
ok(rollback.length > 300 && lines.filter((l) => /^-- Rollback: /.test(l)).length === 1, "one single-line Rollback");
ok(!/\b(DELETE\s+FROM|DROP)\b/i.test(body), "the body deletes and drops nothing (no BACKUP header owed)");
ok(!/SET\s+last_value|SET\s+last_refreshed/i.test(body), "the file writes no metric value (only the daily job does)");
ok(!/INSERT\s+(OR\s+\w+\s+)?INTO\s+metric_registry/i.test(body), "the file registers no metric (no breach-cause mapping owed)");
ok(!/claude\.ai|anthropic\.com/i.test(sql) && !/skip[ -]ci/i.test(sql), "no claude.ai or anthropic.com link and no skip-CI token");

const mark = "lower(COALESCE(name, '')) NOT LIKE '%owner%'";
ok(hub.includes(mark) && ops.includes(mark) && /TOPIC_DERIVE_SQL = "SELECT name, idea FROM idea_proposals WHERE decision = 'ACCEPT' AND " \+ TOPIC_GENERATED_SQL/.test(hub) && /TOPIC_DERIVE_SQL = "SELECT name, idea FROM idea_proposals WHERE decision = 'ACCEPT' AND " \+ TOPIC_GENERATED_SQL/.test(ops), "both workers derive the clusters over the non-owner producers");
ok(/function diversityVerdict\(/.test(hub) && /DIVERSITY-GENERATED-CAP-1/.test(hub) && /diversityVerdict\(mix, cluster, row\.name\)/.test(hub), "idea-hub triage applies the generated-population check with the proposal's producer");

const FORMULA = "Since 2026-10-13 (TOPIC-CLUSTERS-DERIVED-1): share of ACCEPTed idea_proposals in the last 30 days whose idea text falls in the single largest topic cluster. | OWNER-EXEMPT-METRIC-1 2026-10-20.";
const NOTES = "Owner directive 2026-10-04: arXiv QEC must stop dominating. | OWNER-EXEMPT-METRIC-1 2026-10-20: the metric now excludes owner-sourced rows.";
function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, formula TEXT, last_value TEXT, last_refreshed TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY, metric_key TEXT, notes TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);`);
  w.prepare("INSERT INTO metric_registry VALUES ('idea_topic_concentration_30d', ?, '0.724', '2026-11-04T05:30:57.246Z')").run(FORMULA);
  w.prepare("INSERT INTO metric_registry VALUES ('other_metric', 'other formula', '7', 'then')").run();
  w.prepare("INSERT INTO analytics_metric_triggers (metric_key, notes) VALUES ('idea_topic_concentration_30d', ?)").run(NOTES);
  w.prepare("INSERT INTO analytics_metric_triggers (metric_key, notes) VALUES ('other_metric', 'untouched')").run();
  return w;
}
const w = world();
w.exec(body);
const m = w.prepare("SELECT formula, last_value, last_refreshed FROM metric_registry WHERE metric = 'idea_topic_concentration_30d'").get();
ok(m.formula.startsWith(FORMULA) && /TOPIC-DERIVE-GENERATED-1 2026-11-05/.test(m.formula) && /0\.724/.test(m.formula) && /0\.414/.test(m.formula), "the formula keeps its text and appends the definition with the before and after figures", m.formula.slice(-300));
ok(m.last_value === "0.724" && m.last_refreshed === "2026-11-04T05:30:57.246Z", "the value and its timestamp are untouched by the file");
ok(/TOPIC-DERIVE-GENERATED-1/.test(w.prepare("SELECT notes FROM analytics_metric_triggers WHERE metric_key = 'idea_topic_concentration_30d'").get().notes), "the trigger note records the change");
ok(w.prepare("SELECT formula FROM metric_registry WHERE metric = 'other_metric'").get().formula === "other formula" && w.prepare("SELECT notes FROM analytics_metric_triggers WHERE metric_key = 'other_metric'").get().notes === "untouched", "no other metric or trigger is touched");
const dl = w.prepare("SELECT * FROM decision_log").all();
ok(dl.length === 1 && /^TOPIC-DERIVE-GENERATED-1:/.test(dl[0].action) && /0\.414/.test(dl[0].evidence) && /<= 0\.5/.test(dl[0].predicted_outcome) && dl[0].rollback_path.length > 20, "one decision_log row with the evidence, the prediction and the revert path", dl[0]);
const snap = () => JSON.stringify([w.prepare("SELECT * FROM metric_registry").all(), w.prepare("SELECT * FROM analytics_metric_triggers").all(), w.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
const once = snap();
w.exec(body);
ok(snap() === once, "a second apply changes nothing");
const pre = world();
const preSnap = JSON.stringify([pre.prepare("SELECT formula, last_value FROM metric_registry").all(), pre.prepare("SELECT notes FROM analytics_metric_triggers").all()]);
w.exec(rollback);
ok(JSON.stringify([w.prepare("SELECT formula, last_value FROM metric_registry").all(), w.prepare("SELECT notes FROM analytics_metric_triggers").all()]) === preSnap, "the Rollback restores the formula and the trigger note text for text");
// The follow-up file (TOPIC-TEMPLATE-FAMILY-1): same rules, applied on top of the first.
{
  const sql2 = readFileSync(join(here, "2026-11-05-idea-topic-template-family.sql"), "utf8");
  const body2 = sql2.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  const lines2 = sql2.split("\n");
  const h2 = (k) => (lines2.find((l) => new RegExp("^-- " + k + ": ").test(l)) || "").replace(new RegExp("^-- " + k + ": "), "");
  ok(h2("APPLY-BY") === "ci" && h2("DB") === "qnfo-audit" && h2("Rollback").length > 200 && lines2.filter((l) => /^-- Rollback: /.test(l)).length === 1, "follow-up: opts in, one single-line Rollback");
  ok(!/\b(DELETE\s+FROM|DROP)\b/i.test(body2) && !/SET\s+last_value|SET\s+last_refreshed/i.test(body2) && !/INSERT\s+(OR\s+\w+\s+)?INTO\s+metric_registry/i.test(body2), "follow-up: deletes nothing, writes no value, registers no metric");
  ok(/function topicProducer\(/.test(hub) && /function topicProducer\(/.test(ops) && /src: topicProducer\(r && r\.name\)/.test(hub) && /src: topicProducer\(r && r\.name\)/.test(ops), "follow-up: both workers take the producer for the boilerplate rule from the name up to its first colon");
  const w2 = world();
  w2.exec(body);
  const afterFirst = JSON.stringify(w2.prepare("SELECT formula FROM metric_registry WHERE metric = 'idea_topic_concentration_30d'").get());
  w2.exec(body2);
  const f2 = w2.prepare("SELECT formula, last_value FROM metric_registry WHERE metric = 'idea_topic_concentration_30d'").get();
  ok(f2.formula.includes("TOPIC-DERIVE-GENERATED-1") && f2.formula.includes("TOPIC-TEMPLATE-FAMILY-1") && f2.last_value === "0.724", "follow-up: the formula carries both notes and the value is untouched");
  const snap2 = JSON.stringify(w2.prepare("SELECT * FROM metric_registry").all()) + w2.prepare("SELECT COUNT(*) n FROM decision_log").get().n;
  w2.exec(body2);
  ok(snap2 === JSON.stringify(w2.prepare("SELECT * FROM metric_registry").all()) + w2.prepare("SELECT COUNT(*) n FROM decision_log").get().n, "follow-up: a second apply changes nothing");
  ok(w2.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 2, "follow-up: two decision_log rows in all");
  w2.exec(h2("Rollback"));
  ok(JSON.stringify(w2.prepare("SELECT formula FROM metric_registry WHERE metric = 'idea_topic_concentration_30d'").get()) === afterFirst, "follow-up: the Rollback restores the formula to the state after the first file");
}
console.log(`idea-topic-generated-only (migration): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
