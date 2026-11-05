// F1-C sweep (2026-11-05): replays migrations/2026-11-05-f1c-q08-forms-and-domains.sql and 2026-11-05-f1c-slo-freshness.sql on node:sqlite. Proves the two contract probes are the ones the issues need (the Turnstile probe can read
// pass, the forecast probe reads the code), the 14 SLI definitions name the subjects scripts/bp26_web.py writes, the roadmap rows move only from the statuses read, the two follow-up
// issues carry their probe lines, and a replay changes nothing. Run: node migrations/f1c-q08-reach-sweep.test.mjs   -> prints "N passed, 0 failed"
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";

// The two migrations ship in two pull requests; whichever is not on this checkout yet is skipped, and the sections below follow the files present.
const urlA = new URL("./2026-11-05-f1c-q08-forms-and-domains.sql", import.meta.url), urlB = new URL("./2026-11-05-f1c-slo-freshness.sql", import.meta.url);
const sqlA = existsSync(urlA) ? readFileSync(urlA, "utf8") : "";
const sqlB = existsSync(urlB) ? readFileSync(urlB, "utf8") : "";
const sql = sqlA + "\n" + sqlB;
const consumer = readFileSync(new URL("../scripts/remediation_consumer.py", import.meta.url), "utf8");
const web = readFileSync(new URL("../scripts/bp26_web.py", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

for (const [name, text, backup] of [["forms-and-domains", sqlA, "bak_20261105_f1c_contracts"], ["slo-freshness", sqlB, "bak_20261105_f1c_slo_roadmap"]].filter((x) => x[1])) {
  const header = text.split("\n").filter((l) => l.startsWith("--"));
  ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), name + ": header opts in");
  ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, name + ": one Rollback line");
  ok(header.some((l) => l === "-- BACKUP: " + backup) && header.some((l) => /^-- CAUSE-MAPPED:/.test(l)), name + ": BACKUP and CAUSE-MAPPED lines present");
}
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/\b(UPDATE|DELETE\s+FROM)\s+(decision_log|issue_lifecycle)\b/i.test(body), "decision_log is only inserted into");
ok(!/CREATE\s+(TEMP\s+)?TRIGGER/i.test(body), "no trigger is created (agent_issues already nests 24)");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai link");

const world = () => {
  const w = new DatabaseSync(":memory:");
  w.exec(`
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER DEFAULT 3, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT DEFAULT 'active', ts TEXT DEFAULT (datetime('now')), last_attempt_at TEXT, last_verdict TEXT, module TEXT, budget_ms INTEGER, next_due_at TEXT, max_items INTEGER, requires_container INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, deferred_since TEXT);
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
CREATE TABLE slo_definitions (surface TEXT PRIMARY KEY, sli TEXT, objective REAL, window_days INTEGER, source TEXT, owner TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')));
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, assumption TEXT, action TEXT, evidence TEXT, outcome TEXT, blast_radius TEXT, rollback_path TEXT, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT);
INSERT INTO agent_issues (id, title, status) VALUES (1000662, 'ROADMAP-1: QNFO.RSCH #3: q08 scores the last forecast update', 'open'), (1000668, 'BP26-EDGE-TURNSTILE-Q08-1: Turnstile', 'open');
INSERT INTO remediation_contracts (class, issue_id, verify_probe, verify_transport, status, last_verdict, attempts, escalate_to) VALUES
 ('issue-1000662', 1000662, 'SELECT ''closed'' AS expected, (SELECT status FROM agent_issues WHERE id = 1000662) AS observed', 'd1-query', 'superseded', 'superseded:closure-observing-probe-at-birth', 0, 'qnfo-fleet-control'),
 ('issue-1000668', 1000668, 'WITH latest AS (SELECT 1) SELECT ''q08.org#/subscribe and q08.org#q08-fb both Turnstile-protected (ok=1)'' AS expected, ''x'' AS observed', 'd1-query', 'active', 'probe-error', 246, 'qnfo-fleet-control');
INSERT INTO roadmap_implementation (id, item, status, evidence) VALUES (1697, 'RM-FORECAST-HYGIENE-1', 'in_progress', 'old'), (1699, 'RM-FORECAST-UPDATE-SCORING-1', 'planned', 'old'), (1710, 'ROADMAP-1: QNFO.OPS BP26-SLO-FRESHNESS-1', 'planned', 'old'), (1751, 'EK-4', 'planned', 'old'), (1752, 'EK-5', 'planned', 'old');
`);
  return w;
};
const w = world();
w.exec(sql);

// ---- issue-1000662: a code-read probe over the worker and its test
if (sqlA) {
  const c = w.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000662'").get();
  const p = JSON.parse(c.verify_probe);
  ok(c.status === "active" && c.verify_transport === "code-read" && c.last_verdict === null && c.attempts === 0, "issue-1000662 is re-armed as a code-read contract", c);
  ok(Object.keys(p).sort().join() === "contains,paths" && p.contains === "updated_brier" && p.paths.join() === "q08-signal-engine/worker.js,q08-signal-engine/forecast.test.mjs", "the probe names the worker, its test and the field", p);
  ok(!/agent_issues/.test(c.verify_probe), "it never reads the issue's own status");
  const worker = readFileSync(new URL("../q08-signal-engine/worker.js", import.meta.url), "utf8");
  const test = readFileSync(new URL("../q08-signal-engine/forecast.test.mjs", import.meta.url), "utf8");
  ok(worker.includes(p.contains) && test.includes(p.contains), "on this checkout both files hold the marker, so the probe reads pass");
}

// ---- issue-1000668: the probe can pass, and says what is missing when it cannot
if (sqlA) {
  const c = w.prepare("SELECT * FROM remediation_contracts WHERE class = 'issue-1000668'").get();
  ok(c.status === "active" && c.verify_transport === "d1-query" && c.attempts === 0 && c.last_verdict === null, "issue-1000668 is re-armed", c);
  const low = c.verify_probe.toLowerCase();
  const WRITE = ["insert into", "update ", "delete from", "drop table", "drop index", "alter table", "create table", "create index", "create trigger", "attach ", "detach ", "pragma ", "replace into", "vacuum"];
  ok(/^with|^select/.test(low) && !c.verify_probe.slice(0, -1).includes(";") && !WRITE.some((k) => low.includes(k)), "it is a literal read-only SELECT the consumer accepts");
  const kw = (consumer.match(/WRITE_KW = \(([\s\S]*?)\)/) || [, ""])[1];
  ok(WRITE.every((k) => kw.includes('"' + k + '"')), "the keyword list used here matches the consumer's");
  const read = () => w.prepare(c.verify_probe).get();
  let r = read();
  ok(r.expected === "ok" && r.observed === "no probe rows", "no collector row yet: not ok, and says so", r);
  const ins = w.prepare("INSERT INTO bp26_probe_results (run_at, metric, subject, ok, detail) VALUES (?, 'turnstile_on_public_forms', ?, ?, 'd')");
  ins.run("2026-11-04T21:53:57Z", "q08.org#/subscribe", 0); ins.run("2026-11-04T21:53:57Z", "q08.org#q08-fb", 0);
  r = read();
  ok(r.expected === "ok" && r.observed !== "ok" && /q08\.org#\/subscribe ok=0/.test(r.observed) && /q08\.org#q08-fb ok=0/.test(r.observed), "widget absent: the observed value names both subjects", r);
  ins.run("2026-11-05T10:00:00Z", "q08.org#/subscribe", 1);
  r = read();
  ok(r.observed !== "ok" && /q08-fb ok=0/.test(r.observed), "one form protected is not enough", r);
  ins.run("2026-11-05T10:00:00Z", "q08.org#q08-fb", 1);
  r = read();
  ok(r.expected === "ok" && r.observed === "ok", "the newest row of both subjects ok = 1: expected equals observed, so the consumer reads pass", r);
  ins.run("2026-11-05T11:00:00Z", "q08.org#q08-fb", 0);
  ok(read().observed !== "ok", "a later failing row takes the pass away (the newest row counts)");
  ins.run("2026-11-05T12:00:00Z", "q08.org#other", 1);
  ok(read().observed !== "ok", "a row of another subject changes nothing");
  ok(/^\s*$/.test("") && c.precondition.includes("F1-C 2026-11-05"), "the contract records why it changed");
}

// ---- the SLI definitions name the subjects the collector writes
if (sqlB) {
  const rows = w.prepare("SELECT * FROM slo_definitions ORDER BY surface").all();
  ok(rows.length === 14, "14 definitions: 13 latency and 1 freshness", rows.length);
  const hosts = (web.match(/HTML_HOSTS = \(([\s\S]*?)\)/) || [, ""])[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
  ok(hosts.length === 13, "bp26_web.py lists 13 public HTML hosts", hosts);
  for (const h of hosts) ok(rows.some((r) => r.surface === h + "#latency" && r.source === "bp26_probe_results lat:" + h && r.objective === 0.95 && r.window_days === 28), "latency definition for " + h);
  const f = rows.find((r) => r.surface === "q08.org#freshness");
  ok(f && f.source === "bp26_probe_results fresh:q08.org" && f.objective === 0.9 && f.window_days === 28 && /09:00 Central European time/.test(f.sli), "freshness definition names fresh:q08.org", f);
  ok(rows.every((r) => r.owner === "program-manager:QNFO.OPS" && /^bp26_probe_results (lat|fresh):/.test(r.source)), "every definition has an owner and a subject");
  ok(/DESK_SUBJECT = "fresh:q08\.org"/.test(web) && /out\.append\(\("lat:" \+ h/.test(web), "the collector writes those subjects");
}

// ---- roadmap rows
{
  const st = Object.fromEntries(w.prepare("SELECT id, status, evidence, verified_at FROM roadmap_implementation").all().map((r) => [r.id, r]));
  if (sqlA) {
    ok(st[1697].status === "verified" && st[1697].verified_at && /1000671/.test(st[1697].evidence), "1697 verified, naming the open metric issue for the legacy forecasts");
    ok(st[1699].status === "verified" && /PR 6611/.test(st[1699].evidence) && /not yet visible/.test(st[1699].evidence), "1699 verified, saying the field is not yet visible on a live forecast");
    ok(["1751", "1752"].every((i) => st[i].status === "built" && st[i].verified_at === null), "1751 1752 are built, not verified (VERIFY-LIVE-1)");
  }
  if (sqlB) ok(st[1710].status === "built" && st[1710].verified_at === null, "1710 is built, not verified (VERIFY-LIVE-1)");
  if (!sqlA) ok(["1697", "1699", "1751", "1752"].every((i) => st[i].status !== "verified" && st[i].status !== "built"), "without part 1 the other rows are untouched");
  if (!sqlB) ok(st[1710].status === "planned", "without part 2 row 1710 is untouched");
}

// ---- the closed loops
if (sqlA) {
  const iss = w.prepare("SELECT title, description, priority FROM agent_issues WHERE id > 1000668 OR id NOT IN (1000662, 1000668)").all();
  ok(iss.length === 2, "two follow-up issues", iss.map((i) => i.title));
  const t = iss.find((i) => /^BP26-EDGE-TURNSTILE-Q08-2:/.test(i.title));
  ok(t && /runtime-probe: \{"url": "https:\/\/q08\.org\/health", "status": 200, "contains": "enforcing"\}/.test(t.description), "the enforcement issue carries a runtime-probe on /health");
  ok(t && /never[^.]*owner|not the owner/i.test(t.description) && /secret lease|secret-lock/.test(t.description), "it names the fleet as the doer and the secret lease");
  const d = iss.find((i) => /^ROADMAP-1: QNFO\.REACH Q08-DOMAIN-FORM-2:/.test(i.title));
  const anchor = (d.description.match(/^code-anchor: (.+)$/m) || [, ""])[1];
  const worker = readFileSync(new URL("../q08-signal-engine/worker.js", import.meta.url), "utf8");
  ok(d && /^code-task: repo=qnfo-workers path=q08-signal-engine\/worker\.js$/m.test(d.description) && anchor && worker.split(anchor).length === 2, "the domain issue has a code-task and an anchor that occurs exactly once", anchor);
  ok(d && /^code-probe: \{"paths": \["q08-signal-engine\/worker\.js"\], "contains": "federalregister\.gov"\}$/m.test(d.description), "and a code-probe");
}

// ---- decisions logged once, a replay changes nothing
{
  if (sqlA) ok(w.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'Q08-DOMAIN-FORM-1 and BP26-EDGE-TURNSTILE-Q08-1%'").get().n === 1, "one decision row for part 1");
  if (sqlB) ok(w.prepare("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'BP26-SLO-FRESHNESS-1: lat:<host>%'").get().n === 1, "one decision row for part 2");
  const snap = () => JSON.stringify([w.prepare("SELECT * FROM remediation_contracts ORDER BY class").all(), w.prepare("SELECT id, status, evidence FROM roadmap_implementation ORDER BY id").all(), w.prepare("SELECT COUNT(*) n FROM slo_definitions").get(), w.prepare("SELECT COUNT(*) n FROM agent_issues").get(), w.prepare("SELECT COUNT(*) n FROM decision_log").get()]);
  const before = snap();
  w.exec(sql);
  ok(before === snap(), "a replay changes nothing");
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
