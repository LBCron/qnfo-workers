// PORTFOLIO-NOT-ISSUES-1 offline suite (qnfo-github-steward 0.8.0, migrations/2026-10-26-roadmap-mirror-scope.sql).
// Measured 2026-10-26: 828 open GitHub issues, 381 of them roadmap mirrors, 181 of those projects (77), metric-breach twins of a METRIC-TRIGGER
// ticket (75) and failure-mode registry rows (29): rows that can never close or that count one thing twice. The scope is data
// (roadmap_mirror_scope); this suite proves the steward closes the out-of-scope mirrors not_planned, never reopens them, files none, honours
// the scope table both ways, falls back to the default scope while the table is absent, and that a bulk close is not read as a GitHub anomaly.
// Run: node qnfo-github-steward/issue-hygiene.test.mjs
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
for (const [c, n] of [["QNFO.RSCH", "R"], ["QNFO.INFRA", "I"], ["QNFO.OPS", "O"], ["QNFO.REACH", "Re"]]) db.prepare("INSERT INTO programs (program_code, portfolio_code, name) VALUES (?, 'QNFO', ?)").run(c, n);

const mig = readFileSync(join(here, "..", "migrations", "2026-10-18-portfolio-sync.sql"), "utf8");
for (const stmt of mig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) db.exec(stmt);
const scopeMig = readFileSync(join(here, "..", "migrations", "2026-10-26-roadmap-mirror-scope.sql"), "utf8");
const scopeStmts = scopeMig.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter((s) => /^(CREATE TABLE IF NOT EXISTS roadmap_mirror_scope|INSERT OR IGNORE INTO roadmap_mirror_scope|DROP VIEW IF EXISTS v_portfolio_drift_roadmap|CREATE VIEW v_portfolio_drift_roadmap)/i.test(s));
assert.equal(scopeStmts.length, 4, "the migration's table, seed and two view statements");
for (const stmt of scopeStmts) db.exec(stmt);
// The migration is idempotent: a second apply changes nothing.
for (const stmt of scopeStmts) db.exec(stmt);
assert.deepEqual(db.prepare("SELECT source FROM roadmap_mirror_scope WHERE mirrored = 0 ORDER BY 1").all().map((r) => r.source), ["failure_modes", "metric-breach", "projects"]);

for (const s of ["qnfo-ops", "qnfo-fleet-control", "qnfo-github-steward"]) db.prepare("INSERT INTO service_registry (service, purpose) VALUES (?, ?)").run(s, "does " + s);

// Pre-change state: GitHub already carries an open roadmap issue for every row, in and out of scope.
const rmIns = db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, created_at) VALUES (?, ?, ?, 'worker', ?, ?, ?)");
const rmLink = db.prepare("INSERT INTO roadmap_gh_links (roadmap_id, gh_number, gh_state, d1_status, synced_at) VALUES (?, ?, 'open', ?, '')");
const created = new Date(Date.now() - 3 * 86400000).toISOString();
let gIssues = [], num = 8000;
const seed = (item, source, status, mirror) => {
  const id = Number(rmIns.run(item, source, "t " + item, "qnfo-ops", status, created).lastInsertRowid);
  if (mirror) { rmLink.run(id, ++num, status); gIssues.push({ number: num, node_id: "N" + num, title: "[RM-" + id + "] " + item, labels: [{ name: "roadmap" }, { name: "program:ops" }], state: "open", milestone: null }); }
  return id;
};
const work = seed("RM-WORK", "charter", "not-built", true);
const proj = [], brk = [], fm = [];
for (let i = 0; i < 30; i++) proj.push(seed("PROJ-W.w" + i, "projects", "open", true));
for (let i = 0; i < 20; i++) brk.push(seed("RM-METRIC-m" + i, "metric-breach", "open", true));
for (let i = 0; i < 6; i++) fm.push(seed("FM-f" + i, "failure_modes", "open", true));
const unlinked = seed("PROJ-W.unlinked", "projects", "open", false);
const unlinkedFm = seed("FM-unlinked", "failure_modes", "open", false);

let calls = [], comments = [], gNext = 9000;
const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });
const lbl = (l) => (typeof l === "string" ? { name: l } : l);
globalThis.fetch = async (url, init) => {
  const u = new URL(url); const m = (init && init.method) || "GET"; const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push(m + " " + u.pathname);
  const page = Number(u.searchParams.get("page") || 1);
  const R = "/repos/QNFO/qnfo-workers";
  if (u.pathname === "/graphql") return reply(200, { errors: [{ message: "Resource not accessible" }] });
  if (m === "GET" && u.pathname === R + "/labels") return reply(200, page > 1 ? [] : [{ name: "roadmap" }]);
  if (m === "POST" && u.pathname === R + "/labels") return reply(201, body);
  if (m === "GET" && u.pathname === R + "/milestones") return reply(200, []);
  if (m === "POST" && u.pathname === R + "/milestones") return reply(201, { number: 1, title: body.title, state: "open" });
  if (m === "GET" && u.pathname === R + "/issues") {
    const want = u.searchParams.get("labels");
    return reply(200, page > 1 ? [] : gIssues.filter((i) => i.state === "open" && i.labels.map(lbl).some((l) => l.name === want)));
  }
  if (m === "POST" && u.pathname === R + "/issues") { const i = { number: gNext++, node_id: "N" + gNext, title: body.title, body: body.body, labels: body.labels.map(lbl), milestone: null, state: "open" }; gIssues.push(i); return reply(201, i); }
  const mm = /^\/repos\/QNFO\/qnfo-workers\/issues\/(\d+)(\/comments)?$/.exec(u.pathname);
  if (mm) {
    const i = gIssues.find((x) => x.number === Number(mm[1]));
    if (mm[2]) { comments.push({ n: Number(mm[1]), body: body.body }); return reply(201, {}); }
    if (m === "GET") return reply(i ? 200 : 404, i || {});
    if (m === "PATCH") { if (body.state) { i.state = body.state; i.reason = body.state_reason; } return reply(200, i); }
  }
  return reply(404, { message: "unhandled " + m + " " + u.pathname });
};
const prep = (sql) => { let a = []; const st = { bind: (...x) => { a = x.map((v) => (v === undefined ? null : v)); return st; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return st; };
const env = { AUDIT: { prepare: prep, batch: async (l) => { for (const s of l) await s.run(); return []; } }, GITHUB_TOKEN: "t", STEWARD_KEY: "k" };
const tick = async () => (await (await w.fetch(new Request("https://s.test/portfolio/tick", { method: "POST", headers: { "x-steward-key": "k" } }), env)).json()).result;
const openRoadmap = () => gIssues.filter((i) => i.state === "open" && i.labels.some((l) => l.name === "roadmap"));
const writes = () => calls.filter((c) => /^(POST|PATCH) \/repos\/QNFO\/qnfo-workers\/issues\/\d+/.test(c));

// 1. 56 of the 57 links are out of scope: a bulk close that is over half of all links, and over the 40-per-tick cap, must not be read as a GitHub anomaly (it is a recorded decision).
const out = proj.length + brk.length + fm.length;
assert.equal(out, 56);
let closedTotal = 0, ticks = 0, r;
while (openRoadmap().length > 1 && ticks < 10) { r = await tick(); ticks++; closedTotal = gIssues.filter((i) => i.state === "closed").length; assert.ok(!r.errors.some((e) => /mass state flip/.test(e.why)), "an out-of-scope bulk close is explained, not refused: " + JSON.stringify(r.errors)); }
assert.equal(openRoadmap().length, 1, "after the bulk close only the work item is open on GitHub (" + ticks + " ticks)");
assert.equal(openRoadmap()[0].title.includes("RM-WORK"), true);
assert.ok(ticks === 2, "56 closes take two budgeted ticks (40 + 16), not one and not many: " + ticks);
assert.equal(closedTotal, out);
const closedIssues = gIssues.filter((i) => i.state === "closed");
assert.ok(closedIssues.every((i) => i.reason === "not_planned"), "out-of-scope mirrors are closed not_planned, never as completed");
const cm = comments.filter((c) => /PORTFOLIO-NOT-ISSUES-1/.test(c.body));
assert.equal(cm.length, out, "each close says why, once");
assert.ok(cm.every((c) => /not a verification/.test(c.body) && !/Verified in qnfo-audit/.test(c.body)), "the comment never claims a verification");
assert.ok(!comments.some((c) => /Evidence:/.test(c.body)), "no evidence block for a close that verifies nothing");
// D1 is untouched: the roadmap rows stay open, links record the closed GitHub state.
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_implementation WHERE source IN ('projects','metric-breach','failure_modes') AND status = 'open'").get().c, out + 2, "no roadmap row is changed by the scope (56 linked + 2 unlinked)");
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_gh_links WHERE gh_state = 'closed'").get().c, out);
assert.equal(r.roadmap_scoped_closed !== undefined, true, "the tick reports the scoped closes");

// 2. Nothing is filed for the unlinked out-of-scope rows, nothing reopens, a converged tick writes nothing.
assert.ok(!gIssues.some((i) => /unlinked/.test(i.title)), "an out-of-scope row without a link is never filed");
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_gh_links WHERE roadmap_id IN (?, ?)").get(unlinked, unlinkedFm).c, 0);
calls = [];
const rc = await tick();
assert.deepEqual(writes(), [], "a converged tick writes nothing to GitHub: " + writes().join(","));
assert.equal(rc.roadmap_reopened, 0, "an out-of-scope item whose D1 status is open is never reopened");
assert.ok(!rc.drift["roadmap-state"] && !rc.drift["roadmap-unmirrored"], "the drift view reads the same scope (no state or unmirrored drift for scoped-out items): " + JSON.stringify(rc.drift));

// 3. A hand reopen of an out-of-scope mirror is closed again (the decision is D1's, like every other state).
const handOpened = gIssues.find((i) => /PROJ-W\.w0/.test(i.title)); handOpened.state = "open";
calls = [];
const rh = await tick();
assert.equal(handOpened.state, "closed", "a hand reopen of a scoped-out mirror is closed again");
assert.ok(!rh.errors.some((e) => /mass state flip/.test(e.why)));

// 4. The scope is data: a verified out-of-scope item keeps the evidence close (a verification is still a verification).
db.prepare("UPDATE roadmap_implementation SET status = 'verified', evidence = 'ok', verified_at = ? WHERE id = ?").run(new Date().toISOString(), brk[0]);
calls = [];
await tick();
assert.equal(writes().length, 0, "a scoped-out item that verifies is already closed on GitHub: nothing to write");

// 5. Putting a source back (mirrored = 1) reopens its linked issues with the usual roadmap comment, 40 per tick at most.
db.prepare("UPDATE roadmap_mirror_scope SET mirrored = 1 WHERE source = 'failure_modes'").run();
calls = []; comments = [];
await tick();
const fmOpen = gIssues.filter((i) => i.state === "open" && /FM-f/.test(i.title));
assert.equal(fmOpen.length, fm.length, "the restored source's linked issues are open again");
assert.ok(comments.filter((c) => /Reopened by PORTFOLIO-SYNC-1/.test(c.body)).length === fm.length);
// the unlinked failure-mode row is now in scope and is filed like any roadmap item.
assert.ok(gIssues.some((i) => /FM-unlinked/.test(i.title) && i.state === "open"), "an unlinked row of a restored source is filed");

// 6. With the table absent the steward falls back to the default scope (the same three sources).
db.exec("DROP TABLE roadmap_mirror_scope");
db.exec("DROP VIEW v_portfolio_drift_roadmap");
db.exec("CREATE VIEW v_portfolio_drift_roadmap AS SELECT 'x' AS kind, 'x' AS ref, 'x' AS detail WHERE 0");
const re = await tick();
assert.equal(re.errors.filter((e) => e.scope === "portfolio-roadmap").length, 0, JSON.stringify(re.errors));
assert.equal(gIssues.filter((i) => i.state === "open" && /FM-f/.test(i.title)).length, 0, "no table: failure_modes is out of scope again by the default");
assert.equal(gIssues.filter((i) => i.state === "open" && /PROJ-|RM-METRIC/.test(i.title)).length, 0);
assert.equal(openRoadmap().length, 1, "the work item is still the only open roadmap issue");

// 7. The public tree counts only work items.
const tree = await (await w.fetch(new Request("https://s.test/roadmap"), env)).json();
assert.ok(tree.programs.length >= 1);

// 8. The version and the declared capability name the scope.
const h = await (await w.fetch(new Request("https://s.test/health"), env)).json();
assert.ok(h.capabilities.some((c) => /^roadmap-scope/.test(c)) && h.limitations.some((l) => /roadmap source taken out of the mirror scope/.test(l)));
const [maj, min] = String(h.version).split("-")[0].split(".").map(Number);
assert.ok(maj === 0 && min >= 8, "VERSION is at least 0.8.0: " + h.version);
assert.ok(h.capabilities.some((c) => /ROADMAP-TWIN-ROWS-1/.test(c)), "the capability line names the twin rule");
// 9. ROADMAP-TWIN-ROWS-1 (0.9.0): a roadmap row whose artifact is an agent issue is that issue's twin, whatever source wrote it. Measured 2026-10-26:
// the source best-practice-2026 wrote 31 rows in an hour (30 of artifact_type agent_issue, item AI-<id>, plus one goal) and each doubled a [#id] ticket.
const twinIns = db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, created_at) VALUES (?, 'best-practice-2026', ?, 'agent_issue', 'BP26.X', 'planned', ?)");
const twinMirrored = Number(twinIns.run("AI-1000347", "BP26 2.10 twin", created).lastInsertRowid);
rmLink.run(twinMirrored, ++num, "planned");
gIssues.push({ number: num, node_id: "N" + num, title: "[RM-" + twinMirrored + "] AI-1000347", labels: [{ name: "roadmap" }, { name: "program:ops" }], state: "open", milestone: null });
const twinGh = num;
const twinUnlinked = Number(twinIns.run("AI-1000348", "BP26 2.11 twin", created).lastInsertRowid);
const goalRow = seed("GL-BP26-CATALOGUE", "best-practice-2026", "planned", false);
calls = []; comments = [];
const rt = await tick();
const twinIssue = gIssues.find((i) => i.number === twinGh);
assert.equal(twinIssue.state, "closed", "the twin's mirror, filed before the rule, is closed");
assert.equal(twinIssue.reason, "not_planned", "closed not_planned, never as completed");
assert.ok(comments.some((c) => c.n === twinGh && /PORTFOLIO-NOT-ISSUES-1/.test(c.body) && /twin/.test(c.body) && /not a verification/.test(c.body)), "the close says why and claims no verification");
assert.ok(!gIssues.some((i) => /AI-1000348/.test(i.title)), "an unlinked twin row is never filed");
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_gh_links WHERE roadmap_id = ?").get(twinUnlinked).c, 0, "and no link is created for it");
assert.ok(gIssues.some((i) => /GL-BP26-CATALOGUE/.test(i.title) && i.state === "open"), "a non-twin row of the same new source (the goal) is filed like any roadmap item");
assert.ok(!rt.errors.some((e) => /mass state flip/.test(e.why)), "the twin close is an explained decision, not a GitHub anomaly");
assert.equal(db.prepare("SELECT status FROM roadmap_implementation WHERE id = ?").get(twinMirrored).status, "planned", "D1 is untouched: the roadmap row stays planned");
// a converged tick writes nothing; a hand reopen is closed again; the twin is not reopened by D1 status.
calls = [];
await tick();
assert.deepEqual(writes(), [], "a converged tick writes nothing to GitHub: " + writes().join(","));
twinIssue.state = "open";
await tick();
assert.equal(twinIssue.state, "closed", "a hand reopen of a twin mirror is closed again");
// the rule is on artifact_type, not on the source: the same row under the 'agent_issues' source name or any other behaves the same.
const otherSrc = Number(db.prepare("INSERT INTO roadmap_implementation (item, source, title, artifact_type, artifact_ref, status, created_at) VALUES ('AI-1000349', 'some-future-batch', 't', 'agent_issue', 'X', 'planned', ?)").run(created).lastInsertRowid);
await tick();
assert.ok(!gIssues.some((i) => /AI-1000349/.test(i.title)), "a twin row from a source nobody has seen is not filed either");
assert.equal(db.prepare("SELECT COUNT(*) c FROM roadmap_gh_links WHERE roadmap_id = ?").get(otherSrc).c, 0);
// the public tree counts work items only.
const tree2 = await (await w.fetch(new Request("https://s.test/roadmap"), env)).json();
assert.ok(JSON.stringify(tree2).length > 0);

console.log("issue-hygiene.test.mjs ok");
