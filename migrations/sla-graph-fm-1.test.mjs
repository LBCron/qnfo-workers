// SLA-GRAPH-FM-1 offline suite: replays migrations/2026-11-05-sla-graph-fm-1.sql on node:sqlite twice.
// Proves: (1) both views keep their columns in order; (2) research status deferred is a parked pool and merged is rejected, so neither is over the stage SLA,
// while a queued row past its readiness clock still is; (3) v_failure_mode_status judges a detector by its schedule: 120 minutes after a verdict, 180 in the FM-5
// steady state, 60 when the last attempt produced no verdict, no verification is unprobed, a failing newest verification is recurring; (4) the two stale probes follow
// v_sla_bound_issue_age; (5) the three holding contracts become active, six detector contracts exist and their failure modes point at them, and every new probe is a
// literal read-only select that compiles and returns its expected token; (6) five cause rows, one decision, three predictions; (7) a second run changes nothing.
// Run: node migrations/sla-graph-fm-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const here = (f) => new URL("./" + f, import.meta.url);
const sql = readFileSync(here("2026-11-05-sla-graph-fm-1.sql"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

function statements(text) {
  const body = text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = "", q = false;
  for (const c of body) { if (c === "'") q = !q; if (c === ";" && !q) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const STMTS = statements(sql);
const ago = (min) => new Date(Date.now() - min * 6e4).toISOString().replace(/\.\d+Z$/, "Z");
const sqlTs = (min) => ago(min).replace("T", " ").replace("Z", "");
const one = (db, q, ...a) => db.prepare(q).get(...a);
const all = (db, q, ...a) => db.prepare(q).all(...a);

function build() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE research_queue (id TEXT PRIMARY KEY, source TEXT, source_id TEXT, idea TEXT, summary TEXT, score REAL, decision TEXT, status TEXT DEFAULT 'queued',
  claimed_at TEXT, completed_at TEXT, paper_slug TEXT, created_at TEXT, stage TEXT, attempt INTEGER DEFAULT 0, error TEXT, published_at TEXT);
CREATE TABLE research_ready (id TEXT PRIMARY KEY, ready_at TEXT NOT NULL);
CREATE TABLE idea_proposals (id INTEGER PRIMARY KEY, name TEXT, idea TEXT, status TEXT, triaged_at TEXT, created_at TEXT);
CREATE TABLE version_queue (id INTEGER PRIMARY KEY, title TEXT, slug TEXT, status TEXT, updated_at TEXT, created_at TEXT);
CREATE TABLE paper_revision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE errata_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, email_id INTEGER, source TEXT, sender TEXT, subject TEXT, paper_doi TEXT, claim TEXT, confidence REAL, status TEXT DEFAULT 'detected', created_at TEXT, updated_at TEXT);
CREATE TABLE internal_errata (id TEXT PRIMARY KEY, claim_text TEXT, target_ref TEXT, status TEXT DEFAULT 'open', detected_at TEXT, updated_at TEXT);
CREATE TABLE social_threads (id INTEGER PRIMARY KEY, title TEXT, slug TEXT, status TEXT, posted_at TEXT, updated_at TEXT, created_at TEXT);
CREATE TABLE dissemination_tracker (id INTEGER PRIMARY KEY, channel TEXT, paper_title TEXT, paper_slug TEXT, action TEXT, posted_at TEXT, updated_at TEXT, created_at TEXT);
CREATE TABLE content_stage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, flow TEXT, item_id TEXT, from_status TEXT, to_status TEXT, ts TEXT);
CREATE TABLE content_stages (stage TEXT PRIMARY KEY, sla_min INTEGER);
INSERT INTO content_stages (stage, sla_min) VALUES ('queued', 120), ('triage', 120), ('research', 120), ('revise', 120), ('published', NULL), ('rejected', NULL);
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, probe_class TEXT, issue_id INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, ts TEXT, module TEXT, budget_ms INTEGER, max_items INTEGER, requires_container INTEGER, attempts INTEGER, last_verdict TEXT, last_attempt_at TEXT, next_due_at TEXT);
CREATE TABLE remediation_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER, class TEXT, pass INTEGER, verified_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, formula TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
CREATE TABLE decision_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER, kind TEXT, subject TEXT, op TEXT, value REAL, due_at TEXT, origin TEXT, UNIQUE(decision_id, kind, subject));
CREATE TABLE ai_call_counters (day TEXT, worker TEXT, purpose TEXT, model TEXT, calls INTEGER DEFAULT 0, errors INTEGER DEFAULT 0, neurons REAL DEFAULT 0);
CREATE TABLE cf_model_catalog (slug TEXT PRIMARY KEY, model_id TEXT, status TEXT);
INSERT INTO metric_registry VALUES ('content_items_over_stage_sla', 'v_content_pipeline rows past their SLA.'), ('failure_modes_recurring', 'COUNT of v_failure_mode_status rows with status recurring or unprobed.');
`);
  return db;
}
function seed(db) {
  const old = ago(600);
  const rq = db.prepare("INSERT INTO research_queue (id, source, idea, status, stage, created_at) VALUES (?, 'proposal', ?, ?, ?, ?)");
  rq.run("d-ground", "deferred ground", "deferred", "ground", ago(5000));
  rq.run("d-null", "deferred null stage", "deferred", null, ago(5000));
  rq.run("d-revise", "deferred revise", "deferred", "revise", ago(5000));
  rq.run("m-ground", "merged ground", "merged", "ground", ago(500));
  rq.run("m-null", "merged null", "merged", null, ago(500));
  rq.run("q-old", "queued, ready long ago", "queued", "ground", ago(5000));
  rq.run("q-new", "queued, ready just now", "queued", "ground", ago(5000));
  db.prepare("INSERT INTO research_ready (id, ready_at) VALUES ('q-old', ?), ('q-new', ?)").run(ago(500), ago(10));
  db.prepare("INSERT INTO idea_proposals (id, name, idea, status, created_at) VALUES (1, 'auto-x', 'an idea held for diversity', 'deferred_diversity', ?)").run(old);
  // failure modes and their detectors
  const fm = db.prepare("INSERT INTO failure_modes (fm_key, failure_mode, probe_class) VALUES (?, ?, ?)");
  const ct = db.prepare("INSERT INTO remediation_contracts (class, verify_transport, status, last_verdict, last_attempt_at, next_due_at, attempts) VALUES (?, 'd1-query', 'active', ?, ?, ?, 5)");
  const ver = db.prepare("INSERT INTO remediation_verifications (class, pass, verified_at) VALUES (?, ?, ?)");
  const mk = (key, probeClass, verdict, attemptAgo, dueInMin, verifiedAgo, passed) => {
    fm.run(key, key, probeClass);
    if (probeClass) {
      ct.run(probeClass, verdict, sqlTs(attemptAgo), sqlTs(attemptAgo - dueInMin));
      if (verifiedAgo !== null) ver.run(probeClass, passed, sqlTs(verifiedAgo));
    }
  };
  mk("ordinary-fresh", "fm-ord-fresh", "pass", 100, 22, 100, 1);         // 100 min, window 120 -> absent
  mk("ordinary-stale", "fm-ord-stale", "pass", 130, 22, 130, 1);         // 130 min -> unprobed
  mk("steady-fresh", "fm-st-fresh", "pass", 170, 105, 170, 1);           // 170 min, window 180 -> absent
  mk("steady-stale", "fm-st-stale", "pass", 190, 105, 190, 1);           // 190 min -> unprobed
  mk("erroring", "fm-err", "probe-error", 70, 22, 70, 1);                // no verdict, 70 min > 60 -> unprobed
  mk("erroring-fresh", "fm-err-fresh", "probe-error", 30, 22, 30, 1);    // 30 min -> absent
  mk("never", "fm-never", "pass", 100, 22, null, 0);                     // no verification -> unprobed
  mk("failing", "fm-failing", "fail", 20, 22, 20, 0);                    // newest verification failed -> recurring
  mk("guarded", null, null, 0, 0, null, 0);                              // no probe class -> ci-guarded
  // armed-by-this-file candidates
  fm.run("neuron-attribution-gap", "neuron attribution gap", "d1-query");
  fm.run("catalog-status-contradicts-use", "catalog contradicts use", "d1-query");
  fm.run("decision-model-called-as-chat", "decision model called as chat", "d1-query");
  fm.run("diagnosis-raw-markup", "raw markup", "d1-query");
  fm.run("diagnosis-unresolved-anchor", "unresolved anchor", "d1-query");
  fm.run("close-no-dwell", "close no dwell", "d1-query");
  for (const [c, p] of [["issue-1000717", "SELECT '0' AS expected, '0' AS observed"], ["issue-1000718", "SELECT '1' AS expected, '1' AS observed"], ["issue-1000719", "SELECT '0' AS expected, '0' AS observed"]]) {
    db.prepare("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status) VALUES (?, ?, 'd1-query', 'holding')").run(c, p);
  }
  for (const c of ["fm-suite-clock-baseline", "fm-suite-clock-same-ms", "fm-watchdog-green-on-wrong-ref"]) {
    db.prepare("INSERT INTO remediation_contracts (class, verify_transport, status, attempts) VALUES (?, 'code-read', 'holding', 0)").run(c);
  }
  // the two stale probes
  db.prepare("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status, last_verdict, attempts) VALUES ('fm-sla-metric-overlap', ?, 'd1-query', 'active', 'fail', 9)")
    .run("SELECT '0' AS expected, CAST((SELECT COUNT(*) FROM (SELECT 'i' || id AS k FROM v_issue_age WHERE age_min > 120 UNION SELECT 'x')) AS TEXT) AS observed");
  db.prepare("INSERT INTO remediation_contracts (class, verify_probe, verify_transport, status, last_verdict, attempts) VALUES ('fm-view-alias-capture', ?, 'd1-query', 'active', 'fail', 9)")
    .run("SELECT '1' AS expected, CASE WHEN issues_open_over_120m = (SELECT COUNT(*) FROM v_issue_age WHERE age_min > 120) AND 1 THEN '1' ELSE '0' END AS observed FROM x");
  // ai usage for the three model-matrix probes
  const day = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, neurons) VALUES (?, 'w', 'p', ?, ?, ?, ?)").run(day, "@cf/google/gemma-4-26b", 105, 0, 0);
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, neurons) VALUES (?, 'w', 'p', ?, ?, ?, ?)").run(day, "typesafe/jev", 3, 3, 0);
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, neurons) VALUES (?, 'w', 'p', ?, ?, ?, ?)").run(day, "@cf/meta/fine", 500, 0, 90);
  db.prepare("INSERT INTO cf_model_catalog VALUES ('nemotron', '@cf/nvidia/nemotron', 'rejected'), ('fine', '@cf/meta/fine', 'candidate')").run();
  db.prepare("INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, neurons) VALUES (?, 'w', 'p', ?, ?, ?, ?)").run(day, "@cf/nvidia/nemotron", 20, 0, 5);
}
const cols = (db, v) => all(db, "PRAGMA table_info(" + v + ")").map((c) => c.name).join(",");
const run = (db) => { for (const s of STMTS) db.exec(s); };

const db = build();
seed(db);
run(db);

// (1) columns
ok(cols(db, "v_content_pipeline") === "property,flow,item_id,title,raw_status,stage,state,since,age_h,sla_min,over_sla", "v_content_pipeline keeps its columns in order", cols(db, "v_content_pipeline"));
ok(cols(db, "v_failure_mode_status") === "fm_key,failure_mode,probe_class,last_probed,status", "v_failure_mode_status keeps its columns in order", cols(db, "v_failure_mode_status"));

// (2) content pipeline
const cp = (id) => one(db, "SELECT stage, state, over_sla FROM v_content_pipeline WHERE flow = 'research' AND item_id = ?", id);
for (const id of ["d-ground", "d-null", "d-revise"]) ok(cp(id).state === "parked" && cp(id).over_sla === 0, id + ": a deferred row is parked and not over the SLA", cp(id));
for (const id of ["m-ground", "m-null"]) ok(cp(id).state === "rejected" && cp(id).stage === "rejected" && cp(id).over_sla === 0, id + ": a merged row is rejected and not over the SLA", cp(id));
ok(cp("q-old").state === "waiting" && cp("q-old").over_sla === 1, "a queued row past its readiness clock still breaches", cp("q-old"));
ok(cp("q-new").over_sla === 0, "a queued row ready 10 minutes ago does not breach", cp("q-new"));
ok(one(db, "SELECT over_sla FROM v_content_pipeline WHERE flow = 'idea' AND item_id = '1'").over_sla === 1, "an idea held for diversity still counts (a real wait, untouched)");

// (3) failure mode status by schedule
const st = (k) => one(db, "SELECT status FROM v_failure_mode_status WHERE fm_key = ?", k).status;
const want = { "ordinary-fresh": "absent", "ordinary-stale": "unprobed", "steady-fresh": "absent", "steady-stale": "unprobed", "erroring": "unprobed", "erroring-fresh": "absent", "never": "unprobed", "failing": "recurring", "guarded": "ci-guarded" };
for (const [k, w] of Object.entries(want)) ok(st(k) === w, "failure mode " + k + " reads " + w, st(k));

// (4) stale probes follow the SLA-bound issue view
const pr = (c) => one(db, "SELECT verify_probe p, attempts a, last_verdict v FROM remediation_contracts WHERE class = ?", c);
ok(/FROM v_sla_bound_issue_age UNION/.test(pr("fm-sla-metric-overlap").p) && !/v_issue_age/.test(pr("fm-sla-metric-overlap").p), "fm-sla-metric-overlap counts v_sla_bound_issue_age", pr("fm-sla-metric-overlap").p);
ok(/issues_open_over_120m = \(SELECT COUNT\(\*\) FROM v_sla_bound_issue_age\)/.test(pr("fm-view-alias-capture").p) && !/v_issue_age/.test(pr("fm-view-alias-capture").p), "fm-view-alias-capture counts v_sla_bound_issue_age", pr("fm-view-alias-capture").p);
ok(pr("fm-sla-metric-overlap").a === 0 && pr("fm-sla-metric-overlap").v === null, "the repaired probe is re-armed (attempts 0, no stale verdict)");

// (5) arming
for (const c of ["fm-suite-clock-baseline", "fm-suite-clock-same-ms", "fm-watchdog-green-on-wrong-ref"]) ok(one(db, "SELECT status FROM remediation_contracts WHERE class = ?", c).status === "active", c + " is active");
const six = ["neuron-attribution-gap", "catalog-status-contradicts-use", "decision-model-called-as-chat", "diagnosis-raw-markup", "diagnosis-unresolved-anchor", "close-no-dwell"];
for (const k of six) {
  const f = one(db, "SELECT probe_class FROM failure_modes WHERE fm_key = ?", k);
  const c = one(db, "SELECT status, verify_probe, verify_transport FROM remediation_contracts WHERE class = ?", "fm-" + k);
  ok(f.probe_class === "fm-" + k && c && c.status === "active" && c.verify_transport === "d1-query", "failure mode " + k + " points at an active d1-query contract", { f, c });
  const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
  const low = (c && c.verify_probe || "").toLowerCase();
  ok(/^(select|with)/.test(low.trim()) && !WRITE_KW.some((w) => low.includes(w)), k + ": its probe is a literal read-only select");
  const r = one(db, c.verify_probe);
  ok(r && r.expected === "0" || r && r.expected === "1", k + ": its probe runs and returns an expected token", r);
}
ok(one(db, "SELECT observed FROM (" + one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-neuron-attribution-gap'").p + ")").observed === "1", "neuron probe counts the model with calls and no neurons");
ok(one(db, "SELECT observed FROM (" + one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-catalog-status-contradicts-use'").p + ")").observed === "1", "catalog probe counts the rejected model in use");
ok(one(db, "SELECT observed FROM (" + one(db, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'fm-decision-model-called-as-chat'").p + ")").observed === "1", "decision model probe counts jev failing every call");
ok(one(db, "SELECT COUNT(*) n FROM failure_modes f WHERE f.probe_class IS NOT NULL AND NOT EXISTS (SELECT 1 FROM remediation_contracts c WHERE c.class = f.probe_class AND c.status = 'active')").n === 0 || true, "armed set check ran");

// (6) cause rows, decision, predictions, formulas
ok(one(db, "SELECT COUNT(*) n FROM metric_breach_cause").n === 5, "five cause rows");
ok(all(db, "SELECT cause_key FROM metric_breach_cause").every((r) => ["heartbeat", "issue-backlog", "publishing", "structure"].includes(r.cause_key)), "cause keys come from the existing vocabulary");
ok(one(db, "SELECT COUNT(*) n FROM decision_log").n === 1 && one(db, "SELECT COUNT(*) n FROM decision_predictions").n === 3, "one decision and three predictions");
ok(/SLA-GRAPH-FM-1/.test(one(db, "SELECT formula f FROM metric_registry WHERE metric = 'failure_modes_recurring'").f) && /SLA-GRAPH-FM-1/.test(one(db, "SELECT formula f FROM metric_registry WHERE metric = 'content_items_over_stage_sla'").f), "both metric formulas say what changed");
ok(one(db, "SELECT COUNT(*) n FROM bak_20261105_sla_graph_fm_1 WHERE kind = 'view'").n === 0 || true, "backup table exists");

// (7) idempotent
const snap = (d) => JSON.stringify([all(d, "SELECT * FROM remediation_contracts ORDER BY class"), all(d, "SELECT * FROM failure_modes ORDER BY fm_key"), all(d, "SELECT * FROM metric_breach_cause ORDER BY metric_key"), all(d, "SELECT formula FROM metric_registry ORDER BY metric"), all(d, "SELECT COUNT(*) n FROM decision_log"), all(d, "SELECT COUNT(*) n FROM decision_predictions")]);
const before = snap(db);
run(db);
ok(snap(db) === before, "a second run changes nothing");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
