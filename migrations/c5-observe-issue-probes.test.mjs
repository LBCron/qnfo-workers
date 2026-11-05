// C5-OBSERVE: the closing probes written by migrations/2026-11-04-c5-observe-issue-probes.sql, replayed on in-memory tables.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE remediation_contracts(class TEXT PRIMARY KEY, status TEXT, last_verdict TEXT, verify_transport TEXT, verify_probe TEXT);
INSERT INTO remediation_contracts VALUES ('issue-1001887','active','fail','code-read','old'),('issue-1001888','active',NULL,'code-read','old'),('issue-5','active',NULL,'code-read','keep');
CREATE TABLE watchmaker_runs(day TEXT PRIMARY KEY, index_value INTEGER, counted TEXT, json TEXT);
CREATE TABLE metric_registry(metric TEXT PRIMARY KEY, last_value TEXT);
CREATE TABLE agent_issues(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT);
`);
const sql = readFileSync(new URL("./2026-11-04-c5-observe-issue-probes.sql", import.meta.url), "utf8");
db.exec(sql);
const probe = (cls) => db.prepare("SELECT verify_transport t, verify_probe p, last_verdict v FROM remediation_contracts WHERE class = ?").get(cls);
const run = (cls) => db.prepare(probe(cls).p).get();
assert.equal(probe("issue-5").p, "keep");
for (const c of ["issue-1001887", "issue-1001888"]) { assert.equal(probe(c).t, "d1-query"); assert.equal(probe(c).v, null); }

// watchmaker: nothing stored, 41 unmeasured, 2 unmeasured
assert.match(run("issue-1001887").observed, /^unmet: no watchmaker run/);
const ops = (n, total) => JSON.stringify({ ops: Array.from({ length: total }, (_, i) => ({ key: "k" + i, state: i < n ? "unmeasured: D1_ERROR: D1 DB is overloaded" : "ok, last run 0.2h ago" })) });
db.prepare("INSERT INTO watchmaker_runs VALUES (date('now'), 42, '', ?)").run(ops(41, 68));
const r1 = run("issue-1001887");
assert.equal(r1.expected, "ok");
assert.match(r1.observed, /more than 3 unmeasured/);
db.prepare("UPDATE watchmaker_runs SET json = ?, index_value = 2").run(ops(2, 68));
assert.equal(run("issue-1001887").observed, "ok");
db.prepare("UPDATE watchmaker_runs SET json = ?").run(ops(3, 68));
assert.equal(run("issue-1001887").observed, "ok", "three is allowed");
db.prepare("UPDATE watchmaker_runs SET json = ?").run(ops(4, 68));
assert.match(run("issue-1001887").observed, /more than 3/);
db.prepare("UPDATE watchmaker_runs SET day = date('now', '-3 days')").run();
assert.match(run("issue-1001887").observed, /no watchmaker run stored in the last day/, "an old row is not a measurement of today");

// capability adopt: no value yet, a placeholder value, a value without an issue, both
assert.match(run("issue-1001888").observed, /no value yet/);
db.exec("INSERT INTO metric_registry VALUES ('cf_capability_undecided_14d', 'x')");
assert.match(run("issue-1001888").observed, /no value yet/, "the registration placeholder is not a measurement");
db.exec("UPDATE metric_registry SET last_value = '15'");
assert.match(run("issue-1001888").observed, /no CF-CAPABILITY-DECIDE-1 issue/);
db.exec("INSERT INTO agent_issues (title, status) VALUES ('CF-CAPABILITY-DECIDE-1: turnstile', 'open'), ('CF-CAPABILITY-ADOPT-1: x', 'open')");
assert.equal(run("issue-1001888").observed, "ok");
assert.equal(run("issue-1001888").expected, "ok");

// the Rollback line restores the code-read probes
const rb = /^-- Rollback: (.*)$/m.exec(sql)[1];
db.exec(rb);
assert.equal(probe("issue-1001887").t, "code-read");
assert.match(probe("issue-1001888").p, /CF-CAPABILITY-DECIDE-1/);
console.log("c5-observe-issue-probes: ok");
