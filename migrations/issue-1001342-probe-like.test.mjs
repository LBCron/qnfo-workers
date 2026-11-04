import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// PROBE-LIKE-OVER-LIMIT-1001342: the probe keeps its meaning without a LIKE pattern over 50 bytes.
const migration = readFileSync(new URL("./2026-11-04-issue-1001342-probe-like.sql", import.meta.url), "utf8");
assert.match(migration, /^-- APPLY-BY: ci$/m);
assert.match(migration, /^-- DB: qnfo-audit$/m);
assert.match(migration, /^-- Rollback: /m);
const OLD = "SELECT 'none' AS expected, CASE WHEN COUNT(*) = 0 THEN 'none' ELSE 'recurred ' || COUNT(*) || 'x, last ' || MAX(ts) END AS observed FROM cloud_ops_events WHERE kind = 'ops_upstream_error' AND job = 'qnfo-ops' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-6 hours') AND text LIKE 'upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash)%'";
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE remediation_contracts (class TEXT, verify_probe TEXT); CREATE TABLE cloud_ops_events (id TEXT, ts TEXT, kind TEXT, job TEXT, text TEXT)");
db.prepare("INSERT INTO remediation_contracts VALUES ('issue-1001342', ?)").run(OLD);
const now = new Date().toISOString();
const ev = db.prepare("INSERT INTO cloud_ops_events VALUES (?, ?, 'ops_upstream_error', 'qnfo-ops', ?)");
ev.run("1", now, "upstream 429 at callDeepSeekStream (deepseek/deepseek-v4-flash) rate limited");
ev.run("2", now, "upstream 500 at somewhere else");
const before = db.prepare(OLD).get();
db.exec(migration);
const probe = db.prepare("SELECT verify_probe p FROM remediation_contracts").get().p;
assert.ok(!/LIKE 'upstream/.test(probe), "no long LIKE left");
assert.deepEqual({ ...db.prepare(probe).get() }, { ...before }, "same verdict");
assert.match(before.observed, /recurred 1x/);
db.exec(migration);
assert.equal(db.prepare("SELECT verify_probe p FROM remediation_contracts").get().p, probe, "idempotent");
console.log("issue-1001342-probe-like: ok");
