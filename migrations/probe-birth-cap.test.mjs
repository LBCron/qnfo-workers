// PROBE-BIRTH-CAP-1 (2026-11-04, pillar cost): the issue-birth trigger of ISSUE-BIRTH-DOER-PROBE-1 queued one multi-turn issue-probe-agent
// run for every issue at birth with no count limit, so ISSUE-PROBE-CAP-1/2 and issue_probe_agent_per_hour (hourly workflow only) did not bound
// qnfo-agents' deepseek-v4.1-flash-1017 spend (1.2M neurons, 147.7M input tokens a day, none of it in ai_call_counters). This replays the
// 2026-11-01 migration (the trigger as shipped), shows an issue storm queues one run per issue, then applies 2026-11-04-probe-birth-cap.sql
// and shows the same storm queues at most issue_probe_birth_per_hour runs in a rolling hour, keeps every birth contract, and leaves the
// capped hourly workflow to pick the rest up.
// Run: node --no-warnings migrations/probe-birth-cap.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (f) => readFileSync(new URL("./" + f, import.meta.url), "utf8");
const other = read("issue-birth-doer-probe.test.mjs");
const a = other.indexOf("const db = new DatabaseSync"), b = other.indexOf("db.exec(sql);");
assert.ok(a > 0 && b > a, "the birth-probe harness is found");
const { db, sql } = new Function("DatabaseSync", "read", "assert", other.slice(a, b) + "\nreturn { db, sql };")(DatabaseSync, read, assert);
db.exec(sql); // the 2026-11-01 trigger as shipped
const one = (s, ...p) => db.prepare(s).get(...p);
const all = (s, ...p) => db.prepare(s).all(...p);
let nextId = 5000;
const issue = (title, source = "new-filer", priority = "high") => {
  const id = nextId++;
  db.prepare("INSERT INTO agent_issues (id,title,description,source,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, title, "a defect", source, priority, "open", Date.now(), Date.now());
  return id;
};
const runs = () => one("SELECT COUNT(*) n FROM cf_agent_requests WHERE requester = 'issue-probe-agent'").n;

// ---- as shipped: a storm of machine-filed tickets buys one agent run each ----
const baseline = runs();
for (let i = 0; i < 10; i++) issue("CF-OBS-ISSUE-1: qnfo-fleet-control: D1_ERROR: D1 DB is overloaded #" + i, "cf-observability");
assert.equal(runs() - baseline, 10, "reproduced: the birth trigger queues one probe-agent run per issue, 10 issues, 10 runs, no hourly limit");

// ---- the cap ----
const mig = read("2026-11-04-probe-birth-cap.sql");
assert.match(mig, /-- APPLY-BY: ci/);
assert.match(mig, /-- BACKUP: bak_20261104_birth_trigger/);
db.exec(mig);
assert.equal(one("SELECT value FROM ops_config WHERE key = 'issue_probe_birth_per_hour'").value, "2");
assert.ok(one("SELECT sql FROM bak_20261104_birth_trigger WHERE name = 'agent_issues_birth_contract_ins'").sql.includes("CREATE TRIGGER agent_issues_birth_contract_ins"), "the previous trigger is kept");
assert.equal(one("SELECT COUNT(*) n FROM decision_log WHERE action LIKE 'PROBE-BIRTH-CAP-1:%'").n, 1);

// Age the storm out of the rolling hour: the count must start from zero, as in a fresh hour.
db.prepare("UPDATE cf_agent_requests SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-3 hours')").run();
const ids = [];
for (let i = 0; i < 10; i++) ids.push(issue("CF-OBS-ISSUE-1: qnfo-cloud-ops: D1_ERROR: D1 DB is overloaded #" + i, "cf-observability"));
const born = ids.filter((id) => one("SELECT 1 x FROM cf_agent_requests WHERE instance = ?", "probe-issue-" + id));
assert.equal(born.length, 2, "with the cap the same storm queues 2 runs in the rolling hour (issue_probe_birth_per_hour)");
assert.deepEqual(born, ids.slice(0, 2), "the first issues of the hour are the ones asked");

// Every capped issue keeps its birth contract, its owner and its place in the hourly workflow's intake.
for (const id of ids) {
  assert.ok(one("SELECT status FROM remediation_contracts WHERE class = ?", "issue-" + id), "issue " + id + " keeps its birth contract");
  assert.ok(one("SELECT owner FROM issue_triage WHERE issue_id = ?", id).owner, "issue " + id + " keeps its owner");
  assert.equal(one("SELECT COUNT(*) n FROM v_issue_probe_intake WHERE issue_id = ?", id).n, 1, "issue " + id + " stays in v_issue_probe_intake for the capped hourly workflow");
}
assert.equal(one("SELECT COUNT(*) n FROM issue_probe_requests WHERE issue_id IN (" + ids.join(",") + ")").n, 2, "only the asked issues have a probe request row");

// The hourly workflow (its own LIMIT from issue_probe_agent_per_hour) still picks up the unasked ones.
db.prepare("UPDATE ops_config SET value = '3' WHERE key = 'issue_probe_agent_per_hour'").run() ;
const def = JSON.parse(one("SELECT definition FROM fleet_tasks WHERE id = 'issue-probe-agent'").definition);
const before = runs();
for (const step of def.steps) { try { db.prepare(step.sql).run(); } catch (e) { /* later steps read answers this fixture does not have */ } }
assert.ok(runs() - before >= 1 && runs() - before <= 3, "the hourly workflow queues its own capped batch (<= issue_probe_agent_per_hour) from the capped backlog: " + (runs() - before));

// The rolling hour moves: once the runs are older than 60 minutes a new issue is asked again.
db.prepare("UPDATE cf_agent_requests SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours')").run();
const later = issue("CRON-FAULT-1: worker-silent:qnfo-social", "cron-watch");
assert.ok(one("SELECT 1 x FROM cf_agent_requests WHERE instance = ?", "probe-issue-" + later), "after an hour the birth path asks again");

// Settings: 1000 restores the old behaviour, issue_probe_agent = off still stops it.
db.prepare("UPDATE ops_config SET value = '1000' WHERE key = 'issue_probe_birth_per_hour'").run();
const x0 = runs();
for (let i = 0; i < 5; i++) issue("BLINDSPOT-1: belief " + i, "blindspot");
assert.equal(runs() - x0, 5, "issue_probe_birth_per_hour = 1000 restores the unbounded birth path");
db.prepare("UPDATE ops_config SET value = 'off' WHERE key = 'issue_probe_agent'").run();
const x1 = runs();
issue("BLINDSPOT-1: belief off", "blindspot");
assert.equal(runs(), x1, "issue_probe_agent = off still stops it");

// An unreadable cap setting (non-numeric) reads as 0 and asks no one rather than everyone.
db.prepare("UPDATE ops_config SET value = 'on' WHERE key = 'issue_probe_agent'").run();
db.prepare("UPDATE ops_config SET value = 'banana' WHERE key = 'issue_probe_birth_per_hour'").run();
const x2 = runs();
issue("BLINDSPOT-1: belief garbled", "blindspot");
assert.equal(runs(), x2, "a garbled cap value fails closed (no run) and the hourly workflow still covers the issue");
console.log("probe-birth-cap: all assertions passed");
