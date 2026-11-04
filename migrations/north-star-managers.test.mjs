// NORTH-STAR-MANAGERS-1 offline suite: applies 2026-11-04-north-star-managers.sql to a minimal SQLite schema and proves the focus order (North Star first, hygiene last and capped,
// identical to the old views while the switch is off), the slot bonus, the lever gate (hygiene skipped, per-metric and daily caps, North Star first), the strategic roadmap steps
// (retry of a discarded reply, manager-only open-item limit, NORTHSTAR/PREDICT capture, issue lines), the metric refresh, the pin, the keep-or-revert verdict and idempotence.
// Run: node migrations/north-star-managers.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const dir = new URL("./", import.meta.url);
const sql = readFileSync(new URL("./2026-11-04-north-star-managers.sql", dir), "utf8");
const fixture = JSON.parse(readFileSync(new URL("./north-star-managers.fixture.json", dir), "utf8"));
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d))); } };

// ---- the old view texts, read from the migrations that made them ------------------------------------------------------------------------------------------------------
const mp9 = readFileSync(new URL("./2026-11-01-management-personas-9.sql", dir), "utf8");
const mp3 = readFileSync(new URL("./2026-10-26-management-personas-3.sql", dir), "utf8");
const oldPlan = "CREATE VIEW v_program_focus_plan AS" + mp9.split("CREATE VIEW v_program_focus_plan AS").pop().split(";\n\nUPDATE fleet_tasks")[0];
const oldAlloc = "CREATE VIEW v_portfolio_allocation_plan AS" + mp3.split("CREATE VIEW v_portfolio_allocation_plan AS").pop().split(";\n\nINSERT OR REPLACE INTO fleet_tasks")[0];

const SCHEMA = `
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE fleet_tasks (id TEXT PRIMARY KEY, name TEXT, type TEXT, definition TEXT, timeout_ms INTEGER, retries INTEGER, version INTEGER DEFAULT 1, enabled INTEGER DEFAULT 1, updated_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT);
CREATE TABLE metric_breach_cause (metric_key TEXT PRIMARY KEY, cause_key TEXT NOT NULL, note TEXT);
CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER DEFAULT 5, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER DEFAULT 168, enabled INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE cost_daily (date TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'fleet', usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (date, source));
CREATE TABLE human_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, why TEXT, sev TEXT DEFAULT 'normal', status TEXT DEFAULT 'open');
CREATE TABLE journey_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, runner TEXT, journey TEXT, ok INTEGER, ms INTEGER);
CREATE TABLE paper_readership (key64 TEXT PRIMARY KEY, ext_30d REAL);
CREATE TABLE cf_agent_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'run', prompt TEXT, instance TEXT, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'queued', result TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE roadmap_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, program_code TEXT NOT NULL, request_instance TEXT UNIQUE, title TEXT, rationale TEXT, path TEXT, anchor_line TEXT, status TEXT NOT NULL DEFAULT 'proposed', issue_id INTEGER, task_id TEXT, pr_url TEXT, outcome TEXT, deployed_at TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT);
CREATE TABLE program_charters (program_code TEXT PRIMARY KEY, objective TEXT, status TEXT, primary_metric TEXT, guard_metrics TEXT);
CREATE TABLE program_focus (program_code TEXT NOT NULL, issue_id INTEGER NOT NULL, rank INTEGER, tier INTEGER, reason TEXT, has_doer INTEGER, PRIMARY KEY (program_code, issue_id));
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE issue_project_map (issue_id INTEGER PRIMARY KEY, project_code TEXT NOT NULL, program_code TEXT NOT NULL, kind TEXT NOT NULL, synced_milestone INTEGER, synced_labels TEXT, gh_node TEXT, gh_item TEXT, updated_at TEXT, synced_at TEXT);
CREATE TABLE portfolio_allocations (tick TEXT NOT NULL, program_code TEXT NOT NULL, manager_persona TEXT, verdict TEXT, risk_score REAL, risk_24h REAL, open_issues INTEGER, slots INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT, PRIMARY KEY (tick, program_code));
CREATE TABLE quality_trend (tick TEXT, scope TEXT, quality_index REAL);
CREATE TABLE program_risk_now (program_code TEXT PRIMARY KEY, manager_persona TEXT, verdict TEXT, risk REAL, open_issues INTEGER);
CREATE TABLE persona_briefs (tick TEXT NOT NULL, persona_key TEXT NOT NULL, level TEXT, scope TEXT, verdict TEXT, decision TEXT, summary TEXT NOT NULL, PRIMARY KEY (tick, persona_key));
CREATE TABLE metric_improvement_now (trigger_id INTEGER PRIMARY KEY, metric_key TEXT NOT NULL, owner TEXT, program_code TEXT, operator TEXT, threshold REAL, val REAL, val_7d REAL, hit INTEGER, verdict TEXT NOT NULL, cause_key TEXT, has_code_task INTEGER, open_issue_id INTEGER, priority INTEGER, bp26 INTEGER, computed_at TEXT);
CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('hold','filter','pause','kill-switch','gate','cap','guard','lease')), guards_against TEXT, critical_path INTEGER NOT NULL DEFAULT 0, disposition TEXT NOT NULL CHECK (disposition IN ('remove','demote','replace','keep')), disposition_state TEXT NOT NULL DEFAULT 'planned' CHECK (disposition_state IN ('planned','applied')), alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT NOT NULL, issue_id INTEGER, reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE capability_ledger (capability TEXT PRIMARY KEY, provenance TEXT, prerequisites TEXT, reliability TEXT, acquired_at TEXT, evidence TEXT);
CREATE TABLE v_program_focus_candidates (program_code TEXT, id INTEGER, title TEXT, tier INTEGER, rn INTEGER, has_doer INTEGER, primary_metric TEXT);
CREATE TABLE v_metric_trigger_state (id INTEGER, metric_key TEXT, operator TEXT, threshold REAL, val REAL, hit INTEGER);
`;
const stepsOf = (db, id) => JSON.parse(db.prepare("SELECT definition FROM fleet_tasks WHERE id = ?").get(id).definition).steps;
const stepSql = (db, id, name) => stepsOf(db, id).find((s) => s.name === name)?.sql;

function build({ withMigration = true, oldViews = false } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const mk = (id, steps) => db.prepare("INSERT INTO fleet_tasks (id, name, type, definition, version) VALUES (?, ?, 'workflow', ?, 1)").run(id, id, JSON.stringify({ steps: steps.map(([name, s]) => ({ type: "sql", name, db: "AUDIT", sql: s })) }));
  mk("management-personas", [["plan-clear", "DELETE FROM program_focus_plan_now"], ["plan-snapshot", "SELECT 1"]]);
  mk("management-personas-c", [["rm-research", "SELECT 'Roadmap items already open: '"], ["rm-parse", "SELECT 1"], ["rm-reject", "SELECT 2"], ["rm-file", fixture.rm_file], ["lever-request", fixture.lever_request], ["rm-brief", "SELECT 3"]]);
  mk("management-personas-plus", [["pl-research", fixture.pl_research_tail]]);
  db.exec("INSERT INTO ops_config VALUES ('code_merge_trusted_sources', 'a,management-personas|ROADMAP-1:', NULL, NULL)");
  if (oldViews) { db.exec(oldPlan + ";\n" + oldAlloc + ";"); }
  if (withMigration) { db.exec(sql); }
  return db;
}
const one = (db, s, ...p) => db.prepare(s).get(...p);
const all = (db, s, ...p) => db.prepare(s).all(...p);
const run = (db, s) => db.exec(s);

// ---- 1. apply, tables, seeds, metrics, triggers, cause mapping, control registry -----------------------------------------------------------------------------------------------
const db = build();
ok(one(db, "SELECT COUNT(*) c FROM north_star_measures").c === 4, "four North Star measures");
ok(all(db, "SELECT key FROM north_star_measures ORDER BY key").map((r) => r.key).join() === "cost,owner_load,readers,reliability", "keys are the four goals");
ok(one(db, "SELECT COUNT(*) c FROM north_star_links WHERE tier = 'northstar'").c === 5, "five North Star metrics linked");
ok(one(db, "SELECT COUNT(*) c FROM north_star_links WHERE tier = 'hygiene'").c === 10, "ten hygiene metrics");
const regs = ["ns_readers_engaged_per_day", "ns_ext_visits_per_paper_30d", "ns_fleet_cost_usd_month", "ns_owner_urgent_cards", "ns_dashboard_load_ms_p75_24h", "roadmap_proposals_7d", "roadmap_strategic_proposals_7d", "programs_without_strategic_proposal_7d", "manager_agent_requests_24h"];
ok(regs.every((m) => one(db, "SELECT 1 x FROM metric_registry WHERE metric = ?", m)), "every metric registered");
ok(regs.every((m) => one(db, "SELECT 1 x FROM metric_breach_cause WHERE metric_key = ?", m)), "every metric has a cause mapping (METRIC-CAUSE-AT-REGISTRATION-1)");
const noTrig = regs.filter((m) => !one(db, "SELECT 1 x FROM analytics_metric_triggers WHERE metric_key = ?", m));
ok(noTrig.join() === "roadmap_proposals_7d,roadmap_strategic_proposals_7d" && /metric-exemption: roadmap_proposals_7d/.test(sql), "only the two reporting metrics lack a trigger and the file names the exemption", noTrig);
ok(all(db, "SELECT operator, threshold FROM analytics_metric_triggers WHERE metric_key IN ('ns_readers_engaged_per_day','ns_fleet_cost_usd_month')").length === 2, "reader and cost triggers exist");
ok(one(db, "SELECT COUNT(*) c FROM control_registry WHERE control LIKE 'ns-review:%'").c === 10, "ten spend-review rows");
ok(one(db, "SELECT COUNT(*) c FROM control_registry WHERE control LIKE 'ns-review:%' AND disposition = 'remove' AND disposition_state = 'planned'").c === 3, "three retire recommendations stay planned");
ok(one(db, "SELECT COUNT(*) c FROM control_registry c JOIN north_star_links l ON 'ns-review:' || l.metric_key = c.control WHERE c.disposition = 'demote' AND l.tier = 'hygiene'").c === 7, "every demote row is a hygiene link");
ok(one(db, "SELECT value FROM ops_config WHERE key = 'lever_daily_cap'").value === "24", "lever cap seeded");
const exp = one(db, "SELECT * FROM north_star_experiments WHERE id = 'north-star-managers-1'");
ok(exp && exp.verdict === null && exp.check_at > exp.started_at && JSON.parse(exp.baseline).lever_asks_24h === 0, "keep-or-revert experiment seeded with a baseline", exp);
ok(one(db, "SELECT COUNT(*) c FROM decision_log WHERE actor LIKE '%NORTH-STAR-MANAGERS-1%'").c === 1, "prediction is in decision_log");

// idempotence: apply the whole file again
const before = JSON.stringify([stepsOf(db, "management-personas").map((s) => s.name), stepsOf(db, "management-personas-c").map((s) => s.name), one(db, "SELECT version v FROM fleet_tasks WHERE id = 'management-personas-c'").v]);
db.exec(sql);
const after = JSON.stringify([stepsOf(db, "management-personas").map((s) => s.name), stepsOf(db, "management-personas-c").map((s) => s.name), one(db, "SELECT version v FROM fleet_tasks WHERE id = 'management-personas-c'").v]);
ok(before === after, "applying twice changes nothing (steps and versions)", [before, after]);
ok(one(db, "SELECT COUNT(*) c FROM north_star_links").c === 57 && one(db, "SELECT COUNT(*) c FROM decision_log WHERE actor LIKE '%NORTH-STAR-MANAGERS-1%'").c === 1, "no duplicate seeds");

// ---- 2. workflow edits -----------------------------------------------------------------------------------------------------------------------------------------------------
const cnames = stepsOf(db, "management-personas-c").map((s) => s.name);
ok(cnames.indexOf("rm-meta") === cnames.indexOf("rm-parse") + 1, "rm-meta sits right after rm-parse", cnames);
ok(cnames.includes("ns-brief") && stepsOf(db, "management-personas").map((s) => s.name).join().endsWith("ns-refresh,ns-pin,ns-verdict,ns-verdict-apply,ns-verdict-log,ns-verdict-next"), "new steps are appended in order");
ok(stepSql(db, "management-personas-plus", "pl-research").includes("NORTHSTAR:") && stepSql(db, "management-personas-plus", "pl-research").includes("PREDICT:"), "the product plus flow names its North Star and prediction");
ok(stepSql(db, "management-personas-c", "rm-research").includes("NORTHSTAR:"), "rm-research is strategic");
// every edited or new step still prepares (syntax and column names)
for (const [task, name] of [["management-personas-c", "rm-research"], ["management-personas-c", "rm-meta"], ["management-personas-c", "rm-file"], ["management-personas-c", "lever-request"], ["management-personas-c", "ns-brief"], ["management-personas", "ns-refresh"], ["management-personas", "ns-pin"], ["management-personas", "ns-verdict"], ["management-personas", "ns-verdict-apply"], ["management-personas", "ns-verdict-log"], ["management-personas", "ns-verdict-next"]]) {
  let err = null; try { db.prepare(stepSql(db, task, name)); } catch (e) { err = String(e.message); }
  ok(err === null, "step prepares: " + name, err);
}

// rm-file robustness: with the count-clause anchor gone the select-list edit is not applied either
{
  const d2 = build({ withMigration: false });
  d2.prepare("UPDATE fleet_tasks SET definition = replace(definition, 'AND i.title LIKE', 'AND i.title GLOB') WHERE id = 'management-personas-c'").run();
  d2.exec(sql);
  const f = stepSql(d2, "management-personas-c", "rm-file");
  let err = null; try { d2.prepare(f.replace(/p\.title/g, "p.title")); } catch (e) { err = String(e.message); }
  ok(!/m\.north_star/.test(f) || /LEFT JOIN roadmap_proposal_meta m/.test(f), "rm-file never reads m.north_star without the join", err);
}

// ---- 3. metric refresh (ns-refresh) -------------------------------------------------------------------------------------------------------------------------------------------
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
for (let n = 1; n <= 7; n++) db.prepare("INSERT INTO cost_daily (date, source, scope, usd) VALUES (?, 'workers_ai', 'fleet', 10)").run(day(n));
db.prepare("INSERT INTO cost_daily (date, source, scope, usd) VALUES (?, 'direct', 'owner-direct', 15)").run(day(1));
db.exec(`INSERT INTO human_actions (title, why, sev, status) VALUES ('a', 'x IDENTITY-BOUND: y', 'normal', 'open'), ('b', 'IDENTITY-BOUND: y', 'high', 'open'), ('c', 'IDENTITY-BOUND: y', 'low', 'open'), ('d', 'plain', 'normal', 'open'), ('e', 'IDENTITY-BOUND: y', 'normal', 'closed');
INSERT INTO metric_registry (metric, last_value) VALUES ('engaged_reader_sessions_7d', '70');
INSERT INTO paper_readership VALUES ('a', 1), ('b', 0), ('c', 0), ('d', 1);`);
const now = new Date();
[1000, 2000, 3000, 4000].forEach((ms, i) => db.prepare("INSERT INTO journey_runs (ts, runner, journey, ok, ms) VALUES (?, 'gha', 'dashboard-load', 1, ?)").run(new Date(now - (i + 1) * 36e5).toISOString().replace(/\.\d+Z/, "Z"), ms));
db.prepare("INSERT INTO journey_runs (ts, runner, journey, ok, ms) VALUES (?, 'cf', 'dashboard-load', 1, 99999)").run(new Date(now - 36e5).toISOString().replace(/\.\d+Z/, "Z"));
db.exec("INSERT INTO program_charters VALUES ('QNFO.OPS','o','active',NULL,NULL), ('QNFO.REACH','r','active',NULL,NULL), ('QNFO.PERSONAL','p','active',NULL,NULL)");
db.exec(stepSql(db, "management-personas", "ns-refresh"));
const mv = (m) => one(db, "SELECT last_value v FROM metric_registry WHERE metric = ?", m).v;
ok(mv("ns_readers_engaged_per_day") === "10.0", "readers per day = engaged_7d / 7", mv("ns_readers_engaged_per_day"));
ok(mv("ns_ext_visits_per_paper_30d") === "0.5", "visits per paper", mv("ns_ext_visits_per_paper_30d"));
ok(mv("ns_fleet_cost_usd_month") === "300.0", "cost = fleet scope only, 7 day rate x 30", mv("ns_fleet_cost_usd_month"));
ok(mv("ns_owner_urgent_cards") === "2", "urgent = identity-bound, open, above low", mv("ns_owner_urgent_cards"));
ok(mv("ns_dashboard_load_ms_p75_24h") === "3000", "p75 of the runner journey only", mv("ns_dashboard_load_ms_p75_24h"));
ok(mv("programs_without_strategic_proposal_7d") === "2", "OPS and REACH have no strategic proposal yet and PERSONAL is not counted", mv("programs_without_strategic_proposal_7d"));
const st = Object.fromEntries(all(db, "SELECT key, breached FROM v_north_star_state").map((r) => [r.key, r.breached]));
ok(st.readers === 1 && st.cost === 0 && st.owner_load === 0 && st.reliability === 0, "breached flags follow direction and target", st);
db.prepare("INSERT INTO journey_runs (ts, runner, journey, ok, ms) VALUES (?, 'gha', 'dashboard-load', 0, 50)").run(new Date(now - 36e5).toISOString().replace(/\.\d+Z/, "Z"));
db.exec(stepSql(db, "management-personas", "ns-refresh"));
ok(mv("ns_dashboard_load_ms_p75_24h") === "3000", "a failed (fast) run does not lower the p75", mv("ns_dashboard_load_ms_p75_24h"));
db.exec("UPDATE metric_registry SET last_value = 'n/a' WHERE metric = 'engaged_reader_sessions_7d'");
db.exec(stepSql(db, "management-personas", "ns-refresh"));
ok(mv("ns_readers_engaged_per_day") === null, "a non-numeric readers source is unmeasured, not zero", mv("ns_readers_engaged_per_day"));
db.exec("UPDATE metric_registry SET last_value = '70' WHERE metric = 'engaged_reader_sessions_7d'");
db.exec("DELETE FROM journey_runs");
db.exec(stepSql(db, "management-personas", "ns-refresh"));
ok(mv("ns_dashboard_load_ms_p75_24h") === null, "no journey rows leaves the load time unmeasured, not zero");
ok(one(db, "SELECT breached b FROM v_north_star_state WHERE key = 'reliability'").b === null, "unmeasured is not a breach");

// ---- 4. roadmap origination: rm-research, rm-meta, rm-file ---------------------------------------------------------------------------------------------------------------------
const research = stepSql(db, "management-personas-c", "rm-research");
db.exec(research);
const asked = all(db, "SELECT requester, instance FROM cf_agent_requests ORDER BY id");
ok(asked.length === 2 && asked.every((r) => !r.requester.includes("PERSONAL")), "asks OPS and REACH, never PERSONAL", asked);
ok(/NORTHSTAR:/.test(one(db, "SELECT prompt FROM cf_agent_requests").prompt) && /ns_readers_engaged_per_day|readers 10/.test(one(db, "SELECT prompt FROM cf_agent_requests").prompt), "the prompt carries the North Star state");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests").c === 2, "a queued ask is not repeated");
db.exec("UPDATE cf_agent_requests SET status = 'done', result = 'I will research the data before proposing.'");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests").c === 4, "a preface-only reply is asked again");
db.exec("UPDATE cf_agent_requests SET status = 'done', result = 'I will start now.'");
db.exec(research);
db.exec("UPDATE cf_agent_requests SET status = 'done', result = 'still nothing'");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests").c === 6, "at most 3 asks a day per program", one(db, "SELECT COUNT(*) c FROM cf_agent_requests").c);
db.exec("DELETE FROM cf_agent_requests");
db.exec("INSERT INTO cf_agent_requests (requester, instance, status, result) VALUES ('program-manager:QNFO.OPS', 'roadmap-QNFO.OPS-' || strftime('%Y%m%d', 'now'), 'done', 'TITLE: x' || char(10) || 'code-anchor: y')");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests WHERE requester LIKE '%OPS'").c === 2, "a reply the parser would ignore (no code-task) is asked again");
db.exec("DELETE FROM cf_agent_requests");
db.exec("INSERT INTO cf_agent_requests (requester, instance, status, result) VALUES ('program-manager:QNFO.OPS', 'roadmap-QNFO.OPS-' || strftime('%Y%m%d', 'now'), 'done', 'TITLE: x' || char(10) || 'code-task: repo=qnfo-workers path=a/worker.js' || char(10) || 'code-anchor: y')");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests WHERE requester LIKE '%OPS'").c === 1, "a valid reply ends the day for that program");
db.exec("DELETE FROM cf_agent_requests");
db.exec("INSERT INTO agent_issues (title, status, source) VALUES ('ROADMAP-1: QNFO.OPS #1: a', 'open', 'session'), ('ROADMAP-1: QNFO.OPS #2: b', 'open', 'session'), ('ROADMAP-1: QNFO.OPS #3: c', 'open', 'session')");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests WHERE requester LIKE '%OPS'").c === 1, "stale session-filed items no longer block the managers");
db.exec("UPDATE agent_issues SET source = 'management-personas'");
db.exec("DELETE FROM cf_agent_requests");
db.exec(research);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests WHERE requester LIKE '%OPS'").c === 0, "three open manager items do block (the old limit, on manager items only)");
db.exec("DELETE FROM agent_issues");

const body = (extra) => "TITLE: t" + "\n" + "WHY: w" + "\n" + extra + "code task: repo=qnfo-workers path=a/worker.js" + "\n" + "code anchor: abcdefghijklmnopqrstu";
db.exec("UPDATE ops_config SET value = value WHERE 0");
db.prepare("INSERT OR REPLACE INTO ops_config VALUES ('north_star_since', '2000-01-01T00:00:00Z', NULL, NULL)").run();
const ins = db.prepare("INSERT INTO roadmap_proposals (program_code, request_instance, title, rationale, path, anchor_line, status, created_at) VALUES (?, ?, ?, ?, 'a/worker.js', 'code-anchor: abcdefghijklmnopqrstu', 'proposed', ?)");
ins.run("QNFO.REACH", "i1", "strategic one", body("NORTHSTAR: readers\nPREDICT: ns_readers_engaged_per_day up 2 by 2026-11-20\n"), "2026-11-04T20:00:00Z");
ins.run("QNFO.INFRA", "i2", "no predict", body("NORTHSTAR: cost\n"), "2026-11-04T20:00:00Z");
ins.run("QNFO.OPS", "i3", "plain", body(""), "2026-11-04T20:00:00Z");
ins.run("QNFO.RSCH", "i4", "old", body("NORTHSTAR: readers\nPREDICT: something long enough\n"), "1999-01-01T00:00:00Z");
db.exec(stepSql(db, "management-personas-c", "rm-meta"));
const meta = all(db, "SELECT p.title, m.kind, m.north_star, m.prediction FROM roadmap_proposal_meta m JOIN roadmap_proposals p ON p.id = m.proposal_id ORDER BY p.id");
ok(meta.length === 1 && meta[0].kind === "strategic" && meta[0].north_star === "readers" && meta[0].prediction.startsWith("ns_readers_engaged_per_day up 2"), "only a proposal with NORTHSTAR and PREDICT is strategic", meta);
ok(one(db, "SELECT last_value v FROM metric_registry WHERE metric = 'programs_without_strategic_proposal_7d'").v === "2", "metric not refreshed until the step runs");
db.exec("UPDATE roadmap_proposals SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-10 days')");
db.exec(stepSql(db, "management-personas", "ns-refresh"));
ok(mv("roadmap_strategic_proposals_7d") === "0" && mv("roadmap_proposals_7d") === "0", "a proposal older than 7 days is not counted", mv("roadmap_strategic_proposals_7d"));
db.exec("UPDATE roadmap_proposals SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
db.exec(stepSql(db, "management-personas", "ns-refresh"));
ok(mv("roadmap_strategic_proposals_7d") === "1" && mv("roadmap_proposals_7d") === "4" && mv("programs_without_strategic_proposal_7d") === "1", "weekly proposal metrics", [mv("roadmap_strategic_proposals_7d"), mv("roadmap_proposals_7d"), mv("programs_without_strategic_proposal_7d")]);
db.exec(stepSql(db, "management-personas-c", "rm-file"));
const issues = all(db, "SELECT title, description FROM agent_issues ORDER BY id");
const strategic = issues.find((i) => i.title.includes("strategic one"));
ok(issues.length === 4 && strategic && /north-star: readers/.test(strategic.description) && /prediction: ns_readers_engaged_per_day up 2/.test(strategic.description), "the issue of a strategic proposal carries north-star and prediction", issues.length);
ok(strategic.description.startsWith("code-task: repo=qnfo-workers path=a/worker.js"), "code-task stays the first line");
ok(!issues.find((i) => i.title.includes("plain")).description.includes("north-star:"), "a tactical proposal gets no north-star line");
db.exec("DELETE FROM roadmap_proposals; DELETE FROM roadmap_proposal_meta; DELETE FROM agent_issues; DELETE FROM program_charters");

// ---- 5. lever gate -------------------------------------------------------------------------------------------------------------------------------------------------------------
const lever = stepSql(db, "management-personas-c", "lever-request");
const seedLever = () => {
  db.exec("DELETE FROM metric_improvement_now; DELETE FROM cf_agent_requests; DELETE FROM north_star_links WHERE metric_key LIKE 'zz_%'");
  db.exec(`INSERT INTO north_star_links (metric_key, north_star, tier, weight, reason) VALUES ('zz_hyg', NULL, 'hygiene', 0, 't'), ('zz_drv', 'cost', 'driver', 5, 't'), ('zz_ns', 'cost', 'northstar', 10, 't');
INSERT INTO metric_improvement_now (trigger_id, metric_key, program_code, operator, threshold, val, val_7d, hit, verdict, open_issue_id, priority) VALUES
 (1, 'zz_hyg', 'QNFO.OPS', 'gt', 0, 5, 5, 1, 'breach-flat', 11, 1),
 (2, 'zz_plain', 'QNFO.OPS', 'gt', 0, 5, 5, 1, 'breach-flat', 12, 2),
 (3, 'zz_drv', 'QNFO.OPS', 'gt', 0, 5, 5, 1, 'breach-worsening', 13, 5),
 (4, 'zz_ns', 'QNFO.INFRA', 'gt', 0, 5, 5, 1, 'breach-flat', 14, 9);`);
};
const instances = () => all(db, "SELECT instance FROM cf_agent_requests ORDER BY id").map((r) => r.instance.split("-")[1]);
seedLever(); db.exec(lever);
ok(instances().join() === "4,3,2", "hygiene skipped, North Star first, then driver, then the rest", instances());
seedLever();
db.exec("INSERT INTO cf_agent_requests (requester, instance, status, result) VALUES ('program-manager:QNFO.OPS', 'lever-2-202611041200', 'done', 'preface only'), ('program-manager:QNFO.OPS', 'lever-2-202611041300', 'done', 'preface only')");
db.exec(lever);
ok(!instances().slice(2).includes("2") && instances().slice(2).join() === "4,3", "a metric asked twice in 24 h is not asked a third time", instances());
seedLever();
db.exec("UPDATE ops_config SET value = '2' WHERE key = 'lever_daily_cap'");
db.exec("INSERT INTO cf_agent_requests (requester, instance, status, result) VALUES ('program-manager:QNFO.REACH', 'lever-99-1', 'done', 'x'), ('program-manager:QNFO.RSCH', 'lever-98-1', 'done', 'x')");
db.exec(lever);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests").c === 2, "the daily cap stops all asks");
db.exec("UPDATE ops_config SET value = '24' WHERE key = 'lever_daily_cap'");
seedLever();
for (let i = 0; i < 22; i++) db.exec(`INSERT INTO cf_agent_requests (requester, instance, status, result) VALUES ('program-manager:QNFO.REACH', 'lever-${900 + i}-1', 'done', 'x')`);
db.exec(lever);
ok(one(db, "SELECT COUNT(*) c FROM cf_agent_requests").c === 24 && instances().slice(22).join() === "4,3", "22 asks used of 24: at most 2 more, the North Star ones", instances().slice(22));
seedLever();
db.exec("UPDATE ops_config SET value = 'off' WHERE key = 'north_star_lever_gate'");
db.exec("INSERT INTO cf_agent_requests (requester, instance, status, result) VALUES ('program-manager:QNFO.OPS', 'lever-2-202611041200', 'done', 'preface only'), ('program-manager:QNFO.OPS', 'lever-2-202611041300', 'done', 'preface only')");
db.exec(lever);
ok(instances().slice(2).join() === "1,2,3,4", "gate off asks as before, in the old order: hygiene and capped metrics included", instances());
db.exec("UPDATE ops_config SET value = 'on' WHERE key = 'north_star_lever_gate'");

// ---- 6. pin ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
db.exec("DELETE FROM agent_issues; DELETE FROM issue_project_map; DELETE FROM analytics_metric_triggers WHERE metric_key LIKE 'zz_%'");
db.exec(`INSERT INTO analytics_metric_triggers (id, metric_key, title) VALUES (900, 'ns_fleet_cost_usd_month_x', 't');
UPDATE analytics_metric_triggers SET metric_key = 'ns_readers_engaged_per_day_x' WHERE id = 900;`);
db.exec("DELETE FROM analytics_metric_triggers WHERE id = 900");
const t = (metric) => one(db, "SELECT id FROM analytics_metric_triggers WHERE metric_key = ?", metric).id;
db.exec(`INSERT INTO agent_issues (id, title, status) VALUES (501, 'METRIC-TRIGGER-${t("ns_readers_engaged_per_day")}-NS-READERS: x', 'open'), (502, 'METRIC-TRIGGER-${t("ns_fleet_cost_usd_month")}-NS-COST: x', 'open'), (503, 'unrelated', 'open');
INSERT INTO issue_project_map (issue_id, project_code, program_code, kind, synced_milestone, gh_node) VALUES (501, 'W.qnfo-fleet-control', 'QNFO.OPS', 'fix', 7, 'node-501');`);
db.exec(stepSql(db, "management-personas", "ns-pin"));
const pins = Object.fromEntries(all(db, "SELECT issue_id, program_code, project_code, synced_milestone, gh_node FROM issue_project_map").map((r) => [r.issue_id, r]));
ok(pins[501].program_code === "QNFO.REACH" && pins[501].project_code === "W.QNFO.REACH" && pins[501].synced_milestone === 7 && pins[501].gh_node === "node-501", "a North Star trigger issue moves to the owner program and keeps its mirror columns", pins[501]);
ok(pins[502].program_code === "QNFO.INFRA" && !pins[503], "cost goes to INFRA and unrelated issues are untouched", pins);
db.exec(stepSql(db, "management-personas", "ns-pin"));
ok(one(db, "SELECT COUNT(*) c FROM issue_project_map").c === 2, "pin is idempotent");
db.exec("UPDATE ops_config SET value = 'off' WHERE key = 'north_star_focus'; DELETE FROM issue_project_map WHERE issue_id = 502");
db.exec(stepSql(db, "management-personas", "ns-pin"));
ok(one(db, "SELECT COUNT(*) c FROM issue_project_map WHERE issue_id = 502").c === 0, "switch off stops pinning");
db.exec("UPDATE ops_config SET value = 'on' WHERE key = 'north_star_focus'");

// ---- 7. keep or revert -----------------------------------------------------------------------------------------------------------------------------------------------------------
const setM = (m, v) => db.prepare("INSERT INTO metric_registry (metric, last_value) VALUES (?, ?) ON CONFLICT(metric) DO UPDATE SET last_value = excluded.last_value").run(m, String(v));
const verdictRun = () => { for (const n of ["ns-verdict", "ns-verdict-apply", "ns-verdict-log", "ns-verdict-next"]) db.exec(stepSql(db, "management-personas", n)); return one(db, "SELECT verdict, evidence FROM north_star_experiments WHERE id = 'north-star-managers-1'"); };
db.exec("UPDATE north_star_experiments SET baseline = json('{\"lever_asks_24h\":100,\"metrics_in_breach\":90,\"open_agent_issues\":600,\"issue_wontfix_share_7d\":0,\"remediation_latest_pass_pct_7d\":60}')");
setM("metrics_in_breach", 90); setM("open_agent_issues", 600); setM("issue_wontfix_share_7d", 0); setM("remediation_latest_pass_pct_7d", 60);
ok(verdictRun().verdict === null, "no verdict before the check date");
db.exec("UPDATE north_star_experiments SET check_at = '2000-01-01T00:00:00Z'");
db.exec("DELETE FROM cf_agent_requests; DELETE FROM program_focus");
setM("roadmap_strategic_proposals_7d", 5); setM("programs_without_strategic_proposal_7d", 1);
db.exec("INSERT INTO program_focus (program_code, issue_id, has_doer) VALUES ('QNFO.OPS', 501, 1), ('QNFO.OPS', 502, 1), ('QNFO.OPS', 503, 1), ('QNFO.OPS', 504, 1)");
let v = verdictRun();
ok(v.verdict === "keep" && JSON.parse(v.evidence).focus_ns_share === 0.5, "keep when proposals, lever asks and focus share are met and no guard worsens", v);
ok(one(db, "SELECT value FROM ops_config WHERE key = 'north_star_focus'").value === "on", "keep leaves the switches on");
ok(one(db, "SELECT outcome_matched m FROM decision_log WHERE assumption = 'north-star-verdict:north-star-managers-1'").m === 1, "verdict is logged with outcome_matched");
db.exec("UPDATE north_star_experiments SET verdict = NULL, verdict_at = NULL, evidence = NULL; DELETE FROM decision_log WHERE assumption LIKE 'north-star-verdict:%'");
setM("open_agent_issues", 800);
v = verdictRun();
ok(v.verdict === "revert" && one(db, "SELECT COUNT(*) c FROM ops_config WHERE key IN ('north_star_focus','north_star_lever_gate') AND value = 'off'").c === 2, "a worse guard reverts both switches", v);
db.exec("UPDATE ops_config SET value = 'on' WHERE key LIKE 'north_star_%' AND value = 'off'; UPDATE north_star_experiments SET verdict = NULL, verdict_at = NULL, evidence = NULL; DELETE FROM decision_log WHERE assumption LIKE 'north-star-verdict:%'");
setM("open_agent_issues", 600); setM("roadmap_strategic_proposals_7d", 1); setM("programs_without_strategic_proposal_7d", 3);
v = verdictRun();
ok(v.verdict === "partial" && one(db, "SELECT id FROM north_star_experiments WHERE id = 'north-star-managers-2'"), "a missed prediction is partial and opens a second window", v);
ok(one(db, "SELECT value FROM ops_config WHERE key = 'north_star_focus'").value === "on", "partial keeps the switches on");
// percent units: 9.7 -> 9.8 is not a revert
db.exec("UPDATE north_star_experiments SET verdict = NULL, verdict_at = NULL, evidence = NULL, baseline = json_set(baseline, '$.issue_wontfix_share_7d', 9.7) WHERE id = 'north-star-managers-1'; DELETE FROM decision_log WHERE assumption LIKE 'north-star-verdict:%'; DELETE FROM north_star_experiments WHERE id = 'north-star-managers-2'");
setM("issue_wontfix_share_7d", 9.8); setM("roadmap_strategic_proposals_7d", 5); setM("programs_without_strategic_proposal_7d", 1);
ok(verdictRun().verdict === "keep", "a 0.1 point rise of the wontfix percent is not a revert");
setM("issue_wontfix_share_7d", 16);
db.exec("UPDATE north_star_experiments SET verdict = NULL, verdict_at = NULL, evidence = NULL; DELETE FROM decision_log WHERE assumption LIKE 'north-star-verdict:%'");
ok(verdictRun().verdict === "revert", "a 6 point rise is");
// one-shot: re-enable the switches, the next hours must not switch them off again
db.exec("UPDATE ops_config SET value = 'on' WHERE key IN ('north_star_focus', 'north_star_lever_gate')");
for (const n of ["ns-verdict", "ns-verdict-apply", "ns-verdict-log", "ns-verdict-next"]) db.exec(stepSql(db, "management-personas", n));
ok(one(db, "SELECT COUNT(*) c FROM ops_config WHERE key IN ('north_star_focus','north_star_lever_gate') AND value = 'on'").c === 2, "the revert is one-shot: a re-enabled switch stays on");
// the nine metrics born in breach are not counted against metrics_in_breach
setM("issue_wontfix_share_7d", 9.7);
db.exec("UPDATE north_star_experiments SET verdict = NULL, verdict_at = NULL, evidence = NULL; DELETE FROM decision_log WHERE assumption LIKE 'north-star-verdict:%'");
setM("metrics_in_breach", 99);
ok(verdictRun().verdict === "revert", "99 against a baseline of 90 reverts");
db.exec("UPDATE north_star_experiments SET verdict = NULL, verdict_at = NULL, evidence = NULL; DELETE FROM decision_log WHERE assumption LIKE 'north-star-verdict:%'; UPDATE ops_config SET value = 'on' WHERE key LIKE 'north_star_%' AND value = 'off'");
db.exec("INSERT INTO v_metric_trigger_state (id, metric_key, hit) VALUES (801, 'ns_fleet_cost_usd_month', 1), (802, 'ns_owner_urgent_cards', 1), (803, 'ns_readers_engaged_per_day', 1), (804, 'manager_agent_requests_24h', 1), (805, 'programs_without_strategic_proposal_7d', 1), (806, 'ns_ext_visits_per_paper_30d', 1)");
ok(verdictRun().verdict === "keep", "the same 99 is a keep once the six new metrics in breach are not counted");

// ---- 8. views: identical to the old ones with the switch off; North Star first with it on --------------------------------------------------------------------------------------
function seedViews(d) {
  d.exec(`INSERT INTO program_risk_now VALUES ('QNFO.OPS','pm:OPS','RED',800,40), ('QNFO.INFRA','pm:INFRA','RED',100,8), ('QNFO.REACH','pm:REACH','YELLOW',60,6), ('QNFO.PERSONAL','pm:PERS','GREEN',5,2);
INSERT INTO portfolio_allocations VALUES ('2026-11-04T12:00Z','QNFO.OPS','pm','RED',800,NULL,40,5,'constrain','x'), ('2026-11-04T12:00Z','QNFO.INFRA','pm','RED',100,NULL,8,5,'steady','x'), ('2026-11-04T12:00Z','QNFO.REACH','pm','YELLOW',60,NULL,6,5,'steady','x');
INSERT INTO v_metric_trigger_state VALUES (1,'content_items_over_stage_sla','gt',0,1500,1), (2,'workers_ai_cost_30d_usd','gt',95,508,1), (3,'tracker_drift','gt',0,14,1), (4,'issues_unprobed_60m','gt',10,258,1), (5,'ns_fleet_cost_usd_month','gt',300,799,1), (6,'tracker_drift_b','gt',0,2,1), (7,'secrets_in_repo','gt',0,6,1);
INSERT INTO v_program_focus_candidates VALUES
 ('QNFO.OPS',1,'METRIC-TRIGGER-1-CONTENT: c',2,1,0,'p'), ('QNFO.OPS',2,'METRIC-TRIGGER-2-COST: c',2,2,0,'p'), ('QNFO.OPS',3,'METRIC-TRIGGER-3-TRACKER-DRIFT: c',2,3,1,'p'), ('QNFO.OPS',4,'METRIC-TRIGGER-4-UNPROBED: c',2,4,0,'p'),
 ('QNFO.OPS',5,'METRIC-TRIGGER-5-NS-COST: c',2,5,0,'p'), ('QNFO.OPS',6,'plain critical',2,6,0,'p'), ('QNFO.OPS',7,'METRIC-TRIGGER-7-SECRETS: c',2,7,0,'p'),
 ('QNFO.INFRA',8,'plain',3,1,0,'p'), ('QNFO.REACH',9,'METRIC-TRIGGER-2-COST: c',2,1,0,'p');
INSERT INTO analytics_metric_triggers (id, metric_key, title) VALUES (101, 'x', 'x');
INSERT INTO agent_issues (id, title, status) SELECT id, title, 'open' FROM v_program_focus_candidates;`);
}
const planOf = (d) => all(d, "SELECT program_code, issue_id, rank, tier, has_doer, reason FROM v_program_focus_plan ORDER BY program_code, rank");
const allocOf = (d) => all(d, "SELECT * FROM v_portfolio_allocation_plan ORDER BY program_code");
function viewsDb(seedKind) {
  const d = build({ withMigration: false, oldViews: true });
  d.exec(`INSERT INTO metric_registry (metric, kind, last_value) VALUES ('secrets_in_repo','guard','6'), ('tracker_drift','lagging','14');`);
  seedViews(d);
  return d;
}
const dOld = viewsDb(); // old views, no migration
const dNew = build({ oldViews: true }); // old views first, then the migration replaces them
dNew.exec(`INSERT INTO metric_registry (metric, kind, last_value) VALUES ('secrets_in_repo','guard','6'), ('tracker_drift','lagging','14');`);
seedViews(dNew);
// trigger ids 1..7 are the ones the candidate titles name; make the links point at them
dNew.exec("DELETE FROM analytics_metric_triggers; DELETE FROM v_metric_trigger_state WHERE id > 7;");
for (const [id, mk] of [[1, "content_items_over_stage_sla"], [2, "workers_ai_cost_30d_usd"], [3, "tracker_drift"], [4, "issues_unprobed_60m"], [5, "ns_fleet_cost_usd_month"], [7, "secrets_in_repo"]]) {
  dNew.prepare("INSERT INTO analytics_metric_triggers (id, metric_key, title) VALUES (?, ?, 't')").run(id, mk);
  dOld.prepare("INSERT OR IGNORE INTO analytics_metric_triggers (id, metric_key, title) VALUES (?, ?, 't')").run(id, mk);
}
dNew.exec("INSERT OR REPLACE INTO north_star_links (metric_key, north_star, tier, weight, reason) VALUES ('secrets_in_repo', NULL, 'hygiene', 0, 'guard must not demote')");
dNew.exec("UPDATE ops_config SET value = 'off' WHERE key = 'north_star_focus'");
ok(JSON.stringify(planOf(dNew)) === JSON.stringify(planOf(dOld)), "switch off: the focus plan equals the old view", [planOf(dNew), planOf(dOld)]);
ok(JSON.stringify(allocOf(dNew)) === JSON.stringify(allocOf(dOld)), "switch off: the allocation equals the old view");
dNew.exec("UPDATE ops_config SET value = 'on' WHERE key = 'north_star_focus'");
const plan = planOf(dNew).filter((r) => r.program_code === "QNFO.OPS");
ok(plan[0].issue_id === 5 && /\[north star: cost\]/.test(plan[0].reason), "North Star metric issue is rank 1", plan[0]);
ok(plan[1].issue_id === 2 && /\[north star: cost\]/.test(plan[1].reason), "then the driver", plan[1]);
const ids = plan.map((r) => r.issue_id);
ok(ids.join() === "5,2,7,4,6", "North Star, driver, guard metric, then the old order for unlisted work (5 slots leave no room for hygiene)", ids);
dNew.exec("UPDATE portfolio_allocations SET slots = 9 WHERE program_code = 'QNFO.OPS'");
const wide = planOf(dNew).filter((r) => r.program_code === "QNFO.OPS");
ok(wide.map((r) => r.issue_id).join() === "5,2,7,4,6,1,3" && /hygiene metric: demoted/.test(wide[5].reason) && /hygiene metric: demoted/.test(wide[6].reason), "with spare slots the demoted metrics come last, in the old order", wide.map((r) => r.issue_id));
dNew.exec("UPDATE portfolio_allocations SET slots = 5 WHERE program_code = 'QNFO.OPS'");
ok(plan.find((r) => r.issue_id === 7) && /\[guard metric\]/.test(plan.find((r) => r.issue_id === 7).reason), "a guard-kind metric is never demoted and ranks after the drivers", plan.find((r) => r.issue_id === 7));
const alloc = Object.fromEntries(allocOf(dNew).map((r) => [r.program_code, r]));
const allocOld = Object.fromEntries(allocOf(dOld).map((r) => [r.program_code, r]));
// make the cost measure breached so INFRA (owner) gets the bonus
dNew.exec("INSERT OR REPLACE INTO metric_registry (metric, last_value) VALUES ('ns_fleet_cost_usd_month', '799'), ('ns_dashboard_load_ms_p75_24h', '4000')");
const alloc2 = Object.fromEntries(allocOf(dNew).map((r) => [r.program_code, r]));
ok(alloc2["QNFO.INFRA"].slots === Math.min(8, allocOld["QNFO.INFRA"].slots + 4) && /\+4 slots/.test(alloc2["QNFO.INFRA"].reason), "INFRA owns cost and reliability, both breached: +4 slots", [alloc2["QNFO.INFRA"], allocOld["QNFO.INFRA"]]);
ok(alloc2["QNFO.REACH"].slots === allocOld["QNFO.REACH"].slots || alloc2["QNFO.REACH"].slots === Math.min(6, allocOld["QNFO.REACH"].slots + 2), "REACH owns readers: bonus only when readers is breached");
ok(alloc["QNFO.OPS"].decision === "constrain" && alloc2["QNFO.OPS"].decision === "constrain", "the constraint program is still chosen by risk");
// hygiene cap
dNew.exec("DELETE FROM v_program_focus_candidates WHERE program_code = 'QNFO.OPS'");
for (let i = 0; i < 5; i++) {
  dNew.exec(`INSERT INTO analytics_metric_triggers (id, metric_key, title) VALUES (${200 + i}, 'tracker_drift', 't') ON CONFLICT DO NOTHING`);
}
dNew.exec("INSERT INTO v_program_focus_candidates VALUES ('QNFO.OPS',31,'METRIC-TRIGGER-3-A: c',2,1,0,'p'), ('QNFO.OPS',32,'METRIC-TRIGGER-3-B: c',2,2,0,'p'), ('QNFO.OPS',33,'METRIC-TRIGGER-3-C: c',2,3,0,'p'), ('QNFO.OPS',34,'METRIC-TRIGGER-3-D: c',2,4,0,'p')");
dNew.exec("INSERT INTO agent_issues (id, title, status) VALUES (31,'METRIC-TRIGGER-3-A','open'),(32,'METRIC-TRIGGER-3-B','open'),(33,'METRIC-TRIGGER-3-C','open'),(34,'METRIC-TRIGGER-3-D','open')");
const capped = planOf(dNew).filter((r) => r.program_code === "QNFO.OPS");
ok(capped.length === 2 && capped.every((r) => /hygiene metric: demoted/.test(r.reason)), "hygiene issues fill at most north_star_hygiene_slots (2)", capped);

console.log(fail ? "FAILED " + fail + " (passed " + pass + ")" : "ok " + pass);
process.exit(fail ? 1 : 0);
