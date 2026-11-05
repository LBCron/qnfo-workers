// C5-OBSERVE: replays migrations/2026-11-04-c5-observe-rows.sql on an in-memory copy of the tables it touches.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE roadmap_implementation(id INTEGER PRIMARY KEY, item TEXT, source TEXT, title TEXT, artifact_type TEXT, artifact_ref TEXT, status TEXT, evidence TEXT, verified_at TEXT, created_at TEXT);
INSERT INTO roadmap_implementation(id,item,status,evidence) VALUES
 (3,'RM-PROBE-VERIFIED-COVERAGE-1','partial','old'),(4,'RM-MONITOR-THE-MONITORS-1','not-built','old'),(22,'RM-FUNNEL-E2E-MONITOR-1','not-built','old'),
 (57,'RM-CAPABILITY-PRODUCT-LOOP-1','partial','old'),(127,'RM-TP-2-ONE-KERNEL','partial','old'),(128,'RM-OTHER','partial','keep');
CREATE TABLE metric_registry(metric TEXT PRIMARY KEY,layer TEXT,kind TEXT,formula TEXT,source_of_truth TEXT,target TEXT,owner TEXT,disposition_actor TEXT,refresh_cadence TEXT,state TEXT,last_value TEXT,last_refreshed TEXT);
CREATE TABLE metric_breach_cause(metric_key TEXT, cause_key TEXT, note TEXT, PRIMARY KEY(metric_key, cause_key));
CREATE TABLE fleet_tasks(id TEXT PRIMARY KEY,name TEXT,type TEXT,definition TEXT,timeout_ms INTEGER,retries INTEGER,version INTEGER,enabled INTEGER,updated_at TEXT);
CREATE TABLE fleet_crons(name TEXT PRIMARY KEY,cron_expr TEXT,task_id TEXT,enabled INTEGER,timezone TEXT,updated_at TEXT);
CREATE TABLE agent_issues(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,description TEXT,source TEXT,category TEXT,priority TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE worker_usage_daily(day TEXT NOT NULL,script TEXT NOT NULL,requests_24h INTEGER,errors_24h INTEGER,requests_7d INTEGER,errors_7d INTEGER,source TEXT,ts TEXT,PRIMARY KEY(day,script));
CREATE TABLE product_registry(product TEXT,host TEXT,worker TEXT,state TEXT);
`);
const sql = readFileSync(new URL("./2026-11-04-c5-observe-rows.sql", import.meta.url), "utf8");
db.exec(sql);
db.exec(sql); // idempotent: a second apply changes no row count
const one = q => db.prepare(q).get();

// rows
for (const [id, st] of [[3, "built"], [4, "built"], [22, "built"], [57, "partial"], [127, "partial"]]) {
  const r = one(`SELECT status, evidence, verified_at FROM roadmap_implementation WHERE id = ${id}`);
  assert.equal(r.status, st, "row " + id);
  assert.ok(r.evidence.length > 400 && r.evidence !== "old", "row " + id + " carries its evidence");
  assert.ok(r.verified_at, "row " + id + " is dated");
}
assert.equal(one("SELECT evidence FROM roadmap_implementation WHERE id = 128").evidence, "keep", "other rows are untouched");
assert.match(one("SELECT evidence FROM roadmap_implementation WHERE id = 3").evidence, /PR 7306/);

// metric, cause, task, cron
const m = one("SELECT * FROM metric_registry WHERE metric = 'worker_requests_nonpublic_per_day'");
assert.ok(m && m.target === "< 3000" && m.state === "UNMEASURED");
assert.equal(one("SELECT COUNT(*) n FROM metric_breach_cause WHERE metric_key = 'worker_requests_nonpublic_per_day'").n, 1);
const cron = one("SELECT cron_expr FROM fleet_crons WHERE name = 'self-observation-metric-1h'");
assert.ok(cron && Number(cron.cron_expr.split(" ")[0]) % 5 === 0 && cron.cron_expr.split(" ")[1] === "*", "hourly and on the 5-minute grid");
const step = JSON.parse(one("SELECT definition FROM fleet_tasks WHERE id = 'self-observation-metric'").definition).steps[0];
assert.equal(step.type, "sql");

// the measure: public product workers and __unknown__ are excluded, the latest day only, NOT IN is NULL-safe
db.exec(`INSERT INTO worker_usage_daily(day,script,requests_24h) VALUES
 ('2026-11-03','old-day-worker',99999),
 ('2026-11-04','qnfo-gateway',26000),('2026-11-04','qnfo-fleet-dashboard',3000),('2026-11-04','qnfo-fleet-control',19000),
 ('2026-11-04','q08-mind',1000),('2026-11-04','qnfo-tools-mcp',1000),('2026-11-04','__unknown__',88);
 INSERT INTO product_registry VALUES('papers','papers.qnfo.org','qnfo-gateway','active'),('fleet','fleet.qnfo.org','qnfo-fleet-dashboard','active'),
  ('yt','youtube','qnfo-youtube-shorts','active'),('nullworker','x.qnfo.org',NULL,'active'),('retired','old.qnfo.org','q08-mind','retired');`);
db.exec(step.sql);
assert.equal(one("SELECT last_value v FROM metric_registry WHERE metric = 'worker_requests_nonpublic_per_day'").v, "21000", "fleet-control 19000 + q08-mind 1000 + tools-mcp 1000");
assert.equal(one("SELECT state s FROM metric_registry WHERE metric = 'worker_requests_nonpublic_per_day'").s, "MEASURED");

// issues: filed once each, with a doer line, a one-line anchor and a probe
const issues = db.prepare("SELECT title, description, status FROM agent_issues ORDER BY id").all();
assert.equal(issues.length, 2, "idempotent");
for (const i of issues) {
  assert.equal(i.status, "open");
  assert.match(i.description, /^code-task: repo=qnfo-workers path=\S+\.js$/m);
  assert.match(i.description, /^code-anchor: async function \w+\([^)]*\) \{$/m);
  assert.match(i.description, /^code-probe: \{"paths": \["[^"]+"\], "contains": "[^"]+"\}$/m);
}
assert.match(issues[0].description, /code-anchor: async function watchmakerMeasure\(env, nowMs\) \{/);
assert.match(issues[1].description, /code-anchor: async function cfcMetrics\(env\) \{/);
console.log("c5-observe-rows: ok");
