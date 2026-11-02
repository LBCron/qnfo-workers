// REOPEN-LIVE-PATH-3 offline suite (qnfo-fleet-control 0.41.0, issue 100271): slices rtFlagOff and the REOPEN-LIVE-PATH-3 block out of worker.js and runs them against an
// in-memory SQLite D1 (node:sqlite) with the unique open-title index of agent_issues. Proves: an orphan (open, no contract in status active, holding, monitoring or escalated)
// older than 60 minutes since it opened or was reopened files exactly one PROBE-NEEDED-1 issue and a second tick files none; a young orphan, one reopened a minute ago, one that
// gained a live contract, one that holds a parked loop-owned contract and one with an open PROBE-NEEDED-1 issue file none; a PROBE-NEEDED-1 issue is never its own orphan; the
// bounds hold (3 per tick, 12 per 24 hours); while a REOPEN-LIVE-PATH-2 issue is open an orphan with a mapped source, a chaos-drill or fleet-journeys source or an "[ai-cal] " title
// files none and a cf-model-eval orphan files one, and once it is closed the chaos-drill and "[ai-cal] " orphans file; the model-health families that MODEL-HEALTH-SWEEP-1 closes
// are never filed; ops_config rt_ensure_live_path = off stops it; the new issue carries the closing contract (pending until the target holds a probe of its own, ok after, a
// status-reading probe does not count, ok when the target closes); the tick calls the filer right after the deferral sweep; VERSION is at least 0.41.0; the mirror is identical.
// Output MUST contain "0 failed" on success.   node qnfo-fleet-control/ensure-live-path.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const mirror = readFileSync(new URL("./deployed-current.worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

const f1 = src.indexOf("async function rtFlagOff(db, key) {"), f2 = src.indexOf("async function rtCloseEventSince", f1);
const a = src.indexOf("// ---- REOPEN-LIVE-PATH-3:BEGIN ----"), b = src.indexOf("// ---- REOPEN-LIVE-PATH-3:END ----");
if (f1 < 0 || f2 < f1 || a < 0 || b < a) throw new Error("blocks not found in worker.js");
const cx = vm.createContext({ Date, Number, String, parseInt, Math, JSON, console: { error() {}, log() {} }, VERSION: "0.41.0-test" });
vm.runInContext(src.slice(f1, f2) + "\n" + src.slice(a, b) + "\nthis.api = { rtEnsureLivePath, rtLivePathProbe, setAuthor(fn) { rtAuthorLivePathProbe = fn; }, authorDailyLimit: RT_PROBE_AUTHOR_MAX_PER_DAY };", cx);
const { rtEnsureLivePath, rtLivePathProbe } = cx.api;

function mk() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT DEFAULT 'open', created_at INTEGER, updated_at INTEGER, close_channel TEXT);
CREATE UNIQUE INDEX idx_agent_issues_open_title_ci ON agent_issues (lower(trim(title))) WHERE status = 'open';
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', verify_probe TEXT NOT NULL DEFAULT '', verify_transport TEXT NOT NULL DEFAULT 'd1-query', max_attempts INTEGER NOT NULL DEFAULT 3, escalate_to TEXT NOT NULL DEFAULT 'x', expected_cadence_h INTEGER, status TEXT DEFAULT 'active', module TEXT, last_verdict TEXT, next_due_at TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE issue_lifecycle (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id INTEGER NOT NULL, event TEXT NOT NULL, from_status TEXT, to_status TEXT, has_evidence INTEGER, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE issue_source_hosts (source TEXT PRIMARY KEY, host TEXT NOT NULL, note TEXT);
CREATE TABLE service_registry (service TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'live');
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
CREATE TABLE cloud_ops_events (id TEXT PRIMARY KEY, ts TEXT, kind TEXT, text TEXT, meta TEXT, job TEXT, status TEXT);
INSERT INTO service_registry (service, state) VALUES ('qnfo-fleet-control', 'live'), ('retired-svc', 'retired');
INSERT INTO issue_source_hosts (source, host) VALUES ('qnfo-fleet-advisor', 'qnfo-fleet-control'), ('dead-label', 'retired-svc');`);
  const stmt = (sql) => { let args = []; const self = { bind(...x) { args = x.map((v) => (v === undefined ? null : v)); return self; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; } }; return self; };
  return { db, h: { prepare: stmt } };
}
const iso = (minAgo) => new Date(Date.now() - minAgo * 6e4).toISOString().slice(0, 19) + "Z";
const add = (db, title, o = {}) => {
  const id = Number(db.prepare("INSERT INTO agent_issues (title, source, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(title, o.source ?? null, o.priority ?? "medium", o.status ?? "open", Date.now() - (o.ageMin ?? 300) * 6e4, Date.now()).lastInsertRowid);
  db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (?, 'opened', ?)").run(id, iso(o.ageMin ?? 300));
  if (o.reopenedMinAgo != null) db.prepare("INSERT INTO issue_lifecycle (issue_id, event, ts) VALUES (?, 'reopened', ?)").run(id, iso(o.reopenedMinAgo));
  if (o.contract) db.prepare("INSERT INTO remediation_contracts (class, issue_id, status, verify_probe) VALUES (?, ?, ?, ?)").run("issue-" + id, id, o.contract, o.probe ?? "SELECT 1");
  return id;
};
const tick = async (h) => { const out = { probe_needed_filed: [] }; await rtEnsureLivePath(h, out); return out; };
const probeIssues = (db) => db.prepare("SELECT * FROM agent_issues WHERE title LIKE 'PROBE-NEEDED-1: issue-%' ORDER BY id").all();

{
  const { db, h } = mk();
  const orphan = add(db, "ORPHAN-ONE-1: something", { source: "session-x", contract: "superseded" });
  const ownerTask = add(db, "OWNER-TASK: act on a fleet decision");
  const ownerNote = add(db, "OWNER-NOTE: record an observation");
  const young = add(db, "YOUNG-1: opened 30 minutes ago", { ageMin: 30 });
  const reopened = add(db, "REOPENED-1: old issue reopened a minute ago", { ageMin: 900, reopenedMinAgo: 1 });
  const live = [["active", "A"], ["holding", "H"], ["monitoring", "M"], ["escalated", "E"]].map(([st, k]) => add(db, "LIVE-" + k + "-1: has a " + st + " contract", { contract: st }));
  const hasOpen = add(db, "HASPROBE-1: already named", {});
  add(db, "PROBE-NEEDED-1: issue-" + hasOpen, { ageMin: 300 });
  const closedProbe = add(db, "CLOSEDPROBE-1: an earlier PROBE-NEEDED-1 issue was closed", {});
  add(db, "PROBE-NEEDED-1: issue-" + closedProbe, { status: "closed" });
  let out = await tick(h);
  const files = probeIssues(db).filter((r) => r.status === "open").map((r) => r.title);
  ok(JSON.stringify(out.probe_needed_filed.sort((x, y) => x - y)) === JSON.stringify([orphan, closedProbe].sort((x, y) => x - y)), "files for the old orphan and for the one whose earlier PROBE-NEEDED-1 issue is closed, nothing else", out);
  ok(files.includes("PROBE-NEEDED-1: issue-" + orphan) && files.includes("PROBE-NEEDED-1: issue-" + closedProbe), "titles are PROBE-NEEDED-1: issue-<id>", files);
  ok(!files.includes("PROBE-NEEDED-1: issue-" + young) && !files.includes("PROBE-NEEDED-1: issue-" + reopened) && !files.includes("PROBE-NEEDED-1: issue-" + ownerTask) && !files.includes("PROBE-NEEDED-1: issue-" + ownerNote) && live.every((i) => !files.includes("PROBE-NEEDED-1: issue-" + i)), "a young orphan, one reopened a minute ago, OWNER-TASK and OWNER-NOTE targets, and the four live-contract issues file none", files);
  out = await tick(h);
  ok(out.probe_needed_filed.length === 0 && probeIssues(db).filter((r) => r.status === "open").length === 3, "a second tick files none (the issues just filed carry their own contract and are never orphans)", out);
  const iss = db.prepare("SELECT * FROM agent_issues WHERE title = ?").get("PROBE-NEEDED-1: issue-" + orphan);
  ok(iss.source === "qnfo-fleet-control" && iss.priority === "medium" && iss.category === "reliability" && iss.description.includes("issue " + orphan) && iss.description.includes("The probe to write") && iss.description.includes("Definition of done") && iss.description.includes("issue:" + orphan), "the issue names the target, the probe to write, the doer claim and the definition of done");
  ok(db.prepare("SELECT COUNT(*) AS n FROM cloud_ops_events WHERE kind = 'remediation.probe-needed-filed'").get().n === 2, "one event per filed issue");

  // closing contract
  const c = db.prepare("SELECT * FROM remediation_contracts WHERE class = ?").get("issue-" + iss.id);
  ok(c && c.status === "active" && c.module === "reopen-live-path" && c.verify_transport === "d1-query" && c.escalate_to === "qnfo-fleet-control" && c.expected_cadence_h === 1, "the new issue has an active closing contract", c);
  const WRITE_KW = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
  const low = " " + c.verify_probe.toLowerCase() + " ";
  ok(low.indexOf(";") === -1 && !WRITE_KW.some((w) => low.indexOf(w) !== -1) && c.verify_probe.indexOf("needs-machine-probe") === -1 && c.verify_probe.indexOf("SELECT status FROM agent_issues WHERE id =") === -1, "the closing probe is one literal read free of write keywords and of the two markers red-drain matches", c.verify_probe.slice(0, 140));
  const read = () => { const r = db.prepare(c.verify_probe).get(); return { e: String(r.expected), o: String(r.observed) }; };
  ok(read().e === "ok" && /^pending: issue \d+ has no probe of its own yet/.test(read().o), "pending while the target holds only a superseded contract", read());
  db.prepare("UPDATE remediation_contracts SET status = 'active', verify_probe = 'SELECT status FROM agent_issues WHERE id = ' || issue_id WHERE class = ?").run("issue-" + orphan);
  ok(/^pending/.test(read().o), "a status-reading probe on the target does not count", read());
  db.prepare("UPDATE remediation_contracts SET verify_probe = 'SELECT ''ok'' AS expected, ''ok'' AS observed' WHERE class = ?").run("issue-" + orphan);
  ok(read().o === "ok", "ok once the target holds an active probe of its own", read());
  db.prepare("UPDATE remediation_contracts SET status = 'superseded' WHERE class = ?").run("issue-" + orphan);
  ok(/^pending/.test(read().o), "pending again if that contract is superseded", read());
  db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = ?").run(orphan);
  ok(read().o === "ok", "ok when the target is no longer open", read());
  ok(rtLivePathProbe("x") === null && rtLivePathProbe("0") === null && rtLivePathProbe("12abc") !== null, "the probe builder takes only a positive integer id");
}
// A rejected authoring attempt used to strand its open PROBE-NEEDED ticket forever.
{
  const { db, h } = mk();
  const targets = [
    add(db, "MEDIUM-1: probe needed", { priority: "medium", contract: "active" }),
    add(db, "HIGH-1: probe needed", { priority: "high", contract: "superseded" }),
    add(db, "CRITICAL-1: probe needed", { priority: "critical", contract: "superseded" }),
    add(db, "COOLDOWN-1: probe needed", { priority: "critical", contract: "superseded" }),
    add(db, "LOW-1: probe needed", { priority: "low", contract: "superseded" })
  ];
  db.prepare("UPDATE remediation_contracts SET verify_probe = ? WHERE issue_id = ?").run("SELECT status FROM agent_issues WHERE id = " + targets[0], targets[0]);
  for (const id of targets) add(db, "PROBE-NEEDED-1: issue-" + id);
  db.prepare("INSERT INTO cloud_ops_events (id, ts, kind, text, job, status) VALUES ('recent-reject', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'remediation.probe-author-reject', ?, 'qnfo-fleet-control', 'warn')").run("issue=" + targets[3] + " not-allowlisted");
  for (let i = 0; i < 12; i++) db.prepare("INSERT INTO agent_issues (title, status, created_at, updated_at, priority) VALUES (?, 'closed', ?, ?, 'low')").run("PROBE-NEEDED-1: issue-" + (900 + i), Date.now(), Date.now());
  const attempted = [];
  cx.api.setAuthor(async (_db, _env, issue) => { attempted.push(Number(issue.id)); return false; });
  const out = await tick(h);
  ok(JSON.stringify(attempted) === JSON.stringify([targets[2], targets[1], targets[0]]), "existing retries run critical-first, skip a recent rejection for six hours, and cap attempts at three per tick", attempted);
  ok(JSON.stringify(out.probe_author_retried) === JSON.stringify(attempted), "the tick reports every retry attempt even when authoring is rejected", out);
  ok(out.ensure_live_path_capped === 1, "existing retries still run after the separate daily ticket-filing cap is reached", out);
  ok(cx.api.authorDailyLimit === 120, "successful authored probes allow a bounded 120-per-day drain", cx.api.authorDailyLimit);
}
// bounds
{
  const { db, h } = mk();
  for (let i = 0; i < 5; i++) add(db, "BOUND-" + i + "-1: orphan", { priority: i === 4 ? "high" : "medium" });
  let out = await tick(h);
  ok(out.probe_needed_filed.length === 3, "at most 3 issues per tick", out);
  const first = db.prepare("SELECT title FROM agent_issues WHERE title LIKE 'PROBE-NEEDED-1: issue-%' ORDER BY id").all();
  ok(first.length === 3, "three are open");
  out = await tick(h);
  ok(out.probe_needed_filed.length === 2, "the next tick files the rest", out);
  const { db: d2, h: h2 } = mk();
  for (let i = 0; i < 12; i++) d2.prepare("INSERT INTO agent_issues (title, status, created_at, updated_at, priority) VALUES (?, 'closed', ?, ?, 'low')").run("PROBE-NEEDED-1: issue-" + (900 + i), Date.now() - 3600e3, Date.now());
  add(d2, "CAPPED-1: orphan", {});
  out = await tick(h2);
  ok(out.probe_needed_filed.length === 0 && out.ensure_live_path_capped === 1, "12 filed in the last 24 hours: capped", out);
  d2.prepare("UPDATE agent_issues SET created_at = ? WHERE title LIKE 'PROBE-NEEDED-1: issue-9%'").run(Date.now() - 25 * 3600e3);
  out = await tick(h2);
  ok(out.probe_needed_filed.length === 1, "the cap is a rolling 24 hours", out);
}
// skips
{
  const { db, h } = mk();
  const lp2 = add(db, "REOPEN-LIVE-PATH-2: an issue filed by a fleet loop is born with no live verification path", { contract: "active" });
  const mapped = add(db, "MAPPED-1: x", { source: "qnfo-fleet-advisor" });
  const deadMap = add(db, "DEADMAP-1: source mapped to a retired host", { source: "dead-label" });
  const chaos = add(db, "CHAOS-DRILL-FAILED-1: control:x", { source: "chaos-drill" });
  const journey = add(db, "FLEET-JOURNEY-FAILED-1: x", { source: "fleet-journeys" });
  const aical = add(db, "[ai-cal] some other prober finding", {});
  const cfm = add(db, "CF-MODEL-EVAL-1: harness cannot run x", { source: "cf-model-eval" });
  const mh1 = add(db, "[ai-cal] model probe failing: glm-5.3", {});
  const mh2 = add(db, "MODEL-DEGRADED kimi-k2.6,gpt-oss-120b", { source: "qnfo-fleet-advisor" });
  const mh3 = add(db, "MODEL-DEGRADED a", { source: "unmapped-x" });
  let out = await tick(h);
  const got = new Set(out.probe_needed_filed);
  ok(got.has(cfm) && got.has(deadMap), "while REOPEN-LIVE-PATH-2 is open a cf-model-eval orphan and a source mapped to a retired host are filed", out);
  ok([mapped, chaos, journey, aical].every((i) => !got.has(i)), "a mapped source, chaos-drill, fleet-journeys and an [ai-cal] title are left to REOPEN-LIVE-PATH-2", out);
  ok([mh1, mh2, mh3].every((i) => !got.has(i)), "the model-health families closed by MODEL-HEALTH-SWEEP-1 are never filed", out);
  db.prepare("UPDATE agent_issues SET status = 'closed' WHERE id = ?").run(lp2);
  const t1 = await tick(h), t2 = await tick(h);
  const got2 = new Set(t1.probe_needed_filed.concat(t2.probe_needed_filed));
  ok(t1.probe_needed_filed.length === 3 && [chaos, journey, aical].every((i) => got2.has(i)), "once REOPEN-LIVE-PATH-2 is closed the chaos-drill, fleet-journeys and [ai-cal] orphans are filed (the 3 per tick bound spreads them over two ticks)", [t1, t2]);
  ok(got2.has(mapped), "a mapped source files too once REOPEN-LIVE-PATH-2 is closed (by then the loop-owned template gives it a contract; the fixture has none)");
  ok([mh1, mh2, mh3].every((i) => !got2.has(i)), "and the model-health families still are not", [t1, t2]);
}
// off switch
{
  const { db, h } = mk();
  add(db, "SWITCH-1: orphan", {});
  db.prepare("INSERT INTO ops_config (key, value) VALUES ('rt_ensure_live_path', 'off')").run();
  let out = await tick(h);
  ok(out.ensure_live_path_off === 1 && probeIssues(db).length === 0, "ops_config rt_ensure_live_path = off stops it", out);
  db.prepare("UPDATE ops_config SET value = 'on' WHERE key = 'rt_ensure_live_path'").run();
  out = await tick(h);
  ok(out.probe_needed_filed.length === 1, "any other value runs it", out);
}
// a failure never breaks the tick; a missing table pauses it quietly
{
  const out = { probe_needed_filed: [] };
  await rtEnsureLivePath({ prepare() { throw new Error("D1 down"); } }, out);
  ok(Array.isArray(out.probe_needed_filed), "a D1 error is swallowed and logged, never thrown");
  const logged = [];
  const cx2 = vm.createContext({ Date, Number, String, parseInt, Math, JSON, console: { error: (x) => logged.push(x), log() {} }, VERSION: "0.41.0-test" });
  vm.runInContext(src.slice(f1, f2) + "\n" + src.slice(a, b) + "\nthis.api = { rtEnsureLivePath };", cx2);
  const { db } = mk();
  const bare = { prepare: (sql) => { throw new Error("no such table: issue_source_hosts"); } };
  const o2 = { probe_needed_filed: [] };
  await cx2.api.rtEnsureLivePath(bare, o2);
  await cx2.api.rtEnsureLivePath(bare, o2);
  ok(logged.length === 0 && cx2.rtLivePathRetryAt > Date.now(), "a missing table pauses the filer for ten minutes with no log line per tick", [logged, cx2.rtLivePathRetryAt]);
  const o3 = { probe_needed_filed: [] };
  const cx3 = vm.createContext({ Date, Number, String, parseInt, Math, JSON, console: { error: (x) => logged.push(x), log() {} }, VERSION: "0.41.0-test" });
  vm.runInContext(src.slice(f1, f2) + "\n" + src.slice(a, b) + "\nthis.api = { rtEnsureLivePath };", cx3);
  await cx3.api.rtEnsureLivePath({ prepare() { throw new Error("D1_ERROR: something else"); } }, o3);
  ok(logged.length === 1 && /ensure-live-path/.test(logged[0]), "any other error is logged once", logged);
}
// wiring
const tickSrc = src.slice(src.indexOf("await rtEscalateStaleDeferrals(db, out);"));
ok(tickSrc.indexOf("await rtEnsureLivePath(db, out, env);") > 0 && tickSrc.indexOf("await rtEnsureLivePath(db, out, env);") < 400, "the remediation tick calls the filer right after the deferral sweep, handing it env (PROBE-AUTHOR-HARDEN-1: the author needs the AI binding)");
ok(src.includes("deferral_escalated: [], probe_needed_filed: [] }"), "the tick output carries probe_needed_filed");
ok(!/LIKE '[^']{50,}'/.test(src.slice(a, b)), "no LIKE literal in the block reaches D1's 50 byte limit");
const v = /var VERSION = "(\d+)\.(\d+)\.(\d+)/.exec(src);
ok(v && (Number(v[1]) > 0 || Number(v[2]) > 41 || (Number(v[2]) === 41 && Number(v[3]) >= 0)), "VERSION is at least 0.41.0", v && v[0]);
ok(src.includes("async function rtEnsureLivePath"), "the code-read probe of issue 100271 finds the function");
ok(mirror === src, "deployed-current.worker.js is identical to worker.js");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
