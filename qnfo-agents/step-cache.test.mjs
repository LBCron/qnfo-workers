// RM-DSH-CACHE-1 step-level prefix-cache telemetry: stepUsages reads each AI SDK step, stepUsageStatements are the D1 writes, and the view
// v_agents_step_cache of migrations/2026-11-05-gateway-cost-f4b.sql separates the first step of a run from the later ones.
// Run: node qnfo-agents/step-cache.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { stepUsages, stepUsageStatements } from "./src/lib.js";

// 1. the AI SDK v7 shape (inputTokenDetails.cacheReadTokens), the older shape (cachedInputTokens, promptTokens) and a step with no usage
const result = { steps: [
  { usage: { inputTokens: 3000, outputTokens: 120, inputTokenDetails: { cacheReadTokens: 0 } } },
  { usage: { inputTokens: 3500, outputTokens: 80, inputTokenDetails: { cacheReadTokens: 2944 } } },
  { text: "a step with no usage block" },
  { usage: { promptTokens: 4000, completionTokens: 60, cachedInputTokens: 3584 } },
  { usage: { inputTokens: 100, outputTokens: 5, inputTokenDetails: { cacheReadTokens: 900 } } }
] };
const rows = stepUsages(result);
assert.deepEqual(rows.map((r) => r.step), [1, 2, 4, 5], "step numbers follow the step order, a step without usage is skipped but keeps its number");
assert.deepEqual(rows[0], { step: 1, i: 3000, o: 120, c: 0 });
assert.deepEqual(rows[1], { step: 2, i: 3500, o: 80, c: 2944 });
assert.deepEqual(rows[2], { step: 4, i: 4000, o: 60, c: 3584 }, "the older field names are read");
assert.equal(rows[3].c, 100, "cached tokens never exceed the input tokens of their own step");
assert.deepEqual(stepUsages({}), []);
assert.deepEqual(stepUsages(null), []);
assert.deepEqual(stepUsages({ steps: [{ usage: { inputTokens: "x", outputTokens: -4 } }] }), [{ step: 1, i: 0, o: 0, c: 0 }], "junk numbers are zero");

// 2. the statements: bound values only, one per step, capped, safe on a non-array
const st = stepUsageStatements("run-abc", "2026-11-05", "dynamic/standard", rows, 1793850000000);
assert.equal(st.length, 4);
assert.match(st[0].sql, /^INSERT OR REPLACE INTO cf_agent_step_usage \(run_id, step, day, model, input_tokens, cached_tokens, output_tokens, ts\) VALUES \(\?1, \?2, \?3, \?4, \?5, \?6, \?7, \?8\)$/);
assert.deepEqual(st[1].binds, ["run-abc", 2, "2026-11-05", "dynamic/standard", 3500, 2944, 80, 1793850000000]);
assert.equal(stepUsageStatements("r", "2026-11-05", "m", Array.from({ length: 100 }, (_, k) => ({ step: k + 1, i: 1, o: 1, c: 0 })), 1).length, 40);
assert.deepEqual(stepUsageStatements("r", "d", "m", null, 1), []);

// 3. the migration: table, view, probe of 1000795
const sql = readFileSync(new URL("../migrations/2026-11-05-gateway-cost-f4b.sql", import.meta.url), "utf8");
assert.match(sql, /^-- APPLY-BY: ci$/m);
assert.match(sql, /^-- DB: qnfo-audit$/m);
assert.match(sql, /^-- Rollback: .+/m);
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE remediation_contracts (class TEXT PRIMARY KEY, issue_id INTEGER, verify_probe TEXT, verify_transport TEXT, last_verdict TEXT);
    CREATE TABLE roadmap_implementation (id INTEGER PRIMARY KEY, item TEXT, status TEXT, evidence TEXT);
    CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, source TEXT, category TEXT, priority TEXT, status TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE decision_log (actor, assumption, action, evidence, outcome, blast_radius, rollback_path, capability_gain, predicted_outcome, reach_gain, surfaces_tested);
    CREATE TABLE issue_triage (issue_id INTEGER PRIMARY KEY, triage_state TEXT, close_evidence TEXT);
    CREATE TABLE ops_config (key TEXT PRIMARY KEY, value TEXT, note TEXT, updated_at TEXT);
    INSERT INTO remediation_contracts VALUES ('issue-1000795', 1000795, 'SELECT old', 'd1-query', 'fail'), ('issue-1000796', 1000796, 'SELECT old', 'd1-query', 'fail'), ('issue-1000652', 1000652, 'SELECT old', 'd1-query', 'fail');
    INSERT INTO roadmap_implementation VALUES (1695, 'RM-AUTOROUTER-EVAL-1', 'planned', 'docs/SCOUT-ROADMAP-2026-10.md'), (1803, 'RM-DSH-CACHE-1', 'planned', 'docs/COMPOSIO-INTEGRATION.md'), (1804, 'RM-DSH-REPLAY-1', 'planned', 'docs/COMPOSIO-INTEGRATION.md');
  `);
  db.exec(sql);
  return db;
}
const today = new Date().toISOString().slice(0, 10);
function put(db, runId, steps) {
  const ins = db.prepare("INSERT INTO cf_agent_step_usage (run_id, step, day, model, input_tokens, cached_tokens, output_tokens, ts) VALUES (?,?,?,?,?,?,?,?)");
  steps.forEach(([i, c], k) => ins.run(runId, k + 1, today, "dynamic/standard", i, c, 10, 1));
}
const probe = (db, id = 1000795) => db.prepare("SELECT verify_probe FROM remediation_contracts WHERE class = ?").get("issue-" + id).verify_probe;
const run = (db) => db.prepare(probe(db)).get();

{
  const db = fixture();
  const v = db.prepare("SELECT position, steps, in_tok, cached_tok, cached_share FROM v_agents_step_cache ORDER BY position").all();
  assert.deepEqual(v, [], "an empty table reads as no rows");
  const none = run(db);
  assert.notEqual(none.expected, none.observed);
  assert.match(none.observed, /no step rows|only 0 later steps/, none.observed);
}
{
  // the first step of every run is uncached, the later ones read the prefix: the first-step rows must not drag the later-step share down
  const db = fixture();
  for (let r = 0; r < 12; r++) put(db, "run-" + r, [[3000, 0], [3400, 2900], [3800, 3300], [4200, 3700]]);
  const v = db.prepare("SELECT position, steps, in_tok, cached_tok, cached_share FROM v_agents_step_cache ORDER BY position").all();
  assert.equal(v.find((x) => x.position === "first").steps, 12);
  assert.equal(v.find((x) => x.position === "first").cached_share, 0);
  const later = v.find((x) => x.position === "later");
  assert.equal(later.steps, 36);
  assert.ok(later.cached_share > 0.8, "later steps share " + later.cached_share);
  const r = run(db);
  assert.equal(r.expected, r.observed, "a healthy cache passes: " + r.observed);
}
{
  const db = fixture();
  for (let r = 0; r < 12; r++) put(db, "run-" + r, [[3000, 0], [3400, 300], [3800, 200], [4200, 0]]);
  const r = run(db);
  assert.notEqual(r.expected, r.observed);
  assert.match(r.observed, /^later-step cached share 0\.0\d+ over 36 steps$/, "a cold cache says its share and step count: " + r.observed);
}
{
  const db = fixture();
  put(db, "run-a", [[3000, 0], [3400, 3000], [3800, 3300]]);
  const r = run(db);
  assert.match(r.observed, /^only 2 later steps recorded in the last 3 days$/, "thin data is not a verdict: " + r.observed);
}
{
  // rows older than 3 days do not count
  const db = fixture();
  const ins = db.prepare("INSERT INTO cf_agent_step_usage (run_id, step, day, model, input_tokens, cached_tokens, output_tokens, ts) VALUES (?,?,?,?,?,?,?,?)");
  for (let k = 0; k < 40; k++) ins.run("old-" + k, 2, "2020-01-01", "m", 1000, 900, 1, 1);
  assert.match(run(db).observed, /only 0 later steps/);
}
// 4. the same rerun is idempotent (INSERT OR REPLACE on run_id, step)
{
  const db = fixture();
  put(db, "run-x", [[10, 0], [20, 10]]);
  db.prepare("INSERT OR REPLACE INTO cf_agent_step_usage (run_id, step, day, model, input_tokens, cached_tokens, output_tokens, ts) VALUES ('run-x', 2, ?, 'm', 30, 20, 1, 2)").run(today);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cf_agent_step_usage").get().n, 2);
}
// 5. the rest of the migration: replay probe is code, the Auto Router latch and its precondition row, roadmap rows, one pass of everything on a re-run
{
  const db = fixture();
  db.exec(sql); // applying twice must change nothing
  const rp = db.prepare("SELECT verify_probe, verify_transport FROM remediation_contracts WHERE class = 'issue-1000796'").get();
  assert.equal(rp.verify_transport, "code-read");
  const spec = JSON.parse(rp.verify_probe);
  assert.deepEqual(spec.paths, ["scripts/agent_loop_replay.mjs"]);
  assert.ok(readFileSync(new URL("../" + spec.paths[0], import.meta.url), "utf8").includes(spec.contains), "the code-read marker exists in the replay harness on this tree");
  assert.equal(db.prepare("SELECT value FROM ops_config WHERE key = 'autorouter_shadow_daily'").get().value, "off", "the shadow replay is latched off");
  const rows = db.prepare("SELECT title, description FROM agent_issues WHERE title LIKE 'ROADMAP-1: QNFO.INFRA AUTOROUTER-EVAL-1.3%'").all();
  assert.equal(rows.length, 1, "the precondition row is filed once");
  assert.match(rows[0].description, /^code-task: repo=qnfo-workers path=qnfo-ai\/worker\.js\ncode-anchor: async function autoRouterShadowRun\(env, limit\) \{\ncode-probe: /);
  assert.match(rows[0].description, /cf-aig-allowed-providers: workers-ai/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM decision_log WHERE action LIKE 'GATEWAY-COST-F4B:%'").get().n, 1);
  assert.deepEqual(db.prepare("SELECT id, status FROM roadmap_implementation ORDER BY id").all().map((r) => r.id + ":" + r.status), ["1695:partial", "1803:partial", "1804:planned"], "the replay row is left to its own earlier verification");
  // the code anchor of the filed row occurs once in the file it names
  const anchor = "async function autoRouterShadowRun(env, limit) {";
  const src = readFileSync(new URL("../qnfo-ai/worker.js", import.meta.url), "utf8");
  assert.equal(src.split(anchor).length - 1, 1, "code-anchor occurs exactly once in qnfo-ai/worker.js");
}
console.log("step-cache: ok");
