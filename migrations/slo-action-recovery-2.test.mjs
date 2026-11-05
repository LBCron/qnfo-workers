// SLO-ACTION-RECOVERY-2 offline suite (migrations/2026-11-05-slo-action-recovery-2.sql). Replays the file on node:sqlite over fixtures shaped like qnfo-audit.
// Proves: the header opts in (APPLY-BY ci, DB qnfo-audit, BACKUP, one Rollback line); the five SLO-POSTMORTEM-ACTION-1 contracts get a probe that passes on a surface that answered for
// 24 h even while slo_budget_state is 'immature' or 'spent' (the 2026-11-03 probe, "budget state is not ok", could not) and still blocks on a failed sample in 24 h, on fewer than 12
// OBSERVED samples (a not-sampled row does not count), on an open availability incident and on a surface with no budget row; the cause is appended once to the postmortems of the five
// surfaces and to nothing else; only incidents whose first sample is a not-sampled row lose their completed postmortem; nothing is deleted; a replay changes nothing; the Rollback line
// restores every changed row. No live state is pinned.
// Output MUST contain "0 failed" on success.   node migrations/slo-action-recovery-2.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./2026-11-05-slo-action-recovery-2.sql", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 400))); } };
const header = sql.split("\n").filter((l) => l.startsWith("--"));
const body = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
ok(header.some((l) => /^-- APPLY-BY: ci\s*$/.test(l)) && header.some((l) => /^-- DB: qnfo-audit\s*$/.test(l)), "header opts in");
const rollback = header.filter((l) => /^-- Rollback:/.test(l));
ok(rollback.length === 1, "exactly one single-line Rollback header");
ok(header.some((l) => /^-- BACKUP: bak_20261105_slo_action_contracts\s*$/.test(l)), "BACKUP header names a table the file creates");
ok(!/\b(DELETE\s+FROM|DROP\s+(TABLE|INDEX|VIEW|TRIGGER))\b/i.test(body), "nothing is deleted or dropped");
ok(!/\bUPDATE\s+agent_issues\b/i.test(body) && !/\bCREATE\s+TRIGGER\b/i.test(body), "agent_issues is not written and no trigger is added (AGENT-ISSUES-TRIGGER-DEPTH-1)");
for (const m of body.matchAll(/LIKE\s+'([^']*)'/gi)) ok(Buffer.byteLength(m[1]) < 50, "LIKE pattern under D1's 50-byte limit: " + m[1]);

const SURFACES = { 1000675: "papers.qnfo.org", 1000676: "qnfo.org", 1000677: "qwav.org", 1000678: "travel.q08.org", 1000808: "fleet.qnfo.org" };
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const NOW = Date.now();
const OLD_PROBE = "SELECT 'ok' AS expected, CASE WHEN COALESCE((SELECT state FROM slo_budget_state WHERE surface = 'x'), '') <> 'ok' THEN 'budget state is not ok' ELSE 'ok' END AS observed";

function world() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, precondition TEXT, action TEXT, status TEXT, module TEXT, attempts INTEGER, last_verdict TEXT, next_due_at TEXT, expected_cadence_h INTEGER, max_attempts INTEGER);
CREATE TABLE postmortems (incident_key TEXT PRIMARY KEY, created_at TEXT, completed_at TEXT, state TEXT NOT NULL, timeline TEXT, root_cause TEXT, contributing TEXT, actions TEXT, action_issue TEXT, generator TEXT);
CREATE TABLE incidents (incident_key TEXT PRIMARY KEY, kind TEXT, surface TEXT, opened_at TEXT, closed_at TEXT, summary TEXT, source_ref TEXT);
CREATE TABLE bp26_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at TEXT, metric TEXT, subject TEXT, ok INTEGER, detail TEXT, producer TEXT);
CREATE TABLE slo_budget_state (surface TEXT PRIMARY KEY, state TEXT NOT NULL);`);
  const c = d.prepare("INSERT INTO remediation_contracts VALUES (?, ?, ?, 'd1-query', 'old', 'old', 'active', 'slo-action-recovery-1', 5, 'fail', '2026-11-05 00:00:00', 1, 3)");
  for (const [id] of Object.entries(SURFACES)) c.run("issue-" + id, Number(id), OLD_PROBE);
  c.run("issue-42", 42, OLD_PROBE);   // an unrelated contract
  for (const s of Object.values(SURFACES)) d.prepare("INSERT INTO slo_budget_state VALUES (?, 'immature')").run(s);
  return d;
}
const sample = (d, surface, t, okv, detail) => d.prepare("INSERT INTO bp26_probe_results (run_at, metric, subject, ok, detail) VALUES (?, 'slo_attainment_28d_min', ?, ?, ?)").run(iso(t), "avail:" + surface, okv, detail);
function incident(d, key, surface, opened, closed, state, rc) {
  d.prepare("INSERT INTO incidents VALUES (?, 'availability', ?, ?, ?, ?, 'bp26_probe_results')").run(key, surface, opened, closed, surface + " failed");
  d.prepare("INSERT INTO postmortems (incident_key, created_at, completed_at, state, timeline, root_cause, actions, generator) VALUES (?, ?, ?, ?, 't', ?, 'action issue filed: x', 'scripts/bp26_slo.py')").run(key, opened, state === "complete" ? closed : null, state, rc);
}
const q = (r, s, ...p) => r.prepare(s).all(...p);
const q1 = (r, s, ...p) => r.prepare(s).get(...p);
const rc = (r, k) => q1(r, "SELECT root_cause, state FROM postmortems WHERE incident_key = ?", k);

function fixtures(d) {
  // Every surface answered for the last 24 h (13 observed samples), except fleet.qnfo.org which failed 3 h ago.
  for (const s of Object.values(SURFACES)) for (let i = 0; i < 13; i++) sample(d, s, NOW - (i + 1) * 3600e3 + 60e3, s === "fleet.qnfo.org" && i === 2 ? 0 : 1, s === "fleet.qnfo.org" && i === 2 ? "status 200 in 7200 ms" : "status 200 in 200 ms");
  incident(d, "avail:fleet.qnfo.org:2026-10-30T07:20:19Z", "fleet.qnfo.org", "2026-10-30T07:20:19Z", "2026-10-30T21:17:41Z", "complete", "slow: the host answered with an accepted status but slower than the 5 s limit");
  incident(d, "avail:fleet.qnfo.org:2026-10-31T00:54:09Z", "fleet.qnfo.org", "2026-10-31T00:54:09Z", "2026-10-31T02:19:52Z", "complete", "unreachable: the probe could not complete a request");
  sample(d, "fleet.qnfo.org", Date.parse("2026-10-31T00:54:09Z"), null, "not sampled: budget-exhausted (relabelled SLO-PROBE-BUDGET-1)");
  incident(d, "avail:qnfo.org:2026-10-27T14:32:44Z", "qnfo.org", "2026-10-27T14:32:44Z", "2026-10-27T15:52:56Z", "complete", "unreachable: the probe could not complete a request");
  incident(d, "avail:qnfo.org:2026-10-31T00:54:09Z", "qnfo.org", "2026-10-31T00:54:09Z", "2026-10-31T02:19:52Z", "complete", "unreachable: the probe could not complete a request");
  sample(d, "qnfo.org", Date.parse("2026-10-31T00:54:09Z"), null, "not sampled: budget-exhausted (relabelled SLO-PROBE-BUDGET-1)");
  incident(d, "avail:papers.qnfo.org:2026-10-28T09:32:25Z", "papers.qnfo.org", "2026-10-28T09:32:25Z", "2026-10-28T10:34:33Z", "complete", "slow-or-unknown: the sample failed the SLI");
  incident(d, "avail:qwav.org:2026-10-28T09:32:25Z", "qwav.org", "2026-10-28T09:32:25Z", "2026-10-28T10:34:33Z", "complete", "timeout: the host did not answer inside the probe timeout");
  incident(d, "avail:travel.q08.org:2026-10-26T23:01:55Z", "travel.q08.org", "2026-10-26T23:01:55Z", "2026-10-27T00:02:10Z", "complete", "slow: the host answered with an accepted status but slower than the 5 s limit");
  incident(d, "avail:travel.q08.org:2026-11-03T20:36:52Z", "travel.q08.org", "2026-11-03T20:36:52Z", "2026-11-03T23:02:20Z", "complete", "timeout: the host did not answer inside the probe timeout");
  // Real failures that must keep their postmortem: a genuine unreachable sample on another surface, and an open draft.
  incident(d, "avail:ideas.qnfo.org:2026-10-31T00:54:09Z", "ideas.qnfo.org", "2026-10-31T00:54:09Z", "2026-10-31T02:19:52Z", "complete", "unreachable: the probe could not complete a request");
  sample(d, "ideas.qnfo.org", Date.parse("2026-10-31T00:54:09Z"), 0, "down: error:URLError");
  incident(d, "avail:ideas.qnfo.org:2026-11-04T17:15:25Z", "ideas.qnfo.org", "2026-11-04T17:15:25Z", null, "draft", "slow: x");
  incident(d, "avail:ask.qwav.tech:2026-11-01T19:19:56Z", "ask.qwav.tech", "2026-11-01T19:19:56Z", "2026-11-01T20:39:33Z", "complete", "unreachable: the probe could not complete a request");
  sample(d, "ask.qwav.tech", Date.parse("2026-11-01T19:19:56Z"), null, "not sampled: budget-exhausted (relabelled SLO-PROBE-BUDGET-1)");
}

const w = world();
fixtures(w);
const snapshot = () => JSON.stringify([q(w, "SELECT * FROM postmortems ORDER BY incident_key"), q(w, "SELECT * FROM incidents ORDER BY incident_key"), q(w, "SELECT * FROM remediation_contracts ORDER BY class")]);
const before = snapshot();
w.exec(sql);

// (a) the probes
for (const [id, surface] of Object.entries(SURFACES)) {
  const row = q1(w, "SELECT * FROM remediation_contracts WHERE class = ?", "issue-" + id);
  ok(row.status === "active" && row.module === "slo-action-recovery-1" && row.verify_transport === "d1-query" && row.attempts === 0 && row.last_verdict === null, "contract of " + id + " re-armed", row);
  ok(!/budget state is not ok/.test(row.verify_probe) && row.verify_probe.includes("'" + surface + "'") && row.verify_probe.includes("'avail:" + surface + "'"), "probe of " + id + " names its own surface and no longer needs an ok budget");
  const out = q1(w, row.verify_probe);
  if (surface === "fleet.qnfo.org") ok(out.expected === "ok" && out.observed === "a sample failed in the last 24 h", "fleet.qnfo.org: a failed sample in 24 h blocks closure", out);
  else ok(out.expected === "ok" && out.observed === "ok", surface + ": 13 observed samples, none failed, budget immature -> passes", out);
}
ok(q1(w, "SELECT verify_probe FROM remediation_contracts WHERE class = 'issue-42'").verify_probe === OLD_PROBE, "an unrelated contract is untouched");

// the probe's other branches, on the qnfo.org contract (taken from the migration, not from the Python source)
const probe = q1(w, "SELECT verify_probe p FROM remediation_contracts WHERE class = 'issue-1000676'").p;
w.exec("UPDATE slo_budget_state SET state = 'spent' WHERE surface = 'qnfo.org'");
ok(q1(w, probe).observed === "ok", "passes while the 28-day budget is spent (a single old failure keeps it spent for 28 days)");
w.exec("UPDATE bp26_probe_results SET ok = NULL, detail = 'not sampled' WHERE id IN (SELECT id FROM bp26_probe_results WHERE subject = 'avail:qnfo.org' AND run_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours') LIMIT 2)");
ok(q1(w, probe).observed === "fewer than 12 observed samples in 24 h", "not-sampled rows do not count toward the 12", q1(w, probe));
w.exec("UPDATE bp26_probe_results SET ok = 1 WHERE subject = 'avail:qnfo.org' AND ok IS NULL AND run_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-24 hours')");
w.exec("INSERT INTO incidents VALUES ('avail:qnfo.org:open-test', 'availability', 'qnfo.org', '2026-11-05T00:00:00Z', NULL, 't', 'x')");
ok(q1(w, probe).observed === "an availability incident of the surface is still open", "an open availability incident blocks closure");
w.exec("DELETE FROM incidents WHERE incident_key = 'avail:qnfo.org:open-test'; DELETE FROM slo_budget_state WHERE surface = 'qnfo.org'");
ok(q1(w, probe).observed === "no budget state for the surface", "a surface the collector does not measure cannot close its issue");

// (b) the cause is named, once, on the five surfaces only
const named = (k) => /NAMED CAUSE/.test(rc(w, k).root_cause);
ok(named("avail:fleet.qnfo.org:2026-10-30T07:20:19Z") && /V3-DASH-1/.test(rc(w, "avail:fleet.qnfo.org:2026-10-30T07:20:19Z").root_cause), "fleet.qnfo.org slow episode names V3-DASH-1");
ok(rc(w, "avail:fleet.qnfo.org:2026-10-30T07:20:19Z").root_cause.startsWith("slow: "), "the generator's class stays in front of the named cause");
ok(named("avail:qnfo.org:2026-10-27T14:32:44Z") && named("avail:papers.qnfo.org:2026-10-28T09:32:25Z") && named("avail:qwav.org:2026-10-28T09:32:25Z"), "qnfo.org, papers.qnfo.org and qwav.org episodes name their cause");
ok(named("avail:travel.q08.org:2026-10-26T23:01:55Z") && /ensureTravel/.test(rc(w, "avail:travel.q08.org:2026-10-26T23:01:55Z").root_cause), "travel.q08.org slow episode names ensureTravel");
ok(named("avail:travel.q08.org:2026-11-03T20:36:52Z") && /q08\.org family/.test(rc(w, "avail:travel.q08.org:2026-11-03T20:36:52Z").root_cause), "travel.q08.org late timeout names the shared q08.org event");
ok(!named("avail:ideas.qnfo.org:2026-11-04T17:15:25Z") && !named("avail:ideas.qnfo.org:2026-10-31T00:54:09Z"), "other surfaces get no named cause");

// (c) not-sampled artifacts lose their completed postmortem; real failures keep theirs
for (const k of ["avail:fleet.qnfo.org:2026-10-31T00:54:09Z", "avail:qnfo.org:2026-10-31T00:54:09Z", "avail:ask.qwav.tech:2026-11-01T19:19:56Z"]) {
  const r = rc(w, k);
  ok(r.state === "withdrawn" && /^withdrawn: no failed availability sample remains/.test(r.root_cause), "artifact incident withdrawn: " + k, r);
}
ok(q1(w, "SELECT completed_at FROM postmortems WHERE incident_key = 'avail:qnfo.org:2026-10-31T00:54:09Z'").completed_at === null, "a withdrawn postmortem has no completion time");
ok(rc(w, "avail:ideas.qnfo.org:2026-10-31T00:54:09Z").state === "complete", "an incident with a genuinely failed first sample keeps its completed postmortem");
ok(rc(w, "avail:ideas.qnfo.org:2026-11-04T17:15:25Z").state === "draft", "an open draft is untouched");
ok(/\[withdrawn:/.test(q1(w, "SELECT summary FROM incidents WHERE incident_key = 'avail:qnfo.org:2026-10-31T00:54:09Z'").summary) && !/\[withdrawn:/.test(q1(w, "SELECT summary FROM incidents WHERE incident_key = 'avail:ideas.qnfo.org:2026-10-31T00:54:09Z'").summary), "the incident summary says so only for the artifact");

// no row appears or disappears; the backups hold the before-state
ok(q1(w, "SELECT COUNT(*) n FROM postmortems").n === 11 && q1(w, "SELECT COUNT(*) n FROM incidents").n === 11, "no postmortem or incident row is added or removed");
ok(q1(w, "SELECT COUNT(*) n FROM bak_20261105_slo_action_contracts").n === 5, "the backup holds the five contracts");
ok(q(w, "SELECT root_cause FROM bak_20261105_slo_postmortems WHERE incident_key = 'avail:qnfo.org:2026-10-31T00:54:09Z'")[0].root_cause.startsWith("unreachable"), "the backup holds the original root cause");

// idempotent
const after = snapshot();
w.exec("UPDATE slo_budget_state SET state = 'immature'");
w.exec(sql);
const twice = q1(w, "SELECT root_cause FROM postmortems WHERE incident_key = 'avail:qwav.org:2026-10-28T09:32:25Z'").root_cause;
ok((twice.match(/NAMED CAUSE/g) || []).length === 1, "a replay appends the cause once");
ok(JSON.stringify(q(w, "SELECT incident_key, state, root_cause FROM postmortems ORDER BY incident_key")) === JSON.stringify(JSON.parse(after)[0].map((r) => ({ incident_key: r.incident_key, state: r.state, root_cause: r.root_cause }))), "a replay changes no postmortem");

// rollback restores the before-state of every row the file changed
w.exec(rollback[0].replace(/^-- Rollback:\s*/, ""));
const b = JSON.parse(before);
const restored = q(w, "SELECT * FROM postmortems ORDER BY incident_key");
ok(JSON.stringify(restored) === JSON.stringify(b[0]), "the Rollback line restores the postmortems", restored.filter((r, i) => JSON.stringify(r) !== JSON.stringify(b[0][i])).map((r) => r.incident_key));
ok(JSON.stringify(q(w, "SELECT * FROM incidents ORDER BY incident_key")) === JSON.stringify(b[1]), "the Rollback line restores the incidents");
ok(JSON.stringify(q(w, "SELECT * FROM remediation_contracts ORDER BY class")) === JSON.stringify(b[2]), "the Rollback line restores the contracts");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
