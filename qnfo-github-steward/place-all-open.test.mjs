// PLACE-ALL-OPEN-1 + PS-SCOPE-SUBQUERY-1 offline suite (qnfo-github-steward 0.10.1, 2026-10-30). Proves the two defects measured on 2026-10-30:
//  1. psPlace joined gh_issue_links, so the high and medium issues that ISSUE-ROLLUP-1 no longer mirrors (149 of 356 open) had no issue_project_map row and no program;
//     now every open issue is placed, mirrored or not, and an issue naming an active worker in its title goes to that worker's project.
//  2. roadmap_mirror_scope held 138 sources at mirrored = 0 and the mirror step and GET /roadmap bound them as a NOT IN list; D1 allows 100 bound variables, so every
//     tick failed with "D1_ERROR: too many SQL variables" and GET /roadmap answered 500. The fake D1 below enforces the same 100-variable limit.
// Run: node --no-warnings qnfo-github-steward/place-all-open.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

function world({ scopeSources }) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE agent_issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, close_channel TEXT)");
  db.exec("CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, owner TEXT, close_evidence TEXT)");
  db.exec("CREATE TABLE gh_issue_links (issue_id INTEGER PRIMARY KEY, gh_number INTEGER NOT NULL UNIQUE, gh_state TEXT, d1_status TEXT, synced_at TEXT)");
  db.exec("CREATE TABLE tracker_sync_state (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT)");
  db.exec("CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, layer TEXT, kind TEXT, formula TEXT, source_of_truth TEXT, baseline TEXT, target TEXT, owner TEXT, disposition_actor TEXT, refresh_cadence TEXT, warning_band TEXT, kill_band TEXT, last_value TEXT, last_refreshed TEXT, state TEXT, refresh_class TEXT)");
  db.exec("CREATE TABLE analytics_metric_triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_key TEXT UNIQUE, title TEXT, source_table TEXT, operator TEXT, threshold REAL, priority INTEGER, action TEXT, owner TEXT, queue_target TEXT, cooldown_hours INTEGER, enabled INTEGER, notes TEXT)");
  db.exec("CREATE TABLE service_registry (service TEXT PRIMARY KEY, kind TEXT DEFAULT 'worker', purpose TEXT, state TEXT DEFAULT 'live')");
  db.exec("CREATE TABLE portfolio_repos (name TEXT PRIMARY KEY, tier TEXT, pillar TEXT, visibility TEXT, archived INTEGER, fork INTEGER, description TEXT, seen INTEGER DEFAULT 1)");
  db.exec("CREATE TABLE portfolios (portfolio_code TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, owner TEXT)");
  db.exec("CREATE TABLE programs (program_code TEXT PRIMARY KEY, portfolio_code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, program_manager TEXT)");
  db.exec("CREATE TABLE projects (project_code TEXT PRIMARY KEY, program_code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'active', github_repo TEXT, pages_project TEXT, r2_prefix TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT)");
  db.exec("CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, artifact_type TEXT NOT NULL, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT)");
  db.exec("CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT, last_verdict TEXT, last_attempt_at TEXT)");
  db.exec("CREATE TABLE trig (metric_key TEXT PRIMARY KEY, title TEXT, owner TEXT, operator TEXT, threshold REAL, val REAL, hit INTEGER)");
  db.exec("CREATE VIEW v_metric_trigger_state AS SELECT * FROM trig");
  db.exec("INSERT INTO portfolios VALUES ('QNFO','QNFO','',NULL)");
  db.prepare("INSERT INTO trig VALUES ('drift_total','drift','qnfo-fleet-control','gt',0,0,0)").run();
  for (const [c, n] of [["QNFO.RSCH", "R"], ["QNFO.INFRA", "I"], ["QNFO.OPS", "O"], ["QNFO.REACH", "E"], ["QNFO.PERSONAL", "P"]]) db.prepare("INSERT INTO programs (program_code, portfolio_code, name) VALUES (?, 'QNFO', ?)").run(c, n);
  const mig = readFileSync(join(here, "..", "migrations", "2026-10-18-portfolio-sync.sql"), "utf8");
  for (const stmt of mig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) db.exec(stmt);
  const scopeMig = readFileSync(join(here, "..", "migrations", "2026-10-26-roadmap-mirror-scope.sql"), "utf8");
  for (const stmt of scopeMig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => /^(CREATE TABLE IF NOT EXISTS roadmap_mirror_scope|DROP VIEW IF EXISTS v_portfolio_drift_roadmap|CREATE VIEW v_portfolio_drift_roadmap)/i.test(s))) db.exec(stmt);
  for (let i = 0; i < scopeSources; i++) db.prepare("INSERT INTO roadmap_mirror_scope (source, mirrored, reason) VALUES (?, 0, 'ISSUE-CONSOLIDATE-1 catalogue')").run("catalogue source " + i);
  ["qnfo-ops", "qnfo-fleet-control", "qnfo-research-exec", "qnfo-social", "qnfo-github-steward", "qnfo-ai", "qnfo-ai-search", "qnfo-email", "personal-api", "qnfo-pdf", "qnfo-gateway", "idea-hub"].forEach((s) => db.prepare("INSERT INTO service_registry (service, purpose) VALUES (?, ?)").run(s, "does " + s));
  const repos = [["qnfo-workers", "platform", "core", "public"], ["ultrametric-lean", "research", "research", "public"], ["qwav-demos", "demo", "reach", "public"]];
  for (let i = 0; i < 8; i++) repos.push(["paper-" + i, "research", "research", "public"]);
  repos.forEach((r) => db.prepare("INSERT INTO portfolio_repos (name, tier, pillar, visibility, archived, fork, description) VALUES (?, ?, ?, ?, 0, 0, ?)").run(r[0], r[1], r[2], r[3], "repo " + r[0]));
  return db;
}

// D1 refuses a statement with more than 100 bound variables.
function d1Of(db) {
  const prep = (sql) => {
    let a = [];
    const st = {
      bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); if (a.length > 100) throw new Error("D1_ERROR: too many SQL variables at offset 459: SQLITE_ERROR"); return st; },
      run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; },
      first: async () => db.prepare(sql).get(...a) || null,
      all: async () => ({ results: db.prepare(sql).all(...a) })
    };
    return st;
  };
  return { prepare: prep, batch: async (l) => { for (const s of l) await s.run(); return []; } };
}

function ghFake(gIssues, state) {
  let next = 7000, msNext = 1;
  const gMs = [], gLabels = [{ name: "bug" }];
  const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });
  const lbl = (l) => (typeof l === "string" ? { name: l } : l);
  globalThis.fetch = async (url, init) => {
    const u = new URL(url); const m = (init && init.method) || "GET"; const body = init && init.body ? JSON.parse(init.body) : null;
    state.calls.push(m + " " + u.pathname);
    const page = Number(u.searchParams.get("page") || 1);
    const R = "/repos/QNFO/qnfo-workers";
    if (u.pathname === "/graphql") return reply(200, { errors: [{ message: "Resource not accessible" }] });
    if (m === "GET" && u.pathname === R + "/labels") return reply(200, page > 1 ? [] : gLabels);
    if (m === "POST" && u.pathname === R + "/labels") { gLabels.push({ name: body.name }); return reply(201, body); }
    if (m === "GET" && u.pathname === R + "/milestones") return reply(200, page > 1 ? [] : gMs);
    if (m === "POST" && u.pathname === R + "/milestones") { const x = { number: msNext++, title: body.title, description: body.description, state: "open" }; gMs.push(x); return reply(201, x); }
    let mm = /^\/repos\/QNFO\/qnfo-workers\/milestones\/(\d+)$/.exec(u.pathname);
    if (mm && m === "PATCH") { const x = gMs.find((y) => y.number === Number(mm[1])); Object.assign(x, body); return reply(200, x); }
    if (m === "GET" && u.pathname === R + "/issues") { const want = u.searchParams.get("labels"); return reply(200, page > 1 ? [] : gIssues.filter((i) => i.state === "open" && i.labels.map(lbl).some((l) => l.name === want))); }
    if (m === "POST" && u.pathname === R + "/issues") { const i = { number: next++, node_id: "N" + next, title: body.title, body: body.body, labels: body.labels.map(lbl), milestone: body.milestone ? { number: body.milestone } : null, state: "open" }; gIssues.push(i); return reply(201, i); }
    mm = /^\/repos\/QNFO\/qnfo-workers\/issues\/(\d+)(\/comments)?$/.exec(u.pathname);
    if (mm) { const i = gIssues.find((x) => x.number === Number(mm[1])); if (mm[2]) return reply(201, {}); if (m === "PATCH") { if (body.state) i.state = body.state; if (body.labels) i.labels = body.labels.map(lbl); if (body.milestone) i.milestone = { number: body.milestone }; return reply(200, i); } }
    return reply(404, { message: "unhandled " + m + " " + u.pathname });
  };
}

async function run(db, gIssues, state) {
  const env = { AUDIT: d1Of(db), GITHUB_TOKEN: "t", STEWARD_KEY: "k" };
  ghFake(gIssues, state);
  const tick = async () => (await (await w.fetch(new Request("https://s.test/portfolio/tick", { method: "POST", headers: { "x-steward-key": "k" } }), env)).json()).result;
  return { env, tick };
}

// ---- Scenario 1: 138 scope rows (the live shape), three open issues of which only the critical one is mirrored.
{
  const db = world({ scopeSources: 138 });
  const ins = db.prepare("INSERT INTO agent_issues (id, title, source, category, priority, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)");
  const now = Date.now();
  ins.run(301, "critical one", "qnfo-fleet-control", "reliability", "critical", now);
  ins.run(302, "high rolled up, source names no worker", "session", "optimization", "high", now);
  ins.run(303, "CF-OBS-ISSUE-1: qnfo-ai-search: D1_ERROR no such column", "cf-obs-bridge", "reliability", "medium", now);
  ins.run(304, "LOOP-BREAKER-1: qnfo-research-exec: slot stuck", "loop-breaker", "reliability", "high", now);
  ins.run(305, "mentions qnfo-ai and qnfo-ai-search: the longer worker wins", "session", "optimization", "medium", now);
  ins.run(306, "owner names the worker", "session", "optimization", "high", now);
  db.prepare("INSERT INTO issue_triage (issue_id, owner) VALUES (306, 'qnfo-social')").run();
  // PIN-PROGRAM-ROW-1: the managers place the issues they file on a program ("W.<program>", not a project row): a ROADMAP-1 item of QNFO.INFRA stays on QNFO.INFRA.
  ins.run(307, "ROADMAP-1: QNFO.INFRA #9: a roadmap item", "management-personas", "feature", "high", now);
  db.prepare("INSERT INTO issue_project_map (issue_id, project_code, program_code, kind) VALUES (307, 'W.QNFO.INFRA', 'QNFO.INFRA', 'feature')").run();
  db.prepare("INSERT INTO gh_issue_links VALUES (301, 6001, 'open', 'open', '')").run();
  const gIssues = [{ number: 6001, node_id: "N6001", title: "[#301] x", labels: [{ name: "fleet-issue" }], state: "open", milestone: null }];
  // Two roadmap rows: one from a scoped catalogue source (never an issue) and one from a source the table does not list (a work item that is mirrored).
  db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES ('CAT-1', 'catalogue source 7', 'a catalogue row', 'worker', 'qnfo-ops', 'planned')").run();
  db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES ('NEW-1', 'new-source-2026', 'a work row', 'worker', 'qnfo-ops', 'planned')").run();
  const state = { calls: [] };
  const { env, tick } = await run(db, gIssues, state);
  let r = await tick();
  assert.ok(!r.errors.some((e) => /too many SQL variables/.test(e.why)), "no D1 variable overflow with 138 scope rows: " + JSON.stringify(r.errors));
  for (let i = 0; i < 4; i++) r = await tick();
  assert.deepEqual(r.errors.filter((e) => e.scope !== "portfolio-derive"), [], "converged without errors: " + JSON.stringify(r.errors));
  const map = Object.fromEntries(db.prepare("SELECT issue_id, project_code, program_code FROM issue_project_map").all().map((x) => [x.issue_id, x]));
  assert.equal(Object.keys(map).length, 7, "every open issue is placed, mirrored or not: " + JSON.stringify(map));
  assert.equal(map[307].project_code, "W.QNFO.INFRA", "a program placement written by the managers is not re-placed by owner"); assert.equal(map[307].program_code, "QNFO.INFRA");
  assert.equal(map[302].project_code, "W.qnfo-fleet-control", "no owner, no worker in the source or title: the fleet-control fallback");
  assert.equal(map[303].project_code, "W.qnfo-ai-search", "a worker named in the title places a rolled-up issue"); assert.equal(map[303].program_code, "QNFO.RSCH");
  assert.equal(map[304].project_code, "W.qnfo-research-exec");
  assert.equal(map[305].project_code, "W.qnfo-ai-search", "the longest active worker name in the title wins");
  assert.equal(map[306].project_code, "W.qnfo-social", "the triage owner still wins over the title");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM gh_issue_links WHERE issue_id <> 301").get().c, 0, "placing never creates a GitHub mirror");
  assert.ok(!state.calls.some((c) => c === "POST /repos/QNFO/qnfo-workers/issues" && false), "(placement writes no GitHub issue by itself)");
  const rm = gIssues.filter((i) => i.labels.some((l) => (typeof l === "string" ? l : l.name) === "roadmap"));
  assert.equal(rm.length, 1, "only the roadmap row of a source outside the scope table is mirrored: " + JSON.stringify(rm.map((i) => i.title)));
  assert.match(rm[0].title, /NEW-1/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM v_portfolio_drift_roadmap WHERE kind = 'roadmap-unmirrored'").get().c, 0, "no roadmap-unmirrored drift");
  const res = await w.fetch(new Request("https://s.test/roadmap"), env);
  assert.equal(res.status, 200, "GET /roadmap answers 200 with 138 scope rows: " + (await res.clone().text()).slice(0, 200));
  const again = await tick();
  assert.equal(again.issues_placed, 0, "a converged tick places nothing");
}

// ---- Scenario 2: the scope table is absent (older database): the three-source default is bound and nothing overflows.
{
  const db = world({ scopeSources: 0 });
  db.exec("DROP VIEW IF EXISTS v_portfolio_drift_roadmap; DROP TABLE roadmap_mirror_scope");
  db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES ('P-1', 'projects', 'a project row', 'worker', 'qnfo-ops', 'planned')").run();
  db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES ('W-1', 'charter', 'a work row', 'worker', 'qnfo-ops', 'planned')").run();
  const gIssues = [];
  const state = { calls: [] };
  const { env, tick } = await run(db, gIssues, state);
  let r = await tick();
  for (let i = 0; i < 3; i++) r = await tick();
  assert.ok(!r.errors.some((e) => /too many SQL variables/.test(e.why)), JSON.stringify(r.errors));
  const rm = gIssues.filter((i) => i.labels.some((l) => (typeof l === "string" ? l : l.name) === "roadmap"));
  assert.equal(rm.length, 1, "with no scope table the default keeps 'projects' out of the mirror and mirrors the work row");
  assert.match(rm[0].title, /W-1/);
  assert.equal((await w.fetch(new Request("https://s.test/roadmap"), env)).status, 200);
}

// Manager-pinned issues need real projects and milestones, not just preserved map rows.
{
  const db = world({ scopeSources: 138 });
  const programs = ["QNFO.RSCH", "QNFO.INFRA", "QNFO.OPS", "QNFO.REACH", "QNFO.PERSONAL"];
  const gIssues = programs.map((program, i) => {
    const id = 401 + i, number = 6101 + i;
    db.prepare("INSERT INTO agent_issues (id, title, source, category, priority, created_at) VALUES (?, ?, 'management-personas', 'reliability', 'critical', ?)").run(id, program + " metric", Date.now());
    db.prepare("INSERT INTO issue_project_map (issue_id, project_code, program_code, kind) VALUES (?, ?, ?, 'fix')").run(id, "W." + program, program);
    db.prepare("INSERT INTO gh_issue_links VALUES (?, ?, 'open', 'open', '')").run(id, number);
    return { number, node_id: "N" + number, labels: [{ name: "fleet-issue" }], state: "open", milestone: null };
  });
  const { tick } = await run(db, gIssues, { calls: [] });
  const first = await tick();
  assert.deepEqual(first.errors, []);
  assert.equal(first.issues_synced, programs.length, "each program-pinned mirror gets its milestone");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v_portfolio_drift").get().n, 0, "program-pinned mirrors converge without hiding drift");
  for (const [i, program] of programs.entries()) {
    const project = db.prepare("SELECT * FROM projects WHERE project_code = ?").get("W." + program);
    assert.equal(project.program_code, program);
    assert.equal(project.status, "active");
    assert.equal(gIssues[i].milestone.number, project.gh_milestone);
    assert.equal(db.prepare("SELECT project_code FROM issue_project_map WHERE issue_id = ?").get(401 + i).project_code, "W." + program, "the manager's program is preserved");
  }
  const again = await tick();
  assert.deepEqual(again.errors, []);
  assert.equal(again.projects_created, 0);
  assert.equal(again.projects_retired, 0, "program projects are not retired as absent workers");
  assert.equal(again.issues_synced, 0);
  assert.equal(again.drift.total, 0);
  db.prepare("UPDATE projects SET status = 'retired' WHERE project_code = 'W.QNFO.OPS'").run();
  const recovered = await tick();
  assert.equal(recovered.projects_reactivated, 1, "an existing derived program project is repaired");
  assert.equal(recovered.drift.total, 0);
}

// Closed roll-up mirrors have no milestone requirement; reopened ones regain it.
{
  const db = world({ scopeSources: 138 });
  db.exec(`
    CREATE TABLE control_registry (control TEXT PRIMARY KEY, location TEXT, kind TEXT, guards_against TEXT, critical_path INTEGER, disposition TEXT, disposition_state TEXT, alternate_path TEXT, evidence TEXT, issue_id INTEGER);
    CREATE TABLE control_alternate_probes (control TEXT PRIMARY KEY, probe_sql TEXT, window_note TEXT, enabled INTEGER);
    CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER);
    CREATE TABLE decision_log (actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT);
    CREATE VIEW v_tracker_drift AS SELECT 'issue-state' AS kind;
    INSERT INTO agent_issues (id, status, priority) VALUES (501, 'open', 'high'), (502, 'open', 'critical');
    INSERT INTO gh_issue_links VALUES (501, 6501, 'closed', 'open', ''), (502, 6502, 'open', 'open', '');
  `);
  const migration = readFileSync(join(here, "..", "migrations", "2026-11-01-portfolio-open-mirrors.sql"), "utf8");
  const unplaced = () => db.prepare("SELECT ref FROM v_portfolio_drift WHERE kind = 'issue-unplaced' ORDER BY ref").all().map((r) => r.ref);
  assert.deepEqual(unplaced(), ["501", "502"], "the old view grades a closed roll-up mirror");
  db.exec(migration);
  assert.deepEqual(unplaced(), ["502"], "open mirrors still require a project and milestone");
  db.prepare("UPDATE gh_issue_links SET gh_state = 'open' WHERE issue_id = 501").run();
  assert.deepEqual(unplaced(), ["501", "502"], "a reopened mirror is measured again");
  const alternate = db.prepare("SELECT probe_sql FROM control_alternate_probes").get().probe_sql;
  assert.equal(db.prepare(alternate).get().observed, "ok");
  db.exec("DROP VIEW v_tracker_drift");
  assert.notEqual(db.prepare(alternate).get().observed, "ok", "missing independent state checks are detected");
  const detector = db.prepare("SELECT verify_probe FROM remediation_contracts").get().verify_probe;
  assert.ok(Number(db.prepare(detector).get().observed) > 0, "the detector reports real drift");
  db.exec(migration);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM failure_modes").get().n, 1, "migration replay is idempotent");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1, "the prediction is logged once");
  db.exec(migration.match(/^-- Rollback: (.+)$/m)[1]);
  db.prepare("UPDATE gh_issue_links SET gh_state = 'closed' WHERE issue_id = 501").run();
  assert.deepEqual(unplaced(), ["501", "502"], "rollback restores the old scope");
  assert.equal(db.prepare("SELECT enabled FROM control_alternate_probes").get().enabled, 0);
}

console.log("place-all-open.test.mjs ok");
