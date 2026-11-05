// GATEWAY-ROUTE-ALL-1 migration suite (BP26-AI-GATEWAY-BUDGETS-1 1000614, RM-DSH-CACHE-1 1000795): the view, the two replaced probes, the four ROADMAP-1 rows.
// Run: node migrations/gateway-cache-share-f4.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const sql = readFileSync(new URL("./2026-11-05-gw-cost-f4.sql", import.meta.url), "utf8");
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- BACKUP: bak_20261105_gw_cost_f4_contracts$/m);
assert.match(sql, /^-- Rollback: .+/m);

function fixture(ledgerRows) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE ai_spend_ledger (day TEXT, provider TEXT, caller TEXT, model TEXT, calls INTEGER, in_tok INTEGER, out_tok INTEGER, usd REAL, cached_tok INTEGER);
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, last_verdict TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
    INSERT INTO remediation_contracts VALUES ('issue-1000614', 1000614, 'SELECT old', 'd1-query', 'fail'), ('issue-1000795', 1000795, 'SELECT old', 'd1-query', 'fail');
  `);
  const ins = db.prepare("INSERT INTO ai_spend_ledger VALUES (?,?,?,?,?,?,?,?,?)");
  for (const r of ledgerRows) ins.run(...r);
  return db;
}
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const probe = (db) => db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class='issue-1000795'").get().verify_probe;
const run = (db) => db.prepare(probe(db)).get();

// 1. the view sums providers and models per caller and day, and ignores rows older than 35 days
{
  const db = fixture([
    [today, "workers-ai", "qnfo-agents", "dynamic/standard", 10, 1000, 10, 0.1, 880],
    [today, "gateway", "qnfo-agents", "other", 2, 1000, 10, 0.1, 0],
    [today, "gateway", "qnfo-research-exec", "m", 1, 500, 5, 0.1, null],
    ["2020-01-01", "gateway", "old", "m", 1, 500, 5, 0.1, 500],
  ]);
  db.exec(sql);
  const rows = db.prepare("SELECT caller, calls, in_tok, cached_tok, cached_share FROM v_cache_share_by_caller ORDER BY caller").all();
  assert.deepEqual(rows.map((r) => r.caller), ["qnfo-agents", "qnfo-research-exec"], "old rows are outside the window");
  assert.equal(rows[0].calls, 12);
  assert.equal(rows[0].in_tok, 2000);
  assert.equal(rows[0].cached_tok, 880);
  assert.equal(rows[0].cached_share, 0.44);
  assert.equal(rows[1].cached_tok, 0, "a NULL cached count is zero");
  assert.equal(rows[1].cached_share, 0);
}
// 2. the DSH-CACHE probe passes on a high cached share of a day with 100000 input tokens, and says why when it does not
{
  const pass = fixture([[today, "workers-ai", "qnfo-agents", "dynamic/standard", 100, 4000000, 1000, 1, 3500000]]);
  pass.exec(sql);
  const r = run(pass);
  assert.equal(r.expected, r.observed, "88 percent cached share passes: " + r.observed);
  const low = fixture([[today, "workers-ai", "qnfo-agents", "dynamic/standard", 100, 4000000, 1000, 1, 1000000]]);
  low.exec(sql);
  const l = run(low);
  assert.notEqual(l.expected, l.observed);
  assert.match(l.observed, /^cached share 0\.25 on \d{4}-\d{2}-\d{2} with 4000000 input tokens$/);
  const thin = fixture([[today, "workers-ai", "qnfo-agents", "dynamic/standard", 1, 5000, 10, 0, 0], [yesterday, "workers-ai", "qnfo-agents", "dynamic/standard", 100, 4000000, 1000, 1, 3600000]]);
  thin.exec(sql);
  const t = run(thin);
  assert.equal(t.expected, t.observed, "a thin current day is skipped; the latest day with 100000 input tokens decides: " + t.observed);
  const none = fixture([[today, "gateway", "qnfo-research-exec", "m", 1, 500, 5, 0, 0]]);
  none.exec(sql);
  assert.equal(run(none).observed, "no qnfo-agents day with 100000 input tokens");
}
// 3. the BP26 probe is a code-read contract on the compose call site, and both facts it needs hold in the source it reads
{
  const db = fixture([]);
  db.exec(sql);
  const c = db.prepare("SELECT verify_probe, verify_transport FROM remediation_contracts WHERE class='issue-1000614'").get();
  assert.equal(c.verify_transport, "code-read");
  const p = JSON.parse(c.verify_probe);
  assert.deepEqual(p.paths, ["q08-signal-engine/worker.js"]);
  assert.ok(typeof p.absent === "string" && p.absent.length > 20);
  const src = readFileSync(new URL("../q08-signal-engine/worker.js", import.meta.url), "utf8");
  assert.ok(!src.includes(p.absent), "the direct compose call is gone from q08-signal-engine");
  assert.ok(/aiGatewayRun\(env, modelId, Object\.assign\(\{/.test(src), "the compose call goes through aiGatewayRun");
}
// 4. each ROADMAP-1 row has a doer: a code-task path that exists and a code-anchor that occurs once in it; the migration is idempotent
{
  const db = fixture([]);
  db.exec(sql);
  db.exec(sql.replace(/CREATE TABLE IF NOT EXISTS[\s\S]*?;\n/, ""));
  const rows = db.prepare("SELECT title, description FROM agent_issues ORDER BY id").all();
  assert.equal(rows.length, 4, "four rows, none duplicated by a second run");
  for (const row of rows) {
    assert.match(row.title, /^ROADMAP-1: QNFO\.INFRA BP26-GW-/);
    const path = /^code-task: repo=qnfo-workers path=(\S+)$/m.exec(row.description)[1];
    const anchor = /^code-anchor: (.+)$/m.exec(row.description)[1];
    const src = readFileSync(new URL("../" + path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.equal(src.split(anchor).length - 1, 1, path + " holds the anchor exactly once: " + anchor);
    assert.match(row.description, /^code-probe: \{"paths": \["[^"]+"\], "contains": "BP26-GW-[A-Z-]+-1"\}$/m);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log").get().n, 1);
}
console.log("gateway-cache-share-f4: ok");
