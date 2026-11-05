// RM-BS-CAPABILITY-SECURITY-1 offline suite: replays migrations/2026-11-05-rm-bs-capability-security-1.sql on node:sqlite.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, one Rollback line); the inventory holds the four front doors with a tokenless status; the policy key parses and names the caveats the
// worker implements; the four contract probes are valid runner-https JSON; both follow-up issues carry code-task and code-anchor lines whose path exists and whose anchor occurs once;
// a replay changes nothing; the Rollback line puts the tables and rows back. Output MUST contain "0 failed" on success.
// Run: node migrations/rm-bs-capability-security-1.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rd = (rel) => readFileSync(new URL(rel, root), "utf8");
const sql = rd("migrations/2026-11-05-rm-bs-capability-security-1.sql");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };

const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one Rollback line");
ok(!/^\s*(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/im.test(body), "the body deletes and drops nothing");
ok(!/claude\.ai|anthropic\.com/i.test(sql), "no claude.ai or anthropic.com link");
ok(Array.from(body.matchAll(/LIKE\s+'((?:[^']|'')*)'/gi)).every((m) => Buffer.byteLength(m[1]) <= 50), "every LIKE pattern is at most 50 bytes");

function world() {
  const w = new DatabaseSync(":memory:");
  w.exec(`CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE failure_modes (fm_key TEXT PRIMARY KEY, failure_mode TEXT, root_cause TEXT, remediation TEXT, detector TEXT, probe_class TEXT, first_seen TEXT, issue_id INTEGER, trigger_condition TEXT, symptom TEXT, blast_radius TEXT);
CREATE TABLE remediation_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT UNIQUE, issue_id INTEGER, precondition TEXT, action TEXT, verify_probe TEXT, verify_transport TEXT, max_attempts INTEGER, escalate_to TEXT, expected_cadence_h INTEGER, status TEXT, module TEXT, next_due_at TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, linked_session TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), actor TEXT NOT NULL, assumption TEXT NOT NULL, action TEXT NOT NULL, evidence TEXT NOT NULL, outcome TEXT NOT NULL, blast_radius TEXT NOT NULL, rollback_path TEXT NOT NULL, capability_gain TEXT, predicted_outcome TEXT, reach_gain TEXT, surfaces_tested TEXT, outcome_matched INTEGER);`);
  return w;
}
const count = (w, t) => w.prepare("SELECT COUNT(*) n FROM " + t).get().n;
const w = world();
w.exec(body);

const doors = w.prepare("SELECT surface, unauth_http, capability_tokens, tools_total FROM mcp_front_door_inventory ORDER BY surface").all();
ok(doors.map((d) => d.surface).join(",") === "personal-api,qnfo-memory-mcp,qnfo-ops,qnfo-tools-mcp", "four front doors", doors);
ok(doors.every((d) => /401/.test(d.unauth_http)), "every door records a 401 for a tokenless call");
ok(doors.find((d) => d.surface === "qnfo-tools-mcp").capability_tokens === 1 && doors.find((d) => d.surface === "qnfo-tools-mcp").tools_total === 18, "tools-mcp: capability tokens, 18 tools");
ok(count(w, "capability_static_token_baseline") === 7, "baseline has the five x-loop-token workers and two MCP workers");
const xloop = w.prepare("SELECT SUM(occurrences) n FROM capability_static_token_baseline WHERE token_kind = 'x-loop-token'").get().n;
ok(xloop === 42, "x-loop-token occurrences sum to the 42 counted", xloop);

const policy = JSON.parse(w.prepare("SELECT value FROM ops_config WHERE key = 'capability_token_policy_v1'").get().value);
ok(policy.version === 1 && policy.max_ttl_s === 86400 && policy.max_caveats === 16 && ["t", "x", "w", "k"].every((k) => k in policy.caveats), "policy parses and lists the four caveats");
const workerSrc = rd("qnfo-tools-mcp/worker.js");
ok(/var CAP_MAX_TTL_S = 86400;/.test(workerSrc) && /var CAP_MAX_CAVEATS = 16;/.test(workerSrc), "the worker implements the limits the policy states");
ok(/path === "\/mcp\/attenuate"/.test(workerSrc), "the worker serves the mint route the policy names");

const probes = w.prepare("SELECT class, verify_probe, verify_transport, status FROM remediation_contracts ORDER BY class").all();
ok(probes.length === 4 && probes.every((p) => p.verify_transport === "runner-https" && p.status === "active"), "four active runner-https contracts", probes.map((p) => p.class));
for (const p of probes) {
  let j = null; try { j = JSON.parse(p.verify_probe); } catch (e) { /* reported below */ }
  ok(j && /^https:\/\//.test(j.url) && Object.keys(j).every((k) => ["url", "status", "contains", "absent", "min_version"].includes(k)), "probe JSON is valid for " + p.class, p.verify_probe);
}
ok(JSON.parse(probes.find((p) => p.class === "fm-capability-tokens-live").verify_probe).min_version === "1.5.0", "the deploy detector asks for 1.5.0");
ok(w.prepare("SELECT COUNT(*) n FROM failure_modes WHERE fm_key = 'mcp-front-door-open' AND probe_class = 'fm-mcp-front-door-open'").get().n === 1, "failure mode row with its detector class");

const issues = w.prepare("SELECT title, description FROM agent_issues ORDER BY id").all();
ok(issues.length === 2 && issues.every((i) => /^ROADMAP-1: QNFO\.OPS W2-J-CAP-[23]/.test(i.title)), "two ROADMAP-1 follow-up issues");
for (const i of issues) {
  const p = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(i.description), a = /^code-anchor: (.+)$/m.exec(i.description);
  ok(p && a, "routing lines on " + i.title.slice(0, 40));
  if (p && a) {
    ok(existsSync(new URL(p[1], root)), "routed path exists: " + p[1]);
    const text = readFileSync(new URL(p[1], root), "utf8");
    ok(text.split(a[1]).length - 1 === 1, "anchor occurs exactly once in " + p[1], a[1]);
  }
  ok(/^code-probe: \{.+\}$/m.test(i.description), "carries a code-probe line");
}
ok(count(w, "decision_log") === 1, "one decision_log row");

const before = ["mcp_front_door_inventory", "capability_static_token_baseline", "ops_config", "failure_modes", "remediation_contracts", "agent_issues", "decision_log"].map((t) => count(w, t));
w.exec(body);
const after = ["mcp_front_door_inventory", "capability_static_token_baseline", "ops_config", "failure_modes", "remediation_contracts", "agent_issues", "decision_log"].map((t) => count(w, t));
ok(JSON.stringify(before) === JSON.stringify(after), "a replay changes nothing", { before, after });

w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
ok(w.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('mcp_front_door_inventory', 'capability_static_token_baseline')").get().n === 0, "Rollback drops the two tables");
ok(count(w, "ops_config") === 0, "Rollback removes the policy key");
ok(w.prepare("SELECT COUNT(*) n FROM remediation_contracts WHERE status = 'active'").get().n === 0, "Rollback supersedes the contracts");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
