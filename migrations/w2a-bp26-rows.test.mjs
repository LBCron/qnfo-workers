// W2A-BP26-ROWS-1 suite: replays migrations/2026-11-05-w2a-bp26-rows.sql on node:sqlite.
// Proves: the header opts in and names its backup; each of the 13 rows moves only from planned (1706 also from in_progress) and a row already past that is not reset; no row is set verified or
// closed; row 1413 becomes built and its rm-1413 contract (and rm-1710 for the built row 1710) is inserted only for a built row and passes against a table of fresh surfaces and fails on a stale one;
// both doer issues carry a code-task whose anchor occurs exactly once in the real worker file; a replay inserts nothing twice; the Rollback line restores the starting state.
// Output MUST contain "0 failed" on success.   node migrations/w2a-bp26-rows.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./2026-11-05-w2a-bp26-rows.sql", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../qnfo-gateway/worker.js", import.meta.url), "utf8");
const cloudOps = readFileSync(new URL("../qnfo-cloud-ops/worker.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in: APPLY-BY ci, DB qnfo-audit");
ok(header.some((l) => /^-- BACKUP: bak_20261105_w2a_bp26_rows\s*$/.test(l)) && /CREATE TABLE IF NOT EXISTS bak_20261105_w2a_bp26_rows/.test(body), "the backup table is named and created first");
ok(header.filter((l) => /^-- Rollback:/.test(l)).length === 1, "exactly one single-line Rollback header");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "the body deletes and drops nothing");
ok(!/status\s*=\s*'(verified|closed|resolved)'/i.test(body), "no row is set verified and no issue closed by this file");
ok(!/\b(LIKE|GLOB)\s+'[^']{51,}'/i.test(body), "no LIKE or GLOB pattern over 50 bytes");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");

const SCHEMA = `
CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT NOT NULL, evidence TEXT, verified_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT, last_verdict TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);
CREATE TABLE slo_budget_state (surface TEXT PRIMARY KEY, evaluated_at TEXT, state TEXT);
CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT);
CREATE TABLE metric_registry (metric TEXT PRIMARY KEY, last_value TEXT);
`;
const ROWS = [1390, 1391, 1393, 1394, 1397, 1400, 1401, 1407, 1408, 1412, 1413, 1414, 1419, 1706, 1710];
function world(statuses) {
  const w = new DatabaseSync(":memory:");
  w.exec(SCHEMA);
  for (const id of ROWS) w.prepare("INSERT INTO roadmap_implementation (id, item, source, title, artifact_type, status, evidence) VALUES (?, ?, 'x', 't', 'code', ?, 'old')").run(id, "item-" + id, (statuses && statuses[id]) || (id === 1710 ? "built" : id === 1400 ? "partial" : id === 1706 ? "in_progress" : "planned"));
  return w;
}
function freshSurfaces(w, hoursAgo) {
  w.exec("DELETE FROM slo_budget_state");
  const ts = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  for (let i = 0; i < 27; i++) w.prepare("INSERT INTO slo_budget_state VALUES (?, ?, 'immature')").run(i < 13 ? `h${i}#latency` : i === 13 ? "q08.org#freshness" : `h${i}`, ts);
  w.exec("INSERT OR REPLACE INTO ops_config VALUES ('slo_merge_lane', 'on', NULL); INSERT OR REPLACE INTO metric_registry VALUES ('postmortem_coverage', '1')");
}
const w = world();
w.exec(sql);
const st = (id) => w.prepare("SELECT status s, evidence e FROM roadmap_implementation WHERE id = ?").get(id);
ok(["1390", "1391", "1393", "1394", "1397", "1407", "1408", "1412", "1414", "1419", "1706"].every((id) => st(id).s === "partial" && st(id).e !== "old"), "eleven rows are partial with evidence");
ok(st(1413).s === "built" && st(1710).s === "built" && st(1401).s === "built" && /gtg-tag qwav\.tech --model off at 03:35Z/.test(st(1401).e), "rows 1413 and 1401 are built and row 1710 stays built");
ok(st(1400).s === "partial" && /Verified live 2026-11-05, after the merge/.test(st(1400).e) && st(1400).e.startsWith("old"), "row 1400 keeps its status and gains the live verification once");
ok(!w.prepare("SELECT 1 FROM roadmap_implementation WHERE status IN ('verified', 'closed') OR verified_at IS NOT NULL").get(), "nothing is verified by this file");
ok(w.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE class IN ('rm-1413', 'rm-1710') AND status = 'active' AND module = 'roadmap-dod-v1' AND verify_transport = 'd1-query'").get().n === 2, "rm-1413 and rm-1710 are active d1-query contracts of the roadmap-dod-v1 module");
const c1401 = w.prepare("SELECT verify_probe p, verify_transport t, status s FROM remediation_contracts WHERE class = 'rm-1401'").get();
ok(c1401 && c1401.t === "runner-https" && c1401.s === "active" && JSON.parse(c1401.p).absent === "googletagmanager" && JSON.parse(c1401.p).url === "https://ask.qwav.tech/", "rm-1401 is a runner-https probe that the tag text is absent from ask.qwav.tech", c1401);
const probe = (cls) => w.prepare("SELECT verify_probe p FROM remediation_contracts WHERE class = ?").get(cls).p;
freshSurfaces(w, 1);
const run = (cls) => w.prepare(probe(cls)).get();
ok(run("rm-1710").expected === run("rm-1710").observed && run("rm-1413").expected === run("rm-1413").observed, "both probes pass against fresh surfaces", [run("rm-1710"), run("rm-1413")]);
freshSurfaces(w, 9);
ok(run("rm-1710").expected !== run("rm-1710").observed && run("rm-1413").expected !== run("rm-1413").observed, "both probes fail when the surfaces are 9 hours stale");
freshSurfaces(w, 1);
w.exec("UPDATE ops_config SET value = 'off' WHERE key = 'slo_merge_lane'");
ok(run("rm-1413").expected !== run("rm-1413").observed, "rm-1413 fails when the merge lane gate is off");
w.exec("UPDATE ops_config SET value = 'on' WHERE key = 'slo_merge_lane'; UPDATE metric_registry SET last_value = '0.5' WHERE metric = 'postmortem_coverage'");
ok(run("rm-1413").expected !== run("rm-1413").observed, "rm-1413 fails when postmortem coverage is below 1");

for (const [title, anchor, file, name] of [["BP26-PROVENANCE-BASIS-1:%", gateway, "qnfo-gateway", "gateway"], ["BP26-KILLSWITCH-READERS-2:%", cloudOps, "qnfo-cloud-ops", "cloud-ops"]].map((x) => [x[0], x[1], x[2], x[3]])) {
  const iss = w.prepare("SELECT description d FROM agent_issues WHERE title LIKE ? AND status = 'open'").get(title);
  ok(iss && new RegExp("code-task: repo=qnfo-workers path=" + file + "/worker\\.js").test(iss.d), name + " doer issue carries a code-task");
  const a = iss && (iss.d.match(/code-anchor: (.+)/) || [])[1];
  ok(a && /^(async )?function \w+\(.*\) \{$/.test(a) && anchor.split(a).length - 1 === 1, name + " code-anchor is a function signature occurring exactly once", a);
}
ok(/runtime-probe: \{"url": "https:\/\/papers\.qnfo\.org\/papers\/twisted-cuprate-twistronics\/provenance\.json"/.test(w.prepare("SELECT description d FROM agent_issues WHERE title LIKE 'BP26-PROVENANCE-BASIS-1:%'").get().d), "the provenance issue closes through a runtime-probe on the live sidecar");
ok(/code-probe: \{"paths": \["qnfo-cloud-ops\/worker\.js"\], "contains": "fleet_kill_switch"\}/.test(w.prepare("SELECT description d FROM agent_issues WHERE title LIKE 'BP26-KILLSWITCH-READERS-2:%'").get().d), "the kill-switch issue closes through a code-probe");
ok(w.prepare("SELECT COUNT(*) n FROM decision_log WHERE actor = 'session-w2a'").get().n === 1, "one decision_log row");

// replay: nothing twice, a later status is not reset
w.exec("UPDATE roadmap_implementation SET status = 'verified' WHERE id = 1413");
w.exec(sql);
ok((st(1400).e.match(/Verified live 2026-11-05, after the merge/g) || []).length === 1, "the verification text is appended once");
ok(w.prepare("SELECT COUNT(*) n FROM agent_issues").get().n === 2 && w.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 1 && w.prepare("SELECT COUNT(*) n FROM remediation_contracts").get().n === 3, "a replay inserts nothing twice");
ok(st(1413).s === "verified", "a row already past built is not reset");

// rollback
const rollback = header.find((l) => /^-- Rollback:/.test(l)).replace(/^-- Rollback:\s*/, "");
const r = world();
r.exec(sql);
r.exec(rollback);
const rs = (id) => r.prepare("SELECT status s, evidence e FROM roadmap_implementation WHERE id = ?").get(id);
ok(ROWS.every((id) => rs(id).e === "old") && rs(1706).s === "in_progress" && rs(1390).s === "planned" && rs(1401).s === "planned" && rs(1710).s === "built", "the Rollback line restores status and evidence of every row");
ok(r.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE status = 'superseded'").get().n === 3 && r.prepare("SELECT COUNT(*) n FROM agent_issues WHERE status = 'closed'").get().n === 2 && r.prepare("SELECT COUNT(*) n FROM decision_log").get().n === 0, "the Rollback line supersedes the contracts, closes the two issues and removes the decision row");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
