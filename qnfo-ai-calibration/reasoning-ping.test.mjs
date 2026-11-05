// REASONING-PING-1 and GW-FAIL-STATUS-SCOPE-1 (qnfo-ai-calibration 1.6.13; issues 6178 / agent_issues 1001002 and 6808 / agent_issues 1001463) offline suite.
// No network, no production data; the SQL runs on a real in-memory SQLite database.
// 1. A reasoning-only id (thinking, reasoner) gets a 512-token ping, every other id keeps 16. qnfo-ai keeps a reply only when message.content has text, so a
//    16-token ping to deepseek-v4-flash-thinking came back as an empty leg and a 504 (91 of 91 sweeps failed from 2026-11-01). The stub router behaves the same
//    way: a thinking id under 64 tokens answers 504, at 512 it answers with content. The ping must stay at or under 512 so no_downgrade is honoured.
// 2. The open "[gw-fail] <status> <model>" reconcile counts only the status named in its title and reads the open ledger rows too: "[gw-fail] 499
//    dynamic/value" closes when 499 is client-closed although the model also logs 400 and 504 rows, a counted 499 keeps it open, and a 400 title is
//    not closed by the 499 silence.
// Run: node qnfo-ai-calibration/reasoning-ping.test.mjs
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { versionAtLeast } from "../scripts/version-at-least.mjs";
const src = fs.readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const api = new Function(src.replace(/export \{\s*(?:worker_default|__fk_\w+_default) as default\s*\};?/, "") +
  "\nreturn { pingMaxTokens, probeCompletion, gatewayFailureSweep, fnv32, VERSION };")();
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) pass++; else { fail++; console.log("FAIL " + m + (d === undefined ? "" : " :: " + JSON.stringify(d).slice(0, 300))); } };

// 1. the ping size
ok(api.pingMaxTokens("deepseek-v4-flash") === 16 && api.pingMaxTokens("glm-5.3-flash") === 16 && api.pingMaxTokens("kimi-k2.6") === 16, "an ordinary id keeps the 16-token ping");
ok(api.pingMaxTokens("deepseek-v4-flash-thinking") === 512 && api.pingMaxTokens("deepseek-reasoner") === 512 && api.pingMaxTokens("DeepSeek-V4-Flash-Thinking") === 512, "a reasoning-only id gets 512");
ok(api.pingMaxTokens("deepseek-v4-flash-thinking") <= 512, "the ping stays inside the no_downgrade ceiling (512)");
ok(api.pingMaxTokens(undefined) === 16 && api.pingMaxTokens("") === 16, "no id: the default ping");

const seen = [];
const routerEnv = {
  QNFO_ROUTER_KEY: "k",
  QNFO_AI: {
    async fetch(_url, init) {
      const body = JSON.parse(init.body);
      seen.push(body);
      const reasoningOnly = /thinking|reasoner/.test(body.model);
      if (reasoningOnly && body.max_tokens < 64) return new Response(JSON.stringify({ error: { type: "router_timeout" } }), { status: 504 });
      return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }), { status: 200 });
    }
  }
};
const thinking = await api.probeCompletion(routerEnv, "deepseek-v4-flash-thinking");
ok(thinking.status === "pass", "the thinking id passes when it has room to answer", thinking);
ok(seen[0] && seen[0].max_tokens === 512 && seen[0].no_downgrade === true && seen[0].hedge === false, "the thinking ping is 512 tokens with no_downgrade and no hedge", seen[0]);
const plain = await api.probeCompletion(routerEnv, "deepseek-v4-flash");
ok(plain.status === "pass" && seen[1] && seen[1].max_tokens === 16, "an ordinary id still pings with 16 tokens", { plain, body: seen[1] });

// 2. the status-scoped reconcile
const T0 = 1793800000000;
function mkDb() {
  const d = new DatabaseSync(":memory:");
  d.exec(`
CREATE TABLE ai_gateway_failures (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, model TEXT, status INTEGER, count INTEGER, error_class TEXT, sample_detail TEXT, source TEXT);
CREATE TABLE agent_issues (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT);
CREATE TABLE issue_ledger (fingerprint TEXT PRIMARY KEY, source TEXT, level TEXT, category TEXT, title TEXT, status TEXT, first_seen INTEGER, last_seen INTEGER, occurrences INTEGER, last_detail TEXT, updated_at INTEGER, resolved_at INTEGER, resolution_note TEXT);
CREATE TABLE ai_model_health (model_id TEXT PRIMARY KEY, status TEXT, ctx_override INTEGER, vision_override INTEGER, reasoning_override INTEGER, last_probe_ts INTEGER, last_latency_ms INTEGER, consecutive_failures INTEGER DEFAULT 0, updated_at INTEGER, gateway_failures INTEGER DEFAULT 0);
CREATE TABLE ai_calibration_config (key TEXT PRIMARY KEY, value TEXT);
`);
  return d;
}
function d1Of(db) {
  return {
    prepare(q) {
      let a = [];
      const st = { bind(...x) { a = x; return st; },
        async first() { return db.prepare(q).get(...a) || null; },
        async all() { return { results: db.prepare(q).all(...a) }; },
        async run() { db.prepare(q).run(...a); return { success: true, meta: { changes: 1 } }; } };
      return st;
    }
  };
}
async function scenario(extraRows, titles) {
  const db = mkDb();
  const insFail = db.prepare("INSERT INTO ai_gateway_failures (ts, model, status, count, error_class, sample_detail, source) VALUES (?, ?, ?, ?, ?, '', 'qnfo-ai-calibration')");
  const recent = T0 - 3600 * 1000;
  // the calibration probes' own failures on the same model: 400 other and 504 upstream, plus a client-closed 499 (quiet since 1.6.10)
  insFail.run(recent, "dynamic/value", 400, 2, "other");
  insFail.run(recent, "dynamic/value", 504, 1, "upstream");
  insFail.run(recent, "dynamic/value", 499, 2, "client-closed");
  for (const r of extraRows) insFail.run(recent, r[0], r[1], 1, r[2]);
  const insLedger = db.prepare("INSERT INTO issue_ledger (fingerprint, source, level, category, title, status, first_seen, last_seen, occurrences, updated_at) VALUES (?, 'qnfo-ai-calibration', 'error', 'ai-calibration', ?, 'open', 1, 1, 1, 1)");
  const insIssue = db.prepare("INSERT INTO agent_issues (title, status) VALUES (?, 'open')");
  for (const t of titles.ledger) insLedger.run("gwfail:" + api.fnv32(t), t);
  for (const t of titles.issues) insIssue.run(t);
  const env = { QNFO_AUDIT: d1Of(db), CF_API_TOKEN: "t" };
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: [] }), { status: 200 });
  try { await api.gatewayFailureSweep(env, T0); } finally { globalThis.fetch = real; }
  const state = {};
  for (const r of db.prepare("SELECT title, status FROM issue_ledger").all()) state[r.title] = r.status;
  return state;
}
const T499 = "[gw-fail] 499 dynamic/value", T400 = "[gw-fail] 400 dynamic/value", T504 = "[gw-fail] 504 dynamic/value";
const quiet = await scenario([], { ledger: [T499, T400, T504], issues: [T499] });
ok(quiet[T499] === "resolved", "a 499 title closes when its own status is client-closed only, though 400 and 504 rows exist on the model", quiet);
ok(quiet[T400] === "open" && quiet[T504] === "open", "the 400 and 504 titles stay open: their own statuses are still failing", quiet);
const counted = await scenario([["dynamic/value", 499, "other"]], { ledger: [T499], issues: [T499] });
ok(counted[T499] === "open", "a counted 499 (class other) keeps the 499 title open", counted);
const ledgerOnly = await scenario([], { ledger: [T499], issues: [] });
ok(ledgerOnly[T499] === "resolved", "a ledger row with no agent_issues mirror is reconciled too", ledgerOnly);
const otherModel = await scenario([["@cf/zai-org/glm-5.3-flash", 499, "other"]], { ledger: [T499], issues: [T499] });
ok(otherModel[T499] === "resolved", "a counted 499 on another model does not hold this model's title", otherModel);

// 3. the source keeps one occurrence of each 24h read (gw-unfunded.test.mjs pins two NOT IN lists)
ok((src.match(/error_class NOT IN \(/g) || []).length === 2, "still exactly two error_class NOT IN reads");
ok(versionAtLeast(api.VERSION, "1.6.13"), "version is at least 1.6.13", api.VERSION);

console.log("reasoning-ping: " + pass + " passed, " + fail + " failed (" + api.VERSION + ")");
process.exit(fail ? 1 : 0);
