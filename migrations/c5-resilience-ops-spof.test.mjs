// OPS-FAILOVER-2 offline suite: replays migrations/2026-11-04-c5-resilience-ops-spof.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line, no LIKE pattern over 50 bytes, no trigger); the gateway hostname is registered as a SPOF with its alternate and NO tested stamp (the chaos drill stamps it); the enabled probe
// really passes on a fresh reading of 1 and fails, with a message that names the cause, on a missing value, a value below 1 and a stale reading; the Windows issue carries a code-task, an anchor that occurs exactly once and a marker that is absent today;
// row 5 keeps its old evidence and stays partial; a replay changes nothing and the Rollback line restores every row.
// Output MUST contain "0 failed" on success.   node migrations/c5-resilience-ops-spof.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const sql = rd("./2026-11-04-c5-resilience-ops-spof.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body) && !/claude\.ai|anthropic\.com/i.test(sql), "no trigger and no claude.ai link");
const likes = [...body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)].map((m) => m[1]);
ok(likes.every((p) => Buffer.byteLength(p) <= 50), "no LIKE pattern over 50 bytes (D1 rejects it)", likes);

const COMP = "qnfo-ops gateway hostname (ops.qnfo.org)";
const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const w = new DatabaseSync(":memory:");
w.exec(`CREATE TABLE spof_registry (component TEXT PRIMARY KEY, critical_path TEXT, alternate_path TEXT, alternate_tested_at TEXT, evidence TEXT, issue_id INTEGER, reviewed_at TEXT);
CREATE TABLE spof_alternate_probes (component TEXT PRIMARY KEY, probe_sql TEXT NOT NULL, exercise TEXT, window_note TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, last_pass INTEGER, last_pass_at TEXT, last_observed TEXT, created_at TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT, last_refreshed TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, status TEXT, evidence TEXT);`);
const EVID = "VSM S1 / OODA act | backlog mining 2026-09-30 || C5-RESILIENCE-5 2026-11-05: partial. BUILT in the c5-resilience ops-failover pull request";
w.prepare("INSERT INTO roadmap_implementation (id, item, source, status, evidence) VALUES (5, 'RM-S1-REDUNDANCY-1', 'autonomy_scores', 'partial', ?)").run(EVID);
w.prepare("INSERT INTO spof_registry (component, critical_path, alternate_path, alternate_tested_at, evidence) VALUES ('other row', 'x', 'y', '2026-11-04T20:05:45.368Z', 'z')").run();
const one = (q, ...a) => w.prepare(q).get(...a);
const snap = () => JSON.stringify([w.prepare("SELECT * FROM spof_registry").all(), w.prepare("SELECT * FROM spof_alternate_probes").all(), w.prepare("SELECT title, description FROM agent_issues").all(), w.prepare("SELECT * FROM roadmap_implementation").all()]);

w.exec(sql);
const s = one("SELECT * FROM spof_registry WHERE component = ?", COMP);
ok(s && s.alternate_tested_at === null && s.reviewed_at && /qnfo-ops\.q08\.workers\.dev/.test(s.alternate_path) && /workers_dev = true/.test(s.alternate_path), "the gateway hostname is registered with its alternate and no tested stamp", s && s.alternate_tested_at);
ok(/not a broken deploy/.test(s.alternate_path) && /OPS-DEGRADED-1/.test(s.alternate_path) && /manual step/.test(s.alternate_path), "the registry text says what the alternate does NOT cover");
ok(/only by a passing chaos drill/.test(s.evidence) && /00:35:02Z/.test(s.evidence), "the evidence says the stamp comes from the drill and quotes the reading it read");
ok(one("SELECT alternate_tested_at FROM spof_registry WHERE component = 'other row'").alternate_tested_at === "2026-11-04T20:05:45.368Z", "other SPOF rows are untouched");
const p = one("SELECT * FROM spof_alternate_probes WHERE component = ?", COMP);
ok(p && p.enabled === 1 && p.exercise === null && /3 h/.test(p.window_note), "an enabled probe with a 3 hour window is registered", p && p.enabled);

// the probe SQL itself, against a fixture of the metric
const run = (value, refreshed) => {
  w.exec("DELETE FROM metric_registry");
  if (value !== undefined) w.prepare("INSERT INTO metric_registry (metric, last_value, last_refreshed) VALUES ('ops_gateway_hosts_ok', ?, ?)").run(value, refreshed);
  return w.prepare(p.probe_sql).get();
};
const fresh = new Date(Date.now() - 20 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const old = new Date(Date.now() - 4 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
let r = run("1", fresh);
ok(r.expected === "ok" && r.observed === "ok", "a fresh reading of 1 passes", r);
r = run("1.0", fresh);
ok(r.observed === "ok", "1.0 passes too", r);
r = run("0.5", fresh);
ok(r.observed !== "ok" && /below 1/.test(r.observed), "a reading of 0.5 fails and says a hostname does not serve qnfo-ops", r);
r = run("0", fresh);
ok(r.observed !== "ok" && /below 1/.test(r.observed), "a reading of 0 fails", r);
r = run("1", old);
ok(r.observed !== "ok" && /not refreshed in 3 hours/.test(r.observed), "a stale reading fails and says the collector did not run", r);
r = run(undefined);
ok(r.observed !== "ok" && /no value/.test(r.observed), "no metric row fails and says nothing measured it", r);
r = run(null, null);
ok(r.observed !== "ok" && /no value/.test(r.observed), "an unmeasured metric fails", r);

const issue = one("SELECT * FROM agent_issues");
const d = issue.description;
const path = (/code-task: repo=qnfo-workers path=(\S+)/.exec(d) || [])[1];
const anchor = (/\ncode-anchor: (.*)\n/.exec(d) || [])[1];
const probe = (/\ncode-probe: (\{.*\})/.exec(d) || [])[1];
ok(issue.source === "session:c5-resilience" && issue.status === "open" && /^ROADMAP-1: QNFO\.INFRA DIRECT-DEPLOY-WINDOWS-1:/.test(issue.title) && /Prediction:/.test(d) && /charter pillar core/.test(d), "the Windows issue is a ROADMAP-1 row with pillar and prediction");
ok(path === "scripts/direct_content_deploy.py" && anchor && probe, "it carries code-task, code-anchor and code-probe", { path, anchor, probe });
const file = rd("../" + path);
ok(file.split(anchor).length - 1 === 1, "the anchor occurs exactly once in " + path, anchor);
const marker = JSON.parse(probe);
ok(marker.contains === "DIRECT-DEPLOY-WINDOWS-1" && d.includes(marker.contains) && !file.includes(marker.contains), "the closing marker is named in the issue and absent today");

const r5 = one("SELECT status, evidence FROM roadmap_implementation WHERE id = 5");
ok(r5.status === "partial" && r5.evidence.startsWith(EVID) && r5.evidence.includes("C5-RESILIENCE-5B") && /VERIFIED LIVE/.test(r5.evidence) && /00:35:02Z/.test(r5.evidence) && /not built/.test(r5.evidence), "row 5 stays partial, keeps its evidence, quotes the live reading and says what is not built", r5.status);

const before = snap();
w.exec(sql);
ok(before === snap(), "a replay changes nothing");
w.exec(rollback);
ok(one("SELECT COUNT(*) n FROM spof_registry WHERE component = ?", COMP).n === 0 && one("SELECT COUNT(*) n FROM spof_alternate_probes").n === 0 && one("SELECT COUNT(*) n FROM agent_issues").n === 0, "the Rollback line removes the SPOF row, the probe and the issue");
ok(one("SELECT evidence FROM roadmap_implementation WHERE id = 5").evidence === EVID && one("SELECT COUNT(*) n FROM spof_registry").n === 1, "the Rollback line restores row 5 exactly and leaves other SPOF rows");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
