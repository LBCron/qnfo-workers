// PORTFOLIO-SYNC-1 offline suite: projects derive from the census, metric breaches become roadmap objectives, issues are placed
// in project milestones with program/kind labels, roadmap items mirror to GitHub and follow D1, and every refusal path holds.
// Run: node qnfo-github-steward/portfolio-sync.test.mjs
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
const here = dirname(fileURLToPath(import.meta.url));
const w = (await import(pathToFileURL(join(here, "worker.js")).href)).default;

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
db.exec("CREATE TABLE trig (metric_key TEXT PRIMARY KEY, title TEXT, owner TEXT, operator TEXT, threshold REAL, val REAL, hit INTEGER)");
db.exec("CREATE VIEW v_metric_trigger_state AS SELECT * FROM trig");
db.exec("INSERT INTO portfolios VALUES ('QNFO','QNFO','',NULL)");
for (const [c, n] of [["QNFO.RSCH", "R"], ["QNFO.INFRA", "I"], ["QNFO.OPS", "O"]]) db.prepare("INSERT INTO programs (program_code, portfolio_code, name) VALUES (?, 'QNFO', ?)").run(c, n);
db.prepare("INSERT INTO projects (project_code, program_code, name, status, github_repo) VALUES ('QNFO.RSCH.PAPER','QNFO.RSCH','Pipeline','active','QNFO/qnfo-rsch')").run();
db.prepare("INSERT INTO projects (project_code, program_code, name, status, github_repo) VALUES ('QNFO.RSCH.APH','QNFO.RSCH','APH','active','x')").run();

const mig = readFileSync(join(here, "..", "migrations", "2026-10-18-portfolio-sync.sql"), "utf8");
for (const stmt of mig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) db.exec(stmt);
// PORTFOLIO-NOT-ISSUES-1: the scope table, its seed and the drift view that reads it (only those statements: the rest of the file writes registers this fixture does not have).
const scopeMig = readFileSync(join(here, "..", "migrations", "2026-10-26-roadmap-mirror-scope.sql"), "utf8");
for (const stmt of scopeMig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => /^(CREATE TABLE IF NOT EXISTS roadmap_mirror_scope|INSERT OR IGNORE INTO roadmap_mirror_scope|DROP VIEW IF EXISTS v_portfolio_drift_roadmap|CREATE VIEW v_portfolio_drift_roadmap)/i.test(s))) db.exec(stmt);
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_mirror_scope WHERE mirrored = 0").get().c, 3, "the scope seed takes three sources out of the mirror");
for (let i = 0; i < 135; i++) db.prepare("INSERT INTO roadmap_mirror_scope (source, mirrored, reason) VALUES (?, 0, 'portfolio sync fixture')").run("catalogue-source-" + i);
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_mirror_scope WHERE mirrored = 0").get().c, 138, "the scope fixture matches the 138 excluded sources that exposed the D1 bind limit");
assert.equal(db.prepare("SELECT github_repo FROM projects WHERE project_code='QNFO.RSCH.PAPER'").get().github_repo, "QNFO/qnfo-workers", "404 repo repointed");
assert.equal(db.prepare("SELECT status FROM projects WHERE project_code='QNFO.RSCH.APH'").get().status, "archived", "archived-repo project archived");
assert.equal(db.prepare("SELECT count(*) c FROM programs").get().c, 5);

const workers = ["qnfo-ops", "qnfo-fleet-control", "qnfo-research-exec", "qnfo-social", "qnfo-github-steward", "qnfo-ai", "qnfo-email", "personal-api", "qnfo-pdf", "qnfo-gateway", "idea-hub"];
for (let i = 0; i < 30; i++) workers.push("qnfo-test-worker-" + i);
workers.forEach((s) => db.prepare("INSERT INTO service_registry (service, purpose) VALUES (?, ?)").run(s, "does " + s));
const repos = [["qnfo-workers", "platform", "core", "public"], ["ultrametric-lean", "research", "research", "public"], ["qwav-demos", "demo", "reach", "public"], ["deepchat", "client-config", "personal", "private"], ["old", "research", "research", "public", 1]];
for (let i = 0; i < 8; i++) repos.push(["paper-" + i, "research", "research", "public"]);
repos.forEach((r) => db.prepare("INSERT INTO portfolio_repos (name, tier, pillar, visibility, archived, fork, description) VALUES (?, ?, ?, ?, ?, 0, ?)").run(r[0], r[1], r[2], r[3], r[4] || 0, "repo " + r[0]));

const now = Date.now();
const ins = db.prepare("INSERT INTO agent_issues (id, title, source, category, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)");
ins.run(201, "fix a", "qnfo-fleet-control", "reliability", now); ins.run(202, "add b", "session", "optimization", now); ins.run(203, "research c", "x", "research", now);
db.prepare("INSERT INTO issue_triage (issue_id, owner) VALUES (202, 'qnfo-social')").run();
// PS-KEEP-CATALOGUE-PROJECT-1 (0.9.1, agent_issues 2993): 204 is a catalogue issue placed by its catalogue on an active BP26 project, 205 sits on a W.<worker> project
// that is not the one its triage owner names, 206 sits on a BP26 project that is not active, 207 is a catalogue issue whose project is not in the table at all.
db.prepare("INSERT INTO projects (project_code, program_code, name, status) VALUES ('BP26.TEST', 'QNFO.OPS', 'BP26 test', 'active'), ('BP26.OLD', 'QNFO.OPS', 'BP26 old', 'completed')").run();
ins.run(204, "bp26 item", "bp26-catalogue", "enhancement", now); ins.run(205, "moved item", "session", "optimization", now); ins.run(206, "old item", "bp26-catalogue", "enhancement", now); ins.run(207, "orphan item", "bp26-catalogue", "enhancement", now);
db.prepare("INSERT INTO issue_triage (issue_id, owner) VALUES (205, 'qnfo-social')").run();
db.prepare("INSERT INTO issue_project_map (issue_id, project_code, program_code, kind) VALUES (204, 'BP26.TEST', 'QNFO.OPS', 'enhancement'), (205, 'W.qnfo-ops', 'QNFO.OPS', 'enhancement'), (206, 'BP26.OLD', 'QNFO.OPS', 'enhancement'), (207, 'BP26.GONE', 'QNFO.OPS', 'enhancement')").run();
let gIssues = [], gNext = 7000, gMs = [], msNext = 1, gLabels = [{ name: "bug" }], calls = [], failMs = false, gqlFail = true;
for (const [id, num] of [[201, 6001], [202, 6002], [203, 6003], [204, 6004], [205, 6005], [206, 6006], [207, 6007]]) { db.prepare("INSERT INTO gh_issue_links VALUES (?, ?, 'open', 'open', '')").run(id, num); gIssues.push({ number: num, node_id: "N" + num, title: "[#" + id + "] x", labels: [{ name: "fleet-issue" }, { name: "bug" }], state: "open", milestone: null }); }
db.prepare("INSERT INTO trig VALUES ('open_agent_issues','too many issues','qnfo-fleet-control','gt',0,227,1)").run();
db.prepare("INSERT INTO trig VALUES ('drift_total','drift','qnfo-fleet-control','gt',0,0,0)").run();
db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES ('RM-X','charter','build x','worker','qnfo-research-exec 1.0','not-built')").run();
db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES ('AI-201','agent_issues','copy of issue 201','core','201','open')").run();
db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, evidence) VALUES ('RM-DONE','charter','done','worker','qnfo-ops','verified','ok')").run();
for (let i = 0; i < 45; i++) db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status) VALUES (?, 'charter', ?, 'worker', 'qnfo-research-exec', 'not-built')").run("RM-BACKFILL-" + i, "backfill " + i);

const prep = (sql) => { let a = []; const st = { bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); if (a.length > 100) throw new Error("D1_ERROR: too many SQL variables"); return st; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; };
const AUDIT = { prepare: prep, batch: async (l) => { for (const s of l) await s.run(); return []; } };
const env = { AUDIT, GITHUB_TOKEN: "t", STEWARD_KEY: "k" };
const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });
const lbl = (l) => (typeof l === "string" ? { name: l } : l);
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const m = (init && init.method) || "GET"; const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push(m + " " + u.pathname);
  const page = Number(u.searchParams.get("page") || 1);
  const R = "/repos/QNFO/qnfo-workers";
  if (u.pathname === "/graphql") { if (gqlFail) return reply(200, { errors: [{ message: "Resource not accessible" }] }); return reply(200, { data: {} }); }
  if (m === "GET" && u.pathname === R + "/labels") return reply(200, page > 1 ? [] : gLabels);
  if (m === "POST" && u.pathname === R + "/labels") { gLabels.push({ name: body.name }); return reply(201, body); }
  if (m === "GET" && u.pathname === R + "/milestones") { if (failMs) return reply(502, {}); return reply(200, page > 1 ? [] : gMs); }
  if (m === "POST" && u.pathname === R + "/milestones") { const x = { number: msNext++, title: body.title, description: body.description, state: "open" }; gMs.push(x); return reply(201, x); }
  let mm = /^\/repos\/QNFO\/qnfo-workers\/milestones\/(\d+)$/.exec(u.pathname);
  if (mm && m === "PATCH") { const x = gMs.find((y) => y.number === Number(mm[1])); Object.assign(x, body); return reply(200, x); }
  if (m === "GET" && u.pathname === R + "/issues") {
    const want = u.searchParams.get("labels");
    return reply(200, page > 1 ? [] : gIssues.filter((i) => i.state === "open" && i.labels.map(lbl).some((l) => l.name === want)));
  }
  if (m === "POST" && u.pathname === R + "/issues") { const i = { number: gNext++, node_id: "N" + gNext, title: body.title, body: body.body, labels: body.labels.map(lbl), milestone: body.milestone ? { number: body.milestone } : null, state: "open" }; gIssues.push(i); return reply(201, i); }
  mm = /^\/repos\/QNFO\/qnfo-workers\/issues\/(\d+)(\/comments)?$/.exec(u.pathname);
  if (mm) {
    const i = gIssues.find((x) => x.number === Number(mm[1]));
    if (mm[2]) return reply(201, {});
    if (m === "GET") return reply(i ? 200 : 404, i || {});
    if (m === "PATCH") { if (body.state) i.state = body.state; if (body.labels) i.labels = body.labels.map(lbl); if (body.milestone) i.milestone = { number: body.milestone }; return reply(200, i); }
  }
  return reply(404, { message: "unhandled " + m + " " + u.pathname });
};
const tick = async () => (await (await w.fetch(new Request("https://s.test/portfolio/tick", { method: "POST", headers: { "x-steward-key": "k" } }), env)).json()).result;

// Tick 1 (milestone cap 15 per tick, so convergence takes more than one tick by design).
const r1 = await tick();
assert.deepEqual(r1.errors, [], JSON.stringify(r1.errors));
const codes = db.prepare("SELECT project_code FROM projects WHERE source='derived' ORDER BY 1").all().map((x) => x.project_code);
assert.ok(codes.includes("W.qnfo-ops") && codes.includes("W.personal-api") && codes.includes("R.ultrametric-lean") && codes.includes("R.qwav-demos"));
assert.ok(!codes.includes("R.deepchat") && !codes.includes("R.old") && !codes.includes("R.qnfo-workers"), "private / archived / monorepo repos are not projects");
assert.equal(db.prepare("SELECT program_code FROM projects WHERE project_code='W.personal-api'").get().program_code, "QNFO.PERSONAL");
assert.equal(db.prepare("SELECT program_code FROM projects WHERE project_code='W.qnfo-research-exec'").get().program_code, "QNFO.RSCH");
assert.equal(db.prepare("SELECT program_code FROM projects WHERE project_code='W.qnfo-social'").get().program_code, "QNFO.REACH");
assert.equal(r1.objectives_opened, 1);
assert.equal(db.prepare("SELECT status FROM roadmap_implementation WHERE item='RM-METRIC-open_agent_issues'").get().status, "open");
const map = Object.fromEntries(db.prepare("SELECT issue_id, project_code, kind FROM issue_project_map").all().map((x) => [x.issue_id, x]));
assert.equal(map[201].project_code, "W.qnfo-fleet-control"); assert.equal(map[201].kind, "fix");
assert.equal(map[202].project_code, "W.qnfo-social", "the triage owner places the issue"); assert.equal(map[202].kind, "enhancement");
assert.equal(map[203].kind, "research");
assert.equal(map[204].project_code, "BP26.TEST", "PS-KEEP-CATALOGUE-PROJECT-1: an open issue on an active catalogue project (not a W.<worker> project) keeps it");
assert.equal(db.prepare("SELECT program_code FROM issue_project_map WHERE issue_id = 204").get().program_code, "QNFO.OPS", "the kept row is left as the catalogue wrote it");
assert.equal(map[205].project_code, "W.qnfo-social", "an open issue on a W.<worker> project is still placed by its triage owner");
assert.equal(map[206].project_code, "W.qnfo-fleet-control", "an issue on a catalogue project that is not active is placed by owner (no active project to keep)");
assert.equal(map[207].project_code, "W.qnfo-fleet-control", "an issue whose project is not in the table is placed by owner");
assert.ok(gLabels.some((l) => l.name === "program:reach") && gLabels.some((l) => l.name === "kind:fix") && gLabels.some((l) => l.name === "roadmap"));
assert.equal(r1.milestones_created, 40, "milestone backfill matches the 40-item sync batch");
assert.equal(r1.roadmap_mirrored, 40, "roadmap backfill matches the 40-item sync batch");
assert.ok(r1.limitations.some((l) => /projects-v2/.test(l)), "a board failure is a limitation, not an error");

for (let i = 0; i < 4; i++) await tick();
const r = await tick();
assert.deepEqual(r.errors, []);
assert.equal(r.drift.total, 0, "converged: " + JSON.stringify(r.drift));
assert.equal(db.prepare("SELECT last_value FROM metric_registry WHERE metric='portfolio_drift'").get().last_value, "0");
const i202 = gIssues.find((x) => x.number === 6002);
assert.ok(i202.milestone && i202.labels.some((l) => l.name === "program:reach") && i202.labels.some((l) => l.name === "bug"), "milestone + managed labels set, unmanaged labels kept");
const rmIssues = gIssues.filter((x) => x.labels.some((l) => l.name === "roadmap"));
assert.equal(rmIssues.length, 46, "open roadmap work is mirrored across bounded ticks; the metric objective is out of scope (PORTFOLIO-NOT-ISSUES-1), the verified item and the agent_issues copy are not");
assert.ok(!gIssues.some((i) => /RM-METRIC/.test(i.title)), "a metric-breach objective is never filed as a GitHub issue: its METRIC-TRIGGER ticket tracks the breach");
assert.ok(!gIssues.some((i) => /AI-201/.test(i.title)), "an agent_issues copy is never filed twice");
assert.ok(rmIssues.find((x) => /RM-X/.test(x.title)).milestone, "roadmap item lands in its worker's project milestone");
assert.ok(gMs.find((m) => /^QNFO\.RSCH\.APH/.test(m.title)) === undefined, "archived project gets no milestone");

assert.ok(!/does personal-api/.test(gMs.find((m) => /^W\.personal-api/.test(m.title)).description), "personal milestones carry no description");
// Idempotent.
calls = [];
await tick();
assert.ok(!calls.some((c) => /^(POST|PATCH) /.test(c) && !c.startsWith("POST /graphql")), "a converged tick writes nothing to GitHub: " + calls.filter((c) => /^(POST|PATCH)/.test(c)).join(","));

// Breach clears -> objective verified -> roadmap issue closed with evidence. Hand-close of an open item is reopened.
db.prepare("UPDATE trig SET val=0, hit=0 WHERE metric_key='open_agent_issues'").run();
const rmx = rmIssues.find((x) => /RM-X/.test(x.title)); rmx.state = "closed";
const r6 = await tick();
assert.equal(r6.objectives_verified, 1);
assert.equal(r6.roadmap_closed, 0, "the metric objective had no GitHub issue to close"); assert.equal(r6.roadmap_reopened, 1);
assert.equal(rmx.state, "open", "D1 is authoritative for roadmap state");
assert.match(db.prepare("SELECT evidence FROM roadmap_implementation WHERE item='RM-METRIC-open_agent_issues'").get().evidence, /^cleared: measured 0/);

// Worker retired from the census -> derived project retired -> milestone closed; legacy rows never retired.
db.prepare("UPDATE service_registry SET state='retired' WHERE service='qnfo-gateway'").run();
const r7 = await tick();
assert.equal(r7.projects_retired, 1);
assert.equal(gMs.find((m) => /^W\.qnfo-gateway/.test(m.title)).state, "closed");
assert.equal(db.prepare("SELECT status FROM projects WHERE project_code='QNFO.RSCH.PAPER'").get().status, "active");

// Degenerate source: nothing retired.
db.exec("CREATE TABLE sr_bak AS SELECT * FROM service_registry"); db.exec("DELETE FROM service_registry");
const r8 = await tick();
assert.ok(r8.errors.some((e) => e.scope === "portfolio-derive"));
assert.equal(r8.projects_retired, 0);
assert.equal(db.prepare("SELECT status FROM projects WHERE project_code='W.qnfo-ops'").get().status, "active", "an empty census never retires projects");
db.exec("INSERT INTO service_registry SELECT * FROM sr_bak");

// A failed milestone list changes nothing on GitHub.
failMs = true; calls = [];
const r9 = await tick();
assert.ok(r9.errors.some((e) => e.scope === "portfolio-milestones"));
assert.ok(!calls.some((c) => c.startsWith("PATCH /repos/QNFO/qnfo-workers/issues")), "no issue placement on a failed milestone read");
failMs = false;

// Roadmap mass-flip guard (TRACKER-DRAIN-1). "Explained" = the item moved across done/not-done since its link last agreed (the link's
// d1_status differs). Recently created or verified rows whose d1_status already equals status, vanished from GitHub's open list (a
// label rename), are unexplained: refused with zero writes. A real D1 change inside that mass is still processed.
const rmGIns = db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, created_at, verified_at) VALUES (?, 'charter', ?, 'worker', 'qnfo-ops', 'not-built', ?, ?)");
const rmGLink = db.prepare("INSERT INTO roadmap_gh_links (roadmap_id, gh_number, gh_state, d1_status, synced_at) VALUES (?, ?, 'open', 'not-built', '')");
const nowIso = new Date().toISOString(), gIds = [];
for (let i = 0; i < 60; i++) { const id = Number(rmGIns.run("RM-G" + i, "guard " + i, nowIso, nowIso).lastInsertRowid); gIds.push(id); rmGLink.run(id, 9500 + i); gIssues.push({ number: 9500 + i, node_id: "NG" + i, title: "[RM-" + id + "] g", labels: i < 3 ? [{ name: "roadmap" }] : [], state: "open" }); }
calls = [];
const rg1 = await tick();
assert.ok(rg1.errors.some((e) => e.scope === "portfolio-roadmap" && /mass state flip/.test(e.why)), "recently touched roadmap rows whose d1_status equals status are unexplained and refused: " + JSON.stringify(rg1.errors.map((e) => e.scope)));
assert.ok(!calls.some((c) => /^(PATCH|POST) \/repos\/QNFO\/qnfo-workers\/issues\/95(0[3-9]|[12]\d)/.test(c)), "and nothing is written to the unexplained ones");
for (const id of gIds.slice(0, 3)) db.prepare("UPDATE roadmap_implementation SET status='verified', evidence='ok', verified_at=? WHERE id=?").run(nowIso, id);
calls = [];
const rg2 = await tick();
assert.ok(rg2.errors.some((e) => e.scope === "portfolio-roadmap" && /mass state flip/.test(e.why)), "the unexplained mass is still refused");
const rgPatched = calls.filter((c) => /^PATCH \/repos\/QNFO\/qnfo-workers\/issues\/95\d\d$/.test(c)).sort();
assert.deepEqual(rgPatched, ["PATCH /repos/QNFO/qnfo-workers/issues/9500", "PATCH /repos/QNFO/qnfo-workers/issues/9501", "PATCH /repos/QNFO/qnfo-workers/issues/9502"], "only the three real D1 changes are closed");
db.prepare("DELETE FROM roadmap_gh_links WHERE gh_number >= 9500 AND gh_number < 9600").run(); db.prepare("DELETE FROM roadmap_implementation WHERE item LIKE 'RM-G%'").run();
gIssues = gIssues.filter((x) => !(x.number >= 9500 && x.number < 9600));

// Public tree: personal projects counted, not itemised.
const tree = await (await w.fetch(new Request("https://s.test/roadmap"), env)).json();
const pers = tree.programs.find((p) => p.program === "QNFO.PERSONAL");
assert.ok(pers.projects >= 1 && pers.items === undefined);
assert.ok(tree.programs.find((p) => p.program === "QNFO.REACH").items.some((i) => i.project === "W.qnfo-social"));
assert.equal((await w.fetch(new Request("https://s.test/portfolio/tick", { method: "POST" }), env)).status, 401);
console.log("portfolio-sync.test.mjs ok");
